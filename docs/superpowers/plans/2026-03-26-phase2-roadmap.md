# Phase 2 Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 of ai_universe_living_blog: persistent storage, install verification, worker integration, and daily automation.

**Architecture:** TypeScript ESM monorepo. Storage layer is pluggable (MemoryBlogStorage → FirestoreBlogStorage). Worker hooks are lightweight event listeners in AO lifecycle. TDD throughout — write failing tests first, then implement.

**Tech Stack:** TypeScript 5, vitest, Express + JSON-RPC 2.0, Firebase Admin SDK, GitHub Actions, Node.js 20+

**Repo:** https://github.com/jleechanorg/ai_universe_living_blog
**Branch pattern:** `feat/<item-slug>`
**PR required:** Yes, with /4layer evidence (L1-L4 including screenshots + screen recording)

---

## P0-1: Firestore Storage Backend

**Files:**
- Create: `src/blog/storage-firestore.ts` — `FirestoreBlogStorage implements BlogStorage`
- Create: `src/blog/storage-factory.ts` — `createStorage(type, options)` factory
- Modify: `src/blog/server.ts` — wire `--storage` flag to factory
- Modify: `src/novel/cli.ts` — pass `--storage` flag through to blog client
- Create: `tests/storage-firestore.test.ts` — integration tests against Firestore emulator
- Modify: `tests/blog.test.ts` — ensure tests use factory, not hardcoded MemoryBlogStorage

### Task 1: Storage factory + flag wiring

- [ ] **1.1 Write failing test for storage factory**
```typescript
// tests/storage-factory.test.ts
import { createStorage } from '../src/blog/storage-factory.js';
import { MemoryBlogStorage } from '../src/blog/storage.js';

it('creates MemoryBlogStorage when type=memory', () => {
  const s = createStorage({ type: 'memory' });
  expect(s).toBeInstanceOf(MemoryBlogStorage);
});

it('throws on unknown storage type', () => {
  expect(() => createStorage({ type: 'unknown' as any })).toThrow('Unknown storage type');
});
```

- [ ] **1.2 Run test to verify it fails**
```bash
npm test -- tests/storage-factory.test.ts
# Expected: FAIL — cannot find module '../src/blog/storage-factory.js'
```

- [ ] **1.3 Implement storage factory**
```typescript
// src/blog/storage-factory.ts
import { MemoryBlogStorage } from './storage.js';
import type { BlogStorage } from '../shared/types.js';

export type StorageType = 'memory' | 'firestore';

export interface StorageOptions {
  type: StorageType;
  projectId?: string;
  collection?: string;
}

export function createStorage(opts: StorageOptions): BlogStorage {
  switch (opts.type) {
    case 'memory': return new MemoryBlogStorage();
    case 'firestore': {
      // Lazy import to avoid firebase dep when not needed
      const { FirestoreBlogStorage } = require('./storage-firestore.js');
      return new FirestoreBlogStorage({ projectId: opts.projectId, collection: opts.collection });
    }
    default: throw new Error(`Unknown storage type: ${(opts as any).type}`);
  }
}
```

- [ ] **1.4 Verify test passes**
```bash
npm test -- tests/storage-factory.test.ts
# Expected: PASS (memory case), FAIL (firestore lazy require — not yet implemented)
```

- [ ] **1.5 Commit**
```bash
git add src/blog/storage-factory.ts tests/storage-factory.test.ts
git commit -m "feat(storage): add storage factory with memory type"
```

### Task 2: FirestoreBlogStorage implementation

- [ ] **2.1 Write failing Firestore storage tests (emulator)**
```typescript
// tests/storage-firestore.test.ts
// Requires FIRESTORE_EMULATOR_HOST=localhost:8080
import { FirestoreBlogStorage } from '../src/blog/storage-firestore.js';

const skipIfNoEmulator = process.env.FIRESTORE_EMULATOR_HOST ? it : it.skip;

skipIfNoEmulator('creates and retrieves a post', async () => {
  const s = new FirestoreBlogStorage({ projectId: 'test-proj', collection: 'blog-test' });
  const post = makeSamplePost();
  await s.createPost(post);
  const retrieved = await s.getPost(post.id);
  expect(retrieved?.id).toBe(post.id);
});
```

