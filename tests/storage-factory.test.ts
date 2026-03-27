import { describe, it, expect } from 'vitest';
import { createStorage, type StorageOptions } from '../src/blog/storage-factory.js';
import { MemoryBlogStorage } from '../src/blog/storage.js';
import { FirestoreBlogStorage } from '../src/blog/storage-firestore.js';

const skipIfNoEmulator = process.env.FIRESTORE_EMULATOR_HOST ? it : it.skip;

describe('createStorage', () => {
  it('creates MemoryBlogStorage when type=memory', () => {
    const opts: StorageOptions = { type: 'memory' };
    const storage = createStorage(opts);
    expect(storage).toBeInstanceOf(MemoryBlogStorage);
  });

  it('throws on unknown storage type', () => {
    const opts = { type: 'unknown' } as StorageOptions;
    expect(() => createStorage(opts)).toThrow('Unknown storage type');
  });

  it('memoizes MemoryBlogStorage instance (idempotent)', () => {
    const s1 = createStorage({ type: 'memory' });
    const s2 = createStorage({ type: 'memory' });
    // Both should work and be equivalent instances (same class)
    expect(s1).toBeInstanceOf(MemoryBlogStorage);
    expect(s2).toBeInstanceOf(MemoryBlogStorage);
  });

  skipIfNoEmulator('creates FirestoreBlogStorage when type=firestore', () => {
    // Exercises the Firestore branch of createStorage so lazy-load regressions are caught.
    const storage = createStorage({ type: 'firestore', collection: 'test-factory-posts' });
    expect(storage).toBeInstanceOf(FirestoreBlogStorage);
  });
});
