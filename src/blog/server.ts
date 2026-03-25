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
import cors from 'cors';
import http from 'http';
import { MemoryBlogStorage } from './storage.js';
import { createBlogToolHandlers, type BlogToolContext } from './tools.js';
import { logger } from '../shared/logger.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_ID = process.env['AGENT_ID'] ?? 'blog-mcp-server';
const PORT = parseInt(process.env['PORT'] ?? '8081', 10);
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const rawOrigins = process.env['ALLOWED_ORIGINS']
  ?.split(',').map((o) => o.trim()).filter(Boolean)
  ?? (NODE_ENV === 'production'
    ? ['https://ai-universe-2025.web.app', 'https://ai-universe-2025.firebaseapp.com']
    : null);

// In development (no explicit ALLOWED_ORIGINS), use origin: true so any browser request
// is allowed. In production, pass the explicit origin array — note that passing ['*']
// to cors() treats '*' as a literal string, so we use origin: true for dev.
const corsOptions = rawOrigins === null
  ? { origin: true }
  : { origin: rawOrigins };

// ─── Express app factory ───────────────────────────────────────────────────────

export async function createBlogApp(): Promise<ReturnType<typeof express>> {
  const storage = new MemoryBlogStorage();
  const ctx: BlogToolContext = { storage, agentId: AGENT_ID };
  const tools = createBlogToolHandlers(ctx);

  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '10mb' }));

  // Health
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', service: 'blog-mcp-server', version: '0.1.0' });
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

  return app;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Starting Blog MCP server', { PORT, NODE_ENV, AGENT_ID });

  const app = await createBlogApp();
  const server = http.createServer(app);

  server.listen(PORT, () => {
    logger.info(`Blog MCP server running on port ${PORT}`);
    logger.info(`Health: http://localhost:${PORT}/health`);
    logger.info(`MCP:    http://localhost:${PORT}/mcp`);
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
