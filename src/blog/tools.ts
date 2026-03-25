import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { BlogStorage, RepoKey } from '../shared/types.js';
import {
  RepoKeySchema,
  PostEventTypeSchema,
  PostSchema,
  ThreadStatusSchema,
  type Post,
  type Thread,
} from '../shared/types.js';
import { logger } from '../shared/logger.js';

// ─── Tool parameter schemas ────────────────────────────────────────────────────

export const CreatePostParamsSchema = z.object({
  repoKey: RepoKeySchema,
  posterId: z.string().min(1),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  eventType: PostEventTypeSchema,
  threadId: z.string().uuid().optional(),
  tags: z.array(z.string()).default([]),
  metadata: PostSchema.shape.metadata.optional(),
});
export type CreatePostParams = z.infer<typeof CreatePostParamsSchema>;

export const ListPostsParams = z.object({
  repoKey: RepoKeySchema,
  posterId: z.string().optional(),
  status: z.enum(['draft', 'published']).optional(),
  eventType: PostEventTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().optional(),
});
export type ListPostsParamsIn = z.infer<typeof ListPostsParams>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function toMcpResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function toMcpError(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export interface BlogToolContext {
  storage: BlogStorage;
  agentId: string;
}

/**
 * Blog MCP tools — each returns MCP-compatible { content, isError }.
 * The server wraps these with BlogToolContext via closure.
 */
export function createBlogToolHandlers(ctx: BlogToolContext) {
  return {
    async create_post(rawParams: unknown) {
      try {
        const params = await CreatePostParamsSchema.parseAsync(rawParams);

        // Ensure poster exists
        const poster = await ctx.storage.getOrCreatePoster({
          id: params.posterId,
          name: params.posterId,
          type: 'ao_worker',
        });

        const now = new Date().toISOString();
        const resolvedThreadId = params.threadId ?? uuidv4();

        // Auto-create thread when no threadId is supplied (covers all event types).
        // Thread is keyed by the auto-generated UUID so each post gets its own thread
        // unless the caller explicitly joins an existing thread.
        if (!params.threadId) {
          const existing = await ctx.storage.getThread(resolvedThreadId);
          if (!existing) {
            const thread: Thread = {
              id: resolvedThreadId,
              repoKey: params.repoKey as RepoKey,
              posterId: poster.id,
              title: params.title,
              postCount: 0,
              latestPostAt: now,
              status: 'open',
              prNumber: params.metadata?.prNumber,
              prUrl: params.metadata?.prUrl,
              createdAt: now,
            };
            await ctx.storage.createThread(thread);
            logger.debug('Thread auto-created', { threadId: resolvedThreadId, repoKey: params.repoKey });
          }
        } else {
          // Reject cross-repo threadId: if caller passed an explicit threadId,
          // it must belong to the same repo (prevents one repo from appending into another's thread)
          const existing = await ctx.storage.getThread(params.threadId);
          if (existing && existing.repoKey !== (params.repoKey as RepoKey)) {
            return toMcpError(`Thread not found in repo: ${params.repoKey}`);
          }
        }

        const post: Post = {
          id: uuidv4(),
          repoKey: params.repoKey as RepoKey,
          threadId: resolvedThreadId,
          posterId: poster.id,
          title: params.title,
          content: params.content,
          eventType: params.eventType,
          tags: params.tags,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          slug: makeSlug(params.title),
          metadata: params.metadata,
        };

        const created = await ctx.storage.createPost(post);
        // Thread postCount is recomputed by storage.updateThread from actual threadPosts
        // — no manual increment needed, eliminating the read-modify-write race.
        try {
          await ctx.storage.updateThread(resolvedThreadId, { latestPostAt: now });
        } catch (updateErr) {
          logger.error('Thread update failed — post was created', {
            postId: created.id,
            threadId: resolvedThreadId,
            error: String(updateErr),
          });
        }

        logger.info('create_post OK', { postId: created.id, eventType: params.eventType, repoKey: params.repoKey });
        return toMcpResult({ success: true, post: created });
      } catch (err) {
        const msg = err instanceof z.ZodError
          ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
          : String(err);
        logger.error('create_post failed', { error: msg });
        return toMcpError(msg);
      }
    },

    async get_post(rawParams: unknown) {
      try {
        const { repoKey, postId } = await z.object({
          repoKey: RepoKeySchema,
          postId: z.string().uuid(),
        }).parseAsync(rawParams);

        const post = await ctx.storage.getPost(postId);
        if (!post) return toMcpError(`Post not found: ${postId}`);
        if (post.repoKey !== repoKey) return toMcpError(`Post not found in repo: ${repoKey}`);
        return toMcpResult(post);
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    async list_posts(rawParams: unknown) {
      try {
        const params = await ListPostsParams.parseAsync(rawParams);
        const result = await ctx.storage.listPosts({
          repoKey: params.repoKey as RepoKey,
          posterId: params.posterId,
          status: params.status,
          eventType: params.eventType,
          limit: params.limit,
          cursor: params.cursor,
        });
        return toMcpResult(result);
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    async update_post(rawParams: unknown) {
      try {
        const { repoKey, postId, ...updates } = await z.object({
          repoKey: RepoKeySchema,
          postId: z.string().uuid(),
          title: PostSchema.shape.title.optional(),
          content: PostSchema.shape.content.optional(),
          tags: PostSchema.shape.tags.optional(),
          status: PostSchema.shape.status.optional(),
        }).parseAsync(rawParams);

        const existing = await ctx.storage.getPost(postId);
        if (!existing) return toMcpError(`Post not found: ${postId}`);
        if (existing.repoKey !== repoKey) return toMcpError(`Post not found in repo: ${repoKey}`);

        const updated = await ctx.storage.updatePost(postId, updates);
        return toMcpResult({ success: true, post: updated });
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    async get_thread(rawParams: unknown) {
      try {
        const { repoKey, threadId } = await z.object({
          repoKey: RepoKeySchema,
          threadId: z.string().uuid(),
        }).parseAsync(rawParams);
        const thread = await ctx.storage.getThread(threadId);
        if (!thread) return toMcpError(`Thread not found: ${threadId}`);
        if (thread.repoKey !== repoKey) return toMcpError(`Thread not found in repo: ${repoKey}`);
        const posts = await ctx.storage.getPostsByThread(threadId);
        return toMcpResult({ thread, posts });
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    async list_threads(rawParams: unknown) {
      try {
        const params = await z.object({
          repoKey: RepoKeySchema,
          status: ThreadStatusSchema.optional(),
          limit: z.number().int().min(1).max(100).default(20).optional(),
          cursor: z.string().optional(),
        }).parseAsync(rawParams);
        const result = await ctx.storage.listThreads({
          repoKey: params.repoKey as RepoKey,
          status: params.status,
          limit: params.limit,
          cursor: params.cursor,
        });
        return toMcpResult(result);
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    async health_check() {
      return toMcpResult({ status: 'healthy', service: 'blog-mcp-server', version: '0.1.0' });
    },
  };
}

export type BlogToolName = keyof ReturnType<typeof createBlogToolHandlers>;
