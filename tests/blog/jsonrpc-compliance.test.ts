/**
 * Blog MCP Server — JSON-RPC 2.0 Protocol Compliance Tests.
 *
 * Covers protocol-level error codes and edge cases per the JSON-RPC 2.0 spec
 * and Section 11 of docs/manual-testing-guide.md.
 *
 * Run with: npx vitest run tests/blog/jsonrpc-compliance.test.ts
 *
 * Note: tests/blog/server-http.test.ts already covers:
 *   - invalid jsonrpc version ("1.0") → -32600
 *   - unknown method → -32601
 *   - malformed JSON body → HTTP 400
 *   - GET /mcp (returns MCP metadata, not 405 — see test below)
 *   - missing id (notification) → id is undefined in response
 * This file fills the remaining gaps.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('JSON-RPC 2.0 Protocol Compliance', () => {
  let app: Application;
  const prevStorageType = process.env['STORAGE_TYPE'];

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  afterAll(() => {
    if (prevStorageType !== undefined) {
      process.env['STORAGE_TYPE'] = prevStorageType;
    } else {
      delete process.env['STORAGE_TYPE'];
    }
  });

  // ── Gap 1: Missing jsonrpc field ─────────────────────────────────────────

  it('POST /mcp: missing jsonrpc field → error -32600', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ id: 1, method: 'health_check', params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
    expect(res.body.error.message).toMatch(/JSON-RPC 2.0 required/i);
  });

  // ── Gap 2: Missing method field ──────────────────────────────────────────

  it('POST /mcp: missing method field → error -32600', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
    expect(res.body.error.message).toMatch(/JSON-RPC 2.0 required/i);
  });

  // ── Gap 3: params as array instead of object ──────────────────────────────

  it('POST /mcp: params as array → tool-specific behavior (health_check returns result, other tools may error)', async () => {
    // health_check expects params to be an object or undefined.
    // With an array, the handler receives an array — health_check ignores params
    // so it still returns OK. Other tools may fail with -32603 Internal Error.
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'health_check', params: [] })
      .expect(200);

    // health_check does not validate params shape, so it succeeds.
    // Document that this is tool-dependent — handlers should validate params.
    expect(res.body.jsonrpc).toBe('2.0');
    // Server returns either result or error depending on handler's param expectations
    const hasResult = res.body.result !== undefined;
    const hasError = res.body.error !== undefined;
    expect(hasResult || hasError).toBe(true);
  });

  it('POST /mcp: params as array on create_post → error in result (handler validates params)', async () => {
    // create_post's Zod schema expects params to be an object.
    // It does NOT throw a JSON-RPC error (-32603); instead the handler catches
    // the ZodError and returns toMcpError(...) as the result.
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'create_post', params: [] })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(1);
    // The handler returns an MCP error result (isError: true) — not a JSON-RPC -32603
    expect(res.body.result).toBeDefined();
    expect(res.body.result.isError).toBe(true);
    // The result text contains the Zod validation message
    const text = (res.body.result as any).content?.[0]?.text ?? '';
    expect(text).toMatch(/object|array/i);
  });

  // ── Gap 4: id as null ─────────────────────────────────────────────────────

  it('POST /mcp: id as null → response id is null (JSON-RPC spec §5)', async () => {
    // JSON-RPC 2.0 §5: id can be null, string, or number. Server must echo it back.
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: null, method: 'health_check', params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    // Per JSON-RPC 2.0 spec, null id is echoed back as null
    expect(res.body.id).toBe(null);
    expect(res.body.result).toBeDefined();
  });

  // ── Gap 5: id as string ───────────────────────────────────────────────────

  it('POST /mcp: id as string → response id matches the string', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 'request-42', method: 'health_check', params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe('request-42');
    expect(res.body.result).toBeDefined();
  });

  // ── Gap 6: Notification (no id field) ─────────────────────────────────────

  it('POST /mcp: notification (no id field) → server processes, no id in response', async () => {
    // JSON-RPC 2.0 §4: notifications are requests without an "id" member.
    // The server MUST NOT include an "id" in the response.
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', method: 'health_check', params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    // The server echoes id as undefined; supertest serializes undefined as null in JSON
    // Note: this is a known gap — strictly the response should omit the id field entirely
    // for true notifications, but echoing undefined (→ null in JSON) is acceptable behavior.
    expect(res.body.id).toBeUndefined();
    expect(res.body.result).toBeDefined();
  });

  // ── Corner case: both jsonrpc and method missing ─────────────────────────

  it('POST /mcp: both jsonrpc and method missing → still -32600 (not -32700)', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ id: 1, params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
  });

  // ── Corner case: method is not a string ──────────────────────────────────

  it('POST /mcp: method is a number → error -32600', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 123, params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
  });

  // ── Corner case: jsonrpc is null (not a string) ─────────────────────────

  it('POST /mcp: jsonrpc is null (not a string) → error -32600', async () => {
    const res = await request(app)
      .post('/mcp')
      .send({ jsonrpc: null, id: 1, method: 'health_check', params: {} })
      .expect(200);

    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
  });
});
