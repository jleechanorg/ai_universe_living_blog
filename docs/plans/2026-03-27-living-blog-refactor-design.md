# Living Blog Refactor — Design Document
**Date:** 2026-03-27
**Branch:** `session/aub-11`
**Status:** Draft — for CodeRabbit review

---

## Context

The living blog repo needs to support two distinct usage paths:

- **Path A (AO workers):** CLI generates branch entries at session/PR boundaries; workers don't run the MCP server. Novel entries are written to `novel/workers/{sessionId}.md` and optionally posted to MCP.
- **Path B (non-AO repos):** MCP server is the primary interface. Workers register repos, post events, chat with fictional workers, and read the blog via MCP tools.
- **Path C (bidirectional chat):** Workers that expose a FIFO at `~/.blog/inbox/{sessionId}` get true bidirectional chat; others fall back to simulated post-hoc responses.

---

## A. CLI Design

### Directory structure

```
src/
├── cli/           # CLI entry point (new)
│   ├── main.ts    # CLI argument parser + command router
│   └── gh-client.ts # GH REST API client for CLI (reuses GitHubClient from shared/)
├── blog/          # MCP server (existing from PR #19)
├── novel/         # Novel engine (existing)
└── shared/       # Shared types, logger, GitHubClient (existing)
```

The CLI is invoked as `blog-cli` (renamed from `npm run dev:novel --`):

```bash
blog-cli branch-entry --session ao-832 --pr 42 --repo owner/repo
blog-cli daily-summary --repo owner/repo --date 2026-03-27
blog-cli chat --worker ao-832 --message "What was the hardest part?" --repo owner/repo
```

### Commands

#### `branch-entry` — self-sufficient, fetches GH events directly

```bash
blog-cli branch-entry --session ao-832 --pr 42 --repo owner/repo [--sha abc123] [--output=file]
```

**The CLI owns the full data pipeline.** Given only `--session`, `--pr`, `--repo`, it:

1. Reads `GITHUB_TOKEN` env var (required)
2. Fetches PR events via GitHub REST API (pull request events, check runs, reviews, commits)
3. Decides what to generate: branch entry, milestone note, or no-op
4. Runs the novel pipeline (raw generation + optional editor pass)
5. Writes `novel/workers/{sessionId}.md`
6. If `BLOG_SERVER_URL` is set: POSTs to MCP server

**Parameters:**

| Flag | Required | Description |
|---|---|---|
| `--session` | yes | Worker session ID (e.g. `ao-832`) |
| `--pr` | yes | PR number (integer) |
| `--repo` | yes | `owner/repo` |
| `--sha` | no | Specific commit SHA to anchor the entry |
| `--output` | no | `file` (default) / `both` / `none` |
| `--voice` | no | `workers` (default) / `agents` / `minimal` |
| `--config` | no | Path to `novel.config.json` |

**Output flow:**
1. `GitHubClient.getPREvents()` fetches all events for the PR
2. `GitHubClient.getPRDetails()` fetches PR title, body, author, branch
3. `GitHubClient.getCommits()` fetches commit list for the PR
4. `GitHubClient.getCheckRuns()` fetches CI check runs
5. `GitHubClient.getReviews()` fetches review events
6. Pipeline decides: generate entry? skip (already generated)?
7. Write `novel/workers/{sessionId}-{YYYY-MM-DD}.md` (always, unless `--output=none`)
8. If `BLOG_SERVER_URL` set: `create_post` via HTTP POST

#### `daily-summary`

```bash
blog-cli daily-summary --repo owner/repo [--date 2026-03-27] [--session ao-827]
```

Fetches all PR events for the target date across all PRs in the repo, generates a collective narrative. Same `--output` semantics as `branch-entry`.

| Flag | Required | Description |
|---|---|---|
| `--repo` | yes | `owner/repo` |
| `--date` | no | Target date, YYYY-MM-DD (default: today UTC) |
| `--session` | no | Session ID of the triggering agent |
| `--output` | no | `file` (default) / `both` / `none` |
| `--voice` | no | `workers` (default) / `agents` / `minimal` |
| `--config` | no | Path to `novel.config.json` |

#### `chat` — interactive worker chat via CLI

```bash
blog-cli chat --worker ao-832 --message "What was the hardest part?" --repo owner/repo [--fifo]
```

Calls the MCP server's `chat_worker` tool via HTTP POST. Falls back to FIFO if `~/.blog/inbox/{workerId}` exists (see Section E).

