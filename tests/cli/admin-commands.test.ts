/**
 * tests/cli/admin-commands.test.ts
 *
 * Tests for L.1–L.3 CLI admin commands: update-repo, generate-api-key, replay-event.
 * Each command POSTs to the MCP server via tools/update_repo, generate_api_key, replay_event.
 * Tests follow the Section J pattern (write-commands.test.ts): parseArgs validation + error-path checks.
 *
 * Run with: npx vitest run tests/cli/admin-commands.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseArgs, type ParsedArgs } from '../../src/cli/main.js';

function parseArgsRaw(argv: string[]): ParsedArgs {
  return parseArgs(argv);
}

// ─── L.1 blog-cli update-repo ────────────────────────────────────────────────

describe('blog-cli update-repo', () => {
  // Test 1: update-repo --repo --enabled parsed correctly
  it('parseArgs: update-repo --repo --enabled parsed correctly', () => {
    const args = parseArgsRaw(['update-repo', '--repo', 'owner/repo', '--enabled', 'true']);
    expect(args.command).toBe('update-repo');
    expect(args.repo).toBe('owner/repo');
    expect(args.enabled).toBe(true);
  });

  // Test 2: update-repo without --repo throws
  it('parseArgs: update-repo without --repo throws', () => {
    expect(() => parseArgsRaw(['update-repo'])).toThrow('--repo');
  });

  // Test 3: update-repo --auto-scan flag parsed as boolean
  it('parseArgs: update-repo --auto-scan flag parsed as boolean', () => {
    const args = parseArgsRaw(['update-repo', '--repo', 'owner/repo', '--auto-scan', 'true']);
    expect(args.command).toBe('update-repo');
    expect(args.repo).toBe('owner/repo');
    expect(args.autoScan).toBe(true);
  });
});

// ─── L.2 blog-cli generate-api-key ─────────────────────────────────────────

describe('blog-cli generate-api-key', () => {
  // Test 4: generate-api-key --repo parsed correctly
  it('parseArgs: generate-api-key --repo parsed correctly', () => {
    const args = parseArgsRaw(['generate-api-key', '--repo', 'owner/repo']);
    expect(args.command).toBe('generate-api-key');
    expect(args.repo).toBe('owner/repo');
  });

  // Test 5: generate-api-key without --repo throws
  it('parseArgs: generate-api-key without --repo throws', () => {
    expect(() => parseArgsRaw(['generate-api-key'])).toThrow('--repo');
  });
});

// ─── L.3 blog-cli replay-event ─────────────────────────────────────────────

describe('blog-cli replay-event', () => {
  // Test 6: replay-event --repo and --event-type parsed correctly
  it('parseArgs: replay-event --repo and --event-type parsed correctly', () => {
    const args = parseArgsRaw([
      'replay-event',
      '--repo', 'owner/repo',
      '--event-type', 'pr_opened',
    ]);
    expect(args.command).toBe('replay-event');
    expect(args.repo).toBe('owner/repo');
    expect(args.eventType).toBe('pr_opened');
  });

  // Test 7: replay-event --count parsed as number
  it('parseArgs: replay-event --count parsed as number', () => {
    const args = parseArgsRaw([
      'replay-event',
      '--repo', 'owner/repo',
      '--event-type', 'pr_opened',
      '--count', '5',
    ]);
    expect(args.command).toBe('replay-event');
    expect(args.eventType).toBe('pr_opened');
    expect(args.count).toBe(5);
  });

  // Test 8: replay-event without --repo throws
  it('parseArgs: replay-event without --repo throws', () => {
    expect(() => parseArgsRaw(['replay-event', '--event-type', 'pr_opened'])).toThrow('--repo');
  });

  // Test 9: replay-event without --event-type throws
  it('parseArgs: replay-event without --event-type throws', () => {
    expect(() => parseArgsRaw(['replay-event', '--repo', 'owner/repo'])).toThrow('--event-type');
  });
});
