import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Call tracker ───────────────────────────────────────────────────────────

/** Records every fetch call so we can inspect arguments after the client runs. */
const callTracker = {
  calls: [] as Array<{ url: string; options?: { headers?: Record<string, string> } }>,
  mockData: null as unknown,
  clear() { this.calls = []; this.mockData = null; },
  setData(d: unknown) { this.mockData = d; },
};

vi.stubGlobal('fetch', async (url: string, options?: { headers?: Record<string, string> }) => {
  callTracker.calls.push({ url, options });
  if (callTracker.mockData === null) {
    throw new Error('No mock data set up for fetch call');
  }
  const data = callTracker.mockData;
  callTracker.mockData = null; // consume one response per call
  return { ok: true, status: 200, json: () => Promise.resolve(data), statusText: 'OK' } as unknown as Response;
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
    it('returns formatted GHActivityEvent[]', async () => {
      callTracker.setData([
        {
          id: '123', type: 'PullRequestEvent',
          created_at: '2026-03-27T10:00:00Z',
          payload: { action: 'opened', number: 42 },
          actor: { login: 'bot-826' },
        },
      ]);
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
    });

    it('passes per_page to the API', async () => {
      callTracker.setData([]);
      await new GitHubClient().listRecentActivity('owner', 'repo', 50);
      expect(callTracker.calls[0]!.url).toContain('per_page=50');
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
