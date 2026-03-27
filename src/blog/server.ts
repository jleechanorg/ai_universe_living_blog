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
import http from 'http';
import rateLimit from 'express-rate-limit';
import { createStorage } from './storage-factory.js';
import { createBlogToolHandlers, type BlogToolContext } from './tools.js';
import { logger } from '../shared/logger.js';
import { RepoRegistry } from './repo-registry.js';
import { GitHubClient } from './github-client.js';
import { hashKey, loadApiKeys, saveApiKeys, requireApiKey, type ApiKey } from './auth.js';
import { createWebhookHandler } from './webhook.js';
import { createAutoScanner, type AutoScanner } from './scanner.js';
import { WorkerChat } from '../novel/chat.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_ID = process.env['AGENT_ID'] ?? 'blog-mcp-server';

const getPort = () => {
  const raw = process.env['PORT'] ?? '8081';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw} — must be an integer between 1 and 65535`);
  }
  return n;
};

const STORAGE_TYPE = (() => {
  const eqFlag = process.argv.find((a) => a.startsWith('--storage='));
  if (eqFlag) return eqFlag.split('=')[1]!;
  const idx = process.argv.findIndex((a) => a === '--storage');
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  return process.env['STORAGE_TYPE'] ?? 'memory';
})();

const STORAGE_PROJECT_ID = process.env['FIRESTORE_PROJECT_ID'];
const STORAGE_COLLECTION = process.env['FIRESTORE_COLLECTION'] ?? 'posts';
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS']
  ?.split(',').map((o) => o.trim()).filter(Boolean)
  ?? (NODE_ENV === 'production'
    ? ['https://ai-universe-2025.web.app', 'https://ai-universe-2025.firebaseapp.com']
    : true);

// ─── New config ───────────────────────────────────────────────────────────────

const DATA_DIR = process.env['DATA_DIR'] ?? 'data/';
const API_KEY = process.env['API_KEY'];
const API_KEYS_FILE = process.env['API_KEYS_FILE'];
const MASTER_API_KEY = process.env['MASTER_API_KEY'];
const AUTO_SCAN_ENABLED = process.env['AUTO_SCAN_ENABLED'] === 'true';
const AUTO_SCAN_INTERVAL_MS = (() => {
  const raw = process.env['AUTO_SCAN_INTERVAL_MS'] ?? '60000';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1000) {
    throw new Error(`Invalid AUTO_SCAN_INTERVAL_MS: ${raw} — must be an integer ≥ 1000ms`);
  }
  return n;
})();
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'];
const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET'];
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';

// ─── Express app factory ───────────────────────────────────────────────────────

export async function createBlogApp(): Promise<ReturnType<typeof express>> {
  const storage = createStorage({
    type: STORAGE_TYPE as 'memory' | 'firestore',
    projectId: STORAGE_PROJECT_ID,
    collection: STORAGE_COLLECTION,
  });

  // Initialize RepoRegistry
  const registry = new RepoRegistry(DATA_DIR);

  // Initialize GitHub client
  const github = new GitHubClient(GITHUB_TOKEN);

  // Build tool context
  const ctx: BlogToolContext = { storage, agentId: AGENT_ID, registry, dataDir: DATA_DIR };
  const tools = createBlogToolHandlers(ctx);

  const app = express();
  app.use(cors({ origin: ALLOWED_ORIGINS }));

  // ── Auth + rate limiting ─────────────────────────────────────────────────────
  const authEnabled = !!(API_KEY || API_KEYS_FILE);
  // Load keys at startup for MASTER_API_KEY registration only.
  // The middleware itself lazy-loads keys on every request so newly
  // generated keys (via generate_api_key) are recognized without restart.
  let validKeys: ApiKey[] = [];
  if (authEnabled) {
    validKeys = loadApiKeys(DATA_DIR);
    let keysChanged = false;

    if (API_KEY && !validKeys.some((k) => hashKey(API_KEY!) === k.key)) {
      validKeys.push({
        key: hashKey(API_KEY!),
        label: 'API_KEY',
        scopes: ['user'],
        createdAt: new Date().toISOString(),
      });
      keysChanged = true;
    }

    if (MASTER_API_KEY && !validKeys.some((k) => hashKey(MASTER_API_KEY!) === k.key)) {
      validKeys.push({
        key: hashKey(MASTER_API_KEY!),
        label: 'MASTER_API_KEY',
        scopes: ['admin'],
        createdAt: new Date().toISOString(),
      });
      keysChanged = true;
      logger.info('MASTER_API_KEY auto-registered with admin scope');
    }

    if (keysChanged) saveApiKeys(validKeys, DATA_DIR);
  }

  // Rate limiters — 100 req/min per IP
  const mcpLimiter = rateLimit({ windowMs: 60_000, max: 100 });
  const chatLimiter = rateLimit({ windowMs: 60_000, max: 100 });

  // ── Raw body for webhook (before express.json) ───────────────────────────────
  app.use('/webhook', express.text({ type: '*/*' }));

  // ── Standard JSON parsing ──────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));

  // ── Routes ────────────────────────────────────────────────────────────────

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

  // POST /mcp — MCP JSON-RPC endpoint
  app.post(
    '/mcp',
    authEnabled ? [mcpLimiter, requireApiKey(DATA_DIR)] : [],
    async (req: Request, res: Response) => {
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
    },
  );

  // POST /webhook — GitHub webhook receiver
  const webhookHandler = createWebhookHandler(registry, storage, github, DATA_DIR, WEBHOOK_SECRET);
  app.post('/webhook', webhookHandler);

  // POST /chat — WorkerChat
  const chat = new WorkerChat(registry, storage, { anthropicKey: ANTHROPIC_API_KEY });
  app.post(
    '/chat',
    authEnabled ? [chatLimiter, requireApiKey(DATA_DIR)] : [],
    async (req: Request, res: Response) => {
      try {
        const { workerId, message, repoKey } = req.body as {
          workerId?: unknown; message?: unknown; repoKey?: unknown;
        };
        if (typeof workerId !== 'string' || typeof message !== 'string' || typeof repoKey !== 'string') {
          res.status(400).json({ error: 'body requires workerId, message, repoKey' });
          return;
        }
        const result = await chat.chat(workerId, message, repoKey);
        res.json(result);
      } catch (err) {
        logger.error('WorkerChat error', { error: String(err) });
        res.status(500).json({ error: String(err) });
      }
    },
  );

  // ── AutoScanner ───────────────────────────────────────────────────────────
  let scanner: AutoScanner | null = null;
  if (AUTO_SCAN_ENABLED) {
    scanner = createAutoScanner(registry, storage, github, {
      intervalMs: AUTO_SCAN_INTERVAL_MS,
      dataDir: DATA_DIR,
    });
    scanner.start();
  }

  return app;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Starting Blog MCP server', {
    PORT: getPort(),
    NODE_ENV,
    AGENT_ID,
    storage: STORAGE_TYPE,
    dataDir: DATA_DIR,
    autoScan: AUTO_SCAN_ENABLED,
  });

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
    logger.info(`Webhook: http://localhost:${getPort()}/webhook`);
    logger.info(`Chat:    http://localhost:${getPort()}/chat`);
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
