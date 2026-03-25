#!/usr/bin/env node

/**
 * Novel CLI — invoke novel engine operations from the command line.
 *
 * Usage:
 *   npm run dev:novel -- branch-entry --repo owner/repo --session ao-826 --branch feat/foo
 *   npm run dev:novel -- daily-summary --repo owner/repo --session ao-826
 *   npm run dev:novel -- daily-summary --repo owner/repo --session ao-826 --date 2026-03-25
 */

import { MemoryBlogStorage } from '../blog/storage.js';
import { runBranchEntryPipeline, runDailySummaryPipeline, type NovelEngineConfig } from './engine.js';
import type { BranchContext } from './branch-generator.js';

const args = process.argv.slice(2);
const command = args[0];

async function parseKvArgs(kvs: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const kv of kvs) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined) result[k.replace(/^--/, '')] = v;
  }
  return result;
}

async function main() {
  if (command === 'branch-entry') {
    const params = await parseKvArgs(args.slice(1));

    const config: NovelEngineConfig = {
      repoKey: params['repo'] ?? 'jleechanorg/ai_universe_living_blog',
      sessionId: params['session'] ?? 'cli-unknown',
      branchName: params['branch'] ?? 'unknown',
      storage: new MemoryBlogStorage(),
    };

    const context: BranchContext = {
      repoKey: config.repoKey,
      branchName: config.branchName,
      sessionId: config.sessionId,
      eventType: params['event'] ?? 'pr_created',
      prNumber: params['pr'] ? parseInt(params['pr'], 10) : undefined,
      prUrl: params['pr-url'],
      commitSha: params['sha'],
      sessionEvents: [
        { timestamp: new Date().toISOString(), type: 'session_start', message: 'Session spawned' },
        { timestamp: new Date().toISOString(), type: 'work_done', message: 'Work completed' },
      ],
      errors: params['errors'] ? params['errors'].split(',') : [],
    };

    const result = await runBranchEntryPipeline(config, context);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'daily-summary') {
    const params = await parseKvArgs(args.slice(1));

    const config: NovelEngineConfig = {
      repoKey: params['repo'] ?? 'jleechanorg/ai_universe_living_blog',
      sessionId: params['session'] ?? 'cli-daily-summary',
      branchName: 'daily-summary',
      storage: new MemoryBlogStorage(),
    };

    const result = await runDailySummaryPipeline(config, params['date']);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'help') {
    console.log(`Novel CLI

Commands:
  branch-entry --repo=owner/repo --session=ID --branch=name [--pr=N] [--sha=SHA] [--errors=a,b]
    Generate and post a per-branch novel entry to the blog.

  daily-summary --repo=owner/repo --session=ID [--date=YYYY-MM-DD]
    Generate and post the daily community novel summary.
    Requires ≥3 posts for the day. Skips if fewer.

  help
    Show this message.
`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error('Run "npm run dev:novel -- help" for usage.');
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
