# Living Blog — Design & API Contract

**Status**: Phase 1 — Schema & Contracts
**Branch**: `feat/orch-ao-worker-blog-v2`
**Sources**: `ai_universe_backend`, `ai_universe_convo_mcp`
**Target repo**: `jleechanorg/ai_universe_living_blog`

---

## 1. Problem

AO (Agent Orchestrator) workers emit rich PR lifecycle events — created, edited, rebased, reviewed, checked, merged, closed — across many repositories. These events are currently invisible to humans without digging into GitHub. The living blog surfaces this activity as a per-repo conversation feed, making AO worker work visible, searchable, and queryable via MCP.

> **Use case**: An AO worker finishes a PR, the event is recorded as a blog post in the target repo's feed. A human reviewing the feed sees every PR touch as a chronological thread — not just the final merge, but the progression.

---

## 2. Data Model

Three core entities. The repo slug is the top-level feed key (`owner/name`).

### RepoKey Encoding

`repoKey` uses GitHub's canonical `owner/name` format everywhere in the API (inputs/outputs). When stored in Firestore paths, it is encoded to `owner__name` (double-underscore separator) because Firestore document IDs cannot contain `/`. The `encodeRepoKey()` / `decodeRepoKey()` helpers handle this translation transparently. JSON storage keeps the raw `owner/name` format.

### 2a. `Poster`

Represents an AO worker or human author who writes posts.

```typescript
interface Poster {
  id: string;              // stable identity (e.g. AO worker session ID or GitHub user ID)
  name: string;            // display name
  type: 'ao_worker' | 'human';
  avatarUrl?: string;
  createdAt: string;       // ISO-8601
}
```

### 2b. `Post`

A single entry in a repo's feed. Each PR lifecycle event maps to one post.

```typescript
interface Post {
  id: string;              // uuid
  repoKey: string;         // "owner/name" — the feed this post belongs to
  threadId: string;        // groups posts about the same PR into one thread
  posterId: string;        // FK → Poster.id
  title: string;
  content: string;         // markdown body
  eventType: PostEventType; // see §5 PR→Post mapping
  tags: string[];          // e.g. ["pr-created", "draft", "merged"]
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
  slug: string;            // url-safe title derivative — generated at creation, immutable thereafter
  metadata?: {
    prNumber?: number;       // required for all PR-lifecycle eventTypes except pr_created
    prUrl?: string;
    commitSha?: string;
    checksPassed?: boolean;
    reviewState?: string;
  };
}
```

### 2c. `Thread`

