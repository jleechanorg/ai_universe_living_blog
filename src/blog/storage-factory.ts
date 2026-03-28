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
import { FileBlogStorage } from './storage-file.js';
import { FirestoreBlogStorage } from './storage-firestore.js';
import type { BlogStorage } from '../shared/types.js';

export type StorageType = 'memory' | 'file' | 'firestore';

export interface StorageOptions {
  type: StorageType;
  /** file storage: path to JSON file (default: ./blog-data.json or FILE_STORAGE_PATH env) */
  filePath?: string;
  /** firestore storage: GCP project ID */
  projectId?: string;
  /** firestore storage: collection prefix */
  collection?: string;
}

export function createStorage(opts: StorageOptions): BlogStorage {
  switch (opts.type) {
    case 'memory':
      return new MemoryBlogStorage();
    case 'file':
      return new FileBlogStorage(opts.filePath);
    case 'firestore':
      return new FirestoreBlogStorage({
        projectId: opts.projectId,
        collection: opts.collection,
      });
    default:
      throw new Error(`Unknown storage type: ${(opts as StorageOptions).type}`);
  }
}
