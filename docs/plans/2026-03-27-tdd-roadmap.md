# TDD Roadmap — Living Blog Refactor
**Date:** 2026-03-27
**Based on:** `docs/plans/2026-03-27-living-blog-refactor-design.md`
**Implementation order:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Each phase is independently runnable and green before the next begins. All tests use Vitest.

---

## Phase 1: GitHubClient unit tests

**Goal:** `GitHubClient` is the shared engine for both CLI and MCP AutoScanner. Test it thoroughly before building on top.

### Test file: `tests/shared/github-client.test.ts`

**What it tests:** `src/shared/github-client.ts` (moved from `src/blog/github-client.ts`)

**Mocks:** `@octokit/rest` — mock the `Octokit` class and its `rest` sub-methods.

**Tests:**

| # | Test name | What it verifies | Mock data |
|---|---|---|---|
| 1 | `getPREvents: returns formatted events` | `listRepoEvents` → maps to `GHActivityEvent[]` with id, type, repo, createdAt, payload | Mock 3 events: `PullRequestEvent`, `CheckRunEvent`, `ReviewEvent` |
| 2 | `getPREvents: maps pr action=opened to pr_created` | `action: 'opened'` → `postType === 'pr_created'` | Single `PullRequestEvent` with `action: 'opened'` |
| 3 | `getPREvents: maps pr action=closed+merged to pr_merged` | `action: 'closed'`, `merged: true` → `postType === 'pr_merged'` | Single `PullRequestEvent` with merged PR |
| 4 | `getPREvents: maps check conclusion=success to pr_checks_passed` | `conclusion: 'success'` → `postType === 'pr_checks_passed'` | Single `CheckRunEvent` with `conclusion: 'success'` |
| 5 | `getPREvents: unknown action returns null` | `action: 'labeled'` → `postType === null` | `PullRequestEvent` with `action: 'labeled'` |
| 6 | `getPRDetails: returns GHPullRequest shape` | `getPRDetails(1)` calls correct endpoint, returns `{ number, title, state, merged, url }` | Mock `pulls.get` response |
| 7 | `getCommits: returns GHCommit[] with sha, message, author, date` | `getCommits(1)` calls `pulls.listCommits`, returns correctly shaped array | Mock 2 commits |
| 8 | `getCheckRuns: returns check runs for a ref` | `getCheckRuns('abc123')` calls `checks.listForRef`, returns runs | Mock 3 check runs |
| 9 | `getReviews: returns reviews for a PR` | `getReviews(1)` calls `pulls.listReviews`, returns reviews | Mock 2 reviews |
| 10 | `listRecentActivity: maps paginated response` | `listRecentActivity('owner','repo')` returns `{ events, nextCursor }` | Mock paginated response |
| 11 | `constructor: uses token in auth if provided` | `new GitHubClient('tok123')` → `Octokit` instantiated with `auth: 'tok123'` | — |
| 12 | `constructor: works without token (public API)` | `new GitHubClient()` → `Octokit` with no auth | — |

**Pass condition:** All 12 tests pass. `npx vitest run tests/shared/github-client.test.ts`

**Why first:** Both CLI and AutoScanner depend on this class. Bugs here cascade.

---

## Phase 2: CLI unit tests

**Goal:** Test the CLI argument parser and command routing without touching GH API or the file system.

### Test file: `tests/cli/parser.test.ts`

**What it tests:** `src/cli/main.ts` — argument parsing, command routing, env var reading

**Mocks:** `src/shared/github-client.ts` (entire module), `src/novel/engine.ts` (pipeline), `fs` (file writes)

**Tests:**

| # | Test name | What it verifies |
|---|---|---|
| 1 | `branch-entry: parses required --session --pr --repo` | `parseArgs(['branch-entry', '--session', 'ao-832', '--pr', '42', '--repo', 'owner/repo'])` returns correct `{ command, session, pr, repo }` |
| 2 | `branch-entry: parses --sha flag` | `--sha abc123` → `{ sha: 'abc123' }` |
| 3 | `branch-entry: parses --output flag` | `--output=both` → `{ output: 'both' }` |
| 4 | `branch-entry: errors on missing --session` | Missing `--session` → throws with message mentioning `--session` |
| 5 | `branch-entry: errors on missing --pr` | Missing `--pr` → throws |
| 6 | `branch-entry: errors on missing --repo` | Missing `--repo` → throws |
| 7 | `branch-entry: accepts --pr=42 (equals form)` | `--pr=42` parsed correctly |
| 8 | `daily-summary: parses required --repo` | `--repo owner/repo` → `{ command: 'daily-summary', repo: 'owner/repo' }` |
| 9 | `daily-summary: parses --date flag` | `--date 2026-03-27` → `{ date: '2026-03-27' }` |
| 10 | `chat: parses --worker --message --repo` | All three → correct shape |
| 11 | `chat: errors on missing --worker` | Missing `--worker` → throws |
| 12 | `config --show: returns config object` | Returns merged config (defaults + env) |
| 13 | `unknown command: errors with usage` | `['foobar']` → throws with usage hint |
| 14 | `env var BLOG_SERVER_URL overrides default` | `BLOG_SERVER_URL=http://foo:9999` → parsed as mcpUrl |

