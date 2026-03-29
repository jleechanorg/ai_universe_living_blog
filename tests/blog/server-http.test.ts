/**
 * Blog MCP Server HTTP Integration Tests.
 * Tests the local Express app from createBlogApp().
 *
 * Run with: npx vitest run tests/blog/server-http.test.ts
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

describe('Blog MCP Server HTTP', () => {
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

// ─── Rate limiting ─────────────────────────────────────────────────────────────
// Each describe block uses a fresh app with low custom limits to keep tests fast.

describe('Blog MCP Server — global rate limit', () => {
  let app: Application;
  const GLOBAL_MAX = 5;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp({ rateLimits: { globalMax: GLOBAL_MAX } });
  });

  it(`returns 429 after ${GLOBAL_MAX} global requests/min`, async () => {
    for (let i = 0; i < GLOBAL_MAX; i++) {
      const r = await request(app).post('/mcp').send(mcpPayload('health_check'));
      expect(r.status).toBe(200);
    }
    const res = await request(app).post('/mcp').send(mcpPayload('health_check'));
    expect(res.status).toBe(429);
    expect(res.headers['ratelimit-limit']).toBe(String(GLOBAL_MAX));
  });
});

describe('Blog MCP Server — chat_worker rate limit', () => {
  let app: Application;
  const CHAT_MAX = 3;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp({ rateLimits: { globalMax: 100, chatMax: CHAT_MAX } });
  });

  it(`returns 429 after ${CHAT_MAX} chat_worker requests/min`, async () => {
    for (let i = 0; i < CHAT_MAX; i++) {
      const r = await request(app).post('/mcp').send(mcpPayload('chat_worker', { workerId: 'x', message: 'hi', repoKey: 'o/r' }));
      expect(r.status).toBe(200);
    }
    const res = await request(app).post('/mcp').send(mcpPayload('chat_worker', { workerId: 'x', message: 'hi', repoKey: 'o/r' }));
    expect(res.status).toBe(429);
    expect(res.headers['ratelimit-limit']).toBe(String(CHAT_MAX));
  });
});

describe('Blog MCP Server — write tools rate limit', () => {
  let app: Application;
  const WRITE_MAX = 4;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp({ rateLimits: { globalMax: 100, writeMax: WRITE_MAX } });
  });

  it(`returns 429 after ${WRITE_MAX} create_post requests/min`, async () => {
    for (let i = 0; i < WRITE_MAX; i++) {
      const r = await request(app).post('/mcp').send(mcpPayload('create_post', {
        repoKey: 'o/r', sessionId: 'x', eventType: 'pr_created',
        title: `post ${i}`, content: 'body', prNumber: i + 1,
      }));
      expect(r.status).toBe(200);
    }
    const res = await request(app).post('/mcp').send(mcpPayload('create_post', {
      repoKey: 'o/r', sessionId: 'x', eventType: 'pr_created',
      title: 'post over limit', content: 'body', prNumber: WRITE_MAX + 1,
    }));
    expect(res.status).toBe(429);
    expect(res.headers['ratelimit-limit']).toBe(String(WRITE_MAX));
  });
});

// ─── G.4 /metrics endpoint ─────────────────────────────────────────────────────

describe('GET /metrics endpoint', () => {
  let app: Application;

  beforeAll(async () => {
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp();
  });

  // G.4 test 1
  it('GET /metrics returns 200', async () => {
    const res = await request(app).get('/metrics').expect(200);
    expect(typeof res.text).toBe('string');
  });

  // G.4 test 2
  it('response contains blog_posts_created_total after creating a post', async () => {
    // First clear any prior state by creating a fresh app (each test has its own counters)
    // Create a post via MCP
    await request(app)
      .post('/mcp')
      .send(mcpPayload('create_post', {
        repoKey: 'jleechanorg/ai_universe_living_blog',
        posterId: 'metrics-test-worker',
        title: 'Metrics test post',
        content: 'Testing metrics.',
        eventType: 'pr_created',
      }))
      .expect(200);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    // Counter is incremented for each request (global) and for posts_created
    const text = res.text;
    expect(text).toContain('blog_posts_created_total');
  });

  // G.4 test 3
  it('response is valid Prometheus text format', async () => {
    const res = await request(app).get('/metrics').expect(200);
    const text = res.text;
    // Prometheus text format: lines starting with # HELP or # TYPE, then metric lines
    const lines = text.split('\n');
    const hasHelpOrType = lines.some((l) => l.startsWith('# HELP') || l.startsWith('# TYPE'));
    expect(hasHelpOrType).toBe(true);
  });
});
