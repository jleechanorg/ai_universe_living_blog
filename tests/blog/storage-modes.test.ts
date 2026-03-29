/**
 * Blog Storage Modes Integration Tests.
 * Tests that STORAGE_TYPE and FILE_STORAGE_PATH behave as documented.
 *
 * Run with: npx vitest run tests/blog/storage-modes.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Application } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

/** Create a post and return the parsed result.text object. */
async function createPost(app: Application, repoKey = 'test/test-repo', posterId = 'test-poster') {
  const res = await request(app)
    .post('/mcp')
    .send(mcpPayload('create_post', {
      repoKey,
      posterId,
      title: `Test Post ${randomUUID()}`,
      content: 'Storage mode test content',
      eventType: 'pr_merged',
    }))
    .expect(200);
  expect(res.body.result).toBeDefined();
  return JSON.parse((res.body.result as any).content[0].text);
}

/** List posts for a repo. */
async function listPosts(app: Application, repoKey = 'test/test-repo') {
  const res = await request(app)
    .post('/mcp')
    .send(mcpPayload('list_posts', { repoKey }))
    .expect(200);
  expect(res.body.result).toBeDefined();
  return JSON.parse((res.body.result as any).content[0].text);
}

// ─── File storage (default path) ──────────────────────────────────────────────

describe('file storage is default', () => {
  let app: Application;
  const prevStorageType = process.env['STORAGE_TYPE'];
  const prevStoragePath = process.env['FILE_STORAGE_PATH'];

  beforeAll(async () => {
    // Ensure file storage, no custom path → defaults to ./blog-data.json
    process.env['STORAGE_TYPE'] = 'file';
    delete process.env['FILE_STORAGE_PATH'];
    vi.resetModules();
    const mod = await import('../../src/blog/server.js');
    app = await mod.createBlogApp();
  }, 30000);

  afterAll(() => {
    process.env['STORAGE_TYPE'] = prevStorageType;
    if (prevStoragePath !== undefined) process.env['FILE_STORAGE_PATH'] = prevStoragePath;
    else delete process.env['FILE_STORAGE_PATH'];
  });

  afterEach(() => {
    const defaultPath = 'blog-data.json';
    try { if (existsSync(defaultPath)) unlinkSync(defaultPath); } catch { /* ignore */ }
  });

  it('creates blog-data.json in process.cwd() after posting', async () => {
    await createPost(app);
    expect(existsSync('blog-data.json')).toBe(true);
  });
});

// ─── File storage persistence ─────────────────────────────────────────────────

describe('file storage persists across createBlogApp() restarts', () => {
  let createBlogApp: () => Promise<Application>;
  const prevStorageType = process.env['STORAGE_TYPE'];
  const prevStoragePath = process.env['FILE_STORAGE_PATH'];
  const uniquePath = `/tmp/test-blog-${randomUUID()}.json`;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'file';
    process.env['FILE_STORAGE_PATH'] = uniquePath;
    vi.resetModules();
    const mod = await import('../../src/blog/server.js');
    createBlogApp = mod.createBlogApp;
  }, 30000);

  afterAll(() => {
    process.env['STORAGE_TYPE'] = prevStorageType;
    if (prevStoragePath !== undefined) process.env['FILE_STORAGE_PATH'] = prevStoragePath;
    else delete process.env['FILE_STORAGE_PATH'];
    try { if (existsSync(uniquePath)) unlinkSync(uniquePath); } catch { /* ignore */ }
  });

  it('post created in app1 is visible in app2 with same FILE_STORAGE_PATH', async () => {
    const app1 = await createBlogApp();
    const createResult = await createPost(app1);
    const postId = createResult.post.id;

    // Simulate restart: create a new app instance pointing at the same file
    const app2 = await createBlogApp();
    const listResult = await listPosts(app2);

    expect(listResult.posts.some((p: any) => p.id === postId)).toBe(true);
  });
});

// ─── Memory mode is ephemeral ──────────────────────────────────────────────────

describe('memory mode is ephemeral', () => {
  let createBlogApp: () => Promise<Application>;
  const prevStorageType = process.env['STORAGE_TYPE'];

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    vi.resetModules();
    const mod = await import('../../src/blog/server.js');
    createBlogApp = mod.createBlogApp;
  }, 30000);

  afterAll(() => {
    process.env['STORAGE_TYPE'] = prevStorageType;
  });

  it('list_posts returns empty after app restart (no persistence)', async () => {
    const app1 = await createBlogApp();
    await createPost(app1);

    const app2 = await createBlogApp();
    const listResult = await listPosts(app2);

    expect(listResult.posts).toHaveLength(0);
  });
});

// ─── Custom FILE_STORAGE_PATH ─────────────────────────────────────────────────

describe('custom FILE_STORAGE_PATH env var', () => {
  let app: Application;
  const prevStorageType = process.env['STORAGE_TYPE'];
  const prevStoragePath = process.env['FILE_STORAGE_PATH'];
  const customPath = `/tmp/custom-test-${randomUUID()}.json`;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'file';
    process.env['FILE_STORAGE_PATH'] = customPath;
    vi.resetModules();
    const mod = await import('../../src/blog/server.js');
    app = await mod.createBlogApp();
  }, 30000);

  afterAll(() => {
    process.env['STORAGE_TYPE'] = prevStorageType;
    if (prevStoragePath !== undefined) process.env['FILE_STORAGE_PATH'] = prevStoragePath;
    else delete process.env['FILE_STORAGE_PATH'];
    try { if (existsSync(customPath)) unlinkSync(customPath); } catch { /* ignore */ }
  });

  afterEach(() => {
    try { if (existsSync(customPath)) unlinkSync(customPath); } catch { /* ignore */ }
    try { if (existsSync('blog-data.json')) unlinkSync('blog-data.json'); } catch { /* ignore */ }
  });

  it('stores data at FILE_STORAGE_PATH, not blog-data.json', async () => {
    await createPost(app);

    expect(existsSync(customPath)).toBe(true);
    expect(existsSync('blog-data.json')).toBe(false);
  });
});
