#!/usr/bin/env bash
# admin-setup.sh — ONE-TIME admin bootstrap for RNG Dungeon Duels hosting + CI.
#
# Run this with elevated (admin) AWS credentials. Everything it creates is
# scoped to this project; after it finishes, routine deploys run in GitHub
# Actions under a least-privilege role and never need admin access again.
#
# Creates:
#   1. Private S3 bucket (random-suffix name — not derivable from the account)
#   2. CloudFront distribution + Origin Access Control (bucket stays private)
#   3. GitHub OIDC identity provider (if the account doesn't have one yet)
#   4. IAM deploy role trusted ONLY by this repo's main branch via OIDC,
#      allowed ONLY to sync the bucket and invalidate the distribution
#   5. GitHub repo secrets (via `gh`), or prints them for manual entry
#   6. Initial content deploy
#
# Usage:
#   GITHUB_REPO=owner/repo ./infra/admin-setup.sh
#   GITHUB_REPO=owner/repo REGION=us-west-2 ./infra/admin-setup.sh
#
# No identifiers are written to any git-tracked file. Local state (bucket,
# distribution id) is saved to infra/.deploy-state, which is gitignored.

set -euo pipefail

cd "$(dirname "$0")/.."

REGION="${REGION:-us-east-1}"
ROLE_NAME="${ROLE_NAME:-rng-dungeon-duels-github-deploy}"
STATE_FILE="infra/.deploy-state"

# ── Preconditions ─────────────────────────────────────────────────────────────

if [[ -z "${GITHUB_REPO:-}" ]]; then
  # Try to derive from the git remote.
  origin=$(git remote get-url origin 2>/dev/null || true)
  if [[ "$origin" =~ github\.com[:/]([^/]+/[^/.]+) ]]; then
    GITHUB_REPO="${BASH_REMATCH[1]}"
  else
    echo "ERROR: set GITHUB_REPO=owner/repo (no GitHub remote found to derive it from)." >&2
    exit 1
  fi
fi

if ! git check-ignore -q "$STATE_FILE"; then
  echo "ERROR: $STATE_FILE is not gitignored — refusing to write state." >&2
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "==> Account: (authenticated)  Region: $REGION  Repo: $GITHUB_REPO"

# Load prior state so re-runs are idempotent.
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

# ── 1. Private S3 bucket ──────────────────────────────────────────────────────

if [[ -z "${SAVED_BUCKET:-}" ]]; then
  SAVED_BUCKET="rng-duels-$(openssl rand -hex 6)"
  echo "==> Creating private S3 bucket…"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$SAVED_BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$SAVED_BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi
aws s3api put-public-access-block --bucket "$SAVED_BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# ── 2. Origin Access Control + CloudFront distribution ───────────────────────

if [[ -z "${SAVED_OAC_ID:-}" ]]; then
  echo "==> Creating Origin Access Control…"
  SAVED_OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config \
    "Name=${SAVED_BUCKET}-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query 'OriginAccessControl.Id' --output text)
fi

if [[ -z "${SAVED_DIST_ID:-}" ]]; then
  echo "==> Creating CloudFront distribution…"
  # Cache policy: AWS managed CachingOptimized.
  # Response headers policy: AWS managed SecurityHeadersPolicy
  # (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, etc.)
  DIST_CONFIG=$(cat <<JSON
{
  "CallerReference": "rng-dungeon-duels-$(date +%s)",
  "Comment": "RNG Dungeon Duels",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "HttpVersion": "http2and3",
  "PriceClass": "PriceClass_100",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "s3-origin",
      "DomainName": "${SAVED_BUCKET}.s3.${REGION}.amazonaws.com",
      "OriginAccessControlId": "${SAVED_OAC_ID}",
      "S3OriginConfig": { "OriginAccessIdentity": "" }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "Compress": true,
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "ResponseHeadersPolicyId": "67f7725c-6f97-4210-82d7-5512b31e9d03",
    "AllowedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] } }
  }
}
JSON
)
  CREATE_OUT=$(aws cloudfront create-distribution --distribution-config "$DIST_CONFIG")
  SAVED_DIST_ID=$(echo "$CREATE_OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["Id"])')
  SAVED_DOMAIN=$(echo "$CREATE_OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["DomainName"])')

  echo "==> Granting CloudFront (this distribution only) read access to the bucket…"
  aws s3api put-bucket-policy --bucket "$SAVED_BUCKET" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontOAC",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${SAVED_BUCKET}/*",
    "Condition": { "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${SAVED_DIST_ID}"
    } }
  }]
}
JSON
)"
fi

