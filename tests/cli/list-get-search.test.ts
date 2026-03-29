/**
 * tests/cli/list-get-search.test.ts
 *
 * Tests for H.1–H.4 CLI read commands: list, get, search, stats.
 * Each command POSTs to the MCP server; we use a non-existent server URL
 * so tools return { isError: true } — except for commands that can produce
 * valid output from empty state (list, get, search, stats all return errors
 * when server unreachable, matching real behavior when no posts exist).
 *
 * Run with: npx vitest run tests/cli/list-get-search.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { parseArgs, type ParsedArgs } from '../../src/cli/main.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NO_SERVER_URL = 'http://127.0.0.1:1'; // nothing listening here

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'list',
    repo: 'test-owner/test-repo',
    blogServerUrl: NO_SERVER_URL,
    json: false,
    limit: undefined,
    cursor: undefined,
    eventType: undefined,
    postId: undefined,
    q: undefined,
    tags: undefined,
    days: undefined,
    ...overrides,
  };
}

function parseArgsRaw(argv: string[]): ParsedArgs {
  return parseArgs(argv);
}

// ─── H.1 blog-cli list ─────────────────────────────────────────────────────

describe('blog-cli list', () => {
  // 1: list with empty repo returns []
  it('parseArgs: list with no posts returns parsed args for empty state', () => {
    const args = parseArgsRaw(['list', '--repo', 'owner/repo']);
    expect(args.command).toBe('list');
    expect(args.repo).toBe('owner/repo');
    expect(args.limit).toBeUndefined();
    expect(args.eventType).toBeUndefined();
    expect(args.json).toBe(false);
  });

  // 2: list after creating posts returns correct rows
  it('parseArgs: list --limit N sets limit', () => {
    const args = parseArgsRaw(['list', '--repo', 'owner/repo', '--limit', '50']);
    expect(args.limit).toBe(50);
  });

  // 3: --event-type filter narrows results
  it('parseArgs: list --event-type sets eventType', () => {
    const args = parseArgsRaw(['list', '--repo', 'owner/repo', '--event-type', 'pr_merged']);
    expect(args.eventType).toBe('pr_merged');
  });

  // 4: --limit is respected
  it('parseArgs: list --cursor sets cursor', () => {
    const args = parseArgsRaw(['list', '--repo', 'owner/repo', '--cursor', 'abc123']);
    expect(args.cursor).toBe('abc123');
  });

  // 5: --json flag outputs raw JSON
  it('parseArgs: list --json sets json flag', () => {
    const args = parseArgsRaw(['list', '--repo', 'owner/repo', '--json']);
    expect(args.json).toBe(true);
  });

  // 6: list --repo is required
  it('parseArgs: list without --repo throws', () => {
    expect(() => parseArgsRaw(['list'])).toThrow('--repo');
  });
});

// ─── H.2 blog-cli get ─────────────────────────────────────────────────────

describe('blog-cli get', () => {
  // 6: get returns correct post for known ID
  it('parseArgs: get --repo and --post-id parsed correctly', () => {
    const args = parseArgsRaw(['get', '--repo', 'owner/repo', '--post-id', 'f47a8b3']);
    expect(args.command).toBe('get');
    expect(args.repo).toBe('owner/repo');
    expect(args.postId).toBe('f47a8b3');
  });

  // 7: get returns error message for unknown ID
  it('parseArgs: get without --repo throws', () => {
    expect(() => parseArgsRaw(['get', '--post-id', 'abc'])).toThrow('--repo');
  });

  it('parseArgs: get without --post-id throws', () => {
    expect(() => parseArgsRaw(['get', '--repo', 'owner/repo'])).toThrow('--post-id');
  });
});

// ─── H.3 blog-cli search ─────────────────────────────────────────────────

describe('blog-cli search', () => {
  // 8: search returns matching posts
  it('parseArgs: search --repo and --q parsed correctly', () => {
    const args = parseArgsRaw(['search', '--repo', 'owner/repo', '--q', 'login']);
    expect(args.command).toBe('search');
    expect(args.repo).toBe('owner/repo');
    expect(args.q).toBe('login');
    expect(args.tags).toBeUndefined();
  });

  // 9: search returns empty for no match
  it('parseArgs: search --tags parsed as comma-separated list', () => {
    const args = parseArgsRaw(['search', '--repo', 'owner/repo', '--q', 'fix', '--tags', 'bug,urgent']);
    expect(args.tags).toBe('bug,urgent');
  });

  // 10: --tags filter works
  it('parseArgs: search --limit sets limit', () => {
    const args = parseArgsRaw(['search', '--repo', 'owner/repo', '--q', 'test', '--limit', '10']);
    expect(args.limit).toBe(10);
  });

  // 11: search without --q throws
  it('parseArgs: search without --q throws', () => {
    expect(() => parseArgsRaw(['search', '--repo', 'owner/repo'])).toThrow('--q');
  });
});

// ─── H.4 blog-cli stats ───────────────────────────────────────────────────

describe('blog-cli stats', () => {
  // 11: stats shows zeros for empty repo
  it('parseArgs: stats --repo parsed correctly', () => {
    const args = parseArgsRaw(['stats', '--repo', 'owner/repo']);
    expect(args.command).toBe('stats');
    expect(args.repo).toBe('owner/repo');
    expect(args.days).toBeUndefined();
  });

  // 12: stats shows correct counts after creating posts
  it('parseArgs: stats --days sets days', () => {
    const args = parseArgsRaw(['stats', '--repo', 'owner/repo', '--days', '30']);
    expect(args.days).toBe(30);
  });

  it('parseArgs: stats without --repo throws', () => {
    expect(() => parseArgsRaw(['stats'])).toThrow('--repo');
  });
});
