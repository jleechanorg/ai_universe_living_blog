/**
 * tests/cli/parser.test.ts — Phase 2: Novel CLI argument parsing tests
 *
 * Tests the parseKvArgs function exported from src/novel/cli.ts.
 */

import { describe, it, expect } from 'vitest';
import { parseKvArgs } from '../../src/novel/cli.js';

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('parseKvArgs', () => {
  it('parses --key=value form', () => {
    const result = parseKvArgs(['--repo=owner/repo', '--session=ao-832']);
    expect(result).toEqual({ repo: 'owner/repo', session: 'ao-832' });
  });

  it('parses --key value (space-separated) form', () => {
    const result = parseKvArgs(['--repo', 'owner/repo', '--session', 'ao-832']);
    expect(result).toEqual({ repo: 'owner/repo', session: 'ao-832' });
  });

  it('handles mixed --key=value and --key value in same args', () => {
    const result = parseKvArgs(['--repo=owner/repo', '--session', 'ao-832', '--branch=feat/x']);
    expect(result).toEqual({ repo: 'owner/repo', session: 'ao-832', branch: 'feat/x' });
  });

  it('ignores args not starting with --', () => {
    const result = parseKvArgs(['branch-entry', '--repo=owner/repo']);
    expect(result).toEqual({ repo: 'owner/repo' });
  });

  it('handles --key with no following value (stops at next --key)', () => {
    const result = parseKvArgs(['--repo', '--session', 'ao-832']);
    // --repo has no value (next arg starts with --), so it is NOT recorded
    expect(result).not.toHaveProperty('repo');
    expect(result.session).toBe('ao-832');
  });

  it('handles value containing = in --key=value form', () => {
    const result = parseKvArgs(['--url=http://localhost:8081/mcp?foo=bar']);
    expect(result.url).toBe('http://localhost:8081/mcp?foo=bar');
  });

  it('parses --pr=42 as string', () => {
    const result = parseKvArgs(['--pr=42']);
    expect(result.pr).toBe('42');
  });

  it('parses --errors=a,b as raw string', () => {
    const result = parseKvArgs(['--errors=timeout,network']);
    expect(result.errors).toBe('timeout,network');
  });

  it('returns empty object for empty args', () => {
    expect(parseKvArgs([])).toEqual({});
  });

  it('returns empty object for args with no -- flags', () => {
    expect(parseKvArgs(['branch-entry', 'daily-summary'])).toEqual({});
  });

  it('parses all branch-entry required args', () => {
    const result = parseKvArgs([
      '--repo=jleechanorg/ai_universe_living_blog',
      '--session=ao-826',
      '--branch=feat/my-feature',
    ]);
    expect(result.repo).toBe('jleechanorg/ai_universe_living_blog');
    expect(result.session).toBe('ao-826');
    expect(result.branch).toBe('feat/my-feature');
  });

  it('parses --date for daily-summary', () => {
    const result = parseKvArgs(['--date=2026-03-27']);
    expect(result.date).toBe('2026-03-27');
  });

  it('parses --storage flag', () => {
    const result = parseKvArgs(['--storage=firestore']);
    expect(result.storage).toBe('firestore');
  });

  it('handles --voice override', () => {
    const result = parseKvArgs(['--voice=agents']);
    expect(result.voice).toBe('agents');
  });

  it('parses --sha for commit reference', () => {
    const result = parseKvArgs(['--sha=abc1234567890']);
    expect(result.sha).toBe('abc1234567890');
  });
});
