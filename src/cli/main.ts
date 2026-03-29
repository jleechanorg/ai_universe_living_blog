#!/usr/bin/env node

/**
 * blog-cli — Blog CLI entry point.
 *
 * Usage:
 *   blog-cli branch-entry --session ao-832 --pr 42 --repo owner/repo [--sha abc123]
 *   blog-cli daily-summary --repo owner/repo [--date 2026-03-27] [--session ao-827]
 *   blog-cli chat --worker ao-832 --message "What was the hardest part?" --repo owner/repo
 *   blog-cli config --show
 *   blog-cli config --init
 *   blog-cli register-repo --repo owner/repo [--token GH_TOKEN] [--auto-scan]
 *
 * Environment variables:
 *   GITHUB_TOKEN           — GitHub personal access token (required for branch-entry)
 *   BLOG_SERVER_URL        — MCP server URL (default: http://localhost:8081)
 *   ANTHROPIC_API_KEY      — Required for editor pass (optional)
 *   OPENCLAW_INFERENCE_URL — Local inference URL for chat_worker (optional)
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GitHubClient } from '../shared/github-client.js';
import type { GHPullRequest, GHCommit, GHCheckRun, GHReview } from '../shared/github-client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  command: string;
  // branch-entry
  session?: string;
  pr?: string;
  repo?: string;
  sha?: string;
  outputDir?: string;
  output?: 'file' | 'both' | 'none';
  // daily-summary
  date?: string;
  voice?: string;
  config?: string;
  // chat
  worker?: string;
  message?: string;
  fifo?: boolean;
  mcpUrl?: string;
  // config
  show?: boolean;
  init?: boolean;
  // register-repo
  token?: string;
  autoScan?: boolean;
  novelBranch?: boolean;
  // env overrides
  blogServerUrl: string;
}

export interface CliConfig {
  blogServerUrl: string;
  githubToken?: string;
  anthropicApiKey?: string;
  openclawInferenceUrl?: string;
  novelWorkersDir: string;
  promptsDir: string;
}

// ─── Argument Parser ──────────────────────────────────────────────────────────

/**
 * Parse CLI arguments of the form:
 *   --key=value  (equals form)
 *   --key value  (space-separated form)
 *   --flag       (boolean flag, no value)
 */
export function parseKvArgs(kvs: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < kvs.length; i++) {
    const kv = kvs[i]!;
    if (!kv.startsWith('--')) continue;
    if (kv.includes('=')) {
      const [k, ...rest] = kv.split('=');
      if (k) result[k.replace(/^--/, '')] = rest.join('=');
    } else {
      const next = kvs[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result[kv.replace(/^--/, '')] = next;
        i++;
      } else {
        // Boolean flag (no value following)
        result[kv.replace(/^--/, '')] = true;
      }
    }
  }
  return result;
}

/**
 * Parse full process.argv-style args into a typed ParsedArgs object.
 * Throws with a usage message on missing required args.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0];
  if (!command || command.startsWith('--')) {
    throw new Error(
      'Usage: blog-cli <command> [options]\n' +
        'Commands: branch-entry, daily-summary, chat, config, register-repo',
    );
  }

  const raw = parseKvArgs(argv.slice(1));
  const blogServerUrl =
    String(raw['mcp-url'] ?? process.env['BLOG_SERVER_URL'] ?? 'http://localhost:8081');

  switch (command) {
    case 'branch-entry': {
      if (!raw['session'])
        throw new Error('branch-entry requires --session <session-id>');
      if (!raw['pr'])
        throw new Error('branch-entry requires --pr <pr-number>');
      if (!raw['repo'])
        throw new Error('branch-entry requires --repo <owner/repo>');
      return {
        command,
        session: String(raw['session']),
        pr: String(raw['pr']),
        repo: String(raw['repo']),
        sha: raw['sha'] ? String(raw['sha']) : undefined,
        outputDir: raw['output-dir'] ? String(raw['output-dir']) : undefined,
        output: (raw['output'] as ParsedArgs['output']) ?? 'file',
        blogServerUrl,
      };
    }
    case 'daily-summary': {
      if (!raw['repo'])
        throw new Error('daily-summary requires --repo <owner/repo>');
      return {
        command,
        repo: String(raw['repo']),
        date: raw['date'] ? String(raw['date']) : undefined,
        session: raw['session'] ? String(raw['session']) : undefined,
        voice: raw['voice'] ? String(raw['voice']) : undefined,
        config: raw['config'] ? String(raw['config']) : undefined,
        blogServerUrl,
      };
    }
    case 'chat': {
      if (!raw['worker'])
        throw new Error('chat requires --worker <session-id>');
      if (!raw['message'])
        throw new Error('chat requires --message <text>');
      if (!raw['repo'])
        throw new Error('chat requires --repo <owner/repo>');
      return {
        command,
        worker: String(raw['worker']),
        message: String(raw['message']),
        repo: String(raw['repo']),
        fifo: Boolean(raw['fifo']),
        mcpUrl: raw['mcp-url'] ? String(raw['mcp-url']) : undefined,
        blogServerUrl,
      };
    }
    case 'config': {
      return {
        command,
        show: Boolean(raw['show']),
        init: Boolean(raw['init']),
        blogServerUrl,
      };
    }
    case 'register-repo': {
      if (!raw['repo'])
        throw new Error('register-repo requires --repo <owner/repo>');
      return {
        command,
        repo: String(raw['repo']),
        token: raw['token'] ? String(raw['token']) : undefined,
        autoScan: Boolean(raw['auto-scan']),
        novelBranch: Boolean(raw['novel-branch']),
        blogServerUrl,
      };
    }
    default:
      throw new Error(
        `Unknown command: "${command}"\n` +
          'Usage: blog-cli <command> [options]\n' +
          'Commands: branch-entry, daily-summary, chat, config, register-repo',
      );
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function getEffectiveConfig(): CliConfig {
  return {
    blogServerUrl: process.env['BLOG_SERVER_URL'] ?? 'http://localhost:8081',
    githubToken: process.env['GITHUB_TOKEN'],
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    openclawInferenceUrl: process.env['OPENCLAW_INFERENCE_URL'],
    novelWorkersDir: process.env['NOVEL_WORKERS_DIR'] ?? 'novel/workers/',
    promptsDir: join(homedir(), '.blog', 'prompts'),
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Build a structured prompt file for the AO worker to generate a branch entry.
 * Does NOT call any LLM — just fetches GitHub data and writes a prompt file.
 */
