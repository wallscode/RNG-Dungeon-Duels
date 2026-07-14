#!/usr/bin/env bash
# deploy.sh — Sync public/ to the site bucket and invalidate CloudFront.
#
# Contains NO infrastructure identifiers. All targets come from the
# environment (CI: GitHub secrets) or from the gitignored local state file
# written by admin-setup.sh.
#
#   S3_BUCKET                   target bucket name          (required)
#   CLOUDFRONT_DISTRIBUTION_ID  distribution to invalidate  (required)
#   AWS_REGION                  region                      (default us-east-1)
#
# Local usage after admin-setup.sh:  ./infra/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# Fall back to gitignored local state for manual deploys.
if [[ -z "${S3_BUCKET:-}" && -f infra/.deploy-state ]]; then
  # shellcheck disable=SC1091
  source infra/.deploy-state
  S3_BUCKET="${S3_BUCKET:-$SAVED_BUCKET}"
  CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-$SAVED_DIST_ID}"
fi

: "${S3_BUCKET:?set S3_BUCKET (or run infra/admin-setup.sh first)}"
: "${CLOUDFRONT_DISTRIBUTION_ID:?set CLOUDFRONT_DISTRIBUTION_ID}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

echo "==> Syncing public/ to the site bucket…"
# Assets get a day of cache; index.html stays short so deploys show fast.
aws s3 sync public/ "s3://${S3_BUCKET}/" --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=86400"
aws s3 cp public/index.html "s3://${S3_BUCKET}/index.html" \
  --cache-control "public, max-age=60"

echo "==> Invalidating CloudFront cache…"
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*" --query 'Invalidation.Id' --output text

echo "✅ Deploy complete."
