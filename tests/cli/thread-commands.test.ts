/**
 * tests/cli/thread-commands.test.ts
 *
 * Tests for K.1–K.3 CLI thread/list commands: list-threads, get-thread, update-post.
 * Tests follow the Section J pattern (write-commands.test.ts): parseArgs validation + error-path checks.
 *
 * Run with: npx vitest run tests/cli/thread-commands.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseArgs, type ParsedArgs } from '../../src/cli/main.js';

function parseArgsRaw(argv: string[]): ParsedArgs {
  return parseArgs(argv);
}

// ─── K.1 blog-cli list-threads ─────────────────────────────────────────────

describe('blog-cli list-threads', () => {
  // Test 1: list-threads --repo and defaults parsed correctly
  it('parseArgs: list-threads --repo and defaults parsed correctly', () => {
    const args = parseArgsRaw(['list-threads', '--repo', 'owner/repo']);
    expect(args.command).toBe('list-threads');
    expect(args.repo).toBe('owner/repo');
    expect(args.limit).toBeUndefined();
    expect(args.cursor).toBeUndefined();
    expect(args.json).toBe(false);
  });

  // Test 2: list-threads --json sets json flag
  it('parseArgs: list-threads --json sets json flag', () => {
    const args = parseArgsRaw(['list-threads', '--repo', 'owner/repo', '--json']);
    expect(args.command).toBe('list-threads');
    expect(args.json).toBe(true);
  });

  // Test 3: list-threads without --repo throws
  it('parseArgs: list-threads without --repo throws', () => {
    expect(() => parseArgsRaw(['list-threads'])).toThrow('--repo');
  });
});

// ─── K.2 blog-cli get-thread ───────────────────────────────────────────────

describe('blog-cli get-thread', () => {
  // Test 4: get-thread --repo and --thread-id parsed correctly
  it('parseArgs: get-thread --repo and --thread-id parsed correctly', () => {
    const args = parseArgsRaw(['get-thread', '--repo', 'owner/repo', '--thread-id', 'thread-abc123']);
    expect(args.command).toBe('get-thread');
    expect(args.repo).toBe('owner/repo');
    expect(args.threadId).toBe('thread-abc123');
  });

  // Test 5: get-thread without --repo throws
  it('parseArgs: get-thread without --repo throws', () => {
    expect(() => parseArgsRaw(['get-thread', '--thread-id', 'thread-abc123'])).toThrow('--repo');
  });

  // Test 6: get-thread without --thread-id throws
  it('parseArgs: get-thread without --thread-id throws', () => {
    expect(() => parseArgsRaw(['get-thread', '--repo', 'owner/repo'])).toThrow('--thread-id');
  });
});

// ─── K.3 blog-cli update-post ──────────────────────────────────────────────

describe('blog-cli update-post', () => {
  // Test 7: update-post --repo --post-id --title parsed correctly
  it('parseArgs: update-post --repo --post-id --title parsed correctly', () => {
    const args = parseArgsRaw([
      'update-post',
      '--repo', 'owner/repo',
      '--post-id', 'post-abc123',
      '--title', 'Updated Title',
    ]);
    expect(args.command).toBe('update-post');
    expect(args.repo).toBe('owner/repo');
    expect(args.postId).toBe('post-abc123');
    expect(args.title).toBe('Updated Title');
    expect(args.content).toBeUndefined();
    expect(args.tags).toBeUndefined();
    expect(args.status).toBeUndefined();
  });

  // Test 8: update-post without --repo throws
  it('parseArgs: update-post without --repo throws', () => {
    expect(() => parseArgsRaw(['update-post', '--post-id', 'post-abc123'])).toThrow('--repo');
  });

  // Test 9: update-post without --post-id throws
  it('parseArgs: update-post without --post-id throws', () => {
    expect(() => parseArgsRaw(['update-post', '--repo', 'owner/repo'])).toThrow('--post-id');
  });

  // Test 10: update-post --tags comma-separated parsed as array
  it('parseArgs: update-post --tags comma-separated parsed as array', () => {
    const args = parseArgsRaw([
      'update-post',
      '--repo', 'owner/repo',
      '--post-id', 'post-abc123',
      '--tags', 'tag1,tag2,tag3',
    ]);
    expect(args.command).toBe('update-post');
    expect(args.tags).toBe('tag1,tag2,tag3');
  });
});
