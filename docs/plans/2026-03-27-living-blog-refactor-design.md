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

#### `branch-entry` — prompt provider, not generator

```bash
blog-cli branch-entry --session ao-832 --pr 42 --repo owner/repo [--sha abc123]
```

**The CLI fetches GH events and writes a prompt file. AO workers generate entries themselves.**

1. Reads `GITHUB_TOKEN` env var (required)
2. Fetches PR events via GitHub REST API (pull request events, check runs, reviews, commits)
3. Writes a structured prompt file at `~/.blog/prompts/{sessionId}.md`
4. AO worker reads the prompt file, generates `novel/workers/{sessionId}.md` inline (using AO's own inference — no separate LLM call by the CLI)
5. AO worker optionally POSTs to MCP server if `BLOG_SERVER_URL` is set

The CLI does **not** call any LLM. No `ANTHROPIC_API_KEY` is needed for `branch-entry`.

**Prompt file format** (`~/.blog/prompts/{sessionId}.md`):

```markdown
# Branch Entry Prompt — {sessionId}

## Context
- Session: {sessionId}
- PR: {prNumber}
- Repo: {repoKey}
- Branch: {branchName}
- Author: {prAuthor}
- Status: {open|merged|closed}

## PR Title
{title}

## PR Body (first 500 chars)
{body}

## Events (chronological)
- [{timestamp}] {event.type}: {event.description}
- [...more events...]

## Commits
- {sha} — {message} — {author} — {date}

## Check Runs
- {name}: {conclusion} (duration: {duration})

## Reviews
- [{author}] {state} — "{body excerpt}"

## Writing Instruction
Write a ~600-word branch entry from the perspective of {sessionId}.
Use a first-person collective voice ("we", "the cursor", "the branch").
Incorporate: the actual commit messages, the PR title/body, the check results, and any review feedback.
Ground every claim in the specific events above.
Tag the entry with at least 2 story beads from: {available beads list}.
Output path: novel/workers/{sessionId}.md
```

**CLI parameters:**

| Flag | Required | Description |
|---|---|---|
| `--session` | yes | Worker session ID (e.g. `ao-832`) |
| `--pr` | yes | PR number (integer) |
| `--repo` | yes | `owner/repo` |
| `--sha` | no | Specific commit SHA to anchor the entry |
| `--output-dir` | no | Prompt output dir (default: `~/.blog/prompts/`) |

**Output flow:**
1. `GitHubClient.getPREvents()` fetches all events for the PR
2. `GitHubClient.getPRDetails()` fetches PR title, body, author, branch
3. `GitHubClient.getCommits()` fetches commit list for the PR
4. `GitHubClient.getCheckRuns()` fetches CI check runs
5. `GitHubClient.getReviews()` fetches review events
6. Assemble structured prompt file at `~/.blog/prompts/{sessionId}.md`
7. Log: `Prompt written to ~/.blog/prompts/{sessionId}.md — AO worker will generate the entry`

> **AO worker integration:** AO lifecycle hook reads the prompt file and passes it as input context to the AO worker. The worker generates the entry, writes it to `novel/workers/{sessionId}.md`, and (optionally) POSTs to MCP server.

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
// src/shared/github-client.ts
// Uses native fetch (Node 18+). No external HTTP client dependency.

export class GitHubClient {
  constructor(private readonly token?: string) {}

  // For CLI: branch-entry
  async getPR(owner: string, repo: string, prNumber: number): Promise<GHPullRequest>
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
| `ANTHROPIC_API_KEY` | no | Required for editor pass |
| `OPENCLAW_INFERENCE_URL` | no | Local inference URL for chat_worker (preferred) |

---

## B. CLI → MCP Posting

### Output modes

| Mode | File written | MCP POST |
|---|---|---|
| `file` (default) | ✅ | ❌ |
| `both` | ✅ | ✅ (best-effort) |
| `none` | ❌ | ❌ |

**Best-effort MCP:** If the HTTP POST fails (server unreachable), the CLI logs a warning but does not fail. The file is the source of truth.

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

### MCP tools (12 total)

All tools are open — no API key required.

#### Blog post tools
| Tool | Description |
|---|---|
| `create_post` | Create a post, auto-creates thread for `pr_created` and `novel_*` |
| `get_post` | Fetch a post by ID |
| `list_posts` | List posts with cursor pagination + filters |
| `update_post` | Update title, content, tags, or status of a post |
| `get_thread` | Fetch a thread with all its posts |
| `list_threads` | List threads with cursor pagination |

#### Repo management tools
| Tool | Description |
|---|---|
| `register_repo` | Register a repo for auto-scan or webhook |
| `unregister_repo` | Remove a repo registration |
| `list_repos` | List all registered repos |
| `update_repo` | Update repo config (enabled, modes, token, secret) |

#### Interactive tools
| Tool | Description |
|---|---|
| `chat_worker` | Chat with a fictional AI worker by session ID |
| `health_check` | Returns `{ status: "ok", timestamp, uptime }` |

### `chat_worker` tool

**Parameters:**
```typescript
{
  workerId: string;   // e.g. "ao-826"
  message: string;    // user message
  repoKey: string;    // "owner/repo"
}
```

**How it works (tried in order):**

1. **Local inference (preferred):** If `OPENCLAW_INFERENCE_URL` is set, POST to that URL with the system prompt + user message. No API key needed.
2. **Remote/GCP inference:** If `ANTHROPIC_API_KEY` is set (and `OPENCLAW_INFERENCE_URL` is not), call Anthropic API (`/v1/messages`).
3. **Regex-only fallback:** If neither backend is available, extract voice via regex heuristics and return a deterministic response. No inference — last resort.

**Return value:** `{ response, workerId, tone }`

### Rate limiting (IP-based)

- Global: **100 requests/minute per IP** (read operations)
- Write operations: **20 requests/minute per IP**
- `chat_worker`: **10 requests/minute per IP**

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
  │                    └─ Timeout / no reply? ──▶ simulated response (regex voice only, no LLM)
  └─ FIFO absent? ──▶ simulated response (regex voice only)
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
| `GITHUB_TOKEN` | — | GitHub REST API token for AutoScanner |
| `WEBHOOK_SECRET` | — | GitHub webhook HMAC-SHA-256 secret |
| `AUTO_SCAN_ENABLED` | `false` | Enable AutoScanner polling |
| `AUTO_SCAN_INTERVAL_MS` | `60000` | Polling interval (ms) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (fallback for `chat_worker`) |
| `OPENCLAW_INFERENCE_URL` | — | Local inference URL for `chat_worker` (preferred over `ANTHROPIC_API_KEY`) |

### CLI env vars (blog-cli)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | GitHub personal access token |
| `BLOG_SERVER_URL` | no | `http://localhost:8081` | MCP server URL for `--output=both` |
| `ANTHROPIC_API_KEY` | no | — | Required for editor pass |
| `OPENCLAW_INFERENCE_URL` | no | — | Local inference URL for chat_worker (preferred) |
| `NOVEL_WORKERS_DIR` | no | `novel/workers/` | Worker entry output directory |

---

## Open Questions

1. **FIFO delete on session end:** Should the MCP server delete the FIFO after a session ends, or leave it for diagnostics?
2. **Webhook vs auto-scan priority:** If a repo is registered with both webhook and auto-scan enabled, should events from the webhook be deduplicated against the auto-scan cursor?
3. **AO lifecycle hook coexistence:** When both the CLI (`branch-entry`) and the GitHub Actions workflow (`novel-entry.yml`) could fire on the same event, should one be disabled? The CLI is meant to replace the GHA for AO repos.

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

              └── data/repos.json    (repo registry)
              └── data/scan-cursor.json (auto-scan cursor)
```
