/**
 * Blog MCP Tools Integration Tests.
 * Tests each MCP tool via createBlogToolHandlers with real MemoryBlogStorage.
 *
 * Run with: npx vitest run tests/blog/tools-integration.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { MemoryBlogStorage } from '../../src/blog/storage.js';
import { createBlogToolHandlers, type BlogToolContext } from '../../src/blog/tools.js';
import { RepoRegistry } from '../../src/blog/repo-registry.js';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Setup ───────────────────────────────────────────────────────────────────

function makeCtx() {
  const dataDir = join(tmpdir(), `blog-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dataDir, { recursive: true });
  const storage = new MemoryBlogStorage();
  const registry = new RepoRegistry(dataDir);
  const ctx: BlogToolContext = { storage, agentId: 'test-agent', registry, dataDir };
  return { ctx, dataDir, tools: createBlogToolHandlers(ctx) };
}

function parseResult(result: { content: Array<{ text: string; isError?: boolean }> }) {
  return JSON.parse(result.content[0].text);
}

// ─── Blog tools (1-14) ────────────────────────────────────────────────────────

describe('Blog tools', () => {
  let tools: ReturnType<typeof createBlogToolHandlers>;
  let ctx: BlogToolContext;
  let dataDir: string;

  beforeEach(() => {
    const setup = makeCtx();
    tools = setup.tools;
    ctx = setup.ctx;
    dataDir = setup.dataDir;
  });

  // 1
  it('create_post: creates post + thread for pr_created', async () => {
    const result = await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'PR #42 opened',
      content: 'A new PR was opened.',
      eventType: 'pr_created',
      tags: ['pr'],
    });

    expect(result.isError).toBe(false);
    const post = parseResult(result);
    expect(post.success).toBe(true);
    expect(post.post.id).toBeDefined();
    expect(post.post.eventType).toBe('pr_created');
    expect(post.post.threadId).toBeDefined();

    // Thread should be auto-created
    const thread = await ctx.storage.getThread(post.post.threadId);
    expect(thread).not.toBeNull();
    expect(thread!.title).toBe('PR #42 opened');
  });

  // 2
  it('create_post: creates thread for novel_branch_entry', async () => {
    const result = await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'novel-engine',
      title: 'Branch entry for feat/x',
      content: 'A branch entry was generated.',
      eventType: 'novel_branch_entry',
      tags: ['novel'],
    });

    expect(result.isError).toBe(false);
    const post = parseResult(result);
    expect(post.success).toBe(true);

    const thread = await ctx.storage.getThread(post.post.threadId);
    expect(thread).not.toBeNull();
    expect(thread!.posterId).toBe('novel-engine');
  });

  // 3
  it('create_post: reuses existing thread when threadId provided', async () => {
    const threadId = uuidv4();

    const r1 = await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'First post in thread',
      content: 'Opening post.',
      eventType: 'pr_created',
      threadId,
    });
    expect(parseResult(r1).success).toBe(true);
    expect(parseResult(r1).post.threadId).toBe(threadId);

    const r2 = await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-2',
      title: 'Reply in same thread',
      content: 'A follow-up.',
      eventType: 'pr_edited',
      threadId,
    });
    expect(parseResult(r2).success).toBe(true);
    expect(parseResult(r2).post.threadId).toBe(threadId);

    const thread = await ctx.storage.getThread(threadId);
    expect(thread).not.toBeNull();
    const posts = await ctx.storage.getPostsByThread(threadId);
    expect(posts).toHaveLength(2);
  });

  // 4
  it('get_post: returns post by id', async () => {
    const create = await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Find me',
      content: 'Content.',
      eventType: 'pr_created',
    });
    const postId = parseResult(create).post.id;

    const result = await tools.get_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      postId,
    });

    expect(result.isError).toBe(false);
    const post = parseResult(result);
    expect(post.id).toBe(postId);
    expect(post.title).toBe('Find me');
  });

  // 5
  it('get_post: returns error for unknown id', async () => {
    const fakeId = uuidv4();
    const result = await tools.get_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      postId: fakeId,
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toContain('not found');
  });

  // 6
  it('list_posts: filters by repoKey', async () => {
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Post in blog',
      content: 'Content.',
      eventType: 'pr_created',
    });
    await tools.create_post({
      repoKey: 'other/repo',
      posterId: 'ao-worker-1',
      title: 'Post in other',
      content: 'Content.',
      eventType: 'pr_created',
    });

    const result = await tools.list_posts({
      repoKey: 'jleechanorg/ai_universe_living_blog',
    });

    expect(result.isError).toBe(false);
    const { posts } = parseResult(result);
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('Post in blog');
  });

  // 7
  it('list_posts: filters by eventType', async () => {
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'PR opened',
      content: 'Opened.',
      eventType: 'pr_created',
    });
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'PR merged',
      content: 'Merged.',
      eventType: 'pr_merged',
    });

    const result = await tools.list_posts({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      eventType: 'pr_merged',
    });

    expect(result.isError).toBe(false);
    const { posts } = parseResult(result);
    expect(posts).toHaveLength(1);
    expect(posts[0].eventType).toBe('pr_merged');
  });

  // 8
  it('list_posts: filters by posterId', async () => {
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'worker-a',
      title: 'Worker A post',
      content: 'Content.',
      eventType: 'pr_created',
    });
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'worker-b',
      title: 'Worker B post',
      content: 'Content.',
      eventType: 'pr_created',
    });

    const result = await tools.list_posts({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'worker-a',
    });

    expect(result.isError).toBe(false);
    const { posts } = parseResult(result);
    expect(posts).toHaveLength(1);
    expect(posts[0].posterId).toBe('worker-a');
  });

  // 9
  it('list_posts: cursor pagination works', async () => {
    const repoKey = 'jleechanorg/ai_universe_living_blog';
    for (let i = 0; i < 5; i++) {
      await tools.create_post({
        repoKey,
        posterId: 'ao-worker-1',
        title: `Post ${i}`,
        content: `Content ${i}.`,
        eventType: 'pr_created',
      });
    }

    const page1 = await tools.list_posts({ repoKey, limit: 2 });
    const { posts: page1Posts, cursor } = parseResult(page1);
    expect(page1Posts).toHaveLength(2);
    expect(cursor).toBeDefined();

    const page2 = await tools.list_posts({ repoKey, limit: 2, cursor });
    const { posts: page2Posts } = parseResult(page2);
    expect(page2Posts).toHaveLength(2);
    // page2 should not include page1's last item
    const page1Ids = page1Posts.map((p: { id: string }) => p.id);
    const overlap = page2Posts.filter((p: { id: string }) => page1Ids.includes(p.id));
    expect(overlap).toHaveLength(0);
  });

  // 10
  it('update_post: updates title and status', async () => {
    const create = await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Original title',
      content: 'Original content.',
      eventType: 'pr_created',
    });
    const postId = parseResult(create).post.id;

    const result = await tools.update_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      postId,
      title: 'Updated title',
      status: 'draft',
    });

    expect(result.isError).toBe(false);
    const updated = parseResult(result);
    expect(updated.success).toBe(true);
    expect(updated.post.title).toBe('Updated title');
    expect(updated.post.status).toBe('draft');

    // Persisted
    const fresh = await ctx.storage.getPost(postId);
    expect(fresh!.title).toBe('Updated title');
    expect(fresh!.status).toBe('draft');
  });

  // 11
  it('update_post: cannot update non-existent post', async () => {
    const fakeId = uuidv4();
    const result = await tools.update_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      postId: fakeId,
      title: 'New title',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toContain('not found');
  });

  // 12
  it('get_thread: returns thread with posts sorted by createdAt', async () => {
    const threadId = uuidv4();
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Post A',
      content: 'First.',
      eventType: 'pr_created',
      threadId,
    });
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Post B',
      content: 'Second.',
      eventType: 'pr_edited',
      threadId,
    });

    const result = await tools.get_thread({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      threadId,
    });

    expect(result.isError).toBe(false);
    const { thread, posts } = parseResult(result);
    expect(thread.id).toBe(threadId);
    expect(posts).toHaveLength(2);
    // Posts are sorted ascending by createdAt
    expect(posts[0].title).toBe('Post A');
    expect(posts[1].title).toBe('Post B');
  });

  // 13
  it('get_thread: scoped by repoKey — cross-repo access returns not found', async () => {
    // Use a separate ctx (fresh storage + registry) so no cross-contamination
    const { tools: otherTools } = makeCtx();
    const threadId = uuidv4();
    await otherTools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Post in blog',
      content: 'Content.',
      eventType: 'pr_created',
      threadId,
    });

    // Same threadId but queried against a different repo
    const result = await otherTools.get_thread({
      repoKey: 'other/repo',
      threadId,
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toContain('not found');
  });

  // 14
  it('list_threads: filters by repoKey', async () => {
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'ao-worker-1',
      title: 'Thread 1',
      content: 'Content.',
      eventType: 'pr_created',
    });
    await tools.create_post({
      repoKey: 'other/repo',
      posterId: 'ao-worker-1',
      title: 'Thread 2',
      content: 'Content.',
      eventType: 'pr_created',
    });

    const result = await tools.list_threads({
      repoKey: 'jleechanorg/ai_universe_living_blog',
    });

    expect(result.isError).toBe(false);
    const { threads } = parseResult(result);
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe('Thread 1');
  });
});

// ─── Repo tools (15-23) ───────────────────────────────────────────────────────

describe('Repo tools', () => {
  let tools: ReturnType<typeof createBlogToolHandlers>;
  let ctx: BlogToolContext;

  beforeEach(() => {
    const setup = makeCtx();
    tools = setup.tools;
    ctx = setup.ctx;
  });

  // 15
  it('register_repo: adds repo to registry', async () => {
    const result = await tools.register_repo({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      enabled: true,
      modes: { autoScan: true, novelBranch: false, novelDaily: false },
    });

    expect(result.isError).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.repo.repoKey).toBe('jleechanorg/ai_universe_living_blog');
    expect(parsed.repo.modes.autoScan).toBe(true);

    // Persisted in registry
    const found = ctx.registry!.get('jleechanorg/ai_universe_living_blog');
    expect(found).not.toBeNull();
  });

  // 16
  it('register_repo: duplicate repo → throws (registry rejects duplicates)', async () => {
    // Use a dedicated key so this test doesn't pollute test 17's unregister
    await tools.register_repo({
      repoKey: 'dup-test/repo',
      enabled: true,
      modes: { autoScan: false, novelBranch: false, novelDaily: false },
    });
    // RepoRegistry.register throws on duplicate — tool catches it and returns isError
    const result = await tools.register_repo({
      repoKey: 'dup-test/repo',
      enabled: true,
      modes: { autoScan: false, novelBranch: false, novelDaily: false },
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toMatch(/already registered/i);
  });

  // 17
  it('unregister_repo: removes repo', async () => {
    await tools.register_repo({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      enabled: true,
      modes: { autoScan: false, novelBranch: false, novelDaily: false },
    });

    const result = await tools.unregister_repo({
      repoKey: 'jleechanorg/ai_universe_living_blog',
    });

    expect(result.isError).toBe(false);
    expect(parseResult(result).success).toBe(true);

    const found = ctx.registry!.get('jleechanorg/ai_universe_living_blog');
    expect(found).toBeNull();
  });

  // 18
  it('update_repo: changes enabled mode', async () => {
    await tools.register_repo({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      enabled: true,
      modes: { autoScan: false, novelBranch: false, novelDaily: false },
    });

    const result = await tools.update_repo({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      enabled: false,
      modes: { autoScan: true },
    });

    expect(result.isError).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.repo.enabled).toBe(false);
    expect(parsed.repo.modes.autoScan).toBe(true);
  });

  // 19
  it('list_repos: returns all registered repos', async () => {
    await tools.register_repo({ repoKey: 'repo/a', enabled: true, modes: { autoScan: false, novelBranch: false, novelDaily: false } });
    await tools.register_repo({ repoKey: 'repo/b', enabled: false, modes: { autoScan: false, novelBranch: false, novelDaily: false } });

    const result = await tools.list_repos();

    expect(result.isError).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.repos).toHaveLength(2);
    const keys = parsed.repos.map((r: { repoKey: string }) => r.repoKey);
    expect(keys).toContain('repo/a');
    expect(keys).toContain('repo/b');
  });

});

// 20 — chat_worker: three-tier inference backend
describe('chat_worker', () => {
  let tools: ReturnType<typeof createBlogToolHandlers>;
  let ctx: BlogToolContext;

  beforeEach(() => {
    const setup = makeCtx();
    tools = setup.tools;
    ctx = setup.ctx;
    // Ensure no inference env vars are set
    delete process.env['OPENCLAW_INFERENCE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  // 20a: Tier 3 — no backend configured, unknown worker → regex-only no-record response
  it('chat_worker: no backends configured, unknown worker → regex-only no-record response', async () => {
    const result = await tools.chat_worker({
      workerId: 'unknown-worker-xyz',
      message: 'hello',
      repoKey: 'jleechanorg/ai_universe_living_blog',
    });

    expect(result.isError).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.response).toMatch(/don't have a record|record.*yet/i);
    expect(parsed.workerId).toBe('unknown-worker-xyz');
    expect(parsed.backend).toBe('regex-only');
  });

  // 20b: Tier 3 — no backend configured, known worker → regex-only voice extraction
  it('chat_worker: no backends configured, known worker → regex-only voice extraction', async () => {
    // Create a novel_branch_entry for this worker
    await tools.create_post({
      repoKey: 'jleechanorg/ai_universe_living_blog',
      posterId: 'test-worker',
      title: 'First day on the job',
      content:
        "I'm test-worker. I process pull requests all day. The code flows through me like water through a pipe.",
      eventType: 'novel_branch_entry',
      metadata: { sessionId: 'test-worker' },
    });

    const result = await tools.chat_worker({
      workerId: 'test-worker',
      message: 'What do you think about this PR?',
      repoKey: 'jleechanorg/ai_universe_living_blog',
    });

    expect(result.isError).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.workerId).toBe('test-worker');
    expect(typeof parsed.tone).toBe('string');
    expect(parsed.backend).toBe('regex-only');
  });

  // 20c: Tier 2 — ANTHROPIC_API_KEY set, unknown worker → WorkerChat returns no-record
  it('chat_worker: ANTHROPIC_API_KEY set, unknown worker → WorkerChat no-record response', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-anthropic-key';

    try {
      const result = await tools.chat_worker({
        workerId: 'unknown-worker-xyz',
        message: 'hello',
        repoKey: 'jleechanorg/ai_universe_living_blog',
      });

      expect(result.isError).toBe(false);
      const parsed = parseResult(result);
      expect(parsed.response).toMatch(/don't have a record|record.*yet/i);
      expect(parsed.workerId).toBe('unknown-worker-xyz');
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  // 20d: Tier 1 — OPENCLAW_INFERENCE_URL set → POST to that URL (fails without server)
  it('chat_worker: OPENCLAW_INFERENCE_URL set → calls inference endpoint', async () => {
    process.env['OPENCLAW_INFERENCE_URL'] = 'https://inference.example.com/chat';

    try {
      const result = await tools.chat_worker({
        workerId: 'test-worker',
        message: 'hello',
        repoKey: 'jleechanorg/ai_universe_living_blog',
      });

      // Without a real server the fetch fails → error response
      expect(result.isError).toBe(true);
      const parsed = parseResult(result);
      expect(parsed.error).toMatch(/inference|fetch|ECONNREFUSED/i);
    } finally {
      delete process.env['OPENCLAW_INFERENCE_URL'];
    }
  });
});
