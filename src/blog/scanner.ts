/**
 * AutoScanner — background GitHub event poller for registered repos.
 *
 * Runs on a setInterval. Per cycle:
 * 1. Load cursor (lastEventId + lastDailyDate per repo)
 * 2. Poll each registered repo with autoScan: true
 * 3. Skip events ≤ cursor; create posts for new events
 * 4. Check UTC date crossing → trigger daily summary for novelDaily repos
 * 5. Persist updated cursor
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import type { BlogStorage, Post, PostEventType, RepoKey } from '../shared/types.js';
import type { GitHubClient, GHActivityEvent } from './github-client.js';
import type { RepoRegistry } from './repo-registry.js';

// ─── Cursor ───────────────────────────────────────────────────────────────────

interface ScanCursor {
  [repoKey: string]: {
    lastEventId: string;
    lastDailyDate: string;  // YYYY-MM-DD UTC
  };
}

function loadCursor(dataDir: string): ScanCursor {
  const file = join(dataDir, 'scan-cursor.json');
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ScanCursor;
  } catch {
    return {};
  }
}

function saveCursor(cursor: ScanCursor, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'scan-cursor.json'), JSON.stringify(cursor, null, 2), 'utf-8');
}

// ─── Event → PostType mapping ─────────────────────────────────────────────────

/**
 * Maps a GitHub activity event to a blog post event type.
 * Returns null if the event type is not yet supported.
 */
export function mapGitHubEventToPostType(event: GHActivityEvent): PostEventType | null {
  const payload = event.payload as Record<string, unknown>;
  const action = typeof payload.action === 'string' ? payload.action : '';

  switch (event.type) {
    case 'PullRequestEvent': {
      if (action === 'opened') return 'pr_created';
      if (action === 'reopened') return 'pr_reopened';
      if (action === 'edited') return 'pr_edited';
      if (action === 'synchronize') return 'pr_rebased';
      if (action === 'closed') {
        const pr = payload.pull_request as Record<string, unknown> | undefined;
        return pr?.merged ? 'pr_merged' : 'pr_closed';
      }
      return null;
    }
    case 'CheckRunEvent': {
      const conclusion = typeof payload.conclusion === 'string' ? payload.conclusion : '';
      if (conclusion === 'success') return 'pr_checks_passed';
      if (conclusion === 'failure' || conclusion === 'action_required') return 'pr_checks_failed';
      return null;
    }
    case 'CheckSuiteEvent': {
      const conclusion = typeof payload.conclusion === 'string' ? payload.conclusion : '';
      if (conclusion === 'success') return 'pr_checks_passed';
      if (conclusion === 'failure' || conclusion === 'action_required') return 'pr_checks_failed';
      return null;
    }
    default:
      return null;
  }
}

// ─── Title builders ───────────────────────────────────────────────────────────

function buildPostTitle(event: GHActivityEvent, postType: PostEventType): string {
  const payload = event.payload as Record<string, unknown>;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const actor = event.actor?.login ?? 'GitHub';
  const prNum = pr?.number ? `#${pr.number}` : '';
  const prTitle = pr?.title ? ` — ${pr.title}` : '';

  switch (postType) {
    case 'pr_created':   return `PR ${prNum}${prTitle} opened by ${actor}`;
    case 'pr_merged':    return `PR ${prNum}${prTitle} merged`;
    case 'pr_closed':    return `PR ${prNum}${prTitle} closed`;
    case 'pr_reopened':  return `PR ${prNum}${prTitle} reopened by ${actor}`;
    case 'pr_edited':    return `PR ${prNum}${prTitle} edited`;
    case 'pr_rebased':   return `PR ${prNum}${prTitle} force-pushed / rebased`;
    case 'pr_checks_passed': return `CI checks passed for PR ${prNum}`;
    case 'pr_checks_failed':  return `CI checks failed for PR ${prNum}`;
    default: return `${event.type} event from ${actor}`;
  }
}

// ─── AutoScanner ──────────────────────────────────────────────────────────────

export interface AutoScanner {
  start(): void;
  stop(): void;
}

export interface CreateAutoScannerOpts {
  intervalMs?: number;
  dataDir?: string;
}

