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

import { Firestore, CollectionReference, DocumentReference } from '@google-cloud/firestore';
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
import { PosterSchema, PostSchema, encodeRepoKey } from '../shared/types.js';
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
    await this.postersCol.doc(poster.id).set(poster);
    logger.debug('Firestore: Poster created', { id: poster.id });
  }

  async getOrCreatePoster(poster: Omit<Poster, 'createdAt'>): Promise<Poster> {
    const existing = await this.getPoster(poster.id);
    if (existing) return existing;
    const created: Poster = { ...poster, createdAt: new Date().toISOString() };
    await this.createPoster(created);
    return created;
  }

  // ─── Post ─────────────────────────────────────────────────────────────────

  async createPost(post: Post): Promise<Post> {
    PostSchema.parse(post); // fail fast on malformed posts before durable write
    await this.postsCol.doc(post.id).set(post);
    logger.debug('Firestore: Post created', { id: post.id });
    // Refresh thread aggregates so postCount/latestPostAt stay accurate
    if (post.threadId) {
      try {
        const posts = await this.getPostsByThread(post.threadId);
        await this.threadsCol.doc(post.threadId).set({
          postCount: posts.length,
          latestPostAt: posts[posts.length - 1]?.createdAt ?? post.createdAt,
        }, { merge: true });
      } catch {
        // Non-fatal: thread refresh should not block post creation
        logger.debug('Firestore: Thread refresh skipped', { threadId: post.threadId });
      }
    }
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
    await this.threadsCol.doc(thread.id).set(thread);
    logger.debug('Firestore: Thread created', { id: thread.id });
    return thread;
  }

  async updateThread(id: string, updates: Partial<Thread>): Promise<Thread> {
    const existing = await this.getThread(id);
    if (!existing) throw new Error(`Thread not found: ${id}`);
    if (updates.id !== undefined && updates.id !== existing.id) {
      throw new Error('Updating thread id is not allowed');
    }
    if (updates.repoKey !== undefined && updates.repoKey !== existing.repoKey) {
      throw new Error('Updating thread repoKey is not allowed');
    }
    // Recompute postCount and latestPostAt from actual posts so aggregates are never stale.
    const posts = await this.getPostsByThread(id);
    const updated: Thread = {
      ...existing,
      ...updates,
      id: existing.id,
      repoKey: existing.repoKey,
      postCount: posts.length,
      latestPostAt: posts[posts.length - 1]?.createdAt ?? existing.latestPostAt,
    };
    await this.threadsCol.doc(id).set(updated);
    return updated;
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
