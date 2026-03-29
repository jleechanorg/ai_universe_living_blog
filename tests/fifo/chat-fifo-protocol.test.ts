/**
 * tests/fifo/chat-fifo-protocol.test.ts — FIFO bidirectional chat protocol tests
 *
 * Tests chatViaFifo() and parseFifoLines() in isolation.
 *
 * chatViaFifo() is tested with real temp files for file-existence and timeout
 * behavior (real FIFOs require a concurrent reader process, which is hard to
 * orchestrate in Vitest). parseFifoLines() is a pure function and is tested
 * exhaustively with inline string inputs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Import under test ────────────────────────────────────────────────────────

import {
  chatViaFifo,
  parseFifoLines,
  FIFO_POLL_INTERVAL_MS,
  type FifoRequest,
  type FifoResponse,
} from '../../src/novel/chat.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFifoDir() {
  return mkdtempSync(join(tmpdir(), 'fifo-test-'));
}

// ─── parseFifoLines — pure function tests ─────────────────────────────────────

describe('parseFifoLines', () => {
  it('parses a valid worker response line', () => {
    const res: FifoResponse = {
      from: 'worker',
      response: 'The rebase. I fought with git for 40 minutes...',
      timestamp: new Date().toISOString(),
    };
    const result = parseFifoLines(JSON.stringify(res) + '\n');
    expect(result).toBe('The rebase. I fought with git for 40 minutes...');
  });

  it('ignores non-worker JSON lines and finds worker response', () => {
    const req: FifoRequest = {
      from: 'reader',
      message: 'test',
      timestamp: new Date().toISOString(),
      threadId: 'uuid-1',
    };
    const res: FifoResponse = {
      from: 'worker',
      response: 'I found my rhythm eventually.',
      timestamp: new Date().toISOString(),
    };
    const accumulated = JSON.stringify(req) + '\n' + JSON.stringify(res) + '\n';
    const result = parseFifoLines(accumulated);
    expect(result).toBe('I found my rhythm eventually.');
  });

  it('returns null for malformed JSON lines', () => {
    expect(parseFifoLines('not json at all\n')).toBeNull();
  });

  it('returns null for JSON that lacks from=worker field', () => {
    expect(
      parseFifoLines(JSON.stringify({ from: 'other', data: 'something' }) + '\n'),
    ).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseFifoLines('')).toBeNull();
  });

  it('returns null for valid JSON without response field', () => {
    expect(parseFifoLines(JSON.stringify({ from: 'worker' }) + '\n')).toBeNull();
  });

  it('returns the last worker line when multiple worker responses present', () => {
    const res1: FifoResponse = {
      from: 'worker',
      response: 'first response',
      timestamp: new Date().toISOString(),
    };
    const res2: FifoResponse = {
      from: 'worker',
      response: 'second response',
      timestamp: new Date().toISOString(),
    };
    // Lines reversed — second (last line) is found first
    const result = parseFifoLines(JSON.stringify(res1) + '\n' + JSON.stringify(res2) + '\n');
    expect(result).toBe('second response');
  });
});

// ─── chatViaFifo — file-system integration tests ─────────────────────────────

describe('chatViaFifo', () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = makeFifoDir();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(inboxDir, { recursive: true, force: true });
  });

  it('returns null when no FIFO file exists for the worker', async () => {
    const result = await chatViaFifo('ao-826', 'Hello?', inboxDir, 200);
    expect(result).toBeNull();
  });

  it('returns null when file exists but times out with no response', async () => {
    // Create a file (simulates FIFO that is open but worker never replies).
    // Regular file: readSync returns 0 bytes after the request write, triggering timeout.
    const fifoPath = join(inboxDir, 'ao-999');
    writeFileSync(fifoPath, ''); // empty file

    const result = await chatViaFifo('ao-999', 'Hello?', inboxDir, 150);
    expect(result).toBeNull();
  });

  it('FIFO_POLL_INTERVAL_MS is 100ms by default', () => {
    expect(FIFO_POLL_INTERVAL_MS).toBe(100);
  });
});
