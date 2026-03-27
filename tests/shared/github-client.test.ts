import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Call tracker ───────────────────────────────────────────────────────────

/** Records every fetch call so we can inspect arguments after the client runs. */
const callTracker = {
  calls: [] as Array<{ url: string; options?: { headers?: Record<string, string> } }>,
  /** Array of response bodies; each element = one API call's JSON body. */
  mockQueue: null as null | unknown[],
  /** Array of Link header strings; each element = one API call's Link header. */
  linkQueue: null as null | (string | null)[],
  clear() { this.calls = []; this.mockQueue = null; this.linkQueue = null; },
  /**
   * Convenience: queue a single response body (for single-page tests).
   * Internally stores as [d] so setQueue logic works uniformly.
   */
  setData(d: unknown) { this.mockQueue = [d]; this.linkQueue = [null]; },
  /**
   * Queue N response bodies + N Link headers for multi-page tests.
   * Each array element is one page's full JSON body (array of records).
   * Link headers are paired by index.
   */
  setQueue(bodies: unknown[], linkHeaders: (string | null)[]) {
    this.mockQueue = bodies;
    this.linkQueue = linkHeaders;
  },
};

vi.stubGlobal('fetch', async (url: string, options?: { headers?: Record<string, string> }) => {
  callTracker.calls.push({ url, options });

  if (!callTracker.mockQueue || callTracker.mockQueue.length === 0) {
    throw new Error('No mock responses queued');
  }
  const data = callTracker.mockQueue.shift();
  const linkHeader = callTracker.linkQueue?.shift() ?? null;

  return {
    ok: true, status: 200,
    json: () => Promise.resolve(data),
    statusText: 'OK',
    headers: {
      get: (k: string) => (k === 'Link' && linkHeader !== null ? linkHeader : null),
    },
  } as unknown as Response;
});

// ─── Import after stub ─────────────────────────────────────────────────────────

