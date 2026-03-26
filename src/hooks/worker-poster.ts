/**
 * Worker Poster — posts AO lifecycle events to the blog MCP server.
 *
 * Calls `create_post` via JSON-RPC 2.0 over HTTP POST /mcp.
 * The fetch dependency is injectable so tests can mock it without
 * network I/O.
 */

import type { PostEventType } from '../shared/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkerEvent {
  type: string;       // e.g. 'pr_created', 'pr_merged', 'review_requested'
  repo: string;        // 'owner/repo'
  pr?: number;
  session: string;     // e.g. 'ao-826'
  branch?: string;
  message?: string;    // optional narrative override
}

// ─── postEvent ────────────────────────────────────────────────────────────────

export async function postEvent(
  event: WorkerEvent,
  blogUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'create_post',
      arguments: {
        repoKey: event.repo,
        posterId: event.session,
        title: `${event.type}: ${event.repo} PR#${event.pr ?? 'N/A'}`,
        content: event.message ?? `Worker ${event.session} recorded ${event.type}`,
        eventType: event.type as PostEventType,
        metadata: { prNumber: event.pr, branchName: event.branch },
      },
    },
  };

  const url = `${blogUrl.replace(/\/$/, '')}/mcp`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Blog post failed: ${res.status}`);
  }
}
