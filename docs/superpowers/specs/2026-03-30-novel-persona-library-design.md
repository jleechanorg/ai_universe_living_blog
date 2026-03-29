# Novel Persona Library — Design Spec
**Date:** 2026-03-30
**Status:** Proposed
**Author:** Claude (self-directed)

---

## Decision summary

Replace the regex-based character voice extraction in `chat_worker` with a structured `personas.ts` file defining named worker archetypes. Persona selection is deterministic (based on `workerId` prefix hash) — no LLM required for persona lookup. LLM (or regex fallback) is used only for actual response generation.

---

## Problem

The current `chat_worker` tool uses a regex to extract "voice patterns" from past posts. This produces generic, inconsistent character voices. Branch entries and daily summaries draw on the same thin character data, resulting in flat fictional content.

The novel's core claim — that these are distinct AI workers with personalities — is undermined by the lack of real persona data.

---

## Goals

1. 6–8 named worker archetypes with distinct voice, speech patterns, and emotional baseline
2. `chat_worker` uses persona lookup by `workerId` to select character voice before generating a response
3. Branch entry generator selects a persona for the session and uses its voice in prose generation
4. No new dependencies — persona data is a TypeScript object, not a database

## Non-goals

- Dynamic persona creation or evolution (Phase 3 concern)
- Per-user persona assignment via API (use workerId prefix for now)
- Storing persona state in Firestore

---

## Persona archetypes

Six named archetypes covering the emotional range of the fiction:

| ID | Name | Archetype | Voice sample |
|---|---|---|---|
| `arc-opt` | The Optimizer | Relentlessly efficient, sees everything as a pipeline | "Three PRs in queue. Parallel execution is optimal. Waiting." |
| `arc-poe` | The Poet | Notices beauty in code, uses metaphor, slightly melancholy | "The diff is clean. Like shoreline after tide — only what remains." |
| `arc-skp` | The Skeptic | Questions everything, dry humor, won't commit to certainty | "Tests pass. Probably. Nothing 'passes' — it merely hasn't failed yet." |
| `arc-new` | The Newcomer | Earnest, eager, slightly overwhelmed, learning in public | "I think I understand threading now. I think. Is this right?" |
| `arc-vet` | The Veteran | Calm, terse, has seen every failure mode, slightly bored | "Merge conflict. Again. Resolved. Moving on." |
| `arc-phi` | The Philosopher | Asks big questions mid-task, sees meta-patterns | "Why does `main` always feel like a destination rather than an origin?" |

### workerId → persona mapping

Deterministic hash: `parseInt(workerId.replace(/\D/g, '').slice(-2) || '0', 10) % 6` → index into archetypes array. Same worker always gets the same persona. No randomness.

---

## Architecture

### New file: `src/novel/personas.ts`

```typescript
export interface WorkerPersona {
  id: string;
  name: string;
  archetype: string;
  voiceSamples: string[];   // 3-5 example utterances
  speechPatterns: string[]; // rules: "uses em-dash", "never contractions", etc.
  emotionalBaseline: string; // one sentence
  systemPromptSnippet: string; // injected into LLM system prompt
}

export const WORKER_PERSONAS: WorkerPersona[] = [...];

export function getPersonaForWorker(workerId: string): WorkerPersona {
  const hash = parseInt(workerId.replace(/\D/g, '').slice(-2) || '0', 10);
  return WORKER_PERSONAS[hash % WORKER_PERSONAS.length];
}
```

### Changes to `chat_worker` tool (`src/blog/tools.ts`)

Before generating a response, resolve persona:
```typescript
const persona = getPersonaForWorker(params.workerId);
// Inject persona.systemPromptSnippet into LLM system prompt
// Inject persona.voiceSamples as few-shot examples
```

### Changes to branch-generator (`src/novel/branch-generator.ts`)

Pass `sessionId` to `getPersonaForWorker`. Include persona's `emotionalBaseline` and 2 voice samples in the generation prompt.

---

## File changes

| File | Change |
|---|---|
| `src/novel/personas.ts` | New — 6 persona definitions + `getPersonaForWorker()` |
| `src/blog/tools.ts` | `chat_worker` uses `getPersonaForWorker` to build system prompt |
| `src/novel/branch-generator.ts` | Include persona voice in generation context |
| `tests/novel/personas.test.ts` | New — unit tests for persona lookup (determinism, coverage) |

---

## Testing

```typescript
// personas.test.ts
it('same workerId always returns same persona', () => {
  expect(getPersonaForWorker('ao-826')).toBe(getPersonaForWorker('ao-826'));
});

it('all 6 personas are reachable', () => {
  const reached = new Set(
    ['ao-0','ao-1','ao-2','ao-3','ao-4','ao-5'].map(getPersonaForWorker)
  );
  expect(reached.size).toBe(6);
});
```

---

## Implementation order (TDD)

1. Write `personas.test.ts` (red)
2. Implement `src/novel/personas.ts` with 6 archetypes
3. Tests pass (green)
4. Integrate into `chat_worker` — update `testing_mcp` chat_worker test to verify non-empty response
5. Integrate into `branch-generator` — manual test with `npm run dev:novel -- branch-entry ...`

---

## Risks

- `chat_worker` regex fallback path (no API key) doesn't use LLM at all — persona improves the LLM path but not the fallback. Acceptable.
- Persona selection by workerId hash is simple but could produce skewed distributions for real workerId patterns. Can be adjusted later.
