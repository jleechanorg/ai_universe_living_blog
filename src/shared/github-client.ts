/**
 * GitHub REST Client — REST only, no GraphQL.
 *
 * Shared by both the CLI (prompt provider) and the MCP server's AutoScanner.
 * Wraps @octokit/rest for all GitHub API calls.
 */

import { Octokit } from '@octokit/rest';

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
  state: string;
  merged: boolean;
  url: string;
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

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * List recent public events for a repo.
   * Uses /repos/{owner}/{repo}/events (public endpoint, 300 req/hr unauthed).
   * Authenticated requests get higher rate limits.
   */
  async listRecentActivity(owner: string, repo: string, perPage = 30): Promise<GHActivityPage> {
    const { data } = await this.octokit.rest.activity.listRepoEvents({
      owner,
      repo,
      per_page: perPage,
    });
    const events: GHActivityEvent[] = (data as unknown as Array<Record<string, unknown>>).map((e) => ({
      id: String(e.id),
      type: String(e.type),
      repo: `${owner}/${repo}`,
      createdAt: String(e.created_at ?? ''),
      payload: (e.payload ?? {}) as Record<string, unknown>,
      actor: e.actor
        ? { login: String((e.actor as Record<string, unknown>).login) }
        : undefined,
    }));
    return { events };
  }

  /**
   * Get a single commit by SHA.
   */
  async getCommit(owner: string, repo: string, sha: string): Promise<GHCommit> {
    const { data } = await this.octokit.rest.repos.getCommit({ owner, repo, ref: sha });
    return {
      sha: data.sha,
      commit: {
        message: data.commit.message,
        author: {
          name: data.commit.author?.name ?? '',
          date: data.commit.author?.date ?? '',
        },
      },
    };
  }

  /**
   * Get a single pull request by number.
   */
  async getPR(owner: string, repo: string, prNumber: number): Promise<GHPullRequest> {
    const { data } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    return {
      number: data.number,
      title: data.title,
      state: data.state,
      merged: Boolean(data.merged),
      url: data.html_url,
    };
  }

  /**
   * Get all commits for a PR (used by CLI prompt provider).
   */
  async getCommits(owner: string, repo: string, prNumber: number): Promise<GHCommit[]> {
    const { data } = await this.octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: prNumber,
    });
    return data.map((d) => ({
      sha: d.sha,
      commit: {
        message: d.commit.message,
        author: { name: d.commit.author?.name ?? '', date: d.commit.author?.date ?? '' },
      },
    }));
  }

  /**
   * Get all check runs for a ref (used by CLI prompt provider).
   */
  async getCheckRuns(owner: string, repo: string, ref: string): Promise<GHCheckRun[]> {
    const { data } = await this.octokit.rest.checks.listForRef({
      owner,
      repo,
      ref,
    });
    return data.check_runs.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? null,
    }));
  }

  /**
   * Get all reviews for a PR (used by CLI prompt provider).
   */
  async getReviews(owner: string, repo: string, prNumber: number): Promise<GHReview[]> {
    const { data } = await this.octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });
    return data.map((r) => ({
      id: r.id,
      user: { login: r.user?.login ?? '' },
      state: r.state,
      body: r.body ?? null,
      submittedAt: r.submitted_at ?? null,
    }));
  }
}