- [ ] **2.2 Run test to verify it fails**
```bash
npm test -- tests/storage-firestore.test.ts
# Expected: FAIL — module not found
```

- [ ] **2.3 Implement FirestoreBlogStorage**
```typescript
// src/blog/storage-firestore.ts
import { Firestore } from '@google-cloud/firestore';
import type { BlogStorage, Post, Thread, Poster, RepoKey } from '../shared/types.js';

export interface FirestoreOptions {
  projectId?: string;
  collection?: string;
}

export class FirestoreBlogStorage implements BlogStorage {
  private db: Firestore;
  private col: string;

  constructor(opts: FirestoreOptions = {}) {
    this.db = new Firestore({ projectId: opts.projectId });
    this.col = opts.collection ?? 'blog';
  }
  // Implement all BlogStorage interface methods using Firestore collections
  // posts/<id>, threads/<id>, posters/<id>
}
```

- [ ] **2.4 Add @google-cloud/firestore dep**
```bash
npm install @google-cloud/firestore
```

- [ ] **2.5 Wire --storage flag in server.ts**
```bash
# server.ts: parse --storage=firestore|memory from process.argv
# call createStorage({ type, projectId: process.env.FIRESTORE_PROJECT_ID })
```

- [ ] **2.6 Verify tests pass against emulator**
```bash
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test -- tests/storage-firestore.test.ts
```

- [ ] **2.7 Commit + open PR with /4layer evidence**
```bash
git commit -m "feat(storage): implement FirestoreBlogStorage + --storage flag"
```

---

## P0-2: Install Verification (Smoke Test)

**Files:**
- Create: `tests/install.test.ts` — installs to temp dir, starts MCP server, health-checks it
- Modify: `package.json` — add `test:install` script

### Task 3: Install smoke test

- [ ] **3.1 Write failing install test**
```typescript
// tests/install.test.ts
import { execSync, spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

it('install.sh creates working MCP server in target repo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lb-install-'));
  try {
    // Init a bare git repo as target
    execSync('git init && git commit --allow-empty -m init', { cwd: dir });
    execSync(`bash ${process.cwd()}/install.sh --target=${dir} --blog-only`, { cwd: dir });

    // Verify MCP binary exists
    const mcpBin = join(dir, 'node_modules/ai-universe-living-blog/dist/blog/server.js');
    expect(() => accessSync(mcpBin)).not.toThrow();

    // Start server and health-check
    const proc = spawn('node', [mcpBin], { cwd: dir, env: { ...process.env, PORT: '18081' } });
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch('http://localhost:18081/health');
    const body = await res.json();
    expect(body.status).toBe('ok');
    proc.kill();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
```

- [ ] **3.2 Run test to verify it fails**
```bash
npm run test:install
# Expected: FAIL — install likely succeeds but binary path wrong or server doesn't start
```

- [ ] **3.3 Fix install.sh until test passes** (iterate on install.sh bugs exposed by test)

- [ ] **3.4 Add to package.json**
```json
"test:install": "vitest run tests/install.test.ts"
```

- [ ] **3.5 Commit**
```bash
git commit -m "test(install): add smoke test for install.sh"
```

---

## P1-1: AO Lifecycle Hooks (Auto-trigger novel entries)

**Files:**
- Create: `src/hooks/ao-lifecycle.ts` — listens for AO PR events, calls novel CLI
- Create: `src/hooks/event-schema.ts` — AO event types
- Create: `tests/ao-lifecycle.test.ts` — unit tests with mocked novel runner
- Create: `.github/workflows/novel-entry.yml` — GitHub Actions trigger on PR open/update

### Task 4: AO lifecycle hook runner

