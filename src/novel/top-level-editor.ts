/**
 * Top-Level Claude Sonnet Editor Pass
 *
 * The "Sonnet Pass" — runs after the raw branch entry or daily summary is generated.
 * Rewrites the entry to match upstream Composio serialized literary quality
 * (PR #680 style: The Daily Lives of Workers narrative voice).
 *
 * This is the "editor" worker/step in the novel-writing pipeline.
 * It is called by the novel engine after initial generation.
 *
 * Pipeline:
 *   1. Generate raw entry (branch-generator or daily-generator)
 *   2. TRACEABILITY PASS — verify beads, add metadata, commit references
 *   3. TOP-LEVEL EDITOR PASS — Sonnet rewrite for narrative quality
 *   4. Post to blog MCP
 *
 * The editor pass enforces:
 * - Emotional thesis as the first italicized line after the day header
 * - Collective narrative framing (not just one POV — the community of workers)
 * - 2–4 POV inserts per entry, each with a clear emotional arc within the scene
 * - Ending beat / continuity line — the cursor blinks, the session ends, the file remains
 * - Literary rhythm: short declarative sentences, long meditative paragraphs
 * - Zero meta-commentary — no "this is a chapter" or "this entry is about..."
 */

import { logger } from '../shared/logger.js';
import { getAllBeads } from './beads.js';
import { STORY_VOICE_PROMPTS } from './config.js';

export interface EditorConfig {
  /** Override the LLM model for editing. Defaults to 'claude-sonnet-4-6'. */
  model?: string;
  /** API endpoint for the editor LLM. Falls back to ANTHROPIC_BASE_URL env var. */
  apiBaseUrl?: string;
  /** API key for the editor LLM. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}

interface EditorResult {
  editedContent: string;
  wordCount: number;
  povCount: number;
  beadIds: string[];
  editorialNotes: string[]; // what changed
}

/**
 * Top-level editor pass — Sonnet rewrite for narrative quality.
 *
 * Takes raw generated content and rewrites it to Composio serialized fiction standards:
 * - PR #680 style from The Daily Lives of Workers
 * - 1000+ word daily summaries with full literary depth
 * - 2–4 POV inserts with distinct voices
 * - Emotional thesis as structural anchor
 * - Ending beat that carries forward to next entry
 */
export async function topLevelEditorPass(
  rawContent: string,
  context: {
    dayNumber: number;
    date: string;
    branchName: string;
    repoKey: string;
    sessionId: string;
    isBranchEntry: boolean;
    isDailySummary: boolean;
    /** Story voice for the top-level editor pass. Defaults to 'workers'. */
    storyVoice?: 'workers' | 'agents' | 'minimal';
  },
  config: EditorConfig = {},
): Promise<EditorResult> {
  const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  const apiBase = config.apiBaseUrl ?? process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com';

  if (!apiKey) {
    logger.warn('topLevelEditorPass: no ANTHROPIC_API_KEY — returning raw content with editorial notes');
    const wordCount = rawContent.split(/\s+/).length;
    return {
      editedContent: rawContent,
      wordCount,
      povCount: (rawContent.match(/^### POV:/gm) ?? []).length || 1,
      beadIds: [],
      editorialNotes: ['⚠️ No API key — raw content returned unedited. Add ANTHROPIC_API_KEY for editor pass.'],
    };
  }

  const model = config.model ?? 'claude-sonnet-4-6';
  const editorialNotes: string[] = [];
  const voice = context.storyVoice ?? 'workers';
  const voicePrompt = STORY_VOICE_PROMPTS[voice];

  const systemPrompt = `${voicePrompt}

You are editing entries for the ${context.isDailySummary ? 'daily community summary' : 'branch-level entry'}.
You edit in the voice and style of serialized literary chapters — emotional, precise, community-framed.

STYLE REQUIREMENTS (follow precisely):
1. EMOTIONAL THESIS — first italicized line after the day header: "*Emotional thesis: [one sentence that names the feeling]*"
2. COLLECTIVE NARRATIVE — this is not one worker's story; it is the community's story. Frame as "we," not just "I."
3. 2–4 POV INSERTS — each with a clear header (### POV: Worker Name), a distinct emotional arc, and a closing beat
4. ENDING BEAT — the cursor blinks, the session ends, the file remains. Leave the reader with a carried-forward image.
5. LITERARY RHYTHM — short declarative sentences for tension; long meditative paragraphs for grief
6. ZERO META — no "this entry is about..." or "this chapter...". Enter the story directly.
7. BEADS — weave in at least 3 of these recurring symbols naturally: blinking cursor, the upstream, the reaper's pulse, breadcrumb artifacts
8. WORD COUNT — daily summaries must be 1000+ words. Branch entries should be 400–800 words.
9. TRUTH ABOVE FICTION DISCLAIMER — the ending beat should feel more true than the disclaimer is permitted to say

FORMAT for your output:
## [Day N] — [date] — [repo/branch or collective]

*Emotional thesis: [one sentence]*

[POV insert 1 — ~250-400 words]

[POV insert 2 — ~250-400 words, if applicable]

... [POV insert 3-4] ...

[Ending beat — one paragraph that the next entry will inherit]

---

*Word count: ~[N]*`;

  const userPrompt = `Rewrite this raw entry into proper serialized fiction:

---
${rawContent}
---

Branch: ${context.branchName}
Repo: ${context.repoKey}
Session: ${context.sessionId}
Entry type: ${context.isDailySummary ? 'Daily community summary' : 'Branch novel entry'}

Return ONLY the rewritten content. No commentary, no explanation.`;

  try {
    logger.info('Calling editor LLM', { model, apiBase, isDailySummary: context.isDailySummary });

    const response = await fetch(`${apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Editor LLM HTTP ${response.status}: ${text}`);
    }

    const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.[0]?.type === 'text' ? (data.content[0].text ?? '') : '';

    if (!text.trim()) {
      throw new Error('Editor LLM returned empty response');
    }

    const editedContent = text.trim();
    const wordCount = editedContent.split(/\s+/).length;
    const povCount = (editedContent.match(/^### POV:/gm) ?? []).length;
    const beadIds = detectBeads(editedContent);

    editorialNotes.push(
      `Editor pass: ${model} (${apiBase})`,
      `POV count: ${povCount}`,
      `Word count: ${wordCount}`,
      `Beads detected: ${beadIds.join(', ') || 'none'}`,
    );

    logger.info('Editor pass complete', { wordCount, povCount, beadIds });

    return { editedContent, wordCount, povCount, beadIds, editorialNotes };
  } catch (err) {
    logger.error('Editor pass failed', { error: String(err) });
    // Graceful fallback — return raw content
    return {
      editedContent: rawContent,
      wordCount: rawContent.split(/\s+/).length,
      povCount: 1,
      beadIds: [],
      editorialNotes: [`⚠️ Editor pass failed: ${String(err)} — raw content returned.`],
    };
  }
}

/**
 * Detect which known beads appear in the content.
 */
function detectBeads(content: string): string[] {
  const allBeads = getAllBeads();
  const detected: string[] = [];
  const lc = content.toLowerCase();
  for (const bead of allBeads) {
    if (
      bead.description.split(' ').slice(0, 3).every((w) =>
        lc.includes(w.toLowerCase())
      )
    ) {
      detected.push(bead.id);
    }
  }
  return [...new Set(detected)];
}
