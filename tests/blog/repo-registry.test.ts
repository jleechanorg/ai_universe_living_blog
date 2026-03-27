import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RepoRegistry } from '../../src/blog/repo-registry.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';

function makeCfg(repoKey: string, overrides?: Partial<ReturnType<typeof makeCfg>>) {
  return { repoKey, enabled: true, modes: { autoScan: true, novelBranch: false, novelDaily: false }, createdAt: '', updatedAt: '', ...overrides };
}

describe('RepoRegistry', () => {
  const testDir = join(process.cwd(), `test-data-repos-${Date.now()}`);
  beforeEach(() => mkdirSync(testDir, { recursive: true }));
  afterEach(() => { try { rmSync(testDir, { recursive: true }); } catch { /* noop */ } });

  it('register adds a repo and get returns it', () => {
    const r = new RepoRegistry(testDir);
    r.register(makeCfg('owner/repo'));
    expect(r.get('owner/repo')).toMatchObject({ repoKey: 'owner/repo', enabled: true });
  });

  it('register throws on duplicate', () => {
    const r = new RepoRegistry(testDir);
    r.register(makeCfg('owner/repo'));
    expect(() => r.register(makeCfg('owner/repo'))).toThrow('already registered');
  });

  it('get returns null for unknown repo', () => {
    const r = new RepoRegistry(testDir);
    expect(r.get('owner/nonexistent')).toBeNull();
  });

  it('update applies partial updates', () => {
    const r = new RepoRegistry(testDir);
    r.register(makeCfg('owner/repo'));
    r.update('owner/repo', { enabled: false });
    expect(r.get('owner/repo')!.enabled).toBe(false);
  });

  it('update applies nested modes partial update', () => {
    const r = new RepoRegistry(testDir);
    r.register(makeCfg('owner/repo'));
    r.update('owner/repo', { modes: { autoScan: false, novelBranch: true, novelDaily: false } });
    expect(r.get('owner/repo')!.modes.autoScan).toBe(false);
    expect(r.get('owner/repo')!.modes.novelBranch).toBe(true);
  });

  it('update throws on unknown repo', () => {
    const r = new RepoRegistry(testDir);
    expect(() => r.update('owner/nonexistent', { enabled: false })).toThrow('not found');
  });

  it('unregister removes and list is empty', () => {
    const r = new RepoRegistry(testDir);
    r.register(makeCfg('owner/repo'));
    r.unregister('owner/repo');
    expect(r.list()).toEqual([]);
  });

  it('unregister throws on unknown repo', () => {
    const r = new RepoRegistry(testDir);
    expect(() => r.unregister('owner/nonexistent')).toThrow('not found');
  });

  it('list returns all registered repos', () => {
    const r = new RepoRegistry(testDir);
    r.register(makeCfg('owner/repo1'));
    r.register({ repoKey: 'owner/repo2', enabled: false, modes: { autoScan: false, novelBranch: true, novelDaily: false }, createdAt: '', updatedAt: '' });
    expect(r.list()).toHaveLength(2);
  });

  it('persists across instances', () => {
    {
      const r = new RepoRegistry(testDir);
      r.register(makeCfg('owner/repo'));
    }
    {
      const r = new RepoRegistry(testDir);
      expect(r.get('owner/repo')).not.toBeNull();
    }
  });
});