- [ ] **4.1 Write failing tests for hook handler**
```typescript
// tests/ao-lifecycle.test.ts
import { handlePrEvent } from '../src/hooks/ao-lifecycle.js';
import { vi } from 'vitest';

it('calls novel CLI for pr_opened event', async () => {
  const runCli = vi.fn().mockResolvedValue(undefined);
  await handlePrEvent({ type: 'pr_opened', repo: 'owner/repo', pr: 42, session: 'ao-826', branch: 'feat/x' }, runCli);
  expect(runCli).toHaveBeenCalledWith(expect.stringContaining('branch-entry'));
  expect(runCli).toHaveBeenCalledWith(expect.stringContaining('--pr=42'));
});

it('skips novel CLI for non-lifecycle events', async () => {
  const runCli = vi.fn();
  await handlePrEvent({ type: 'pr_comment', repo: 'owner/repo', pr: 42, session: 'ao-826', branch: 'feat/x' }, runCli);
  expect(runCli).not.toHaveBeenCalled();
});
```

- [ ] **4.2 Run tests to verify they fail**
```bash
npm test -- tests/ao-lifecycle.test.ts
```

- [ ] **4.3 Implement handlePrEvent**
```typescript
// src/hooks/ao-lifecycle.ts
export type PrEventType = 'pr_opened' | 'pr_merged' | 'pr_closed' | 'pr_review_requested' | 'pr_comment';

export interface PrEvent {
  type: PrEventType;
  repo: string;
  pr: number;
  session: string;
  branch: string;
}

const NOVEL_TRIGGER_EVENTS: PrEventType[] = ['pr_opened', 'pr_merged', 'pr_closed'];

export async function handlePrEvent(
  event: PrEvent,
  runCli: (cmd: string) => Promise<void> = defaultRunCli
): Promise<void> {
  if (!NOVEL_TRIGGER_EVENTS.includes(event.type)) return;
  const cmd = [
    'branch-entry',
    `--repo=${event.repo}`,
    `--session=${event.session}`,
    `--branch=${event.branch}`,
    `--pr=${event.pr}`,
  ].join(' ');
  await runCli(cmd);
}
```

- [ ] **4.4 Verify tests pass**
```bash
npm test -- tests/ao-lifecycle.test.ts
```

- [ ] **4.5 Add GitHub Actions workflow**
```yaml
# .github/workflows/novel-entry.yml
name: Novel Entry
on:
  pull_request:
    types: [opened, closed, reopened]
jobs:
  generate:
    runs-on: ubuntu-latest
    if: startsWith(github.head_ref, 'feat/') || startsWith(github.head_ref, 'fix/')
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: |
          npm run dev:novel -- branch-entry \
            --repo=${{ github.repository }} \
            --session=gh-actions-${{ github.run_id }} \
            --branch=${{ github.head_ref }} \
            --pr=${{ github.event.pull_request.number }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          BLOG_MCP_URL: ${{ secrets.BLOG_MCP_URL }}
```

- [ ] **4.6 Commit**
```bash
git commit -m "feat(hooks): AO lifecycle hook + GitHub Actions workflow for novel entries"
```

---

## P1-2: Daily Summary Cron (GitHub Actions)

**Files:**
- Create: `.github/workflows/daily-summary.yml` — scheduled at 23:30 UTC daily
- Create: `tests/daily-generator.test.ts` — unit tests for scheduling logic

### Task 5: Daily summary automation

- [ ] **5.1 Write failing tests**
```typescript
// tests/daily-generator-cron.test.ts
import { shouldRunDailySummary } from '../src/novel/daily-generator.js';

it('returns true when >= 3 posts exist for today', async () => {
  // mock storage with 3 posts
});
it('returns false when < 3 posts exist', async () => {
  // mock storage with 2 posts
});
```

- [ ] **5.2 Implement shouldRunDailySummary** in `src/novel/daily-generator.ts`

