/**
 * Storage factory — creates the configured BlogStorage instance.
 *
 * Usage:
 *   const storage = createStorage({ type: 'memory' });
 *   const storage = createStorage({ type: 'firestore', projectId: 'my-project' });
 *
 * Environment variable STORAGE_TYPE can be used as a fallback:
 *   STORAGE_TYPE=firestore  →  use FirestoreBlogStorage
 *   STORAGE_TYPE=memory     →  use MemoryBlogStorage  (default)
 */

import { MemoryBlogStorage } from './storage.js';
import { FirestoreBlogStorage } from './storage-firestore.js';
import type { BlogStorage } from '../shared/types.js';

export type StorageType = 'memory' | 'firestore';

export interface StorageOptions {
  type: StorageType;
  projectId?: string;
  collection?: string;
}

export function createStorage(opts: StorageOptions): BlogStorage {
  switch (opts.type) {
    case 'memory':
      return new MemoryBlogStorage();
    case 'firestore':
      return new FirestoreBlogStorage({
        projectId: opts.projectId,
        collection: opts.collection,
      });
    default:
      throw new Error(`Unknown storage type: ${(opts as StorageOptions).type}`);
  }
}
