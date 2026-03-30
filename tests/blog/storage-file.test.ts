/**
 * FileBlogStorage — load() validation tests.
 *
 * Verifies that FileBlogStorage.load() skips invalid posts (e.g. bad status enum)
 * instead of throwing, so the server can start with a corrupted data file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { FileBlogStorage } from '../../src/blog/storage-file.js';
import { logger } from '../../src/shared/logger.js';

const TEST_FILE = join(import.meta.dirname, '..', '..', '.tmp-file-storage.json');

function makeValidPost(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    repoKey: 'owner/repo',
    threadId: '550e8400-e29b-41d4-a716-446655440002',
    posterId: 'poster1',
    title: 'Test Post',
    content: 'Hello world',
    eventType: 'pr_created',
    tags: [],
    status: 'published',
    createdAt: '2026-03-29T10:00:00.000Z',
    updatedAt: '2026-03-29T10:00:00.000Z',
    slug: 'test-post',
    ...overrides,
  };
}

function makeValidPoster(overrides: Record<string, unknown> = {}) {
  return {
    id: 'poster1',
    name: 'Test Worker',
    type: 'ao_worker',
    createdAt: '2026-03-29T10:00:00.000Z',
    ...overrides,
  };
}

function makeValidThread(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440002',
    repoKey: 'owner/repo',
    posterId: 'poster1',
    title: 'Test Thread',
    postCount: 0,
    latestPostAt: '2026-03-29T10:00:00.000Z',
    status: 'open',
    createdAt: '2026-03-29T10:00:00.000Z',
    ...overrides,
  };
}

function writeData(data: object) {
  writeFileSync(TEST_FILE, JSON.stringify(data), 'utf8');
}

describe('FileBlogStorage load()', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockReturnValue(undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    try { unlinkSync(TEST_FILE); } catch { /* ignore */ }
  });

  it('loads valid posts successfully', async () => {
    writeData({
      posters: [makeValidPoster()],
      threads: [makeValidThread()],
      posts: [makeValidPost()],
    });

    const storage = new FileBlogStorage(TEST_FILE);
    const post = await storage.getPost('550e8400-e29b-41d4-a716-446655440001');
    expect(post).not.toBeNull();
    expect(post!.title).toBe('Test Post');
  });

  it('skips posts with invalid status enum and loads the rest', async () => {
    const validPost = makeValidPost({ id: '550e8400-e29b-41d4-a716-446655440010', title: 'Valid Post' });
    const invalidPost = {
      id: '550e8400-e29b-41d4-a716-446655440011',
      repoKey: 'owner/repo',
      threadId: '550e8400-e29b-41d4-a716-446655440002',
      posterId: 'poster1',
      title: 'Bad Status Post',
      content: 'Content',
      eventType: 'pr_created',
      tags: [],
      status: 'invalid_status', // <-- not 'draft' or 'published'
      createdAt: '2026-03-29T10:00:00.000Z',
      updatedAt: '2026-03-29T10:00:00.000Z',
      slug: 'bad-status-post',
    };

    writeData({
      posters: [makeValidPoster()],
      threads: [makeValidThread()],
      posts: [validPost, invalidPost],
    });

    // Must NOT throw
    const storage = new FileBlogStorage(TEST_FILE);

    // Valid post was loaded
    const loaded = await storage.getPost('550e8400-e29b-41d4-a716-446655440010');
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('Valid Post');

    // Invalid post was skipped
    const skipped = await storage.getPost('550e8400-e29b-41d4-a716-446655440011');
    expect(skipped).toBeNull();

    // Warning was logged
    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes('skipped invalid post'),
    );
    expect(warnCall).toBeDefined();
  });

  it('skips posts with missing required fields', async () => {
    const malformedPost = {
      id: '550e8400-e29b-41d4-a716-446655440012',
      repoKey: 'owner/repo',
      // missing threadId, posterId, title, content, eventType, status, etc.
    };

    writeData({
      posters: [makeValidPoster()],
      threads: [makeValidThread()],
      posts: [makeValidPost(), malformedPost],
    });

    // Must NOT throw
    const storage = new FileBlogStorage(TEST_FILE);

    // Valid post still loaded
    const loaded = await storage.getPost('550e8400-e29b-41d4-a716-446655440001');
    expect(loaded).not.toBeNull();

    // Malformed post skipped
    const skipped = await storage.getPost('550e8400-e29b-41d4-a716-446655440012');
    expect(skipped).toBeNull();

    expect(warnSpy).toHaveBeenCalled();
  });
});
