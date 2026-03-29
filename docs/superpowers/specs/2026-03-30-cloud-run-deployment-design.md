# Cloud Run Deployment — Design Spec
**Date:** 2026-03-30
**Status:** Proposed
**Author:** Claude (self-directed)

---

## Decision summary

Package the blog MCP server as a Docker image, deploy to Cloud Run (single revision, single service), use Firestore as storage. No Kubernetes, no load balancer, no separate services. One `deploy.sh` script handles the full deploy. GitHub Actions workflow triggers deploy on push to `main`.

---

## Problem

The webhook receiver currently requires `npm run dev:blog` running locally. There is no always-on URL, so real GitHub webhooks can't be received. The Firestore storage backend is implemented but never used outside of CI.

---

## Goals

1. One-command deploy: `./scripts/deploy.sh`
2. Server reachable at a stable HTTPS URL (Cloud Run auto-provisions TLS)
3. GitHub webhook events reach the server and create posts in Firestore
4. Zero downtime deploys (Cloud Run default behavior)
5. Costs < $5/month at AO worker traffic levels

## Non-goals

- Multi-region deployment
- Custom domain (use Cloud Run default URL for now)
- Separate staging/prod environments
- Autoscaling above 1 instance (AO traffic is low volume)

---

## Architecture

```
GitHub webhook → Cloud Run (always-on) → Firestore
                     ↑
              MCP clients (Claude Code, etc.)
```

### Cloud Run configuration

```yaml
# One revision, one container, one Firestore database
service: ai-universe-living-blog
region: us-central1
min-instances: 1     # always-on (prevents cold starts for webhooks)
max-instances: 3
memory: 256Mi
cpu: 1
port: 8888
```

**Always-on (min-instances: 1):** Webhooks arrive unpredictably. Cold starts would cause GitHub to retry and trigger duplicate posts. With idempotency (`X-GitHub-Delivery` dedup), retries are safe but min=1 is cleaner.

**Cost:** 1 always-on 256Mi instance ≈ $3–4/month (below Cloud Run free tier threshold for AO traffic levels).

---

## Files to create

### `Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY public/ ./public/
ENV NODE_ENV=production
ENV STORAGE_TYPE=firestore
EXPOSE 8888
CMD ["node", "dist/blog/server.js"]
```

Builds from `dist/` (TypeScript compiled). Does NOT use `tsx` in production.

### `scripts/deploy.sh`

```bash
#!/bin/bash
set -euo pipefail
PROJECT=${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project)}
REGION=us-central1
SERVICE=ai-universe-living-blog
IMAGE=gcr.io/$PROJECT/$SERVICE

npm run build
docker build -t $IMAGE .
docker push $IMAGE
gcloud run deploy $SERVICE \
  --image $IMAGE \
  --region $REGION \
  --platform managed \
  --min-instances 1 \
  --max-instances 3 \
  --memory 256Mi \
  --set-env-vars "STORAGE_TYPE=firestore,NODE_ENV=production" \
  --set-secrets "AUTH_API_KEY=blog-auth-key:latest,WEBHOOK_SECRET=blog-webhook-secret:latest" \
  --allow-unauthenticated
echo "Deployed: $(gcloud run services describe $SERVICE --region $REGION --format 'value(status.url)')"
```

### `.github/workflows/deploy.yml`

Triggers on push to `main` (after CI passes). Runs `deploy.sh` using Workload Identity Federation (no stored service account keys).

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # Workload Identity Federation
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.WIF_PROVIDER }}
          service_account: ${{ vars.DEPLOY_SA }}
      - run: npm ci && npm run build
      - run: bash scripts/deploy.sh
```

### `secrets/` (GCP Secret Manager, not committed)

| Secret name | Contents |
|---|---|
| `blog-auth-key` | Value for `AUTH_API_KEY` |
| `blog-webhook-secret` | Value for `WEBHOOK_SECRET` (GitHub HMAC) |

---

## File changes

| File | Change |
|---|---|
| `Dockerfile` | New |
| `scripts/deploy.sh` | New |
| `.github/workflows/deploy.yml` | New |
| `.dockerignore` | New — excludes `node_modules/`, `tests/`, `testing_mcp/`, `*.log` |
| `docs/DEPLOYMENT.md` | Update with Cloud Run instructions |

---

## GitHub webhook setup (post-deploy)

1. Deploy → get Cloud Run URL
2. GitHub repo → Settings → Webhooks → Add webhook
3. Payload URL: `https://<cloud-run-url>/webhook`
4. Content type: `application/json`
5. Secret: value of `blog-webhook-secret`
6. Events: Pull requests, Check runs

---

## Testing

1. `docker build -t blog-test .` + `docker run -p 8888:8888 blog-test` → health check
2. `curl -X POST https://<url>/mcp -d '{"jsonrpc":"2.0","id":1,"method":"health_check","params":{}}'`
3. Send a test webhook payload manually to verify idempotency

No new automated tests — existing `testing_mcp/` suite runs against the deployed URL by setting `BLOG_SERVER_URL=https://<cloud-run-url>`.

---

## Implementation order

1. `Dockerfile` + `.dockerignore` — build and run locally
2. `scripts/deploy.sh` — deploy to Cloud Run manually
3. Verify health check and `list_repos` on deployed URL
4. `.github/workflows/deploy.yml` — automate on push to main
5. Update `docs/DEPLOYMENT.md`

---

## Risks

- `FIRESTORE_PROJECT_ID` must be set. Cloud Run service account needs `roles/datastore.user`. Document in DEPLOYMENT.md.
- `npm run build` must produce clean `dist/` — already enforced by CI.
- `scripts/deploy.sh` requires `gcloud` CLI and `docker` — CI handles this via official GCP GitHub Actions.
