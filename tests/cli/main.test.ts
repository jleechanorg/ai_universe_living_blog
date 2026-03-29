/**
 * tests/cli/main.test.ts — Tests for src/cli/main.ts
 *
 * Tests:
 * - parseArgs: command routing + validation for all commands
 * - parseKvArgs: low-level kv parser
 * - getEffectiveConfig: env var resolution
 * - runConfigCommand: --show / --init behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, parseKvArgs, getEffectiveConfig, runConfigCommand, runBranchEntryCommand } from '../../src/cli/main.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── parseKvArgs ──────────────────────────────────────────────────────────────

describe('parseKvArgs', () => {
  it('parses --key=value form', () => {
    const r = parseKvArgs(['--repo=owner/repo', '--session=ao-832']);
    expect(r['repo']).toBe('owner/repo');
    expect(r['session']).toBe('ao-832');
  });

  it('parses --key value (space-separated) form', () => {
    const r = parseKvArgs(['--repo', 'owner/repo']);
    expect(r['repo']).toBe('owner/repo');
  });

  it('parses boolean flags (no value)', () => {
    const r = parseKvArgs(['--auto-scan', '--show']);
    expect(r['auto-scan']).toBe(true);
    expect(r['show']).toBe(true);
  });

  it('handles value containing = in --key=value form', () => {
    const r = parseKvArgs(['--url=http://localhost:8081/mcp?foo=bar']);
    expect(r['url']).toBe('http://localhost:8081/mcp?foo=bar');
  });

  it('returns empty object for empty args', () => {
    expect(parseKvArgs([])).toEqual({});
  });
});

// ─── parseArgs: branch-entry ─────────────────────────────────────────────────

describe('parseArgs: branch-entry', () => {
  it('parses required --session --pr --repo', () => {
    const result = parseArgs(['branch-entry', '--session', 'ao-832', '--pr', '42', '--repo', 'owner/repo']);
    expect(result.command).toBe('branch-entry');
    expect(result.session).toBe('ao-832');
    expect(result.pr).toBe('42');
    expect(result.repo).toBe('owner/repo');
  });

  it('parses --pr=42 equals form', () => {
    const result = parseArgs(['branch-entry', '--session=ao-832', '--pr=42', '--repo=owner/repo']);
    expect(result.pr).toBe('42');
  });

  it('parses optional --sha flag', () => {
    const result = parseArgs(['branch-entry', '--session=ao-832', '--pr=42', '--repo=owner/repo', '--sha=abc1234']);
    expect(result.sha).toBe('abc1234');
  });

  it('parses optional --output flag', () => {
    const result = parseArgs(['branch-entry', '--session=ao-832', '--pr=42', '--repo=owner/repo', '--output=both']);
    expect(result.output).toBe('both');
  });

  it('throws on missing --session', () => {
    expect(() => parseArgs(['branch-entry', '--pr=42', '--repo=owner/repo'])).toThrow('--session');
  });

  it('throws on missing --pr', () => {
    expect(() => parseArgs(['branch-entry', '--session=ao-832', '--repo=owner/repo'])).toThrow('--pr');
  });

  it('throws on missing --repo', () => {
    expect(() => parseArgs(['branch-entry', '--session=ao-832', '--pr=42'])).toThrow('--repo');
  });

  it('sets default output=file when not specified', () => {
    const result = parseArgs(['branch-entry', '--session=ao-832', '--pr=42', '--repo=owner/repo']);
    expect(result.output).toBe('file');
  });
});

// ─── parseArgs: daily-summary ─────────────────────────────────────────────────

describe('parseArgs: daily-summary', () => {
  it('parses required --repo', () => {
    const result = parseArgs(['daily-summary', '--repo=owner/repo']);
    expect(result.command).toBe('daily-summary');
    expect(result.repo).toBe('owner/repo');
  });

  it('parses optional --date', () => {
    const result = parseArgs(['daily-summary', '--repo=owner/repo', '--date=2026-03-27']);
    expect(result.date).toBe('2026-03-27');
  });

  it('parses optional --session', () => {
    const result = parseArgs(['daily-summary', '--repo=owner/repo', '--session=ao-827']);
    expect(result.session).toBe('ao-827');
  });

  it('throws on missing --repo', () => {
    expect(() => parseArgs(['daily-summary'])).toThrow('--repo');
  });
});

// ─── parseArgs: chat ─────────────────────────────────────────────────────────

describe('parseArgs: chat', () => {
  it('parses --worker --message --repo', () => {
    const result = parseArgs(['chat', '--worker=ao-832', '--message=hello', '--repo=owner/repo']);
    expect(result.command).toBe('chat');
    expect(result.worker).toBe('ao-832');
    expect(result.message).toBe('hello');
    expect(result.repo).toBe('owner/repo');
  });

  it('throws on missing --worker', () => {
    expect(() => parseArgs(['chat', '--message=hi', '--repo=owner/repo'])).toThrow('--worker');
  });

  it('throws on missing --message', () => {
    expect(() => parseArgs(['chat', '--worker=ao-832', '--repo=owner/repo'])).toThrow('--message');
  });

  it('throws on missing --repo', () => {
    expect(() => parseArgs(['chat', '--worker=ao-832', '--message=hi'])).toThrow('--repo');
  });
});

// ─── parseArgs: config ───────────────────────────────────────────────────────

describe('parseArgs: config', () => {
  it('parses config --show', () => {
    const result = parseArgs(['config', '--show']);
    expect(result.command).toBe('config');
    expect(result.show).toBe(true);
  });

  it('parses config --init', () => {
    const result = parseArgs(['config', '--init']);
    expect(result.command).toBe('config');
    expect(result.init).toBe(true);
  });
});

// ─── parseArgs: unknown command ───────────────────────────────────────────────

describe('parseArgs: unknown command', () => {
  it('throws with usage hint for unknown command', () => {
    expect(() => parseArgs(['foobar'])).toThrow('Unknown command');
  });

  it('throws with usage hint for empty args', () => {
    expect(() => parseArgs([])).toThrow('Usage');
  });
});

// ─── parseArgs: env var BLOG_SERVER_URL ──────────────────────────────────────

describe('parseArgs: env var overrides', () => {
  const origEnv = process.env['BLOG_SERVER_URL'];

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env['BLOG_SERVER_URL'] = origEnv;
    } else {
      delete process.env['BLOG_SERVER_URL'];
    }
  });

  it('uses BLOG_SERVER_URL env var as default mcpUrl', () => {
    process.env['BLOG_SERVER_URL'] = 'http://foo:9999';
    const result = parseArgs(['chat', '--worker=ao-832', '--message=hi', '--repo=owner/repo']);
    expect(result.blogServerUrl).toBe('http://foo:9999');
  });

  it('--mcp-url CLI flag overrides BLOG_SERVER_URL', () => {
    process.env['BLOG_SERVER_URL'] = 'http://foo:9999';
    const result = parseArgs(['chat', '--worker=ao-832', '--message=hi', '--repo=owner/repo', '--mcp-url=http://bar:8080']);
    expect(result.blogServerUrl).toBe('http://bar:8080');
  });
});

// ─── getEffectiveConfig ──────────────────────────────────────────────────────

describe('getEffectiveConfig', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of ['BLOG_SERVER_URL', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENCLAW_INFERENCE_URL', 'NOVEL_WORKERS_DIR']) {
      if (origEnv[key] !== undefined) {
        process.env[key] = origEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns defaults when env vars not set', () => {
    delete process.env['BLOG_SERVER_URL'];
    delete process.env['GITHUB_TOKEN'];
    const cfg = getEffectiveConfig();
    expect(cfg.blogServerUrl).toBe('http://localhost:8888');
    expect(cfg.githubToken).toBeUndefined();
  });

  it('reads GITHUB_TOKEN from env', () => {
    process.env['GITHUB_TOKEN'] = 'ghp_test123';
    const cfg = getEffectiveConfig();
    expect(cfg.githubToken).toBe('ghp_test123');
  });

  it('reads BLOG_SERVER_URL from env', () => {
    process.env['BLOG_SERVER_URL'] = 'http://custom:9000';
    const cfg = getEffectiveConfig();
    expect(cfg.blogServerUrl).toBe('http://custom:9000');
  });
});

// ─── runConfigCommand ────────────────────────────────────────────────────────

describe('runConfigCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cli-config-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--init creates novel.config.json in configDir', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    runConfigCommand({ command: 'config', init: true, show: false, blogServerUrl: 'http://localhost:8081' }, tmpDir);
    consoleSpy.mockRestore();

    expect(existsSync(join(tmpDir, 'novel.config.json'))).toBe(true);
    const content = JSON.parse(readFileSync(join(tmpDir, 'novel.config.json'), 'utf8'));
    expect(content).toHaveProperty('storyVoice');
  });

  it('--init does not overwrite existing config', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Create first
    runConfigCommand({ command: 'config', init: true, show: false, blogServerUrl: 'http://localhost:8081' }, tmpDir);
    // Overwrite the file with custom content
    const customContent = '{"custom": true}';
    writeFileSync(join(tmpDir, 'novel.config.json'), customContent, 'utf8');
    // Call again — should not overwrite
    runConfigCommand({ command: 'config', init: true, show: false, blogServerUrl: 'http://localhost:8081' }, tmpDir);
    consoleSpy.mockRestore();

    const content = readFileSync(join(tmpDir, 'novel.config.json'), 'utf8');
    expect(content).toBe(customContent);
  });

  it('--show prints config as JSON', () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
    runConfigCommand({ command: 'config', show: true, init: false, blogServerUrl: 'http://localhost:8081' });
    consoleSpy.mockRestore();

    expect(logs.length).toBeGreaterThan(0);
    const combined = logs.join('');
    const parsed = JSON.parse(combined);
    expect(parsed).toHaveProperty('blogServerUrl');
  });
});

// ─── runBranchEntryCommand: output modes ─────────────────────────────────────
// These tests use vi.stubGlobal('fetch') to intercept ALL fetch calls — both
// the GitHub API calls inside GitHubClient and the MCP POST in output=both mode.
// GitHub API responses are matched by URL path prefix.

const MOCK_PR = {
  number: 42, title: 'Test PR', body: 'body', state: 'open',
  merged: false, html_url: 'https://github.com/o/r/pull/42',
  head: { ref: 'feat/x', sha: 'abc123' },
  user: { login: 'alice' },
};

function makeFetchMock(opts: { mcpFail?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('api.github.com')) {
      // GitHub API — return minimal shapes
      if (u.includes('/pulls/') && !u.includes('/commits') && !u.includes('/reviews') && !u.includes('/check-runs')) {
        return { ok: true, headers: new Headers(), json: async () => MOCK_PR };
      }
      // commits, reviews, check-runs — return empty list
      return { ok: true, headers: new Headers(), json: async () => [] };
    }
    // MCP POST
    if (opts.mcpFail) throw new Error('ECONNREFUSED');
    return {
      ok: true,
      json: async () => ({ result: { content: [{ text: '{"id":"new-post-id"}' }] } }),
    };
  });
}

describe('runBranchEntryCommand: output modes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cli-branch-entry-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('output=none skips writing prompt file', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runBranchEntryCommand({
      command: 'branch-entry',
      session: 'ao-test',
      pr: '42',
      repo: 'owner/repo',
      output: 'none',
      outputDir: tmpDir,
      blogServerUrl: 'http://localhost:8081',
    });
    consoleSpy.mockRestore();
    expect(existsSync(join(tmpDir, 'ao-test.md'))).toBe(false);
  });

  it('output=file writes prompt file, does not POST to MCP', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runBranchEntryCommand({
      command: 'branch-entry',
      session: 'ao-test',
      pr: '42',
      repo: 'owner/repo',
      output: 'file',
      outputDir: tmpDir,
      blogServerUrl: 'http://localhost:8081',
    });
    consoleSpy.mockRestore();

    expect(existsSync(join(tmpDir, 'ao-test.md'))).toBe(true);
    // No localhost call (only GitHub API calls)
    const mcpCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('localhost'));
    expect(mcpCalls).toHaveLength(0);
  });

  it('output=both writes file AND posts to MCP server', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runBranchEntryCommand({
      command: 'branch-entry',
      session: 'ao-test',
      pr: '42',
      repo: 'owner/repo',
      output: 'both',
      outputDir: tmpDir,
      blogServerUrl: 'http://localhost:8081',
    });
    consoleSpy.mockRestore();

    expect(existsSync(join(tmpDir, 'ao-test.md'))).toBe(true);
    // MCP POST called
    const mcpCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('localhost'));
    expect(mcpCalls).toHaveLength(1);
    const callBody = JSON.parse(mcpCalls[0][1].body as string);
    expect(callBody.params.arguments.eventType).toBe('novel_branch_entry');
    expect(callBody.params.arguments.repoKey).toBe('owner/repo');
  });

  it('output=both continues gracefully when MCP server is unreachable', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ mcpFail: true }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runBranchEntryCommand({
      command: 'branch-entry',
      session: 'ao-test',
      pr: '42',
      repo: 'owner/repo',
      output: 'both',
      outputDir: tmpDir,
      blogServerUrl: 'http://localhost:8081',
    })).resolves.toBeUndefined(); // does not throw

    expect(existsSync(join(tmpDir, 'ao-test.md'))).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