- [ ] **5.3 Add scheduled workflow**
```yaml
# .github/workflows/daily-summary.yml
name: Daily Novel Summary
on:
  schedule:
    - cron: '30 23 * * *'  # 23:30 UTC daily
  workflow_dispatch: {}
jobs:
  summarize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: |
          npm run dev:novel -- daily-summary \
            --repo=${{ github.repository }} \
            --session=gh-actions-daily-${{ github.run_id }} \
            --date=$(date -u +%Y-%m-%d)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          BLOG_MCP_URL: ${{ secrets.BLOG_MCP_URL }}
```

- [ ] **5.4 Commit**
```bash
git commit -m "feat(cron): daily novel summary GitHub Actions workflow"
```

---

## P1-3: Worker Auto-Posting (create_post on lifecycle events)

**Files:**
- Create: `src/hooks/worker-poster.ts` — HTTP client that posts to blog MCP on events
- Modify: `src/shared/types.ts` — ensure WorkerEvent type exported
- Create: `tests/worker-poster.test.ts` — tests with mock fetch

### Task 6: Worker poster

- [ ] **6.1 Write failing tests**
```typescript
// tests/worker-poster.test.ts
import { postEvent } from '../src/hooks/worker-poster.js';

it('posts pr_created event to blog MCP', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: '123' }) });
  await postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 42, session: 'ao-826' }, 'http://localhost:8081', mockFetch);
  expect(mockFetch).toHaveBeenCalledWith('http://localhost:8081/mcp', expect.objectContaining({ method: 'POST' }));
});
```

- [ ] **6.2 Implement postEvent**
```typescript
// src/hooks/worker-poster.ts
export interface WorkerEvent {
  type: string;
  repo: string;
  pr?: number;
  session: string;
  branch?: string;
  message?: string;
}

export async function postEvent(
  event: WorkerEvent,
  blogUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'create_post',
    arguments: {
      repoKey: event.repo,
      posterId: event.session,
      title: `${event.type}: ${event.repo} PR#${event.pr ?? 'N/A'}`,
      content: event.message ?? `Worker ${event.session} recorded ${event.type}`,
      eventType: event.type,
      metadata: { prNumber: event.pr, branchName: event.branch },
    },
  }};
  const res = await fetchFn(`${blogUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Blog post failed: ${res.status}`);
}
```

- [ ] **6.3 Verify tests pass**
```bash
npm test -- tests/worker-poster.test.ts
```

- [ ] **6.4 Commit**
```bash
git commit -m "feat(hooks): worker-poster auto-posts lifecycle events to blog MCP"
```

---

## P2: JSON File Persistence (survive restarts without Firestore)

**Files:**
- Modify: `src/blog/storage.ts` — add `JsonFileBlogStorage` that reads/writes JSON to disk
- Create: `tests/storage-json.test.ts`

### Task 7: JSON file storage

- [ ] **7.1 Write failing tests**
```typescript
it('persists posts across instances', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blog-'));
  const s1 = new JsonFileBlogStorage(dir);
  const post = makeSamplePost();
  await s1.createPost(post);

  const s2 = new JsonFileBlogStorage(dir);
  const retrieved = await s2.getPost(post.id);
  expect(retrieved?.id).toBe(post.id);
  rmSync(dir, { recursive: true });
});
```

- [ ] **7.2 Implement JsonFileBlogStorage** in `src/blog/storage.ts`
- [ ] **7.3 Wire `--storage=json-file` flag** with `--data-dir=<path>` option
- [ ] **7.4 Add to storage factory**
- [ ] **7.5 Commit**

---

## Evidence Requirements (per PR)

Every PR must ship with full /4layer evidence in `docs/evidence/<branch>/`:

```
docs/evidence/<branch>/
  layer1-tests.txt
  layer2-integration.txt
  layer3-api/
    health.json
    create_post.json
    list_posts.json
  layer4-visual/
    01-server-startup.png     # caption: "Server started on port 8081"
    02-health-check.png       # caption: "Health check returns {status: ok}"
    03-mcp-tool-call.png      # caption: "create_post returns post ID"
    demo.mp4                  # ~30s: start → health → create_post → list_posts
  evidence.md                 # summary linking all artifacts
```
