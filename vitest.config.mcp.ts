import { defineConfig } from 'vitest/config';

/**
 * Vitest config for real-server MCP integration tests.
 * Requires blog server running on PORT (default 8888).
 *
 * Usage: npm run test:mcp
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['testing_mcp/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