# ── 3. GitHub OIDC identity provider ──────────────────────────────────────────

OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "==> Creating GitHub OIDC identity provider…"
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" "1c58a3a8518e8759bf075b76b750d4f2df264fcd" >/dev/null
fi

# ── 4. Least-privilege deploy role ────────────────────────────────────────────
# Trusted ONLY by GitHub Actions runs on this repo's main branch.
# Permitted ONLY to: list/put/delete objects in the site bucket, and create
# invalidations on the site distribution. Nothing else.

TRUST_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
JSON
)

PERMISSIONS_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SyncSiteBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${SAVED_BUCKET}"
    },
    {
      "Sid": "WriteSiteObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${SAVED_BUCKET}/*"
    },
    {
      "Sid": "InvalidateSiteCache",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${SAVED_DIST_ID}"
    }
  ]
}
JSON
)

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "==> Updating existing deploy role…"
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
else
  echo "==> Creating deploy role…"
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Least-privilege GitHub Actions deploy role for RNG Dungeon Duels" \
    --max-session-duration 3600 >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE_NAME" \
  --policy-name "deploy-site" --policy-document "$PERMISSIONS_POLICY"
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

# ── Save local state (gitignored) ─────────────────────────────────────────────

if [[ -z "${SAVED_DOMAIN:-}" ]]; then
  SAVED_DOMAIN=$(aws cloudfront get-distribution --id "$SAVED_DIST_ID" \
    --query 'Distribution.DomainName' --output text)
fi

cat > "$STATE_FILE" <<EOF
SAVED_BUCKET="$SAVED_BUCKET"
SAVED_OAC_ID="$SAVED_OAC_ID"
SAVED_DIST_ID="$SAVED_DIST_ID"
SAVED_DOMAIN="$SAVED_DOMAIN"
SAVED_ROLE_ARN="$ROLE_ARN"
EOF
chmod 600 "$STATE_FILE"

# ── 5. GitHub repo secrets ────────────────────────────────────────────────────

echo "==> Setting GitHub Actions secrets…"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh secret set AWS_DEPLOY_ROLE_ARN         -R "$GITHUB_REPO" --body "$ROLE_ARN"
  gh secret set AWS_REGION                  -R "$GITHUB_REPO" --body "$REGION"
  gh secret set S3_BUCKET                   -R "$GITHUB_REPO" --body "$SAVED_BUCKET"
  gh secret set CLOUDFRONT_DISTRIBUTION_ID  -R "$GITHUB_REPO" --body "$SAVED_DIST_ID"
  echo "    Secrets set on $GITHUB_REPO via gh."
else
  echo ""
  echo "    gh CLI not available/authenticated — add these secrets to"
  echo "    https://github.com/${GITHUB_REPO}/settings/secrets/actions :"
  echo ""
  echo "      AWS_DEPLOY_ROLE_ARN        = $ROLE_ARN"
  echo "      AWS_REGION                 = $REGION"
  echo "      S3_BUCKET                  = $SAVED_BUCKET"
  echo "      CLOUDFRONT_DISTRIBUTION_ID = $SAVED_DIST_ID"
  echo ""
fi

# ── 6. Initial deploy (as admin, so the site is live immediately) ─────────────

echo "==> Initial content deploy…"
S3_BUCKET="$SAVED_BUCKET" CLOUDFRONT_DISTRIBUTION_ID="$SAVED_DIST_ID" AWS_REGION="$REGION" \
  ./infra/deploy.sh

echo ""
echo "✅ Bootstrap complete."
echo "   Site URL: https://${SAVED_DOMAIN}"
echo "   (New distributions take ~5–10 minutes to go live globally.)"
echo ""
echo "   Routine deploys now run in GitHub Actions on push to main,"
echo "   using role ${ROLE_NAME} — admin credentials are no longer needed."