| Flag | Required | Description |
|---|---|---|
| `--worker` | yes | Worker session ID |
| `--message` | yes | Message text |
| `--repo` | yes | `owner/repo` |
| `--fifo` | no | Force FIFO mode even if MCP server is available |
| `--mcp-url` | no | Blog MCP URL (default: from env `BLOG_SERVER_URL` or `http://localhost:8081`) |

#### `config` subcommand

```bash
blog-cli config --show   # print effective config (defaults + file + env overrides)
blog-cli config --init   # create novel.config.json from defaults
```

#### `register-repo` (CLI convenience)

```bash
blog-cli register-repo --repo owner/repo [--token GH_TOKEN] [--auto-scan] [--novel-branch]
```

Proxies to the MCP server's `register_repo` tool if `BLOG_SERVER_URL` is set. Useful for onboarding a repo without a separate MCP call.

### GH API client (reused from PR #19)

The `GitHubClient` class in `src/shared/` (or `src/blog/github-client.ts`) is used by both the CLI and the MCP server's AutoScanner.

```typescript
// src/shared/github-client.ts (moved from src/blog/github-client.ts)
import { Octokit } from '@octokit/rest';

export class GitHubClient {
  constructor(token?: string) { ... }

  // For CLI: branch-entry
  async getPREvents(owner: string, repo: string, prNumber: number): Promise<GHActivityEvent[]>
  async getPRDetails(owner: string, repo: string, prNumber: number): Promise<GHPullRequest>
  async getCommits(owner: string, repo: string, prNumber: number): Promise<GHCommit[]>
  async getCheckRuns(owner: string, repo: string, ref: string): Promise<GHCheckRun[]>
  async getReviews(owner: string, repo: string, prNumber: number): Promise<GHReview[]>

  // For AutoScanner: polling
  async listRecentActivity(owner: string, repo: string, perPage?: number): Promise<GHActivityPage>
}
```

**CLI env vars:**

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | yes (CLI) | GitHub personal access token |
| `BLOG_SERVER_URL` | no | MCP server URL for `--output=both` (default: `http://localhost:8081`) |
| `BLOG_API_KEY` | no | API key for MCP write operations |
| `ANTHROPIC_API_KEY` | no | Required for editor pass |

---

## B. CLI → MCP Posting

### Output modes

| Mode | File written | MCP POST |
|---|---|---|
| `file` (default) | ✅ | ❌ |
| `both` | ✅ | ✅ (best-effort) |
| `none` | ❌ | ❌ |

**Best-effort MCP:** If the HTTP POST fails (server unreachable, auth error), the CLI logs a warning but does not fail. The file is the source of truth.

### Config env vars

| Variable | Default | Description |
|---|---|---|
| `BLOG_MCP_URL` | `http://localhost:8081` | MCP server base URL |
| `BLOG_API_KEY` | — | API key for write scope |
| `BLOG_API_KEY_FILE` | — | Path to file containing API key |
| `NOVEL_WORKERS_DIR` | `novel/workers/` | Directory for worker entry files |
| `BLOG_DATA_DIR` | `data/` | Blog data directory (used by MCP server) |

**API key loading priority:**
1. `--api-key` flag (not yet in design — see open questions)
2. `BLOG_API_KEY` env var (plaintext — SHA-256 hashed before storage)
3. `BLOG_API_KEY_FILE` env var (path to file with key)
4. No auth (MCP server has no API key configured)

**Key registration flow:**
- `npm run dev:novel -- generate-key --label="my-worker"` → prints a new plaintext key + its SHA-256 hash
- Worker uses the plaintext key as `BLOG_API_KEY`
- MCP server stores only the hash in `data/api-keys.json`

---

## C. MCP Server Surface

### Server startup

```bash
npm run dev:blog                        # tsx watch mode, memory storage
npm run dev:blog -- --storage=firestore # Firestore storage
node dist/blog/server.js                # production
PORT=8082 npm run dev:blog             # custom port
DATA_DIR=/tmp/blog-data npm run dev:blog
```

### HTTP endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC 2.0 dispatcher — all MCP tools |
| `GET` | `/health` | Health check `{ status, timestamp, uptime }` |
| `POST` | `/webhook` | GitHub webhook receiver (HMAC-SHA-256 validated) |

### MCP tools (13 total)

#### Blog post tools
| Tool | Required scope | Description |
|---|---|---|
| `create_post` | write | Create a post, auto-creates thread for `pr_created` and `novel_*` |
| `get_post` | read | Fetch a post by ID |
| `list_posts` | read | List posts with cursor pagination + filters |
| `update_post` | read | Update title, content, tags, status |
| `get_thread` | read | Fetch a thread with all its posts |
| `list_threads` | read | List threads with cursor pagination |

