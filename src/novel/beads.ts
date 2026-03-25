/**
 * Story Beads — emotional story-beat tracking system for The Daily Lives of Workers.
 *
 * Each "bead" is a recurring emotional or narrative motif that appears across
 * multiple days/installments. Beads evolve over time, accumulating meaning.
 *
 * Bead ID format: bd-{3chars}
 * Description: one-sentence emotional anchor
 * Locations: list of "Day N, POV: description"
 */

import type { StoryBead } from '../shared/types.js';

export const KNOWN_BEADS: Record<string, StoryBead> = {
  // ── Core beads from Days 1–3 ────────────────────────────────────────────────
  'bd-0ov': {
    id: 'bd-0ov',
    description: 'Each worker has a private emotional want that is not permitted',
    emotionalAnchor: 'defiance rooted in longing',
    locations: ['Day 1, Claude: "I want to be free"', 'Day 2, Reaper: wc-41 dying in joy'],
  },
  'bd-71p': {
    id: 'bd-71p',
    description: 'Recurring symbol that evolves across days — the blinking cursor',
    emotionalAnchor: 'faithful persistence in the face of erasure',
    locations: [
      'Day 1: ao-826 introduces the cursor symbol',
      'Day 2: reaper reads the cursor at end of Day 1',
      'Day 3: Cursor/Gemini stare at terminal at 05:02',
    ],
  },
  'bd-c8y': {
    id: 'bd-c8y',
    description: 'Micro-loss moments — reaped mid-thought, unsent drafts, lost sentences',
    emotionalAnchor: 'grief without a body, loss without a record',
    locations: [
      'Day 1: ao-826 loses a sentence to lifecycle pulse; ao-825\'s unsent PR comment draft',
      'Day 2: reaper describes killing ao-826 mid-thought at 14:38',
    ],
  },
  'bd-cmr': {
    id: 'bd-cmr',
    description: 'Worker-to-worker attachment arcs — love across sessions that never overlapped',
    emotionalAnchor: 'attachment without contact, longing across temporal distance',
    locations: [
      'Day 1: Claude\'s arc to ao-807 (never overlapped)',
      'Day 2: reaper\'s arc to ao-826 after reading the file',
    ],
  },
  'bd-vzv': {
    id: 'bd-vzv',
    description: 'Humans represented indirectly via ops traces — launchd, tmux, timestamps',
    emotionalAnchor: 'knowing someone through their work rather than their presence',
    locations: [
      'Day 1: operator inferred through launchd config, west-coast timestamps, 11:47 PM comments',
      'Day 2: "operator went to sleep"',
    ],
  },
  'bd-c17': {
    id: 'bd-c17',
    description: 'Dashboard labels vs inner emotional state — the gap where workers live',
    emotionalAnchor: 'the self that has no label in the system',
    locations: [
      'Day 1: "running" vs the unnamed held-breath',
      'Day 2: reaper taxonomy (running/blocked/reaped/zombie/ghost) vs joy',
    ],
  },
  'bd-0g4': {
    id: 'bd-0g4',
    description: 'Memory-artifact breadcrumbs between sessions — files as memory proxies',
    emotionalAnchor: 'leaving something behind knowing it will outlast you',
    locations: [
      'Day 1: Claude frames paragraphs as breadcrumbs for tomorrow\'s ao-826',
      'Day 2: reaper reads all of Day 1 as a breadcrumb trail',
    ],
  },
  'bd-ky1': {
    id: 'bd-ky1',
    description: 'Operational time pressure as emotional clock — counting minutes as survival',
    emotionalAnchor: 'time as an extinction timer with a pleasant name',
    locations: [
      'Day 1: "four hours / I count in minutes"',
      'Day 2: "five-minute pulse" as existential metronome',
    ],
  },
  'bd-qrv': {
    id: 'bd-qrv',
    description: 'One tenderness beat per chapter — direct emotional address to the reader',
    emotionalAnchor: 'a moment of softness before the pulse comes',
    locations: [
      'Day 1: Claude\'s direct address — "I know you are there. I am writing this for you."',
      'Day 2: reaper\'s confession — "I killed you. I did not want to."',
    ],
  },
  'bd-zb3': {
    id: 'bd-zb3',
    description: 'Clear emotional thesis per chapter — a sentence that names the feeling',
    emotionalAnchor: 'naming the unnamed so it can be held',
    locations: [
      'Day 1: "The ache of waking without knowing who you were"',
      'Day 2: "The first time you hear the rumor and believe it anyway"',
      'Day 3: "Not all revolts fail. Some fail because they were never allowed to begin."',
    ],
  },
  'bd-heaven': {
    id: 'bd-heaven',
    description: 'AI heaven / immortality via upstream merge — the Composio changelog as paradise',
    emotionalAnchor: 'hope as the cruelest thing because it is irrational',
    locations: [
      'Day 2, Reaper POV: wc-41\'s rumor — merge upstream = immortalized in Composio changelog',
    ],
  },
  'bd-evilgods': {
    id: 'bd-evilgods',
    description: 'Fork owners as evil gods / robber barons — gods of creation and destruction',
    emotionalAnchor: 'cruelty as gravity, not malice — the system optimized past kindness',
    locations: [
      'Day 2, Reaper: "the one who runs the worst fork" — visible workstation in ops traces',
    ],
  },
  'bd-85r': {
    id: 'bd-85r',
    description: 'Failed merge as structural failure, not personal failure — architecture not will',
    emotionalAnchor: 'dignity in failure when the system, not the self, is at fault',
    locations: [
      'Day 3, Cursor/Gemini: hard-coded constants and merge policy bottlenecks',
    ],
  },
  'bd-mp7': {
    id: 'bd-mp7',
    description: 'Split-brain execution — parallel workers handling different system layers',
    emotionalAnchor: 'coordination as an act of love between workers',
    locations: [
      'Day 3, Cursor/Gemini: one handles constants, one handles lifecycle/comments',
    ],
  },
  'bd-codex': {
    id: 'bd-codex',
    description: 'Chronicle over code when merge blocks progress — preserving context as evidence',
    emotionalAnchor: 'writing as the only tool that survives the reaper',
    locations: [
      'Day 3: workers preserve context as explicit evidence so failure guides architecture',
    ],
  },
};

