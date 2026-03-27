#!/usr/bin/env node

/**
 * Blog CLI — repo management and API key operations.
 *
 * Usage:
 *   npm run dev:blog -- cli repo add owner/repo --token TOKEN
 *   npm run dev:blog -- cli repo list
 *   npm run dev:blog -- cli repo enable owner/repo --auto-scan
 *   npm run dev:blog -- cli repo disable owner/repo --auto-scan
 *   npm run dev:blog -- cli repo remove owner/repo
 *   npm run dev:blog -- cli apikey generate my-label --scopes read,write
 *   npm run dev:blog -- cli apikey list
 */

import { RepoRegistry } from './repo-registry.js';
import { hashKey, loadApiKeys, saveApiKeys } from './auth.js';
import { randomBytes } from 'crypto';

const DATA_DIR = process.env['DATA_DIR'] ?? 'data/';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(msg);
}

function parseKv(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

// ─── Repo commands ──────────────────────────────────────────────────────────────

function cmdRepoAdd(repoKey: string, opts: Record<string, string>): void {
  if (!repoKey.includes('/')) die('repoKey must be in "owner/name" format');
  const registry = new RepoRegistry(DATA_DIR);
  const existing = registry.get(repoKey);
  if (existing) die(`Repo already registered: ${repoKey}`);
  const now = new Date().toISOString();
  registry.register({
    repoKey,
    enabled: true,
    githubToken: opts['token'] ?? undefined,
    webhookSecret: opts['secret'] ?? undefined,
    modes: {
      autoScan: opts['auto-scan'] === 'true',
      novelBranch: opts['novel-branch'] === 'true',
      novelDaily: opts['novel-daily'] === 'true',
    },
    scanIntervalMs: opts['scan-interval-ms']
      ? Number(opts['scan-interval-ms'])
      : undefined,
    createdAt: now,
    updatedAt: now,
  });
  ok(`Registered: ${repoKey}`);
}

function cmdRepoList(): void {
  const registry = new RepoRegistry(DATA_DIR);
  const repos = registry.list();
  if (repos.length === 0) {
    ok('No repos registered.');
    return;
  }
  console.log(JSON.stringify(repos, null, 2));
}

function cmdRepoRemove(repoKey: string): void {
  const registry = new RepoRegistry(DATA_DIR);
  const existing = registry.get(repoKey);
  if (!existing) die(`Repo not found: ${repoKey}`);
  registry.unregister(repoKey);
  ok(`Removed: ${repoKey}`);
}

function cmdRepoEnable(repoKey: string, opts: Record<string, string>): void {
  const registry = new RepoRegistry(DATA_DIR);
  const existing = registry.get(repoKey);
  if (!existing) die(`Repo not found: ${repoKey}`);
  if (opts['auto-scan'] !== undefined) {
    registry.update(repoKey, { modes: { ...existing.modes, autoScan: true } });
  } else if (opts['novel-branch'] !== undefined) {
    registry.update(repoKey, { modes: { ...existing.modes, novelBranch: true } });
  } else if (opts['novel-daily'] !== undefined) {
    registry.update(repoKey, { modes: { ...existing.modes, novelDaily: true } });
  } else {
    registry.update(repoKey, { enabled: true });
  }
  ok(`Enabled: ${repoKey}`);
}

function cmdRepoDisable(repoKey: string, opts: Record<string, string>): void {
  const registry = new RepoRegistry(DATA_DIR);
  const existing = registry.get(repoKey);
  if (!existing) die(`Repo not found: ${repoKey}`);
  if (opts['auto-scan'] !== undefined) {
    registry.update(repoKey, { modes: { ...existing.modes, autoScan: false } });
  } else if (opts['novel-branch'] !== undefined) {
    registry.update(repoKey, { modes: { ...existing.modes, novelBranch: false } });
  } else if (opts['novel-daily'] !== undefined) {
    registry.update(repoKey, { modes: { ...existing.modes, novelDaily: false } });
  } else {
    registry.update(repoKey, { enabled: false });
  }
  ok(`Disabled: ${repoKey}`);
}

// ─── API key commands ──────────────────────────────────────────────────────────

interface ApiKey {
  key: string;
  label: string;
  scopes: string[];
  createdAt: string;
}

function cmdApiKeyGenerate(label: string, opts: Record<string, string>): void {
  const plaintext = randomBytes(32).toString('hex');
  const hashed = hashKey(plaintext);
  const scopes = (opts['scopes'] ?? 'read,write').split(',').map((s) => s.trim());
  const keys = loadApiKeys(DATA_DIR);
  const entry: ApiKey = {
    key: hashed,
    label,
    scopes,
    createdAt: new Date().toISOString(),
  };
  keys.push(entry);
  saveApiKeys(keys, DATA_DIR);
  console.log(JSON.stringify({
    key: plaintext,
    label: entry.label,
    scopes: entry.scopes,
    createdAt: entry.createdAt,
    warning: 'Store this key securely — it will not be shown again.',
  }, null, 2));
}

function cmdApiKeyList(): void {
  const keys = loadApiKeys(DATA_DIR);
  if (keys.length === 0) {
    ok('No API keys registered.');
    return;
  }
  // Don't print the hashed keys — show metadata only
  console.log(JSON.stringify(keys.map(({ key: _k, ...rest }) => rest), null, 2));
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`Blog CLI

Commands:
  repo add <repoKey> [--token TOKEN] [--secret SECRET]
                   [--auto-scan] [--novel-branch] [--novel-daily]
                   [--scan-interval-ms MS]
  repo list
  repo remove <repoKey>
  repo enable <repoKey> [--auto-scan] [--novel-branch] [--novel-daily]
  repo disable <repoKey> [--auto-scan] [--novel-branch] [--novel-daily]
  apikey generate <label> [--scopes read,write]
  apikey list
`);
}

function main(): void {
  const [, , command, subcommand, ...rest] = process.argv;
  const opts = parseKv(rest);

  if (!command) {
    printUsage();
    process.exit(0);
  }

  try {
    if (command === 'repo') {
      if (!subcommand) die('repo subcommand required (add|list|remove|enable|disable)');
      switch (subcommand) {
        case 'add': {
          if (!rest[0] || rest[0]!.startsWith('--')) die('repo add <repoKey>');
          cmdRepoAdd(rest[0]!, opts);
          break;
        }
        case 'list':
          cmdRepoList();
          break;
        case 'remove': {
          if (!rest[0]) die('repo remove <repoKey>');
          cmdRepoRemove(rest[0]!);
          break;
        }
        case 'enable': {
          if (!rest[0]) die('repo enable <repoKey>');
          cmdRepoEnable(rest[0]!, opts);
          break;
        }
        case 'disable': {
          if (!rest[0]) die('repo disable <repoKey>');
          cmdRepoDisable(rest[0]!, opts);
          break;
        }
        default:
          die(`Unknown repo subcommand: ${subcommand}`);
      }
    } else if (command === 'apikey') {
      if (!subcommand) die('apikey subcommand required (generate|list)');
      switch (subcommand) {
        case 'generate': {
          if (!rest[0]) die('apikey generate <label>');
          cmdApiKeyGenerate(rest[0]!, opts);
          break;
        }
        case 'list':
          cmdApiKeyList();
          break;
        default:
          die(`Unknown apikey subcommand: ${subcommand}`);
      }
    } else {
      die(`Unknown command: ${command}`);
    }
  } catch (err) {
    die(String(err));
  }
}

main();
