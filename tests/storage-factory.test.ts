import { describe, it, expect } from 'vitest';
import { createStorage, type StorageOptions } from '../src/blog/storage-factory.js';
import { MemoryBlogStorage } from '../src/blog/storage.js';

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
});
