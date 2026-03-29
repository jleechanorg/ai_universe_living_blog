/**
 * tests/cli/gh-client-integration.test.ts — Phase 3: GitHubClient integration tests
 *
 * Tests GitHubClient using stubbed global fetch (same pattern as
 * tests/shared/github-client.test.ts). Verifies the high-level methods
 * getPR, getCommits, getCheckRuns, getReviews, and listRecentActivity.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ─── Fetch stub ───────────────────────────────────────────────────────────────

const mockQueue: unknown[] = [];
const linkQueue: (string | null)[] = [];

vi.stubGlobal('fetch', async (url: string, opts?: { headers?: Record<string, string> }) => {
  if (mockQueue.length === 0) throw new Error('No mock responses queued');
  const data = mockQueue.shift();
  const linkHeader = linkQueue.shift() ?? null;
  // Track last call's auth header for constructor tests
  lastCallHeaders = opts?.headers ?? {};
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    statusText: 'OK',
    headers: {
      get: (k: string) => (k === 'Link' && linkHeader ? linkHeader : null),
    },
  } as unknown as Response;
});

let lastCallHeaders: Record<string, string> = {};

const { GitHubClient } = await import('../../src/shared/github-client.js');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GitHubClient (integration)', () => {
  beforeEach(() => {
    mockQueue.length = 0;
    linkQueue.length = 0;
    lastCallHeaders = {};
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('getPR: returns GHPullRequest shape', async () => {
    mockQueue.push({
      number: 42,
      title: 'feat: add feature',
      body: 'Description here',
      state: 'open',
      merged: false,
      html_url: 'https://github.com/owner/repo/pull/42',
      user: { login: 'ao-826' },
      head: { ref: 'feat/my-branch', sha: 'abc1234' },
    });
    linkQueue.push(null);

    const client = new GitHubClient('tok123');
    const pr = await client.getPR('owner', 'repo', 42);

    expect(pr.number).toBe(42);
    expect(pr.title).toBe('feat: add feature');
    expect(pr.state).toBe('open');
    expect(pr.merged).toBe(false);
    expect(pr.author).toBe('ao-826');
    expect(pr.headBranch).toBe('feat/my-branch');
    expect(pr.headSha).toBe('abc1234');
  });

  it('getCommits: returns GHCommit[] for a PR', async () => {
    mockQueue.push([
      {
        sha: 'aaa111',
        commit: { message: 'feat: first commit', author: { name: 'bot', date: '2026-03-01T00:00:00Z' } },
      },
      {
        sha: 'bbb222',
        commit: { message: 'fix: second commit', author: { name: 'bot', date: '2026-03-02T00:00:00Z' } },
      },
    ]);
    linkQueue.push(null);

    const client = new GitHubClient();
    const commits = await client.getCommits('owner', 'repo', 42);

    expect(commits).toHaveLength(2);
    expect(commits[0]!.sha).toBe('aaa111');
    expect(commits[0]!.commit.message).toBe('feat: first commit');
    expect(commits[1]!.sha).toBe('bbb222');
  });

  it('getCheckRuns: returns GHCheckRun[] for a ref', async () => {
    mockQueue.push({
      check_runs: [
        { id: 1, name: 'CI', status: 'completed', conclusion: 'success', started_at: '2026-03-01T00:00:00Z', completed_at: '2026-03-01T00:05:00Z' },
        { id: 2, name: 'Lint', status: 'completed', conclusion: 'success', started_at: '2026-03-01T00:00:00Z', completed_at: '2026-03-01T00:02:00Z' },
      ],
    });
    linkQueue.push(null);

    const client = new GitHubClient('tok456');
    const runs = await client.getCheckRuns('owner', 'repo', 'abc1234');

    expect(runs).toHaveLength(2);
    expect(runs[0]!.name).toBe('CI');
    expect(runs[0]!.conclusion).toBe('success');
    expect(runs[1]!.name).toBe('Lint');
  });

  it('getReviews: returns GHReview[] for a PR', async () => {
    mockQueue.push([
      { id: 101, user: { login: 'reviewer1' }, state: 'APPROVED', body: 'LGTM', submitted_at: '2026-03-01T12:00:00Z' },
      { id: 102, user: { login: 'coderabbitai[bot]' }, state: 'CHANGES_REQUESTED', body: 'Fix this', submitted_at: '2026-03-01T11:00:00Z' },
    ]);
    linkQueue.push(null);

    const client = new GitHubClient();
    const reviews = await client.getReviews('owner', 'repo', 42);

    expect(reviews).toHaveLength(2);
    expect(reviews[0]!.state).toBe('APPROVED');
    expect(reviews[0]!.user.login).toBe('reviewer1');
    expect(reviews[1]!.state).toBe('CHANGES_REQUESTED');
  });

  it('listRecentActivity: maps response to GHActivityPage', async () => {
    mockQueue.push([
      { id: '1', type: 'PullRequestEvent', created_at: '2026-03-01T00:00:00Z', payload: { action: 'opened' }, actor: { login: 'ao-826' } },
      { id: '2', type: 'CheckRunEvent', created_at: '2026-03-01T01:00:00Z', payload: { conclusion: 'success' }, actor: { login: 'github-actions[bot]' } },
    ]);
    linkQueue.push(null);

    const client = new GitHubClient('tok789');
    const result = await client.listRecentActivity('owner', 'repo');

    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.type).toBe('PullRequestEvent');
    expect(result.events[0]!.actor?.login).toBe('ao-826');
    expect(result.events[0]!.repo).toBe('owner/repo');
    expect(result.nextCursor).toBeUndefined();
  });

  it('constructor: sets Authorization header when token provided', async () => {
    mockQueue.push({ number: 1, title: 'test', body: '', state: 'open', merged: false, html_url: '', user: { login: 'x' }, head: { ref: 'main', sha: 'abc' } });
    linkQueue.push(null);

    const client = new GitHubClient('my-secret-token');
    await client.getPR('owner', 'repo', 1);

    expect(lastCallHeaders['Authorization']).toBe('Bearer my-secret-token');
  });

  it('constructor: no Authorization header when no token', async () => {
    mockQueue.push({ number: 1, title: 'test', body: '', state: 'open', merged: false, html_url: '', user: { login: 'x' }, head: { ref: 'main', sha: 'abc' } });
    linkQueue.push(null);

    const client = new GitHubClient();
    await client.getPR('owner', 'repo', 1);

    expect(lastCallHeaders['Authorization']).toBeUndefined();
  });
});
