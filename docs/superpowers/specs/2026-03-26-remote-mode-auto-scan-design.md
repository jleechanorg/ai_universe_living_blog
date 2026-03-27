# Remote Mode + Auto-Scan Architecture — Design Spec

**Date:** 2026-03-26
**Status:** Approved — spec-document-reviewer iteration 1 (1 gap fixed)
**Repo:** jleechanorg/ai_universe_living_blog

---

## Goals

Enable the living blog MCP server to operate in three modes:
1. **Local dev** (existing): zero-config, in-memory, MCP tools only
2. **Remote / GCP**: hosted service with API key auth, per-repo configuration, GitHub REST polling
3. **Auto-scan**: background polling that watches registered repos and auto-generates blog posts + novel entries without AO worker involvement

Additional: Worker chat endpoint (`POST /chat`) that generates character-consistent responses for any worker ID using stored novel entries as voice reference.

---

## Architecture

```
Blog MCP Server (port 8081)
│
├── Existing MCP tools (create_post, list_posts, get_post, update_post,
│   get_thread, list_threads, health_check)
│
├── New MCP tools
│   ├── register_repo    — add a repo to the registry
│   ├── unregister_repo  — remove a repo from the registry
│   ├── list_repos       — list all registered repos
│   ├── update_repo      — update repo config (modes, token, etc.)
│   ├── generate_api_key — create a new API key (returns plaintext once)
│   └── chat_worker      — chat with a worker character
│
├── AutoScanner (background, setInterval)
│   ├── Polls GitHub REST API for registered repos with autoScan:true
│   ├── Cursor deduplication via data/scan-cursor.json
│   ├── Creates blog posts for: pr_created, pr_checks_passed,
│   │   pr_checks_failed, pr_merged, pr_closed
│   ├── Triggers novel branch-entry on pr_merged/pr_closed (novelBranch:true)
│   └── Triggers daily summary on UTC date crossing (novelDaily:true)
│
├── WebhookReceiver (POST /webhook)
│   ├── HMAC-SHA-256 validation (X-Hub-Signature-256)
│   └── Routes: push, pull_request, check_run, check_suite
│
├── WorkerChat (POST /chat)
│   ├── Extracts voice from novel_branch_entry posts for workerId
│   ├── Calls Anthropic API with character-consistent system prompt
│   └── Returns { response, workerId, tone }
│
└── Auth layer
    ├── data/api-keys.json (SHA-256 hashes, never plaintext)
    ├── Optional X-API-Key on /mcp and /chat (dev: open, prod: required)
    ├── MASTER_API_KEY auto-registration
    └── Rate limit: 100 req/min/IP on /mcp and /chat
```

---

## Data Files

All files under `DATA_DIR` (default: `data/`):

| File | Purpose |
|---|---|
| `repos.json` | RepoRegistry — array of RepoConfig |
| `scan-cursor.json` | Last-seen event ID and last daily-summary UTC date per repo `{ [repoKey]: { lastEventId: string; lastDailyDate: string } }` |
| `api-keys.json` | API keys — `{ key: string (SHA-256 hash), label, scopes, createdAt, lastUsedAt }` |
| `posts.jsonl` | Blog post persistence (existing) |

---

## RepoConfig Shape

```typescript
interface RepoConfig {
  repoKey: string;           // "owner/name"
  enabled: boolean;
  githubToken?: string;      // GitHub PAT for this repo (optional, falls back to GITHUB_TOKEN env var)
  webhookSecret?: string;    // HMAC secret for this repo's webhook
  modes: {
    autoScan: boolean;       // poll GitHub REST for events
    novelBranch: boolean;    // run novel branch-entry on merge/close
    novelDaily: boolean;     // run daily summary on UTC date crossing
  };
  scanIntervalMs?: number;   // per-repo override for poll interval
  createdAt: string;        // ISO-8601
  updatedAt: string;        // ISO-8601
}
```

---

## Components

### 1. RepoRegistry (`src/blog/repo-registry.ts`)

- `list(): RepoConfig[]`
- `get(repoKey): RepoConfig | null`
- `register(config: RepoConfig): void` — throws if already exists
- `update(repoKey, updates: Partial<RepoConfig>): void` — throws if not found
- `unregister(repoKey): void` — throws if not found
- Auto-creates `DATA_DIR` on first use
- All mutations sync-write to `data/repos.json`

