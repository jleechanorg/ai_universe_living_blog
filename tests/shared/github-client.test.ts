import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Track Octokit constructor calls at module level ────────────────────────────

const OctokitCalls: Array<{ args: unknown[] }> = [];

const mockOctokitInstance = {
  rest: {
    activity: {
      listRepoEvents: vi.fn(),
    },
    repos: {
      getCommit: vi.fn(),
    },
    pulls: {
      get: vi.fn(),
      listCommits: vi.fn(),
      listReviews: vi.fn(),
    },
    checks: {
      listForRef: vi.fn(),
    },
  },
};

vi.mock('@octokit/rest', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Octokit: vi.fn((...args: any[]) => {
    OctokitCalls.push({ args });
    return mockOctokitInstance;
  }),
}));

// ─── Import after mock ─────────────────────────────────────────────────────────

const { GitHubClient } = await import('../../src/shared/github-client.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockListRepoEventsResponse(events: Array<Record<string, unknown>>) {
  vi.mocked(mockOctokitInstance.rest.activity.listRepoEvents).mockResolvedValue({
    data: events,
  } as unknown as Awaited<ReturnType<typeof mockOctokitInstance.rest.activity.listRepoEvents>>);
}

function mockPullsGet(data: Record<string, unknown>) {
  vi.mocked(mockOctokitInstance.rest.pulls.get).mockResolvedValue({
    data,
  } as unknown as Awaited<ReturnType<typeof mockOctokitInstance.rest.pulls.get>>);
}

function mockListCommitsResponse(commits: Array<Record<string, unknown>>) {
  vi.mocked(mockOctokitInstance.rest.pulls.listCommits).mockResolvedValue({
    data: commits,
  } as unknown as Awaited<ReturnType<typeof mockOctokitInstance.rest.pulls.listCommits>>);
}

function mockListReviewsResponse(reviews: Array<Record<string, unknown>>) {
  vi.mocked(mockOctokitInstance.rest.pulls.listReviews).mockResolvedValue({
    data: reviews,
  } as unknown as Awaited<ReturnType<typeof mockOctokitInstance.rest.pulls.listReviews>>);
}

function mockChecksListForRefResponse(runs: Array<Record<string, unknown>>) {
  vi.mocked(mockOctokitInstance.rest.checks.listForRef).mockResolvedValue({
    data: { check_runs: runs },
  } as unknown as Awaited<ReturnType<typeof mockOctokitInstance.rest.checks.listForRef>>);
}