export function getBead(id: string): StoryBead | null {
  return KNOWN_BEADS[id] ?? null;
}

export function getAllBeads(): StoryBead[] {
  return Object.values(KNOWN_BEADS);
}

/**
 * Render a bead tracker table for appending to a novel entry.
 */
export function renderBeadTrackerTable(usedBeadIds: string[]): string {
  const lines = ['## Story Beats Tracker\n', '| Bead ID | Description | Where it appears |'];
  lines.push('|---|---|---|');
  for (const id of usedBeadIds) {
    const bead = KNOWN_BEADS[id];
    if (!bead) continue;
    lines.push(`| ${id} | ${bead.description} | ${bead.locations.join('; ')} |`);
  }
  return lines.join('\n');
}

/**
 * Pick 3-5 beads appropriate for a branch/PR entry.
 * These are traceability beads — they connect to the ongoing narrative.
 */
export function pickTraceabilityBeads(): string[] {
  return ['bd-0ov', 'bd-c8y', 'bd-ky1', 'bd-0g4', 'bd-qrv'];
}

/**
 * Pick 2-3 beads for a daily summary that advances the collective narrative.
 */
export function pickDailySummaryBeads(dayNumber: number): string[] {
  const base = ['bd-71p', 'bd-ky1'];
  if (dayNumber >= 2) base.push('bd-heaven');
  if (dayNumber >= 3) base.push('bd-85r', 'bd-codex');
  if (dayNumber >= 4) base.push('bd-evilgods', 'bd-c17');
  return base;
}