### Test file: `tests/cli/gh-client-integration.test.ts`

**What it tests:** CLI's use of `GitHubClient` for `branch-entry`

**Mocks:** `GitHubClient` — mocked to return deterministic GH event data without real API calls.

**Tests:**

| # | Test name | What it verifies |
|---|---|---|
| 1 | `branch-entry: calls GitHubClient.getPREvents with correct args` | `GitHubClient.getPREvents` called with owner, repo, pr number from args |
| 2 | `branch-entry: calls GitHubClient.getPRDetails` | `GitHubClient.getPRDetails` called after getPREvents |
| 3 | `branch-entry: calls GitHubClient.getCommits` | `GitHubClient.getCommits` called |
| 4 | `branch-entry: skips if no events returned` | Returns early, writes nothing |
| 5 | `branch-entry: generates entry if events exist` | Pipeline is called with mapped events |
| 6 | `branch-entry: GITHUB_TOKEN missing → errors` | No `GITHUB_TOKEN` env var → throws with helpful message |

**Pass condition:** All tests pass. `npx vitest run tests/cli/`

---

## Phase 3: MCP server — JSON-RPC + tools integration tests

**Goal:** Test the full HTTP request → JSON-RPC dispatch → tool → response pipeline using supertest + in-memory storage.

### Test file: `tests/blog/server-http.test.ts`

**What it tests:** `src/blog/server.ts` — HTTP transport layer, JSON-RPC dispatch, rate limiting

**Setup:** Start Express app via `createBlogApp()` in test, use supertest to hit real HTTP.

**Tests:**

| # | Test name | What it verifies |
|---|---|---|
| 1 | `POST /mcp: health_check returns ok` | `{ jsonrpc, method: 'health_check', id: 1 }` → `200` with `{ result: { status: 'ok', ... } }` |
| 2 | `POST /mcp: unknown method returns error` | `{ method: 'nonexistent_method' }` → `200` with `jsonrpc error -32601` |
| 3 | `POST /mcp: missing id returns error` | Request without `id` → `200` with `jsonrpc error -32600` |
| 4 | `POST /mcp: malformed JSON → 400` | Non-JSON body → `400` |
| 5 | `GET /health: returns 200` | GET /health → `200` |
| 6 | `rate limit: 101 requests/min → 429` | Send 101 requests in 1 min → `429` with `Retry-After` header |
| 7 | `rate limit: chat_worker 11/min → 429` | 11 `chat_worker` calls in 1 min → `429` |

### Test file: `tests/blog/tools-integration.test.ts`

**What it tests:** Each MCP tool via `createBlogToolHandlers` with `MemoryBlogStorage`

**Tests:**

| # | Test name | What it verifies |
|---|---|---|
| 1 | `create_post: creates post + thread for pr_created` | `create_post` with `eventType: 'pr_created'` → post created + thread auto-created |
| 2 | `create_post: creates thread for novel_branch_entry` | `eventType: 'novel_branch_entry'` → thread auto-created |
| 3 | `create_post: reuses existing thread when threadId provided` | With `threadId` → post linked, thread unchanged |
| 4 | `get_post: returns post by id` | `get_post` with known ID → correct post |
| 5 | `get_post: returns error for unknown id` | Unknown ID → error response |
| 6 | `list_posts: filters by repoKey` | Two repos → correct filtering |
| 7 | `list_posts: filters by eventType` | `eventType: 'pr_merged'` → only merged posts |
| 8 | `list_posts: filters by posterId` | `posterId: 'ao-826'` → only that poster's posts |
| 9 | `list_posts: cursor pagination works` | First page of 2 → nextCursor present; second page continues |
| 10 | `update_post: updates title and status` | Update → post reflects new values |
| 11 | `update_post: cannot update non-existent post` | Unknown postId → error |
| 12 | `get_thread: returns thread with posts sorted by createdAt` | Thread posts are in chronological order |
| 13 | `get_thread: scoped by repoKey` | Thread from repo A → not returned when querying repo B |
| 14 | `list_threads: filters by repoKey` | Only threads for the requested repo |
| 15 | `chat_worker: calls OPENCLAW_INFERENCE_URL when set` | Mock HTTP POST to inference URL, returns response |
| 16 | `chat_worker: calls Anthropic when ANTHROPIC_API_KEY set and OPENCLAW_INFERENCE_URL absent` | Mock Anthropic API → returns response |
| 17 | `chat_worker: regex-only fallback when no inference backend set` | No `ANTHROPIC_API_KEY` or `OPENCLAW_INFERENCE_URL` → deterministic response via voice extraction |
| 18 | `register_repo: adds repo to registry` | `register_repo` → repo appears in `list_repos` |
| 19 | `register_repo: duplicate repo → error` | Same repo registered twice → error |
| 20 | `unregister_repo: removes repo` | After unregister → not in `list_repos` |
| 21 | `update_repo: changes enabled mode` | `update_repo({ enabled: false })` → reflects in `list_repos` |

