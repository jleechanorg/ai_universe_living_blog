import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBlogStorage } from '../src/blog/storage.js';
import { createBlogToolHandlers, type BlogToolContext } from '../src/blog/tools.js';
import type { RepoKey } from '../src/shared/types.js';

const TEST_REPO = 'test-owner/test-repo' as RepoKey;

function makeCtx(): BlogToolContext & ReturnType<typeof createBlogToolHandlers> {
  const storage = new MemoryBlogStorage();
  const ctx: BlogToolContext = { storage, agentId: 'test-agent' };
  return { ...ctx, ...createBlogToolHandlers(ctx) };
}

describe('MemoryBlogStorage', () => {
  let storage: MemoryBlogStorage;

  beforeEach(() => {
    storage = new MemoryBlogStorage();
  });

  it('creates and retrieves a poster', async () => {
    const poster = await storage.getOrCreatePoster({ id: 'ao-826', name: 'ao-826', type: 'ao_worker' });
    expect(poster.id).toBe('ao-826');
    expect(poster.type).toBe('ao_worker');

    const retrieved = await storage.getPoster('ao-826');
    expect(retrieved?.id).toBe('ao-826');
  });

  it('getOrCreatePoster returns existing poster', async () => {
    const p1 = await storage.getOrCreatePoster({ id: 'ao-826', name: 'ao-826', type: 'ao_worker' });
    const p2 = await storage.getOrCreatePoster({ id: 'ao-826', name: 'changed', type: 'human' });
    expect(p1.createdAt).toBe(p2.createdAt);
  });

  it('create_post creates a post', async () => {
    const ctx = makeCtx();
    const result = await ctx.create_post({
      repoKey: TEST_REPO,
      posterId: 'ao-826',
      title: 'PR #42 opened — feat/bar',
      content: 'Claude opened PR #42 for feat/bar.',
      eventType: 'pr_created',
      metadata: { prNumber: 42, prUrl: 'https://github.com/test-owner/test-repo/pull/42' },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.post.id).toBeDefined();
    expect(parsed.post.eventType).toBe('pr_created');
  });

  it('create_post auto-creates thread for pr_created', async () => {
    const ctx = makeCtx();
    await ctx.create_post({
      repoKey: TEST_REPO,
      posterId: 'ao-826',
      title: 'PR #1 opened',
      content: 'First PR',
      eventType: 'pr_created',
      metadata: { prNumber: 1 },
    });
    // Thread is auto-created by create_post — retrieve via first post's threadId
    const posts = await ctx.storage.listPosts({ repoKey: TEST_REPO });
    const firstPost = JSON.parse((await ctx.list_posts({ repoKey: TEST_REPO })).content[0].text).posts[0];
    const thread = await ctx.storage.getThread(firstPost.threadId);
    expect(thread).not.toBeNull();
    expect(thread!.prNumber).toBe(1);
  });

  it('create_post auto-creates thread for novel events', async () => {
    const ctx = makeCtx();
    await ctx.create_post({
      repoKey: TEST_REPO,
      posterId: 'ao-826',
      title: 'Branch entry — feat/bar',
      content: 'Claude wrote a branch novel entry.',
      eventType: 'novel_branch_entry',
      threadId: '00000000-0000-0000-0000-000000000002',
    });
    const thread = await ctx.storage.getThread('00000000-0000-0000-0000-000000000002');
    expect(thread).not.toBeNull();
  });

  it('list_posts returns posts in reverse chronological order', async () => {
    const ctx = makeCtx();
    await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'First post', content: 'First', eventType: 'pr_created' });
    await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'Second post', content: 'Second', eventType: 'pr_merged' });

    const result = await ctx.list_posts({ repoKey: TEST_REPO });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.posts).toHaveLength(2);
    expect(parsed.posts[0].title).toBe('Second post');
    expect(parsed.posts[1].title).toBe('First post');
  });

  it('list_posts supports cursor pagination', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 5; i++) {
      await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: `Post ${i}`, content: `Content ${i}`, eventType: 'pr_created' });
    }

    const page1 = await ctx.list_posts({ repoKey: TEST_REPO, limit: 2 });
    const p1 = JSON.parse(page1.content[0].text);
    expect(p1.posts).toHaveLength(2);
    expect(p1.cursor).toBeDefined();

    const page2 = await ctx.list_posts({ repoKey: TEST_REPO, limit: 2, cursor: p1.cursor });
    const p2 = JSON.parse(page2.content[0].text);
    expect(p2.posts).toHaveLength(2);
    expect(p1.posts[0].id).not.toBe(p2.posts[0].id);
  });

  it('get_post returns 404 for non-existent post', async () => {
    const ctx = makeCtx();
    const result = await ctx.get_post({ repoKey: TEST_REPO, postId: '00000000-0000-0000-0000-000000000999' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('not found');
  });

  it('update_post changes content and updates updatedAt', async () => {
    const ctx = makeCtx();
    const create = await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'Original', content: 'Original content', eventType: 'pr_created' });
    const { post: { id } } = JSON.parse(create.content[0].text);
    const original = await ctx.storage.getPost(id);
    await new Promise((r) => setTimeout(r, 10));
    const update = await ctx.update_post({ repoKey: TEST_REPO, postId: id, title: 'Updated title', content: 'New content' });
    const parsed = JSON.parse(update.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.post.title).toBe('Updated title');
    expect(new Date(parsed.post.updatedAt).getTime()).toBeGreaterThan(new Date(original!.updatedAt).getTime());
  });

  it('health_check returns healthy status', async () => {
    const ctx = makeCtx();
    const result = await ctx.health_check();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('healthy');
    expect(parsed.service).toBe('blog-mcp-server');
  });

  it('rejects invalid repoKey format', async () => {
    const ctx = makeCtx();
    const result = await ctx.create_post({
      repoKey: 'invalid-without-owner-slash',
      posterId: 'ao-826', title: 'Test', content: 'Test', eventType: 'pr_created',
    });
    expect(result.isError).toBe(true);
  });

  it('filters list_posts by eventType', async () => {
    const ctx = makeCtx();
    await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'A', content: 'A', eventType: 'pr_created' });
    await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'B', content: 'B', eventType: 'pr_merged' });

    const result = await ctx.list_posts({ repoKey: TEST_REPO, eventType: 'pr_merged' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.posts).toHaveLength(1);
    expect(parsed.posts[0].eventType).toBe('pr_merged');
  });

  it('get_thread returns thread + all posts', async () => {
    const ctx = makeCtx();
    const threadId = '00000000-0000-0000-0000-000000000099';
    // Pre-create the thread (auto-create only fires when no threadId is provided)
    await ctx.storage.createThread({
      id: threadId, repoKey: TEST_REPO, posterId: 'ao-826',
      title: 'PR Thread', postCount: 0, latestPostAt: new Date().toISOString(),
      status: 'open', createdAt: new Date().toISOString(),
    });
    await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'P1', content: 'P1', eventType: 'pr_created', threadId });
    await ctx.create_post({ repoKey: TEST_REPO, posterId: 'ao-826', title: 'P2', content: 'P2', eventType: 'pr_merged', threadId });

    const result = await ctx.get_thread({ repoKey: TEST_REPO, threadId });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.thread.id).toBe(threadId);
    expect(parsed.posts).toHaveLength(2);
    expect(parsed.thread.postCount).toBe(2);
  });
});

describe('Blog MCP server', () => {
  it('createBlogApp exports an Express app factory', async () => {
    const { createBlogApp } = await import('../src/blog/server.js');
    const app = await createBlogApp();
    expect(typeof app).toBe('function');
  });
});
