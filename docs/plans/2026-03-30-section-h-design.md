# Section H: CLI Read Commands + Post Export + Webhook Replay
**Date:** 2026-03-30
**Status:** Planned — implements the next phase after Section G
**Depends on:** Section G (PR #37) merged to main

---

## Overview

Section G gave us admin tools (delete, stats, search) and observability (/metrics).
Section H adds the operator CLI surface and data portability needed for production use:

1. **`blog-cli list`** — list posts in a repo from the CLI
2. **`blog-cli get`** — fetch a single post by ID from the CLI
3. **`blog-cli search`** — full-text search from the CLI (wraps `search_posts` tool)
4. **`blog-cli stats`** — show repo stats from the CLI (wraps `get_repo_stats` tool)
5. **`export_repo` MCP tool** — dump all posts + threads for a repo as JSON
6. **`replay_event` MCP tool** — re-process a stored webhook event (for debugging/recovery)

---

## H.1 `blog-cli list` command

**Usage:**
```
blog-cli list --repo owner/repo [--limit 20] [--cursor <id>] [--event-type pr_created]
```

**Implementation:** POST to `/mcp` → `list_posts` tool, render as table or JSON.
- Default output: table with columns `ID | eventType | title | createdAt`
- `--json` flag: raw JSON output

**Routing in main.ts:** Add `case 'list':` to the switch.

**Tests (`tests/cli/list-get-search.test.ts`):**
1. `list` with empty repo returns `[]`
2. `list` after creating posts returns correct rows
3. `--event-type` filter narrows results
4. `--limit` is respected
5. `--json` flag outputs raw JSON

---

## H.2 `blog-cli get` command

**Usage:**
```
blog-cli get --repo owner/repo --post-id <id>
```

**Implementation:** POST to `/mcp` → `get_post` tool, render as JSON.

**Tests (`tests/cli/list-get-search.test.ts`):**
6. `get` returns correct post for known ID
7. `get` returns error message for unknown ID

---

## H.3 `blog-cli search` command

**Usage:**
```
blog-cli search --repo owner/repo --q "keyword" [--tags tag1,tag2] [--limit 10]
```

**Implementation:** POST to `/mcp` → `search_posts` tool (from Section G), render as table.

**Tests (`tests/cli/list-get-search.test.ts`):**
8. `search` returns matching posts
9. `search` returns empty for no match
10. `--tags` filter works

---

## H.4 `blog-cli stats` command

**Usage:**
```
blog-cli stats --repo owner/repo [--days 7]
```

**Implementation:** POST to `/mcp` → `get_repo_stats` tool (from Section G), render as table.

**Output example:**
```
Repo:            owner/repo
Total posts:     42
Total threads:   12
Posts last 7d:   8
Top tags:        pr_created(12), pr_merged(9), novel_branch_entry(6)
```

**Tests (`tests/cli/list-get-search.test.ts`):**
11. `stats` shows zeros for empty repo
12. `stats` shows correct counts after creating posts

---

## H.5 `export_repo` MCP tool

**Input schema:**
```typescript
{
  repoKey: string;      // required
  format?: 'json';      // default: json (future: csv)
  includeThreads?: boolean;  // default: true
}
```

**Response:**
```typescript
{
  repoKey: string;
  exportedAt: string;     // ISO timestamp
  postCount: number;
  threadCount: number;
  data: {
    posts: Post[];
    threads: Thread[];
  };
}
```

**Implementation:** Single pass over `storage.listPosts({ repoKey, limit: 1000 })` + `storage.listThreads({ repoKey, limit: 1000 })`. Returned as JSON in MCP tool result content.

**Tests (`tests/blog/tools-integration.test.ts` additions):**
1. Returns all posts and threads for a repo
2. Does not return posts from other repos
3. `includeThreads: false` omits threads

---

## H.6 `replay_event` MCP tool

**Purpose:** Re-process a stored webhook event. Useful when a webhook fired but blog was down, or for testing event routing.

**Input schema:**
```typescript
{
  repoKey: string;
  eventType: string;      // e.g., 'pr_created', 'pr_merged', 'pr_checks_passed'
  prNumber: number;
  sessionId?: string;     // defaults to 'replay'
  title?: string;         // override generated title
  content?: string;       // override generated content
}
```

**Implementation:** Calls the same internal `create_post` logic directly — just a thin wrapper that:
1. Validates repoKey is registered
2. Calls `storage.createPost(...)` with the given params
3. Returns `{ ok: true, postId, replayed: true }`

**Tests (`tests/blog/tools-integration.test.ts` additions):**
4. Replayed event creates a post
5. Replay with unknown repoKey returns error

---

## File changes summary

| File | Change |
|---|---|
| `src/cli/main.ts` | Add `list`, `get`, `search`, `stats` command handlers |
| `src/blog/tools.ts` | Add `export_repo`, `replay_event` handlers |
| `tests/cli/list-get-search.test.ts` | 12 new CLI tests |
| `tests/blog/tools-integration.test.ts` | 5 new tool tests |

**Expected test delta:** +17 tests (379 → 396), 0 new skips.

---

## Implementation order (TDD)

1. H.5 (`export_repo`) — simplest new tool, no CLI changes
2. H.6 (`replay_event`) — thin wrapper
3. H.1–H.4 (CLI commands) — all share the same test file, implement in one go

Each step independently runnable and green before the next begins.
