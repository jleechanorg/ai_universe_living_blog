/**
 * Worker Poster — posts AO lifecycle events to the blog MCP server.
 *
 * Calls `create_post` via JSON-RPC 2.0 over HTTP POST /mcp.
 * Uses direct dispatch (method: 'create_post') for simplicity.
 * The server also accepts the MCP standard tools/call wrapper format.
 * The fetch dependency is injectable so tests can mock it without network I/O.
 */

import type { PostEventType, RepoKey } from '../shared/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkerEvent {
  type: PostEventType;   // e.g. 'pr_created', 'pr_merged', 'pr_review_requested'
  repo: RepoKey;          // 'owner/repo'
  pr?: number;
  session: string;        // e.g. 'ao-826'
  branch?: string;
  message?: string;       // optional narrative override
}

const DEFAULT_TIMEOUT_MS = 10_000;

// ─── postEvent ────────────────────────────────────────────────────────────────

export async function postEvent(
  event: WorkerEvent,
  blogUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'create_post',
    params: {
      repoKey: event.repo,
      posterId: event.session,
      title: `${event.type}: ${event.repo} PR#${event.pr ?? 'N/A'}`,
      content: event.message ?? `Worker ${event.session} recorded ${event.type}`,
      eventType: event.type,
      metadata: { prNumber: event.pr, branchName: event.branch },
    },
  };

  const url = `${blogUrl.replace(/\/$/, '')}/mcp`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Blog post failed: HTTP ${res.status}`);

    const data = await res.json() as {
      jsonrpc: string;
      id: unknown;
      error?: { code: number; message: string };
      result?: {
        isError?: boolean;
        content?: Array<{ type: string; text: string }>;
      };
    };

    if (data.error) throw new Error(`Blog post failed: ${data.error.message}`);

    if (data.result?.isError) {
      const item = data.result.content?.[0];
      if (!item) throw new Error('Blog post failed: server returned an error (empty content)');

      // The blog server returns error details as JSON-stringified { error: string }.
      // Attempt to extract the inner message; fall back to the raw text.
      let message: string;
      try {
        const inner = JSON.parse(item.text) as { error?: string };
        message = inner.error ?? item.text;
      } catch {
        // text wasn't JSON — include it verbatim so callers can inspect it.
        message = item.text;
      }
      throw new Error(`Blog post failed: ${message}`);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Blog post failed: request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    // Clear the timeout once the full response (including body) has been consumed.
    // This ensures the timeout protects the entire fetch + res.json() window.
    clearTimeout(timeout);
  }
}