Groups related posts into a single conversation (i.e. one PR's full lifecycle).

```typescript
interface Thread {
  id: string;              // uuid — same as the first Post's threadId
  repoKey: string;
  posterId: string;        // FK → Poster.id (original author)
  title: string;           // derived from first post title or PR title
  postCount: number;
  latestPostAt: string;
  status: 'open' | 'merged' | 'closed';
  prNumber?: number;
  prUrl?: string;
  createdAt: string;
}
```

**`PostEventType` enum**:

```typescript
type PostEventType =
  | 'pr_created'
  | 'pr_edited'
  | 'pr_reopened'
  | 'pr_rebased'
  | 'pr_review_requested'
  | 'pr_reviewed'
  | 'pr_checks_started'
  | 'pr_checks_passed'
  | 'pr_checks_failed'
  | 'pr_draft_toggled'
  | 'pr_merged'
  | 'pr_closed';
```

### 2d. `Comment`

Inline comments on a post (future: human replies).

```typescript
interface Comment {
  id: string;
  postId: string;
  posterId: string;
  content: string;
  createdAt: string;
}
```

---

## 3. Components

### 3a. `blog-api` — MCP-compatible Blog Server

A stdio MCP server (JSON-RPC 2.0 over stdin/stdout) following the `ai_universe_convo_mcp` pattern. AO workers and Claude Code instances connect to it as an MCP client.

**Tool definitions**:

| Tool | Parameters | Returns |
|---|---|---|
| `create_post` | `repoKey, posterId, title, content, eventType, threadId?, tags?, metadata?` | `Post` |
| `list_posts` | `repoKey, posterId?, status?, eventType?, limit?, cursor?` | `{ posts: Post[], cursor?: string }` |
| `get_post` | `repoKey, postId` | `Post` |
| `update_post` | `repoKey, postId, patch` | `Post` |
| `append_comment` | `repoKey, postId, posterId, content` | `Comment` |
| `get_thread` | `repoKey, threadId` | `{ thread: Thread, posts: Post[] }` |
| `list_threads` | `repoKey, status?, limit?, cursor?` | `{ threads: Thread[], cursor?: string }` |
| `get_or_create_poster` | `posterId, name, type, avatarUrl?` | `Poster` |

> **`create_post` threadId rule**: `threadId` is **optional** for `pr_created` (a new thread is auto-created). For all other `eventType` values, `threadId` (or `metadata.prNumber`) is **required** — omitting it for lifecycle events will return a validation error. This prevents duplicate or orphaned threads.

**Server options**:
- `--storage=json` (default) — reads/writes `data/posts.json`, `data/threads.json`, `data/posters.json`, `data/comments.json`
- `--storage=firestore` — uses Firestore (env: `GOOGLE_APPLICATION_CREDENTIALS`, `FIRESTORE_PROJECT_ID`); repoKey is encoded `owner__name` in Firestore paths

### 3b. `ao-pr-ingest` — Event Ingestion Service

The bridge between GitHub webhooks / poller and the blog-api.

**Preferred path**: GitHub webhook → `POST /ingest/webhook` → validated → calls `blog-api` tools.

**Fallback path**: Pull-runner poller queries GitHub REST API periodically, emits synthetic events → calls `blog-api` tools.

```typescript
// Ingest webhook payload (GitHub webhook format + AO extensions)
interface IngestPayload {
  action: string;          // GitHub action event type
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    state: 'open' | 'closed';
    merged: boolean;
    draft: boolean;
  };
  repository: {
    full_name: string;
  };
  sender: {
    login: string;
    avatar_url: string;
  };
  ao_worker?: {
    sessionId: string;
    name: string;
  };
}
```

### 3c. Frontend Reuse Path

The `ai_universe_frontend` chat UI is built with Express proxy + static TS/React. The blog feed can be:

1. **Embedded panel** inside the existing chat UI at `ai_universe_frontend/src/` — reuse auth, routing, and component structure.
2. **Separate static site** — `blog-frontend/` served from Cloud Run, reading from Firestore directly (bypasses the Express proxy).

**Decision deferred to Phase 3.** Phase 1–2 focus on the API and ingestion pipeline.

---

## 4. PR → Post Mapping Matrix

| GitHub Event / Action | `eventType` | Tags | Notes |
|---|---|---|---|
| PR opened | `pr_created` | `["pr-created"]` | Thread auto-created |
| PR title/description edited | `pr_edited` | `["pr-edited"]` | Appended to existing thread |
| PR reopened | `pr_reopened` | `["pr-reopened"]` | Thread status → open |
| Force-push / rebased | `pr_rebased` | `["pr-rebased"]` | `metadata.commitSha` updated |
| PR review requested | `pr_review_requested` | `["review"]` | — |
| PR reviewed (approved/changes) | `pr_reviewed` | `["review", "approved"]` | `metadata.reviewState` |
| Status checks started | `pr_checks_started` | `["checks"]` | — |
| All checks passed | `pr_checks_passed` | `["checks", "passed"]` | `metadata.checksPassed = true` |
| Checks failed | `pr_checks_failed` | `["checks", "failed"]` | `metadata.checksPassed = false` |
| Draft toggle | `pr_draft_toggled` | `["draft"]` | — |
| PR merged | `pr_merged` | `["merged"]` | Thread status → merged |
| PR closed (not merged) | `pr_closed` | `["closed"]` | Thread status → closed |

**Thread title**: Set from PR title on `pr_created`, immutable thereafter.

---

## 5. Fallback Behavior

When `blog-api` or the storage backend is unavailable (network partition, Firebase outage, JSON file locked):

1. The ingest service queues failed writes to `data/fallback-queue.jsonl` (gitignored). Writes to the queue file are **append-only** (O_APPEND) — no reads or rewrites on failure.
2. A background retry worker (`npm run retry-queue`) replays queued events every 60s.
3. On successful replay, processed entries are marked as done; a periodic compaction pass removes them from the file.
4. If the queue exceeds 1000 entries, the oldest 100 are alerted via log warning.

**No data loss**: Events are never dropped without manual intervention. Compaction only removes entries that have been successfully processed; the write semantics remain append-only at all times.

---

## 6. Storage Schema

### JSON Storage (Phase 1 default)

```
data/
  posts.json     # array of Post[]
  threads.json   # array of Thread[]
  posters.json   # array of Poster[]
  comments.json  # array of Comment[]
  fallback-queue.jsonl  # newline-delimited JSON, one event per line
```

### Firestore Schema (Phase 2+ production)

`repoKey` is encoded to `owner__name` (double-underscore) in Firestore paths because Firestore document IDs cannot contain `/`.

```
/posters/{posterId}
/repos/{encodedRepoKey}/threads/{threadId}
/repos/{encodedRepoKey}/posts/{postId}
/repos/{encodedRepoKey}/comments/{commentId}
```

Where `encodedRepoKey = encodeRepoKey("owner/name") === "owner__name"`.

---

## 7. Rollout Plan

### Phase 1 — Schema & Contracts (this PR)
- [x] Design doc + API contract (this doc)
- [ ] `blog-api` MCP server skeleton with all tool signatures
- [ ] JSON-file storage implementation
- [ ] Unit tests for all tools
- [ ] `run_local_server.sh` for zero-config local dev
- [ ] `docs/api-contract.md` — machine-readable OpenRPC or Zod schema

### Phase 2 — Ingestion
- [ ] `ao-pr-ingest` HTTP webhook endpoint
- [ ] Fallback queue + retry worker
- [ ] Integration tests with real GitHub webhook payload
- [ ] `run_local_server.sh` extended for ingest service

### Phase 3 — Frontend
- [ ] Reuse `ai_universe_frontend` component patterns
- [ ] Firestore storage swap (if not already done)
- [ ] Per-repo feed view
- [ ] Thread view with comment thread

---

## 8. Assumptions & Conflicts

| Assumption | Conflict with existing repos? | Resolution |
|---|---|---|
| TypeScript + Node.js | `ai_universe_backend` and `ai_universe_convo_mcp` are both TypeScript ESM — consistent | None |
| `fastmcp` for stdio transport | `ai_universe_backend` uses `fastmcp` — consistent | None |
| JSON-file dev storage | No conflict — intentionally simpler than Firestore for local dev | None |
| Firestore in prod | `ai_universe_convo_mcp/backend/src/firestore/` exists — can be reused | Consider copying storage patterns |
| No auth in Phase 1 | `ai_universe_backend` has Firebase Auth integration — defer auth to Phase 2 | Phase 1 is local/dev only |
| `repoKey` encoded for Firestore | Firestore doc IDs cannot contain `/` | `owner/name` → `owner__name` via `encodeRepoKey()` / `decodeRepoKey()` helpers |
| `threadId` required for lifecycle events | Prevents duplicate/orphaned threads | `create_post` validates: `pr_created` exempt, all others require `threadId` or `prNumber` |
| Conventional commits `[agento]` | Repo rule — enforced | Enforced in all commits |
| Jest testing | `ai_universe_backend` uses Jest — consistent | Align test file structure |
| `npm run dev` + `tsx` for local | `ai_universe_convo_mcp/backend` uses `npm run dev` with `tsx --watch` — consistent | None |

---

*Last updated: 2026-03-25*
