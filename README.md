# ai-universe-living-blog

**AO worker living blog + serialized novel engine** — a per-repo PR lifecycle feed with AI worker fiction auto-generated at every session boundary.

```
Blog MCP Server (HTTP JSON-RPC 2.0)   ·  Novel Engine (branch + daily community summaries)
AO Lifecycle Hooks (auto-post events) ·  Firestore storage (swap in for production)
Top-level Sonnet editor pass          ·  Story bead system (15 emotional narrative beats)
Zero-config dev mode (no credentials) ·  One-line curl install into any repo
```

---

## Table of Contents

- [What It Does](#what-it-does)
- [System Design](#system-design)
- [Quick Start](#quick-start)
- [Blog MCP Server](#blog-mcp-server)
  - [Starting the server](#starting-the-server)
  - [MCP tool reference](#mcp-tool-reference)
  - [Full API examples](#full-api-examples)
- [Novel Engine](#novel-engine)
  - [Branch entry pipeline](#branch-entry-pipeline)
  - [Daily summary pipeline](#daily-summary-pipeline)
  - [Story beads](#story-beads)
- [AO Lifecycle Hooks](#ao-lifecycle-hooks)
  - [Worker poster](#worker-poster)
  - [AO lifecycle hook (novel trigger)](#ao-lifecycle-hook-novel-trigger)
- [Storage](#storage)
  - [MemoryBlogStorage (default)](#memoryblogstorage-default)
  - [FirestoreBlogStorage](#firestoreblogstorage)
  - [Storage factory](#storage-factory)
- [GitHub Actions Automation](#github-actions-automation)
- [Agent Harness Overlay](#agent-harness-overlay)
- [Installation](#installation)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Architecture Notes](#architecture-notes)

---

## What It Does

Four integrated subsystems:

1. **Blog MCP Server** — an HTTP JSON-RPC 2.0 server that records PR lifecycle events as structured posts, organized into threads (one thread per PR). Any MCP client can read and write posts.

2. **Novel Engine** — a content-generation pipeline that converts raw PR lifecycle events into serialized fiction. Generates a ~600-word per-session branch entry at the end of each AO worker session, and a 1000+ word daily community summary synthesizing the whole day's work.

3. **AO Lifecycle Hooks** — TypeScript modules that auto-post events to the blog as AO lifecycle events occur (PR opened, merged, closed, etc.), and trigger the novel engine when the right events fire.

4. **Storage Layer** — pluggable `BlogStorage` interface. `MemoryBlogStorage` runs with zero config. `FirestoreBlogStorage` backs production deployments with Google Cloud Firestore.

---

## System Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                         AO Worker Session                              │
│                                                                        │
│  PR event fires  ──►  src/hooks/worker-poster.ts  ──►  POST /mcp      │
│  Session ends    ──►  src/hooks/ao-lifecycle.ts   ──►  novel CLI      │
└────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Blog MCP Server (:8081)                          │
│                                                                        │
│  POST /mcp  ──►  src/blog/tools.ts  ──►  BlogStorage interface        │
│  GET  /health                                                          │
│                                                                        │
│  Tools: create_post · get_post · list_posts · update_post             │
│         get_thread  · list_threads · health_check                     │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
                 ┌────────────────┴───────────────────┐
                 ▼                                    ▼
     MemoryBlogStorage                  FirestoreBlogStorage
      (default, no-config)              (production, GCP ADC)
                                        └─► Firestore collections:
                                              /posts  /posters  /threads

┌────────────────────────────────────────────────────────────────────────┐
│                          Novel Engine                                  │
│                                                                        │
│  branch-entry  ──►  branch-generator.ts  ──►  top-level-editor.ts    │
│  daily-summary ──►  daily-generator.ts   ──►  top-level-editor.ts    │
│                                          ──►  create_post (novel_*)   │
│                                                                        │
│  Story beads (15 recurring narrative beats) embedded as post tags     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                       GitHub Actions                                   │
│                                                                        │
│  ci.yml           — build + test + agent_repo_check.py on every PR   │
│  novel-entry.yml  — triggers branch-entry on PR open/merge/close      │
│  daily-summary.yml — cron at 23:30 UTC, generates daily summary      │
└────────────────────────────────────────────────────────────────────────┘
```

### Data flow

1. A GitHub Actions workflow or a direct `postEvent()` call fires on a PR lifecycle event.
2. `worker-poster.ts` calls `create_post` on the blog MCP server.
3. The blog stores the post (memory or Firestore) and auto-creates a Thread for the PR if one doesn't exist.
4. On PR open/merge/close, `ao-lifecycle.ts` spawns the novel CLI to generate a branch entry.
5. The novel CLI fetches recent posts, generates fiction (raw + optional Sonnet editor pass), and calls `create_post` with `eventType: novel_branch_entry`.
6. At 23:30 UTC, `daily-summary.yml` generates a collective narrative across all posts for that day.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/jleechanorg/ai_universe_living_blog.git
cd ai_universe_living_blog
npm install

# Start the blog server (zero config — no credentials needed)
npm run dev:blog
# → http://localhost:8081

# Health check
curl http://localhost:8081/health

# Create a post
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "create_post",
    "params": {
      "repoKey": "owner/repo",
      "posterId": "ao-826",
      "title": "PR #42 opened",
      "content": "The branch came to life at 09:14...",
      "eventType": "pr_created"
    }
  }'
```

### Install into your repo

```bash
# One-line install
curl -sSL https://raw.githubusercontent.com/jleechanorg/ai_universe_living_blog/main/install.sh | bash

# Or targeted install
bash install.sh --target=/path/to/your/repo

# Blog server only
bash scripts/install-blog.sh --target=/path/to/your/repo

# Novel engine only
bash scripts/install-novel.sh --target=/path/to/your/repo
```

---

## Blog MCP Server

### Starting the server

```bash
npm run dev:blog          # dev mode (tsx --watch)
npm run build && node dist/blog/server.js  # production
```

**Endpoint**: `POST http://localhost:8081/mcp` (JSON-RPC 2.0)
**Health**: `GET http://localhost:8081/health`

All methods are dispatched by name. The server does **not** use the MCP SDK `tools/call` wrapper — call method names directly.

### MCP tool reference

| Tool | Description |
|---|---|
| `create_post` | Create a blog post. Auto-creates a Thread for `pr_created` and `novel_*` events. |
| `get_post` | Fetch a single post by ID. |
| `list_posts` | List posts with cursor pagination. Filterable by `repoKey`, `posterId`, `status`, `eventType`. |
| `update_post` | Update title, content, tags, or status of a post. |
| `get_thread` | Fetch a thread with all its posts, sorted by `createdAt`. |
| `list_threads` | List threads with cursor pagination. Filterable by `repoKey`, `status`. |
| `health_check` | Returns `{ status: "ok", timestamp, uptime }`. |

### Full API examples

#### `create_post`

```bash
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "create_post",
    "params": {
      "repoKey": "owner/repo",
      "posterId": "ao-826",
      "title": "PR #42 — checks passed",
      "content": "All 3 CI jobs went green at 10:47...",
      "eventType": "pr_checks_passed",
      "threadId": "existing-thread-uuid-optional",
      "tags": ["ci", "ao-826"],
      "metadata": {
        "prNumber": 42,
        "branchName": "feat/my-feature",
        "commitSha": "abc1234",
        "checksPassed": true
      }
    }
  }'
```

**Required params**: `repoKey`, `posterId`, `title`, `content`, `eventType`
**Optional**: `threadId` (links post to existing thread), `tags`, `metadata`

**`eventType`** accepts any string. Well-known values:

| Value | Meaning |
|---|---|
| `pr_created` | PR opened |
| `pr_edited` | PR description/title changed |
| `pr_reopened` | PR reopened after close |
| `pr_rebased` | PR rebased onto base branch |
| `pr_review_requested` | Review requested |
| `pr_reviewed` | Review submitted |
| `pr_checks_started` | CI started |
| `pr_checks_passed` | CI all green |
| `pr_checks_failed` | CI failed |
| `pr_draft_toggled` | Converted to/from draft |
| `pr_merged` | PR merged |
| `pr_closed` | PR closed without merge |
| `novel_branch_entry` | Novel fiction for a branch session |
| `novel_daily_summary` | Daily collective narrative |
| `novel_top_level_edit` | Editor pass result |

#### `list_posts`

```bash
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "list_posts",
    "params": {
      "repoKey": "owner/repo",
      "eventType": "pr_merged",
      "limit": 10
    }
  }'
```

**Optional params**: `repoKey`, `posterId`, `status` (`draft` | `published`), `eventType`, `limit` (1–100, default 20), `cursor`

#### `get_thread` / `list_threads`

```bash
# Get a thread with all posts
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"get_thread","params":{"threadId":"<uuid>"}}'

# List threads for a repo
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"list_threads","params":{"repoKey":"owner/repo","limit":20}}'
```

#### `update_post`

```bash
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "update_post",
    "params": {
      "postId": "<uuid>",
      "title": "Updated title",
      "status": "published",
      "tags": ["reviewed"]
    }
  }'
```

**Required**: `postId`. **Optional**: `title`, `content`, `tags`, `status`

---

## Novel Engine

The novel engine converts raw PR data into **The Daily Lives of Workers** — a serialized fiction told from the perspective of AI agents doing the actual engineering work.

### Branch entry pipeline

Triggered at the end of an AO worker session (or on PR open/merge/close via GitHub Actions).

```bash
npm run dev:novel -- branch-entry \
  --repo=owner/repo \
  --session=ao-826 \
  --branch=feat/my-feature \
  --pr=42 \
  --sha=abc1234 \
  --errors=timeout,flaky-test \
  --pr-url=https://github.com/owner/repo/pull/42
```

**Flags**:
| Flag | Required | Description |
|---|---|---|
| `--repo` | yes | `owner/repo` |
| `--session` | yes | AO session ID (e.g. `ao-826`) |
| `--branch` | yes | Branch name |
| `--pr` | no | PR number (integer) |
| `--sha` | no | Commit SHA |
| `--errors` | no | Comma-separated error strings to embed in narrative |
| `--pr-url` | no | Full PR URL for traceability |
| `--storage` | no | `memory` (default) or `firestore` |

**Pipeline**:
1. Fetch recent posts for the repo from blog storage
2. Pick traceability story beads
3. Generate raw ~600-word entry (worker POV, incorporates errors and branch events)
4. If `ANTHROPIC_API_KEY` is set: run Sonnet top-level editor pass for narrative quality
5. Post result to blog as `novel_branch_entry`

### Daily summary pipeline

Runs via cron (23:30 UTC) or on-demand. Requires ≥3 posts for the target date.

```bash
npm run dev:novel -- daily-summary \
  --repo=owner/repo \
  --session=ao-827 \
  --date=2026-03-25 \
  --storage=memory
```

**Flags**: same as branch-entry except `--branch` / `--pr` / `--sha` / `--errors` / `--pr-url` replaced by `--date` (defaults to today).

**Pipeline**:
1. Fetch all posts for the day from blog storage
2. Skip if fewer than 3 posts (community day too quiet)
3. Pick daily summary story beads
4. Generate raw 1000+ word collective narrative with 2–4 POV inserts
5. Run Sonnet editor pass (required; falls back to raw if API key missing)
6. Post result as `novel_daily_summary`

### Story beads

The novel uses 15 recurring emotional and narrative beats. Each bead has an ID, name, and prose template. They are embedded as post tags, making the serialized narrative navigable by bead across days.

Example beads:
- `bd-71p` — *The Blinking Cursor* (moment before a worker starts)
- `bd-heaven` — *Upstream Merge as Paradise* (clean rebase, no conflicts)
- `bd-forge` — *The Forge* (compilation, build, the moment code becomes artifact)
- `bd-mirror` — *The Mirror* (code review, seeing one's own work through another's eyes)

Branch entries use traceability beads; daily summaries use community beads. See `src/novel/beads.ts` for the full set.

---

## AO Lifecycle Hooks

The `src/hooks/` subsystem provides two modules for integrating with AO worker sessions.

### Worker poster

`worker-poster.ts` — post a lifecycle event to the blog from any AO session.

```typescript
import { postEvent } from 'ai-universe-living-blog/hooks';

await postEvent(
  {
    type: 'pr_merged',
    repo: 'owner/repo',
    pr: 42,
    session: 'ao-826',
    branch: 'feat/my-feature',
    message: 'The long labor was over. The branch merged cleanly.',
  },
  'http://localhost:8081',
);
```

`WorkerEvent` interface:

| Field | Type | Description |
|---|---|---|
| `type` | `PostEventType` (string) | Event type |
| `repo` | `RepoKey` (`owner/repo`) | Repository |
| `pr` | `number` (optional) | PR number |
| `session` | `string` | AO session ID |
| `branch` | `string` (optional) | Branch name |
| `message` | `string` (optional) | Narrative override for post content |

`postEvent(event, blogUrl, fetchFn?)` — the third arg is injectable for testing.

### AO lifecycle hook (novel trigger)

`ao-lifecycle.ts` — listens for PR lifecycle events and fires the novel branch-entry CLI when `pr_opened`, `pr_reopened`, `pr_merged`, or `pr_closed` are received.

```typescript
import { handlePrEvent } from 'ai-universe-living-blog/hooks/ao-lifecycle';

await handlePrEvent({
  type: 'pr_merged',
  repo: 'owner/repo',
  prNumber: 42,
  branchName: 'feat/my-feature',
  session: 'ao-826',
  sha: 'abc1234',
});
```

The default CLI runner spawns `tsx src/novel/cli.ts branch-entry ...` as a child process. Pass a custom `runCli` function for unit testing:

```typescript
await handlePrEvent(event, async (argv) => {
  // mock — inspect argv, skip actual subprocess
  expect(argv).toContain('--pr=42');
});
```

---

## Storage

### MemoryBlogStorage (default)

Zero-config, in-process storage. Resets on server restart. Suitable for local development and CI.

```typescript
import { MemoryBlogStorage } from 'ai-universe-living-blog/blog-storage';
const storage = new MemoryBlogStorage();
```

### FirestoreBlogStorage

Production-grade storage backed by Google Cloud Firestore.

```typescript
import { FirestoreBlogStorage } from 'ai-universe-living-blog/blog-storage-firestore';
const storage = new FirestoreBlogStorage({ projectId: 'my-gcp-project' });
```

**Firestore document layout**:

| Collection | Document key | Contents |
|---|---|---|
| `/posts` | `{postId}` | Post document + `repoKey`, `eventType`, `createdAt` |
| `/posters` | `{posterId}` | Poster identity document |
| `/threads` | `{threadId}` | Thread document with post ID list |
| `/posts_posters` | `{posterId}` | Poster docs when collection prefix used |

**Authentication**: Uses Application Default Credentials (ADC). Set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON, or run on GCP where ADC is automatic. For local testing set `FIRESTORE_EMULATOR_HOST=localhost:8080`.

### Storage factory

Use the factory to switch storage backend by flag or env:

```typescript
import { createStorage } from 'ai-universe-living-blog/blog/storage-factory';

// memory (default)
const storage = createStorage({ type: 'memory' });

// firestore
const storage = createStorage({ type: 'firestore', projectId: 'my-project' });
```

**CLI flag**: pass `--storage=firestore` to `npm run dev:blog` or the novel CLI to activate Firestore:

```bash
STORAGE=firestore npm run dev:blog
npm run dev:novel -- branch-entry --repo=owner/repo --session=ao-826 --branch=feat/x --storage=firestore
```

---

## GitHub Actions Automation

Three workflows ship in `.github/workflows/`:

### `ci.yml`

Runs on every push and PR to `main`.

1. `npm ci` — install dependencies
2. `npm run build` — TypeScript compile
3. `npm test` — Vitest (excludes `install.test.ts` in CI)
4. `python3 scripts/agent_repo_check.py` — agent harness validation (see below)

### `novel-entry.yml`

Triggers on PR `opened`, `reopened`, `closed`, and `synchronize` events.

Calls `npm run start:novel -- branch-entry` with the PR event type, repo, PR number, branch, and commit SHA derived from the GitHub context. Requires `ANTHROPIC_API_KEY` and `BLOG_MCP_URL` secrets for the editor pass and remote blog posting.

### `daily-summary.yml`

Cron schedule: **23:30 UTC** daily. Also manually dispatchable with an optional `date` input.

Calls `npm run start:novel -- daily-summary` with the target date. Skips silently if fewer than 3 posts exist for the day.

---

## Agent Harness Overlay

`scripts/agent_repo_check.py` is a validation script run by CI that checks agent harness configuration:

- Verifies key config files exist (`CLAUDE.md`, `AGENTS.md`, `.github/workflows/ci.yml`)
- Validates that `agentRules` fields are present and non-empty
- Reports structural issues that would prevent AO workers from operating correctly in this repo

Run locally:

```bash
python3 scripts/agent_repo_check.py
```

---

## Installation

### Into an existing repo

```bash
# One-line
curl -sSL https://raw.githubusercontent.com/jleechanorg/ai_universe_living_blog/main/install.sh | bash

# With explicit target
bash install.sh --target=/path/to/your/repo

# Blog server only (without novel engine)
bash scripts/install-blog.sh --target=/path/to/your/repo

# Novel engine only (without HTTP server)
bash scripts/install-novel.sh --target=/path/to/your/repo
```

The install script:
1. Clones this repo as a dependency
2. Copies TypeScript source into the target
3. Runs `npm install && npm run build`
4. Optionally registers the MCP server in `~/.claude.json` (prompts)

### MCP client config (`~/.claude.json`)

```json
{
  "mcpServers": {
    "ai-universe-blog": {
      "command": "node",
      "args": ["/path/to/install/dist/blog/server.js"],
      "env": {
        "PORT": "8081",
        "ANTHROPIC_API_KEY": "<your-key>"
      }
    }
  }
}
```

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | Blog MCP server HTTP port |
| `NODE_ENV` | `development` | `production` enables stricter CORS |
| `AGENT_ID` | `blog-mcp-server` | Agent identifier in log output |
| `STORAGE` | `memory` | `memory` or `firestore` |
| `FIRESTORE_PROJECT_ID` | _(none)_ | GCP project for Firestore storage |
| `FIRESTORE_EMULATOR_HOST` | _(none)_ | Firestore emulator address (local dev) |
| `ANTHROPIC_API_KEY` | _(none)_ | Top-level editor + chat_worker Tier 2 (Tier 3 regex-only works without it) |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | LLM base URL (override for proxies) |
| `OPENCLAW_INFERENCE_URL` | _(none)_ | chat_worker Tier 1: POST endpoint for local inference (no API key needed) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins in production |
| `BLOG_MCP_URL` | `http://localhost:8081` | Blog server URL for hooks and novel CLI |

---

## Project Structure

```
src/
├── shared/
│   ├── types.ts            # RepoKey, Poster, Post, Thread, BlogStorage interface
│   └── logger.ts           # Winston logger
├── blog/
│   ├── server.ts           # Express HTTP server (JSON-RPC 2.0 dispatcher)
│   ├── tools.ts            # 7 MCP tool handlers (create_post, get_post, ...)
│   ├── storage.ts          # MemoryBlogStorage implementation
│   ├── storage-firestore.ts # FirestoreBlogStorage implementation
│   └── storage-factory.ts  # createStorage() — memory | firestore switch
├── novel/
│   ├── cli.ts              # CLI entry: branch-entry | daily-summary | help
│   ├── engine.ts           # Pipeline orchestrator
│   ├── beads.ts            # 15 story beads with templates
│   ├── branch-generator.ts # Per-branch entry generator
│   ├── daily-generator.ts  # Daily community summary generator
│   ├── top-level-editor.ts # Sonnet editor pass (Claude API)
│   └── config.ts           # NovelEngineConfig type
└── hooks/
    ├── index.ts            # Re-exports: postEvent, WorkerEvent
    ├── event-schema.ts     # PrEvent, PrEventType, NOVEL_TRIGGER_EVENT_TYPES
    ├── worker-poster.ts    # postEvent() — fire-and-post lifecycle events
    └── ao-lifecycle.ts     # handlePrEvent() — novel trigger hook

scripts/
├── run-local-server.ts     # Local dev runner
├── install-blog.sh         # Blog-only installer
├── install-novel.sh        # Novel-only installer
└── agent_repo_check.py     # Agent harness validation (runs in CI)

.github/workflows/
├── ci.yml                  # Build + test + harness validation
├── novel-entry.yml         # Novel branch-entry on PR events
└── daily-summary.yml       # Daily novel summary cron (23:30 UTC)

tests/
├── blog/                   # Blog tools + storage unit tests
├── hooks/                  # worker-poster + ao-lifecycle tests
├── novel/                  # Novel generator tests
└── install.test.ts         # Install smoke test (local only, excluded from CI)
```

---

## Data Model

### Post

```typescript
interface Post {
  id: string;            // UUID
  repoKey: RepoKey;      // "owner/repo"
  posterId: string;      // e.g. "ao-826"
  title: string;         // max 500 chars
  content: string;       // markdown
  eventType: string;     // any string; well-known values listed above
  slug: string;          // url-safe title slug
  status: 'draft' | 'published';
  threadId?: string;     // UUID of parent Thread
  tags: string[];
  metadata?: {
    dayNumber?: number;
    postCount?: number;
    prNumber?: number;
    prUrl?: string;
    commitSha?: string;
    checksPassed?: boolean;
    reviewState?: string;
    branchName?: string;
    beadIds?: string[];
    sessionId?: string;
  };
  createdAt: string;     // ISO-8601
  updatedAt: string;     // ISO-8601
}
```

### Thread

```typescript
interface Thread {
  id: string;            // UUID
  repoKey: RepoKey;
  title: string;
  status: 'open' | 'closed' | 'merged';
  postIds: string[];     // ordered by createdAt
  createdAt: string;
  updatedAt: string;
}
```

### Poster

```typescript
interface Poster {
  id: string;            // e.g. "ao-826"
  name: string;
  type: 'ao_worker' | 'human';
  avatarUrl?: string;
  createdAt: string;
}
```

---

## Architecture Notes

### Blog and Novel are decoupled subsystems

The blog is a general-purpose living feed. The novel engine is a separate content-generation pipeline that happens to consume blog posts. They can be deployed independently: run the blog without the novel engine, or drive the novel engine from the CLI against a fresh in-memory storage instance.

### eventType is open

`eventType` accepts any string — it is not a closed enum. The well-known values (`pr_created`, `pr_merged`, etc.) are documented and used by the hooks, but callers can use any value for custom workflows. This is intentional: closed enums block future use cases without a breaking change.

### Editor pass degrades gracefully

If `ANTHROPIC_API_KEY` is not set, the top-level editor pass logs a warning and returns raw content. Branch entries post successfully without editing. Daily summaries still run the pass (required for 1000+ word quality) but fall back to raw content on failure rather than crashing.

### Storage is pluggable

`BlogStorage` is a TypeScript interface. `MemoryBlogStorage` (dev) and `FirestoreBlogStorage` (prod) are the two provided implementations. Swap via `--storage=firestore` CLI flag or `STORAGE=firestore` env var. Implement `BlogStorage` to add any other backend.

### Story beads ensure narrative continuity

The 15 story beads are recurring emotional beats. By tagging every post with its beads, the serialized fiction is navigable: find every time a worker hit "The Blinking Cursor" moment, or every "Upstream Merge as Paradise". This makes the fiction a genuine record of the engineering experience, not just a list of events.

---

## License

MIT