export async function runBranchEntryCommand(args: ParsedArgs): Promise<void> {
  const cfg = getEffectiveConfig();
  const token = args.token ?? cfg.githubToken;

  const [owner, repoName] = (args.repo ?? '').split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: "${args.repo}". Expected "owner/repo".`);
  }
  const prNumber = parseInt(args.pr ?? '', 10);
  if (Number.isNaN(prNumber)) {
    throw new Error(`Invalid PR number: "${args.pr}". Expected an integer.`);
  }

  const client = new GitHubClient(token);

  // Fetch PR, commits, check runs, reviews in parallel
  const [pr, commits, reviews] = await Promise.all([
    client.getPR(owner, repoName, prNumber),
    client.getCommits(owner, repoName, prNumber),
    client.getReviews(owner, repoName, prNumber),
  ]);

  const ref = args.sha ?? pr.headSha;
  const checkRuns: GHCheckRun[] = ref
    ? await client.getCheckRuns(owner, repoName, ref)
    : [];

  const prompt = buildPromptFile({
    sessionId: args.session!,
    pr,
    commits,
    checkRuns,
    reviews,
  });

  // output=none: skip file write
  let promptPath: string | undefined;
  if (args.output !== 'none') {
    const promptsDir = args.outputDir ?? cfg.promptsDir;
    mkdirSync(promptsDir, { recursive: true });
    promptPath = join(promptsDir, `${args.session}.md`);
    writeFileSync(promptPath, prompt, 'utf8');
    console.log(`Prompt written to ${promptPath} — AO worker will generate the entry`);
  }

  // output=both: also POST to MCP server (best-effort, file is source of truth)
  if (args.output === 'both') {
    await postPromptToMcp({
      blogServerUrl: args.blogServerUrl,
      repoKey: args.repo!,
      sessionId: args.session!,
      prNumber,
      prompt,
      pr,
    });
  }
}

interface McpPostParams {
  blogServerUrl: string;
  repoKey: string;
  sessionId: string;
  prNumber: number;
  prompt: string;
  pr: GHPullRequest;
}

async function postPromptToMcp(params: McpPostParams): Promise<void> {
  const { blogServerUrl, repoKey, sessionId, prNumber, prompt, pr } = params;
  const url = `${blogServerUrl}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'create_post',
      arguments: {
        repoKey,
        posterId: sessionId,
        title: `Branch Entry: ${pr.title}`,
        content: prompt,
        eventType: 'novel_branch_entry',
        tags: ['branch-entry', sessionId],
        status: 'published',
        metadata: {
          sessionId,
          prNumber,
          branchName: pr.headBranch,
          prUrl: pr.url,
        },
      },
    },
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      console.warn(`Warning: MCP server returned ${res.status} — prompt file is still the source of truth`);
      return;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const result = data.result as Record<string, unknown> | undefined;
    const postId = (result?.content as Array<Record<string, unknown>> | undefined)?.[0]?.text;
    if (postId) {
      console.log(`Post created on MCP server (output=both)`);
    }
  } catch (err) {
    console.warn(`Warning: could not reach MCP server — ${err instanceof Error ? err.message : String(err)}. Prompt file is the source of truth.`);
  }
}

