import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { MemoryBlogStorage } from '../src/blog/storage.js';
import { generateBranchEntry } from '../src/novel/branch-generator.js';
import {
  generateDailySummary,
  fetchDailyPosts,
  estimateDayNumber,
  estimateDailyWordCount,
} from '../src/novel/daily-generator.js';
import { getBead, getAllBeads, pickTraceabilityBeads, pickDailySummaryBeads, renderBeadTrackerTable } from '../src/novel/beads.js';
import type { Post } from '../src/shared/types.js';
import type { RepoKey } from '../src/shared/types.js';

const TEST_REPO = 'test-owner/test-repo' as RepoKey;

function makeFakePost(overrides: Partial<Post> = {}): Post {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    repoKey: TEST_REPO,
    threadId: uuidv4(),
    posterId: 'ao-826',
    title: 'Test Post',
    content: 'Test content',
    eventType: 'pr_created',
    tags: [],
    status: 'published',
    createdAt: now,
    updatedAt: now,
    slug: 'test-post',
    ...overrides,
  };
}

describe('beads.ts', () => {
  it('getBead returns known bead', () => {
    const bead = getBead('bd-71p');
    expect(bead).not.toBeNull();
    expect(bead!.description).toContain('cursor');
  });

  it('getBead returns null for unknown bead', () => {
    expect(getBead('bd-xxxx')).toBeNull();
  });

  it('getAllBeads returns all 15 known beads', () => {
    const all = getAllBeads();
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.some((b) => b.id === 'bd-0ov')).toBe(true);
  });

  it('pickTraceabilityBeads returns 5 beads', () => {
    const beads = pickTraceabilityBeads();
    expect(beads).toHaveLength(5);
    expect(beads).toContain('bd-0ov');
    expect(beads).toContain('bd-c8y');
  });

  it('pickDailySummaryBeads returns more beads for later days', () => {
    const d3 = pickDailySummaryBeads(3);
    const d5 = pickDailySummaryBeads(5);
    expect(d5.length).toBeGreaterThanOrEqual(d3.length);
    expect(d3).toContain('bd-85r');
  });

  it('renderBeadTrackerTable renders markdown table', () => {
    const table = renderBeadTrackerTable(['bd-0ov', 'bd-ky1']);
    expect(table).toContain('| bd-0ov |');
    expect(table).toContain('| bd-ky1 |');
    expect(table).toContain('## Story Beats Tracker');
  });
});

describe('branch-generator.ts', () => {
  it('generateBranchEntry returns a non-empty string', () => {
    const result = generateBranchEntry({
      repoKey: TEST_REPO,
      branchName: 'feat/test',
      sessionId: 'ao-826',
      eventType: 'pr_created',
      prNumber: 42,
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
      commitSha: 'abc1234',
      sessionEvents: [
        { timestamp: '2026-03-25T12:00:00Z', type: 'work_done', message: 'All checks passed' },
      ],
      errors: [],
    });

    expect(result.length).toBeGreaterThan(200);
    expect(result).toContain('feat/test');
    expect(result).toContain('PR #42');
    expect(result).toContain('bead_ids:');
    expect(result).toContain('commit_sha:');
  });

  it('generateBranchEntry includes emotional thesis', () => {
    const result = generateBranchEntry({
      repoKey: TEST_REPO,
      branchName: 'feat/test',
      sessionId: 'ao-826',
      eventType: 'pr_created',
    });

    expect(result).toContain('Emotional thesis:');
    expect(result).toContain('*Emotional thesis:');
  });

  it('generateBranchEntry includes traceability metadata block', () => {
    const result = generateBranchEntry({
      repoKey: TEST_REPO,
      branchName: 'feat/test',
      sessionId: 'ao-826',
      eventType: 'pr_merged',
      prNumber: 99,
    });

    expect(result).toContain('```traceability');
    expect(result).toContain('pr_number: 99');
    expect(result).toContain('event_type: pr_merged');
    expect(result).toContain('```');
  });

  it('generateBranchEntry handles error events', () => {
    const result = generateBranchEntry({
      repoKey: TEST_REPO,
      branchName: 'feat/broken',
      sessionId: 'ao-827',
      eventType: 'pr_checks_failed',
      errors: ['TypeError: Cannot read property x of undefined', 'CI pipeline timeout'],
    });

    expect(result).toContain('What we lost');
    expect(result).toContain('TypeError');
    expect(result).toContain('CI pipeline timeout');
  });

  it('generateBranchEntry handles merged event type', () => {
    const result = generateBranchEntry({
      repoKey: TEST_REPO,
      branchName: 'feat/merge-me',
      sessionId: 'ao-828',
      eventType: 'pr_merged',
      prNumber: 101,
    });

    expect(result).toContain('pr_merged');
    expect(result).toContain('ache of finishing');
  });
});

