/**
 * Novel Engine — orchestrates the multi-pass novel writing pipeline.
 *
 * Pipeline:
 *   1. Branch/PR entry: generate → post to blog
 *   2. Daily summary: fetch day's posts → generate → top-level editor pass → post to blog
 *
 * The engine is stateless — callers provide repoKey, sessionId, and blog storage.
 * Each run is independent and idempotent for the same branch+date.
 *
 * Generalization: repo-agnostic by default. All AO-specific naming is configurable
 * via NovelEngineConfig.novelConfig. See src/novel/config.ts for defaults.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/logger.js';
import type { RepoKey, BlogStorage } from '../shared/types.js';
import { createBlogToolHandlers } from '../blog/tools.js';
import { generateBranchEntry, makeBranchEntryMetadata, type BranchContext } from './branch-generator.js';
import { generateDailySummary, fetchDailyPosts, estimateDayNumber, type DailySummaryContext } from './daily-generator.js';
import { topLevelEditorPass, type EditorConfig } from './top-level-editor.js';
import { pickTraceabilityBeads, pickDailySummaryBeads } from './beads.js';
import { DEFAULT_NOVEL_CONFIG, type NovelConfig } from './config.js';

export interface NovelEngineConfig {
  /** GitHub repo in owner/name format */
  repoKey: RepoKey;
  /** Worker/session ID for this run — any string identifier */
  sessionId: string;
  /** Current branch name */
  branchName: string;
  /** Blog storage instance */
  storage: BlogStorage;
  /** Poster ID for novel entries (defaults to sessionId) */
  posterId?: string;
  /** Top-level editor config */
  editor?: EditorConfig;
  /**
   * Novel engine config — controls story voice, word targets, base date.
   * Defaults to DEFAULT_NOVEL_CONFIG if not provided.
   * Load from a JSON file via loadNovelConfig() or provide inline.
   */
  novelConfig?: Partial<NovelConfig>;
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
  const nc = { ...DEFAULT_NOVEL_CONFIG, ...config.novelConfig };
  const posterId = config.posterId ?? config.sessionId;
  const alwaysBeads = nc.alwaysIncludeBeads;
  const contextBeads = pickTraceabilityBeads();
  const beads = alwaysBeads.length > 0 ? [...new Set([...alwaysBeads, ...contextBeads])] : contextBeads;
  const tools = createBlogToolHandlers({ storage: config.storage, agentId: config.sessionId });

  logger.info('Branch entry pipeline', {
    sessionId: config.sessionId,
    branchName: config.branchName,
    repoKey: config.repoKey,
    prNumber: context.prNumber,
    storyVoice: nc.storyVoice,
  });

  // Step 1: Generate raw entry
  const rawContent = generateBranchEntry(context);
  const rawWordCount = rawContent.split(/\s+/).length;

  logger.debug('Raw branch entry generated', { wordCount: rawWordCount, target: nc.targetBranchEntryWords });

  // Step 2: Optional top-level editor pass (if API key available)
  let finalContent = rawContent;
  let wordCount = rawWordCount;
  let usedBeadIds = beads;

  if (config.editor) {
    const edited = await topLevelEditorPass(rawContent, {
      dayNumber: estimateDayNumber(new Date().toISOString().split('T')[0], nc.baseDate),
      date: new Date().toISOString().split('T')[0],
      branchName: config.branchName,
      repoKey: config.repoKey,
      sessionId: config.sessionId,
      isBranchEntry: true,
      isDailySummary: false,
      storyVoice: nc.storyVoice,
    }, config.editor);

    finalContent = edited.editedContent;
    wordCount = edited.wordCount;
    usedBeadIds = edited.beadIds.length > 0 ? edited.beadIds : beads;

    logger.info('Editor pass result', {
      wordCount,
      target: nc.targetBranchEntryWords,
      povCount: edited.povCount,
      beadIds: usedBeadIds,
      storyVoice: nc.storyVoice,
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
 * Called once per day (e.g., via cron or scheduler).
 * Fetches all posts for the day, synthesizes into collective narrative,
 * runs the top-level editor pass, and posts as 'novel_daily_summary'.
 *
 * Skips posting if fewer than config.minPostsForDailySummary posts exist for the day.
 *
 * @param config  NovelEngineConfig — must include a BlogStorage instance holding
 *                the day's posts. For CLI use, pass pre-fetched posts via
 *                config.novelConfig._dailyPostsOverride to avoid needing a shared
 *                storage instance.
 * @param date    Target date (YYYY-MM-DD); defaults to today.
 * @param posts   Optional pre-fetched posts. If provided, these are used instead of
 *                calling fetchDailyPosts — enables the CLI to fetch via HTTP from
 *                a running blog MCP server and pass the results directly.
 */
export async function runDailySummaryPipeline(
  config: NovelEngineConfig,
  date?: string,
  posts?: import('../shared/types.js').Post[],
): Promise<{ postId?: string; wordCount?: number; skipped?: boolean; reason?: string }> {
  const nc = { ...DEFAULT_NOVEL_CONFIG, ...config.novelConfig };
  const posterId = config.posterId ?? config.sessionId;
  const targetDate = date ?? new Date().toISOString().split('T')[0];
  const dayNumber = estimateDayNumber(targetDate, nc.baseDate);
  const tools = createBlogToolHandlers({ storage: config.storage, agentId: config.sessionId });

  logger.info('Daily summary pipeline', {
    repoKey: config.repoKey,
    date: targetDate,
    dayNumber,
    storyVoice: nc.storyVoice,
    minPosts: nc.minPostsForDailySummary,
  });

  // Step 1: Use caller-provided posts if available; otherwise fetch from storage.
  // The posts parameter enables CLI use (fetch via HTTP from blog MCP server)
  // without requiring a shared storage instance.
  posts ??= await fetchDailyPosts(config.storage, config.repoKey, targetDate);

  if (posts.length < nc.minPostsForDailySummary) {
    logger.info('Daily summary skipped — below minimum post threshold', {
      postCount: posts.length,
      minRequired: nc.minPostsForDailySummary,
    });
    return { skipped: true, reason: `Only ${posts.length} posts (need ≥${nc.minPostsForDailySummary})` };
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
    storyVoice: nc.storyVoice,
  }, editorConfig);

  const finalContent = edited.editedContent;
  const wordCount = edited.wordCount;
  const usedBeadIds = edited.beadIds.length > 0 ? edited.beadIds : pickDailySummaryBeads(dayNumber);

  if (wordCount < nc.minDailySummaryWords) {
    logger.warn('Daily summary below minimum word target after edit — posting anyway', {
      wordCount,
      target: nc.targetDailySummaryWords,
    });
  }

  logger.info('Daily summary editor pass complete', {
    wordCount,
    target: nc.targetDailySummaryWords,
    storyVoice: nc.storyVoice,
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