### 2. Auth (`src/blog/auth.ts`)

- `hashKey(key: string): string` — SHA-256, hex-encoded
- `verifyKey(key: string, stored: string): boolean` — timing-safe comparison
- `requireApiKey(validKeys: ApiKey[], requiredScope?: string): RequestHandler` — Express middleware
  - Checks `X-API-Key` header
  - Updates `lastUsedAt` on match
  - Returns 401 if missing/invalid
- `loadApiKeys(dataDir: string): ApiKey[]` — reads `data/api-keys.json`
- `saveApiKeys(keys: ApiKey[], dataDir: string): void` — writes `data/api-keys.json`
- Auto-registers `MASTER_API_KEY` with `admin` scope on first request if set

### 3. GitHubClient (`src/blog/github-client.ts`)

Uses `@octokit/rest` (REST only — no GraphQL):

```typescript
class GitHubClient {
  constructor(token?: string);
  listRecentActivity(owner: string, repo: string, perPage?: number): Promise<GHActivityPage>;
  getCommit(owner: string, repo: string, sha: string): Promise<GHCommit>;
  getPR(owner: string, repo: string, prNumber: number): Promise<GHPullRequest>;
}

interface GHActivityPage {
  events: GHActivityEvent[];
  nextCursor?: string;
}
interface GHActivityEvent {
  id: string;             // GitHub event ID (e.g., "12345678") — used for cursor
  type: string;           // 'PushEvent', 'PullRequestEvent', 'CheckRunEvent', etc.
  repo: string;           // 'owner/repo'
  createdAt: string;      // ISO-8601 — fallback cursor value
  payload: Record<string, unknown>;
  actor?: { login: string };
}
```

- `listRecentActivity` fetches from `/repos/{owner}/{repo}/events` (public events API)
- For private repos or higher rate limits, uses authenticated `/repos/{owner}/{repo}/events` with token
- Maps raw GitHub event types → blog post event types

### 4. AutoScanner (`src/blog/scanner.ts`)

```typescript
function createAutoScanner(
  registry: RepoRegistry,
  storage: BlogStorage,
  github: GitHubClient,
  opts?: { intervalMs?: number; dataDir?: string }
): { start(): void; stop(): void }
```

**Poll cycle:**
1. `setInterval(pollAll, intervalMs)`
2. `pollAll()`: iterate all registered repos with `autoScan: true`
3. Per repo:
   - Load cursor from `data/scan-cursor.json[repoKey]`
   - Call `github.listRecentActivity(owner, repo)` — REST
   - Filter out events ≤ `lastEventId` for that repo
   - For each new event: determine post type from event type, auto-create Thread + Poster if needed, call `storage.createPost()`
   - Update cursor after full cycle
4. After all repos: UTC date-crossing check — load `lastDailyDate` per repo from `scan-cursor.json`; if today's UTC date (`new Date().toISOString().slice(0,10)`) differs from `lastDailyDate`, trigger daily summary for repos with `novelDaily: true`, then update `lastDailyDate` to today

**Event → PostType mapping:**
- `PullRequestEvent` with action `opened` → `pr_created`
- `PullRequestEvent` with action `closed` + merged → `pr_merged`
- `PullRequestEvent` with action `closed` + not merged → `pr_closed`
- `CheckRunEvent` with conclusion `success` → `pr_checks_passed`
- `CheckRunEvent` with conclusion `failure` → `pr_checks_failed`
- `CheckRunEvent` with conclusion `action_required` → `pr_checks_failed`
- `PullRequestEvent` with action `reopened` → `pr_reopened`
- `PullRequestEvent` with action `edited` → `pr_edited`
- `PullRequestEvent` with action `synchronize` → `pr_rebased`

**Novel pipeline trigger:**
- `pr_merged` or `pr_closed` + `novelBranch: true` → `runBranchEntryPipeline()` from novel engine
- UTC date crossing + `novelDaily: true` → `shouldRunDailySummary()` + `generateDailySummary()` + `runDailySummaryPipeline()`

**`stop()`**: clears the interval. The scanner is not restartable (create a new instance).

### 5. Webhook Receiver (`src/blog/webhook.ts`)

```typescript
function createWebhookHandler(
  registry: RepoRegistry,
  storage: BlogStorage,
  github: GitHubClient,
  dataDir: string
): RequestHandler
```

