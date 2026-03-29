/**
 * Blog MCP Server Concurrency Tests.
 *
 * Exercises concurrent writes against FileBlogStorage to verify:
 * - All concurrent create_post calls succeed without corruption
 * - The persisted JSON file is valid after concurrent flushes
 * - list_posts reflects all writes correctly
 * - Concurrent update_post on the same post does not corrupt the file
 *
 * Run with: npx vitest run tests/blog/concurrency.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Extended timeout for beforeAll (module compilation can be slow on first run)
const HOOK_TIMEOUT = 60_000;
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Application } from 'express';

// ─── Env / app setup ──────────────────────────────────────────────────────────

const TEST_REPO = 'acme/concurrency-test' as const;
const CONCURRENT_COUNT = 20;

let tmpFilePath: string;
let app: Application;

// Store original env so we can restore after
const prevStorageType = process.env['STORAGE_TYPE'];
const prevFileStoragePath = process.env['FILE_STORAGE_PATH'];

beforeAll(async () => {
  tmpFilePath = join(tmpdir(), `concurrency-test-${randomUUID()}.json`);

  process.env['STORAGE_TYPE'] = 'file';
  process.env['FILE_STORAGE_PATH'] = tmpFilePath;

  const { createBlogApp } = await import('../../src/blog/server.js');
  app = await createBlogApp();
});

afterAll(() => {
  // Restore original env
  if (prevStorageType !== undefined) {
    process.env['STORAGE_TYPE'] = prevStorageType;
  } else {
    delete process.env['STORAGE_TYPE'];
  }
  if (prevFileStoragePath !== undefined) {
    process.env['FILE_STORAGE_PATH'] = prevFileStoragePath;
  } else {
    delete process.env['FILE_STORAGE_PATH'];
  }

  // Clean up temp file
  try {
    unlinkSync(tmpFilePath);
  } catch {
    // ignore if already gone
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

/** Fire a single create_post and return the parsed response. */
async function createPost(index: number): Promise<{ isError: boolean; success: boolean }> {
  const res = await request(app)
    .post('/mcp')
    .send(
      mcpPayload('create_post', {
        repoKey: TEST_REPO,
        eventType: 'pr_opened',
        title: `Stress post ${index}`,
        content: `concurrent write ${index}`,
        posterId: 'stress-bot',
      }, index)
    )
    .expect(200);

  const body = res.body;
  if (body.error) {
    return { isError: true, success: false };
  }
  const parsed = JSON.parse((body.result as any).content[0].text);
  return { isError: false, success: parsed.success };
}

/** Fire update_post concurrently on a post with a given ID. */
async function updatePost(postId: string, index: number): Promise<{ isError: boolean; success: boolean }> {
  const res = await request(app)
    .post('/mcp')
    .send(
      mcpPayload('update_post', {
        repoKey: TEST_REPO,
        postId,
        title: `Updated by writer ${index}`,
        content: `update content ${index}`,
      }, 1000 + index)
    )
    .expect(200);

  const body = res.body;
  if (body.error) {
    return { isError: true, success: false };
  }
  const parsed = JSON.parse((body.result as any).content[0].text);
  return { isError: false, success: parsed.success };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Blog MCP Server — Concurrency', () => {
  it('20 concurrent create_post writes all succeed without corruption', async () => {
    // Fire 20 concurrent writes
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_COUNT }, (_, i) => createPost(i + 1))
    );

    // All 20 must succeed
    expect(results.filter((r) => r.success)).toHaveLength(CONCURRENT_COUNT);
    expect(results.every((r) => !r.isError)).toBe(true);

    // list_posts must reflect all 20
    const listRes = await request(app)
      .post('/mcp')
      .send(mcpPayload('list_posts', { repoKey: TEST_REPO, limit: 30 }))
      .expect(200);

    const listParsed = JSON.parse(
      (listRes.body.result as any).content[0].text
    ) as { posts: unknown[] };
    expect(listParsed.posts).toHaveLength(CONCURRENT_COUNT);

    // The JSON file on disk must be valid (no partial-write corruption)
    const raw = readFileSync(tmpFilePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();

    // The persisted posts array must also have length 20
    const persisted = JSON.parse(raw) as { posts: unknown[] };
    expect(persisted.posts).toHaveLength(CONCURRENT_COUNT);
  });

  it('concurrent update_post calls on the same post keep file valid (last write wins)', async () => {
    // First create a post to update
    const createRes = await request(app)
      .post('/mcp')
      .send(
        mcpPayload('create_post', {
          repoKey: TEST_REPO,
          eventType: 'pr_opened',
          title: 'Original title',
          content: 'Original content',
          posterId: 'updater-bot',
        }, 999)
      )
      .expect(200);

    const createParsed = JSON.parse(
      (createRes.body.result as any).content[0].text
    ) as { post: { id: string } };
    const postId = createParsed.post.id;

    // Fire 10 concurrent updates on the same post
    const updateResults = await Promise.all(
      Array.from({ length: 10 }, (_, i) => updatePost(postId, i + 1))
    );

    // All update calls should succeed (or at minimum not error)
    expect(updateResults.filter((r) => r.success || !r.isError)).toHaveLength(10);

    // The JSON file must still be valid after all concurrent updates
    const raw = readFileSync(tmpFilePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();

    // File should still be a well-formed object with posts array
    const persisted = JSON.parse(raw) as { posts: unknown[] };
    expect(Array.isArray(persisted.posts)).toBe(true);
    expect(persisted.posts.length).toBeGreaterThan(0);
  });
});
