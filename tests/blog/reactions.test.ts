/**
 * Blog MCP Server — post_reaction integration tests.
 *
 * Tests the react_to_post and get_reactions MCP tools:
 *  - Toggle add/remove reaction
 *  - Multiple workers reacting with same emoji
 *  - Multiple different emojis on same post
 *  - Cross-repo rejection
 *  - Invalid inputs (missing params, bad UUID, bad repoKey format)
 *  - Empty reactions on fresh post
 *  - Emoji removal when last worker un-reacts
 *
 * Run with: cd /Users/jleechan/projects_other/ai_universe_living_blog && npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

function parseResult(res: request.Response) {
  return JSON.parse((res.body.result as { content: Array<{ text: string }> }).content[0].text);
}

function parseError(res: request.Response) {
  return JSON.parse((res.body.result as { content: Array<{ text: string }> }).content[0].text);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('post_reaction', () => {
  let app: Application;
  // Created once and shared across tests
  let testPostId: string;
  let testThreadId: string;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();

    // Create a test post to react against
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/test-repo',
          posterId: 'setup-worker',
          title: 'Reaction test post',
          content: 'This post will be reacted to',
          eventType: 'pr_opened',
          tags: ['reaction-test'],
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const createResult = parseResult(res);
    testPostId = createResult.post.id;
    testThreadId = createResult.post.threadId;
    expect(testPostId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  }, 60_000);

  // ── 1. react_to_post — add reaction (toggle on) ─────────────────────────────

  it('adds a reaction to a post', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          workerId: 'ao-worker-1',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const result = parseResult(res);
    expect(result.added).toBe(true);
    expect(result.emoji).toBe('👍');
    expect(result.workerId).toBe('ao-worker-1');
    expect(result.postId).toBe(testPostId);
    expect(result.reactions['👍']).toContain('ao-worker-1');
  });

  // ── 2. react_to_post — second worker adds same emoji ───────────────────────

  it('allows multiple workers to react with the same emoji', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          workerId: 'wc-worker-2',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const result = parseResult(res);
    expect(result.added).toBe(true);
    expect(result.reactions['👍']).toContain('ao-worker-1');
    expect(result.reactions['👍']).toContain('wc-worker-2');
    expect(result.reactions['👍'].length).toBe(2);
  });

  // ── 3. react_to_post — toggle off (remove) ─────────────────────────────────

  it('removes a reaction when same worker + emoji is toggled off', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          workerId: 'ao-worker-1',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const result = parseResult(res);
    expect(result.added).toBe(false); // toggled off
    expect(result.reactions['👍']).not.toContain('ao-worker-1');
    expect(result.reactions['👍']).toContain('wc-worker-2');
  });

  // ── 4. react_to_post — different emoji on same post ─────────────────────────

  it('supports multiple different emojis on the same post', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          workerId: 'jc-worker-3',
          emoji: '🎉',
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const result = parseResult(res);
    expect(result.added).toBe(true);
    expect(result.emoji).toBe('🎉');
    expect(result.reactions['🎉']).toContain('jc-worker-3');
    // 👍 still has wc-worker-2
    expect(result.reactions['👍']).toContain('wc-worker-2');
  });

  // ── 5. react_to_post — emoji key cleanup when last worker un-reacts ─────────

  it('removes the emoji key entirely when the last worker un-reacts', async () => {
    // wc-worker-2 is the last 👍 reactor — remove them
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          workerId: 'wc-worker-2',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const result = parseResult(res);
    expect(result.added).toBe(false);
    expect(result.reactions['👍']).toBeUndefined(); // key removed
    // 🎉 still intact
    expect(result.reactions['🎉']).toContain('jc-worker-3');
  });

  // ── 6. get_reactions — returns reactions summary ────────────────────────────

  it('returns a correct reactions summary via get_reactions', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('get_reactions', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const result = parseResult(res);
    expect(result.postId).toBe(testPostId);
    expect(result.reactions).toBeDefined();
    expect(result.reactions['🎉']).toContain('jc-worker-3');
    expect(result.reactions['🎉'].length).toBe(1);

    const summary = result.summary as Array<{ emoji: string; count: number; workers: string[] }>;
    const thumbsUp = summary.find((s) => s.emoji === '🎉');
    expect(thumbsUp).toBeDefined();
    expect(thumbsUp!.count).toBe(1);
    expect(thumbsUp!.workers).toContain('jc-worker-3');

    expect(typeof result.totalReactions).toBe('number');
    expect(result.totalReactions).toBeGreaterThanOrEqual(1);
  });

  // ── 7. get_reactions — on a post with no reactions ──────────────────────────

  it('returns empty reactions for a fresh post with no reactions', async () => {
    // Create a fresh post
    const createRes = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/test-repo',
          posterId: 'setup-worker',
          title: 'Post with no reactions',
          content: 'A quiet post',
          eventType: 'pr_opened',
        }),
      )
      .expect(200);

    const createResult = parseResult(createRes);
    const freshPostId = createResult.post.id;

    const reactionsRes = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('get_reactions', {
          repoKey: 'jleechanorg/test-repo',
          postId: freshPostId,
        }),
      )
      .expect(200);

    expect(reactionsRes.body.error).toBeUndefined();
    const reactionsResult = parseResult(reactionsRes);
    expect(reactionsResult.reactions).toEqual({});
    expect(reactionsResult.summary).toEqual([]);
    expect(reactionsResult.totalReactions).toBe(0);
  });

  // ── 8. react_to_post — post not found ──────────────────────────────────────

  it('returns error when postId does not exist', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: fakeId,
          workerId: 'ao-worker-1',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    const err = parseError(res);
    expect(err.error).toMatch(/not found/i);
  });

  // ── 9. react_to_post — cross-repo rejection ─────────────────────────────────

  it('rejects reaction when repoKey does not match post repo', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/other-repo',
          postId: testPostId,
          workerId: 'ao-worker-1',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    const err = parseError(res);
    expect(err.error).toMatch(/not found in repo/i);
  });

  // ── 10. get_reactions — cross-repo rejection ────────────────────────────────

  it('rejects get_reactions when repoKey does not match', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('get_reactions', {
          repoKey: 'jleechanorg/other-repo',
          postId: testPostId,
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    const err = parseError(res);
    expect(err.error).toMatch(/not found in repo/i);
  });

  // ── 11. react_to_post — invalid UUID ────────────────────────────────────────

  it('returns error for invalid postId UUID format', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: 'not-a-valid-uuid',
          workerId: 'ao-worker-1',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    expect(parseError(res).error).toMatch(/postId/i);
  });

  // ── 12. react_to_post — invalid repoKey format ───────────────────────────────

  it('returns error for invalid repoKey format', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'invalid-repo-key',
          postId: testPostId,
          workerId: 'ao-worker-1',
          emoji: '👍',
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    expect(parseError(res).error).toMatch(/repoKey/i);
  });

  // ── 13. react_to_post — missing required fields ─────────────────────────────

  it('returns error when workerId is missing', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          emoji: '👍',
          // workerId intentionally omitted
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    expect(parseError(res).error).toMatch(/workerId/i);
  });

  it('returns error when emoji is missing', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('react_to_post', {
          repoKey: 'jleechanorg/test-repo',
          postId: testPostId,
          workerId: 'ao-worker-1',
          // emoji intentionally omitted
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    expect(parseError(res).error).toMatch(/emoji/i);
  });

  // ── 14. get_reactions — post not found ─────────────────────────────────────

  it('returns error for get_reactions with non-existent postId', async () => {
    const fakeId = '11111111-1111-1111-1111-111111111111';
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('get_reactions', {
          repoKey: 'jleechanorg/test-repo',
          postId: fakeId,
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    const err = parseError(res);
    expect(err.error).toMatch(/not found/i);
  });

  // ── 15. get_reactions — invalid UUID ────────────────────────────────────────

  it('returns error for get_reactions with invalid UUID', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('get_reactions', {
          repoKey: 'jleechanorg/test-repo',
          postId: 'bad-uuid',
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    expect(parseError(res).error).toMatch(/postId/i);
  });

  // ── 16. get_reactions — invalid repoKey ────────────────────────────────────

  it('returns error for get_reactions with invalid repoKey format', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('get_reactions', {
          repoKey: 'just-one-segment',
          postId: testPostId,
        }),
      )
      .expect(200);

    expect(res.body.result.isError).toBe(true);
    expect(parseError(res).error).toMatch(/repoKey/i);
  });
});
