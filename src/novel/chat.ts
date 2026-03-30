/**
 * WorkerChat — character-consistent chat with fictional AI workers.
 *
 * Looks up novel_branch_entry posts for a workerId, extracts voice via
 * regex heuristics, then calls Anthropic API with a character-consistent
 * system prompt. Zero additional LLM calls for voice extraction.
 */

import { existsSync, openSync, writeSync, closeSync, readSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import { getPersona } from './personas.js';
import type { BlogStorage } from '../shared/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatOptions {
  anthropicKey: string;
  model?: string;
  baseURL?: string;
}

export interface ChatResult {
  response: string;
  workerId: string;
  tone: string;
}

// ─── FIFO bidirectional chat ─────────────────────────────────────────────────

export const FIFO_INBOX_DIR = join(homedir(), '.blog', 'inbox');
export const FIFO_OVERALL_TIMEOUT_MS = 5000;
export const FIFO_POLL_INTERVAL_MS = 100;

/** Message written by the MCP server to the FIFO. */
export interface FifoRequest {
  from: 'reader';
  message: string;
  timestamp: string;
  threadId: string;
}

/** Message written by the AO worker to the FIFO. */
export interface FifoResponse {
  from: 'worker';
  response: string;
  timestamp: string;
}

/**
 * Parse accumulated FIFO buffer text, returning the first worker response found
 * (scanning lines in reverse — newest first). Returns null if no valid response.
 */
export function parseFifoLines(accumulated: string): string | null {
  const lines = accumulated.split('\n').filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as Partial<FifoResponse>;
      if (parsed.from === 'worker' && typeof parsed.response === 'string') {
        return parsed.response;
      }
    } catch {
      // not valid JSON
    }
  }
  return null;
}

/**
 * Try to send a message to an AO worker via named pipe and read back its reply.
 *
 * Protocol:
 * 1. Check if `{inboxDir}/{workerId}` exists (any file or FIFO)
 * 2. Open it O_RDWR so both sides share the same fd (non-blocking)
 * 3. Write JSON request message
 * 4. Poll for a JSON response line with overall timeout
 * 5. Return the response string, or null on timeout / error
 *
 * @param workerId   - Worker session ID (e.g. "ao-826")
 * @param message    - The user's question
 * @param inboxDir   - Directory containing inbox FIFOs (default: ~/.blog/inbox)
 * @param timeoutMs  - Overall timeout in ms (default: 5000)
 * @returns Response string from worker, or null if no response within timeout
 */
export async function chatViaFifo(
  workerId: string,
  message: string,
  inboxDir: string = FIFO_INBOX_DIR,
  timeoutMs: number = FIFO_OVERALL_TIMEOUT_MS,
): Promise<string | null> {
  const fifoPath = join(inboxDir, workerId);
  if (!existsSync(fifoPath)) return null;

  const req: FifoRequest = {
    from: 'reader',
    message,
    timestamp: new Date().toISOString(),
    threadId: uuidv4(),
  };
  const reqLine = JSON.stringify(req) + '\n';

  let fd: number;
  try {
    // O_RDWR | O_NONBLOCK: open without blocking even if no one has the other end open.
    // On Linux this succeeds immediately for FIFOs; on macOS O_RDWR on a FIFO is POSIX-defined.
    fd = openSync(fifoPath, constants.O_RDWR | constants.O_NONBLOCK);
  } catch {
    // No reader on the other end (ENXIO) or other error — skip FIFO
    return null;
  }

  try {
    writeSync(fd, reqLine);
  } catch {
    closeSync(fd);
    return null;
  }

  // Poll for response line
  const buf = Buffer.alloc(8192);
  let accumulated = '';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let n: number;
    try {
      n = readSync(fd, buf, 0, buf.length, null);
    } catch (err: unknown) {
      // EAGAIN / EWOULDBLOCK = no data yet, keep polling
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
        await new Promise((r) => setTimeout(r, FIFO_POLL_INTERVAL_MS));
        continue;
      }
      break; // unexpected error
    }

    if (n > 0) {
      accumulated += buf.subarray(0, n).toString('utf8');
      const response = parseFifoLines(accumulated);
      if (response !== null) {
        closeSync(fd);
        return response;
      }
    }

    await new Promise((r) => setTimeout(r, FIFO_POLL_INTERVAL_MS));
  }

  closeSync(fd);
  return null; // timeout
}

