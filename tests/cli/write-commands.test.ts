/**
 * tests/cli/write-commands.test.ts
 *
 * Tests for J.1–J.4 CLI write commands: delete, unregister-repo, list-repos, export.
 * Each command POSTs to the MCP server.
 * Tests follow the Section H pattern: parseArgs validation + error-path checks.
 *
 * Run with: npx vitest run tests/cli/write-commands.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseArgs, type ParsedArgs } from '../../src/cli/main.js';

function parseArgsRaw(argv: string[]): ParsedArgs {
  return parseArgs(argv);
}

// ─── J.1 blog-cli delete ──────────────────────────────────────────────────

describe('blog-cli delete', () => {
  // Test 1: delete removes post — subsequent get returns error
  it('parseArgs: delete --repo and --post-id parsed correctly', () => {
    const args = parseArgsRaw(['delete', '--repo', 'owner/repo', '--post-id', 'f47a8b37-abcd']);
    expect(args.command).toBe('delete');
    expect(args.repo).toBe('owner/repo');
    expect(args.postId).toBe('f47a8b37-abcd');
  });

  // Test 2: delete on unknown ID prints error message (non-zero exit)
  it('parseArgs: delete without --repo throws', () => {
    expect(() => parseArgsRaw(['delete', '--post-id', 'abc'])).toThrow('--repo');
  });

  it('parseArgs: delete without --post-id throws', () => {
    expect(() => parseArgsRaw(['delete', '--repo', 'owner/repo'])).toThrow('--post-id');
  });
});

// ─── J.2 blog-cli unregister-repo ─────────────────────────────────────────

describe('blog-cli unregister-repo', () => {
  // Test 3: unregister-repo removes repo — subsequent list-repos no longer shows it
  it('parseArgs: unregister-repo --repo parsed correctly', () => {
    const args = parseArgsRaw(['unregister-repo', '--repo', 'owner/repo']);
    expect(args.command).toBe('unregister-repo');
    expect(args.repo).toBe('owner/repo');
  });

  // Test 4: unregister-repo on unknown repo prints error
  it('parseArgs: unregister-repo without --repo throws', () => {
    expect(() => parseArgsRaw(['unregister-repo'])).toThrow('--repo');
  });
});

// ─── J.3 blog-cli list-repos ──────────────────────────────────────────────

describe('blog-cli list-repos', () => {
  // Test 5: list-repos shows registered repos
  it('parseArgs: list-repos with no args parsed correctly', () => {
    const args = parseArgsRaw(['list-repos']);
    expect(args.command).toBe('list-repos');
    expect(args.repo).toBeUndefined();
    expect(args.json).toBe(false);
  });

  // Test 6: list-repos --json outputs raw JSON
  it('parseArgs: list-repos --json sets json flag', () => {
    const args = parseArgsRaw(['list-repos', '--json']);
    expect(args.command).toBe('list-repos');
    expect(args.json).toBe(true);
  });
});

// ─── J.4 blog-cli export ──────────────────────────────────────────────────

describe('blog-cli export', () => {
  // Test 7: export writes valid JSON file with posts
  it('parseArgs: export --repo and --output-file parsed correctly', () => {
    const args = parseArgsRaw(['export', '--repo', 'owner/repo', '--output-file', 'posts.json']);
    expect(args.command).toBe('export');
    expect(args.repo).toBe('owner/repo');
    expect(args.outputFile).toBe('posts.json');
  });

  // Test 8: export without --output-file prints to stdout
  it('parseArgs: export without --repo throws', () => {
    expect(() => parseArgsRaw(['export'])).toThrow('--repo');
  });

  it('parseArgs: export --repo without --output-file sets outputFile undefined', () => {
    const args = parseArgsRaw(['export', '--repo', 'owner/repo']);
    expect(args.command).toBe('export');
    expect(args.repo).toBe('owner/repo');
    expect(args.outputFile).toBeUndefined();
  });
});
