/**
 * tests/cli/tail.test.ts
 *
 * Tests for the blog-cli tail command.
 *
 * Run with: npx vitest run tests/cli/tail.test.ts
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { parseArgs, type ParsedArgs } from '../../src/cli/main.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgsRaw(argv: string[]): ParsedArgs {
  return parseArgs(argv);
}

// Builds a mock fetch Response that callMcpTool can parse correctly.
// callMcpTool calls fetch → parses JSON → extracts result.content[0].text → JSON.parse.
function mockListPostsResponse(posts: Array<Record<string, unknown>>): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ text: JSON.stringify({ posts }) }],
      },
    }),
    { status: 200 },
  );
}

// ─── Parse args ───────────────────────────────────────────────────────────────

describe('blog-cli tail parseArgs', () => {
  it('requires --repo', () => {
    expect(() => parseArgsRaw(['tail'])).toThrow('--repo');
  });

  it('parses --repo', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo']);
    expect(args.command).toBe('tail');
    expect(args.repo).toBe('owner/repo');
  });

  it('defaults interval to 2', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo']);
    expect(args.interval).toBe(2);
  });

  it('parses --interval', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo', '--interval', '5']);
    expect(args.interval).toBe(5);
  });

  it('defaults to 2 for non-numeric --interval', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo', '--interval', 'abc']);
    expect(args.interval).toBe(2);
  });

  it('defaults format to text', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo']);
    expect(args.format).toBe('text');
  });

  it('parses --format=text', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo', '--format', 'text']);
    expect(args.format).toBe('text');
  });

  it('parses --format=json', () => {
    const args = parseArgsRaw(['tail', '--repo', 'owner/repo', '--format', 'json']);
    expect(args.format).toBe('json');
  });

  it('accepts all options together', () => {
    const args = parseArgsRaw([
      'tail',
      '--repo', 'owner/repo',
      '--interval', '10',
      '--format', 'json',
    ]);
    expect(args.command).toBe('tail');
    expect(args.repo).toBe('owner/repo');
    expect(args.interval).toBe(10);
    expect(args.format).toBe('json');
  });
});

// ─── runTailCommand ───────────────────────────────────────────────────────────

describe('blog-cli runTailCommand', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Global fetch spy — intercepts the HTTP call made by callMcpTool
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleLogSpy = vi.spyOn(console, 'log').mockReturnValue();
    consoleErrorSpy = vi.spyOn(console, 'error').mockReturnValue();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('emits network error backoff warning when fetch throws', async () => {
    const { runTailCommand } = await import('../../src/cli/main.js');

    // Simulate a network failure — fetch rejects with a network error
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const args: ParsedArgs = {
      command: 'tail',
      repo: 'test/repo',
      blogServerUrl: 'http://localhost:9999',
      interval: 1, // × 1000 = 1000ms; test waits ~200ms < one interval
      format: 'text',
    };

    // Run long enough for one poll cycle and one backoff retry
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 200));
    const run = runTailCommand(args);
    await Promise.race([run.then(() => {}), timeout]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls.some((call) =>
      String(call[0] ?? '').includes('network error'),
    )).toBe(true);
  });

  it('prints posts in text format', async () => {
    const { runTailCommand } = await import('../../src/cli/main.js');

    fetchSpy.mockResolvedValue(
      mockListPostsResponse([
        {
          id: 'aaaa0000-0000-0000-0000-000000000001',
          createdAt: '2026-03-29T12:00:00.000Z',
          eventType: 'pr_merged',
          title: 'Fix the thing',
        },
      ]),
    );

    const args: ParsedArgs = {
      command: 'tail',
      repo: 'test/repo',
      blogServerUrl: 'http://localhost:9999',
      interval: 1,
      format: 'text',
    };

    // Run long enough for one poll
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 50));
    const run = runTailCommand(args);
    await Promise.race([run.then(() => {}), timeout]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[2026-03-29T12:00:00] [pr_merged] [test/repo] Fix the thing',
    );
  });

  it('prints full post as JSON when format=json', async () => {
    const { runTailCommand } = await import('../../src/cli/main.js');

    fetchSpy.mockResolvedValue(
      mockListPostsResponse([
        {
          id: 'bbbb0000-0000-0000-0000-000000000002',
          createdAt: '2026-03-29T13:00:00.000Z',
          eventType: 'pr_created',
          title: 'New feature PR',
        },
      ]),
    );

    const args: ParsedArgs = {
      command: 'tail',
      repo: 'my/other-repo',
      blogServerUrl: 'http://localhost:9999',
      interval: 1,
      format: 'json',
    };

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 50));
    const run = runTailCommand(args);
    await Promise.race([run.then(() => {}), timeout]);

    const jsonCall = consoleLogSpy.mock.calls.find((call) => {
      try {
        JSON.parse(String(call[0] ?? ''));
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.id).toBe('bbbb0000-0000-0000-0000-000000000002');
    expect(parsed.title).toBe('New feature PR');
  });

  it('skips already-seen posts on subsequent polls (timestamp-based filter)', async () => {
    const { runTailCommand } = await import('../../src/cli/main.js');

    let pollCount = 0;

    fetchSpy.mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) {
        // First poll: one post at T1 (oldest in batch = T1)
        return mockListPostsResponse([
          {
            id: 'cccc0000-0000-0000-0000-000000000003',
            createdAt: '2026-03-29T14:00:00.000Z',
            eventType: 'pr_reviewed',
            title: 'Post at T1',
          },
        ]);
      }
      // Second poll: T2 (newer) + T1 (still in storage list).
      // After poll 1: lastSeen = T1 (oldest from batch).
      // In poll 2: T2 <= T1? No → emit T2; T1 <= T1? Yes → skip T1.
      // Result: T2 printed, T1 skipped.
      return mockListPostsResponse([
        {
          id: 'dddd0000-0000-0000-0000-000000000004',
          createdAt: '2026-03-29T15:00:00.000Z',
          eventType: 'pr_merged',
          title: 'New post at T2',
        },
        {
          id: 'cccc0000-0000-0000-0000-000000000003',
          createdAt: '2026-03-29T14:00:00.000Z',
          eventType: 'pr_reviewed',
          title: 'Post at T1',
        },
      ]);
    });

    const args: ParsedArgs = {
      command: 'tail',
      repo: 'test/repo',
      blogServerUrl: 'http://localhost:9999',
      interval: 0.05, // × 1000 = 50ms interval
      format: 'text',
    };

    // Run for ~120ms — gives 2 polls at 50ms interval
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 120));
    const run = runTailCommand(args);
    await Promise.race([run.then(() => {}), timeout]);

    // Poll 1: T1 printed (all posts in batch emitted), lastSeen = T1 (oldest)
    // Poll 2: T2 printed (T2 > T1), T1 skipped (T1 <= T1 = true)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Post at T1'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('New post at T2'),
    );

    // T1 appears exactly once (skipped on poll 2 since T1 <= lastSeen(T1))
    const t1Calls = consoleLogSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('Post at T1'),
    );
    expect(t1Calls.length).toBe(1);
  });
});
