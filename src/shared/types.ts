// Shared types for ai-universe-living-blog
// Used by both blog and novel subsystems

import { z } from 'zod';

// ─── Repo Key ─────────────────────────────────────────────────────────────────

export const RepoKeySchema = z.string().regex(/^[^/]+\/[^/]+$/, '"owner/name" format required');
export type RepoKey = z.infer<typeof RepoKeySchema>;

export function encodeRepoKey(repoKey: RepoKey): string {
  // Use encodeURIComponent for a reversible, collision-free encoding.
  // encodeURIComponent('owner/repo') → 'owner%2Frepo'
  // decodeURIComponent('owner%2Frepo') → 'owner/repo'
  return encodeURIComponent(repoKey);
}

export function decodeRepoKey(encoded: string): RepoKey {
  return RepoKeySchema.parse(decodeURIComponent(encoded));
}

// ─── Poster ───────────────────────────────────────────────────────────────────

export const PosterTypeSchema = z.enum(['ao_worker', 'human']);
export type PosterType = z.infer<typeof PosterTypeSchema>;

export interface Poster {
  id: string;
  name: string;
  type: PosterType;
  avatarUrl?: string;
  createdAt: string; // ISO-8601
}

export const PosterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: PosterTypeSchema,
  avatarUrl: z.string().optional(),
  createdAt: z.string(),
});

// ─── Post ─────────────────────────────────────────────────────────────────────

// Well-known event types used by AO workers (not exhaustive — any non-empty string is valid).
// Exported as a reference for callers and for IDE autocomplete; not enforced at runtime.
export const KNOWN_EVENT_TYPES = [
  'pr_created',
  'pr_edited',
  'pr_reopened',
  'pr_rebased',
  'pr_review_requested',
  'pr_reviewed',
  'pr_checks_started',
  'pr_checks_passed',
  'pr_checks_failed',
  'pr_draft_toggled',
  'pr_merged',
  'pr_closed',
  'novel_branch_entry',
  'novel_daily_summary',
  'novel_top_level_edit',
] as const;

export const PostEventTypeSchema = z.string().min(1);
export type PostEventType = string;

export const PostMetadataSchema = z.object({
  dayNumber: z.number().int().positive().optional(),
  postCount: z.number().int().nonnegative().optional(),
  prNumber: z.number().int().positive().optional(),
  prUrl: z.string().url().optional(),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  checksPassed: z.boolean().optional(),
  reviewState: z.string().optional(),
  wordCount: z.number().int().optional(),
  sessionId: z.string().optional(),
  branchName: z.string().optional(),
  issueNumber: z.number().int().positive().optional(),
  beadIds: z.array(z.string()).optional(),
});
export type PostMetadata = z.infer<typeof PostMetadataSchema>;

export interface Post {
  id: string;
  repoKey: RepoKey;
  threadId: string;
  posterId: string;
  title: string;
  content: string; // markdown body
  eventType: PostEventType;
  tags: string[];
  status: 'draft' | 'published';
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  slug: string;
  metadata?: PostMetadata;
  /** Monotonic insertion sequence number for stable sort when timestamps collide */
  seq?: number;
}

export const PostSchema = z.object({
  id: z.string().uuid(),
  repoKey: RepoKeySchema,
  threadId: z.string().uuid(),
  posterId: z.string().min(1),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  eventType: PostEventTypeSchema,
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published']).default('published'),
  createdAt: z.string(),
  updatedAt: z.string(),
  slug: z.string(),
  metadata: PostMetadataSchema.optional(),
});

// ─── Thread ───────────────────────────────────────────────────────────────────

export const ThreadStatusSchema = z.enum(['open', 'merged', 'closed']);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export interface Thread {
  id: string;
  repoKey: RepoKey;
  posterId: string;
  title: string;
  postCount: number;
  latestPostAt: string;
  status: ThreadStatus;
  prNumber?: number;
  prUrl?: string;
  createdAt: string;
}

// ─── Storage Interface ─────────────────────────────────────────────────────────

export interface BlogStorage {
  // Poster ops
  getPoster(id: string): Promise<Poster | null>;
  createPoster(poster: Poster): Promise<void>;
  getOrCreatePoster(poster: Omit<Poster, 'createdAt'>): Promise<Poster>;

  // Post ops
  createPost(post: Post): Promise<Post>;
  getPost(id: string): Promise<Post | null>;
  updatePost(id: string, updates: Partial<Post>): Promise<Post>;
  listPosts(params: ListPostsParams): Promise<ListPostsResult>;
  getPostsByThread(threadId: string): Promise<Post[]>;

  // Thread ops
  getThread(id: string): Promise<Thread | null>;
  createThread(thread: Thread): Promise<Thread>;
  updateThread(id: string, updates: Partial<Thread>): Promise<Thread>;
  listThreads(params: ListThreadsParams): Promise<ListThreadsResult>;
}

export interface ListPostsParams {
  repoKey: RepoKey;
  posterId?: string;
  status?: 'draft' | 'published';
  eventType?: PostEventType;
  limit?: number;
  cursor?: string;
}

export interface ListPostsResult {
  posts: Post[];
  cursor?: string;
}

export interface ListThreadsParams {
  repoKey: RepoKey;
  status?: ThreadStatus;
  limit?: number;
  cursor?: string;
}

export interface ListThreadsResult {
  threads: Thread[];
  cursor?: string;
}

// ─── MCP Tool Request/Response ────────────────────────────────────────────────

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ─── Novel Types ───────────────────────────────────────────────────────────────

export interface StoryBead {
  id: string;
  description: string;
  emotionalAnchor: string;
  locations: string[]; // where in the novel it appears
}

export interface NovelEntry {
  id: string;
  repoKey: RepoKey;
  dayNumber: number; // e.g. 4 for "Day 4"
  date: string; // ISO date YYYY-MM-DD
  emotionalThesis: string;
  povWorkers: string[]; // e.g. ["Claude (ao-826)", "Codex (wc-63)"]
  wordCount: number;
  beadIds: string[];
  rawContent: string; // pre-edit content
  finalContent: string; // post top-level-editor content
  branchName: string;
  sessionId: string;
  createdAt: string;
  editedAt?: string;
}

export interface NovelEngineConfig {
  repoKey: RepoKey;
  sessionId: string;
  branchName: string;
  storage: BlogStorage;
}