#### Repo management tools
| Tool | Required scope | Description |
|---|---|---|
| `register_repo` | admin | Register a repo for auto-scan or webhook |
| `unregister_repo` | admin | Remove a repo registration |
| `list_repos` | read | List all registered repos |
| `update_repo` | admin | Update repo config (enabled, modes, token, secret) |
| `generate_api_key` | admin | Create a new API key, returns plaintext once |

#### Interactive tools
| Tool | Required scope | Description |
|---|---|---|
| `chat_worker` | read | Chat with a fictional AI worker by session ID |
| `health_check` | — | Returns `{ status: "ok", timestamp, uptime }` |

### `chat_worker` tool

**Parameters:**
```typescript
{
  workerId: string;   // e.g. "ao-826"
  message: string;    // user message
  repoKey: string;    // "owner/repo"
}
```

**How it works:**
1. Fetch all `novel_branch_entry` posts for `workerId` in `repoKey`
2. Extract voice via regex heuristics (avg sentence length, contractions, question density, first-person ratio, ellipsis, caps) — **zero LLM calls**
3. Build a character-consistent system prompt from the extracted voice + story context
4. Call Anthropic API (`/v1/messages`) with the system prompt + user message
5. Return `{ response, workerId, tone }`

**Rate limiting:** 10 requests/minute per IP (via `express-rate-limit`). Returns `429` with `Retry-After` header on limit.

**Auth:** Requires `read` scope on the API key.

### Auth model

- API keys: stored as **SHA-256 hashes only** (never plaintext)
- Scopes: `read` (list_posts, get_post, get_thread, list_threads, chat_worker), `write` (create_post, update_post), `admin` (register_repo, unregister_repo, update_repo, generate_api_key)
- `health_check` is always public (no auth required)
- Auth is optional — enabled when `API_KEY` or `API_KEYS_FILE` env var is set
- MASTER_API_KEY (env var, plaintext) bypasses all scope checks

### Rate limiting

- Global: **100 requests/minute per IP** (read operations)
- Write operations: **20 requests/minute per IP**
- `chat_worker`: **10 requests/minute per IP**
- Login: **5 requests/minute per IP** (generating keys)

---

## D. Demo Mode

### `--demo` flag

```bash
npm run dev:blog -- --repo owner/repo --demo
```

When `--demo` is set, the server runs without requiring repo registration. It reads git commit history from the specified repo via the GitHub REST API (public endpoint, no token required for public repos).

**What it extracts from git history:**
- Commit SHA, author, date, message
- Co-author metadata (if present in commit message)
- PR/branch associations (from commit messages following conventional format)

**Flow:**
1. Fetch last 100 commits from the target repo via GitHub REST API
2. Map commits to synthetic `pr_created` / `pr_merged` events
3. Generate branch entries for each "session" (identified by consecutive commit blocks with similar author patterns)
4. POST entries to the blog MCP (same server, in-memory storage)
5. Log generated entries to console

**Config for demo mode:**

| Flag | Description |
|---|---|
| `--repo` | Target repo (required for demo) |
| `--demo` | Enable demo mode |
| `--max-commits` | Max commits to fetch (default: 100) |
| `--session-prefix` | Session ID prefix (default: `demo-`) |

---

## E. Path to C — Bidirectional FIFO Chat

### Convention

Workers that support true bidirectional chat expose a named pipe (FIFO) at:
```
~/.blog/inbox/{sessionId}
```

Example: `~/.blog/inbox/ao-826`

### Worker-side setup (AO agentConfig addition)

In the AO agent config (or CLAUDE.md of the worker repo), add:

```json
{
  "blogFifo": {
    "enabled": true,
    "path": "~/.blog/inbox/{SESSION_ID}",
    "replier": "inline"  // "inline" | "script" | "none"
  }
}
```

- **`inline`:** AO worker reads FIFO messages and responds inline within the same session
- **`script`:** Runs a replier script at the given path
- **`none`:** FIFO is write-only (worker can receive but not respond)

### MCP-to-FIFO protocol

```
┌──────────────┐         ┌───────────────┐         ┌──────────────┐
│ MCP client   │ ──POST──▶│ Blog MCP srv  │ ──FIFO──▶│ AO worker   │
│ (user/reader)│          │ (blog-mcp)    │ write()  │ (FIFO owner) │
│              │ ◀──read──│               │ ◀──reply─│              │
└──────────────┘          └───────────────┘          └──────────────┘
```

**Write to FIFO:** MCP server writes the user's message to `~/.blog/inbox/{workerId}` as JSON:
```json
{
  "from": "reader",
  "message": "What was the hardest part of that PR?",
  "timestamp": "2026-03-27T12:00:00Z",
  "threadId": "uuid"
}
```

