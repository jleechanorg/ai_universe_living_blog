/**
 * Blog MCP Server — create_post integration tests.
 *
 * Covers Section 3 of docs/manual-testing-guide.md:
 *  - All PR lifecycle eventTypes (pr_opened, pr_checks_passed, pr_approved, etc.)
 *  - Novel eventTypes (novel_branch_entry, novel_daily_summary)
 *  - Custom open eventType strings (deploy_started, incident_detected)
 *  - Full metadata round-trip
 *  - Validation errors (missing repoKey, bad repoKey format, missing posterId)
 *  - Auto-slug generation (kebab-case)
 *
 * Run with: cd /Users/jleechan/projects_other/ai_universe_living_blog && npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

/** Parse the inner MCP text payload from a JSON-RPC result. */
function parseResult(res: request.Response) {
  return JSON.parse((res.body.result as { content: Array<{ text: string }> }).content[0].text);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('create_post', () => {
  let app: Application;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  // ── Section 3-A: All PR lifecycle eventTypes ────────────────────────────────

  const PR_LIFECYCLE_EVENTS = [
    'pr_opened',
    'pr_checks_passed',
    'pr_approved',
    'pr_merged',
    'pr_closed',
    'pr_reopened',
  ] as const;

  for (const event of PR_LIFECYCLE_EVENTS) {
    it(`accepts eventType: ${event}`, async () => {
      const res = await request(app)
        .post('/mcp')
        .send(
          mcpPayload('create_post', {
            repoKey: 'jleechanorg/widget',
            eventType: event,
            title: `PR event — ${event}`,
            content: `Testing ${event} acceptance`,
            posterId: 'test-worker',
          }),
        )
        .expect(200);

      expect(res.body.jsonrpc).toBe('2.0');
      expect(res.body.error).toBeUndefined();
      expect(res.body.result).toBeDefined();

      const result = parseResult(res);
      expect(result.success).toBe(true);
      expect(result.post).toBeDefined();
      expect(result.post.id).toBeDefined();
      // UUID format check
      expect(result.post.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.post.eventType).toBe(event);
      expect(result.post.repoKey).toBe('jleechanorg/widget');
      expect(result.post.status).toBe('published');
      expect(result.post.slug).toBeDefined();
    });
  }

  // ── Section 3-B: Novel eventTypes ──────────────────────────────────────────

  const NOVEL_EVENTS = ['novel_branch_entry', 'novel_daily_summary'] as const;

  for (const event of NOVEL_EVENTS) {
    it(`accepts novel eventType: ${event}`, async () => {
      const res = await request(app)
        .post('/mcp')
        .send(
          mcpPayload('create_post', {
            repoKey: 'jleechanorg/novel-test',
            eventType: event,
            title: `Novel: ${event}`,
            content: 'Prose content here',
            posterId: 'novel-engine',
          }),
        )
        .expect(200);

      const result = parseResult(res);
      expect(result.success).toBe(true);
      expect(result.post.eventType).toBe(event);
    });
  }

  // ── Section 3-C: Custom open eventType strings ──────────────────────────────

  const CUSTOM_EVENTS = ['deploy_started', 'incident_detected'] as const;

  for (const event of CUSTOM_EVENTS) {
    it(`accepts custom open eventType: ${event}`, async () => {
      const res = await request(app)
        .post('/mcp')
        .send(
          mcpPayload('create_post', {
            repoKey: 'jleechanorg/custom-events',
            eventType: event,
            title: `Custom event: ${event}`,
            content: `Content for ${event}`,
            posterId: 'deploy-bot',
          }),
        )
        .expect(200);

      const result = parseResult(res);
      expect(result.success).toBe(true);
      expect(result.post.eventType).toBe(event);
    });
  }

  // ── Section 3-D: Full metadata round-trip ──────────────────────────────────

  it('full metadata round-trip: all fields preserved', async () => {
    const metadata = {
      prNumber: 99,
      branchName: 'feat/x',
      commitSha: 'abc1234def0000',
      checksPassed: true,
      reviewState: 'APPROVED',
      beadIds: ['jleechan-abc1', 'jleechan-abc2'],
      sessionId: 'ao-826',
    };

    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/metadata-test',
          eventType: 'pr_approved',
          title: 'PR #99 approved',
          content: 'CodeRabbit approved after 3 rounds',
          posterId: 'cr-bot',
          metadata,
        }),
      )
      .expect(200);

    const result = parseResult(res);
    expect(result.success).toBe(true);
    expect(result.post.metadata).toEqual(metadata);
  });

  // Partial metadata round-trip — individual optional fields
  it('metadata: only prNumber returned intact', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/partial-meta',
          eventType: 'pr_opened',
          title: 'Minimal metadata',
          content: 'content',
          posterId: 'bot',
          metadata: { prNumber: 42 },
        }),
      )
      .expect(200);

    const result = parseResult(res);
    expect(result.post.metadata).toEqual({ prNumber: 42 });
  });

  // ── Section 3-E: Validation errors ─────────────────────────────────────────

  it('validation: missing repoKey → isError=true with descriptive message', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          eventType: 'pr_opened',
          title: 'No repo',
          content: 'content',
          posterId: 'bot',
        }),
      )
      .expect(200);

    expect(res.body.error).toBeUndefined();
    expect(res.body.result).toBeDefined();

    const mcpResult = res.body.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(mcpResult.isError).toBe(true);
    const inner = JSON.parse(mcpResult.content[0].text);
    expect(inner.error).toBeDefined();
    expect(inner.error.toLowerCase()).toContain('repokey');
  });

  it('validation: bad repoKey format "not-a-valid-key" → isError=true', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'not-a-valid-key',
          eventType: 'pr_opened',
          title: 'Bad key',
          content: 'content',
          posterId: 'bot',
        }),
      )
      .expect(200);

    const mcpResult = res.body.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(mcpResult.isError).toBe(true);
    const inner = JSON.parse(mcpResult.content[0].text);
    expect(inner.error).toBeDefined();
    // Should mention the format requirement
    expect(inner.error.toLowerCase()).toMatch(/repokey|owner|slash|format/);
  });

  it('validation: missing posterId → isError=true', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/poster-test',
          eventType: 'pr_opened',
          title: 'No poster',
          content: 'content',
        }),
      )
      .expect(200);

    const mcpResult = res.body.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(mcpResult.isError).toBe(true);
    const inner = JSON.parse(mcpResult.content[0].text);
    expect(inner.error).toBeDefined();
    expect(inner.error.toLowerCase()).toContain('posterid');
  });

  // ── Auto-slug generation ────────────────────────────────────────────────────

  it('auto-slug: "My Test Post" → "my-test-post"', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/slug-test',
          eventType: 'pr_opened',
          title: 'My Test Post',
          content: 'Content for slug verification',
          posterId: 'slug-bot',
        }),
      )
      .expect(200);

    const result = parseResult(res);
    expect(result.post.slug).toBe('my-test-post');
  });

  it('auto-slug: preserves numbers and hyphens', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/slug-test',
          eventType: 'pr_merged',
          title: 'PR #42 — feat/jleechan-3u2e',
          content: 'content',
          posterId: 'slug-bot',
        }),
      )
      .expect(200);

    const result = parseResult(res);
    // Should be kebab-case: lowercase, spaces→hyphens, special chars stripped
    expect(result.post.slug).toMatch(/^pr-42-feat-jleechan-3u2e$/);
  });

  it('auto-slug: long title is truncated to ≤80 chars', async () => {
    const longTitle = 'A'.repeat(100);

    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/slug-test',
          eventType: 'pr_opened',
          title: longTitle,
          content: 'content',
          posterId: 'slug-bot',
        }),
      )
      .expect(200);

    const result = parseResult(res);
    expect(result.post.slug.length).toBeLessThanOrEqual(80);
    expect(result.post.slug).toBe('a'.repeat(80));
  });

  // ── Response shape invariants ───────────────────────────────────────────────

  it('response shape: jsonrpc "2.0" on success', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/shape-test',
          eventType: 'pr_opened',
          title: 'Shape check',
          content: 'content',
          posterId: 'shape-bot',
        }),
      )
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(1);
    expect(res.body.result).toBeDefined();
    expect(res.body.error).toBeUndefined();
  });

  it('response shape: post has all required fields', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: 'jleechanorg/field-test',
          eventType: 'pr_checks_passed',
          title: 'All fields',
          content: 'Full content here',
          posterId: 'field-bot',
          tags: ['tag1', 'tag2'],
        }),
      )
      .expect(200);

    const result = parseResult(res);
    const post = result.post;

    expect(post.id).toBeDefined();
    expect(post.repoKey).toBe('jleechanorg/field-test');
    expect(post.threadId).toBeDefined();
    expect(post.posterId).toBeDefined();
    expect(post.title).toBe('All fields');
    expect(post.content).toBe('Full content here');
    expect(post.eventType).toBe('pr_checks_passed');
    expect(post.tags).toEqual(['tag1', 'tag2']);
    expect(post.status).toBe('published');
    expect(post.createdAt).toBeDefined();
    expect(post.updatedAt).toBeDefined();
    expect(post.slug).toBeDefined();
  });
});
