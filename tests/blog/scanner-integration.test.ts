/**
 * AutoScanner full poll-cycle integration tests.
 *
 * Tests the end-to-end flow: register repo → scanner polls GitHub → events
 * mapped to post types → posts written to storage. Uses a real MemoryBlogStorage
 * and mocked GitHubClient to produce deterministic event data.
 *
 * Run with: npx vitest run tests/blog/scanner-integration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryBlogStorage } from '../../src/blog/storage.js';
import { RepoRegistry } from '../../src/blog/repo-registry.js';
import { createAutoScanner } from '../../src/blog/scanner.js';
import type { GHActivityEvent } from '../../src/blog/github-client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_REPO = 'test-owner/scanner-repo';

// Event IDs must be numeric strings — scanner uses BigInt(event.id) for cursor deduplication.
let _nextId = 100_000;
function nextId(): string { return String(_nextId++); }

function makeEvent(
  id: string,
  type: string,
  payload: Record<string, unknown>,
): GHActivityEvent {
  return {
    id,
    type,
    repo: TEST_REPO,
    createdAt: new Date().toISOString(),
    payload,
    actor: { login: 'github-scanner' },
  };
}

function prOpenedEvent(prNumber = 10) {
  return makeEvent(nextId(), 'PullRequestEvent', {
    action: 'opened',
    pull_request: {
      number: prNumber,
      title: `Test PR #${prNumber}`,
      merged: false,
      html_url: `https://github.com/${TEST_REPO}/pull/${prNumber}`,
    },
  });
}

function prMergedEvent(prNumber = 10) {
  return makeEvent(nextId(), 'PullRequestEvent', {
    action: 'closed',
    pull_request: {
      number: prNumber,
      title: `Test PR #${prNumber}`,
      merged: true,
      html_url: `https://github.com/${TEST_REPO}/pull/${prNumber}`,
    },
  });
}

function checkPassedEvent() {
  return makeEvent(nextId(), 'CheckRunEvent', { action: 'completed', conclusion: 'success' });
}

/** Flush pending microtasks + setTimeout(fn, 0) callbacks. */
async function flushAsync(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AutoScanner — full poll cycle', () => {
  let storage: MemoryBlogStorage;
  let registry: RepoRegistry;
  let dataDir: string;

  // Minimal GitHubClient mock shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGitHub: any;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'scanner-test-'));
    storage = new MemoryBlogStorage();
    registry = new RepoRegistry(dataDir);

    // Register the test repo with autoScan enabled
    registry.register({
      repoKey: TEST_REPO,
      enabled: true,
      modes: { autoScan: true, novelBranch: false, novelDaily: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Default mock: returns no events
    mockGitHub = {
      listRecentActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: undefined }),
    };
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // 1
  it('poll with no events → no posts created', async () => {
    const scanner = createAutoScanner(registry, storage, mockGitHub, { dataDir });
    scanner.start();
    await flushAsync();
    scanner.stop();

    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(0);
  });

  // 2
  it('PR opened event → post with eventType=pr_created', async () => {
    mockGitHub.listRecentActivity.mockResolvedValue({
      events: [prOpenedEvent()],
      nextCursor: undefined,
    });

    const scanner = createAutoScanner(registry, storage, mockGitHub, { dataDir });
    scanner.start();
    await flushAsync();
    scanner.stop();

    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].eventType).toBe('pr_created');
  });

  // 3
  it('PR merged event → post with eventType=pr_merged', async () => {
    mockGitHub.listRecentActivity.mockResolvedValue({
      events: [prMergedEvent()],
      nextCursor: undefined,
    });

    const scanner = createAutoScanner(registry, storage, mockGitHub, { dataDir });
    scanner.start();
    await flushAsync();
    scanner.stop();

    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].eventType).toBe('pr_merged');
  });

  // 4
  it('check_run success → post with eventType=pr_checks_passed', async () => {
    mockGitHub.listRecentActivity.mockResolvedValue({
      events: [checkPassedEvent()],
      nextCursor: undefined,
    });

    const scanner = createAutoScanner(registry, storage, mockGitHub, { dataDir });
    scanner.start();
    await flushAsync();
    scanner.stop();

    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].eventType).toBe('pr_checks_passed');
  });

  // 5
  it('multiple events in one poll → multiple posts created', async () => {
    mockGitHub.listRecentActivity.mockResolvedValue({
      events: [
        prOpenedEvent(20),
        checkPassedEvent(),
        prMergedEvent(20),
      ],
      nextCursor: undefined,
    });

    const scanner = createAutoScanner(registry, storage, mockGitHub, { dataDir });
    scanner.start();
    await flushAsync();
    scanner.stop();

    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(3);
    const types = result.posts.map((p) => p.eventType).sort();
    expect(types).toEqual(['pr_checks_passed', 'pr_created', 'pr_merged']);
  });

  // 6
  it('cursor deduplication — same event IDs on second poll → no duplicate posts', async () => {
    const events = [prOpenedEvent()];
    mockGitHub.listRecentActivity.mockResolvedValue({ events, nextCursor: undefined });

    const scanner = createAutoScanner(registry, storage, mockGitHub, {
      dataDir,
      intervalMs: 10, // very short interval for testing
    });
    scanner.start();
    await flushAsync(100); // enough for 2+ poll cycles
    scanner.stop();

    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    // Should only have 1 post despite multiple polls (cursor deduplication)
    expect(result.posts).toHaveLength(1);
  });

  // 7
  it('disabled repo → scanner skips it', async () => {
    // Use isolated dataDir so we can register with enabled:false without conflict
    const isolatedDir = mkdtempSync(join(tmpdir(), 'scanner-disabled-'));
    const disabledRegistry = new RepoRegistry(isolatedDir);
    disabledRegistry.register({
      repoKey: TEST_REPO,
      enabled: false,
      modes: { autoScan: true, novelBranch: false, novelDaily: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockGitHub.listRecentActivity.mockResolvedValue({
      events: [prOpenedEvent()],
      nextCursor: undefined,
    });

    const scanner = createAutoScanner(disabledRegistry, storage, mockGitHub, { dataDir: isolatedDir });
    scanner.start();
    await flushAsync();
    scanner.stop();
    rmSync(isolatedDir, { recursive: true, force: true });

    expect(mockGitHub.listRecentActivity).not.toHaveBeenCalled();
    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(0);
  });

  // 8
  it('autoScan=false → scanner skips repo even if enabled', async () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), 'scanner-noscan-'));
    const noScanRegistry = new RepoRegistry(isolatedDir);
    noScanRegistry.register({
      repoKey: TEST_REPO,
      enabled: true,
      modes: { autoScan: false, novelBranch: false, novelDaily: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockGitHub.listRecentActivity.mockResolvedValue({
      events: [prOpenedEvent()],
      nextCursor: undefined,
    });

    const scanner = createAutoScanner(noScanRegistry, storage, mockGitHub, { dataDir: isolatedDir });
    scanner.start();
    await flushAsync();
    scanner.stop();
    rmSync(isolatedDir, { recursive: true, force: true });

    expect(mockGitHub.listRecentActivity).not.toHaveBeenCalled();
  });

  // 9
  it('GitHub API error → scanner logs and continues (no crash)', async () => {
    mockGitHub.listRecentActivity.mockRejectedValue(new Error('GitHub API 503'));

    const scanner = createAutoScanner(registry, storage, mockGitHub, { dataDir });
    // Should not throw
    expect(() => scanner.start()).not.toThrow();
    await flushAsync();
    scanner.stop();

    // No posts created, but no crash
    const result = await storage.listPosts({ repoKey: TEST_REPO as `${string}/${string}`, limit: 50 });
    expect(result.posts).toHaveLength(0);
  });

  // 10
  it('stop() prevents further polling', async () => {
    let callCount = 0;
    mockGitHub.listRecentActivity.mockImplementation(async () => {
      callCount++;
      return { events: [], nextCursor: undefined };
    });

    const scanner = createAutoScanner(registry, storage, mockGitHub, {
      dataDir,
      intervalMs: 10,
    });
    scanner.start();
    await flushAsync(30);
    scanner.stop();
    const countAfterStop = callCount;
    await flushAsync(50); // extra time — no new polls should fire
    expect(callCount).toBe(countAfterStop); // count frozen after stop
  });
});
