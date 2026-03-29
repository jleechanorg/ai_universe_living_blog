#!/usr/bin/env node

/**
 * Blog MCP Server — HTTP transport (Express + JSON-RPC 2.0)
 *
 * Exposes all blog MCP tools over HTTP POST /mcp.
 * Primary transport for dev and Cloud Run deployment.
 *
 * Usage:
 *   npm run dev:blog              # tsx watch mode
 *   npm run build && node dist/blog/server.js  # production
 */

import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { createStorage } from './storage-factory.js';
import { createBlogToolHandlers, type BlogToolContext } from './tools.js';
import { logger } from '../shared/logger.js';
import { RepoRegistry } from './repo-registry.js';
import { GitHubClient } from './github-client.js';
import { createWebhookHandler } from './webhook.js';

// ─── Extended Request with rawBody ────────────────────────────────────────────

/** Augment Express Request to include raw bytes captured before JSON parsing. */
interface RawBodyRequest extends Request {
  rawBody?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_ID = process.env['AGENT_ID'] ?? 'blog-mcp-server';

// Lazily resolves PORT so module import doesn't crash on invalid PORT.
// Validation runs when the server is actually started, not at import time.
const getPort = () => {
  const raw = process.env['PORT'] ?? '8081';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw} — must be an integer between 1 and 65535`);
  }
  return n;
};

// Storage factory — reads --storage CLI flag or STORAGE_TYPE env var.
// Defaults to 'file' (./blog-data.json) — zero-config local persistence without any external services.
// Use STORAGE_TYPE=memory for ephemeral in-process storage, STORAGE_TYPE=firestore for GCP.
const STORAGE_TYPE = (() => {
  // Check --storage=xxx or --storage xxx in process.argv
  const eqFlag = process.argv.find((a) => a.startsWith('--storage='));
  if (eqFlag) return eqFlag.split('=')[1]!;
  const idx = process.argv.findIndex((a) => a === '--storage');
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  return process.env['STORAGE_TYPE'] ?? 'file';
})();

const STORAGE_PROJECT_ID = process.env['FIRESTORE_PROJECT_ID'];
const DATA_DIR = process.env['DATA_DIR'] ?? 'data/';
const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET'];
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'];
const STORAGE_COLLECTION = process.env['FIRESTORE_COLLECTION'] ?? 'posts';
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS']
  ?.split(',').map((o) => o.trim()).filter(Boolean)
  ?? (NODE_ENV === 'production'
    ? ['https://ai-universe-2025.web.app', 'https://ai-universe-2025.firebaseapp.com']
    : true); // true = reflect request origin in dev

// ─── Express app factory ───────────────────────────────────────────────────────

export async function createBlogApp(options?: {
  /** Inject pre-created storage (e.g., shared instance in demo mode or tests). */
  storage?: import('../shared/types.js').BlogStorage;
  /** Disable rate limiting (for integration tests that need >100 requests). */
  disableRateLimiting?: boolean;
  /** Override default rate limits per endpoint tier (useful for testing). */
  rateLimits?: {
    globalMax?: number;   // default 100/min
    writeMax?: number;    // default 20/min
    chatMax?: number;     // default 10/min
  };
}): Promise<ReturnType<typeof express>> {
  const storage = options?.storage ?? createStorage({
    type: STORAGE_TYPE as 'memory' | 'file' | 'firestore',
    projectId: STORAGE_PROJECT_ID,
    collection: STORAGE_COLLECTION,
  });

  // Initialize RepoRegistry for webhook + future auto-scan
  const registry = new RepoRegistry(DATA_DIR);
  const github = new GitHubClient(GITHUB_TOKEN);

  const ctx: BlogToolContext = { storage, agentId: AGENT_ID, registry, dataDir: DATA_DIR };
  const tools = createBlogToolHandlers(ctx);

  const app = express();
  app.use(cors({ origin: ALLOWED_ORIGINS }));

  // ── Rate limiting (design doc Section C) ─────────────────────────────────
  // Global: 100 req/min/IP; write-tool: 20 req/min/IP; chat_worker: 10 req/min/IP
  // Pass disableRateLimiting:true to skip; use rateLimits:{} to override thresholds.
  const globalMax = options?.rateLimits?.globalMax ?? 100;
  const writeMax = options?.rateLimits?.writeMax ?? 20;
  const chatMax = options?.rateLimits?.chatMax ?? 10;
  const globalLimiter = options?.disableRateLimiting ? null : rateLimit({
    windowMs: 60 * 1000,
    max: globalMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limit exceeded' } },
  });
  const writeLimiter = options?.disableRateLimiting ? null : rateLimit({
    windowMs: 60 * 1000,
    max: writeMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Write rate limit exceeded' } },
  });
  const chatLimiter = options?.disableRateLimiting ? null : rateLimit({
    windowMs: 60 * 1000,
    max: chatMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Chat rate limit exceeded' } },
  });
  if (globalLimiter) app.use('/mcp', globalLimiter);

  // ── Capture raw body bytes before JSON parsing (for webhook HMAC) ────────
  // Use express.json verify callback to capture the exact raw bytes GitHub signed,
  // before Express re-serializes them. This ensures HMAC validation is byte-exact.
  app.use(express.json({
    limit: '10mb',
    verify(req: unknown, _res: unknown, buf: Buffer) {
      (req as RawBodyRequest).rawBody = buf.toString('utf8');
    },
  } as Parameters<typeof express.json>[0]));

  // Health
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'blog-mcp-server', version: '0.1.0' });
  });

  // Root
  app.get('/', (_req, res) => {
    res.json({
      service: 'Blog MCP Server',
      version: '0.1.0',
      description: 'Living blog — per-repo PR lifecycle feed',
      tools: Object.keys(tools),
    });
  });

  // MCP metadata
  app.get('/mcp', (_req, res) => {
    res.json({
      service: 'Blog MCP Server',
      version: '0.1.0',
      message: 'POST JSON-RPC 2.0 payloads to this endpoint to invoke MCP tools.',
      tools: Object.keys(tools),
    });
  });

  // Write tools subject to lower per-IP rate limit
  const WRITE_METHODS = new Set([
    'create_post', 'update_post', 'register_repo', 'unregister_repo',
    'update_repo', 'generate_api_key',
  ]);

  /** Run an express-rate-limit middleware as a promise; returns false if rate-limited. */
  function applyLimiter(
    limiter: ReturnType<typeof rateLimit>,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      limiter(req, res, () => resolve(true));
      // If rate-limited, limiter calls res.status(429).send() and never calls next(),
      // so the promise stays pending. Resolve false after the response is sent.
      res.on('finish', () => resolve(false));
    });
  }

  // JSON-RPC 2.0 handler
  app.post('/mcp', async (req, res) => {
    const body = req.body;
    if (typeof body !== 'object' || body === null) {
      return res.json({
        jsonrpc: '2.0', id: null,
        error: { code: -32600, message: 'Invalid Request — JSON object required' },
      });
    }
    const { jsonrpc, id, method, params } = body as {
      jsonrpc?: string; id?: unknown; method?: string; params?: unknown;
    };

    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      return res.json({
        jsonrpc: '2.0', id: id ?? null,
        error: { code: -32600, message: 'Invalid Request — JSON-RPC 2.0 required' },
      });
    }

    // Per-method rate limiting: chat_worker < write tools < global (already applied)
    if (method === 'chat_worker' && chatLimiter) {
      const ok = await applyLimiter(chatLimiter, req, res);
      if (!ok) return;
    } else if (WRITE_METHODS.has(method) && writeLimiter) {
      const ok = await applyLimiter(writeLimiter, req, res);
      if (!ok) return;
    }

    const handler = (tools as Record<string, (p?: unknown) => Promise<unknown>>)[method];
    if (!handler) {
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }

    try {
      const result = await handler(params);
      return res.json({ jsonrpc: '2.0', id, result });
    } catch (err) {
      logger.error('Unhandled tool error', { method, error: String(err) });
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: -32603, message: 'Internal error', data: String(err) },
      });
    }
  });

  // ── Webhook receiver ──────────────────────────────────────────────────────
  const webhookHandler = createWebhookHandler(registry, storage, github, DATA_DIR, WEBHOOK_SECRET);
  app.post('/webhook', webhookHandler as (req: Request, res: Response) => Promise<void>);

  return app;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Starting Blog MCP server', { PORT: getPort(), NODE_ENV, AGENT_ID, storage: STORAGE_TYPE });

  const app = await createBlogApp();
  const server = http.createServer(app);

  server.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${getPort()} is already in use — kill the process or set PORT env var`);
    } else {
      logger.error('Blog MCP server failed to start', { err: String(err) });
    }
    process.exit(1);
  });

  server.listen(getPort(), () => {
    logger.info(`Blog MCP server running on port ${getPort()}`);
    logger.info(`Health: http://localhost:${getPort()}/health`);
    logger.info(`MCP:    http://localhost:${getPort()}/mcp`);
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      logger.info(`Received ${sig}, shutting down`);
      server.close(() => process.exit(0));
    });
  }
}

const isDirect = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isDirect) {
  main().catch((err) => { logger.error('Fatal', err); process.exit(1); });
}
