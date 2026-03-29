/**
 * tests/cli/daily-summary.test.ts
 *
 * Tests for runDailySummaryCommand in src/cli/main.ts.
 * Uses a non-existent server URL for most tests (fetchPostsFromMcp catches errors gracefully).
 *
 * Run with: npx vitest run tests/cli/daily-summary.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { runDailySummaryCommand } from '../../src/cli/main.js';
import type { ParsedArgs } from '../../src/cli/main.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().split('T')[0]!;
const NO_SERVER_URL = 'http://127.0.0.1:1'; // nothing listening here

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'daily-summary',
    repo: 'test-owner/daily-test',
    date: TODAY,
    session: 'test-daily',
    blogServerUrl: NO_SERVER_URL,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runDailySummaryCommand', () => {
  // 1
  it('skips when MCP server unreachable (0 posts)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    await runDailySummaryCommand(makeArgs());

    vi.restoreAllMocks();
    const output = JSON.parse(logs[0] ?? '{}');
    expect(output.skipped).toBe(true);
    expect(output.date).toBe(TODAY);
  });

  // 2
  it('throws when --repo is missing', async () => {
    await expect(
      runDailySummaryCommand(makeArgs({ repo: undefined })),
    ).rejects.toThrow('--repo');
  });

  // 3
  it('uses today as default date when --date not provided', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    await runDailySummaryCommand(makeArgs({ date: undefined }));

    vi.restoreAllMocks();
    const output = JSON.parse(logs[0] ?? '{}');
    expect(output.date).toBe(TODAY);
  });

  // 4
  it('returns skipped:true for past date with no posts', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    await runDailySummaryCommand(makeArgs({ date: '2020-01-01' }));

    vi.restoreAllMocks();
    const output = JSON.parse(logs[0] ?? '{}');
    expect(output.skipped).toBe(true);
    expect(output.reason).toContain('posts');
  });

  // 5
  it('includes date and reason in skipped output', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    await runDailySummaryCommand(makeArgs({ date: '2024-06-15' }));

    vi.restoreAllMocks();
    const output = JSON.parse(logs[0] ?? '{}');
    expect(output.skipped).toBe(true);
    expect(output.date).toBe('2024-06-15');
    expect(typeof output.reason).toBe('string');
  });
});
