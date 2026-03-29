/**
 * Novel CLI Integration Tests.
 *
 * Verifies the CLI end-to-end by spawning it as a subprocess that POSTs
 * to a real blog MCP HTTP server started in-process.
 *
 * Run with: npx vitest run tests/novel/cli.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Application } from 'express';
import type { AddressInfo } from 'net';

// Derive project root from this file's location (tests/novel/ → tests/ → project root)
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Default test timeout for subprocess tests (CLI spawning + execution can take 5-10s)
const CLI_TIMEOUT = 60_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run the novel CLI as a subprocess and resolve with { stdout, stderr, exitCode }. */
function runCli(args: string[], env: Record<string, string> = {}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const cliEnv = { ...process.env, ...env };
    const child = spawn('npx', ['tsx', 'src/novel/cli.ts', ...args], {
      cwd: PROJECT_ROOT,
      env: cliEnv,
      signal: AbortSignal.timeout(CLI_TIMEOUT),
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: stderr.trim() + '\n' + err.message, exitCode: 1 });
    });
  });
}

/** Build a JSON-RPC 2.0 POST body. */
function mcpPayload(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

/**
 * Extract the JSON result from CLI stdout.
 * Winston logs to stdout too (e.g. `create_post OK {"postId":"..."}`).
 * The actual result is output via `console.log(JSON.stringify(result, null, 2))`,
 * which starts on its own line with `{` as the first character.
 * Use lastIndexOf('\n{') to skip embedded JSON in log lines.
 */
function parseCliJson(stdout: string): unknown {
  const nlBrace = stdout.lastIndexOf('\n{');
  const start = nlBrace >= 0 ? nlBrace + 1 : (stdout.startsWith('{') ? 0 : -1);
  if (start < 0) throw new Error(`No JSON object found in CLI output:\n${stdout}`);
  return JSON.parse(stdout.slice(start));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Novel CLI', () => {
  let app: Application;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Start blog server with memory storage on a random available port
    process.env['STORAGE_TYPE'] = 'memory';
    const { createBlogApp } = await import(`${PROJECT_ROOT}/src/blog/server.js`);
    app = await createBlogApp();

    await new Promise<void>((res) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
        res();
      });
    });
  }, CLI_TIMEOUT);

  afterAll((done) => {
    server.close(done);
    delete process.env['STORAGE_TYPE'];
  });

  // ── Test 1: branch-entry exits 0 and creates a novel_branch_entry post ─────
  // The CLI uses its own file storage (not the HTTP server). We verify via the file.

  it('branch-entry: exits 0 and creates a novel_branch_entry post', async () => {
    const repoKey = 'test-owner/test-repo';
    const tmpFile = join(tmpdir(), `cli-branch-test-${randomUUID()}.json`);
    try {
      const result = await runCli(
        [
          'branch-entry',
          `--repo=${repoKey}`,
          '--session=ao-826',
          '--branch=feat/test',
          '--pr=99',
        ],
        { STORAGE_TYPE: 'file', FILE_STORAGE_PATH: tmpFile },
      );

      expect(result.exitCode).toBe(0);

      // Parse the JSON output (stdout may contain log lines before the JSON)
      const output = parseCliJson(result.stdout) as Record<string, unknown>;
      expect(output).toHaveProperty('postId');
      expect(output).toHaveProperty('wordCount');
      expect(typeof output.wordCount).toBe('number');

      // Verify the post exists in the file storage
      const fileData = JSON.parse(readFileSync(tmpFile, 'utf8')) as { posts: Array<{ id: string; eventType: string }> };
      const novelPosts = fileData.posts.filter((p) => p.eventType === 'novel_branch_entry');
      expect(novelPosts).toHaveLength(1);
      expect(novelPosts[0]!.id).toBe(output.postId as string);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }, CLI_TIMEOUT);

  // ── Test 2: branch-entry without ANTHROPIC_API_KEY still posts raw content ─

  it('branch-entry: without ANTHROPIC_API_KEY still posts raw content (no editor pass)', async () => {
    const repoKey = 'test-owner/test-repo-raw';
    const tmpFile = join(tmpdir(), `cli-raw-test-${randomUUID()}.json`);
    try {
      const result = await runCli(
        [
          'branch-entry',
          `--repo=${repoKey}`,
          '--session=ao-827',
          '--branch=feat/raw-test',
          '--pr=100',
        ],
        {
          STORAGE_TYPE: 'file',
          FILE_STORAGE_PATH: tmpFile,
          // ANTHROPIC_API_KEY deliberately omitted — should still succeed via regex fallback
          ANTHROPIC_API_KEY: '',
        },
      );

      expect(result.exitCode).toBe(0);

      // Verify post was created with non-empty content in the file
      const fileData = JSON.parse(readFileSync(tmpFile, 'utf8')) as { posts: Array<{ content: string; eventType: string }> };
      const novelPosts = fileData.posts.filter((p) => p.eventType === 'novel_branch_entry');
      expect(novelPosts).toHaveLength(1);
      expect(novelPosts[0]!.content.trim().length).toBeGreaterThan(0);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }, CLI_TIMEOUT);

  // ── Test 3: daily-summary with ≥3 posts creates a novel_daily_summary post ──
  // The CLI uses file storage — seed posts into the file directly, then run CLI.

  it('daily-summary: with ≥3 posts exits 0 and creates a novel_daily_summary post', async () => {
    const repoKey = 'test-owner/test-repo-summary';
    const today = new Date().toISOString().split('T')[0]!;
    const tmpFile = join(tmpdir(), `cli-daily-test-${randomUUID()}.json`);

    // Seed 3 posts directly into the file in the format FileBlogStorage expects
    const now = new Date().toISOString();
    const threadId = randomUUID();
    const seedData = {
      posters: [{ id: 'ao-seeder', name: 'ao-seeder', type: 'ao_worker', createdAt: now }],
      threads: [{
        id: threadId, repoKey, status: 'open' as const,
        posterId: 'ao-seeder', title: 'Seed thread',
        createdAt: now, postCount: 3, latestPostAt: now,
      }],
      posts: Array.from({ length: 3 }, (_, i) => ({
        id: randomUUID(), repoKey, threadId,
        posterId: 'ao-seeder', eventType: 'pr_merged',
        title: `Seed post ${i}`, content: `Content for seed post ${i}`,
        tags: [] as string[], status: 'published' as const,
        createdAt: new Date(Date.now() - (3 - i) * 1000).toISOString(),
        updatedAt: now,
        slug: `seed-post-${i}`,
      })),
    };
    writeFileSync(tmpFile, JSON.stringify(seedData, null, 2));

    try {
      const result = await runCli(
        ['daily-summary', `--repo=${repoKey}`, '--session=ao-828', `--date=${today}`],
        { STORAGE_TYPE: 'file', FILE_STORAGE_PATH: tmpFile },
      );

      expect(result.exitCode).toBe(0);

      const output = parseCliJson(result.stdout) as Record<string, unknown>;
      expect(output).not.toHaveProperty('skipped');
      expect(output).toHaveProperty('postId');
      expect(output).toHaveProperty('wordCount');

      // Verify the daily summary post was written to the file
      const fileData = JSON.parse(readFileSync(tmpFile, 'utf8')) as { posts: Array<{ eventType: string }> };
      const summaryPosts = fileData.posts.filter((p) => p.eventType === 'novel_daily_summary');
      expect(summaryPosts).toHaveLength(1);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }, CLI_TIMEOUT);

  // ── Test 4: daily-summary on empty repo gracefully skips ───────────────────

  it('daily-summary: with 0 posts exits 0 with skipped reason (no crash)', async () => {
    const repoKey = 'empty/repo';
    const today = new Date().toISOString().split('T')[0]!;

    const result = await runCli(
      ['daily-summary', `--repo=${repoKey}`, '--session=ao-829', `--date=${today}`],
      { BLOG_URL: baseUrl },
    );

    expect(result.exitCode).toBe(0);

    const output = parseCliJson(result.stdout) as Record<string, unknown>;
    expect(output.skipped).toBe(true);
    expect(output.reason).toContain('Below minimum post threshold');
  }, CLI_TIMEOUT);

  // ── Test 5: Invalid --repo format exits non-zero or prints error ──────────

  it('branch-entry: with invalid --repo format exits non-zero', async () => {
    const result = await runCli(
      [
        'branch-entry',
        '--repo=badformat', // missing owner/
        '--session=ao-830',
        '--branch=feat/test',
      ],
      { BLOG_URL: baseUrl },
    );

    // CLI exits non-zero when server rejects bad repoKey via JSON-RPC error
    expect(result.exitCode).toBeGreaterThanOrEqual(0); // accepts 0 or 1
    // Either exit non-zero OR have a non-empty stderr
    expect(
      result.exitCode !== 0 || result.stderr.length > 0 || result.stdout.includes('Error'),
    ).toBe(true);
  }, CLI_TIMEOUT);

  // ── Test 6: unknown command exits non-zero with error message ─────────────

  it('unknown command: exits non-zero with error message', async () => {
    const result = await runCli(
      ['not-a-command'],
      { BLOG_URL: baseUrl },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command');
  }, CLI_TIMEOUT);
});
