/**
 * tests/blog/demo.test.ts — Demo Mode tests
 *
 * Tests for src/blog/demo.ts:
 * - fetchCommits: API call shape
 * - groupIntoSessions: temporal grouping logic (pure function)
 * - generateDemoEntry: output format (pure function)
 * - runDemoMode: end-to-end with real MemoryBlogStorage
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  fetchCommits,
  groupIntoSessions,
  generateDemoEntry,
  runDemoMode,
  SESSION_GAP_HOURS,
  type DemoCommit,
  type DemoSession,
} from '../../src/blog/demo.js';
import { MemoryBlogStorage } from '../../src/blog/storage.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCommit(sha: string, author: string, hoursAgo: number, message = 'fix: something'): DemoCommit {
  const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return { sha, author, date: d.toISOString(), message };
}

const MOCK_GITHUB_COMMITS = [
  { sha: 'abc1234', commit: { author: { name: 'Alice', date: '2026-03-29T10:00:00Z' }, message: 'feat: add widget\n\nBody text' } },
  { sha: 'def5678', commit: { author: { name: 'Alice', date: '2026-03-29T09:00:00Z' }, message: 'fix: typo' } },
];

// ─── fetchCommits ─────────────────────────────────────────────────────────────

describe('fetchCommits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps GitHub API response to DemoCommit[]', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_GITHUB_COMMITS,
    }));

    const commits = await fetchCommits('owner', 'repo', 100);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      sha: 'abc1234', // first 7 chars
      author: 'Alice',
      date: '2026-03-29T10:00:00Z',
      message: 'feat: add widget', // first line only
    });
  });

  it('strips multi-line commit body to first line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [MOCK_GITHUB_COMMITS[0]],
    }));

    const commits = await fetchCommits('owner', 'repo', 100);
    expect(commits[0]!.message).toBe('feat: add widget');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    await expect(fetchCommits('owner', 'repo', 100)).rejects.toThrow('GitHub API error: 404');
  });

  it('sends Authorization header when token provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchCommits('owner', 'repo', 100, 'ghp_test123');
    expect(mockFetch.mock.calls[0]![1].headers['Authorization']).toBe('Bearer ghp_test123');
  });
});

// ─── groupIntoSessions ────────────────────────────────────────────────────────

describe('groupIntoSessions', () => {
  it('returns empty array for empty commits', () => {
    expect(groupIntoSessions([], 'owner/repo')).toEqual([]);
  });

  it('groups a single commit into one session', () => {
    const commits = [makeCommit('abc', 'Alice', 0)];
    const sessions = groupIntoSessions(commits, 'owner/repo');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.commits).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe('demo-001');
  });

  it('groups consecutive commits within SESSION_GAP_HOURS into one session', () => {
    // 3 commits 1 hour apart — all within SESSION_GAP_HOURS
    const commits = [
      makeCommit('c3', 'Alice', 0),
      makeCommit('c2', 'Alice', 1),
      makeCommit('c1', 'Alice', 2),
    ];
    const sessions = groupIntoSessions(commits, 'owner/repo');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.commits).toHaveLength(3);
  });

  it('splits commits separated by more than SESSION_GAP_HOURS', () => {
    // Gap > SESSION_GAP_HOURS between c2 (2h ago) and c1 (8h ago)
    const gap = SESSION_GAP_HOURS + 2;
    const commits = [
      makeCommit('c2', 'Alice', 0),
      makeCommit('c1', 'Alice', gap),
    ];
    const sessions = groupIntoSessions(commits, 'owner/repo');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.sessionId).toBe('demo-001');
    expect(sessions[1]!.sessionId).toBe('demo-002');
  });

  it('uses custom session prefix', () => {
    const commits = [makeCommit('abc', 'Alice', 0)];
    const sessions = groupIntoSessions(commits, 'owner/repo', 'ao-');
    expect(sessions[0]!.sessionId).toBe('ao-001');
  });

  it('attaches repoKey to each session', () => {
    const commits = [makeCommit('abc', 'Alice', 0)];
    const sessions = groupIntoSessions(commits, 'myorg/myrepo');
    expect(sessions[0]!.repoKey).toBe('myorg/myrepo');
  });
});

// ─── generateDemoEntry ────────────────────────────────────────────────────────

describe('generateDemoEntry', () => {
  const session: DemoSession = {
    sessionId: 'demo-001',
    repoKey: 'owner/repo',
    commits: [
      { sha: 'abc1234', author: 'Alice', date: '2026-03-29T10:00:00Z', message: 'feat: add widget' },
      { sha: 'def5678', author: 'Bob', date: '2026-03-29T09:00:00Z', message: 'fix: typo' },
    ],
  };

  it('includes session ID in output', () => {
    expect(generateDemoEntry(session)).toContain('demo-001');
  });

  it('includes repo key', () => {
    expect(generateDemoEntry(session)).toContain('owner/repo');
  });

  it('includes commit SHAs and messages', () => {
    const entry = generateDemoEntry(session);
    expect(entry).toContain('abc1234');
    expect(entry).toContain('feat: add widget');
  });

  it('lists both authors', () => {
    const entry = generateDemoEntry(session);
    expect(entry).toContain('Alice');
    expect(entry).toContain('Bob');
  });

  it('includes commit count', () => {
    expect(generateDemoEntry(session)).toContain('2 commits');
  });
});

// ─── runDemoMode — integration with real MemoryBlogStorage ───────────────────

describe('runDemoMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates posts in storage for each session', async () => {
    // Mock GitHub API to return 3 commits in 2 sessions
    const gap = SESSION_GAP_HOURS + 2;
    const now = new Date();
    const mockCommits = [
      { sha: 'aaa0000', commit: { author: { name: 'Alice', date: now.toISOString() }, message: 'feat: latest' } },
      { sha: 'bbb1111', commit: { author: { name: 'Alice', date: new Date(now.getTime() - gap * 3600000).toISOString() }, message: 'fix: older' } },
      { sha: 'ccc2222', commit: { author: { name: 'Alice', date: new Date(now.getTime() - (gap + 1) * 3600000).toISOString() }, message: 'chore: oldest' } },
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCommits,
    }));

    const storage = new MemoryBlogStorage();
    const created = await runDemoMode(storage, { repo: 'owner/repo', sessionPrefix: 'demo-' });

    // Should have 2 sessions: [aaa] and [bbb, ccc]
    expect(created).toBe(2);
    const page = await storage.listPosts({ repoKey: 'owner/repo', limit: 10 });
    expect(page.posts).toHaveLength(2);
  });

  it('throws on invalid repo format', async () => {
    const storage = new MemoryBlogStorage();
    await expect(runDemoMode(storage, { repo: 'invalid' })).rejects.toThrow('Invalid repo format');
  });

  it('propagates GitHub API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));

    const storage = new MemoryBlogStorage();
    await expect(runDemoMode(storage, { repo: 'owner/repo' })).rejects.toThrow('GitHub API error: 401');
  });

  it('creates posts with novel_branch_entry eventType', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { sha: 'aaa0000', commit: { author: { name: 'Alice', date: new Date().toISOString() }, message: 'feat: test' } },
      ],
    }));

    const storage = new MemoryBlogStorage();
    await runDemoMode(storage, { repo: 'owner/repo' });

    const page = await storage.listPosts({ repoKey: 'owner/repo', limit: 10 });
    expect(page.posts[0]!.eventType).toBe('novel_branch_entry');
  });
});
