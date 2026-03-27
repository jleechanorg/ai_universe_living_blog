import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBlogToolHandlers, type BlogToolContext } from '../../src/blog/tools.js';
import { RepoRegistry } from '../../src/blog/repo-registry.js';
import { MemoryBlogStorage } from '../../src/blog/storage.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { RepoKey } from '../../src/shared/types.js';

const TEST_REPO = 'test-owner/test-repo' as RepoKey;

describe('Repo MCP tools', () => {
  const testDir = join(process.cwd(), `test-data-repo-tools-${Date.now()}`);

  beforeEach(() => mkdirSync(testDir, { recursive: true }));
  afterEach(() => { try { rmSync(testDir, { recursive: true }); } catch { /* noop */ } });

  function makeCtx(): BlogToolContext & ReturnType<typeof createBlogToolHandlers> {
    const storage = new MemoryBlogStorage();
    const registry = new RepoRegistry(testDir);
    const ctx: BlogToolContext = { storage, agentId: 'test-agent', registry, dataDir: testDir };
    return { ...ctx, ...createBlogToolHandlers(ctx) };
  }

  it('register_repo adds a repo', async () => {
    const ctx = makeCtx();
    const result = await ctx.register_repo({
      repoKey: TEST_REPO,
      enabled: true,
      modes: { autoScan: true, novelBranch: false, novelDaily: false },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.repo.repoKey).toBe(TEST_REPO);
  });

  it('list_repos returns registered repos', async () => {
    const ctx = makeCtx();
    await ctx.register_repo({ repoKey: TEST_REPO, modes: { autoScan: false, novelBranch: false, novelDaily: false } });
    const result = await ctx.list_repos({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.repos).toHaveLength(1);
    expect(parsed.repos[0].repoKey).toBe(TEST_REPO);
  });

  it('update_repo preserves modes when only enabled is changed', async () => {
    const ctx = makeCtx();
    // Register with all three modes on
    await ctx.register_repo({
      repoKey: TEST_REPO,
      enabled: true,
      modes: { autoScan: true, novelBranch: true, novelDaily: true },
    });

    // Update only enabled — modes must be preserved
    const result = await ctx.update_repo({
      repoKey: TEST_REPO,
      enabled: false,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.repo.enabled).toBe(false);
    expect(parsed.repo.modes.autoScan).toBe(true);
    expect(parsed.repo.modes.novelBranch).toBe(true);
    expect(parsed.repo.modes.novelDaily).toBe(true);
  });

  it('update_repo applies partial mode changes', async () => {
    const ctx = makeCtx();
    await ctx.register_repo({
      repoKey: TEST_REPO,
      modes: { autoScan: true, novelBranch: true, novelDaily: true },
    });

    // Turn off only autoScan, leave others unchanged
    const result = await ctx.update_repo({
      repoKey: TEST_REPO,
      modes: { autoScan: false },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.repo.modes.autoScan).toBe(false);
    expect(parsed.repo.modes.novelBranch).toBe(true);
    expect(parsed.repo.modes.novelDaily).toBe(true);
  });

  it('unregister_repo removes a repo', async () => {
    const ctx = makeCtx();
    await ctx.register_repo({ repoKey: TEST_REPO, modes: { autoScan: false, novelBranch: false, novelDaily: false } });
    const removed = await ctx.unregister_repo({ repoKey: TEST_REPO });
    expect(JSON.parse(removed.content[0].text).success).toBe(true);

    const listed = await ctx.list_repos({});
    expect(JSON.parse(listed.content[0].text).repos).toHaveLength(0);
  });

  it('generate_api_key returns plaintext key', async () => {
    const ctx = makeCtx();
    const result = await ctx.generate_api_key({ label: 'test-key', scopes: ['read'] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.key).toBeDefined();
    expect(parsed.key.length).toBe(64); // 32 bytes hex = 64 chars
    expect(parsed.label).toBe('test-key');
    expect(parsed.scopes).toContain('read');
  });
});
