/**
 * AO Lifecycle Hook — Novel Branch Entry Trigger
 *
 * Listens for AO PR lifecycle events and invokes the novel branch-entry CLI
 * for trigger events (pr_opened, pr_merged, pr_closed).
 *
 * Used by:
 * - GitHub Actions workflow (`.github/workflows/novel-entry.yml`) as the
 *   `run:` step: `npm run dev:novel -- $(node -e "require('./src/hooks/ao-lifecycle.js').buildCliArgs(...)")`
 * - Direct Node.js invocation for local testing
 *
 * Architecture note: the hook is a library function, not a CLI entrypoint.
 * The GitHub Actions workflow calls `npm run dev:novel -- branch-entry ...`
 * directly. The hook function exists so it can be unit-tested in isolation
 * and imported by other tooling (e.g. a custom AO lifecycle dispatcher).
 */

import { spawn } from 'node:child_process';
import { NOVEL_TRIGGER_EVENT_TYPES, type PrEvent } from './event-schema.js';

/** Set for O(1) membership check — avoids readonly-array narrowing issues */
const NOVEL_TRIGGER_EVENT_SET = new Set(NOVEL_TRIGGER_EVENT_TYPES);

export { type PrEvent, type PrEventType } from './event-schema.js';

/**
 * Signature of the CLI runner — extracted so it can be mocked in tests.
 * Receives the fully-assembled CLI argument string (e.g.
 * `"branch-entry --repo=owner/repo --session=gh-actions-1 --branch=feat/x --pr=42"`).
 */
export type RunCliFn = (cliArgs: string) => Promise<void>;

/**
 * Default CLI runner: spawns `tsx src/novel/cli.ts` as a child process.
 * Writes stdout/stderr to the parent process streams so CI logs are visible.
 */
export async function defaultRunCli(cliArgs: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['tsx', 'src/novel/cli.ts', ...cliArgs.split(' ')],
      {
        stdio: 'inherit',
        env: { ...process.env },
      },
    );
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`novel CLI exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

/**
 * Build the CLI argument string for a branch-entry invocation.
 * Exported so GitHub Actions workflow can call it without importing the full handlePrEvent.
 *
 * @example
 * buildCliArgs({ type: 'pr_opened', repo: 'owner/repo', pr: 42, session: 'ao-826', branch: 'feat/x' })
 * // → 'branch-entry --repo=owner/repo --session=ao-826 --branch=feat/x --pr=42'
 */
export function buildCliArgs(event: PrEvent): string {
  const parts = [
    'branch-entry',
    `--repo=${event.repo}`,
    `--session=${event.session}`,
    `--branch=${event.branch}`,
    `--pr=${event.pr}`,
  ];
  return parts.join(' ');
}

/**
 * Handle a PR lifecycle event.
 *
 * Calls `runCli` with the `branch-entry` command when the event type is one of:
 * `pr_opened`, `pr_merged`, `pr_closed`.
 *
 * Skips (no-op) for all other event types including `pr_review_requested`,
 * `pr_comment`, `pr_reviewed`, etc.
 *
 * @param event - The PR lifecycle event
 * @param runCli - Function to execute the CLI (defaults to `defaultRunCli`).
 *                 Inject a mock in tests to avoid spawning real processes.
 */
export async function handlePrEvent(
  event: PrEvent,
  runCli: RunCliFn = defaultRunCli,
): Promise<void> {
  if (!NOVEL_TRIGGER_EVENT_SET.has(event.type as typeof NOVEL_TRIGGER_EVENT_TYPES[number])) {
    return;
  }
  const cliArgs = buildCliArgs(event);
  await runCli(cliArgs);
}
