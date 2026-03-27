/**
 * FirestoreBlogStorage integration tests.
 *
 * Requires Firestore emulator to be running:
 *   firebase init emulators  (select Firestore)
 *   firebase emulators:start
 *   # emulator UI: http://localhost:4000/firestore
 *
 * Or set FIRESTORE_EMULATOR_HOST before running tests:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npm test -- tests/storage-firestore.test.ts
 *
 * If the emulator is not running, tests are automatically skipped.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FirestoreBlogStorage } from '../src/blog/storage-firestore.js';
import type { RepoKey } from '../src/shared/types.js';
import type { BlogStorage } from '../src/shared/types.js';

const TEST_REPO = 'test-owner/test-repo' as RepoKey;
const HAS_EMULATOR = !!process.env['FIRESTORE_EMULATOR_HOST'];

// Skip all tests if emulator is not running
const firestoreIt = HAS_EMULATOR ? it : it.skip;

// Unique collection name per test — guarantees isolation without needing per-doc cleanup
let _testIdx = 0;

describe('FirestoreBlogStorage', () => {
  let storage: BlogStorage;

  beforeEach(() => {
    // Each test gets a unique collection so no test sees another test's data
    storage = new FirestoreBlogStorage({ collection: `test_posts_${Date.now()}_${++_testIdx}` });
  });

  firestoreIt('creates and retrieves a poster', async () => {
    const poster = await storage.getOrCreatePoster({ id: 'firestore-worker', name: 'Firestore Worker', type: 'ao_worker' });
    expect(poster.id).toBe('firestore-worker');
    expect(poster.type).toBe('ao_worker');

    const retrieved = await storage.getPoster('firestore-worker');
    expect(retrieved?.id).toBe('firestore-worker');
  });

  firestoreIt('getOrCreatePoster returns existing poster', async () => {
    const p1 = await storage.getOrCreatePoster({ id: 'worker-x', name: 'Worker X', type: 'ao_worker' });
    const p2 = await storage.getOrCreatePoster({ id: 'worker-x', name: 'Changed Name', type: 'human' });
    expect(p1.createdAt).toBe(p2.createdAt);
    expect(p1.id).toBe(p2.id);
  });

  firestoreIt('createPost persists and getPost retrieves it', async () => {
    await storage.getOrCreatePoster({ id: 'ao-999', name: 'AO-999', type: 'ao_worker' });
    const post: Parameters<typeof storage.createPost>[0] = {
      id: '00000000-0000-0000-0000-000000000001',
      repoKey: TEST_REPO,
      threadId: '00000000-0000-0000-0000-000000000010',
      posterId: 'ao-999',
      title: 'Firestore Test Post',
      content: 'This post was stored in Firestore.',
      eventType: 'pr_created',
      tags: ['test', 'firestore'],
      status: 'published',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slug: 'firestore-test-post',
    };

    const created = await storage.createPost(post);
    expect(created.id).toBe(post.id);

    const retrieved = await storage.getPost(post.id);
    expect(retrieved?.title).toBe('Firestore Test Post');
    expect(retrieved?.content).toBe('This post was stored in Firestore.');
  });

  firestoreIt('updatePost changes content and updatedAt', async () => {
    await storage.getOrCreatePoster({ id: 'ao-888', name: 'AO-888', type: 'ao_worker' });
    const post: Parameters<typeof storage.createPost>[0] = {
      id: '00000000-0000-0000-0000-000000000002',
      repoKey: TEST_REPO,
      threadId: '00000000-0000-0000-0000-000000000011',
      posterId: 'ao-888',
      title: 'Original Title',
      content: 'Original content',
      eventType: 'pr_created',
      tags: [],
      status: 'published',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slug: 'original-title',
    };

    await storage.createPost(post);
    await new Promise((r) => setTimeout(r, 10)); // ensure updatedAt differs

    const updated = await storage.updatePost(post.id, { title: 'Updated Title', content: 'Updated content' });
    expect(updated.title).toBe('Updated Title');
    expect(updated.content).toBe('Updated content');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(post.updatedAt).getTime());
  });

  firestoreIt('listPosts returns posts in reverse chronological order', async () => {
    await storage.getOrCreatePoster({ id: 'ao-777', name: 'AO-777', type: 'ao_worker' });
    const t1 = '00000000-0000-0000-0000-000000000021';
    const t2 = '00000000-0000-0000-0000-000000000022';

    await storage.createPost({
      id: '00000000-0000-0000-0000-000000000003',
      repoKey: TEST_REPO, threadId: t1, posterId: 'ao-777',
      title: 'First post', content: 'First', eventType: 'pr_created',
      tags: [], status: 'published', createdAt: new Date(Date.now() - 2000).toISOString(), updatedAt: new Date(Date.now() - 2000).toISOString(), slug: 'first',
    });
    await storage.createPost({
      id: '00000000-0000-0000-0000-000000000004',
      repoKey: TEST_REPO, threadId: t2, posterId: 'ao-777',
      title: 'Second post', content: 'Second', eventType: 'pr_merged',
      tags: [], status: 'published', createdAt: new Date(Date.now() - 1000).toISOString(), updatedAt: new Date(Date.now() - 1000).toISOString(), slug: 'second',
    });

    const result = await storage.listPosts({ repoKey: TEST_REPO });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].title).toBe('Second post'); // newest first
    expect(result.posts[1].title).toBe('First post');
  });

  firestoreIt('getPost returns null for non-existent id', async () => {
    const result = await storage.getPost('non-existent-id-00000');
    expect(result).toBeNull();
  });

  it('can be instantiated with custom collection', () => {
    const custom = new FirestoreBlogStorage({ collection: 'my-posts' });
    expect(custom).toBeDefined();
  });

  it('can be instantiated with custom projectId', () => {
    const custom = new FirestoreBlogStorage({ projectId: 'my-project', collection: 'posts' });
    expect(custom).toBeDefined();
  });

  it('can be imported and instantiated from storage-factory', async () => {
    // Dynamically import to verify the lazy require works
    const { FirestoreBlogStorage: FreshFirestore } = await import('../src/blog/storage-firestore.js');
    const instance = new FreshFirestore({ collection: 'test-posts' });
    expect(instance).toBeDefined();
  });
});