function mockGetCommitResponse(data: Record<string, unknown>) {
  vi.mocked(mockOctokitInstance.rest.repos.getCommit).mockResolvedValue({
    data,
  } as unknown as Awaited<ReturnType<typeof mockOctokitInstance.rest.repos.getCommit>>);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GitHubClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('uses token in auth if provided', () => {
      OctokitCalls.length = 0;
      // eslint-disable-next-line no-new
      new GitHubClient('my-secret-token');
      expect(OctokitCalls).toHaveLength(1);
      expect(OctokitCalls[0]!.args).toEqual([{ auth: 'my-secret-token' }]);
    });

    it('works without token (public API)', () => {
      OctokitCalls.length = 0;
      // eslint-disable-next-line no-new
      new GitHubClient();
      expect(OctokitCalls).toHaveLength(1);
      expect(OctokitCalls[0]!.args).toEqual([{}]);
    });
  });

  // ── listRecentActivity ───────────────────────────────────────────────────────

  describe('listRecentActivity', () => {
    it('returns formatted events', async () => {
      mockListRepoEventsResponse([
        {
          id: '123',
          type: 'PullRequestEvent',
          created_at: '2026-03-27T10:00:00Z',
          payload: { action: 'opened', number: 42 },
          actor: { login: 'bot-826' },
        },
      ]);

      const client = new GitHubClient();
      const result = await client.listRecentActivity('owner', 'repo');

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

    it('maps paginated response with nextCursor', async () => {
      mockListRepoEventsResponse([
        { id: '456', type: 'PushEvent', created_at: '2026-03-27T09:00:00Z', payload: {}, actor: null },
      ]);

      const client = new GitHubClient();
      const result = await client.listRecentActivity('owner', 'repo', 30);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.id).toBe('456');
    });
  });

  // ── getCommit ───────────────────────────────────────────────────────────────

  describe('getCommit', () => {
    it('returns GHCommit shape', async () => {
      mockGetCommitResponse({
        sha: 'abc123def',
        commit: {
          message: 'feat: add login flow',
          author: { name: 'Claude', date: '2026-03-27T10:00:00Z' },
        },
      });

      const client = new GitHubClient();
      const result = await client.getCommit('owner', 'repo', 'abc123def');

      expect(result).toEqual({
        sha: 'abc123def',
        commit: {
          message: 'feat: add login flow',
          author: { name: 'Claude', date: '2026-03-27T10:00:00Z' },
        },
      });
    });
  });

  // ── getPR ───────────────────────────────────────────────────────────────────

  describe('getPR', () => {
    it('returns GHPullRequest shape', async () => {
      mockPullsGet({
        number: 42,
        title: 'Add authentication',
        state: 'open',
        merged: false,
        html_url: 'https://github.com/owner/repo/pull/42',
      });

      const client = new GitHubClient();
      const result = await client.getPR('owner', 'repo', 42);

      expect(result).toEqual({
        number: 42,
        title: 'Add authentication',
        state: 'open',
        merged: false,
        url: 'https://github.com/owner/repo/pull/42',
      });
    });
  });

  // ── getCommits ─────────────────────────────────────────────────────────────

  describe('getCommits', () => {
    it('returns GHCommit[] with sha, message, author, date', async () => {
      mockListCommitsResponse([
        {
          sha: 'aaaa111',
          commit: {
            message: 'initial commit',
            author: { name: 'Claude', date: '2026-03-27T09:00:00Z' },
          },
        },
        {
          sha: 'bbbb222',
          commit: {
            message: 'fix: null pointer in auth',
            author: { name: 'Claude', date: '2026-03-27T11:00:00Z' },
          },
        },
      ]);

      const client = new GitHubClient();
      const result = await client.getCommits('owner', 'repo', 42);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        sha: 'aaaa111',
        commit: {
          message: 'initial commit',
          author: { name: 'Claude', date: '2026-03-27T09:00:00Z' },
        },
      });
      expect(result[1]).toMatchObject({
        sha: 'bbbb222',
        commit: {
          message: 'fix: null pointer in auth',
          author: { name: 'Claude', date: '2026-03-27T11:00:00Z' },
        },
      });
    });
  });

  // ── getCheckRuns ────────────────────────────────────────────────────────────

  describe('getCheckRuns', () => {
    it('returns check runs for a ref', async () => {
      mockChecksListForRefResponse([
        {
          id: 1,
          name: 'Build',
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-03-27T10:00:00Z',
          completed_at: '2026-03-27T10:02:00Z',
        },
        {
          id: 2,
          name: 'Test Suite',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2026-03-27T10:00:00Z',
          completed_at: '2026-03-27T10:05:00Z',
        },
      ]);

      const client = new GitHubClient();
      const result = await client.getCheckRuns('owner', 'repo', 'abc123');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        name: 'Build',
        status: 'completed',
        conclusion: 'success',
        startedAt: '2026-03-27T10:00:00Z',
        completedAt: '2026-03-27T10:02:00Z',
      });
      expect(result[1]).toMatchObject({
        id: 2,
        name: 'Test Suite',
        status: 'completed',
        conclusion: 'failure',
        startedAt: '2026-03-27T10:00:00Z',
        completedAt: '2026-03-27T10:05:00Z',
      });
    });
  });

  // ── getReviews ─────────────────────────────────────────────────────────────

  describe('getReviews', () => {
    it('returns reviews for a PR', async () => {
      mockListReviewsResponse([
        {
          id: 100,
          user: { login: 'reviewer1' },
          state: 'APPROVED',
          body: 'LGTM!',
          submitted_at: '2026-03-27T12:00:00Z',
        },
        {
          id: 101,
          user: { login: 'reviewer2' },
          state: 'CHANGES_REQUESTED',
          body: 'Please fix the null check',
          submitted_at: '2026-03-27T13:00:00Z',
        },
      ]);

      const client = new GitHubClient();
      const result = await client.getReviews('owner', 'repo', 42);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 100,
        user: { login: 'reviewer1' },
        state: 'APPROVED',
        body: 'LGTM!',
        submittedAt: '2026-03-27T12:00:00Z',
      });
      expect(result[1]).toMatchObject({
        id: 101,
        user: { login: 'reviewer2' },
        state: 'CHANGES_REQUESTED',
        body: 'Please fix the null check',
        submittedAt: '2026-03-27T13:00:00Z',
      });
    });
  });
});
