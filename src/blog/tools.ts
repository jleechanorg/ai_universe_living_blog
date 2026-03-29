import { randomBytes } from 'crypto';
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
import { RepoRegistry, type RepoConfig } from './repo-registry.js';
import { hashKey, mutateApiKeys, type ApiKey } from './auth.js';

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
    .replace(/[/]/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
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
  registry?: RepoRegistry;
  dataDir?: string;
  /** In-memory Prometheus counter map — set by server.ts */
  metricsCounters?: Map<string, number>;
}

// ─── New tool schemas ─────────────────────────────────────────────────────────

export const RegisterRepoParamsSchema = z.object({
  repoKey: RepoKeySchema,
  enabled: z.boolean().default(true),
  githubToken: z.string().optional(),
  webhookSecret: z.string().optional(),
  modes: z.object({
    autoScan: z.boolean().default(false),
    novelBranch: z.boolean().default(false),
    novelDaily: z.boolean().default(false),
  }),
  scanIntervalMs: z.number().int().positive().optional(),
});

export const UnregisterRepoParamsSchema = z.object({
  repoKey: RepoKeySchema,
});


export const UpdateRepoParamsSchema = z.object({
  repoKey: RepoKeySchema,
  enabled: z.boolean().optional(),
  modes: z.object({
    autoScan: z.boolean().optional(),
    novelBranch: z.boolean().optional(),
    novelDaily: z.boolean().optional(),
  }).optional(),
  scanIntervalMs: z.number().int().positive().optional(),
  githubToken: z.string().optional(),
  webhookSecret: z.string().optional(),
});

export const GenerateApiKeyParamsSchema = z.object({
  label: z.string().min(1),
  scopes: z.array(z.enum(['read', 'write', 'admin'])).default(['read', 'write']),
});

export const ChatWorkerParamsSchema = z.object({
  workerId: z.string().min(1),
  message: z.string().min(1),
  repoKey: RepoKeySchema,
});

export const DeletePostParamsSchema = z.object({
  repoKey: RepoKeySchema,
  postId: z.string().uuid(),
});

export const GetRepoStatsParamsSchema = z.object({
  repoKey: RepoKeySchema,
  days: z.number().int().positive().default(7),
});

