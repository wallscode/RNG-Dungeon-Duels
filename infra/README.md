# Infrastructure & Deployment

The site is hosted on **CloudFront + a private S3 bucket** (Origin Access
Control — the bucket is never public). Routine deploys run in **GitHub
Actions** under a least-privilege IAM role assumed via **OIDC federation**:
no AWS access keys exist anywhere, and no account IDs, bucket names, or
distribution IDs are committed to this repo. All identifiers live in GitHub
Actions secrets and in the gitignored `infra/.deploy-state` file.

## One-time admin bootstrap

Run once with **admin-level** AWS credentials (e.g. after `aws login` with an
admin profile):

```bash
GITHUB_REPO=<owner>/<repo> ./infra/admin-setup.sh
```

This creates, idempotently:

| Resource | Details |
|----------|---------|
| S3 bucket | Random-suffix name; public access fully blocked |
| CloudFront distribution | HTTPS-only, OAC read access, managed security-headers policy |
| GitHub OIDC provider | `token.actions.githubusercontent.com` (skipped if the account already has one) |
| IAM role `rng-dungeon-duels-github-deploy` | See scope below |
| GitHub secrets | Set via `gh` if available, otherwise printed for manual entry |

It finishes with an initial content deploy so the site is live immediately.
Admin credentials are not needed again after this.

## Deploy role scope (least privilege)

**Who can assume it:** only GitHub Actions workflow runs on this repository's
`main` branch (OIDC `sub` condition `repo:<owner>/<repo>:ref:refs/heads/main`).

**What it can do:** nothing except

- `s3:ListBucket` on the site bucket
- `s3:PutObject`, `s3:DeleteObject` on the site bucket's objects
- `cloudfront:CreateInvalidation` / `GetInvalidation` on the site distribution

## Routine deploys

Push to `main` (or trigger **Deploy to AWS** manually in the Actions tab).
The workflow assumes the deploy role, runs `infra/deploy.sh` (sync + cache
invalidation), and finishes in under a minute.

Manual deploy from a workstation that has run the bootstrap:

```bash
./infra/deploy.sh   # reads gitignored infra/.deploy-state
```

## GitHub secrets used

| Secret | Purpose |
|--------|---------|
| `AWS_DEPLOY_ROLE_ARN` | Role the workflow assumes |
| `AWS_REGION` | Bucket region |
| `S3_BUCKET` | Site bucket name |
| `CLOUDFRONT_DISTRIBUTION_ID` | Distribution to invalidate |
