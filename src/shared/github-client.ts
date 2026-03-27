/**
 * GitHub REST Client — REST only, no GraphQL, no external dependencies.
 *
 * Uses native `fetch` (Node 18+). Shared by both the CLI (prompt provider)
 * and the MCP server's AutoScanner.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GHActivityEvent {
  id: string;
  type: string;
  repo: string;
  createdAt: string;
  payload: Record<string, unknown>;
  actor?: { login: string };
}

export interface GHActivityPage {
  events: GHActivityEvent[];
  /** Populated when there is a next page (Link header present). */
  nextCursor?: string;
}

export interface GHCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

export interface GHPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  url: string;
  author: string;
  headBranch: string;
  /** Latest commit SHA of the head branch. */
  headSha: string;
}

export interface GHCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GHReview {
  id: number;
  user: { login: string };
  state: string;
  body: string | null;
  submittedAt: string | null;
}

// ─── GitHubClient ─────────────────────────────────────────────────────────────

const GH_API = 'https://api.github.com';

interface GhFetchResult<T> {
  data: T;
  /** Extracted from Link header if present (cursor for next page). */
  nextCursor?: string;
}

function parseLinkHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = header.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/);
  return match ? String(match[1]) : undefined;
}

async function ghFetch<T>(path: string, token?: string, timeoutMs = 10_000): Promise<GhFetchResult<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${GH_API}${path}`, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`GitHub API ${res.status} at ${path}: ${text}`);
    }
    const data = await res.json() as T;
    const nextCursor = parseLinkHeader(res.headers?.get('Link') ?? null);
    return { data, nextCursor };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`GitHub API timeout after ${timeoutMs}ms at ${path}`);
    }
    throw err;
  }
}

export class GitHubClient {
  constructor(private readonly token?: string) {}

  /**
   * List recent public events for a repo.
   * Uses /repos/{owner}/{repo}/events (public endpoint, 300 req/hr unauthed).
   * Accumulates all pages and returns nextCursor when a subsequent page exists.
   */
  async listRecentActivity(owner: string, repo: string, perPage = 30): Promise<GHActivityPage> {
    const allEvents: GHActivityEvent[] = [];
    let page = 1;
    let morePages = true;

    while (morePages) {
      const { data, nextCursor } = await ghFetch<Array<Record<string, unknown>>>(
        `/repos/${owner}/${repo}/events?per_page=${perPage}&page=${page}`,
        this.token,
      );

      for (const e of data) {
        allEvents.push({
          id: String(e.id),
          type: String(e.type),
          repo: `${owner}/${repo}`,
          createdAt: String(e.created_at ?? ''),
          payload: ((e.payload as Record<string, unknown>) ?? {}) as Record<string, unknown>,
          actor: e.actor
            ? { login: String((e.actor as Record<string, unknown>).login) }
            : undefined,
        });
      }

      // If fewer results than perPage, this is the last page
      if (data.length < perPage || !nextCursor) {
        morePages = false;
        // No next page — caller can continue from here when ready
        return { events: allEvents, nextCursor: undefined };
      }

      page++;
    }

    // Loop exited via morePages=false without a return (shouldn't happen,
    // but satisfies TypeScript's exhaustive-check); return what we have
    return { events: allEvents, nextCursor: undefined };
  }

  /**
   * Get a single commit by SHA.
   */
  async getCommit(owner: string, repo: string, sha: string): Promise<GHCommit> {
    const { data } = await ghFetch<Record<string, unknown>>(
      `/repos/${owner}/${repo}/commits/${sha}`,
      this.token,
    );

    const commit = data.commit as Record<string, unknown>;
    const author = commit.author as Record<string, unknown>;
    return {
      sha: data.sha as string,
      commit: {
        message: commit.message as string,
        author: {
          name: (author?.name as string) ?? '',
          date: (author?.date as string) ?? '',
        },
      },
    };
  }

  /**
   * Get a single pull request by number.
   */
  async getPR(owner: string, repo: string, prNumber: number): Promise<GHPullRequest> {
    const { data } = await ghFetch<Record<string, unknown>>(
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      this.token,
    );

    return {
      number: data.number as number,
      title: data.title as string,
      body: (data.body as string) ?? '',
      state: data.state as string,
      merged: Boolean(data.merged),
      url: data.html_url as string,
      author: ((data.user as Record<string, unknown>)?.login as string) ?? '',
      headBranch: ((data.head as Record<string, unknown>)?.ref as string) ?? '',
      headSha: ((data.head as Record<string, unknown>)?.sha as string) ?? '',
    };
  }

  /**
   * Get all commits for a PR.
   * Accumulates all pages when results are paginated.
   */
  async getCommits(owner: string, repo: string, prNumber: number): Promise<GHCommit[]> {
    const allCommits: GHCommit[] = [];
    let page = 1;
    let morePages = true;

    while (morePages) {
      const { data, nextCursor } = await ghFetch<Array<Record<string, unknown>>>(
        `/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=100&page=${page}`,
        this.token,
      );

      for (const d of data) {
        const commit = d.commit as Record<string, unknown>;
        const author = commit.author as Record<string, unknown>;
        allCommits.push({
          sha: d.sha as string,
          commit: {
            message: commit.message as string,
            author: {
              name: (author?.name as string) ?? '',
              date: (author?.date as string) ?? '',
            },
          },
        });
      }

      if (data.length < 100 || !nextCursor) {
        morePages = false;
      } else {
        page++;
      }
    }

    return allCommits;
  }

  /**
   * Get all check runs for a ref.
   * Accumulates all pages when results are paginated.
   */
  async getCheckRuns(owner: string, repo: string, ref: string): Promise<GHCheckRun[]> {
    const allRuns: GHCheckRun[] = [];
    let page = 1;
    let morePages = true;

    while (morePages) {
      const { data, nextCursor } = await ghFetch<Record<string, unknown>>(
        `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100&page=${page}`,
        this.token,
      );

      const checkRuns = (data.check_runs as Array<Record<string, unknown>>) ?? [];
      for (const r of checkRuns) {
        allRuns.push({
          id: r.id as number,
          name: r.name as string,
          status: r.status as string,
          conclusion: (r.conclusion as string) ?? null,
          startedAt: (r.started_at as string) ?? null,
          completedAt: (r.completed_at as string) ?? null,
        });
      }

      if (checkRuns.length < 100 || !nextCursor) {
        morePages = false;
      } else {
        page++;
      }
    }

    return allRuns;
  }

  /**
   * Get all reviews for a PR.
   * Accumulates all pages when results are paginated.
   */
  async getReviews(owner: string, repo: string, prNumber: number): Promise<GHReview[]> {
    const allReviews: GHReview[] = [];
    let page = 1;
    let morePages = true;

    while (morePages) {
      const { data, nextCursor } = await ghFetch<Array<Record<string, unknown>>>(
        `/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100&page=${page}`,
        this.token,
      );

      for (const r of data) {
        allReviews.push({
          id: r.id as number,
          user: { login: (r.user as Record<string, unknown>)?.login as string ?? '' },
          state: r.state as string,
          body: (r.body as string) ?? null,
          submittedAt: (r.submitted_at as string) ?? null,
        });
      }

      if (data.length < 100 || !nextCursor) {
        morePages = false;
      } else {
        page++;
      }
    }

    return allReviews;
  }
}
