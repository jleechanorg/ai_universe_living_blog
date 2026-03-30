/**
 * testing_mcp/server.test.ts
 *
 * Real-server integration tests against a running blog MCP server.
 * Covers all 18 MCP tools + /health + /metrics + error handling.
 *
 * Requires server running on PORT (default 8888):
 *   PORT=8888 npm run dev:blog &
 *
 * Run:
 *   npm run test:mcp
 *
 * If server is not running, tests are skipped automatically.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env['BLOG_SERVER_URL'] ?? `http://localhost:${process.env['PORT'] ?? '8888'}`;
let serverAvailable = false;

// ─── helpers ────────────────────────────────────────────────────────────────

async function call(method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json() as Promise<{
    jsonrpc: string; id: number;
    result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
    error?: { code: number; message: string };
  }>;
}

function parseResult(raw: Awaited<ReturnType<typeof call>>) {
  if (raw.error) throw new Error(`JSON-RPC error: ${raw.error.message}`);
  const text = raw.result?.content?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

// State shared across tests (created in create_post suite)
const TEST_REPO = `testing-mcp/${Date.now()}`;
let postId1: string;
let postId2: string;
let threadId1: string;

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  if (!serverAvailable) {
    console.warn(`⚠️  Server not available at ${BASE_URL} — all tests skipped`);
  }
});

// ─── /health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns status:ok and service name', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/health`);
    const body = await res.json() as { status: string; service: string; version: string };
    expect(res.status).toBe(200);
    expect(body.service).toBe('blog-mcp-server');
    expect(typeof body.status).toBe('string'); // 'ok' or 'healthy'
    expect(typeof body.version).toBe('string');
  });
});

// ─── / root ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns text/html with status 200 (Phase 2 Web Reader UI)', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const text = await res.text();
    expect(text).toContain('AI Universe Living Blog');
    expect(text).toContain('repo-select');
  });
});

// ─── GET /mcp ────────────────────────────────────────────────────────────────

describe('GET /mcp', () => {
  it('returns tool listing', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/mcp`);
    const body = await res.json() as { tools: string[] };
    expect(res.status).toBe(200);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThanOrEqual(18);
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

// ─── health_check tool ───────────────────────────────────────────────────────

describe('health_check', () => {
  it('returns healthy status via MCP', async () => {
    if (!serverAvailable) return;
    const raw = await call('health_check', {});
    const result = parseResult(raw);
    expect(typeof result.status).toBe('string'); // 'healthy'
    expect(result.service).toBe('blog-mcp-server');
  });
});

// ─── register_repo ───────────────────────────────────────────────────────────

describe('register_repo', () => {
  it('registers a new repo with modes object', async () => {
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
    expect(result.repo.modes.autoScan).toBe(false);
  });

  it('rejects missing modes', async () => {
    if (!serverAvailable) return;
    const raw = await call('register_repo', { repoKey: `${TEST_REPO}-bad`, enabled: true });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/modes/);
  });
});

// ─── list_repos ──────────────────────────────────────────────────────────────

describe('list_repos', () => {
  it('lists all repos and includes test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_repos', {});
    const result = parseResult(raw);
    expect(Array.isArray(result.repos)).toBe(true);
    const found = result.repos.find((r: { repoKey: string }) => r.repoKey === TEST_REPO);
    expect(found).toBeTruthy();
    expect(found.enabled).toBe(true);
  });
});

// ─── update_repo ─────────────────────────────────────────────────────────────

describe('update_repo', () => {
  it('disables a repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('update_repo', { repoKey: TEST_REPO, enabled: false });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.repo.enabled).toBe(false);
  });

  it('re-enables a repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('update_repo', { repoKey: TEST_REPO, enabled: true });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.repo.enabled).toBe(true);
  });

  it('updates modes', async () => {
    if (!serverAvailable) return;
    const raw = await call('update_repo', {
      repoKey: TEST_REPO,
      modes: { autoScan: true },
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.repo.modes.autoScan).toBe(true);
  });
});

// ─── generate_api_key ────────────────────────────────────────────────────────

describe('generate_api_key', () => {
  it('generates a key with label and scopes', async () => {
    if (!serverAvailable) return;
    const raw = await call('generate_api_key', { repoKey: TEST_REPO, label: 'ci-key' });
    const result = parseResult(raw);
    expect(typeof result.key).toBe('string');
    expect(result.key.length).toBeGreaterThan(10);
    expect(result.label).toBe('ci-key');
    expect(Array.isArray(result.scopes)).toBe(true);
    expect(result.scopes).toContain('read');
  });

  it('rejects missing label', async () => {
    if (!serverAvailable) return;
    const raw = await call('generate_api_key', { repoKey: TEST_REPO });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/label/);
  });
});

// ─── create_post ─────────────────────────────────────────────────────────────

describe('create_post', () => {
  it('creates first post and returns post object', async () => {
    if (!serverAvailable) return;
    const raw = await call('create_post', {
      repoKey: TEST_REPO,
      postType: 'pr_opened',
      title: 'feat: real server integration tests',
      prNumber: 100,
      branchName: 'feat/testing-mcp',
      posterId: 'test-worker',
      content: 'Opening PR for real server integration tests',
      eventType: 'pr_opened',
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(typeof result.post.id).toBe('string');
    expect(result.post.title).toBe('feat: real server integration tests');
    expect(result.post.eventType).toBe('pr_opened');
    expect(result.post.repoKey).toBe(TEST_REPO);
    postId1 = result.post.id;
    threadId1 = result.post.threadId;
  });

  it('creates second post in same thread (same PR)', async () => {
    if (!serverAvailable) return;
    const raw = await call('create_post', {
      repoKey: TEST_REPO,
      postType: 'pr_merged',
      title: 'feat: real server integration tests',
      prNumber: 100,
      branchName: 'feat/testing-mcp',
      posterId: 'test-worker',
      content: 'PR merged successfully',
      eventType: 'pr_merged',
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(typeof result.post.id).toBe('string');
    postId2 = result.post.id;
  });

  it('rejects missing required fields with validation error', async () => {
    if (!serverAvailable) return;
    const raw = await call('create_post', { repoKey: TEST_REPO });
    const text = raw.result?.content?.[0]?.text ?? '';
    // Returns error listing missing fields (posterId, title, content, eventType)
    expect(text).toMatch(/posterId|title|content|eventType/i);
  });
});

// ─── get_post ─────────────────────────────────────────────────────────────────

describe('get_post', () => {
  it('fetches a post by id', async () => {
    if (!serverAvailable || !postId1) return;
    const raw = await call('get_post', { repoKey: TEST_REPO, postId: postId1 });
    const result = parseResult(raw);
    expect(result.id).toBe(postId1);
    expect(result.title).toBe('feat: real server integration tests');
    expect(result.eventType).toBe('pr_opened');
  });

  it('returns validation error for invalid UUID format', async () => {
    if (!serverAvailable) return;
    const raw = await call('get_post', { repoKey: TEST_REPO, postId: 'not-a-uuid' });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/uuid/i);
  });

  it('returns not found for valid UUID that does not exist', async () => {
    if (!serverAvailable) return;
    const raw = await call('get_post', {
      repoKey: TEST_REPO,
      postId: '00000000-0000-0000-0000-000000000000',
    });
    const result = parseResult(raw);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── list_posts ──────────────────────────────────────────────────────────────

describe('list_posts', () => {
  it('lists all posts for the test repo', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_posts', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(2);
  });

  it('respects limit and returns cursor', async () => {
    if (!serverAvailable) return;
    const raw = await call('list_posts', { repoKey: TEST_REPO, limit: 1 });
    const result = parseResult(raw);
    expect(result.posts.length).toBe(1);
    expect(typeof result.cursor).toBe('string'); // pagination cursor field
  });

  it('paginates correctly with cursor', async () => {
    if (!serverAvailable) return;
    const first = parseResult(await call('list_posts', { repoKey: TEST_REPO, limit: 1 }));
    const second = parseResult(
      await call('list_posts', { repoKey: TEST_REPO, limit: 1, cursor: first.cursor }),
    );
    expect(second.posts.length).toBeGreaterThanOrEqual(1);
    expect(second.posts[0].id).not.toBe(first.posts[0].id);
  });
});

// ─── update_post ─────────────────────────────────────────────────────────────

describe('update_post', () => {
  it('updates post content', async () => {
    if (!serverAvailable || !postId1) return;
    const raw = await call('update_post', {
      repoKey: TEST_REPO,
      postId: postId1,
      content: 'Updated via update_post tool',
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.post.content).toBe('Updated via update_post tool');
  });

  it('updates post tags', async () => {
    if (!serverAvailable || !postId1) return;
    const raw = await call('update_post', {
      repoKey: TEST_REPO,
      postId: postId1,
      tags: ['test', 'mcp', 'integration'],
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.post.tags).toContain('test');
    expect(result.post.tags).toContain('integration');
  });

  it('updates post status', async () => {
    if (!serverAvailable || !postId1) return;
    const raw = await call('update_post', {
      repoKey: TEST_REPO,
      postId: postId1,
      status: 'archived',
    });
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.post.status).toBe('archived');
  });
});

// ─── get_thread ──────────────────────────────────────────────────────────────

describe('get_thread', () => {
  it('fetches thread containing the first post', async () => {
    if (!serverAvailable || !threadId1) return;
    const raw = await call('get_thread', { repoKey: TEST_REPO, threadId: threadId1 });
    const result = parseResult(raw);
    expect(result.thread).toBeTruthy();
    expect(result.thread.id).toBe(threadId1);
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(1);
    // First post should be in this thread
    const found = result.posts.find((p: { id: string }) => p.id === postId1);
    expect(found).toBeTruthy();
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
    const found = result.threads.find((t: { id: string }) => t.id === threadId1);
    expect(found).toBeTruthy();
  });
});

// ─── search_posts ─────────────────────────────────────────────────────────────

describe('search_posts', () => {
  it('finds posts by full-text query', async () => {
    if (!serverAvailable) return;
    const raw = await call('search_posts', { repoKey: TEST_REPO, q: 'integration' });
    const result = parseResult(raw);
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(1);
  });

  it('finds posts by eventType filter', async () => {
    if (!serverAvailable) return;
    const raw = await call('search_posts', { repoKey: TEST_REPO, eventType: 'pr_merged' });
    const result = parseResult(raw);
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(1);
    expect(result.posts[0].eventType).toBe('pr_merged');
  });

  it('returns empty array for no-match query', async () => {
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
  it('exports with correct top-level shape', async () => {
    if (!serverAvailable) return;
    const raw = await call('export_repo', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(result.repoKey).toBe(TEST_REPO);
    expect(typeof result.exportedAt).toBe('string');
    expect(typeof result.postCount).toBe('number');
    expect(typeof result.threadCount).toBe('number');
    expect(result.data).toBeTruthy();
    expect(Array.isArray(result.data.posts)).toBe(true);
    expect(Array.isArray(result.data.threads)).toBe(true);
  });

  it('export includes all created posts', async () => {
    if (!serverAvailable) return;
    const raw = await call('export_repo', { repoKey: TEST_REPO });
    const result = parseResult(raw);
    expect(result.data.posts.length).toBeGreaterThanOrEqual(2);
    const post = result.data.posts[0];
    expect(typeof post.id).toBe('string');
    expect(typeof post.title).toBe('string');
    expect(typeof post.eventType).toBe('string');
    expect(typeof post.createdAt).toBe('string');
  });
});

// ─── replay_event ─────────────────────────────────────────────────────────────

describe('replay_event', () => {
  it('replays an event and returns new post id', async () => {
    if (!serverAvailable) return;
    const raw = await call('replay_event', {
      repoKey: TEST_REPO,
      eventType: 'pr_opened',
      prNumber: 100,
    });
    const result = parseResult(raw);
    expect(result.ok).toBe(true);
    expect(typeof result.postId).toBe('string');
    expect(result.replayed).toBe(true);
  });

  it('rejects missing prNumber', async () => {
    if (!serverAvailable) return;
    const raw = await call('replay_event', { repoKey: TEST_REPO, eventType: 'pr_opened' });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/prNumber/i);
  });
});

// ─── delete_post ──────────────────────────────────────────────────────────────

describe('delete_post', () => {
  it('deletes a post by id', async () => {
    if (!serverAvailable || !postId2) return;
    const raw = await call('delete_post', { repoKey: TEST_REPO, postId: postId2 });
    const result = parseResult(raw);
    expect(result.ok).toBe(true);
    expect(result.postId).toBe(postId2);
  });

  it('deleted post is no longer retrievable', async () => {
    if (!serverAvailable || !postId2) return;
    const raw = await call('get_post', { repoKey: TEST_REPO, postId: postId2 });
    const result = parseResult(raw);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns validation error for non-UUID postId', async () => {
    if (!serverAvailable) return;
    const raw = await call('delete_post', { repoKey: TEST_REPO, postId: 'not-a-uuid' });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/uuid/i);
  });

  it('returns not found for valid UUID that does not exist', async () => {
    if (!serverAvailable) return;
    const raw = await call('delete_post', {
      repoKey: TEST_REPO,
      postId: '00000000-0000-0000-0000-000000000000',
    });
    const result = parseResult(raw);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── chat_worker ──────────────────────────────────────────────────────────────

describe('chat_worker', () => {
  it('returns a response (regex fallback when no API key)', async () => {
    if (!serverAvailable) return;
    const raw = await call('chat_worker', {
      repoKey: TEST_REPO,
      workerId: 'ao-test-worker',
      message: 'Hello, how are you doing?',
    });
    // No server crash — either a response or an expected error (no API key)
    expect(raw.error).toBeUndefined();
    const text = raw.result?.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    expect(
      typeof parsed.response === 'string' || typeof parsed.error === 'string',
    ).toBe(true);
  });

  it('rejects missing workerId', async () => {
    if (!serverAvailable) return;
    const raw = await call('chat_worker', {
      repoKey: TEST_REPO,
      message: 'hello',
    });
    const text = raw.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/workerId/i);
  });
});

// ─── GET /feed ─────────────────────────────────────────────────────────────────

describe('GET /feed', () => {
  it('returns 200 with Content-Type: application/atom+xml', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/feed`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/atom\+xml/);
  });

  it('response is valid XML containing <feed> element', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/feed`);
    const text = await res.text();
    expect(text).toContain('<feed');
    expect(text).toContain('</feed>');
    // Valid Atom feed requires title, id, updated at minimum
    expect(text).toContain('<title>');
    expect(text).toContain('<id>');
    expect(text).toContain('<updated>');
  });

  it('returns valid Atom feed filtered by ?repo= when repo is registered', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/feed?repo=${encodeURIComponent(TEST_REPO)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/atom\+xml/);
    const text = await res.text();
    expect(text).toContain(TEST_REPO);
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

  it('repo is gone from list_repos after unregister', async () => {
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
    const raw = await call('nonexistent_tool_xyz', {});
    expect(raw.error?.code).toBe(-32601);
    expect(raw.error?.message).toMatch(/Method not found/i);
  });

  it('returns error response (not crash) for malformed body', async () => {
    if (!serverAvailable) return;
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"not": "valid jsonrpc"}',
    });
    const body = await res.json() as { error?: { code: number } };
    expect(body.error).toBeTruthy();
  });
});

// ─── X-API-Key auth ──────────────────────────────────────────────────────────

describe('auth middleware', () => {
  it('POST /mcp succeeds without auth when AUTH_API_KEY not configured', async () => {
    if (!serverAvailable) return;
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