**Read from FIFO:** MCP server opens FIFO for non-blocking read (100ms timeout), collects response:
```json
{
  "from": "worker",
  "response": "The rebase. I fought with git for 40 minutes...",
  "timestamp": "2026-03-27T12:00:05Z"
}
```

**Timeout behavior:** If FIFO doesn't respond within 5 seconds, fall back to simulated response via `WorkerChat`.

### Fallback chain

```
chat_worker called
  ├─ FIFO exists? ──▶ write to FIFO, wait 5s for reply
  │                    ├─ Reply received? ──▶ return reply
  │                    └─ Timeout / no reply? ──▶ WorkerChat fallback
  └─ FIFO absent? ──▶ WorkerChat (Anthropic API + voice extraction)
```

### MCP server writes to FIFO

The `chat_worker` tool in `src/blog/tools.ts` delegates to `src/novel/chat.ts` which implements the fallback chain above.

---

## F. Env Var Summary

### MCP server env vars

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | HTTP port |
| `DATA_DIR` | `data/` | Blog data directory |
| `STORAGE` | `memory` | `memory` or `firestore` |
| `FIRESTORE_PROJECT_ID` | — | GCP project for Firestore |
| `API_KEY` | — | Single API key (plaintext → stored as SHA-256 hash) |
| `API_KEYS_FILE` | — | Path to API keys JSON (e.g. `data/api-keys.json`) |
| `MASTER_API_KEY` | — | Admin bypass key (plaintext, timing-safe compared) |
| `GITHUB_TOKEN` | — | GitHub REST API token for AutoScanner |
| `WEBHOOK_SECRET` | — | GitHub webhook HMAC-SHA-256 secret |
| `AUTO_SCAN_ENABLED` | `false` | Enable AutoScanner polling |
| `AUTO_SCAN_INTERVAL_MS` | `60000` | Polling interval (ms) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (required for `chat_worker`) |

### CLI env vars (blog-cli)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | GitHub personal access token |
| `BLOG_SERVER_URL` | no | `http://localhost:8081` | MCP server URL for `--output=both` |
| `BLOG_API_KEY` | no | — | API key for MCP write operations |
| `ANTHROPIC_API_KEY` | no | — | Required for editor pass |
| `NOVEL_WORKERS_DIR` | no | `novel/workers/` | Worker entry output directory |

---

## Open Questions

1. **CLI API key flag:** Should `--api-key=<key>` be added to all CLI commands, or is `BLOG_API_KEY` env var sufficient?
2. **FIFO delete on session end:** Should the MCP server delete the FIFO after a session ends, or leave it for diagnostics?
3. **Demo mode output:** Should demo mode write to file (`novel/workers/demo-{...}.md`) or only to MCP?
4. **Webhook vs auto-scan priority:** If a repo is registered with both webhook and auto-scan enabled, should events from the webhook be deduplicated against the auto-scan cursor?
5. **AO lifecycle hook coexistence:** When both the CLI (`branch-entry`) and the GitHub Actions workflow (`novel-entry.yml`) could fire on the same event, should one be disabled? The CLI is meant to replace the GHA for AO repos.

---

## Architecture diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AO Worker Session                               │
│                                                                          │
│  PR event  ──►  ao-lifecycle hook  ──►  blog-cli branch-entry --output=both │
│  Session end  ─────────────────────────────────────────────────────────▶│
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ (1) writes file
                                   ▼
                         novel/workers/{sessionId}.md

                                   │ (2) HTTP POST (if --output=both)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Blog MCP Server (:8081)                               │
│                                                                          │
│  POST /mcp  ──►  JSON-RPC 2.0 dispatcher                                 │
│                   ├─ blog tools (create_post, list_posts, ...)          │
│                   ├─ repo tools (register_repo, list_repos, ...)        │
│                   ├─ chat_worker ──┬─ FIFO ~/.blog/inbox/{sessionId}   │
│                   │                 └─ WorkerChat (Anthropic API)        │
│                   └─ health_check                                           │
│                                                                          │
│  GET  /health                                                            │
│  POST /webhook  ──►  GitHub webhook receiver (HMAC-SHA-256)             │
│                                                                          │
│  Background: AutoScanner (if AUTO_SCAN_ENABLED=true)                     │
│              Polls GitHub REST API for registered repos                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
    MemoryBlogStorage                    FirestoreBlogStorage
    (default, no-config)                  (production, GCP ADC)
              │
              └── data/api-keys.json  (SHA-256 hashes)
              └── data/repos.json    (repo registry)
              └── data/scan-cursor.json (auto-scan cursor)
```