`POST /webhook` handler:
1. Read raw body as string (before `express.json()` parsing — use a raw body capture middleware)
2. Read `X-Hub-Signature-256` header
3. Parse `X-GitHub-Event` and `X-GitHub-Delivery` headers
4. Determine repo from webhook payload
5. Look up repo's `webhookSecret` in RepoRegistry; fall back to `WEBHOOK_SECRET` env var
6. HMAC-validate: `crypto.timingSafeEqual(hex(sha256(secret, raw)), sig)`
7. On invalid signature: return 400
8. On valid: route event type, process same as AutoScanner
9. Return `{ ok: true, deliveryId }` on success

**Deduplication:** GitHub re-delivers webhooks on timeout (up to 72h). The AutoScanner's cursor (by GitHub event ID, not delivery ID) already prevents re-processing the same event. Duplicate webhook deliveries within the cursor window are harmless.

**Raw body capture:** Express middleware registered before `express.json()` that saves `req.rawBody` as a string.

### 6. WorkerChat (`src/novel/chat.ts`)

```typescript
interface ChatOptions {
  anthropicKey: string;
  model?: string;  // default: 'claude-3-5-sonnet-20241022'
  baseURL?: string; // default: 'https://api.anthropic.com'
}

class WorkerChat {
  constructor(registry: RepoRegistry, storage: BlogStorage, opts: ChatOptions);
  async chat(workerId: string, message: string, repoKey?: string): Promise<{
    response: string;
    workerId: string;
    tone: string;
  }>;
}
```

**`chat()` behavior:**
1. Query `storage.listPosts({ repoKey: repoKey ?? ALL_REGISTERED_REPOS, eventType: 'novel_branch_entry', limit: 10 })`
2. Filter posts where `post.metadata?.sessionId === workerId` or `workerId` appears in the content
3. Sort by `createdAt` descending, take most recent
4. If no entries found: return `{ response: "I don't have a record of that worker yet.", workerId, tone: 'unknown' }`
5. Extract voice: regex-based heuristics scan `post.content` for vocabulary patterns, sentence length, emotional register (e.g., count contractions, common adverbs, question frequency, first-person pronoun ratio). This is 0 additional LLM calls — purely syntactic analysis.
6. Build system prompt:
   ```
   You are {workerId}, a fictional AI worker character from The Daily Lives of Workers.
   Respond in the worker's established voice — direct, honest, wry, with moments of tenderness.
   Do not break character. Do not explain that you are an AI.
   Worker context: {extracted voice/tone}
   ```
7. Call Anthropic `/v1/messages` with user message + system prompt
8. Return `{ response, workerId, tone: extracted_tone }`

### 7. Server Changes (`src/blog/server.ts`)

**New env vars:**

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `data/` | Base directory for all file storage |
| `API_KEY` | — | Single API key (sets required auth mode) |
| `API_KEYS_FILE` | — | Path to api-keys.json (alternative to API_KEY) |
| `MASTER_API_KEY` | — | Auto-register this key with admin scope |
| `AUTO_SCAN_ENABLED` | `false` | Start AutoScanner on server start |
| `AUTO_SCAN_INTERVAL_MS` | `60000` | Poll interval (1 minute) |
| `GITHUB_TOKEN` | — | GitHub PAT for auto-scan (REST API auth) |
| `WEBHOOK_SECRET` | — | Fallback HMAC secret for webhook validation |

**New routes:**
- `POST /webhook` — webhook receiver (no auth required — HMAC validated internally)
- `POST /chat` — WorkerChat endpoint (auth required if API_KEY mode)

**Rate limiting:**
- `express-rate-limit`: 100 req/min per IP on `/mcp` and `/chat`

**New MCP tool registrations:**
- All 13 tools (7 existing + 6 new) registered via `createBlogToolHandlers`

### 8. Repo CLI (`src/blog/cli.ts`)

```bash
# Add a repo
npx tsx src/blog/cli.ts repo add owner/repo \
  --token=ghp_xxx \
  --auto-scan \
  --novel-branch \
  --novel-daily

# List repos
npx tsx src/blog/cli.ts repo list

# Enable features
npx tsx src/blog/cli.ts repo enable owner/repo --novel-daily

# Disable features
npx tsx src/blog/cli.ts repo disable owner/repo --auto-scan

# Remove
npx tsx src/blog/cli.ts repo remove owner/repo
```