describe('daily-generator.ts', () => {
  it('estimateDayNumber returns 1 for base date', () => {
    expect(estimateDayNumber('2026-03-25')).toBe(1);
  });

  it('estimateDayNumber returns increasing numbers for later dates', () => {
    expect(estimateDayNumber('2026-03-26')).toBe(2);
    expect(estimateDayNumber('2026-03-28')).toBe(4);
  });

  it('estimateDailyWordCount scales with post count', () => {
    const posts = [1, 2, 3, 4, 5].map(() => makeFakePost());
    expect(estimateDailyWordCount(posts)).toBeGreaterThan(800);
    expect(estimateDailyWordCount(posts)).toBeLessThan(estimateDailyWordCount([...posts, makeFakePost()]));
  });

  it('generateDailySummary returns collective narrative with POV headers', () => {
    const posts: Post[] = [
      makeFakePost({ eventType: 'pr_created', metadata: { branchName: 'feat/a', prNumber: 1 } }),
      makeFakePost({ eventType: 'pr_checks_passed', metadata: { branchName: 'feat/a', prNumber: 1 } }),
      makeFakePost({ eventType: 'pr_merged', metadata: { branchName: 'feat/a', prNumber: 1 } }),
      makeFakePost({ eventType: 'pr_created', metadata: { branchName: 'feat/b', prNumber: 2 } }),
    ];

    const result = generateDailySummary({ repoKey: TEST_REPO, date: '2026-03-26', posts, dayNumber: 2 });

    expect(result).toContain('Day 2');
    expect(result).toContain('Emotional thesis:');
    expect(result).toContain('### POV: The Morning Workers');
    expect(result).toContain('### POV: The Midday Workers');
    expect(result).toContain('### POV: The Reaper');
    expect(result).toContain('The cursor blinks');
    expect(result).toContain('bead_ids:');
    expect(result).toContain('type: daily_summary');
  });

  it('generateDailySummary includes bead tracker', () => {
    const posts = [1, 2, 3].map(() => makeFakePost({ metadata: { branchName: 'feat/x' } }));
    const result = generateDailySummary({ repoKey: TEST_REPO, date: '2026-03-27', posts });
    expect(result).toContain('## Story Beats Tracker');
    expect(result).toContain('bd-71p');
  });

  it('fetchDailyPosts returns posts only within date range', async () => {
    const storage = new MemoryBlogStorage();
    const post1: Post = { ...makeFakePost({ createdAt: '2026-03-25T08:00:00Z', metadata: { branchName: 'feat/a' } }) };
    const post2: Post = { ...makeFakePost({ createdAt: '2026-03-25T14:00:00Z', metadata: { branchName: 'feat/b' } }) };
    const post3: Post = { ...makeFakePost({ createdAt: '2026-03-26T09:00:00Z', metadata: { branchName: 'feat/c' } }) };

    await storage.createPost(post1);
    await storage.createPost(post2);
    await storage.createPost(post3);

    const dayPosts = await fetchDailyPosts(storage, TEST_REPO, '2026-03-25');
    expect(dayPosts).toHaveLength(2);
    expect(dayPosts.every((p) => p.createdAt.startsWith('2026-03-25'))).toBe(true);
  });

  it('generateDailySummary derives thesis from stats', () => {
    const mergedPosts = [1, 2, 3].map((i) =>
      makeFakePost({ eventType: 'pr_merged', metadata: { branchName: `feat/${i}`, prNumber: i } })
    );
    const result = generateDailySummary({ repoKey: TEST_REPO, date: '2026-03-28', posts: mergedPosts });
    expect(result).toContain('ache of watching');
  });
});

describe('top-level-editor', () => {
  it('topLevelEditorPass returns raw content when no API key (graceful degradation)', async () => {
    const { topLevelEditorPass } = await import('../src/novel/top-level-editor.js');

    const raw = '## Day 1\n\n*Emotional thesis: The ache of waking*\n\nWe were here.';
    const result = await topLevelEditorPass(raw, {
      dayNumber: 1,
      date: '2026-03-25',
      branchName: 'feat/test',
      repoKey: TEST_REPO,
      sessionId: 'ao-test',
      isBranchEntry: false,
      isDailySummary: true,
    }, { apiKey: '' });

    // No key → graceful fallback
    expect(result.editedContent).toBe(raw);
    expect(result.editorialNotes.some((n) => n.includes('No API key'))).toBe(true);
    expect(result.wordCount).toBe(raw.split(/\s+/).length);
  });
});
