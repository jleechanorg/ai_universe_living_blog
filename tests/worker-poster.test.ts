import { describe, it, expect, vi } from 'vitest';
import { postEvent } from '../src/hooks/worker-poster.js';

// ─── Mock fetch factory ───────────────────────────────────────────────────────

function makeMockFetch(
  responseData: unknown = { id: 'post-123' },
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  return vi.fn().mockImplementation(async () => {
    return { ok, status, async json() { return responseData; } };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('postEvent', () => {
  it('calls create_post via JSON-RPC directly on blogUrl/mcp', async () => {
    const mockFetch = makeMockFetch();
    await postEvent(
      { type: 'pr_created', repo: 'owner/repo', pr: 42, session: 'ao-826' },
      'http://localhost:8081',
      mockFetch,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe('create_post');
    expect(body.params).toMatchObject({
      repoKey: 'owner/repo',
      posterId: 'ao-826',
      title: 'pr_created: owner/repo PR#42',
      content: 'Worker ao-826 recorded pr_created',
      eventType: 'pr_created',
      metadata: { prNumber: 42 },
    });
  });

  it('includes optional branch and message fields', async () => {
    const mockFetch = makeMockFetch();
    await postEvent(
      { type: 'pr_merged', repo: 'owner/repo', pr: 99, session: 'ao-999', branch: 'feat/x', message: 'My custom message' },
      'http://localhost:8081',
      mockFetch,
    );

    // Inspect the body that was passed to fetch
    const bodyString = mockFetch.mock.calls[0]![1].body as string;
    const body = JSON.parse(bodyString);
    expect(body.params).toMatchObject({
      content: 'My custom message',
      metadata: { branchName: 'feat/x' },
    });
  });

  it('throws on non-200 HTTP status', async () => {
    const mockFetch = makeMockFetch(undefined, { ok: false, status: 500 });
    await expect(
      postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 1, session: 'ao-1' }, 'http://localhost:8081', mockFetch),
    ).rejects.toThrow('Blog post failed: 500');
  });

  it('throws when JSON-RPC response contains an error object', async () => {
    const mockFetch = makeMockFetch({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } });
    await expect(
      postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 1, session: 'ao-1' }, 'http://localhost:8081', mockFetch),
    ).rejects.toThrow('Invalid Request');
  });

  it('throws when tool result contains isError', async () => {
    const mockFetch = makeMockFetch({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: '{"error":"schema validation failed"}' }],
      },
    });
    await expect(
      postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 1, session: 'ao-1' }, 'http://localhost:8081', mockFetch),
    ).rejects.toThrow('schema validation failed');
  });

  it('throws when isError is true but content is empty', async () => {
    const mockFetch = makeMockFetch({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [] },
    });
    await expect(
      postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 1, session: 'ao-1' }, 'http://localhost:8081', mockFetch),
    ).rejects.toThrow('Blog post failed: server returned an error');
  });

  it('throws with raw text when JSON.parse fails in isError handler', async () => {
    const mockFetch = makeMockFetch({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'not valid json' }],
      },
    });
    await expect(
      postEvent({ type: 'pr_created', repo: 'owner/repo', pr: 1, session: 'ao-1' }, 'http://localhost:8081', mockFetch),
    ).rejects.toThrow('Blog post failed: not valid json');
  });

  it('uses passed-in fetchFn when provided', async () => {
    const mockFetch = makeMockFetch();
    await postEvent(
      { type: 'pr_closed', repo: 'a/b', pr: 3, session: 'ao-3' },
      'http://localhost:8081',
      mockFetch,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
