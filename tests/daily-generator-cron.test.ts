import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { BlogStorage, Post, RepoKey } from '../src/shared/types.js';
import { shouldRunDailySummary } from '../src/novel/daily-generator.js';

const TEST_REPO = 'test-owner/test-repo' as RepoKey;
const TEST_DATE = '2026-03-25';

function makePost(overrides: Partial<Post> = {}): Post {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    repoKey: TEST_REPO,
    threadId: uuidv4(),
    posterId: 'ao-826',
    title: 'Test Post',
    content: 'Test content',
    eventType: 'pr_created',
    tags: [],
    status: 'published',
    createdAt: `${TEST_DATE}T10:00:00.000Z`,
    updatedAt: now,
    slug: 'test-post',
    ...overrides,
  };
}

/**
 * Build a mock BlogStorage that returns canned posts for a given date + repoKey.
 */
function makeMockStorage(posts: Post[]): BlogStorage {
  return {
    async listPosts({ repoKey, limit = 100 }) {
      const filtered = posts.filter((p) => p.repoKey === repoKey);
      return { posts: filtered.slice(0, limit), cursor: undefined };
    },
    async getPoster() { return null; },
    async createPoster() {},
    async getOrCreatePoster() { throw new Error('not implemented'); },
    async createPost(p: Post) { return p; },
    async getPost() { return null; },
    async updatePost() { throw new Error('not implemented'); },
    async getPostsByThread() { return []; },
    async getThread() { return null; },
    async createThread() { throw new Error('not implemented'); },
    async updateThread() { throw new Error('not implemented'); },
    async listThreads() { throw new Error('not implemented'); },
  } as unknown as BlogStorage;
}

describe('shouldRunDailySummary', () => {
  it('returns true when 3 or more posts exist for the given date', async () => {
    const posts = [makePost(), makePost(), makePost()];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE);
    expect(result).toBe(true);
  });

  it('returns true when more than 3 posts exist for the given date', async () => {
    const posts = [makePost(), makePost(), makePost(), makePost(), makePost()];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE);
    expect(result).toBe(true);
  });

  it('returns false when fewer than 3 posts exist for the given date', async () => {
    const posts = [makePost(), makePost()];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE);
    expect(result).toBe(false);
  });

  it('returns false when zero posts exist for the given date', async () => {
    const storage = makeMockStorage([]);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE);
    expect(result).toBe(false);
  });

  it('ignores posts from other dates', async () => {
    const posts = [
      makePost({ createdAt: '2026-03-24T10:00:00.000Z' }),
      makePost({ createdAt: '2026-03-24T11:00:00.000Z' }),
      makePost({ createdAt: '2026-03-26T10:00:00.000Z' }),
    ];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE);
    expect(result).toBe(false);
  });

  it('ignores posts from other repos', async () => {
    const posts = [
      makePost({ repoKey: 'other/repo' as RepoKey }),
      makePost({ repoKey: 'other/repo' as RepoKey }),
      makePost({ repoKey: 'other/repo' as RepoKey }),
    ];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE);
    expect(result).toBe(false);
  });

  it('uses configurable minPosts threshold', async () => {
    // With minPosts=2, 2 posts should return true
    const posts = [makePost(), makePost()];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE, 2);
    expect(result).toBe(true);
  });

  it('respects minPosts=1 with single post', async () => {
    const posts = [makePost()];
    const storage = makeMockStorage(posts);
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE, 1);
    expect(result).toBe(true);
  });

  it('returns false when posts equal but not exceed minPosts-1', async () => {
    const posts = [makePost(), makePost()];
    const storage = makeMockStorage(posts);
    // minPosts=3 but only 2 posts
    const result = await shouldRunDailySummary(storage, TEST_REPO, TEST_DATE, 3);
    expect(result).toBe(false);
  });
});
