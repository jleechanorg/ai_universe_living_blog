/**
 * Blog MCP Server — update_post and thread integration tests.
 * Covers Sections 6-7 of docs/manual-testing-guide.md.
 *
 * Run with: STORAGE_TYPE=memory npx vitest run tests/blog/update-threads.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

/** Parse the MCP tool result (inner JSON payload from content[0].text). */
function parseResult(res: request.Response): Record<string, unknown> {
  return JSON.parse((res.body.result as unknown as { content: Array<{ text: string }> }).content[0].text);
}

// ─── update_post tests ─────────────────────────────────────────────────────────

describe('update_post', () => {
  let app: Application;
  const prevStorageType = process.env['STORAGE_TYPE'];

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  afterAll(async () => {
    if (prevStorageType !== undefined) {
      process.env['STORAGE_TYPE'] = prevStorageType;
    } else {
      delete process.env['STORAGE_TYPE'];
    }
  });

  // Section 6-A: update title + content → verify updated values in response
  it('mutates title and content', async () => {
    // Create a post first
    const createRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('create_post', {
        repoKey: 'jleechanorg/widget',
        eventType: 'pr_opened',
        title: 'Original title',
        content: 'Original content',
        posterId: 'tester',
      }))
      .expect(200);

    const created = parseResult(createRes);
    const postId = (created.post as { id: string }).id;

    // Update title and content
    const updateRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('update_post', {
        postId,
        repoKey: 'jleechanorg/widget',
        updates: { title: 'Updated title', content: 'Updated content' },
      }))
      .expect(200);

    const updated = parseResult(updateRes);
    expect((updated.post as { title: string }).title).toBe('Updated title');
    expect((updated.post as { content: string }).content).toBe('Updated content');
  });

  // Section 6-B: update status to archived → verify updatedAt > createdAt
  it('status archived — updatedAt advances', async () => {
    const createRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('create_post', {
        repoKey: 'jleechanorg/widget',
        eventType: 'pr_approved',
        title: 'Archive me',
        content: 'Will be archived',
        posterId: 'tester',
      }))
      .expect(200);

    const created = parseResult(createRes);
    const postId = (created.post as { id: string }).id;
    const createdAt = (created.post as { createdAt: string }).createdAt;

    const updateRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('update_post', {
        postId,
        repoKey: 'jleechanorg/widget',
        updates: { status: 'archived' },
      }))
      .expect(200);

    const updated = parseResult(updateRes);
    expect((updated.post as { status: string }).status).toBe('archived');
    expect((updated.post as { updatedAt: string }).updatedAt > createdAt).toBe(true);
  });

  // Section 6-C: attempt to mutate repoKey → expect error
  it('repoKey mutation is rejected', async () => {
    const createRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('create_post', {
        repoKey: 'jleechanorg/widget',
        eventType: 'pr_opened',
        title: 'Do not move',
        content: 'Cannot change repoKey',
        posterId: 'tester',
      }))
      .expect(200);

    const created = parseResult(createRes);
    const postId = (created.post as { id: string }).id;

    // Storage rejects id/repoKey/threadId mutations by throwing.
    // The tool catches it and returns an MCP error (isError=true, HTTP 200).
    const updateRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('update_post', {
        postId,
        repoKey: 'jleechanorg/widget',
        updates: { repoKey: 'other/repo' },
      }))
      .expect(200);

    // Server returns HTTP 200; error is inside result.content[0].text
    const updated = parseResult(updateRes);
    expect(updated.error).toBeDefined();
    expect(typeof (updated.error as string)).toBe('string');
    expect((updated.error as string)).toContain('not allowed');
  });

  // Section 6-D: attempt to mutate id → expect error
  it('id mutation is rejected', async () => {
    const createRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('create_post', {
        repoKey: 'jleechanorg/widget',
        eventType: 'pr_opened',
        title: 'Id immutable',
        content: 'Cannot change id',
        posterId: 'tester',
      }))
      .expect(200);

    const created = parseResult(createRes);
    const postId = (created.post as { id: string }).id;

    const updateRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('update_post', {
        postId,
        repoKey: 'jleechanorg/widget',
        updates: { id: 'forged-id-123' },
      }))
      .expect(200);

    const updated = parseResult(updateRes);
    expect(updated.error).toBeDefined();
    expect((updated.error as string)).toContain('not allowed');
  });

  // Section 6-E: update non-existent postId → expect error
  it('non-existent postId returns error', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('update_post', {
        postId: '00000000-0000-0000-0000-000000000000',
        repoKey: 'jleechanorg/widget',
        updates: { title: 'Ghost update' },
      }))
      .expect(200);

    const parsed = parseResult(res);
    expect(parsed.error).toBeDefined();
  });
});

// ─── Thread tests ─────────────────────────────────────────────────────────────

