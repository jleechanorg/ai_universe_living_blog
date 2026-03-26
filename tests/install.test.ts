/**
 * install.test.ts — End-to-end smoke test for install.sh
 *
 * Verifies:
 * 1. install.sh --target=<dir> --blog-only installs dist/blog/server.js
 * 2. The blog MCP server starts and /health returns 200 with {status: "ok"}
 *
 * This is a REAL E2E test — it installs to a temp git repo, runs the real
 * install.sh, spawns the real server, and hits a real HTTP endpoint.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import http from 'http';

const INSTALL_TIMEOUT_MS = 90_000; // install + npm ci can be slow

function exec(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    timeout: INSTALL_TIMEOUT_MS,
    stdio: 'pipe',
    // Ensure git identity is available in any environment
    env: { ...process.env, GIT_AUTHOR_EMAIL: 'test@test.com', GIT_AUTHOR_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test' },
  }).toString();
}

function httpGet(port: number, path = '/health'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('HTTP request timeout')); });
  });
}

describe('install.sh smoke test', () => {
  const TEST_DIR = mkdtempSync(join(tmpdir(), 'install-smoke-test-'));
  let SERVER_PORT = 0; // assigned dynamically

  beforeAll(() => {
    // Create temp directory with git repo + package.json (install.sh requires both)
    // mkdtempSync already creates the directory; just verify it exists
    // Write a placeholder so the initial commit is not empty (avoids "nothing to commit" failure)
    writeFileSync(join(TEST_DIR, 'README.md'), '# test repo\n');
    exec('git init && git config user.email "test@test.com" && git config user.name "Test" && git add . && git commit -m "init"', TEST_DIR);
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'test-target', private: true }));
    exec('git add . && git commit -m "add package.json"', TEST_DIR);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it(
    'installs blog MCP server and /health responds 200 with {status: "ok"}',
    async () => {
      // ── Run install.sh ──────────────────────────────────────────────────────
      // Use import.meta.url to get the repo root so we find install.sh regardless of cwd.
      const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
      const scriptPath = join(repoRoot, 'install.sh');
      expect(existsSync(scriptPath), `install.sh must exist at ${scriptPath}`).toBe(true);

      // Use --source so install.sh copies from the LOCAL built repo instead of cloning from GitHub.
      // This lets the smoke test test the local build (which may differ from main).
      exec(`bash "${scriptPath}" --target="${TEST_DIR}" --source="${repoRoot}" --blog-only`, repoRoot);

      // ── Verify dist/blog/server.js was installed ────────────────────────────
      const installedServer = join(TEST_DIR, 'node_modules', 'ai-universe-living-blog', 'dist', 'blog', 'server.js');
      expect(existsSync(installedServer), `blog server must be installed at ${installedServer}`).toBe(true);

      // ── Find a free port ───────────────────────────────────────────────────
      const { createServer } = await import('net');
      const pickPort = (): Promise<number> =>
        new Promise((resolve) => {
          const s = createServer();
          s.listen(0, () => {
            const addr = s.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            s.close(() => resolve(port));
          });
        });
      SERVER_PORT = await pickPort();

      // ── Spawn blog server ───────────────────────────────────────────────────
      const { spawn } = await import('child_process');
      const server = spawn('node', [installedServer], {
        cwd: TEST_DIR,
        env: { ...process.env, PORT: String(SERVER_PORT) },
        stdio: 'pipe',
      });

      const output: string[] = [];
      server.stdout?.on('data', (d) => { output.push(d.toString()); });
      server.stderr?.on('data', (d) => { output.push(d.toString()); });

      try {
        // ── Wait for server to start (max 5s) ─────────────────────────────────
        const started = await new Promise<boolean>((resolve) => {
          const deadline = Date.now() + 5_000;
          const poll = async () => {
            if (Date.now() > deadline) return resolve(false);
            try {
              const r = await httpGet(SERVER_PORT, '/health');
              if (r.status === 200) return resolve(true);
            } catch { /* not up yet */ }
            setTimeout(poll, 200);
          };
          poll();
        });

        expect(started, `server did not start in 5s — output:\n${output.join('')}`).toBe(true);

        // ── Assert /health returns 200 with {status: "ok"} ────────────────────
        const res = await httpGet(SERVER_PORT, '/health');
        expect(res.status, `Expected 200, got ${res.status}. Body: ${res.body}`).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.status, `Expected status: "ok", got: ${JSON.stringify(body)}`).toBe('ok');
      } finally {
        // ── Kill server ────────────────────────────────────────────────────────
        server.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 500)); // let port release
      }
    },
    INSTALL_TIMEOUT_MS + 15_000,
  );
});