const { GitHubClient } = await import('../../src/shared/github-client.js');

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GitHubClient', () => {
  beforeEach(() => {
    callTracker.clear();
  });

  // ── Constructor / token in requests ───────────────────────────────────────────

  describe('constructor', () => {
    it('sends Bearer token in Authorization header when token is provided', async () => {
      const client = new GitHubClient('my-secret-token');
      callTracker.setData({
        number: 42, title: 'Test', state: 'open', merged: false,
        html_url: 'https://github.com/owner/repo/pull/42',
      });
      await client.getPR('owner', 'repo', 42);
      expect(callTracker.calls).toHaveLength(1);
      expect(callTracker.calls[0]!.options?.headers?.['Authorization']).toBe('Bearer my-secret-token');
    });

    it('omits Authorization header when no token is provided', async () => {
      const client = new GitHubClient();
      callTracker.setData({
        number: 42, title: 'Test', state: 'open', merged: false,
        html_url: 'https://github.com/owner/repo/pull/42',
      });
      await client.getPR('owner', 'repo', 42);
      expect(callTracker.calls).toHaveLength(1);
      expect(callTracker.calls[0]!.options?.headers?.['Authorization']).toBeUndefined();
    });
  });

  // ── listRecentActivity ─────────────────────────────────────────────────────────

  describe('listRecentActivity', () => {
    it('returns formatted GHActivityEvent[] with no nextCursor on last page', async () => {
      callTracker.setData([
        {
          id: '123', type: 'PullRequestEvent',
          created_at: '2026-03-27T10:00:00Z',
          payload: { action: 'opened', number: 42 },
          actor: { login: 'bot-826' },
        },
      ]);
      // No Link header → single page → nextCursor undefined
      const result = await new GitHubClient().listRecentActivity('owner', 'repo');
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        id: '123',
        type: 'PullRequestEvent',
        repo: 'owner/repo',
        createdAt: '2026-03-27T10:00:00Z',
        payload: { action: 'opened', number: 42 },
        actor: { login: 'bot-826' },
      });
      expect(result.nextCursor).toBeUndefined();
    });

    it('passes per_page to the API', async () => {
      callTracker.setData([]);
      await new GitHubClient().listRecentActivity('owner', 'repo', 50);
      expect(callTracker.calls[0]!.url).toContain('per_page=50');
    });

    it('sets nextCursor when Link header indicates more pages', async () => {
      // Page 1: full perPage → Link header points to page 2
      const page1Events = Array.from({ length: 30 }, (_, i) => ({
        id: String(i), type: 'PushEvent',
        created_at: '2026-03-27T10:00:00Z',
        payload: {},
        actor: { login: 'worker1' },
      }));
      // Page 2: fewer items than perPage → last page (no more pagination)
      const page2Events = [
        { id: 'p2-1', type: 'PushEvent', created_at: '2026-03-27T11:00:00Z', payload: {}, actor: null },
      ];

      // setQueue: each body is one page's full JSON array (an array of records)
      callTracker.setQueue(
        [page1Events, page2Events],
        [
          '<https://api.github.com/repos/owner/repo/events?per_page=30&page=2>; rel="next"',
          null, // last page — no Link header
        ],
      );

      const result = await new GitHubClient().listRecentActivity('owner', 'repo', 30);

      // Fetched 2 pages; page 2 had fewer than perPage → pagination stops
      expect(callTracker.calls).toHaveLength(2);
      expect(callTracker.calls[0]!.url).toContain('page=1');
      expect(callTracker.calls[1]!.url).toContain('page=2');
      expect(result.events).toHaveLength(31); // 30 + 1
      expect(result.nextCursor).toBeUndefined(); // no more pages
    });
  });

  // ── getCommit ─────────────────────────────────────────────────────────────

  describe('getCommit', () => {
    it('returns GHCommit shape', async () => {
      callTracker.setData({
        sha: 'abc123def',
        commit: {
          message: 'feat: add login flow',
          author: { name: 'Claude', date: '2026-03-27T10:00:00Z' },
        },
      });
      const result = await new GitHubClient().getCommit('owner', 'repo', 'abc123def');
      expect(result).toEqual({
        sha: 'abc123def',
        commit: {
          message: 'feat: add login flow',
          author: { name: 'Claude', date: '2026-03-27T10:00:00Z' },
        },
      });
    });
  });

  // ── getPR ─────────────────────────────────────────────────────────────────

  describe('getPR', () => {
    it('returns GHPullRequest shape', async () => {
      callTracker.setData({
        number: 42, title: 'Add auth', state: 'open',
        merged: false, html_url: 'https://github.com/owner/repo/pull/42',
      });
      const result = await new GitHubClient().getPR('owner', 'repo', 42);
      expect(result).toEqual({
        number: 42, title: 'Add auth', state: 'open', merged: false,
        url: 'https://github.com/owner/repo/pull/42',
      });
    });
  });

  // ── getCommits ─────────────────────────────────────────────────────────────

  describe('getCommits', () => {
    it('returns GHCommit[] with sha, message, author, date', async () => {
      callTracker.setData([
        { sha: 'aaaa111', commit: { message: 'initial commit', author: { name: 'Claude', date: '2026-03-27T09:00:00Z' } } },
        { sha: 'bbbb222', commit: { message: 'fix: null pointer', author: { name: 'Claude', date: '2026-03-27T11:00:00Z' } } },
      ]);
      const result = await new GitHubClient().getCommits('owner', 'repo', 42);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ sha: 'aaaa111', commit: { message: 'initial commit' } });
      expect(result[1]).toMatchObject({ sha: 'bbbb222', commit: { message: 'fix: null pointer' } });
    });
  });

  // ── getCheckRuns ────────────────────────────────────────────────────────────

  describe('getCheckRuns', () => {
    it('returns GHCheckRun[] for a ref', async () => {
      callTracker.setData({
        check_runs: [
          { id: 1, name: 'Build', status: 'completed', conclusion: 'success', started_at: '2026-03-27T10:00:00Z', completed_at: '2026-03-27T10:02:00Z' },
          { id: 2, name: 'Test Suite', status: 'completed', conclusion: 'failure', started_at: '2026-03-27T10:00:00Z', completed_at: '2026-03-27T10:05:00Z' },
        ],
      });
      const result = await new GitHubClient().getCheckRuns('owner', 'repo', 'abc123');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 1, name: 'Build', conclusion: 'success' });
      expect(result[1]).toMatchObject({ id: 2, name: 'Test Suite', conclusion: 'failure' });
    });
  });

  // ── getReviews ─────────────────────────────────────────────────────────────

  describe('getReviews', () => {
    it('returns GHReview[] for a PR', async () => {
      callTracker.setData([
        { id: 100, user: { login: 'reviewer1' }, state: 'APPROVED', body: 'LGTM!', submitted_at: '2026-03-27T12:00:00Z' },
        { id: 101, user: { login: 'reviewer2' }, state: 'CHANGES_REQUESTED', body: 'fix null check', submitted_at: '2026-03-27T13:00:00Z' },
      ]);
      const result = await new GitHubClient().getReviews('owner', 'repo', 42);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 100, state: 'APPROVED' });
      expect(result[1]).toMatchObject({ id: 101, state: 'CHANGES_REQUESTED' });
    });
  });
});
