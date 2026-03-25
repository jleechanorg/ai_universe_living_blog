/**
 * Novel Engine — orchestrates the multi-pass novel writing pipeline.
 *
 * Pipeline:
 *   1. Branch/PR entry: generate → post to blog
 *   2. Daily summary: fetch day's posts → generate → top-level editor pass → post to blog
 *
 * The engine is stateless — callers provide repoKey, sessionId, and blog storage.
 * Each run is independent and idempotent for the same branch+date.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import type { RepoKey, BlogStorage } from '../shared/types.js';
import { createBlogToolHandlers } from '../blog/tools.js';
import { generateBranchEntry, makeBranchEntryMetadata, type BranchContext } from './branch-generator.js';
import { generateDailySummary, fetchDailyPosts, estimateDayNumber, type DailySummaryContext } from './daily-generator.js';
import { topLevelEditorPass, type EditorConfig } from './top-level-editor.js';
import { pickTraceabilityBeads, pickDailySummaryBeads } from './beads.js';

export interface NovelEngineConfig {
  /** GitHub repo in owner/name format */
  repoKey: RepoKey;
  /** AO session ID for this run */
  sessionId: string;
  /** Current branch name */
  branchName: string;
  /** Blog storage instance */
  storage: BlogStorage;
  /** Poster ID for novel entries (defaults to sessionId) */
  posterId?: string;
  /** Top-level editor config */
  editor?: EditorConfig;
}

/**
 * Generate and post a branch/PR novel entry.
 *
 * Called at the end of every AO worker session (per branch, per PR).
 * Posts as 'novel_branch_entry' event type.
 */
export async function runBranchEntryPipeline(
  config: NovelEngineConfig,
  context: BranchContext,
): Promise<{ postId: string; wordCount: number; beadIds: string[] }> {
  const posterId = config.posterId ?? config.sessionId;
  const beads = pickTraceabilityBeads();
  const tools = createBlogToolHandlers({ storage: config.storage, agentId: config.sessionId });

  logger.info('Branch entry pipeline', {
    sessionId: config.sessionId,
    branchName: config.branchName,
    repoKey: config.repoKey,
    prNumber: context.prNumber,
  });

  // Step 1: Generate raw entry
  const rawContent = generateBranchEntry(context);
  const rawWordCount = rawContent.split(/\s+/).length;

  logger.debug('Raw branch entry generated', { wordCount: rawWordCount });

  // Step 2: Optional top-level editor pass (if API key available)
  let finalContent = rawContent;
  let wordCount = rawWordCount;
  let usedBeadIds = beads;

  if (config.editor) {
    const edited = await topLevelEditorPass(rawContent, {
      dayNumber: estimateDayNumber(new Date().toISOString().split('T')[0]),
      date: new Date().toISOString().split('T')[0],
      branchName: config.branchName,
      repoKey: config.repoKey,
      sessionId: config.sessionId,
      isBranchEntry: true,
      isDailySummary: false,
    }, config.editor);

    finalContent = edited.editedContent;
    wordCount = edited.wordCount;
    usedBeadIds = edited.beadIds.length > 0 ? edited.beadIds : beads;

    logger.info('Editor pass result', {
      wordCount,
      povCount: edited.povCount,
      beadIds: usedBeadIds,
      notes: edited.editorialNotes,
    });
  }

  // Step 3: Post to blog
  const threadId = uuidv4();
  const title = `[${config.branchName}] ${context.prNumber ? `PR #${context.prNumber}` : 'branch work'} — ${context.eventType.replace('pr_', '')}`;

  const toolResult = await tools.create_post({
      repoKey: config.repoKey,
      posterId,
      title,
      content: finalContent,
      eventType: 'novel_branch_entry',
      threadId,
      tags: ['novel', 'branch-entry', ...usedBeadIds],
      metadata: {
        ...makeBranchEntryMetadata({ ...context, wordCount }, usedBeadIds),
        wordCount,
        beadIds: usedBeadIds,
      },
    },
  );

  const parsed = JSON.parse(toolResult.content[0].text) as { success?: boolean; post?: { id: string } };
  if (!parsed.success || !parsed.post) {
    throw new Error(`Failed to post branch entry: ${toolResult.content[0].text}`);
  }

  logger.info('Branch entry posted to blog', { postId: parsed.post.id, wordCount });

  return { postId: parsed.post.id, wordCount, beadIds: usedBeadIds };
}

