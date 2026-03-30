/**
 * File-backed blog storage.
 *
 * Wraps MemoryBlogStorage and syncs to a single JSON file after every write.
 * Loads existing data on construction so posts survive server restarts with no
 * external infrastructure (no Firebase, no emulator, no GCP credentials).
 *
 * Default path: ./blog-data.json  (relative to cwd)
 * Override:     FILE_STORAGE_PATH env var  or  constructor option
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BlogStorage, Poster, Post, Thread, ListPostsParams, ListPostsResult, ListThreadsParams, ListThreadsResult } from '../shared/types.js';
import { MemoryBlogStorage } from './storage.js';
import { PostSchema } from '../shared/types.js';
import { logger } from '../shared/logger.js';

interface PersistedData {
  posters: Poster[];
  posts: Post[];
  threads: Thread[];
}

export class FileBlogStorage implements BlogStorage {
  private mem: MemoryBlogStorage;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? process.env['FILE_STORAGE_PATH'] ?? './blog-data.json';
    this.mem = new MemoryBlogStorage();
    this.load();
    logger.info('FileBlogStorage initialized', { path: this.filePath });
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) {
      logger.info('FileBlogStorage: no existing data file, starting fresh', { path: this.filePath });
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const data: PersistedData = JSON.parse(raw);
      // Replay into memory storage
      const posters: Poster[] = data.posters ?? [];
      const threads: Thread[] = data.threads ?? [];
      const posts: Post[] = data.posts ?? [];

      for (const p of posters) this.mem.createPoster(p);
      for (const t of threads) this.mem.createThread(t);
      for (const p of posts) {
        const parsed = PostSchema.safeParse(p);
        if (!parsed.success) {
          logger.warn('FileBlogStorage: skipped invalid post during load', {
            postId: (p as any).id ?? '(unknown)',
            error: parsed.error.issues.map(i => i.message).join('; '),
          });
          continue;
        }
        this.mem.createPost(parsed.data);
      }

      logger.info('FileBlogStorage: loaded from disk', {
        path: this.filePath,
        posters: posters.length,
        threads: threads.length,
        posts: posts.length,
      });
    } catch (err) {
      logger.error('FileBlogStorage: failed to load data file — starting fresh', { path: this.filePath, err });
    }
  }

  private async flush(): Promise<void> {
    try {
      // Read current state directly from memory maps via list calls
      const allPosts: Post[] = [];
      const allThreads: Thread[] = [];
      const allPosters: Poster[] = [];

      // Collect all posters/posts/threads via the internal raw dump
      const raw = (this.mem as unknown as { _dump(): PersistedData })._dump?.();
      if (raw) {
        allPosters.push(...raw.posters);
        allThreads.push(...raw.threads);
        allPosts.push(...raw.posts);
      }

      const dir = dirname(this.filePath);
      if (dir && dir !== '.') mkdirSync(dir, { recursive: true });

      writeFileSync(
        this.filePath,
        JSON.stringify({ posters: allPosters, threads: allThreads, posts: allPosts }, null, 2),
        'utf8',
      );
    } catch (err) {
      logger.error('FileBlogStorage: failed to flush to disk', { path: this.filePath, err });
    }
  }

  // ─── Poster ──────────────────────────────────────────────────────────────

  async getPoster(id: string): Promise<Poster | null> {
    return this.mem.getPoster(id);
  }

  async createPoster(poster: Poster): Promise<void> {
    await this.mem.createPoster(poster);
    await this.flush();
  }

  async getOrCreatePoster(poster: Omit<Poster, 'createdAt'>): Promise<Poster> {
    const result = await this.mem.getOrCreatePoster(poster);
    await this.flush();
    return result;
  }

  // ─── Post ─────────────────────────────────────────────────────────────────

  async createPost(post: Post): Promise<Post> {
    const result = await this.mem.createPost(post);
    await this.flush();
    return result;
  }

  async getPost(id: string): Promise<Post | null> {
    return this.mem.getPost(id);
  }

  async updatePost(id: string, updates: Partial<Post>): Promise<Post> {
    const result = await this.mem.updatePost(id, updates);
    await this.flush();
    return result;
  }

  async listPosts(params: ListPostsParams): Promise<ListPostsResult> {
    return this.mem.listPosts(params);
  }

  async getPostsByThread(threadId: string): Promise<Post[]> {
    return this.mem.getPostsByThread(threadId);
  }

  // ─── Thread ───────────────────────────────────────────────────────────────

  async getThread(id: string): Promise<Thread | null> {
    return this.mem.getThread(id);
  }

  async createThread(thread: Thread): Promise<Thread> {
    const result = await this.mem.createThread(thread);
    await this.flush();
    return result;
  }

  async updateThread(id: string, updates: Partial<Thread>): Promise<Thread> {
    const result = await this.mem.updateThread(id, updates);
    await this.flush();
    return result;
  }

  async listThreads(params: ListThreadsParams): Promise<ListThreadsResult> {
    return this.mem.listThreads(params);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async deletePost(id: string): Promise<void> {
    await this.mem.deletePost(id);
    await this.flush();
  }

  async deleteThread(id: string): Promise<void> {
    await this.mem.deleteThread(id);
    await this.flush();
  }
}