interface PromptData {
  sessionId: string;
  pr: GHPullRequest;
  commits: GHCommit[];
  checkRuns: GHCheckRun[];
  reviews: GHReview[];
}

function buildPromptFile(data: PromptData): string {
  const { sessionId, pr, commits, checkRuns, reviews } = data;
  const status = pr.merged ? 'merged' : pr.state;
  const bodyExcerpt = (pr.body ?? '').slice(0, 500);

  const commitsSection = commits
    .map((c) => `- ${c.sha.slice(0, 7)} — ${c.commit.message.split('\n')[0]} — ${c.commit.author.name} — ${c.commit.author.date}`)
    .join('\n') || '(no commits)';

  const checksSection = checkRuns
    .map((r) => {
      const duration =
        r.startedAt && r.completedAt
          ? `${Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
          : 'unknown';
      return `- ${r.name}: ${r.conclusion ?? r.status} (duration: ${duration})`;
    })
    .join('\n') || '(no check runs)';

  const reviewsSection = reviews
    .map((r) => `- [${r.user.login}] ${r.state} — "${(r.body ?? '').slice(0, 100)}"`)
    .join('\n') || '(no reviews)';

  return `# Branch Entry Prompt — ${sessionId}

## Context
- Session: ${sessionId}
- PR: #${pr.number}
- Repo: ${pr.url.split('/pull/')[0]?.replace('https://github.com/', '') ?? ''}
- Branch: ${pr.headBranch}
- Author: ${pr.author}
- Status: ${status}

## PR Title
${pr.title}

## PR Body (first 500 chars)
${bodyExcerpt || '(no description)'}

## Commits
${commitsSection}

## Check Runs
${checksSection}

## Reviews
${reviewsSection}

## Writing Instruction
Write a ~600-word branch entry from the perspective of ${sessionId}.
Use a first-person collective voice ("we", "the cursor", "the branch").
Incorporate: the actual commit messages, the PR title/body, the check results, and any review feedback.
Ground every claim in the specific events above.
Tag the entry with at least 2 story beads.
Output path: novel/workers/${sessionId}.md
`;
}

/**
 * Send a chat message to a worker via the MCP server's chat_worker tool.
 */
export async function runChatCommand(args: ParsedArgs): Promise<void> {
  const url = `${args.blogServerUrl}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'chat_worker',
    params: {
      workerId: args.worker,
      message: args.message,
      repoKey: args.repo,
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`MCP server returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const result = data.result as Record<string, unknown> | undefined;
  if (result?.content && Array.isArray(result.content)) {
    const text = (result.content[0] as Record<string, unknown>)?.text;
    if (text) {
      const parsed = JSON.parse(String(text)) as Record<string, unknown>;
      console.log(`[${parsed.workerId ?? args.worker}] ${parsed.response ?? text}`);
      return;
    }
  }
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print effective config or create default config file.
 * @param args - Parsed CLI args
 * @param configDir - Directory to write novel.config.json (default: process.cwd())
 */
export function runConfigCommand(args: ParsedArgs, configDir?: string): void {
  const cfg = getEffectiveConfig();
  if (args.show) {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  if (args.init) {
    const defaultConfig = {
      defaultRepoKey: '',
      storyVoice: 'workers',
      minPostsForDailySummary: 3,
    };
    const baseDir = configDir ?? process.cwd();
    const configPath = join(baseDir, 'novel.config.json');
    if (existsSync(configPath)) {
      console.log(`Config already exists at ${configPath}`);
      return;
    }
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
    console.log(`Config created at ${configPath}`);
    return;
  }
  console.log('Usage: blog-cli config --show | --init');
}

/**
 * Register a repo via the MCP server's register_repo tool.
 */
export async function runRegisterRepoCommand(args: ParsedArgs): Promise<void> {
  const url = `${args.blogServerUrl}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'register_repo',
    params: {
      repoKey: args.repo,
      token: args.token,
      modes: {
        autoScan: args.autoScan ?? false,
        novelBranch: args.novelBranch ?? false,
      },
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`MCP server returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  console.log('Registered:', args.repo);
  console.log(JSON.stringify(data, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }

  try {
    switch (parsed.command) {
      case 'branch-entry':
        await runBranchEntryCommand(parsed);
        break;
      case 'daily-summary':
        // Delegate to existing novel engine CLI for daily-summary
        console.log('Use: npm run dev:novel -- daily-summary [options]');
        console.log('(daily-summary is handled by the novel engine)');
        break;
      case 'chat':
        await runChatCommand(parsed);
        break;
      case 'config':
        runConfigCommand(parsed);
        break;
      case 'register-repo':
        await runRegisterRepoCommand(parsed);
        break;
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Run if invoked directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/cli/main.ts') ||
    process.argv[1].endsWith('/cli/main.js') ||
    process.argv[1].endsWith('blog-cli'));

if (isMain) {
  void main();
}
