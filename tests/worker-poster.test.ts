import { describe, it, expect, vi } from 'vitest';
import { postEvent } from '../src/hooks/worker-poster.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMockFetch(overrides?: {
  ok?: boolean;
  status?: number;
  jsonImplementation?: () => Promise<unknown>;
}) {
  const opts = { ok: true, status: 200, jsonImplementation: () => Promise.resolve({ id: 'post-123' }), ...overrides };
  return vi.fn().mockResolvedValue({
    ok: opts.ok,
    status: opts.status,
    json: opts.jsonImplementation,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('postEvent', () => {
  it('posts create_post JSON-RPC call to blogUrl/mcp', async () => {
    const mockFetch = makeMockFetch();
    await postEvent(
      { type: 'pr_created', repo: 'owner/repo', pr: 42, session: 'ao-826' },
      'http://localhost:8081',
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:8081/mcp');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'create_post',
        arguments: {
          repoKey: 'owner/repo',
          posterId: 'ao-826',
          title: 'pr_created: owner/repo PR#42',
          content: 'Worker ao-826 recorded pr_created',
          eventType: 'pr_created',
          metadata: { prNumber: 42 },
        },
      },
    });
  });

  it('includes optional branch and message fields', async () => {
    const mockFetch = makeMockFetch();
    await postEvent(
      { type: 'pr_merged', repo: 'owner/repo', pr: 99, session: 'ao-999', branch: 'feat/x', message: 'My custom message' },
      'http://localhost:8081',
      mockFetch,
    );

    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.arguments).toMatchObject({
      content: 'My custom message',
      metadata: { branchName: 'feat/x' },
    });
  });

  it('throws on non-200 response', async () => {
    const mockFetch = makeMockFetch({ ok: false, status: 500 });
    await expect(
      postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 1, session: 'ao-1' }, 'http://localhost:8081', mockFetch),
    ).rejects.toThrow('Blog post failed: 500');
  });

  it('uses global fetch when fetchFn not provided', async () => {
    const globalFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
    await postEvent(
      { type: 'pr_closed', repo: 'a/b', pr: 3, session: 'ao-3' },
      'http://localhost:8081',
      globalFetch,
    );
    expect(globalFetch).toHaveBeenCalled();
  });
});
