/**
 * Webhook HMAC validation + event routing tests.
 *
 * Tests POST /webhook handler via supertest + createBlogApp.
 * Covers: HMAC-SHA256 signature validation, event routing, graceful skips.
 *
 * Run with: npx vitest run tests/blog/webhook.test.ts
 */

import { createHmac } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { MemoryBlogStorage } from '../../src/blog/storage.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret-abc123';
const TEST_REPO = 'test-owner/test-repo';

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function prPayload(action: string, merged = false) {
  return {
    repository: { full_name: TEST_REPO },
    action,
    pull_request: {
      number: 42,
      html_url: `https://github.com/${TEST_REPO}/pull/42`,
      merged,
    },
  };
}

function checkRunPayload(conclusion: string) {
  // mapGitHubEventToPostType reads payload.conclusion directly (top-level),
  // so we set it at the root of the payload (not nested under check_run).
  return {
    repository: { full_name: TEST_REPO },
    action: 'completed',
    conclusion,
  };
}

function mcpPayload(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

async function registerRepo(app: Application, repoKey: string): Promise<void> {
  await request(app)
    .post('/mcp')
    .send(mcpPayload('register_repo', { repoKey }));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('POST /webhook', () => {
  let app: Application;
  let storage: MemoryBlogStorage;

  beforeAll(async () => {
    storage = new MemoryBlogStorage();
    process.env['STORAGE_TYPE'] = 'memory';
    process.env['WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    const { createBlogApp } = await import('../../src/blog/server.js');
    app = await createBlogApp({ storage, disableRateLimiting: true });
  });

  afterAll(() => {
    delete process.env['STORAGE_TYPE'];
    delete process.env['WEBHOOK_SECRET'];
  });

  // 1
  it('valid HMAC + pr opened → 200 + ok:true', async () => {
    await registerRepo(app, TEST_REPO);
    const body = JSON.stringify(prPayload('opened'));
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-001')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // 2
  it('invalid HMAC signature → 400 rejected', async () => {
    const body = JSON.stringify(prPayload('opened'));
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-002')
      .set('X-Hub-Signature-256', 'sha256=deadbeefdeadbeefdeadbeefdeadbeef')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  // 3
  it('missing X-Hub-Signature-256 when secret configured → 400', async () => {
    const body = JSON.stringify(prPayload('opened'));
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-003')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  // 4
  it('missing repository in payload → 400 bad request', async () => {
    const body = JSON.stringify({ action: 'opened', pull_request: { number: 1 } });
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-004')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repo/i);
  });

  // 5
  it('pull_request action=opened → post eventType=pr_created', async () => {
    const body = JSON.stringify(prPayload('opened'));
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-005')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.postType).toBe('pr_created');
  });

  // 6
  it('pull_request action=closed + merged=true → post eventType=pr_merged', async () => {
    const body = JSON.stringify(prPayload('closed', true));
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-006')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.postType).toBe('pr_merged');
  });

  // 7
  it('check_run conclusion=success → post eventType=pr_checks_passed', async () => {
    const body = JSON.stringify(checkRunPayload('success'));
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'check_run')
      .set('X-GitHub-Delivery', 'delivery-007')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.postType).toBe('pr_checks_passed');
  });

  // 8
  it('unknown event type → 200 but note field, no postType', async () => {
    const body = JSON.stringify({
      repository: { full_name: TEST_REPO },
      action: 'labeled',
    });
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'issues')
      .set('X-GitHub-Delivery', 'delivery-008')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.postType).toBeUndefined();
    expect(res.body.note).toMatch(/not supported/i);
  });

  // 9
  it('ping event → 200 pong acknowledgment', async () => {
    const body = JSON.stringify({ repository: { full_name: TEST_REPO }, zen: 'Keep it logically awesome.' });
    const res = await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'ping')
      .set('X-GitHub-Delivery', 'delivery-009')
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('pong');
  });

  // 10
  it('valid event → post appears in storage.listPosts()', async () => {
    const deliveryId = 'delivery-010-' + Date.now();
    const body = JSON.stringify(prPayload('opened'));
    await request(app)
      .post('/webhook')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', deliveryId)
      .set('X-Hub-Signature-256', sign(body, WEBHOOK_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    const webhookPosts = result.posts.filter((p) => p.tags?.includes('webhook'));
    expect(webhookPosts.length).toBeGreaterThan(0);
  });
});
