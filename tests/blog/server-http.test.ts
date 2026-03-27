/**
 * Blog MCP Server HTTP Integration Tests.
 * Tests the local Express app from createBlogApp().
 *
 * Run with: npx vitest run tests/blog/server-http.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Blog MCP Server HTTP', () => {
  let app: Application;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  // 1
  it('POST /mcp: health_check returns ok', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('health_check'))
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(1);
    expect(res.body.result).toBeDefined();
    // result is the MCP tool result: { content: [{ text: '{"status":"healthy",...}' }] }
    const result = JSON.parse((res.body.result as any).content[0].text);
    expect(result.status).toBe('healthy');
  });

  // 2
  it('POST /mcp: unknown method returns error -32601', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('nonexistent_tool'))
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32601);
  });

  // 3 — JSON-RPC 2.0: id is optional. Local server returns undefined when absent.
  it('POST /mcp: missing id — local server accepts (id is undefined, not required)', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', method: 'health_check', params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBeUndefined(); // local server uses undefined, not null
    expect(res.body.result).toBeDefined();
  });

  // 4
  it('POST /mcp: malformed JSON → 400', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send('this is not json{');

    expect(res.status).toBe(400);
  });

  // 5
  it('GET /health: returns without auth (server is open — no auth configured)', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('blog-mcp-server');
  });

  // 6
  it('GET /: returns server info', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.body.service).toBe('Blog MCP Server');
    expect(res.body.tools).toBeDefined();
    expect(Array.isArray(res.body.tools)).toBe(true);
  });

  // 7
  it('GET /mcp: returns MCP metadata', async () => {
    const res = await request(app).get('/mcp').expect(200);
    expect(res.body.message).toContain('JSON-RPC 2.0');
    expect(res.body.tools).toBeDefined();
  });

  // 8
  it('POST /mcp: invalid jsonrpc version → -32600', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '1.0', id: 1, method: 'health_check' })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
  });

  // 9 — Express's express.json() returns 400 for unparseable JSON strings
  it('POST /mcp: non-object JSON body → 400 from express.json()', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify('just a string'));

    expect(res.status).toBe(400);
  });

  // 10 — No X-API-Key header needed
  it('POST /mcp: health_check — no auth required (open server)', async () => {
    const res = await request(app)
      .post('/mcp')
      .send(mcpPayload('health_check'))
      .expect(200);

    expect(res.body.result).toBeDefined();
    const result = JSON.parse((res.body.result as any).content[0].text);
    expect(result.status).toBe('healthy');
  });
});
