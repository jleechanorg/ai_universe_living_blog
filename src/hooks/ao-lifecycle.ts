/**
 * AO Lifecycle Hook — Novel Branch Entry Trigger
 *
 * Listens for AO PR lifecycle events and invokes the novel branch-entry CLI
 * for trigger events (pr_opened, pr_reopened, pr_merged, pr_closed).
 *
 * Used by:
 * - GitHub Actions workflow (`.github/workflows/novel-entry.yml`) which calls
 *   `npm run start:novel -- branch-entry ...` with --event=<type> set from
 *   the PR action (opened→pr_opened, reopened→pr_reopened, merged→pr_merged,
 *   closed(not merged)→pr_closed)
 * - Direct Node.js usage for local testing / custom AO lifecycle dispatchers
 *
 * Architecture: the hook is a library function, not a CLI entrypoint. The
 * handlePrEvent() function can be imported and called with a mock runCli for
 * unit testing.
 */

import { spawn } from 'node:child_process';
import { NOVEL_TRIGGER_EVENT_TYPES, type PrEvent } from './event-schema.js';

/** Set for O(1) membership check — avoids readonly-array narrowing issues */
const NOVEL_TRIGGER_EVENT_SET = new Set(NOVEL_TRIGGER_EVENT_TYPES);

export { type PrEvent, type PrEventType } from './event-schema.js';

/**
 * Signature of the CLI runner — extracted so it can be mocked in tests.
 * Receives an argv array so no string-parsing is needed in the default runner.
 */
export type RunCliFn = (argv: string[]) => Promise<void>;

/**
 * Default CLI runner: spawns `tsx src/novel/cli.ts` as a child process.
 * Writes stdout/stderr to the parent process streams so CI logs are visible.
 */
export async function defaultRunCli(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/novel/cli.ts', ...argv], {
      stdio: 'inherit',
      env: { ...process.env },
    });
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
 * Build the argv array for a branch-entry invocation.
 *
 * @example
 * buildArgv({ type: 'pr_opened', repo: 'owner/repo', pr: 42, session: 'ao-826', branch: 'feat/x' })
 * // → ['branch-entry', '--repo=owner/repo', '--session=ao-826', '--branch=feat/x', '--pr=42']
 */
export function buildArgv(event: PrEvent, eventType?: string): string[] {
  return [
    'branch-entry',
    `--repo=${event.repo}`,
    `--session=${event.session}`,
    `--branch=${event.branch}`,
    `--pr=${event.pr}`,
    ...(eventType ? [`--event=${eventType}`] : []),
  ];
}

/**
 * Handle a PR lifecycle event.
 *
 * Calls `runCli` with the `branch-entry` argv when the event type is one of:
 * `pr_opened`, `pr_reopened`, `pr_merged`, `pr_closed`.
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
  const argv = buildArgv(event);
  await runCli(argv);
}
