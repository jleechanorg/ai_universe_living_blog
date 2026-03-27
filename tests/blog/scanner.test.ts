import { describe, it, expect } from 'vitest';
import { mapGitHubEventToPostType, type GHActivityEvent } from '../../src/blog/scanner.js';

function makeEvent(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  actorLogin?: string,
): GHActivityEvent {
  return {
    id,
    type,
    repo: 'owner/repo',
    createdAt: '2026-03-26T12:00:00Z',
    payload,
    actor: actorLogin ? { login: actorLogin } : undefined,
  };
}

function prPayload(action: string, merged = false, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action,
    pull_request: {
      number: 42,
      title: 'Test PR',
      merged,
      html_url: 'https://github.com/owner/repo/pull/42',
      ...extra,
    },
  };
}

function checkPayload(conclusion: string): Record<string, unknown> {
  return { conclusion };
}

describe('mapGitHubEventToPostType', () => {
  it('PullRequest opened → pr_created', () => {
    const ev = makeEvent('1', 'PullRequestEvent', prPayload('opened'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_created');
  });

  it('PullRequest closed + merged → pr_merged', () => {
    const ev = makeEvent('2', 'PullRequestEvent', prPayload('closed', true));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_merged');
  });

  it('PullRequest closed + not merged → pr_closed', () => {
    const ev = makeEvent('3', 'PullRequestEvent', prPayload('closed', false));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_closed');
  });

  it('PullRequest reopened → pr_reopened', () => {
    const ev = makeEvent('4', 'PullRequestEvent', prPayload('reopened'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_reopened');
  });

  it('PullRequest edited → pr_edited', () => {
    const ev = makeEvent('5', 'PullRequestEvent', prPayload('edited'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_edited');
  });

  it('PullRequest synchronize → pr_rebased', () => {
    const ev = makeEvent('6', 'PullRequestEvent', prPayload('synchronize'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_rebased');
  });

  it('CheckRunEvent success → pr_checks_passed', () => {
    const ev = makeEvent('7', 'CheckRunEvent', checkPayload('success'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_checks_passed');
  });

  it('CheckRunEvent failure → pr_checks_failed', () => {
    const ev = makeEvent('8', 'CheckRunEvent', checkPayload('failure'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_checks_failed');
  });

  it('CheckRunEvent action_required → pr_checks_failed', () => {
    const ev = makeEvent('9', 'CheckRunEvent', checkPayload('action_required'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_checks_failed');
  });

  it('CheckSuiteEvent success → pr_checks_passed', () => {
    const ev = makeEvent('10', 'CheckSuiteEvent', checkPayload('success'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_checks_passed');
  });

  it('CheckSuiteEvent failure → pr_checks_failed', () => {
    const ev = makeEvent('11', 'CheckSuiteEvent', checkPayload('failure'));
    expect(mapGitHubEventToPostType(ev)).toBe('pr_checks_failed');
  });

  it('PushEvent → null (unsupported)', () => {
    const ev = makeEvent('12', 'PushEvent', { ref: 'refs/heads/main', commits: [] });
    expect(mapGitHubEventToPostType(ev)).toBeNull();
  });

  it('WatchEvent → null (unsupported)', () => {
    const ev = makeEvent('13', 'WatchEvent', { action: 'started' });
    expect(mapGitHubEventToPostType(ev)).toBeNull();
  });

  it('CheckRunEvent with neutral conclusion → null', () => {
    const ev = makeEvent('14', 'CheckRunEvent', checkPayload('neutral'));
    expect(mapGitHubEventToPostType(ev)).toBeNull();
  });

  it('PullRequest with unknown action → null', () => {
    const ev = makeEvent('15', 'PullRequestEvent', prPayload('labeled'));
    expect(mapGitHubEventToPostType(ev)).toBeNull();
  });
});
