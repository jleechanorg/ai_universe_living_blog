/**
 * FirestoreBlogStorage — BlogStorage implementation backed by Google Cloud Firestore.
 *
 * Supports:
 *   - Local dev with `@google-cloud/firestore` DataClient (Firestore emulator via FIRESTORE_EMULATOR_HOST)
 *   - Production with Firestore DataClient (ADC or FIRESTORE_EMULATOR_HOST)
 *
 * Document layout (one collection, sub-collections for threads):
 *   /posters/{posterId}           — Poster documents
 *   /posts/{postId}               — Post documents (flat, threadId as field)
 *   /threads/{threadId}           — Thread documents
 *
 * Indexes (created automatically on first run via the app):
 *   - posts(repoKey, createdAt desc)     — listPosts by repo
 *   - posts(threadId, createdAt asc)     — getPostsByThread
 *   - posts(repoKey, eventType, createdAt desc) — listPosts filtered
 *
 * Usage:
 *   const storage = new FirestoreBlogStorage({ collection: 'posts' });
 *   // or via factory:
 *   const storage = createStorage({ type: 'firestore', projectId: 'my-project' });
 */

import { Firestore, CollectionReference } from '@google-cloud/firestore';
import type {
  BlogStorage,
  Poster,
  Post,
  Thread,
  ListPostsParams,
  ListPostsResult,
  ListThreadsParams,
  ListThreadsResult,
} from '../shared/types.js';
import { PosterSchema, PostSchema } from '../shared/types.js';
import { logger } from '../shared/logger.js';

export interface FirestoreStorageOptions {
  projectId?: string;
  collection?: string;
}

export class FirestoreBlogStorage implements BlogStorage {
  private db: Firestore;
  private postsCol: CollectionReference;
  private postersCol: CollectionReference;
  private threadsCol: CollectionReference;

  constructor(opts: FirestoreStorageOptions = {}) {
    const firestoreOpts: { projectId?: string } = {};
    if (opts.projectId) firestoreOpts.projectId = opts.projectId;
    this.db = new Firestore(firestoreOpts);

    const collection = opts.collection ?? 'posts';
    this.postsCol = this.db.collection(collection);
    this.postersCol = this.db.collection(`${collection}_posters`);
    this.threadsCol = this.db.collection(`${collection}_threads`);

    logger.info('FirestoreBlogStorage initialized', { collection, projectId: opts.projectId ?? '(default)' });
  }

  // ─── Poster ────────────────────────────────────────────────────────────────

  async getPoster(id: string): Promise<Poster | null> {
    const snap = await this.postersCol.doc(id).get();
    if (!snap.exists) return null;
    return snap.data() as Poster;
  }

  async createPoster(poster: Poster): Promise<void> {
    PosterSchema.parse(poster);
    try {
      await this.postersCol.doc(poster.id).create(poster);
    } catch (err: unknown) {
      // Firestore error code 6 = ALREADY_EXISTS — surface a clear error instead of silently clobbering
      if ((err as { code?: number }).code === 6) {
        throw new Error(`Poster already exists: ${poster.id}`);
      }
      throw err;
    }
    logger.debug('Firestore: Poster created', { id: poster.id });
  }

  async getOrCreatePoster(poster: Omit<Poster, 'createdAt'>): Promise<Poster> {
    const existing = await this.getPoster(poster.id);
    if (existing) return existing;
    const created: Poster = { ...poster, createdAt: new Date().toISOString() };
    try {
      await this.createPoster(created);
      return created;
    } catch (err: unknown) {
      // ALREADY_EXISTS means another concurrent call created the poster — return it
      const raced = await this.getPoster(poster.id);
      if (raced) return raced;
      throw err;
    }
  }

  // ─── Post ─────────────────────────────────────────────────────────────────

  async createPost(post: Post): Promise<Post> {
    PostSchema.parse(post); // fail fast on malformed posts before durable write
    // Wrap post write + thread-aggregate refresh in a transaction so concurrent
    // post writes cannot clobber each other's postCount/latestPostAt.
    await this.db.runTransaction(async (tx) => {
      // Read thread doc first (before any writes) to determine if refresh is needed.
      if (post.threadId) {
        const snap = await tx.get(this.threadsCol.doc(post.threadId));
        if (snap.exists) {
          const posts = await tx.get(
            this.postsCol.where('threadId', '==', post.threadId).orderBy('createdAt', 'asc'),
          );
          const latestExistingPostAt = posts.docs.at(-1)?.data().createdAt;
          tx.set(
            this.threadsCol.doc(post.threadId),
            {
              postCount: posts.size + 1,
              latestPostAt:
                latestExistingPostAt && new Date(latestExistingPostAt) > new Date(post.createdAt)
                  ? latestExistingPostAt
                  : post.createdAt,
            },
            { merge: true },
          );
        }
        // Thread doesn't exist yet — skip refresh (non-fatal)
      }
      // Write the post last so it always succeeds even if thread refresh is skipped.
      tx.set(this.postsCol.doc(post.id), post);
    });
    logger.debug('Firestore: Post created', { id: post.id });
    return post;
  }