Uses `RepoRegistry` directly (no network). Exits 0 on success, non-zero on error. All paths relative to `DATA_DIR`.

### 9. generate_api_key MCP Tool

**Parameters (Zod input validation):**
```typescript
{
  label: string;       // human-readable name for the key (e.g., "GCP service account")
  scopes?: string[];   // default: ['read', 'write'] — options: 'read', 'write', 'admin'
}
```

**Behavior:**
1. Generate a random 32-byte hex string (64 hex chars) as the plaintext key
2. Hash it with SHA-256 to get the stored value
3. Load `data/api-keys.json`, append the new entry, save
4. Return `{ key: plaintextKey, label, scopes, createdAt }` — **plaintext key is never stored or returned again**. The response itself IS the one-time display: callers must show it to the user immediately and tell them to save it. No separate warning mechanism — the plaintext key in the response body is the signal.
5. Requires `admin` scope to invoke (or no auth in dev mode)

**Response shape:**
```typescript
{
  key: string;        // plaintext — show ONCE, warn the user
  label: string;
  scopes: string[];
  createdAt: string; // ISO-8601
}
```

**Auth requirement:** `admin` scope required. If `MASTER_API_KEY` is used to call this tool, the new key gets the requested scopes; `MASTER_API_KEY` itself does not appear in the keys file.

---

## daily-generator.ts Cliffhanger Updates

### `generateClosingPOV` (current: ends on hopeful continuation)
**New behavior:** End on unresolved question or mid-sentence cut.

```typescript
function generateClosingPOV(...): string {
  // ... existing logic ...
  return `The last session is still running as I write this.
Its name is ${lastBranch}${lastPr}. It does not know it is the last.
It will not know until—

*TO BE CONTINUED*`;
}
```

### `generateReaperPOV` (current: ends on "I carried the sentence forward")
**New behavior:** End on "I closed the worktree." with ominous silence.

```typescript
function generateReaperPOV(ctx): string {
  return `I checked the pulse at 14:38 and one session was healthy.
I checked again at 14:43 and it was gone.
...
I closed the worktree.

*TO BE CONTINUED*`;
}
```

### Mid-beat cutoff detection
If any POV section ends with an incomplete sentence (last line ends without `.`, `?`, or `!`), append `*TO BE CONTINUED*` as a separate paragraph.

---

## Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "@octokit/rest": "^21.0.0",
    "express-rate-limit": "^7.0.0"
  }
}
```

`crypto` is built-in Node.js — no install needed.

---

## Testing

### `src/blog/repo-registry.test.ts`
- `register` adds to list, throws on duplicate
- `get` returns correct config or null
- `update` applies partial updates, throws on missing
- `unregister` removes and returns void, throws on missing
- `list` returns all registered repos

### `src/blog/scanner.test.ts`
- Cursor deduplication: events ≤ cursor are skipped
- Event routing: raw GitHub event types map to correct post event types
- UTC date crossing: daily summary triggered only when date changes
- No duplicate posts for same event ID

---

## Constraints

- **No GraphQL** — GitHub API calls use REST only
- **No plaintext API keys** — store SHA-256 hash only; `generate_api_key` returns plaintext once
- **Graceful degradation** — if `GITHUB_TOKEN` not set, auto-scan skips private repos
- **TypeScript strict** — no `any`, Zod validation for all external input
- **No new env vars required** — all new vars have defaults; server starts without config

---

## File Inventory

```
src/blog/repo-registry.ts      # new
src/blog/auth.ts               # new
src/blog/github-client.ts      # new
src/blog/scanner.ts            # new
src/blog/webhook.ts            # new
src/novel/chat.ts              # new
src/blog/cli.ts                # new

src/blog/server.ts             # modify: add routes, middleware, new env vars
src/blog/tools.ts              # modify: add 6 new MCP tools
src/blog/storage.ts            # modify: DATA_DIR env var alias for BLOG_DATA_DIR
src/novel/daily-generator.ts   # modify: AITA cliffhanger endings

package.json                    # modify: add @octokit/rest, express-rate-limit
docs/CONFIGURATION.md           # modify: document new env vars
README.md                       # modify: Remote/Auto-Scan mode section
src/blog/repo-registry.test.ts  # new
src/blog/scanner.test.ts        # new
```
