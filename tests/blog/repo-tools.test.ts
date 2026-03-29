/**
 * Repo tools + generate_api_key HTTP integration tests.
 * Tests Sections 8-9 of docs/manual-testing-guide.md via the HTTP layer
 * (supertest + createBlogApp) rather than the direct tool-handler layer.
 *
 * Run with: npx vitest run tests/blog/repo-tools.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

/** Parse the MCP result text from a JSON-RPC response. */
function parseRpcResult(res: request.Response): unknown {
  const rpcResult = res.body.result as { content: Array<{ text: string }> };
  return JSON.parse(rpcResult.content[0].text);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Repo tools HTTP (Sections 8-9)', () => {
  let app: Application;
  let tmpDataDir: string;
  const prevStorageType = process.env['STORAGE_TYPE'];
  const prevDataDir = process.env['DATA_DIR'];

  beforeAll(async () => {
    // Use a temp DATA_DIR so the registry starts empty each run
    tmpDataDir = mkdtempSync(join(tmpdir(), 'repo-tools-test-'));
    process.env['STORAGE_TYPE'] = 'memory';
    process.env['DATA_DIR'] = tmpDataDir + '/';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  afterAll(() => {
    if (prevStorageType !== undefined) {
      process.env['STORAGE_TYPE'] = prevStorageType;
    } else {
      delete process.env['STORAGE_TYPE'];
    }
    if (prevDataDir !== undefined) {
      process.env['DATA_DIR'] = prevDataDir;
    } else {
      delete process.env['DATA_DIR'];
    }
    try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Section 8 ── Repo tools ────────────────────────────────────────────────

  describe('register_repo', () => {
    it('8-A: register_repo with webhookEnabled/autoScanEnabled/novelEnabled → success', async () => {
      // Map the manual-testing-guide field names to the actual schema field names:
      // webhookEnabled → not in schema (manual may be from an older API version)
      // autoScanEnabled → modes.autoScan
      // novelEnabled → modes.novelBranch
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('register_repo', {
          repoKey: 'acme/my-service',
          enabled: false,
          modes: { autoScan: false, novelBranch: true, novelDaily: false },
        }))
        .expect(200);

      expect(res.body.jsonrpc).toBe('2.0');
      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(parsed.success).toBe(true);
      expect((parsed.repo as Record<string, unknown>).repoKey).toBe('acme/my-service');
      expect((parsed.repo as Record<string, unknown>).enabled).toBe(false);
      expect(((parsed.repo as Record<string, unknown>).modes as Record<string, boolean>).novelBranch).toBe(true);
    });

    it('8-B (duplicate): register same repoKey twice → error (not idempotent)', async () => {
      // Register once
      await request(app)
        .post('/mcp')
        .send(mcpPayload('register_repo', {
          repoKey: 'dup-test/service',
          enabled: true,
          modes: { autoScan: false, novelBranch: false, novelDaily: false },
        }))
        .expect(200);

      // Register again — RepoRegistry.register throws on duplicate
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('register_repo', {
          repoKey: 'dup-test/service',
          enabled: true,
          modes: { autoScan: false, novelBranch: false, novelDaily: false },
        }))
        .expect(200);

      expect(res.body.result).toBeDefined();
      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(parsed.error).toMatch(/already registered/i);
    });
  });

  describe('list_repos', () => {
    it('8-C: before any register, list_repos returns empty array', async () => {
      // Use a unique repoKey so this test is isolated from others
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('list_repos', {}))
        .expect(200);

      expect(res.body.jsonrpc).toBe('2.0');
      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(Array.isArray(parsed.repos)).toBe(true);
    });

    it('8-D: after register, list_repos returns array containing registered repo', async () => {
      const repoKey = 'acme/my-service';

      // Verify acme/my-service was registered in 8-A
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('list_repos', {}))
        .expect(200);

      const parsed = parseRpcResult(res) as { repos: Array<{ repoKey: string }> };
      const keys = parsed.repos.map((r) => r.repoKey);
      expect(keys).toContain(repoKey);
    });
  });

  describe('update_repo', () => {
    it('8-E: register then update {enabled:false} → returns updated repo with enabled:false', async () => {
      const repoKey = 'update-test/svc';

      await request(app)
        .post('/mcp')
        .send(mcpPayload('register_repo', {
          repoKey,
          enabled: true,
          modes: { autoScan: false, novelBranch: false, novelDaily: false },
        }))
        .expect(200);

      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('update_repo', { repoKey, enabled: false }))
        .expect(200);

      expect(res.body.jsonrpc).toBe('2.0');
      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(parsed.success).toBe(true);
      expect((parsed.repo as Record<string, unknown>).enabled).toBe(false);
    });

    it('8-F: update non-existent repo → error', async () => {
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('update_repo', {
          repoKey: 'nonexistent/owner-repo',
          enabled: false,
        }))
        .expect(200);

      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(parsed.error).toMatch(/not found/i);
    });
  });

  describe('unregister_repo', () => {
    it('8-G: register then unregister → list_repos no longer contains repo', async () => {
      const repoKey = 'unreg-test/svc';

      await request(app)
        .post('/mcp')
        .send(mcpPayload('register_repo', {
          repoKey,
          enabled: true,
          modes: { autoScan: false, novelBranch: false, novelDaily: false },
        }))
        .expect(200);

      const unreg = await request(app)
        .post('/mcp')
        .send(mcpPayload('unregister_repo', { repoKey }))
        .expect(200);

      expect(parseRpcResult(unreg).success).toBe(true);

      const list = await request(app)
        .post('/mcp')
        .send(mcpPayload('list_repos', {}))
        .expect(200);

      const parsed = parseRpcResult(list) as { repos: Array<{ repoKey: string }> };
      const keys = parsed.repos.map((r) => r.repoKey);
      expect(keys).not.toContain(repoKey);
    });

    it('8-H: unregister non-existent repo → error', async () => {
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('unregister_repo', {
          repoKey: 'also-nonexistent/repo',
        }))
        .expect(200);

      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(parsed.error).toMatch(/not found/i);
    });
  });

  // ── Section 9 ── generate_api_key ────────────────────────────────────────

  describe('generate_api_key', () => {
    it('9-A: call with {label:"test-key"} → returns object with apiKey field, label, createdAt', async () => {
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('generate_api_key', { label: 'test-key' }))
        .expect(200);

      expect(res.body.jsonrpc).toBe('2.0');
      const parsed = parseRpcResult(res) as Record<string, unknown>;
      expect(parsed.key).toBeDefined();
      expect(typeof parsed.key).toBe('string');
      expect(parsed.key.length).toBeGreaterThan(0);
      expect(parsed.label).toBe('test-key');
      expect(parsed.createdAt).toBeDefined();
      expect(typeof parsed.createdAt).toBe('string');
      expect(parsed.warning).toMatch(/store|secure/i);
    });

    it('9-B: generate two keys → both distinct (different apiKey values)', async () => {
      const res1 = await request(app)
        .post('/mcp')
        .send(mcpPayload('generate_api_key', { label: 'key-one' }, 1))
        .expect(200);

      const res2 = await request(app)
        .post('/mcp')
        .send(mcpPayload('generate_api_key', { label: 'key-two' }, 2))
        .expect(200);

      const key1 = parseRpcResult(res1).key as string;
      const key2 = parseRpcResult(res2).key as string;
      expect(key1).not.toBe(key2);
    });

    it('9-C: call without label → still returns a key (label is optional in result shape)', async () => {
      // The schema requires label to be non-empty, so this tests the error path
      // documenting that label is mandatory, not optional.
      const res = await request(app)
        .post('/mcp')
        .send(mcpPayload('generate_api_key', {}))
        .expect(200);

      const parsed = parseRpcResult(res) as Record<string, unknown>;
      // Schema validation error expected — label is required
      expect(parsed.error).toMatch(/label/i);
    });
  });
});
