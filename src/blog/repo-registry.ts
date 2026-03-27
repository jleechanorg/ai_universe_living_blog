/**
 * RepoRegistry — per-repo configuration for the AutoScan and Webhook systems.
 *
 * Stores RepoConfig objects in data/repos.json.
 * Auto-creates DATA_DIR on first use.
 * All mutations are sync-write for simplicity.
 */

import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Schema ───────────────────────────────────────────────────────────────────

export const RepoConfigSchema = z.object({
  repoKey: z.string().regex(/^[^/]+\/[^/]+$/, '"owner/name" format required'),
  enabled: z.boolean(),
  githubToken: z.string().optional(),
  webhookSecret: z.string().optional(),
  modes: z.object({
    autoScan: z.boolean(),
    novelBranch: z.boolean(),
    novelDaily: z.boolean(),
  }),
  scanIntervalMs: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

// ─── RepoRegistry ─────────────────────────────────────────────────────────────

export class RepoRegistry {
  private readonly dataDir: string;
  private readonly reposFile: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.reposFile = join(dataDir, 'repos.json');
    mkdirSync(dataDir, { recursive: true });
  }

  /** Load all repos from disk (or empty array if file doesn't exist). */
  private load(): RepoConfig[] {
    try {
      const raw = readFileSync(this.reposFile, 'utf-8');
      return RepoConfigSchema.array().parse(JSON.parse(raw)) as RepoConfig[];
    } catch {
      return [];
    }
  }

  /** Sync-write all repos to disk. */
  private save(repos: RepoConfig[]): void {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.reposFile, JSON.stringify(repos, null, 2), 'utf-8');
  }

  list(): RepoConfig[] {
    return [...this.load()];
  }

  get(repoKey: string): RepoConfig | null {
    const repos = this.load();
    return repos.find((r) => r.repoKey === repoKey) ?? null;
  }

  register(config: RepoConfig): void {
    const repos = this.load();
    if (repos.some((r) => r.repoKey === config.repoKey)) {
      throw new Error(`Repo already registered: ${config.repoKey}`);
    }
    repos.push(config);
    this.save(repos);
  }

  update(repoKey: string, updates: Partial<RepoConfig>): void {
    const repos = this.load();
    const idx = repos.findIndex((r) => r.repoKey === repoKey);
    if (idx === -1) {
      throw new Error(`Repo not found: ${repoKey}`);
    }
    // Merge, with explicit fields to avoid schema issues on partial updates
    const existing = repos[idx]!;
    const merged: RepoConfig = {
      ...existing,
      ...updates,
      repoKey: existing.repoKey, // immutable
      modes: updates.modes
        ? { ...existing.modes, ...updates.modes }
        : existing.modes,
      createdAt: existing.createdAt, // immutable
      updatedAt: new Date().toISOString(),
    };
    repos[idx] = merged;
    this.save(repos);
  }

  unregister(repoKey: string): void {
    const repos = this.load();
    const idx = repos.findIndex((r) => r.repoKey === repoKey);
    if (idx === -1) {
      throw new Error(`Repo not found: ${repoKey}`);
    }
    repos.splice(idx, 1);
    this.save(repos);
  }
}
