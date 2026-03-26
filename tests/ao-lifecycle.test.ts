import { describe, it, expect } from 'vitest';
import { handlePrEvent, buildArgv, type PrEvent } from '../src/hooks/ao-lifecycle.js';

describe('handlePrEvent', () => {
  // runCli receives argv: string[] — use expect.arrayContaining to match elements
  const contain = (substring: string) =>
    expect.arrayContaining([expect.stringContaining(substring)]);

  it('calls runCli for pr_opened', async () => {
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
    expect(runCli).toHaveBeenCalledWith(contain('branch-entry'));
    expect(runCli).toHaveBeenCalledWith(contain('--pr=42'));
    expect(runCli).toHaveBeenCalledWith(contain('--repo=owner/repo'));
    expect(runCli).toHaveBeenCalledWith(contain('--session=ao-826'));
    expect(runCli).toHaveBeenCalledWith(contain('--branch=feat/x'));
  });

  it('calls runCli for pr_merged', async () => {
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
    expect(runCli).toHaveBeenCalledWith(contain('--pr=99'));
  });

  it('calls runCli for pr_reopened', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_reopened',
      repo: 'owner/repo',
      pr: 3,
      session: 'ao-1',
      branch: 'feat/r',
    };
    await handlePrEvent(event, runCli);
    expect(runCli).toHaveBeenCalledOnce;
    expect(runCli).toHaveBeenCalledWith(contain('--pr=3'));
  });

  it('calls runCli for pr_closed', async () => {
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
    expect(runCli).toHaveBeenCalledWith(contain('--pr=7'));
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

  it('assembles argv with all required args', async () => {
    const runCli = vi.fn().mockResolvedValue(undefined);
    const event: PrEvent = {
      type: 'pr_opened',
      repo: 'jleechanorg/ai_universe_living_blog',
      pr: 404,
      session: 'gh-actions-12345',
      branch: 'feat/awesome',
    };
    await handlePrEvent(event, runCli);
    const [argv] = runCli.mock.calls[0]!;
    expect(argv).toContain('branch-entry');
    expect(argv).toContain('--repo=jleechanorg/ai_universe_living_blog');
    expect(argv).toContain('--pr=404');
    expect(argv).toContain('--session=gh-actions-12345');
    expect(argv).toContain('--branch=feat/awesome');
  });
});

describe('buildArgv', () => {
  it('builds correct argv array without eventType', () => {
    const argv = buildArgv({
      type: 'pr_opened',
      repo: 'owner/repo',
      pr: 42,
      session: 'ao-826',
      branch: 'feat/x',
    });
    expect(argv).toEqual([
      'branch-entry',
      '--repo=owner/repo',
      '--session=ao-826',
      '--branch=feat/x',
      '--pr=42',
    ]);
  });

  it('builds correct argv array with eventType', () => {
    const argv = buildArgv(
      {
        type: 'pr_opened',
        repo: 'owner/repo',
        pr: 42,
        session: 'ao-826',
        branch: 'feat/x',
      },
      'pr_opened',
    );
    expect(argv).toContain('--event=pr_opened');
  });
});