  async getPost(id: string): Promise<Post | null> {
    const snap = await this.postsCol.doc(id).get();
    if (!snap.exists) return null;
    return snap.data() as Post;
  }

  async updatePost(id: string, updates: Partial<Post>): Promise<Post> {
    const existing = await this.getPost(id);
    if (!existing) throw new Error(`Post not found: ${id}`);
    // id, repoKey, and threadId are immutable — reject attempts to change them
    if (updates.id !== undefined && updates.id !== id) {
      throw new Error('Updating post id is not allowed');
    }
    if (updates.repoKey !== undefined && updates.repoKey !== existing.repoKey) {
      throw new Error('Updating post repoKey is not allowed');
    }
    if (updates.threadId !== undefined && updates.threadId !== existing.threadId) {
      throw new Error('Updating post threadId is not allowed');
    }
    const updated: Post = {
      ...existing,
      ...updates,
      id,
      repoKey: existing.repoKey,
      threadId: existing.threadId,
      updatedAt: new Date().toISOString(),
    };
    await this.postsCol.doc(id).set(updated);
    return updated;
  }

  async listPosts(params: ListPostsParams): Promise<ListPostsResult> {
    let query: FirebaseFirestore.Query = this.postsCol
      .where('repoKey', '==', params.repoKey)
      .orderBy('createdAt', 'desc');

    if (params.posterId) {
      query = query.where('posterId', '==', params.posterId);
    }
    if (params.status) {
      query = query.where('status', '==', params.status);
    }
    if (params.eventType) {
      query = query.where('eventType', '==', params.eventType);
    }

    const limit = params.limit ?? 20;
    let q = query.limit(limit);
    if (params.cursor) {
      // Cursor is the last post id from the previous page
      const cursorDoc = await this.postsCol.doc(params.cursor).get();
      if (cursorDoc.exists) {
        q = query.startAfter(cursorDoc).limit(limit);
      } else {
        logger.warn('Firestore: Invalid cursor', { cursor: params.cursor });
        return { posts: [], cursor: undefined };
      }
    }

    const snap = await q.get();
    const posts = snap.docs.map((d) => d.data() as Post);
    const nextCursor = posts.length === limit ? posts[posts.length - 1]!.id : undefined;
    return { posts, cursor: nextCursor };
  }

  async getPostsByThread(threadId: string): Promise<Post[]> {
    const snap = await this.postsCol
      .where('threadId', '==', threadId)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => d.data() as Post);
  }

  // ─── Thread ───────────────────────────────────────────────────────────────

  async getThread(id: string): Promise<Thread | null> {
    const snap = await this.threadsCol.doc(id).get();
    if (!snap.exists) return null;
    return snap.data() as Thread;
  }

  async createThread(thread: Thread): Promise<Thread> {
    try {
      await this.threadsCol.doc(thread.id).create(thread);
    } catch (err: unknown) {
      // Firestore error code 6 = ALREADY_EXISTS — surface a clear error instead of silently clobbering
      if ((err as { code?: number }).code === 6) {
        throw new Error(`Thread already exists: ${thread.id}`);
      }
      throw err;
    }
    logger.debug('Firestore: Thread created', { id: thread.id });
    return thread;
  }

  async updateThread(id: string, updates: Partial<Thread>): Promise<Thread> {
    let updated: Thread | undefined;
    await this.db.runTransaction(async (tx) => {
      const threadSnap = await tx.get(this.threadsCol.doc(id));
      if (!threadSnap.exists) throw new Error(`Thread not found: ${id}`);
      const existing = threadSnap.data() as Thread;
      if (updates.id !== undefined && updates.id !== existing.id) {
        throw new Error('Updating thread id is not allowed');
      }
      if (updates.repoKey !== undefined && updates.repoKey !== existing.repoKey) {
        throw new Error('Updating thread repoKey is not allowed');
      }
      // Recompute postCount and latestPostAt from actual posts so aggregates are never stale.
      const postsSnap = await tx.get(
        this.postsCol.where('threadId', '==', id).orderBy('createdAt', 'asc'),
      );
      updated = {
        ...existing,
        ...updates,
        id: existing.id,
        repoKey: existing.repoKey,
        postCount: postsSnap.size,
        latestPostAt: postsSnap.docs.at(-1)?.data().createdAt ?? existing.latestPostAt,
      };
      tx.set(this.threadsCol.doc(id), updated);
    });
    return updated!;
  }

  async listThreads(params: ListThreadsParams): Promise<ListThreadsResult> {
    let query: FirebaseFirestore.Query = this.threadsCol
      .where('repoKey', '==', params.repoKey)
      .orderBy('latestPostAt', 'desc');

    if (params.status) {
      query = query.where('status', '==', params.status);
    }

    const limit = params.limit ?? 20;
    let q = query.limit(limit);
    if (params.cursor) {
      const cursorDoc = await this.threadsCol.doc(params.cursor).get();
      if (cursorDoc.exists) {
        q = query.startAfter(cursorDoc).limit(limit);
      }
    }

    const snap = await q.get();
    const threads = snap.docs.map((d) => d.data() as Thread);
    const nextCursor = threads.length === limit ? threads[threads.length - 1]!.id : undefined;
    return { threads, cursor: nextCursor };
  }
}