/**
 * Generate and post the daily community novel summary.
 *
 * Called once per day (e.g., via cron or AO supervisor).
 * Fetches all posts for the day, synthesizes into collective narrative,
 * runs the top-level editor pass, and posts as 'novel_daily_summary'.
 *
 * If today has fewer than 3 posts, skips posting (nothing to synthesize).
 */
export async function runDailySummaryPipeline(
  config: NovelEngineConfig,
  date?: string,
): Promise<{ postId?: string; wordCount?: number; skipped?: boolean; reason?: string }> {
  const posterId = config.posterId ?? config.sessionId;
  const targetDate = date ?? new Date().toISOString().split('T')[0];
  const dayNumber = estimateDayNumber(targetDate);
  const tools = createBlogToolHandlers({ storage: config.storage, agentId: config.sessionId });

  logger.info('Daily summary pipeline', { repoKey: config.repoKey, date: targetDate, dayNumber });

  // Step 1: Fetch all posts for this day
  const posts = await fetchDailyPosts(config.storage, config.repoKey, targetDate);

  if (posts.length < 3) {
    logger.info('Daily summary skipped — fewer than 3 posts today', { postCount: posts.length });
    return { skipped: true, reason: `Only ${posts.length} posts (need ≥3)` };
  }

  logger.debug('Daily posts fetched', { postCount: posts.length });

  // Step 2: Generate raw daily summary
  const summaryContext: DailySummaryContext = {
    repoKey: config.repoKey,
    date: targetDate,
    posts,
    dayNumber,
  };

  const rawContent = generateDailySummary(summaryContext);
  const rawWordCount = rawContent.split(/\s+/).length;

  logger.debug('Raw daily summary generated', { wordCount: rawWordCount });

  // Step 3: Top-level editor pass (required for daily — must be 1000+ words)
  const editorConfig = config.editor ?? {};

  const edited = await topLevelEditorPass(rawContent, {
    dayNumber,
    date: targetDate,
    branchName: 'collective',
    repoKey: config.repoKey,
    sessionId: config.sessionId,
    isBranchEntry: false,
    isDailySummary: true,
  }, editorConfig);

  const finalContent = edited.editedContent;
  const wordCount = edited.wordCount;
  const usedBeadIds = edited.beadIds.length > 0 ? edited.beadIds : pickDailySummaryBeads(dayNumber);

  if (wordCount < 900) {
    logger.warn('Daily summary under 1000 words after edit — posting anyway', { wordCount });
  }

  logger.info('Daily summary editor pass complete', {
    wordCount,
    povCount: edited.povCount,
    beadIds: usedBeadIds,
  });

  // Step 4: Post to blog
  const threadId = uuidv4();
  const title = `Day ${dayNumber} — ${targetDate} community summary`;

  const toolResult = await tools.create_post({
      repoKey: config.repoKey,
      posterId,
      title,
      content: finalContent,
      eventType: 'novel_daily_summary',
      threadId,
      tags: ['novel', 'daily-summary', `day-${dayNumber}`, ...usedBeadIds],
      metadata: {
        wordCount,
        beadIds: usedBeadIds,
        dayNumber,
        postCount: posts.length,
      },
    },
  );

  const parsed = JSON.parse(toolResult.content[0].text) as { success?: boolean; post?: { id: string } };
  if (!parsed.success || !parsed.post) {
    throw new Error(`Failed to post daily summary: ${toolResult.content[0].text}`);
  }

  logger.info('Daily summary posted to blog', { postId: parsed.post.id, wordCount });

  return { postId: parsed.post.id, wordCount };
}
