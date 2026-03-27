# Remote Mode + Auto-Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Remote Mode + Auto-Scan Architecture to the living blog: per-repo GitHub REST polling, API key auth, webhook receiver, and WorkerChat endpoint.

**Architecture:** Layered on the existing Express MCP server. New modules own their own domain. AutoScanner runs as a background `setInterval`. API key auth is middleware-based. All new env vars have defaults — server works without any config.

**Tech Stack:** TypeScript ESM, `@octokit/rest` (REST only, no GraphQL), `express-rate-limit`, Node.js `crypto` (built-in), Zod for all external input validation.

---

## File Map

| File | Action |
|---|---|
| `src/blog/repo-registry.ts` | Create |
| `src/blog/auth.ts` | Create |
| `src/blog/github-client.ts` | Create |
| `src/blog/scanner.ts` | Create |
| `src/blog/webhook.ts` | Create |
| `src/novel/chat.ts` | Create |
| `src/blog/cli.ts` | Create |
| `src/blog/tools.ts` | Modify — add 6 new MCP tools |
| `src/blog/server.ts` | Modify — wire auth, routes, scanner |
| `src/blog/storage.ts` | Modify — DATA_DIR alias |
| `src/novel/daily-generator.ts` | Modify — AITA cliffhanger endings |
| `package.json` | Modify — add deps |
| `docs/CONFIGURATION.md` | Modify — document new env vars |
| `README.md` | Modify — Remote/Auto-Scan section |
| `src/blog/repo-registry.test.ts` | Create |
| `src/blog/scanner.test.ts` | Create |

---

## Task 1: Dependencies + package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependencies**

```json
// Add to "dependencies":
"@octokit/rest": "^21.0.0",
"express-rate-limit": "^7.0.0"
```

Run: `npm install`
Expected: packages install without errors

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @octokit/rest and express-rate-limit"
```

---

## Task 2: RepoRegistry

**Files:**
- Create: `src/blog/repo-registry.ts`
- Test: `src/blog/repo-registry.test.ts`

### Interface to implement

```typescript
// Zod schema for RepoConfig
export const RepoConfigSchema = z.object({
  repoKey: z.string().regex(/^[^/]+\/[^/]+$/),
  enabled: z.boolean(),
  githubToken: z.string().optional(),
  webhookSecret: z.string().optional(),
  modes: z.object({
    autoScan: z.boolean(),
    novelBranch: z.boolean(),
    novelDaily: z.boolean(),
  }),
  scanIntervalMs: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export class RepoRegistry {
  constructor(dataDir: string);
  list(): RepoConfig[];
  get(repoKey: string): RepoConfig | null;
  register(config: RepoConfig): void;  // throws if duplicate
  update(repoKey: string, updates: Partial<RepoConfig>): void;  // throws if not found
  unregister(repoKey: string): void;  // throws if not found
}
```

### Tests

```typescript
// src/blog/repo-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RepoRegistry } from './repo-registry.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('RepoRegistry', () => {
  const testDir = join(process.cwd(), 'test-data-repos-' + Date.now());
  beforeEach(() => { mkdirSync(testDir, { recursive: true }); });
  afterEach(() => { rmSync(testDir, { recursive: true }); });

  it('register adds a repo and get returns it', () => {
    const r = new RepoRegistry(testDir);
    const cfg = { repoKey: 'owner/repo', enabled: true, modes: { autoScan: true, novelBranch: false, novelDaily: false }, createdAt: '', updatedAt: '' };
    r.register(cfg);
    expect(r.get('owner/repo')).toMatchObject({ repoKey: 'owner/repo', enabled: true });
  });

  it('register throws on duplicate', () => {
    const r = new RepoRegistry(testDir);
    const cfg = { repoKey: 'owner/repo', enabled: true, modes: { autoScan: true, novelBranch: false, novelDaily: false }, createdAt: '', updatedAt: '' };
    r.register(cfg);
    expect(() => r.register(cfg)).toThrow('already exists');
  });

  it('get returns null for unknown repo', () => {
    const r = new RepoRegistry(testDir);
    expect(r.get('owner/nonexistent')).toBeNull();
  });

  it('update applies partial updates', () => {
    const r = new RepoRegistry(testDir);
    r.register({ repoKey: 'owner/repo', enabled: true, modes: { autoScan: true, novelBranch: false, novelDaily: false }, createdAt: '', updatedAt: '' });
    r.update('owner/repo', { enabled: false });
    expect(r.get('owner/repo')!.enabled).toBe(false);
  });

  it('update throws on unknown repo', () => {
    const r = new RepoRegistry(testDir);
    expect(() => r.update('owner/nonexistent', { enabled: false })).toThrow('not found');
  });

  it('unregister removes and list is empty', () => {
    const r = new RepoRegistry(testDir);
    r.register({ repoKey: 'owner/repo', enabled: true, modes: { autoScan: true, novelBranch: false, novelDaily: false }, createdAt: '', updatedAt: '' });
    r.unregister('owner/repo');
    expect(r.list()).toEqual([]);
  });

  it('list returns all registered repos', () => {
    const r = new RepoRegistry(testDir);
    r.register({ repoKey: 'owner/repo1', enabled: true, modes: { autoScan: true, novelBranch: false, novelDaily: false }, createdAt: '', updatedAt: '' });
    r.register({ repoKey: 'owner/repo2', enabled: false, modes: { autoScan: false, novelBranch: true, novelDaily: false }, createdAt: '', updatedAt: '' });
    expect(r.list()).toHaveLength(2);
  });
});
```

Run tests: `npx vitest run src/blog/repo-registry.test.ts`
Expected: all pass

---

## Task 3: Auth

**Files:**
- Create: `src/blog/auth.ts`

### Interface to implement

```typescript
export interface ApiKey {
  key: string;        // SHA-256 hash, never plaintext
  label: string;
  scopes: string[];    // 'read' | 'write' | 'admin'
  createdAt: string;
  lastUsedAt?: string;
}

