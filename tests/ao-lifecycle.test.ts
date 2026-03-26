import { describe, it, expect } from 'vitest';
import { handlePrEvent, type PrEvent, type PrEventType } from '../src/hooks/ao-lifecycle.js';

const TRIGGER_TYPES: PrEventType[] = ['pr_opened', 'pr_merged', 'pr_closed'];

describe('handlePrEvent', () => {
  it('calls runCli with branch-entry command for pr_opened', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_opened',
      repo: 'owner/repo',
      pr: 42,
      session: 'ao-826',
      branch: 'feat/x',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).toHaveBeenCalledOnce;
    expect(runCli).toHaveBeenCalledWith(
      expect.stringContaining('branch-entry'),
    );
    expect(runCli).toHaveBeenCalledWith(
      expect.stringContaining('--pr=42'),
    );
    expect(runCli).toHaveBeenCalledWith(
      expect.stringContaining('--repo=owner/repo'),
    );
    expect(runCli).toHaveBeenCalledWith(
      expect.stringContaining('--session=ao-826'),
    );
    expect(runCli).toHaveBeenCalledWith(
      expect.stringContaining('--branch=feat/x'),
    );
  });

  it('calls runCli with branch-entry command for pr_merged', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_merged',
      repo: 'owner/repo',
      pr: 99,
      session: 'ao-100',
      branch: 'fix/y',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).toHaveBeenCalledOnce;
    expect(runCli).toHaveBeenCalledWith(expect.stringContaining('--pr=99'));
  });

  it('calls runCli with branch-entry command for pr_closed', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_closed',
      repo: 'owner/repo',
      pr: 7,
      session: 'ao-50',
      branch: 'fix/z',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).toHaveBeenCalledOnce;
    expect(runCli).toHaveBeenCalledWith(expect.stringContaining('--pr=7'));
  });

  it('skips runCli for pr_review_requested', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_review_requested',
      repo: 'owner/repo',
      pr: 42,
      session: 'ao-826',
      branch: 'feat/x',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).not.toHaveBeenCalled();
  });

  it('skips runCli for pr_comment', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_comment',
      repo: 'owner/repo',
      pr: 42,
      session: 'ao-826',
      branch: 'feat/x',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).not.toHaveBeenCalled();
  });

  it('skips runCli for unknown event types', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_reviewed',
      repo: 'owner/repo',
      pr: 42,
      session: 'ao-826',
      branch: 'feat/x',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).not.toHaveBeenCalled();
  });

  it('rejects when runCli throws', async () => {
    const runCli = vi.fn().mockRejectedValue(new Error('network error'));
    const event: PrEvent = {
      type: 'pr_opened',
      repo: 'owner/repo',
      pr: 1,
      session: 'ao-test',
      branch: 'feat/test',
    };
    await expect(handlePrEvent(event, runCli)).rejects.toThrow('network error');
  });

  it('assembles command with all required args', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_opened',
      repo: 'jleechanorg/ai_universe_living_blog',
      pr: 404,
      session: 'gh-actions-12345',
      branch: 'feat/awesome',
    };
    await handlePrEvent(event, runCli);
    const [cmd] = runCli.mock.calls[0]!;
    expect(cmd).toContain('branch-entry');
    expect(cmd).toContain('--repo=jleechanorg/ai_universe_living_blog');
    expect(cmd).toContain('--pr=404');
    expect(cmd).toContain('--session=gh-actions-12345');
    expect(cmd).toContain('--branch=feat/awesome');
  });
});
