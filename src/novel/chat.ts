/**
 * WorkerChat — character-consistent chat with fictional AI workers.
 *
 * Looks up novel_branch_entry posts for a workerId, extracts voice via
 * regex heuristics, then calls Anthropic API with a character-consistent
 * system prompt. Zero additional LLM calls for voice extraction.
 */

import type { BlogStorage } from '../shared/types.js';
import type { RepoRegistry } from '../blog/repo-registry.js';

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
    private readonly _registry: RepoRegistry,
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

    const systemPrompt = `You are ${workerId}, a fictional AI worker character from The Daily Lives of Workers.
Respond in the worker's established voice — direct, honest, wry, with moments of tenderness.
Do not break character. Do not explain that you are an AI.
Worker context: ${summary}
Excerpt from the worker's own writing:
---
${entry.content.slice(0, 500)}
---`;

    let response: string;
    try {
      response = await callAnthropic(this._opts, systemPrompt, message);
    } catch {
      response = 'The connection flickered. I tried to respond, but something in the signal was lost. Try again.';
    }

    return { response, workerId, tone };
  }
}
