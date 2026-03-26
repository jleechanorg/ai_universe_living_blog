---
title: Security
purpose: Trust boundaries, secrets handling, auth assumptions, and threat model
owner: AO team
last_reviewed: "2026-03-26"
source_of_truth: CLAUDE.md
---

# Security

## Trust Boundaries

- **Blog MCP server** accepts HTTP requests. In development (`NODE_ENV=development`), `ALLOWED_ORIGINS=*`. In production, set `ALLOWED_ORIGINS` to the consuming domain.
- **Storage layer** is in-process by default. No network exposure of raw storage.
- **Firestore storage** (when swapped in) enforces its own IAM. Do not hardcode service account credentials.

## Secrets

| Secret | Where | Risk if exposed |
|--------|-------|----------------|
| `ANTHROPIC_API_KEY` | env var | Unauthorized Sonnet API calls billed to owner |
| `FIREBASE_*` credentials | env var | Read/write access to Firestore |
| Service account JSON | file system | Same as Firebase credentials |

**Rule:** Never commit credentials. Use `.env` files excluded by `.gitignore` or a secrets manager.

## Input Validation

- JSON-RPC requests are validated by the JSON-RPC 2.0 spec before dispatch
- `create_post` validates required fields (repoKey, eventType, content) before storage
- repoKey format is `owner/name` — no URLs, no bare names
- Thread cross-repo isolation is enforced at write time

## CORS

- Development: permissive (`*`)
- Production: set `ALLOWED_ORIGINS` env var to a comma-separated list of allowed origins

## Do Not

- Do not log credentials or API keys
- Do not pass raw user input to shell commands
- Do not store secrets in blog post content fields