describe('threads', () => {
  let app: Application;
  const prevStorageType = process.env['STORAGE_TYPE'];

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  afterAll(() => {
    if (prevStorageType !== undefined) {
      process.env['STORAGE_TYPE'] = prevStorageType;
    } else {
      delete process.env['STORAGE_TYPE'];
    }
  });

  // Section 7: Thread auto-created with first post (no explicit thread creation needed)
  it('first post auto-creates a thread', async () => {
    const repoKey = 'jleechanorg/brand-new-repo';

    await request(app)
      .post('/mcp')
      .send(mcpPayload('create_post', {
        repoKey,
        eventType: 'pr_opened',
        title: 'First ever post',
        content: 'This should auto-create a thread',
        posterId: 'bot',
        metadata: { prNumber: 99 },
      }))
      .expect(200);

    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('list_threads', { repoKey }))
      .expect(200);

    const result = parseResult(res);
    expect(result.threads).toBeDefined();
    expect((result.threads as unknown[])).toHaveLength(1);
    expect(((result.threads as { postCount: number }[])[0]).postCount).toBe(1);
  });

  // Section 7-A: 3 posts for same repo with SAME explicit threadId → 1 thread postCount:3
  it('3 posts with same explicit threadId → 1 thread with postCount:3', async () => {
    const repoKey = 'jleechanorg/thread-test';
    const threadId = '11111111-1111-1111-1111-111111111111';

    // Create 3 posts for the same explicit threadId
    for (let i = 1; i <= 3; i++) {
      await request(app)
        .post('/mcp')
        .send(mcpPayload('create_post', {
          repoKey,
          eventType: 'pr_opened',
          title: `Event ${i}`,
          content: `Content ${i}`,
          posterId: 'bot',
          threadId,
          metadata: { prNumber: 55 },
        }))
        .expect(200);
    }

    // list_threads — expect 1 thread with postCount 3
    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('list_threads', { repoKey }))
      .expect(200);

    const result = parseResult(res);
    expect(result.threads).toBeDefined();
    expect((result.threads as unknown[])).toHaveLength(1);
    expect(((result.threads as { postCount: number }[])[0]).postCount).toBe(3);
  });

  // Section 7-B: get_thread fetches by threadId, embedded posts array length 3, ordered by createdAt asc
  it('get_thread: returns thread with 3 posts ordered by createdAt asc', async () => {
    const repoKey = 'jleechanorg/thread-test';
    const threadId = '22222222-2222-2222-2222-222222222222';

    // Create 3 posts for the same threadId
    for (let i = 1; i <= 3; i++) {
      await request(app)
        .post('/mcp')
        .send(mcpPayload('create_post', {
          repoKey,
          eventType: 'pr_opened',
          title: `Event ${i}`,
          content: `Content ${i}`,
          posterId: 'bot',
          threadId,
        }))
        .expect(200);
    }

    // get_thread returns { thread, posts } → parseResult gives { thread, posts }
    const getRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('get_thread', { threadId, repoKey }))
      .expect(200);

    const parsed = parseResult(getRes) as { thread: { posts: unknown[] }; posts: unknown[] };
    const threadObj = parsed.thread as { posts: unknown[] } | undefined;

    // Handle both shapes: { thread: { thread, posts } } or { thread, posts }
    const posts: unknown[] = threadObj ? (threadObj as { posts: unknown[] }).posts ?? (parsed as { posts: unknown[] }).posts : (parsed as { posts: unknown[] }).posts;

    expect(posts).toBeDefined();
    expect(posts).toHaveLength(3);

    // Verify posts ordered by createdAt asc
    const postsWithTs = posts as Array<{ createdAt: string }>;
    for (let i = 1; i < postsWithTs.length; i++) {
      expect(postsWithTs[i].createdAt >= postsWithTs[i - 1].createdAt).toBe(true);
    }
  });

  // Section 7-C: Different explicit threadIds → different threads
  it('3 posts with different threadIds → 3 separate threads', async () => {
    const repoKey = 'jleechanorg/multi-pr';

    // Create one post per distinct threadId
    for (const [pr, tid] of [['10', '33333333-3333-3333-3333-333333333331'], ['11', '33333333-3333-3333-3333-333333333332'], ['12', '33333333-3333-3333-3333-333333333333']] as const) {
      await request(app)
        .post('/mcp')
        .send(mcpPayload('create_post', {
          repoKey,
          eventType: 'pr_opened',
          title: `PR #${pr} opened`,
          content: `PR #${pr} content`,
          posterId: 'bot',
          threadId: tid,
          metadata: { prNumber: Number(pr) },
        }))
        .expect(200);
    }

    // list_threads should return 3 distinct threads
    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('list_threads', { repoKey }))
      .expect(200);

    const result = parseResult(res);
    expect(result.threads).toBeDefined();
    expect((result.threads as unknown[])).toHaveLength(3);
  });
});
