/**
 * tests/fifo/chat-fifo.test.ts — Phase 5: WorkerChat & voice extraction tests
 *
 * Tests:
 * - extractVoice: tone heuristics (regex-based, 0 LLM calls)
 * - WorkerChat.chat: Anthropic API fallback, no-entry fallback
 *
 * Mocks fetch globally to intercept Anthropic API calls.
 * Uses createBlogToolHandlers (real) to seed novel_branch_entry posts.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { MemoryBlogStorage } from '../../src/blog/storage.js';
import { createBlogToolHandlers } from '../../src/blog/tools.js';
import { RepoRegistry } from '../../src/blog/repo-registry.js';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage() {
  const dataDir = join(tmpdir(), `chat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dataDir, { recursive: true });
  const storage = new MemoryBlogStorage();
  const registry = new RepoRegistry(dataDir);
  const tools = createBlogToolHandlers({ storage, agentId: 'test', registry, dataDir });
  return { storage, tools };
}

// ─── Fetch stub for Anthropic API ─────────────────────────────────────────────

let mockAnthropicResponse = 'Mocked AI response from the worker.';
let anthropicCallCount = 0;
let simulateApiError = false;
let capturedRequestBody = '';

vi.stubGlobal('fetch', async (url: string, opts?: RequestInit) => {
  const urlStr = String(url);
  if (urlStr.includes('anthropic.com') || urlStr.includes('/v1/messages')) {
    anthropicCallCount++;
    capturedRequestBody = String(opts?.body ?? '');
    if (simulateApiError) {
      return {
        ok: false, status: 500, statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'server error' }),
      } as unknown as Response;
    }
    return {
      ok: true, status: 200,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: mockAnthropicResponse }],
      }),
      statusText: 'OK',
    } as unknown as Response;
  }
  throw new Error(`Unexpected fetch to: ${url}`);
});

const { extractVoice, WorkerChat } = await import('../../src/novel/chat.js');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractVoice', () => {
  it('returns staccato tone for empty content (avg sentence length = 0)', () => {
    // Empty content: no sentences → avgSentenceLen=0 < 10 → 'staccato and terse'
    const { tone } = extractVoice('');
    expect(tone).toBe('staccato and terse');
  });

  it('detects contracted tone for text with many contractions', () => {
    const text = "I'm working on it. Can't stop now. It's all good. We're making progress. Don't worry.";
    const { tone } = extractVoice(text);
    expect(tone).toContain('contracted');
  });

  it('detects formal tone for long sentences', () => {
    const text = 'The implementation of the feature required extensive refactoring of the existing codebase, including updates to the storage layer, the API endpoints, and the test suite, which took considerably longer than originally anticipated.';
    const { tone } = extractVoice(text);
    expect(tone).toContain('formal');
  });

  it('detects staccato tone for short sentences', () => {
    const text = 'Done. Fixed. Shipped. Works. Clean. Tests pass.';
    const { tone } = extractVoice(text);
    expect(tone).toContain('staccato');
  });

  it('summary includes voice analysis stats', () => {
    const text = 'This is a test with some words in it.';
    const { summary } = extractVoice(text);
    expect(summary).toContain('Voice analysis:');
    expect(summary).toContain('Avg sentence length:');
  });

  it('detects introspective tone for heavy first-person usage', () => {
    const text = 'I think I understand. I made my choice. I see my own path. I feel my way forward. I know.';
    const { tone } = extractVoice(text);
    expect(tone).toContain('introspective');
  });
});

describe('WorkerChat', () => {
  beforeEach(() => {
    anthropicCallCount = 0;
    mockAnthropicResponse = 'Mocked AI response from the worker.';
    simulateApiError = false;
    capturedRequestBody = '';
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns "no record" message when no entry exists for worker', async () => {
    const { storage } = makeStorage();
    const chat = new WorkerChat(storage, { anthropicKey: 'test-key' });
    const result = await chat.chat('ao-nonexistent', 'Hello?', 'owner/repo');

    expect(result.response).toContain("don't have a record");
    expect(result.workerId).toBe('ao-nonexistent');
    expect(result.tone).toBe('unknown');
    // Should NOT call Anthropic when no entry found
    expect(anthropicCallCount).toBe(0);
  });

  it('calls Anthropic API and returns character response when entry exists', async () => {
    const { storage, tools } = makeStorage();
    // Seed a novel_branch_entry post via the real tool handler
    await tools.create_post({
      repoKey: 'owner/repo',
      posterId: 'ao-826',
      title: 'Branch entry for ao-826',
      content: "I've been working on the feature all day. Can't stop now. It's complex but I'm getting there.",
      eventType: 'novel_branch_entry',
      metadata: { sessionId: 'ao-826' },
    });

    const chat = new WorkerChat(storage, { anthropicKey: 'test-key' });
    const result = await chat.chat('ao-826', 'What was the hardest part?', 'owner/repo');

    expect(result.response).toBe('Mocked AI response from the worker.');
    expect(result.workerId).toBe('ao-826');
    expect(typeof result.tone).toBe('string');
    expect(anthropicCallCount).toBe(1);
  });

  it('returns fallback message on Anthropic API error', async () => {
    const { storage, tools } = makeStorage();
    simulateApiError = true;

    await tools.create_post({
      repoKey: 'owner/repo',
      posterId: 'ao-error-test',
      title: 'entry',
      content: 'Some work was done here. Testing error recovery.',
      eventType: 'novel_branch_entry',
      metadata: { sessionId: 'ao-error-test' },
    });

    const chat = new WorkerChat(storage, { anthropicKey: 'test-key' });
    const result = await chat.chat('ao-error-test', 'Hello?', 'owner/repo');

    // Should get the error fallback message
    expect(result.response).toContain('connection flickered');
    expect(result.workerId).toBe('ao-error-test');
  });

  it('uses custom model when provided in ChatOptions', async () => {
    const { storage, tools } = makeStorage();

    await tools.create_post({
      repoKey: 'owner/repo',
      posterId: 'ao-model-test',
      title: 'entry',
      content: 'Working on the task. Making progress.',
      eventType: 'novel_branch_entry',
      metadata: { sessionId: 'ao-model-test' },
    });

    const chat = new WorkerChat(storage, {
      anthropicKey: 'test-key',
      model: 'claude-3-haiku-20240307',
    });
    await chat.chat('ao-model-test', 'Hello', 'owner/repo');

    expect(capturedRequestBody).toContain('claude-3-haiku-20240307');
  });

  it('returns tone in result', async () => {
    const { storage, tools } = makeStorage();

    await tools.create_post({
      repoKey: 'owner/repo',
      posterId: 'ao-tone-test',
      title: 'entry',
      content: "I've been hacking away. Can't stop. We're almost there. Don't give up.",
      eventType: 'novel_branch_entry',
      metadata: { sessionId: 'ao-tone-test' },
    });

    const chat = new WorkerChat(storage, { anthropicKey: 'test-key' });
    const result = await chat.chat('ao-tone-test', 'How are you?', 'owner/repo');

    expect(typeof result.tone).toBe('string');
    expect(result.tone.length).toBeGreaterThan(0);
  });
});
