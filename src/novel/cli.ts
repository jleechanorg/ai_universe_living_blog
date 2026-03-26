#!/usr/bin/env node

/**
 * Novel CLI — invoke novel engine operations from the command line.
 *
 * Usage:
 *   npm run dev:novel -- branch-entry --repo owner/repo --session ID --branch name
 *   npm run dev:novel -- daily-summary --repo owner/repo --session ID
 *   npm run dev:novel -- branch-entry --repo owner/repo --session ID --branch name --voice agents
 *   npm run dev:novel -- branch-entry --repo owner/repo --session ID --branch name --config ./novel.config.json
 *
 * Options:
 *   --repo=owner/repo     GitHub repo (required unless --config sets defaultRepoKey)
 *   --session=ID          Worker/session identifier (required)
 *   --branch=name          Branch name (required for branch-entry)
 *   --pr=N                PR number (optional)
 *   --sha=SHA              Commit SHA (optional)
 *   --errors=a,b           Comma-separated error messages (optional)
 *   --voice=workers|agents|minimal   Story voice override (default: workers)
 *   --date=YYYY-MM-DD     Date for daily-summary (default: today)
 *   --config=<path>       Load config from JSON file (optional)
 */

import { MemoryBlogStorage } from '../blog/storage.js';
import { runBranchEntryPipeline, runDailySummaryPipeline, type NovelEngineConfig } from './engine.js';
import type { BranchContext } from './branch-generator.js';
import { loadNovelConfig, type NovelConfig } from './config.js';

const args = process.argv.slice(2);
const command = args[0];

function parseKvArgs(kvs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < kvs.length; i++) {
    const kv = kvs[i]!;
    if (!kv.startsWith('--')) continue;
    if (kv.includes('=')) {
      // --key=value
      const [k, ...rest] = kv.split('=');
      if (k) result[k.replace(/^--/, '')] = rest.join('=');
    } else {
      // --key value  (next arg is the value, not a flag)
      const next = kvs[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result[kv.replace(/^--/, '')] = next;
        i++; // skip the value on next iteration
      }
    }
  }
  return result;
}

async function loadConfig(configPath?: string): Promise<NovelConfig> {
  if (configPath) return loadNovelConfig(configPath);
  // Try default locations in order; loadNovelConfig returns DEFAULT on missing file
  return loadNovelConfig('./novel.config.json');
}

async function main() {
  if (command === 'branch-entry') {
    const params = parseKvArgs(args.slice(1));
    const nc = await loadConfig(params['config']);

    const repoKey = params['repo'] ?? nc.defaultRepoKey;
    const sessionId = params['session'];
    const branchName = params['branch'];

    if (!repoKey) {
      console.error('Error: --repo is required (or set defaultRepoKey in config)');
      process.exit(1);
    }
    if (!sessionId) {
      console.error('Error: --session is required');
      process.exit(1);
    }
    if (!branchName) {
      console.error('Error: --branch is required for branch-entry');
      process.exit(1);
    }

    // Apply --voice CLI override to novelConfig
    const novelConfig: NovelConfig = { ...nc };
    if (params['voice']) {
      novelConfig.storyVoice = params['voice'] as NovelConfig['storyVoice'];
    }

    const config: NovelEngineConfig = {
      repoKey: repoKey as NovelEngineConfig['repoKey'],
      sessionId,
      branchName,
      storage: new MemoryBlogStorage(),
      novelConfig,
    };

    const context: BranchContext = {
      repoKey: config.repoKey,
      branchName: config.branchName,
      sessionId: config.sessionId,
      eventType: params['event'] ?? 'pr_created',
      prNumber: (() => {
        if (!params['pr']) return undefined;
        const n = parseInt(params['pr'], 10);
        if (Number.isNaN(n)) {
          console.error(`Error: --pr must be a number, got: ${params['pr']}`);
          process.exit(1);
        }
        return n;
      })(),
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
    const params = parseKvArgs(args.slice(1));
    const nc = await loadConfig(params['config']);

    const repoKey = params['repo'] ?? nc.defaultRepoKey;
    const sessionId = params['session'];

    if (!repoKey) {
      console.error('Error: --repo is required (or set defaultRepoKey in config)');
      process.exit(1);
    }
    if (!sessionId) {
      console.error('Error: --session is required');
      process.exit(1);
    }

    const novelConfig: NovelConfig = { ...nc };
    if (params['voice']) {
      novelConfig.storyVoice = params['voice'] as NovelConfig['storyVoice'];
    }

    const config: NovelEngineConfig = {
      repoKey: repoKey as NovelEngineConfig['repoKey'],
      sessionId,
      branchName: 'daily-summary',
      storage: new MemoryBlogStorage(),
      novelConfig,
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
    Uses --voice to override the story persona (workers | agents | minimal).

  daily-summary --repo=owner/repo --session=ID [--date=YYYY-MM-DD]
    Generate and post the daily community novel summary.
    Posts only if there are ≥minPostsForDailySummary posts for the day (default: 3).
    Configure via --config or novel.config.json.

  help
    Show this message.

Options:
  --repo=owner/repo     GitHub repo in "owner/name" format (required or set in config)
  --session=ID          Worker/session identifier (required)
  --branch=name         Branch name (required for branch-entry)
  --pr=N                PR number
  --sha=SHA             Commit SHA
  --errors=a,b          Comma-separated error messages
  --voice=V             Story voice: workers | agents | minimal (default: workers)
  --date=YYYY-MM-DD     Target date for daily summary (default: today)
  --config=<path>       Load config from a JSON file (see docs/CONFIGURATION.md)

Configuration file example (novel.config.json):
{
  "defaultRepoKey": "myorg/my-repo",
  "storyVoice": "agents",
  "baseDate": "2026-04-01",
  "targetDailySummaryWords": 1200,
  "minPostsForDailySummary": 2
}
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