// ─── Voice extraction (regex heuristics, 0 LLM calls) ───────────────────────

export function extractVoice(content: string): { tone: string; summary: string } {
  const sentences = content.split(/[.!?]+/).filter(Boolean);
  const words = content.split(/\s+/);
  const wordCount = words.length;

  const avgSentenceLen =
    sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length
      : 0;

  const questionCount = (content.match(/\?/g) || []).length;
  const contractions = (content.match(/\b\w+'\w+\b/g) || []).length;
  const firstPerson = (content.match(/\b(I|me|my|we|our)\b/gi) || []).length;
  const ellipsisCount = (content.match(/\.\.\./g) || []).length;
  const capsWords = (content.match(/\b[A-Z]{3,}\b/g) || []).length;

  const patterns: string[] = [];
  if (contractions / Math.max(wordCount, 1) > 0.03) patterns.push('contracted');
  if (questionCount / Math.max(sentences.length, 1) > 0.1) patterns.push('inquisitive');
  if (avgSentenceLen > 25) patterns.push('formal and measured');
  else if (avgSentenceLen < 10) patterns.push('staccato and terse');
  if (firstPerson / Math.max(wordCount, 1) > 0.05) patterns.push('introspective');
  if (ellipsisCount > 0) patterns.push('elliptical');
  if (capsWords / Math.max(wordCount, 1) > 0.02) patterns.push('emphatic');

  const tone = patterns.length > 0 ? patterns.join(', ') : 'neutral';
  const summary = `Voice analysis: ${tone}. Avg sentence length: ${avgSentenceLen.toFixed(1)} words. Questions: ${questionCount}.`;
  return { tone, summary };
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

async function callAnthropic(
  opts: ChatOptions,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const { anthropicKey, model = 'claude-3-5-sonnet-20241022', baseURL = 'https://api.anthropic.com' } = opts;

  const res = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock?.text ?? '';
}

// ─── WorkerChat ────────────────────────────────────────────────────────────────

export class WorkerChat {
  constructor(
    private readonly _storage: BlogStorage,
    private readonly _opts: ChatOptions,
  ) {}

  async chat(workerId: string, message: string, repoKey: string): Promise<ChatResult> {
    // Look up the most recent novel_branch_entry for this worker
    const page = await this._storage.listPosts({
      repoKey: repoKey as Parameters<typeof this._storage.listPosts>[0]['repoKey'],
      eventType: 'novel_branch_entry',
      limit: 20,
    });

    const matching = page.posts.filter(
      (p) =>
        p.metadata?.sessionId === workerId ||
        p.content.toLowerCase().includes(workerId.toLowerCase()),
    );

    // Sort by newest first
    matching.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const entry = matching[0];

    if (!entry) {
      return {
        response: "I don't have a record of that worker yet.",
        workerId,
        tone: 'unknown',
      };
    }

    const { tone, summary } = extractVoice(entry.content);
    const persona = getPersona(workerId);

    const systemPrompt = `You are ${workerId}, a fictional AI worker character from The Daily Lives of Workers.
Your archetype: ${persona.name}. Role: ${persona.role}.
${persona.systemPromptSnippet}
Respond in this worker's established voice.
Worker context from voice analysis: ${summary}
Excerpt from the worker's own writing:
---
${entry.content.slice(0, 500)}
---
Persona voice examples to inform your tone:
${persona.voiceSamples.map((s) => `  — "${s}"`).join('\n')}`;

    let response: string;
    try {
      response = await callAnthropic(this._opts, systemPrompt, message);
    } catch {
      response = 'The connection flickered. I tried to respond, but something in the signal was lost. Try again.';
    }

    return { response, workerId, tone };
  }
}
