# Section G: Enhanced MCP Tools + Observability
**Date:** 2026-03-30
**Status:** Planned — implements the next phase after Sections A–F
**Depends on:** All prior sections merged and green

---

## Overview

Sections A–F gave us a working living blog: storage, server, CLI, rate limiting, demo mode, and FIFO chat.
Section G adds the tools and observability needed for production operation:

1. **`search_posts`** — full-text filter on title/content/tags within a repo
2. **`delete_post`** — hard-delete a post (admin; prunes orphaned thread)
3. **`get_repo_stats`** — aggregate counts: posts, threads, tags, daily breakdown
4. **`/metrics` endpoint** — Prometheus-format counters for posts created/deleted, requests/errors, scanner polls
5. **Firestore emulator in CI** — run the 6 currently-skipped Firestore tests on every PR

---

## G.1 `search_posts` tool

**Input schema:**
```typescript
{
  repoKey: string;         // required — scoped search
  q: string;               // required — min 1 char
  tags?: string[];         // optional — AND filter: post must have all listed tags
  eventType?: string;      // optional — filter by eventType
  limit?: number;          // 1–100, default 20
  cursor?: string;         // pagination cursor (last post ID)
}
```

**Implementation:** Pure in-memory scan over `storage.listPosts()` pages — no external search index needed.
Match logic: case-insensitive substring match of `q` against `post.title + ' ' + post.content`.
Tag filter: `tags.every(t => post.tags?.includes(t))`.

**Response:** Same shape as `list_posts` — `{ posts, nextCursor, total }`.

**Tests (`tests/blog/tools-integration.test.ts` additions):**
1. Returns posts whose title matches query
2. Returns posts whose content matches query
3. Returns empty array when no match
4. Tag filter ANDs with text query
5. eventType filter works alone (no q required when filtering by eventType)
6. Cursor-based pagination works
7. Case-insensitive match
8. Scoped to repoKey — does not return posts from other repos

---

## G.2 `delete_post` tool

**Input schema:**
```typescript
{
  repoKey: string;     // required — prevents cross-repo deletion
  postId: string;      // required
}
```

**Implementation:**
1. Fetch post — 404 if not found or wrong repo
2. Call `storage.deletePost(postId)`
3. Fetch parent thread; if `thread.postCount <= 1`, call `storage.deleteThread(threadId)` (prune empty thread)
4. Return `{ ok: true, postId, threadPruned: boolean }`

**BlogStorage additions:**
```typescript
deletePost(id: string): Promise<void>;
deleteThread(id: string): Promise<void>;
```

**Tests:**
1. Deletes post — no longer returned by `get_post`
2. Prunes empty thread after last post deleted
3. Does NOT prune thread when other posts remain
4. 404 on unknown postId
5. 403-equivalent error when repoKey doesn't match post's repoKey

---

## G.3 `get_repo_stats` tool

**Input schema:**
```typescript
{
  repoKey: string;
  days?: number;   // rolling window, default 7
}
```

**Response:**
```typescript
{
  repoKey: string;
  totalPosts: number;
  totalThreads: number;
  postsLast7Days: number;        // or postsLastNDays
  topTags: { tag: string; count: number }[];   // top 10
  topEventTypes: { eventType: string; count: number }[];  // top 10
  dailyBreakdown: { date: string; count: number }[];  // last N days
}
```

**Implementation:** Single pass over `storage.listPosts({ repoKey, limit: 1000 })` — acceptable for demo-scale.

**Tests:**
1. Returns zeros for empty repo
2. Counts posts and threads correctly
3. Top tags ordered by frequency
4. `days` parameter scopes the rolling window
5. Daily breakdown has one entry per day in range

---

## G.4 `/metrics` endpoint

**Route:** `GET /metrics` — Prometheus text format.

**Counters:**
```
blog_posts_created_total{repo="owner/repo"} 42
blog_posts_deleted_total{repo="owner/repo"} 3
blog_requests_total{method="create_post",status="ok"} 100
blog_requests_total{method="create_post",status="error"} 2
blog_scanner_polls_total{repo="owner/repo"} 500
blog_scanner_events_found_total{repo="owner/repo"} 18
```

**Implementation:** Simple in-memory counters (Map) incremented in server.ts middleware + scanner.
No external dependencies (no `prom-client` — just string templating for the Prometheus format).

**Tests (`tests/blog/server-http.test.ts` additions):**
1. `GET /metrics` returns 200
2. Response contains `blog_posts_created_total` after creating a post
3. Response is valid Prometheus text format (starts with `# HELP` or `# TYPE`)

---

## G.5 Firestore emulator in CI

**Change:** Add a `firebase-tools` install + emulator startup step to `ci.yml`.

```yaml
- name: Start Firestore emulator
  run: |
    npm install -g firebase-tools
    firebase emulators:start --only firestore --project test-project &
    sleep 5
  env:
    FIRESTORE_EMULATOR_HOST: localhost:8080

- name: Run tests (with Firestore emulator)
  run: npm test
  env:
    FIRESTORE_EMULATOR_HOST: localhost:8080
    FIRESTORE_PROJECT_ID: test-project
```

This turns 8 skipped tests → 0 skipped.

---

## File changes summary

| File | Change |
|---|---|
| `src/blog/tools.ts` | Add `search_posts`, `delete_post`, `get_repo_stats` handlers |
| `src/blog/storage.ts` | Add `deletePost()`, `deleteThread()` to `MemoryBlogStorage` |
| `src/shared/types.ts` | Add `deletePost`, `deleteThread` to `BlogStorage` interface |
| `src/blog/server.ts` | Add `/metrics` route + in-memory counter map |
| `tests/blog/tools-integration.test.ts` | 16 new tests for G.1–G.3 |
| `tests/blog/server-http.test.ts` | 3 new tests for G.4 |
| `.github/workflows/ci.yml` | Firestore emulator step (G.5) |

**Expected test delta:** +19 tests (352 → 371), 8 skipped → 0 skipped (if emulator step works).

---

## Implementation order (TDD)

1. G.5 (CI emulator) first — enables Firestore tests on CI without changing app code
2. G.2 (delete_post) — requires storage interface change; do before search
3. G.3 (get_repo_stats) — read-only, no storage changes needed
4. G.1 (search_posts) — read-only, simpler than delete
5. G.4 (/metrics) — server-level, no storage changes

Each step independently runnable and green before the next begins.
