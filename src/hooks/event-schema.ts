// AO lifecycle event schema — shared types for PR event hooks

export const NOVEL_TRIGGER_EVENT_TYPES = [
  'pr_opened',
  'pr_reopened',
  'pr_merged',
  'pr_closed',
] as const;

export type NovelTriggerEventType = (typeof NOVEL_TRIGGER_EVENT_TYPES)[number];

export const NOVEL_SKIP_EVENT_TYPES = [
  'pr_review_requested',
  'pr_comment',
  'pr_reviewed',
  'pr_checks_started',
  'pr_checks_passed',
  'pr_checks_failed',
] as const;

export type NovelSkipEventType = (typeof NOVEL_SKIP_EVENT_TYPES)[number];

/** All known AO PR event types */
export type PrEventType =
  | NovelTriggerEventType
  | NovelSkipEventType
  | 'pr_draft_toggled'
  | 'pr_reopened';

/** A single PR lifecycle event emitted by the AO lifecycle hook runner */
export interface PrEvent {
  type: PrEventType;
  /** GitHub repository in "owner/name" format */
  repo: string;
  /** Pull request number */
  pr: number;
  /** AO worker session identifier (e.g. "ao-826", "gh-actions-12345") */
  session: string;
  /** Git branch name (e.g. "feat/x", "fix/y") */
  branch: string;
}