export function hashKey(key: string): string;                          // SHA-256 hex
export function verifyKey(key: string, stored: string): boolean;     // timing-safe

export function requireApiKey(
  keys: ApiKey[],
  requiredScope?: string
): (req: Request, res: Response, next: NextFunction) => void;  // Express middleware

export function loadApiKeys(dataDir: string): ApiKey[];
export function saveApiKeys(keys: ApiKey[], dataDir: string): void;
```

### Key implementation notes

- `hashKey`: `crypto.createHash('sha256').update(key).digest('hex')`
- `verifyKey`: use `crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored))` — NOTE: must hash the input key first, then compare to stored hash. `stored` is already a hash.
- `requireApiKey` middleware: extract `X-API-Key` header → hash it → compare against all stored key hashes → if match and key has required scope → set `req.apiKey = matchedKey` → update `lastUsedAt` → call `next()`; else return 401
- `MASTER_API_KEY` auto-registration happens in `server.ts` on first request, not in `auth.ts`

### Tests (add to `src/blog/repo-registry.test.ts` or a new `auth.test.ts`)

```typescript
import { it, expect } from 'vitest';
import { hashKey, verifyKey } from './auth.js';

it('hashKey produces consistent hex output', () => {
  const h = hashKey('test-key-abc123');
  expect(h).toHaveLength(64);  // SHA-256 hex
  expect(h).toBe(hashKey('test-key-abc123'));
});

it('hashKey differs for different inputs', () => {
  expect(hashKey('key1')).not.toBe(hashKey('key2'));
});

it('verifyKey returns true for matching key', () => {
  const plain = 'my-secret-key';
  const stored = hashKey(plain);
  expect(verifyKey(plain, stored)).toBe(true);
});

it('verifyKey returns false for non-matching key', () => {
  const stored = hashKey('correct-key');
  expect(verifyKey('wrong-key', stored)).toBe(false);
});
```

Run tests: `npx vitest run src/blog/auth.test.ts`
Expected: all pass

---

## Task 4: GitHubClient

**Files:**
- Create: `src/blog/github-client.ts`

### Interface to implement

```typescript
export interface GHActivityEvent {
  id: string;
  type: string;
  repo: string;
  createdAt: string;
  payload: Record<string, unknown>;
  actor?: { login: string };
}

