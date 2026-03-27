/**
 * Webhook Receiver — POST /webhook handler for GitHub webhook events.
 *
 * Validates HMAC-SHA-256 signature and routes events through the same
 * mapGitHubEventToPostType pipeline as AutoScanner.
 *
 * NOTE: server.ts uses express.json({ verify }) to capture the raw request
 * body bytes before JSON parsing and stores them as req.rawBody. The HMAC
 * is validated against these exact bytes — NOT a re-serialized JSON string.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import type { BlogStorage, Post, PostEventType, RepoKey } from '../shared/types.js';
import type { GitHubClient } from './github-client.js';
import type { RepoRegistry } from './repo-registry.js';
import { mapGitHubEventToPostType } from './scanner.js';

// ─── Extended Request with rawBody ────────────────────────────────────────────

/** Augment Express Request to include the raw bytes preserved before JSON parsing. */
interface RawBodyRequest extends Request {
  rawBody?: string;
}

// ─── X-GitHub-Event normalization ───────────────────────────────────────────────

/**
 * GitHub sends X-GitHub-Event as "pull_request", "check_run", etc.
 * The scanner's mapGitHubEventToPostType expects the API format:
 * "PullRequestEvent", "CheckRunEvent", etc. This function bridges the gap.
 */
function normalizeEventType(raw: string): string {
  const map: Record<string, string> = {
    pull_request: 'PullRequestEvent',
    check_run: 'CheckRunEvent',
    check_suite: 'CheckSuiteEvent',
  };
  return map[raw] ?? raw;
}

// ─── HMAC validation ────────────────────────────────────────────────────────────

function validateHmac(secret: string, rawBody: string, signature: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── Post creation from webhook event ───────────────────────────────────────

async function handleWebhookEvent(
  event: { type: string; id: string; payload: Record<string, unknown> },
  repoKey: string,
  storage: BlogStorage,
): Promise<{ created: boolean; postType?: PostEventType }> {
  const ghEvent = {
    id: event.id,
    type: event.type,
    repo: repoKey,
    createdAt: new Date().toISOString(),
    payload: event.payload,
    actor: undefined as { login: string } | undefined,
  };

  const postType = mapGitHubEventToPostType(ghEvent);
  if (!postType) return { created: false };

  const payload = event.payload;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const prNumber = typeof pr?.number === 'number' ? pr.number : undefined;
  const prUrl = typeof pr?.html_url === 'string' ? pr.html_url : undefined;
  const branchName = typeof payload.ref === 'string'
    ? String(payload.ref).replace('refs/heads/', '')
    : undefined;
  const actorLogin = 'github-webhook';
  const actorName = 'GitHub Webhook';

  const threadId = uuidv4();
  await storage.getOrCreatePoster({ id: actorLogin, name: actorName, type: 'ao_worker' });
  await storage.createThread({
    id: threadId,
    repoKey: repoKey as RepoKey,
    posterId: actorLogin,
    title: `${postType}: ${prNumber ? `PR #${prNumber}` : event.type}`,
    postCount: 0,
    latestPostAt: ghEvent.createdAt,
    status: 'open',
    prNumber,
    prUrl,
    createdAt: ghEvent.createdAt,
  });

  const post: Post = {
    id: uuidv4(),
    repoKey: repoKey as RepoKey,
    threadId,
    posterId: actorLogin,
    title: `${postType}: ${prNumber ? `PR #${prNumber}` : event.type}`,
    content: JSON.stringify(event.payload, null, 2),
    eventType: postType,
    tags: [event.type, 'webhook'],
    status: 'published',
    createdAt: ghEvent.createdAt,
    updatedAt: ghEvent.createdAt,
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
  logger.info('webhook: created post', { repoKey, postType, eventId: event.id });
  return { created: true, postType };
}

// ─── Handler factory ───────────────────────────────────────────────────────────

export function createWebhookHandler(
  registry: RepoRegistry,
  storage: BlogStorage,
  _github: GitHubClient,
  _dataDir: string,
  webhookSecret?: string,
): (req: RawBodyRequest, res: Response) => Promise<void> {
  return async (req: RawBodyRequest, res: Response): Promise<void> => {
    // Use req.rawBody (captured by express.json verify callback before parsing)
    // to validate HMAC against GitHub's exact signed bytes.
    const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const signature = req.get('X-Hub-Signature-256') ?? '';
    const deliveryId = req.get('X-GitHub-Delivery') ?? uuidv4();
    const eventType = req.get('X-GitHub-Event') ?? '';

    // Silently acknowledge ping events
    if (eventType === 'ping') {
      res.json({ ok: true, deliveryId, message: 'pong' });
      return;
    }

    // Parse payload — req.body may already be parsed or a raw string
    let payload: Record<string, unknown>;
    try {
      payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    // Extract repo from payload
    const repoObj = payload.repository as Record<string, unknown> | undefined;
    const repo =
      typeof repoObj?.full_name === 'string'
        ? repoObj.full_name
        : typeof repoObj?.name === 'string'
          ? repoObj.name
          : '';

    if (!repo) {
      res.status(400).json({ error: 'Could not determine repo from payload' });
      return;
    }

    // Look up webhook secret
    const repoConfig = registry.get(repo);
    const secret = repoConfig?.webhookSecret ?? webhookSecret ?? '';

    // Validate HMAC — reject if a secret is configured but no signature was sent
    if (secret) {
      if (!signature) {
        logger.warn('webhook: missing signature header', { repo, deliveryId });
        res.status(400).json({ error: 'Missing X-Hub-Signature-256 header' });
        return;
      }
      if (!validateHmac(secret, rawBody, signature)) {
        logger.warn('webhook: invalid HMAC', { repo, deliveryId });
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Route event — normalize X-GitHub-Event (e.g. "pull_request") to the
    // GitHub API event type format (e.g. "PullRequestEvent") that
    // mapGitHubEventToPostType expects.
    const eventId = deliveryId;
    const result = await handleWebhookEvent(
      { type: normalizeEventType(eventType), id: eventId, payload },
      repo,
      storage,
    );

    if (result.created) {
      res.json({ ok: true, deliveryId, postType: result.postType });
    } else {
      // Acknowledge unsupported events without error
      res.json({ ok: true, deliveryId, note: `Event type '${eventType}' not supported` });
    }
  };
}
