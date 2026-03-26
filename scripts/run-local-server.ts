#!/usr/bin/env tsx

/**
 * Local dev server runner
 *
 * Starts:
 *   - Blog MCP server (HTTP on PORT=8081)
 *   - Novel CLI (available via npm run dev:novel -- ...)
 *
 * Usage:
 *   npm run run-local-server
 *   PORT=9090 npm run run-local-server
 */

import { createBlogApp } from '../src/blog/server.js';
import http from 'http';
import { logger } from '../src/shared/logger.js';

function resolvePort(): number {
  const raw = process.env['PORT'] ?? '8081';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw} — must be an integer between 1 and 65535`);
  }
  return port;
}

async function main() {
  const PORT = resolvePort(); // inside main() so .catch() handles resolvePort errors
  logger.info('Starting local dev servers...');

  // createBlogApp() = Express app (never binds a server — run-local-server owns the HTTP lifecycle)
  const app = await createBlogApp();
  const server = http.createServer(app);

  server.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use — kill the process or set PORT env var`);
    } else {
      logger.error('Server startup error', { error: err.message, code: err.code });
    }
    process.exit(1);
  });

  server.listen(PORT, () => {
    logger.info(`Blog MCP server: http://localhost:${PORT}`);
    logger.info(`MCP endpoint:     http://localhost:${PORT}/mcp`);
    logger.info(`Health:           http://localhost:${PORT}/health`);
    logger.info('');
    logger.info('Novel CLI usage:');
    logger.info('  npm run dev:novel -- branch-entry --repo=owner/repo --session=ID --branch=name');
    logger.info('  npm run dev:novel -- daily-summary  --repo=owner/repo --session=ID');
    logger.info('');
    logger.info('Press Ctrl+C to stop.');
  });

  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error('Fatal', err);
  process.exit(1);
});