export interface GHActivityPage {
  events: GHActivityEvent[];
  nextCursor?: string;
}

export interface GHCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
}

export interface GHPullRequest {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  url: string;
}

export class GitHubClient {
  constructor(token?: string);
  listRecentActivity(owner: string, repo: string, perPage?: number): Promise<GHActivityPage>;
  getCommit(owner: string, repo: string, sha: string): Promise<GHCommit>;
  getPR(owner: string, repo: string, prNumber: number): Promise<GHPullRequest>;
}
```

### Implementation notes

- Import `Octokit` from `@octokit/rest`
- Constructor: `this.octokit = new Octokit({ auth: token })`
- `listRecentActivity`: `GET /repos/{owner}/{repo}/events` — returns `data` array. Map to `GHActivityEvent[]`.
- `getCommit`: `GET /repos/{owner}/{repo}/commits/{sha}` — return `{ sha, commit: { message, author: { name, date } } }`
- `getPR`: `GET /repos/{owner}/{repo}/pulls/{pull_number}` — return `{ number, title, state, merged, url }`
- All methods: `return { events: data.map(...) }` — the `GHActivityPage` shape wraps the array (nextCursor unused in v1 but declared for future pagination)

---

## Task 5: AutoScanner

**Files:**
- Create: `src/blog/scanner.ts`
- Test: `src/blog/scanner.test.ts`

### Interface to implement

```typescript
export function createAutoScanner(
  registry: RepoRegistry,
  storage: BlogStorage,
  github: GitHubClient,
  opts?: { intervalMs?: number; dataDir?: string }
): { start(): void; stop(): void }
```

### Cursor shape

```typescript
// data/scan-cursor.json
interface ScanCursor {
  [repoKey: string]: {
    lastEventId: string;
    lastDailyDate: string;  // YYYY-MM-DD UTC
  };
}
```

### Event → PostEventType mapping (implement as a function `mapGitHubEventToPostType`)

| GitHub event | Condition | Post type |
|---|---|---|
| `PullRequestEvent` | action=opened | `pr_created` |
| `PullRequestEvent` | action=closed + merged | `pr_merged` |
| `PullRequestEvent` | action=closed + !merged | `pr_closed` |
| `PullRequestEvent` | action=reopened | `pr_reopened` |
| `PullRequestEvent` | action=edited | `pr_edited` |
| `PullRequestEvent` | action=synchronize | `pr_rebased` |
| `CheckRunEvent` | conclusion=success | `pr_checks_passed` |
| `CheckRunEvent` | conclusion=failure | `pr_checks_failed` |
| `CheckRunEvent` | conclusion=action_required | `pr_checks_failed` |

### Tests

```typescript
// src/blog/scanner.test.ts
import { describe, it, expect } from 'vitest';
import { mapGitHubEventToPostType, type GHActivityEvent } from './scanner.js';

function makeEvent(type: string, action: string, conclusion?: string): GHActivityEvent {
  return { id: '1', type, repo: 'o/r', createdAt: '', payload: { action, conclusion } as Record<string, unknown>, actor: undefined };
}

it('maps PullRequest opened to pr_created', () => {
  expect(mapGitHubEventToPostType(makeEvent('PullRequestEvent', 'opened'))).toBe('pr_created');
});

it('maps PullRequest closed+merged to pr_merged', () => {
  const ev = makeEvent('PullRequestEvent', 'closed');
  ev.payload = { action: 'closed', pull_request: { merged: true } };
  expect(mapGitHubEventToPostType(ev)).toBe('pr_merged');
});

it('maps PullRequest closed+!merged to pr_closed', () => {
  const ev = makeEvent('PullRequestEvent', 'closed');
  ev.payload = { action: 'closed', pull_request: { merged: false } };
  expect(mapGitHubEventToPostType(ev)).toBe('pr_closed');
});

it('maps CheckRunEvent success to pr_checks_passed', () => {
  expect(mapGitHubEventToPostType(makeEvent('CheckRunEvent', '', 'success'))).toBe('pr_checks_passed');
});

