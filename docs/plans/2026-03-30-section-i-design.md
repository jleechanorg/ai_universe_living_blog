# Section I: Webhook Idempotency + Optional Auth Enforcement
**Date:** 2026-03-30
**Status:** Planned — implements production-hardening after Section H
**Depends on:** Section H (PR #38) merged to main

---

## Overview

Section H gave us CLI read commands and data export tools.
Section I adds production-hardening:

1. **Webhook idempotency** — deduplicate posts by `X-GitHub-Delivery` ID; same delivery replayed twice creates only one post
2. **Optional API key auth** — when `AUTH_API_KEY` env var is set, all MCP tool calls require `X-API-Key` header; when unset, server remains open (current behavior)

---

## I.1 Webhook idempotency

**Problem:** GitHub retries webhook delivery on failure. Without deduplication, the same PR event creates multiple duplicate posts.

**Implementation:**
- Add `deliveryId?: string` to the `Post` type in `src/shared/types.ts`
- In `src/blog/webhook.ts`, before calling `create_post`, check if a post with the same `deliveryId` already exists via `storage.listPosts({ repoKey, limit: 100 })`
- If duplicate found: return `{ ok: true, postId: existingPost.id, duplicate: true }` (200, idempotent)
- Store `deliveryId` on the post as a tag: `webhook:delivery:<deliveryId>`

**No storage interface change needed** — uses existing `listPosts` + tag search.

**Tests (`tests/blog/webhook.test.ts` additions):**
1. Second delivery with same `X-GitHub-Delivery` ID → 200 but no new post created
2. Second delivery returns `duplicate: true` in response body
3. Different delivery IDs for same event type → two separate posts created
4. Delivery ID stored as tag on created post

---

## I.2 Optional X-API-Key auth enforcement

**Environment variable:** `AUTH_API_KEY` — when set, all `POST /mcp` requests must include `X-API-Key: <value>`. `GET` routes (`/health`, `/`, `/mcp`, `/metrics`) remain unauthenticated.

**Implementation in `src/blog/server.ts`:**
```typescript
// Middleware: enforce API key on POST /mcp when AUTH_API_KEY is configured
if (process.env.AUTH_API_KEY) {
  app.use('/mcp', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const key = req.headers['x-api-key'];
    if (key !== process.env.AUTH_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized', code: 401 });
    }
    next();
  });
}
```

**`createBlogApp` option:** Accept `authApiKey?: string` in options (for testing without env var).

**Tests (`tests/blog/server-http.test.ts` additions):**
5. When `AUTH_API_KEY` set and correct key sent → 200 OK
6. When `AUTH_API_KEY` set and wrong key sent → 401
7. When `AUTH_API_KEY` set and no key sent → 401
8. GET /health unauthenticated even when `AUTH_API_KEY` set → 200
9. When `AUTH_API_KEY` not set → POST /mcp without key → 200 (open server, existing behavior)

---

## File changes summary

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `deliveryId?: string` to `Post` type |
| `src/blog/webhook.ts` | Add deduplication check before create_post |
| `src/blog/server.ts` | Add optional auth middleware + `authApiKey` option |
| `tests/blog/webhook.test.ts` | 4 new idempotency tests |
| `tests/blog/server-http.test.ts` | 5 new auth tests |

**Expected test delta:** +9 tests (400 → 409), 0 new skips.

---

## Implementation order (TDD)

1. I.1 (webhook idempotency) — no interface changes, just webhook.ts logic
2. I.2 (auth middleware) — server.ts only, clean and isolated

Each step independently runnable and green before the next begins.
