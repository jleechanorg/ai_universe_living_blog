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
 *   --blog-url=<url>      Blog MCP server URL for daily-summary (default: http://localhost:8081)
 */

import { MemoryBlogStorage } from '../blog/storage.js';
import { runBranchEntryPipeline, runDailySummaryPipeline, type NovelEngineConfig } from './engine.js';
import type { BranchContext } from './branch-generator.js';
import { loadNovelConfig, type NovelConfig } from './config.js';
import type { Post } from '../shared/types.js';

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

/**
 * Fetch all posts for a given date from the blog MCP server via HTTP JSON-RPC.
 * The blog MCP server must be running at `blogUrl`.
 */
async function fetchPostsFromBlog(blogUrl: string, repoKey: string, date: string): Promise<Post[]> {
  // Build day range for filtering
  const dayStart = date + 'T00:00:00.000Z';
  const dayEnd = date + 'T23:59:59.999Z';
  const dayStartMs = new Date(dayStart).getTime();
  const dayEndMs = new Date(dayEnd).getTime();

  // Fetch all posts for this repo (paginate via cursor)
  const allPosts: Post[] = [];
  let cursor: string | undefined;

  do {
    const listParams: Record<string, unknown> = { repoKey, limit: 100 };
    if (cursor) listParams['cursor'] = cursor;

    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'list_posts',
      params: listParams,
    };

    const res = await fetch(`${blogUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${blogUrl}/mcp`);
    }

    const rpc = (await res.json()) as { result?: { posts: Post[]; cursor?: string } };
    const result = rpc.result;
    if (!result || !result.posts) break;

    for (const post of result.posts) {
      const t = new Date(post.createdAt).getTime();
      if (t >= dayStartMs && t <= dayEndMs) {
        allPosts.push(post);
      }
    }

    cursor = result.cursor;
    // Stop if no more pages
    if (!cursor) break;
  } while (true);

  return allPosts;
}

async function main() {
  if (command === 'branch-entry') {
    const params = parseKvArgs(args.slice(1));
    const nc = await loadConfig(params['config']);

    const config: NovelEngineConfig = {
      repoKey: (params['repo'] ?? nc.defaultRepoKey) as NovelEngineConfig['repoKey'],
      sessionId: params['session'] ?? 'cli-unknown',
      branchName: params['branch'] ?? 'unknown',
      storage: new MemoryBlogStorage(),
      novelConfig: nc,
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
    const params = parseKvArgs(args.slice(1));
    const nc = await loadConfig(params['config']);
    const targetDate = params['date'] ?? new Date().toISOString().split('T')[0];
    const repoKey = (params['repo'] ?? nc.defaultRepoKey) as NovelEngineConfig['repoKey'];
    const blogUrl = params['blog-url'] ?? 'http://localhost:8081';

    // Fetch posts via HTTP from the blog MCP server — the server holds all posts,
    // so we don't create a new empty in-memory storage here.
    let posts: Post[] = [];
    try {
      posts = await fetchPostsFromBlog(blogUrl, repoKey, targetDate);
      console.error(`Fetched ${posts.length} posts for ${targetDate} from ${blogUrl}`);
    } catch (fetchErr) {
      console.error(`Warning: could not fetch posts from blog server at ${blogUrl}: ${fetchErr}`);
      console.error('The blog MCP server must be running (npm run dev:blog) for daily-summary to work.');
      console.error('If the server is running on a different port, use --blog-url=http://localhost:<port>');
      process.exit(1);
    }

    const config: NovelEngineConfig = {
      repoKey,
      sessionId: params['session'] ?? 'cli-daily-summary',
      branchName: 'daily-summary',
      storage: new MemoryBlogStorage(),
      novelConfig: nc,
    };

    const result = await runDailySummaryPipeline(config, targetDate, posts);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'help') {
    console.log(`Novel CLI

Commands:
  branch-entry --repo=owner/repo --session=ID --branch=name [--pr=N] [--sha=SHA] [--errors=a,b]
    Generate and post a per-branch novel entry to the blog.
    Uses --voice to override the story persona (workers | agents | minimal).

  daily-summary --repo=owner/repo --session=ID [--date=YYYY-MM-DD] [--blog-url=<url>]
    Generate and post the daily community novel summary.
    Posts only if there are ≥minPostsForDailySummary posts for the day (default: 3).
    The blog MCP server must be running (npm run dev:blog) so the CLI can fetch
    today's posts via HTTP. Use --blog-url to point to a non-default server URL.
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
  --blog-url=<url>      Blog MCP server URL for daily-summary (default: http://localhost:8081)
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