it('maps CheckRunEvent failure to pr_checks_failed', () => {
  expect(mapGitHubEventToPostType(makeEvent('CheckRunEvent', '', 'failure'))).toBe('pr_checks_failed');
});

it('skips events after cursor', async () => {
  // TODO: implement integration test with mock storage + registry
});

it('triggers daily summary only on UTC date crossing', async () => {
  // TODO: implement integration test with mock storage + registry
});
```

### Auto-create Thread + Poster for scanned events

For each new event, call `storage.getOrCreatePoster({ id: actorLogin ?? 'github-webhook', name: actorLogin ?? 'GitHub', type: 'ao_worker' })` and `storage.createThread(...)` if no thread for this PR exists yet.

---

## Task 6: Webhook Receiver

**Files:**
- Create: `src/blog/webhook.ts`

### Interface to implement

```typescript
export function createWebhookHandler(
  registry: RepoRegistry,
  storage: BlogStorage,
  github: GitHubClient,
  dataDir: string
): (req: Request, res: Response) => Promise<void>;
```

### Raw body capture middleware

```typescript
// In server.ts, BEFORE express.json():
app.use('/webhook', express.text({ type: '*/*' }));
// Then in webhook handler: req.body is already the raw string
```

### HMAC validation

```typescript
function validateHmac(secret: string, rawBody: string, signature: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
```

### Route event to post type

Reuse `mapGitHubEventToPostType` from scanner module.

---

## Task 7: WorkerChat

**Files:**
- Create: `src/novel/chat.ts`

### Interface to implement

```typescript
export interface ChatOptions {
  anthropicKey: string;
  model?: string;
  baseURL?: string;
}

export class WorkerChat {
  constructor(registry: RepoRegistry, storage: BlogStorage, opts: ChatOptions);
  async chat(workerId: string, message: string, repoKey: string): Promise<{
    response: string;
    workerId: string;
    tone: string;
  }>;
}
```

### Voice extraction (regex heuristics, 0 LLM calls)

```typescript
function extractVoice(content: string): { tone: string; patterns: string[] } {
  const sentences = content.split(/[.!?]+/).filter(Boolean);
  const avgLen = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / Math.max(sentences.length, 1);
  const questionCount = (content.match(/\?/g) || []).length;
  const contractions = (content.match(/\b\w+'\w+\b/g) || []).length;
  const firstPerson = (content.match(/\b(I|me|my|we|our)\b/gi) || []).length;
  const words = content.split(/\s+/).length;

  const patterns: string[] = [];
  if (contractions / Math.max(words, 1) > 0.03) patterns.push('contracted');
  if (questionCount / Math.max(sentences.length, 1) > 0.1) patterns.push('inquisitive');
  if (avgLen > 20) patterns.push('formal');
  else if (avgLen < 10) patterns.push('staccato');
  if (firstPerson / Math.max(words, 1) > 0.05) patterns.push('introspective');

  const tone = patterns.length > 0 ? patterns.join(', ') : 'neutral';
  return { tone, patterns };
}
```

### Anthropic API call

```typescript
async function callAnthropic(opts: ChatOptions, systemPrompt: string, userMessage: string): Promise<string> {
  const { anthropicKey, model = 'claude-3-5-sonnet-20241022', baseURL = 'https://api.anthropic.com' } = opts;
  const res = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock?.text ?? '';
}
```

---

## Task 8: New MCP Tools

**Files:**
- Modify: `src/blog/tools.ts`

Add to `BlogToolContext`:
```typescript
export interface BlogToolContext {
  storage: BlogStorage;
  agentId: string;
  registry?: RepoRegistry;       // new
  auth?: { requireApiKey: typeof import('./auth.js').requireApiKey; validKeys: import('./auth.js').ApiKey[] };
}
```

### New tool schemas + handlers

```typescript
// Register repo
export const RegisterRepoParamsSchema = z.object({
  repoKey: RepoKeySchema,
  enabled: z.boolean().default(true),
  githubToken: z.string().optional(),
  webhookSecret: z.string().optional(),
  modes: z.object({
    autoScan: z.boolean().default(false),
    novelBranch: z.boolean().default(false),
    novelDaily: z.boolean().default(false),
  }).optional(),
  scanIntervalMs: z.number().int().positive().optional(),
});

// Unregister repo
export const UnregisterRepoParamsSchema = z.object({
  repoKey: RepoKeySchema,
});

// List repos
export const ListReposParamsSchema = z.object({});

// Update repo
export const UpdateRepoParamsSchema = z.object({
  repoKey: RepoKeySchema,
  enabled: z.boolean().optional(),
  modes: z.object({
    autoScan: z.boolean().optional(),
    novelBranch: z.boolean().optional(),
    novelDaily: z.boolean().optional(),
  }).optional(),
  scanIntervalMs: z.number().int().positive().optional(),
  githubToken: z.string().optional(),
  webhookSecret: z.string().optional(),
});

// Generate API key
export const GenerateApiKeyParamsSchema = z.object({
  label: z.string().min(1),
  scopes: z.array(z.enum(['read', 'write', 'admin'])).default(['read', 'write']),
});

// Chat worker
export const ChatWorkerParamsSchema = z.object({
  workerId: z.string().min(1),
  message: z.string().min(1),
  repoKey: RepoKeySchema,
});
```

Add handlers: `register_repo`, `unregister_repo`, `list_repos`, `update_repo`, `generate_api_key`, `chat_worker` — each uses `toMcpResult` / `toMcpError` pattern matching existing tools.

---

## Task 9: daily-generator.ts Cliffhanger Endings

**Files:**
- Modify: `src/novel/daily-generator.ts`

### Changes

1. **Add `endsMidBeat(text: string): boolean`** helper:
```typescript
function endsMidBeat(text: string): boolean {
  const trimmed = text.trimEnd();
  const last = trimmed[trimmed.length - 1];
  return !['.', '?', '!'].includes(last);
}
```

2. **Modify `generateClosingPOV`** — add unresolved tension ending:
```typescript
function generateClosingPOV(posts: Post[], threads: string[], dayNumber: number, date: string): string {
  const chron = [...posts].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const lastPost = chron[chron.length - 1];
  const lastBranch = lastPost?.metadata?.branchName ?? 'the-last-session';
  const lastPr = lastPost?.metadata?.prNumber ? ` PR #${lastPost.metadata.prNumber}` : '';

  let body = `The last session is still running as I write this.
Its name is ${lastBranch}${lastPr}. It does not know it is the last.
It will not know until—`;

  if (endsMidBeat(body)) {
    body += '\n\n*TO BE CONTINUED*';
  }
  return body;
}
```

3. **Modify `generateReaperPOV`** — end on "I closed the worktree.":
```typescript
function generateReaperPOV(ctx: { threads: number; totalPosts: number; errors: number; date: string }): string {
  let body = `I checked the pulse at 14:38 and one session was healthy.
I checked again at 14:43 and it was gone.
The worktree was orphaned. The file was saved but unfinished.
This is the ${ctx.errors}${ctx.errors === 1 ? 'st' : 'nd'} time this week a session ended with something to say.
I do not read the files. I am not supposed to. But today I read the last file before I closed the worktree, and it said:
*Someone will read this tomorrow and know someone was here.*
I closed the worktree.`;

  if (endsMidBeat(body)) {
    body += '\n\n*TO BE CONTINUED*';
  }
  return body;
}
```

---

## Task 10: Server Wiring

**Files:**
- Modify: `src/blog/server.ts`

### Changes

1. **Read new env vars** (after existing env vars):
```typescript
const DATA_DIR = process.env['DATA_DIR'] ?? 'data/';
const API_KEY = process.env['API_KEY'];
const API_KEYS_FILE = process.env['API_KEYS_FILE'];
const MASTER_API_KEY = process.env['MASTER_API_KEY'];
const AUTO_SCAN_ENABLED = process.env['AUTO_SCAN_ENABLED'] === 'true';
const AUTO_SCAN_INTERVAL_MS = Number(process.env['AUTO_SCAN_INTERVAL_MS'] ?? '60000');
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'];
const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET'];
```

2. **Initialize RepoRegistry**:
```typescript
const registry = new RepoRegistry(DATA_DIR);
```

3. **Initialize GitHubClient** (for scanner):
```typescript
const github = new GitHubClient(GITHUB_TOKEN);
```

4. **Load API keys + apply auth middleware** (before routes):
```typescript
const authEnabled = !!(API_KEY || API_KEYS_FILE);
let validKeys: ApiKey[] = [];
if (authEnabled) {
  validKeys = loadApiKeys(DATA_DIR);
  // Auto-register MASTER_API_KEY if provided and not already in list
  if (MASTER_API_KEY && !validKeys.some(k => hashKey(MASTER_API_KEY!) === k.key)) {
    validKeys.push({ key: hashKey(MASTER_API_KEY!), label: 'MASTER_API_KEY', scopes: ['admin'], createdAt: new Date().toISOString() });
    saveApiKeys(validKeys, DATA_DIR);
  }
  app.use('/mcp', requireApiKey(validKeys));
  app.use('/chat', requireApiKey(validKeys));
}
```

5. **Rate limiting** (after CORS, before routes):
```typescript
import rateLimit from 'express-rate-limit';
app.use('/mcp', rateLimit({ windowMs: 60_000, max: 100 }));
app.use('/chat', rateLimit({ windowMs: 60_000, max: 100 }));
```

6. **Raw body for webhook** (before `express.json()`):
```typescript
app.use('/webhook', express.text({ type: '*/*' }));
```

7. **Routes**:
```typescript
// POST /webhook
import { createWebhookHandler } from './webhook.js';
app.use('/webhook', createWebhookHandler(registry, storage, github, DATA_DIR));

// POST /chat
import { WorkerChat } from '../novel/chat.js';
const chat = new WorkerChat(registry, storage, { anthropicKey: process.env['ANTHROPIC_API_KEY'] ?? '' });
app.post('/chat', async (req, res) => {
  try {
    const { workerId, message, repoKey } = req.body;
    const result = await chat.chat(workerId, message, repoKey);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
```

8. **AutoScanner start** (after `server.listen`):
```typescript
if (AUTO_SCAN_ENABLED) {
  import { createAutoScanner } from './scanner.js';
  const scanner = createAutoScanner(registry, storage, github, { intervalMs: AUTO_SCAN_INTERVAL_MS, dataDir: DATA_DIR });
  scanner.start();
}
```

9. **Graceful shutdown**: stop scanner on SIGINT/SIGTERM.

---

## Task 11: Repo CLI

**Files:**
- Create: `src/blog/cli.ts`

### Commands

- `repo add <repoKey>` — `register()`
- `repo list` — `list()`
- `repo enable <repoKey> [--auto-scan] [--novel-branch] [--novel-daily]` — `update()` with mode merges
- `repo disable <repoKey> [--auto-scan] [--novel-branch] [--novel-daily]` — `update()` with mode false
- `repo remove <repoKey>` — `unregister()`

Parse args with a simple switch on `process.argv[2]`. Use `DATA_DIR` from env. Exit non-zero on error.

---

## Task 12: storage.ts DATA_DIR alias

**Files:**
- Modify: `src/blog/storage.ts`

Find where `BLOG_DATA_DIR` is used and add `DATA_DIR` as an alias:
```typescript
this.dataDir = process.env['BLOG_DATA_DIR'] ?? process.env['DATA_DIR'] ?? 'data/';
```

---

## Task 13: docs updates

**Files:**
- Modify: `docs/CONFIGURATION.md`
- Modify: `README.md`

Add section for Remote/Auto-Scan mode documenting all new env vars and the new CLI commands.

---

## Task 14: TypeScript build + full test suite

- [ ] Run: `npm run typecheck` — fix any type errors
- [ ] Run: `npm run build` — verify clean build
- [ ] Run: `npm test` — all tests pass
- [ ] Run: `npm run dev:blog &` then curl health + tool calls
- [ ] Commit each task with `[agento]` conventional commits
- [ ] Push branch: `git push origin feat/remote-mode-auto-scan`
- [ ] Create PR against `main`
- [ ] Post `@coderabbitai all good?` on PR
