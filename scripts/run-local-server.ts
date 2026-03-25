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

const PORT = parseInt(process.env['PORT'] ?? '8081', 10);

async function main() {
  logger.info('Starting local dev servers...');

  const app = await createBlogApp();
  const server = http.createServer(app);

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
