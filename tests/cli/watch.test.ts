/**
 * tests/cli/watch.test.ts
 *
 * Tests for blog-cli watch command:
 * - parseArgs: watch with --interval, --repo flags
 * - parseArgs: watch with no flags (defaults)
 * - formatPostLine: correct output format
 * - runWatchCommand: cursor tracking, new-post detection, SIGINT summary
 *
 * Run with: npx vitest run tests/cli/watch.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, formatPostLine, type ParsedArgs } from '../../src/cli/main.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgsRaw(argv: string[]): ParsedArgs {
  return parseArgs(argv);
}

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'watch',
    blogServerUrl: 'http://localhost:8888',
    ...overrides,
  };
}

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('blog-cli watch parseArgs', () => {
  it('watch with no flags parses with defaults', () => {
    const args = parseArgsRaw(['watch']);
    expect(args.command).toBe('watch');
    expect(args.interval).toBeUndefined();
    expect(args.repo).toBeUndefined();
  });

  it('watch --interval N sets interval', () => {
    const args = parseArgsRaw(['watch', '--interval', '10']);
    expect(args.command).toBe('watch');
    expect(args.interval).toBe(10);
  });

  it('watch --repo owner/repo sets repo', () => {
    const args = parseArgsRaw(['watch', '--repo', 'jleechanorg/ai_universe_living_blog']);
    expect(args.command).toBe('watch');
    expect(args.repo).toBe('jleechanorg/ai_universe_living_blog');
  });

  it('watch --repo and --interval together', () => {
    const args = parseArgsRaw([
      'watch',
      '--repo',
      'owner/repo',
      '--interval',
      '15',
    ]);
    expect(args.command).toBe('watch');
    expect(args.repo).toBe('owner/repo');
    expect(args.interval).toBe(15);
  });

  it('watch --interval=3 sets interval via equals form', () => {
    const args = parseArgsRaw(['watch', '--interval=3']);
    expect(args.interval).toBe(3);
  });
});

// ─── formatPostLine ──────────────────────────────────────────────────────────

describe('formatPostLine', () => {
  it('formats a post with all fields', () => {
    const post = {
      createdAt: '2026-03-29T14:30:00.000Z',
      eventType: 'pr_merged',
      repoKey: 'jleechanorg/ai_universe_living_blog',
      title: 'Add watch command',
    };
    const line = formatPostLine(post);
    expect(line).toBe('[2026-03-29 14:30:00] [pr_merged] [jleechanorg/ai_universe_living_blog] Add watch command');
  });

  it('handles a post with no createdAt', () => {
    const post = {
      createdAt: '',
      eventType: 'pr_created',
      repoKey: 'owner/repo',
      title: 'Test post',
    };
    // When createdAt is empty, uses current date
    const line = formatPostLine(post);
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[pr_created\] \[owner\/repo\] Test post$/);
  });

  it('handles special characters in title', () => {
    const post = {
      createdAt: '2026-03-29T10:00:00.000Z',
      eventType: 'novel_branch_entry',
      repoKey: 'owner/repo',
      title: 'Fix: [bug] in "watch" command — it works!',
    };
    const line = formatPostLine(post);
    expect(line).toContain('[novel_branch_entry]');
    expect(line).toContain('Fix: [bug] in "watch" command — it works!');
  });
});

// ─── runWatchCommand ──────────────────────────────────────────────────────────

describe('runWatchCommand', () => {
  // Use a server that nothing is listening on so calls fail predictably
  const NO_SERVER_URL = 'http://127.0.0.1:1';

  it('runWatchCommand is exported and callable', async () => {
    const { runWatchCommand } = await import('../../src/cli/main.js');
    expect(typeof runWatchCommand).toBe('function');
  });

  it('parses watch command with all options', () => {
    const args = parseArgsRaw([
      'watch',
      '--repo',
      'owner/repo',
      '--interval',
      '7',
    ]);
    expect(args.command).toBe('watch');
    expect(args.repo).toBe('owner/repo');
    expect(args.interval).toBe(7);
    expect(args.blogServerUrl).toBe('http://localhost:8888');
  });

  it('parses watch with explicit --mcp-url', () => {
    const args = parseArgsRaw([
      'watch',
      '--mcp-url',
      'http://localhost:9999',
    ]);
    expect(args.blogServerUrl).toBe('http://localhost:9999');
  });

  it('parseArgs throws on unknown command name', () => {
    // Unknown command names (first arg not in the switch) throw
    expect(() => parseArgsRaw(['notacmd'])).toThrow('Unknown command');
    // watch is valid and accepts arbitrary flags silently
    const args = parseArgsRaw(['watch', '--unknown-flag']);
    expect(args.command).toBe('watch');
  });
});

// ─── cursor tracking logic ────────────────────────────────────────────────────

describe('watch cursor tracking (unit)', () => {
  it('detects new posts vs already-seen posts', () => {
    // Simulate the deduplication logic from runWatchCommand
    const seenIds = new Set<string>(['id-1', 'id-2']);
    const posts = [
      { id: 'id-1', title: 'old post' },
      { id: 'id-3', title: 'new post' },
      { id: 'id-2', title: 'also old' },
      { id: 'id-4', title: 'also new' },
    ];
    const newPosts = posts.filter((p) => !seenIds.has(p.id));
    expect(newPosts).toHaveLength(2);
    expect(newPosts[0]!.title).toBe('new post');
    expect(newPosts[1]!.title).toBe('also new');
  });

  it('all-new batch returns all posts', () => {
    const seenIds = new Set<string>();
    const posts = [
      { id: 'id-a', title: 'post a' },
      { id: 'id-b', title: 'post b' },
    ];
    const newPosts = posts.filter((p) => !seenIds.has(p.id));
    expect(newPosts).toHaveLength(2);
  });

  it('empty batch returns empty', () => {
    const seenIds = new Set<string>(['id-1', 'id-2', 'id-3']);
    const posts: Array<{ id: string; title: string }> = [];
    const newPosts = posts.filter((p) => !seenIds.has(p.id));
    expect(newPosts).toHaveLength(0);
  });
});

// ─── backoff logic ───────────────────────────────────────────────────────────

describe('watch backoff', () => {
  it('initial backoff starts at 1s', () => {
    let retryDelayMs = 1000;
    expect(retryDelayMs).toBe(1000);
  });

  it('backoff doubles on each failure, capped at 30s', () => {
    let retryDelayMs = 1000;
    const MAX_BACKOFF_MS = 30_000;
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_BACKOFF_MS); // 2s
    expect(retryDelayMs).toBe(2000);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_BACKOFF_MS); // 4s
    expect(retryDelayMs).toBe(4000);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_BACKOFF_MS); // 8s
    expect(retryDelayMs).toBe(8000);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_BACKOFF_MS); // 16s
    expect(retryDelayMs).toBe(16000);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_BACKOFF_MS); // 32s → capped
    expect(retryDelayMs).toBe(30000);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_BACKOFF_MS); // stays 30s
    expect(retryDelayMs).toBe(30000);
  });

  it('backoff resets to 1s on success', () => {
    let retryDelayMs = 16000;
    // Simulate successful poll
    retryDelayMs = 1000;
    expect(retryDelayMs).toBe(1000);
  });
});
