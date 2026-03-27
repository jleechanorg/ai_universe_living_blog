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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

/**
 * In-memory blog storage with optional file persistence.
 * Swap for FirestoreBlogStorage for production persistence — the BlogStorage interface
 * is storage-engine agnostic.  Zero-config for local dev — no Firebase credentials required.
 *
 * When BLOG_DATA_DIR is set, posts are persisted to $BLOG_DATA_DIR/posts.jsonl
 * so they survive server restarts and can be read by external scripts (e.g. daily Remotion render).
 */
export class MemoryBlogStorage implements BlogStorage {
  private posters = new Map<string, Poster>();
  private posts = new Map<string, Post>();
  private threads = new Map<string, Thread>();
  // repoKey encoded -> Set<postId>
  private repoPosts = new Map<string, Set<string>>();
  // threadId -> Set<postId>
  private threadPosts = new Map<string, Set<string>>();
  // repoKey encoded -> Set<threadId>
  private repoThreads = new Map<string, Set<string>>();
  // Monotonic counter for stable sort when timestamps collide
  private postSeq = 0;

  /** Directory for file persistence. Undefined = no persistence. */
  private readonly dataDir: string | undefined;

  constructor() {
    this.dataDir = process.env['BLOG_DATA_DIR'] ?? process.env['DATA_DIR'];
    if (this.dataDir) {
      mkdirSync(this.dataDir, { recursive: true });
      this.loadPosts();
    }
    logger.info('MemoryBlogStorage initialized', {
      mode: this.dataDir ? `persisted@${this.dataDir}` : 'in-memory-only',
    });
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private postsPath(): string {
    return `${this.dataDir}/posts.jsonl`;
  }

  private persistPosts(): void {
    if (!this.dataDir) return;
    const lines = Array.from(this.posts.values())
      .map((p) => JSON.stringify(p))
      .join('\n');
    writeFileSync(this.postsPath(), lines, 'utf8');
    logger.debug('Posts persisted', { count: this.posts.size });
  }

  private loadPosts(): void {
    const filePath = this.postsPath();
    if (!existsSync(filePath)) {
      logger.debug('No posts file found, starting fresh');
      return;
    }
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const post = PostSchema.parse(JSON.parse(line)) as Post;
        this.posts.set(post.id, post);
        this.indexPost(post);
      } catch (err) {
        logger.warn('Failed to parse post from posts.jsonl', { line: line.slice(0, 80), err: String(err) });
      }
    }
    logger.info('Posts loaded from disk', { count: this.posts.size });
  }

  private indexPost(post: Post): void {
    const repoKeyEnc = encodeRepoKey(post.repoKey);
    if (!this.repoPosts.has(repoKeyEnc)) this.repoPosts.set(repoKeyEnc, new Set());
    this.repoPosts.get(repoKeyEnc)!.add(post.id);
    if (!this.threadPosts.has(post.threadId)) this.threadPosts.set(post.threadId, new Set());
    this.threadPosts.get(post.threadId)!.add(post.id);
  }

  // ─── Poster ────────────────────────────────────────────────────────────────

  async getPoster(id: string): Promise<Poster | null> {
    return this.posters.get(id) ?? null;
  }

  async createPoster(poster: Poster): Promise<void> {
    PosterSchema.parse(poster); // validate
    this.posters.set(poster.id, { ...poster });
    logger.debug('Poster created', { id: poster.id, name: poster.name });
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
    const validated = PostSchema.parse(post);
    this.postSeq++;
    (validated as Post & { seq: number }).seq = this.postSeq;
    this.posts.set(validated.id, validated);
    this.indexPost(validated);
    this.persistPosts();
    logger.debug('Post created', { id: validated.id, repoKey: validated.repoKey, eventType: validated.eventType });
    return validated;
  }

  async getPost(id: string): Promise<Post | null> {
    return this.posts.get(id) ?? null;
  }

  async updatePost(id: string, updates: Partial<Post>): Promise<Post> {
    const existing = this.posts.get(id);
    if (!existing) throw new Error(`Post not found: ${id}`);
    // Reject mutations to key fields — changes to id, repoKey, or threadId would corrupt indexes
    if (
      (updates.id !== undefined && updates.id !== existing.id) ||
      (updates.repoKey !== undefined && updates.repoKey !== existing.repoKey) ||
      (updates.threadId !== undefined && updates.threadId !== existing.threadId)
    ) {
      throw new Error('Updating post id, repoKey, or threadId is not allowed');
    }
    const updated: Post = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.posts.set(id, updated);
    this.persistPosts();
    logger.debug('Post updated', { id });
    return updated;
  }

  async listPosts(params: ListPostsParams): Promise<ListPostsResult> {
    const repoKeyEnc = encodeRepoKey(params.repoKey);
    const postIds = this.repoPosts.get(repoKeyEnc) ?? new Set<string>();
    const limit = params.limit ?? 20;

    const all: Post[] = [];
    for (const id of postIds) {
      const post = this.posts.get(id);
      if (!post) continue;
      if (params.posterId && post.posterId !== params.posterId) continue;
      if (params.status && post.status !== params.status) continue;
      if (params.eventType && post.eventType !== params.eventType) continue;
      all.push(post);
    }

    // Sort by createdAt descending
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || ((b.seq ?? 0) - (a.seq ?? 0)));

    // Cursor-based pagination (cursor = post id)
    let start = 0;
    if (params.cursor) {
      const idx = all.findIndex((p) => p.id === params.cursor);
      if (idx >= 0) start = idx + 1;
    }

    const slice = all.slice(start, start + limit);
    const nextCursor = slice.length === limit ? slice[slice.length - 1].id : undefined;

    return { posts: slice, cursor: nextCursor };
  }

  async getPostsByThread(threadId: string): Promise<Post[]> {
    const postIds = this.threadPosts.get(threadId) ?? new Set<string>();
    const posts: Post[] = [];
    for (const id of postIds) {
      const post = this.posts.get(id);
      if (post) posts.push(post);
    }
    posts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return posts;
  }

  // ─── Thread ───────────────────────────────────────────────────────────────

  async getThread(id: string): Promise<Thread | null> {
    return this.threads.get(id) ?? null;
  }

  async createThread(thread: Thread): Promise<Thread> {
    this.threads.set(thread.id, { ...thread });

    const repoKeyEnc = encodeRepoKey(thread.repoKey);
    if (!this.repoThreads.has(repoKeyEnc)) this.repoThreads.set(repoKeyEnc, new Set());
    this.repoThreads.get(repoKeyEnc)!.add(thread.id);

    logger.debug('Thread created', { id: thread.id, repoKey: thread.repoKey });
    return thread;
  }

  async updateThread(id: string, updates: Partial<Thread>): Promise<Thread> {
    const existing = this.threads.get(id);
    if (!existing) throw new Error(`Thread not found: ${id}`);
    // Reject id or repoKey mutations — would corrupt threads map and repoThreads index
    if (
      (updates.id !== undefined && updates.id !== existing.id) ||
      (updates.repoKey !== undefined && updates.repoKey !== existing.repoKey)
    ) {
      throw new Error('Updating thread id or repoKey is not allowed');
    }
    const updated: Thread = { ...existing, ...updates };
    this.threads.set(id, updated);

    // Update latestPostAt and postCount from actual posts
    const postIds = this.threadPosts.get(id) ?? new Set<string>();
    let latestPostAt = existing.createdAt;
    for (const pid of postIds) {
      const post = this.posts.get(pid);
      if (post && new Date(post.createdAt) > new Date(latestPostAt)) {
        latestPostAt = post.createdAt;
      }
    }
    updated.postCount = postIds.size;
    updated.latestPostAt = latestPostAt;
    this.threads.set(id, updated);

    return updated;
  }

  async listThreads(params: ListThreadsParams): Promise<ListThreadsResult> {
    const repoKeyEnc = encodeRepoKey(params.repoKey);
    const threadIds = this.repoThreads.get(repoKeyEnc) ?? new Set<string>();
    const limit = params.limit ?? 20;

    const all: Thread[] = [];
    for (const id of threadIds) {
      const thread = this.threads.get(id);
      if (!thread) continue;
      if (params.status && thread.status !== params.status) continue;
      all.push(thread);
    }

    all.sort((a, b) => new Date(b.latestPostAt).getTime() - new Date(a.latestPostAt).getTime());

    let start = 0;
    if (params.cursor) {
      const idx = all.findIndex((t) => t.id === params.cursor);
      if (idx >= 0) start = idx + 1;
    }

    const slice = all.slice(start, start + limit);
    const nextCursor = slice.length === limit ? slice[slice.length - 1].id : undefined;

    return { threads: slice, cursor: nextCursor };
  }
}
