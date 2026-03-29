/**
 * testing_mcp/server.test.ts
 *
 * Real-server integration tests against a running blog MCP server.
 * Covers all 18 MCP tools + /health + /metrics endpoints.
 *
 * Requires server running on PORT (default 8888):
 *   PORT=8888 npm run dev:blog &
 *
 * Run:
 *   PORT=8888 npx vitest run testing_mcp/server.test.ts
 *
 * If server is not running, tests are skipped automatically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env['BLOG_SERVER_URL'] ?? `http://localhost:${process.env['PORT'] ?? '8888'}`;
let serverAvailable = false;

// ─── helpers ────────────────────────────────────────────────────────────────

async function call(method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json() as Promise<{ jsonrpc: string; id: number; result?: { content: Array<{ type: string; text: string }> }; error?: { code: number; message: string } }>;
}

function parseResult(raw: Awaited<ReturnType<typeof call>>) {
  if (raw.error) throw new Error(`JSON-RPC error: ${raw.error.message}`);
  const text = raw.result?.content?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

const TEST_REPO = `test-repo-${Date.now()}`;
let createdPostId: string;
let createdPostId2: string;

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  if (!serverAvailable) {
    console.warn(`⚠️  Blog server not available at ${BASE_URL} — all tests will be skipped`);
  }
});

// ─── /health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok status', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/health`);
    const body = await res.json() as { status: string; service: string; version: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('blog-mcp-server');
    expect(typeof body.version).toBe('string');
  });
});

// ─── / root ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('lists all 18 tools', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/`);
    const body = await res.json() as { tools: string[] };
    expect(Array.isArray(body.tools)).toBe(true);
    const expected = [
      'create_post', 'get_post', 'list_posts', 'update_post', 'delete_post',
      'get_thread', 'list_threads', 'search_posts', 'get_repo_stats',
      'register_repo', 'unregister_repo', 'list_repos', 'update_repo',
      'generate_api_key', 'chat_worker', 'export_repo', 'replay_event', 'health_check',
    ];
    for (const tool of expected) {
      expect(body.tools).toContain(tool);
    }
  });
});

// ─── /metrics ────────────────────────────────────────────────────────────────

describe('GET /metrics', () => {
  it('returns prometheus text format', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/metrics`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('# HELP blog_requests_total');
    expect(text).toContain('# TYPE blog_requests_total counter');
  });
});

// ─── GET /mcp (method listing) ───────────────────────────────────────────────

describe('GET /mcp', () => {
  it('returns tool listing and usage hint', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/mcp`);
    const body = await res.json() as { tools: string[] };
    expect(res.status).toBe(200);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThanOrEqual(18);
  });
});

// ─── health_check tool ───────────────────────────────────────────────────────

describe('health_check tool', () => {
  it('returns ok via MCP', async () => {
    if (!serverAvailable) return;
    const raw = await call('health_check', {});
    const result = parseResult(raw);
    expect(result.status).toBe('ok');
  });
});

// ─── register_repo ───────────────────────────────────────────────────────────

describe('register_repo', () => {
  it('registers a new repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('register_repo', {
      repoKey: TEST_REPO,
      enabled: true,
      modes: { autoScan: false, novelBranch: false, novelDaily: false },
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.repo.repoKey).toBe(TEST_REPO);
    expect(result.repo.enabled).toBe(true);
  });

  it('rejects missing modes', async () => {
    if (!serverAvailable) return;
    const raw = await call('register_repo', { repoKey: `${TEST_REPO}-bad`, enabled: true });
    expect(raw.result?.content?.[0]?.text).toMatch(/modes/);
  });
});

// ─── list_repos ──────────────────────────────────────────────────────────────

describe('list_repos', () => {
  it('lists registered repos including test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_repos', {});
    const result = parseResult(raw);
    expect(Array.isArray(result.repos)).toBe(true);
    const found = result.repos.find((r: { repoKey: string }) => r.repoKey === TEST_REPO);
    expect(found).toBeTruthy();
  });
});

// ─── update_repo ─────────────────────────────────────────────────────────────

describe('update_repo', () => {
  it('updates enabled flag', async () => {
    if (!serverAvailable) return;
    const raw = await call('update_repo', { repoKey: TEST_REPO, enabled: false });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.repo.enabled).toBe(false);
  });

  it('re-enables repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('update_repo', { repoKey: TEST_REPO, enabled: true });
    const result = parseResult(raw);
    expect(result.repo.enabled).toBe(true);
  });
});

// ─── generate_api_key ────────────────────────────────────────────────────────

describe('generate_api_key', () => {
  it('generates an API key for the test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('generate_api_key', { repoKey: TEST_REPO, label: 'test-key' });
    const result = parseResult(raw);
    expect(typeof result.apiKey).toBe('string');
    expect(result.apiKey.length).toBeGreaterThan(10);
  });

  it('rejects missing label', async () => {
    if (!serverAvailable) return;
    const raw = await call('generate_api_key', { repoKey: TEST_REPO });
    expect(raw.result?.content?.[0]?.text).toMatch(/label/);
  });
});

// ─── create_post ─────────────────────────────────────────────────────────────

describe('create_post', () => {
  it('creates a post and returns id', async () => {
    if (!serverAvailable) return;
    const raw = await call('create_post', {
      repoKey: TEST_REPO,
      postType: 'pr_opened',
      title: 'feat: add real server tests',
      prNumber: 100,
      branchName: 'feat/testing-mcp',
      posterId: 'test-worker',
      content: 'Opening PR for real server integration tests',
      eventType: 'pr_opened',
    });
    const result = parseResult(raw);
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.title).toBe('feat: add real server tests');
    createdPostId = result.id;
  });

  it('creates a second post in same thread', async () => {
    if (!serverAvailable) return;
    const raw = await call('create_post', {
      repoKey: TEST_REPO,
      postType: 'pr_merged',
      title: 'feat: add real server tests',
      prNumber: 100,
      branchName: 'feat/testing-mcp',
      posterId: 'test-worker',
      content: 'PR merged successfully',
      eventType: 'pr_merged',
    });
    const result = parseResult(raw);
    expect(typeof result.id).toBe('string');
    createdPostId2 = result.id;
  });

  it('rejects missing required fields', async () => {
    if (!serverAvailable) return;
    const raw = await call('create_post', { repoKey: TEST_REPO });
    expect(raw.result?.content?.[0]?.text).toMatch(/Required/i);
  });
});

// ─── get_post ─────────────────────────────────────────────────────────────────

describe('get_post', () => {
  it('fetches created post by id', async () => {
    if (!serverAvailable || !createdPostId) return;
    const raw = await call('get_post', { repoKey: TEST_REPO, postId: createdPostId });
    const result = parseResult(raw);
    expect(result.id).toBe(createdPostId);
    expect(result.title).toBe('feat: add real server tests');
    expect(result.eventType).toBe('pr_opened');
  });

  it('returns error for unknown post id', async () => {
    if (!serverAvailable) return;
    const raw = await call('get_post', { repoKey: TEST_REPO, postId: 'nonexistent-id-xyz' });
    const text = raw.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.error ?? parsed.message ?? '').toMatch(/not found/i);
  });
});

// ─── list_posts ──────────────────────────────────────────────────────────────

describe('list_posts', () => {
  it('lists posts for test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_posts', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(2);
  });

  it('respects limit param', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_posts', { repoKey: TEST_REPO, limit: 1 });
    const result = parseResult(raw);
    expect(result.posts.length).toBe(1);
    expect(typeof result.nextCursor).toBe('string');
  });

  it('paginates with cursor', async () => {
    if (!serverAvailable) return;
    const first = parseResult(await call('list_posts', { repoKey: TEST_REPO, limit: 1 }));
    const second = parseResult(await call('list_posts', { repoKey: TEST_REPO, limit: 1, cursor: first.nextCursor }));
    expect(second.posts.length).toBeGreaterThanOrEqual(1);
    expect(second.posts[0].id).not.toBe(first.posts[0].id);
  });
});

// ─── update_post ─────────────────────────────────────────────────────────────

describe('update_post', () => {
  it('updates post content', async () => {
    if (!serverAvailable || !createdPostId) return;
    const raw = await call('update_post', {
      repoKey: TEST_REPO,
      postId: createdPostId,
      content: 'Updated content via update_post tool',
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.post.content).toBe('Updated content via update_post tool');
  });

  it('updates post tags', async () => {
    if (!serverAvailable || !createdPostId) return;
    const raw = await call('update_post', {
      repoKey: TEST_REPO,
      postId: createdPostId,
      tags: ['test', 'mcp', 'integration'],
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.post.tags).toContain('test');
  });
});

// ─── get_thread ──────────────────────────────────────────────────────────────

describe('get_thread', () => {
  it('fetches thread containing both posts', async () => {
    if (!serverAvailable || !createdPostId) return;
    // Get post to find its threadId
    const postRaw = await call('get_post', { repoKey: TEST_REPO, postId: createdPostId });
    const post = parseResult(postRaw);
    const threadId = post.threadId;
    expect(typeof threadId).toBe('string');

    const raw = await call('get_thread', { repoKey: TEST_REPO, threadId });
    const result = parseResult(raw);
    expect(result.thread).toBeTruthy();
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── list_threads ─────────────────────────────────────────────────────────────

describe('list_threads', () => {
  it('lists threads for test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_threads', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(Array.isArray(result.threads)).toBe(true);
    expect(result.threads.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── search_posts ─────────────────────────────────────────────────────────────

describe('search_posts', () => {
  it('finds posts by query string', async () => {
    if (!serverAvailable) return;
    const raw = await call('search_posts', { repoKey: TEST_REPO, q: 'real server' });
    const result = parseResult(raw);
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(1);
    // Content was updated to "Updated content via update_post tool" — original had "real server"
    // search should still match the original or via title
  });

  it('finds posts by eventType', async () => {
    if (!serverAvailable) return;
    const raw = await call('search_posts', { repoKey: TEST_REPO, eventType: 'pr_opened' });
    const result = parseResult(raw);
    expect(result.posts.length).toBeGreaterThanOrEqual(1);
    expect(result.posts[0].eventType).toBe('pr_opened');
  });

  it('returns empty for no-match query', async () => {
    if (!serverAvailable) return;
    const raw = await call('search_posts', { repoKey: TEST_REPO, q: 'zzz-no-match-xyz-99999' });
    const result = parseResult(raw);
    expect(result.posts.length).toBe(0);
  });

  it('rejects when neither q nor eventType provided', async () => {
    if (!serverAvailable) return;
    const raw = await call('search_posts', { repoKey: TEST_REPO });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/At least one of/i);
  });
});

// ─── get_repo_stats ───────────────────────────────────────────────────────────

describe('get_repo_stats', () => {
  it('returns stats with correct shape', async () => {
    if (!serverAvailable) return;
    const raw = await call('get_repo_stats', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(result.repoKey).toBe(TEST_REPO);
    expect(typeof result.totalPosts).toBe('number');
    expect(result.totalPosts).toBeGreaterThanOrEqual(2);
    expect(typeof result.totalThreads).toBe('number');
    expect(Array.isArray(result.topEventTypes)).toBe(true);
    expect(Array.isArray(result.dailyBreakdown)).toBe(true);
    expect(result.dailyBreakdown.length).toBe(7);
  });

  it('topEventTypes includes pr_opened', async () => {
    if (!serverAvailable) return;
    const raw = await call('get_repo_stats', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    const types = result.topEventTypes.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('pr_opened');
  });
});

// ─── export_repo ──────────────────────────────────────────────────────────────

describe('export_repo', () => {
  it('exports all posts as JSON array', async () => {
    if (!serverAvailable) return;
    const raw = await call('export_repo', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(typeof result.repoKey).toBe('string');
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(2);
    expect(typeof result.exportedAt).toBe('string');
  });

  it('exported posts have required fields', async () => {
    if (!serverAvailable) return;
    const raw = await call('export_repo', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    const post = result.posts[0];
    expect(typeof post.id).toBe('string');
    expect(typeof post.title).toBe('string');
    expect(typeof post.postType).toBe('string');
    expect(typeof post.createdAt).toBe('string');
  });
});

// ─── replay_event ─────────────────────────────────────────────────────────────

describe('replay_event', () => {
  it('replays pr_opened events', async () => {
    if (!serverAvailable) return;
    const raw = await call('replay_event', { repoKey: TEST_REPO, eventType: 'pr_opened' });
    const result = parseResult(raw);
    expect(result.repoKey).toBe(TEST_REPO);
    expect(typeof result.replayed).toBe('number');
    expect(result.replayed).toBeGreaterThanOrEqual(0);
  });

  it('respects count param', async () => {
    if (!serverAvailable) return;
    const raw = await call('replay_event', { repoKey: TEST_REPO, eventType: 'pr_opened', count: 1 });
    const result = parseResult(raw);
    expect(result.replayed).toBeLessThanOrEqual(1);
  });
});

// ─── delete_post ──────────────────────────────────────────────────────────────

describe('delete_post', () => {
  it('deletes a post by id', async () => {
    if (!serverAvailable || !createdPostId2) return;
    const raw = await call('delete_post', { repoKey: TEST_REPO, postId: createdPostId2 });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.postId).toBe(createdPostId2);
  });

  it('post no longer retrievable after delete', async () => {
    if (!serverAvailable || !createdPostId2) return;
    const raw = await call('get_post', { repoKey: TEST_REPO, postId: createdPostId2 });
    const text = raw.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.error ?? parsed.message ?? '').toMatch(/not found/i);
  });

  it('returns error for unknown post id', async () => {
    if (!serverAvailable) return;
    const raw = await call('delete_post', { repoKey: TEST_REPO, postId: 'no-such-post-id-xyz' });
    const text = raw.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.error ?? parsed.message ?? '').toMatch(/not found/i);
  });
});

// ─── chat_worker ──────────────────────────────────────────────────────────────

describe('chat_worker', () => {
  it('returns a response from regex fallback when no API key', async () => {
    if (!serverAvailable) return;
    const raw = await call('chat_worker', {
      repoKey: TEST_REPO,
      sessionId: 'ao-test-999',
      message: 'Hello, how are you?',
    });
    // Should succeed (regex fallback) or error — not a hard server crash
    expect(raw.error).toBeUndefined();
    const text = raw.result?.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    // Either has a response or an error key (no API key = fallback)
    expect(typeof parsed.response === 'string' || typeof parsed.error === 'string').toBe(true);
  });
});

// ─── unregister_repo ─────────────────────────────────────────────────────────

describe('unregister_repo', () => {
  it('removes the test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('unregister_repo', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
  });

  it('repo no longer in list_repos', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_repos', {});
    const result = parseResult(raw);
    const found = result.repos.find((r: { repoKey: string }) => r.repoKey === TEST_REPO);
    expect(found).toBeUndefined();
  });
});

// ─── JSON-RPC error handling ─────────────────────────────────────────────────

describe('JSON-RPC error handling', () => {
  it('returns -32601 for unknown method', async () => {
    if (!serverAvailable) return;
    const raw = await call('nonexistent_tool', {});
    expect(raw.error?.code).toBe(-32601);
    expect(raw.error?.message).toMatch(/Method not found/i);
  });

  it('returns error for malformed JSON body', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const body = await res.json() as { error?: { code: number } };
    expect(body.error).toBeTruthy();
  });
});

// ─── X-API-Key auth (when AUTH_API_KEY is set) ────────────────────────────────

describe('auth middleware', () => {
  it('POST /mcp works without auth when AUTH_API_KEY not set', async () => {
    if (!serverAvailable) return;
    // Server started without AUTH_API_KEY — all POSTs should be accepted
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'health_check', params: {} }),
    });
    expect(res.status).toBe(200);
  });

  it('GET /health is always unauthenticated', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
  });
});
