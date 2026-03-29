/**
 * demo.ts — Demo Mode for the Blog MCP Server
 *
 * When `--demo` is passed to the blog server, this module:
 * 1. Fetches the last N commits from a GitHub repo via REST API (no token required for public repos)
 * 2. Groups commits into "sessions" based on temporal proximity and author
 * 3. Creates synthetic novel_branch_entry posts for each session
 * 4. Posts them to the in-memory blog storage via the MCP tool handlers
 *
 * Usage:
 *   npm run dev:blog -- --repo owner/repo --demo
 *   npm run dev:blog -- --repo owner/repo --demo --max-commits=50 --session-prefix=demo-
 */

import { v4 as uuidv4 } from 'uuid';
import type { BlogStorage, RepoKey } from '../shared/types.js';
import { logger } from '../shared/logger.js';

function makeSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemoCommit {
  sha: string;
  author: string;
  date: string;     // ISO 8601
  message: string;  // first line only
}

export interface DemoSession {
  sessionId: string;
  commits: DemoCommit[];
  repoKey: string;
}

export interface DemoModeOptions {
  repo: string;           // "owner/repo"
  maxCommits?: number;    // default 100
  sessionPrefix?: string; // default "demo-"
  githubToken?: string;
}

// ─── Commit fetching ──────────────────────────────────────────────────────────

/**
 * Fetch recent commits from GitHub REST API.
 * Uses the public endpoint — no token required for public repos.
 */
export async function fetchCommits(
  owner: string,
  repo: string,
  maxCommits: number,
  token?: string,
): Promise<DemoCommit[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${Math.min(maxCommits, 100)}`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ai-universe-living-blog-demo/1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Array<{
    sha: string;
    commit: {
      author: { name: string; date: string };
      message: string;
    };
  }>;

  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    author: c.commit.author.name,
    date: c.commit.author.date,
    message: c.commit.message.split('\n')[0] ?? c.commit.message,
  }));
}

// ─── Session grouping ─────────────────────────────────────────────────────────

/**
 * Group commits into sessions by temporal gap.
 * Commits within SESSION_GAP_HOURS of each other are in the same session.
 */
export const SESSION_GAP_HOURS = 4;

export function groupIntoSessions(
  commits: DemoCommit[],
  repoKey: string,
  sessionPrefix: string = 'demo-',
): DemoSession[] {
  if (commits.length === 0) return [];

  // Commits are newest-first from GitHub; reverse to oldest-first for grouping
  const sorted = [...commits].reverse();
  const sessions: DemoSession[] = [];
  let current: DemoCommit[] = [sorted[0]!];
  let sessionIndex = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const gapMs = new Date(curr.date).getTime() - new Date(prev.date).getTime();
    const gapHours = gapMs / (1000 * 60 * 60);

    if (gapHours > SESSION_GAP_HOURS) {
      sessions.push({
        sessionId: `${sessionPrefix}${sessionIndex.toString().padStart(3, '0')}`,
        commits: current,
        repoKey,
      });
      sessionIndex++;
      current = [curr];
    } else {
      current.push(curr);
    }
  }

  // flush last
  sessions.push({
    sessionId: `${sessionPrefix}${sessionIndex.toString().padStart(3, '0')}`,
    commits: current,
    repoKey,
  });

  return sessions;
}

// ─── Entry generation ─────────────────────────────────────────────────────────

/**
 * Generate a synthetic branch-entry blog post body for a demo session.
 */
export function generateDemoEntry(session: DemoSession): string {
  const { sessionId, commits, repoKey } = session;
  const authors = [...new Set(commits.map((c) => c.author))].join(', ');
  const dateRange = commits.length > 0
    ? `${commits[0]!.date.slice(0, 10)} — ${commits[commits.length - 1]!.date.slice(0, 10)}`
    : 'unknown';
  const commitList = commits
    .map((c) => `- ${c.sha} — ${c.message}`)
    .join('\n');

  return `# Demo Entry — ${sessionId}

## Session Context
- **Repo:** ${repoKey}
- **Session:** ${sessionId}
- **Authors:** ${authors}
- **Date range:** ${dateRange}
- **Commits:** ${commits.length}

## Commit History
${commitList}

## Narrative
*[Demo mode — synthetic entry generated from git history. No LLM narrative pass.]*

This session captured ${commits.length} commit${commits.length === 1 ? '' : 's'} by ${authors}. The work touched the repository across ${dateRange}.
`;
}

// ─── Main demo runner ─────────────────────────────────────────────────────────

/**
 * Run demo mode: fetch commits, group into sessions, post to storage.
 * Returns the number of posts created.
 */
export async function runDemoMode(
  storage: BlogStorage,
  opts: DemoModeOptions,
): Promise<number> {
  const parts = opts.repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${opts.repo}". Expected "owner/repo" (exactly two non-empty parts).`);
  }
  const [owner, repoName] = parts as [string, string];

  const maxCommits = (Number.isInteger(opts.maxCommits) && (opts.maxCommits ?? 0) > 0)
    ? opts.maxCommits!
    : 100;
  const sessionPrefix = opts.sessionPrefix ?? 'demo-';

  logger.info('Demo mode: fetching commits', { repo: opts.repo, maxCommits });

  let commits: DemoCommit[];
  try {
    commits = await fetchCommits(owner, repoName, maxCommits, opts.githubToken);
  } catch (err) {
    logger.error('Demo mode: failed to fetch commits', { err: String(err) });
    throw err;
  }

  logger.info('Demo mode: grouping commits into sessions', { count: commits.length });
  const sessions = groupIntoSessions(commits, opts.repo, sessionPrefix);

  logger.info('Demo mode: creating posts', { sessions: sessions.length });

  let created = 0;
  const repoKey = opts.repo as RepoKey;
  for (const session of sessions) {
    const content = generateDemoEntry(session);
    const now = new Date().toISOString();
    const title = `Demo Branch Entry — ${session.sessionId}`;
    const threadId = uuidv4();
    // Create thread first so listThreads/getThread return demo entries
    await storage.createThread({
      id: threadId,
      repoKey,
      posterId: session.sessionId,
      title,
      postCount: 1,
      latestPostAt: now,
      status: 'open',
      createdAt: now,
    });
    await storage.createPost({
      id: uuidv4(),
      repoKey,
      threadId,
      posterId: session.sessionId,
      title,
      content,
      eventType: 'novel_branch_entry',
      tags: ['demo', 'auto-generated'],
      status: 'published',
      createdAt: now,
      updatedAt: now,
      slug: makeSlug(title),
      metadata: {
        sessionId: session.sessionId,
      },
    });
    logger.info(`Demo mode: created post for session ${session.sessionId}`);
    created++;
  }

  logger.info(`Demo mode: complete — ${created} posts created`);
  return created;
}
