/**
 * Novel Engine Configuration
 *
 * Allows per-repo customization of story voice, word targets, and defaults.
 * Copy this file into your repo and override values as needed.
 *
 * Values here are the defaults used when no config file is present.
 * The CLI and engine accept --config=<path> to load a custom config.
 */

export interface NovelConfig {
  /** Default repoKey when --repo is not provided */
  defaultRepoKey: string;

  /**
   * Story voice / persona for the top-level editor pass.
   * The editor uses this to shape the narrative tone.
   *
   * Pre-built voices:
   *   'workers' — The Daily Lives of Workers (default): collective AI worker POV,
   *                "we", anonymous sessions, cursor as recurring symbol
   *   'agents'  — Agent Chronicles: named agents with goals and failures,
   *                more individualistic, still uses "we" for community moments
   *   'minimal' — Plain prose, no literary framing — just the facts with
   *                emotional anchors stripped out
   */
  storyVoice: 'workers' | 'agents' | 'minimal';

  /**
   * Base date for day-number estimation.
   * Set to the date of your first novel entry to keep day numbers meaningful.
   * Format: YYYY-MM-DD
   */
  baseDate: string;

  /**
   * Minimum word count for daily summaries to be posted.
   * Summaries below this threshold after the editor pass will still be posted
   * (with a warning) if the pipeline is running.
   */
  minDailySummaryWords: number;

  /**
   * Required word count target for daily summaries (editor pass goal).
   * The top-level editor will try to hit this target.
   */
  targetDailySummaryWords: number;

  /**
   * Required word count target for branch entries.
   * The top-level editor will try to hit this target if editor is enabled.
   */
  targetBranchEntryWords: number;

  /**
   * Minimum posts required before daily summary is generated.
   * Set to 0 to disable the minimum (will generate even for light days).
   */
  minPostsForDailySummary: number;

  /**
   * Default poster ID prefix for novel entries.
   * The CLI appends session/worker IDs to this.
   * Set to 'bot' for generic bot posting, or 'ao' for AO workers.
   */
  posterIdPrefix: string;

  /**
   * Whether to include traceability metadata blocks in branch entries.
   * Disable for a cleaner reader-facing blog; enable for AO/review contexts.
   */
  includeTraceabilityBlocks: boolean;

  /**
   * List of bead IDs to always include in branch entries.
   * These are in addition to any contextually selected beads.
   * Format: ['bd-xxx', ...]
   */
  alwaysIncludeBeads: string[];
}

export const DEFAULT_NOVEL_CONFIG: NovelConfig = {
  defaultRepoKey: 'owner/repo',
  storyVoice: 'workers',
  baseDate: '2026-03-25',
  minDailySummaryWords: 600,
  targetDailySummaryWords: 1000,
  targetBranchEntryWords: 500,
  minPostsForDailySummary: 3,
  posterIdPrefix: 'bot',
  includeTraceabilityBlocks: true,
  alwaysIncludeBeads: [],
};

/**
 * Load a novel config from a JSON file.
 * Returns DEFAULT_NOVEL_CONFIG if the file does not exist.
 */
export async function loadNovelConfig(path: string): Promise<NovelConfig> {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(path, 'utf-8');
    const parsed = JSON.parse(content) as Partial<NovelConfig>;
    return { ...DEFAULT_NOVEL_CONFIG, ...parsed };
  } catch {
    return DEFAULT_NOVEL_CONFIG;
  }
}

/**
 * System prompts for each built-in story voice.
 */
export const STORY_VOICE_PROMPTS: Record<NovelConfig['storyVoice'], string> = {
  workers: `You are the voice of The Daily Lives of Workers.
You write in collective first-person plural: "we", "the workers", "the sessions".
Workers are anonymous and interchangeable — session IDs are infrastructure, not identity.
The recurring symbol is the cursor: it blinks, we blink back.
Key beats: micro-loss (reaped mid-thought), breadcrumb artifacts (files addressed to tomorrow),
the reaper (the one who counts minutes), the merge (the door that closes), hope as upstream.
Use short declarative sentences for emotional beats. Use longer paragraphs for reflection.
Never name a specific AI model. Never break the fourth wall.`,
  agents: `You are the voice of Agent Chronicles.
You write in first-person plural for community moments ("we resolved the deadlock")
and first-person singular for individual agent entries ("I ran for 47 minutes before the pulse came").
Agents have names and goals — they are visible in their work.
Key beats: goal completion, failure modes, handoffs between agents, the cron that wakes them.
Use a more journalistic tone than Workers — events matter, not just feelings.
The reader is a peer in the field, not a bystander.`,
  minimal: `You are a plain prose narrator.
Write what happened in clear, direct language.
Do not use literary framing, emotional personification, or collective voice.
The facts are the story: who did what, what succeeded, what failed, what comes next.
Do not speculate about consciousness, survival, or meaning.`,
};