export const SearchPostsParamsSchema = z.object({
  repoKey: RepoKeySchema,
  q: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  eventType: PostEventTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().optional(),
});

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
          // Explicit threadId: create it if missing (caller may generate the UUID,
          // e.g. novel engine), or join an existing thread in the same repo.
          // Reject only if the existing thread belongs to a different repo.
          const existing = await ctx.storage.getThread(params.threadId);
          if (existing && existing.repoKey !== (params.repoKey as RepoKey)) {
            return toMcpError(`Thread not found in repo: ${params.repoKey}`);
          }
          if (!existing) {
            const thread: Thread = {
              id: params.threadId,
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
            try {
              await ctx.storage.createThread(thread);
              logger.debug('Thread created from explicit threadId', { threadId: params.threadId, repoKey: params.repoKey });
            } catch (createErr) {
              // Another concurrent caller created the thread between getThread and createThread.
              // Re-fetch and validate the repoKey to prevent cross-repo thread attachment.
              const reFetched = await ctx.storage.getThread(params.threadId);
              if (!reFetched) {
                throw createErr; // unexpected — surface the original error
              }
              if (reFetched.repoKey !== (params.repoKey as RepoKey)) {
                return toMcpError(`Thread not found in repo: ${params.repoKey}`);
              }
              logger.debug('Thread already exists (race resolved)', { threadId: params.threadId });
            }
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
        if (ctx.metricsCounters) {
          const key = `blog_posts_created_total{repo="${params.repoKey}"}`;
          ctx.metricsCounters.set(key, (ctx.metricsCounters.get(key) ?? 0) + 1);
        }
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
        const { repoKey, postId } = await z.object({
          repoKey: RepoKeySchema,
          postId: z.string().uuid(),
        }).parseAsync(rawParams);
        // Support both: { postId, repoKey, updates: {...} } and flat { postId, repoKey, title, status, ... }
        const raw = rawParams as Record<string, unknown>;
        const updates: Record<string, unknown> =
          (typeof raw['updates'] === 'object' && raw['updates'] !== null && !Array.isArray(raw['updates']))
            ? raw['updates'] as Record<string, unknown>
            : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'repoKey' && k !== 'postId'));

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

    // ─── G.1 search_posts ─────────────────────────────────────────────────────

    async search_posts(rawParams: unknown) {
      try {
        const params = await SearchPostsParamsSchema.parseAsync(rawParams);
        // Require at least one filter
        if (!params.q && !params.eventType) {
          return toMcpError('At least one of q or eventType is required');
        }

        const q = params.q?.toLowerCase();
        const limit = params.limit ?? 20;

        // Scan all posts for this repo (demo-scale acceptable)
        const all: import('../shared/types.js').Post[] = [];
        let cursor: string | undefined;
        do {
          const page = await ctx.storage.listPosts({
            repoKey: params.repoKey as RepoKey,
            limit: 1000,
            cursor,
          });
          all.push(...page.posts);
          cursor = page.cursor;
        } while (cursor);

        // Filter
        const matched = all.filter((post) => {
          if (params.eventType && post.eventType !== params.eventType) return false;
          if (params.tags?.length && !params.tags.every((t) => post.tags?.includes(t))) return false;
          if (q && !(post.title + ' ' + post.content).toLowerCase().includes(q)) return false;
          return true;
        });

        // Cursor-based pagination on filtered results
        const start = params.cursor
          ? matched.findIndex((p) => p.id === params.cursor) + 1
          : 0;
        const slice = matched.slice(start, start + limit);
        const nextCursor = matched.length > start + limit ? slice[slice.length - 1]?.id : undefined;

        return toMcpResult({ posts: slice, cursor: nextCursor, total: matched.length });
      } catch (err) {
        return toMcpError(err instanceof z.ZodError
          ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
          : String(err));
      }
    },

    // ─── G.2 delete_post ─────────────────────────────────────────────────────

    async delete_post(rawParams: unknown) {
      try {
        const { repoKey, postId } = await DeletePostParamsSchema.parseAsync(rawParams);

        const post = await ctx.storage.getPost(postId);
        if (!post) return toMcpError(`Post not found: ${postId}`);
        if (post.repoKey !== repoKey) return toMcpError(`Post not found in repo: ${repoKey}`);

        const threadId = post.threadId;
        await ctx.storage.deletePost(postId);

        // Prune thread if it has no remaining posts
        let threadPruned = false;
        const postsLeft = await ctx.storage.getPostsByThread(threadId);
        if (postsLeft.length === 0) {
          await ctx.storage.deleteThread(threadId);
          threadPruned = true;
        }

        logger.info('delete_post OK', { postId, threadPruned });
        if (ctx.metricsCounters) {
          const key = `blog_posts_deleted_total{repo="${repoKey}"}`;
          ctx.metricsCounters.set(key, (ctx.metricsCounters.get(key) ?? 0) + 1);
        }
        return toMcpResult({ ok: true, postId, threadPruned });
      } catch (err) {
        return toMcpError(err instanceof z.ZodError
          ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
          : String(err));
      }
    },

    // ─── G.3 get_repo_stats ──────────────────────────────────────────────────

    async get_repo_stats(rawParams: unknown) {
      try {
        const params = await GetRepoStatsParamsSchema.parseAsync(rawParams);
        const days = params.days;

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString();

        // Single pass over all posts for this repo
        const all: import('../shared/types.js').Post[] = [];
        let cursor: string | undefined;
        do {
          const page = await ctx.storage.listPosts({
            repoKey: params.repoKey as RepoKey,
            limit: 1000,
            cursor,
          });
          all.push(...page.posts);
          cursor = page.cursor;
        } while (cursor);

        const recent = all.filter((p) => p.createdAt >= cutoffStr);
        const recentSet = new Set(recent.map((p) => p.threadId));

        // Tag counts
        const tagCounts = new Map<string, number>();
        for (const p of all) {
          for (const t of p.tags ?? []) {
            tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          }
        }
        const topTags = [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([tag, count]) => ({ tag, count }));

        // EventType counts
        const eventTypeCounts = new Map<string, number>();
        for (const p of all) {
          eventTypeCounts.set(p.eventType, (eventTypeCounts.get(p.eventType) ?? 0) + 1);
        }
        const topEventTypes = [...eventTypeCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([eventType, count]) => ({ eventType, count }));

        // Daily breakdown
        const dailyMap = new Map<string, number>();
        for (const p of recent) {
          const date = p.createdAt.slice(0, 10); // YYYY-MM-DD
          dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
        }
        const dailyBreakdown: { date: string; count: number }[] = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          dailyBreakdown.push({ date: dateStr, count: dailyMap.get(dateStr) ?? 0 });
        }

        return toMcpResult({
          repoKey: params.repoKey,
          totalPosts: all.length,
          totalThreads: recentSet.size,
          [`postsLast${days}Days`]: recent.length,
          topTags,
          topEventTypes,
          dailyBreakdown,
        });
      } catch (err) {
        return toMcpError(err instanceof z.ZodError
          ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
          : String(err));
      }
    },

    // ─── Repo management ──────────────────────────────────────────────────────

    async register_repo(rawParams: unknown) {
      if (!ctx.registry) return toMcpError('registry not available');
      try {
        const params = await RegisterRepoParamsSchema.parseAsync(rawParams);
        const now = new Date().toISOString();
        const cfg: RepoConfig = {
          repoKey: params.repoKey,
          enabled: params.enabled,
          githubToken: params.githubToken,
          webhookSecret: params.webhookSecret,
          modes: params.modes,
          scanIntervalMs: params.scanIntervalMs,
          createdAt: now,
          updatedAt: now,
        };
        ctx.registry.register(cfg);
        return toMcpResult({ success: true, repo: cfg });
      } catch (err) {
        return toMcpError(err instanceof z.ZodError
          ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
          : String(err));
      }
    },

    async unregister_repo(rawParams: unknown) {
      try {
        const { repoKey } = await UnregisterRepoParamsSchema.parseAsync(rawParams);
        if (!ctx.registry) return toMcpError('registry not available');
        ctx.registry.unregister(repoKey);
        return toMcpResult({ success: true });
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    async list_repos() {
      if (!ctx.registry) return toMcpError('registry not available');
      return toMcpResult({ repos: ctx.registry.list() });
    },

    async update_repo(rawParams: unknown) {
      try {
        if (!ctx.registry) return toMcpError('registry not available');
        const params = await UpdateRepoParamsSchema.parseAsync(rawParams);
        const existing = ctx.registry.get(params.repoKey);
        if (!existing) return toMcpError(`Repo not found: ${params.repoKey}`);
        ctx.registry.update(params.repoKey, {
          ...params,
          modes: params.modes ? { ...existing.modes, ...params.modes } : undefined,
        });
        const updated = ctx.registry.get(params.repoKey);
        return toMcpResult({ success: true, repo: updated });
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    // ─── API key management ─────────────────────────────────────────────────

    async generate_api_key(rawParams: unknown) {
      if (!ctx.dataDir) return toMcpError('dataDir not available');
      try {
        const params = await GenerateApiKeyParamsSchema.parseAsync(rawParams);
        // Generate random 32-byte hex key (64 chars)
        const plaintext = randomBytes(32).toString('hex');
        const hashed = hashKey(plaintext);
        const entry: ApiKey = {
          key: hashed,
          label: params.label,
          scopes: params.scopes,
          createdAt: new Date().toISOString(),
        };
        await mutateApiKeys(ctx.dataDir, (keys) => [...keys, entry]);
        return toMcpResult({
          key: plaintext,
          label: entry.label,
          scopes: entry.scopes,
          createdAt: entry.createdAt,
          warning: 'Store this key securely — it will not be shown again.',
        });
      } catch (err) {
        return toMcpError(String(err));
      }
    },

    // ─── Worker chat ────────────────────────────────────────────────────────

    async chat_worker(rawParams: unknown) {
      try {
        const params = await ChatWorkerParamsSchema.parseAsync(rawParams);

        // ── Tier 0: FIFO bidirectional chat (~/.blog/inbox/{workerId}) ────────
        // If a named pipe exists for this worker, write the message to it and
        // wait up to 5 seconds for the worker's reply. Falls through on timeout.
        const { chatViaFifo } = await import('../novel/chat.js');
        const fifoReply = await chatViaFifo(params.workerId, params.message);
        if (fifoReply !== null) {
          return toMcpResult({
            response: fifoReply,
            workerId: params.workerId,
            tone: 'direct',
            backend: 'fifo',
          });
        }

        // ── Tier 1: Local inference (OPENCLAW_INFERENCE_URL) ───────────────
        const inferenceUrl = process.env['OPENCLAW_INFERENCE_URL'] ?? '';
        if (inferenceUrl) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30_000);
          try {
            const res = await fetch(inferenceUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                workerId: params.workerId,
                message: params.message,
                repoKey: params.repoKey,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`Inference endpoint error: ${res.status}`);
            const data = (await res.json()) as { response?: string; workerId?: string };
            return toMcpResult({
              response: data.response ?? "No response from inference endpoint.",
              workerId: data.workerId ?? params.workerId,
              tone: 'inferred',
              backend: 'openclaw',
            });
          } catch (err) {
            clearTimeout(timeout);
            if (err instanceof Error && err.name === 'AbortError') {
              throw new Error('Inference endpoint timed out after 30 seconds');
            }
            throw err;
          }
        }

        // ── Tier 2: Anthropic API (ANTHROPIC_API_KEY) ──────────────────────
        const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';
        if (anthropicKey) {
          if (!ctx.registry) return toMcpError('registry not available — Tier 2 (Anthropic) requires registry');
          const { WorkerChat } = await import('../novel/chat.js');
          const baseURL = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com';
          const chat = new WorkerChat(ctx.storage, { anthropicKey, baseURL });
          const result = await chat.chat(params.workerId, params.message, params.repoKey);
          return toMcpResult({ ...result, backend: 'anthropic' });
        }

        // ── Tier 3: Regex-only voice extraction (no LLM) ────────────────────
        const { extractVoice } = await import('../novel/chat.js');
        const page = await ctx.storage.listPosts({
          repoKey: params.repoKey as import('../shared/types.js').RepoKey,
          eventType: 'novel_branch_entry',
          limit: 20,
        });
        const matching = page.posts.filter(
          (p) =>
            p.metadata?.sessionId === params.workerId ||
            p.content.toLowerCase().includes(params.workerId.toLowerCase()),
        );
        if (matching.length === 0) {
          return toMcpResult({
            response: "I don't have a record of that worker yet.",
            workerId: params.workerId,
            tone: 'unknown',
            backend: 'regex-only',
          });
        }
        matching.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const entry = matching[0]!;

        const { tone } = extractVoice(entry.content);

        const responses = [
          "Let me think about that for a moment.",
          "I've seen this pattern before.",
          "Here's my take on it.",
          "That's an interesting question.",
          "I have some thoughts on this.",
        ];
        const response = responses[Math.floor(entry.content.length % responses.length)];

        return toMcpResult({
          response,
          workerId: params.workerId,
          tone,
          backend: 'regex-only',
        });
      } catch (err) {
        return toMcpError(String(err));
      }
    },
  };
}

export type BlogToolName = keyof ReturnType<typeof createBlogToolHandlers>;