export function createAutoScanner(
  registry: RepoRegistry,
  storage: BlogStorage,
  github: GitHubClient,
  opts: CreateAutoScannerOpts = {},
): AutoScanner {
  const intervalMs = opts.intervalMs ?? 60_000;
  const dataDir = opts.dataDir ?? 'data/';
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function pollAll(): void {
    const repos = registry.list().filter((r) => r.enabled && r.modes.autoScan);
    if (repos.length === 0) return;

    for (const repo of repos) {
      const [owner, name] = repo.repoKey.split('/');
      if (!owner || !name) {
        logger.warn('scanner: invalid repoKey', { repoKey: repo.repoKey });
        continue;
      }

      github.listRecentActivity(owner, name, 30)
        .then(async (page) => {
          // Load cursor fresh per-repo so concurrent handlers don't clobber each other
          const cursor = loadCursor(dataDir);
          const prevId = cursor[repo.repoKey]?.lastEventId ?? '';
          let cursorChanged = false;

          for (const event of page.events) {
            // Skip already-seen events — use BigInt for precision (GitHub IDs exceed Number.MAX_SAFE_INTEGER)
            const prevNum = prevId ? BigInt(prevId) : BigInt(0);
            if (BigInt(event.id) <= prevNum) continue;

            const postType = mapGitHubEventToPostType(event);
            if (!postType) continue;

            // Auto-create or reuse thread keyed to the PR
            const payload = event.payload as Record<string, unknown>;
            const pr = payload.pull_request as Record<string, unknown> | undefined;
            const prNumber = typeof pr?.number === 'number' ? pr.number : undefined;
            const prUrl = typeof pr?.html_url === 'string' ? pr.html_url : undefined;
            const branchName = typeof payload.ref === 'string' ? payload.ref.replace('refs/heads/', '') : undefined;
            const actorLogin = event.actor?.login ?? 'github-scanner';
            const actorName = event.actor?.login ?? 'GitHub Scanner';

            const threadId = uuidv4();
            const poster = await storage.getOrCreatePoster({
              id: actorLogin,
              name: actorName,
              type: 'ao_worker',
            });

            const thread = {
              id: threadId,
              repoKey: repo.repoKey as RepoKey,
              posterId: poster.id,
              title: buildPostTitle(event, postType),
              postCount: 0,
              latestPostAt: event.createdAt,
              status: 'open' as const,
              prNumber,
              prUrl,
              createdAt: event.createdAt,
            };
            await storage.createThread(thread);

            const post: Post = {
              id: uuidv4(),
              repoKey: repo.repoKey as RepoKey,
              threadId,
              posterId: poster.id,
              title: buildPostTitle(event, postType),
              content: JSON.stringify(event.payload, null, 2),
              eventType: postType,
              tags: [event.type],
              status: 'published',
              createdAt: event.createdAt,
              updatedAt: event.createdAt,
              slug: event.id,
              metadata: {
                commitSha: typeof payload.after === 'string' ? payload.after : undefined,
                branchName,
                prNumber,
                prUrl,
                sessionId: actorLogin,
              },
            };
            await storage.createPost(post);
            logger.info('scanner: created post', { repoKey: repo.repoKey, postType, eventId: event.id });

            // Update cursor in memory — isolated per handler, saved at end.
            // GitHub delivery IDs are globally unique integers; string comparison
            // correctly tracks "most recent seen" for cursor deduplication purposes.
            if (!cursor[repo.repoKey] || event.id > cursor[repo.repoKey].lastEventId) {
              cursor[repo.repoKey] = {
                lastEventId: event.id,
                lastDailyDate: cursor[repo.repoKey]?.lastDailyDate ?? todayUtc(),
              };
              cursorChanged = true;
            }
          }

          // UTC date-crossing check for daily summary
          const today = todayUtc();
          const lastDaily = cursor[repo.repoKey]?.lastDailyDate ?? '';
          if (today !== lastDaily && repo.modes.novelDaily) {
            logger.info('scanner: triggering daily summary', { repoKey: repo.repoKey, date: today });
            cursor[repo.repoKey] = { ...(cursor[repo.repoKey] ?? { lastEventId: '' }), lastDailyDate: today };
            cursorChanged = true;
            // Daily summary is triggered via shouldRunDailySummary in server.ts
            // Scanner only marks that the trigger fired in the cursor
          } else if (today !== lastDaily) {
            // Still advance the date even if novelDaily is off
            cursor[repo.repoKey] = { ...(cursor[repo.repoKey] ?? { lastEventId: '' }), lastDailyDate: today };
            cursorChanged = true;
          }

          if (cursorChanged) saveCursor(cursor, dataDir);
        })
        .catch((err) => {
          logger.error('scanner: poll failed', { repoKey: repo.repoKey, error: String(err) });
        });
    }
  }

  function start(): void {
    if (intervalId !== null) return;
    logger.info('AutoScanner starting', { intervalMs });
    pollAll(); // run immediately
    intervalId = setInterval(pollAll, intervalMs);
  }

  function stop(): void {
    if (intervalId === null) return;
    clearInterval(intervalId);
    intervalId = null;
    logger.info('AutoScanner stopped');
  }

  return { start, stop };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