**Pass condition:** All tests pass. `npx vitest run tests/blog/`

---

## Phase 4: CLI ↔ MCP integration test (E2E smoke)

**Goal:** End-to-end test: CLI generates a branch entry and posts it to the MCP server.

### Test file: `tests/cli-mcp-e2e.test.ts`

**What it tests:** Full `blog-cli branch-entry` → MCP server → storage pipeline

**Setup:** Start MCP server on random port. Use `MemoryBlogStorage`. Set `BLOG_SERVER_URL`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY` in test env.

**Mocks:**
- `GitHubClient` returns deterministic PR data (opened PR, 3 commits, checks passed, merged)
- `WorkerChat` is not mocked in this test (or is mocked for speed)

**Tests:**

| # | Test name | What it verifies |
|---|---|---|
| 1 | `branch-entry: writes file to novel/workers/` | `novel/workers/ao-832.md` exists after run, non-empty |
| 2 | `branch-entry: file contains sessionId` | File content includes `ao-832` |
| 3 | `branch-entry: --output=none skips file write` | File not created |
| 4 | `branch-entry: --output=both → MCP post created` | `list_posts` shows post with `eventType: 'novel_branch_entry'` |
| 5 | `branch-entry: MCP post has correct metadata` | Post has `posterId === 'ao-832'`, `repoKey === 'owner/repo'` |
| 6 | `branch-entry: MCP unreachable → still writes file` | Server down → file still created, no crash |
| 7 | `daily-summary: generates collective entry` | `daily-summary` → file with 1000+ words |
| 8 | `daily-summary: date filter works` | Only posts from that date are used |
| 9 | `chat: posts message to worker, returns response` | `chat_worker` called → response returned |

**Pass condition:** All 9 tests pass. `npx vitest run tests/cli-mcp-e2e.test.ts`

---

## Phase 5: FIFO chat integration tests

### Test file: `tests/fifo/chat-fifo.test.ts`

**What it tests:** `src/novel/chat.ts` — FIFO fallback chain

**Mocks:** `fs` (FIFO operations), `WorkerChat` (Anthropic fallback)

**Tests:**

| # | Test name | What it verifies |
|---|---|---|
| 1 | `FIFO exists → writes message, reads reply` | `WorkerChat.chat` called with FIFO message written first |
| 2 | `FIFO exists, no reply in 5s → WorkerChat fallback` | FIFO write + 5s timeout → `WorkerChat.chat` called |
| 3 | `FIFO absent → WorkerChat directly` | `WorkerChat.chat` called, no FIFO attempted |
| 4 | `FIFO malformed reply → WorkerChat fallback` | Valid FIFO but non-JSON reply → fallback |
| 5 | `FIFO reply JSON valid → returned as response` | `{ "from": "worker", "response": "..." }` → returned directly |

**Pass condition:** All tests pass. `npx vitest run tests/fifo/`

---

## Implementation order summary

```
Phase 1  tests/shared/github-client.test.ts         (9 tests)
           ↓
Phase 2  tests/cli/parser.test.ts                   (14 tests)
         tests/cli/gh-client-integration.test.ts    (6 tests)
           ↓
Phase 3  tests/blog/server-http.test.ts             (7 tests)
         tests/blog/tools-integration.test.ts       (21 tests)
           ↓
Phase 4  tests/cli-mcp-e2e.test.ts                 (9 tests)
           ↓
Phase 5  tests/fifo/chat-fifo.test.ts              (5 tests)
```

**Total: ~65 tests across 7 files.**

Each phase should be green before the next begins. If a later phase fails, fix in that phase's test file (not by changing earlier phases' passing tests).

---

## Mock strategy

| Dependency | Mock approach |
|---|---|
| `@octokit/rest` | `vi.mock('@octokit/rest')` — mock `Octokit` class |
| `GitHubClient` | `vi.mock('../shared/github-client.js')` — used in CLI tests |
| `fs` / FIFO | `vi.mock('node:fs')` with `vi.spyOn` for read/write |
| `WorkerChat` | `vi.mock('../novel/chat.js')` — mock `chat()` method |
| `BlogStorage` | Use `MemoryBlogStorage` (real implementation, no mock needed) |
| `Anthropic API` | `vi.mock('../novel/chat.js')` — mock `callAnthropic` |
| `Express app` | supertest on real `createBlogApp()` with test storage |

---

## Running tests

```bash
# All tests
npx vitest run

# Per phase
npx vitest run tests/shared/github-client.test.ts
npx vitest run tests/cli/
npx vitest run tests/blog/
npx vitest run tests/cli-mcp-e2e.test.ts
npx vitest run tests/fifo/

# With coverage
npx vitest run --coverage
```
