# Section L: Remaining CLI Completeness — update-repo, generate-api-key, replay-event
**Date:** 2026-03-30
**Status:** Planned — final CLI completeness after Section K
**Depends on:** Section K merged to main

---

## Overview

Section K adds list-threads, get-thread, update-post. Section L completes CLI coverage
for the final 3 MCP tools that lack CLI surface:

1. **`blog-cli update-repo`** — update repo settings (enabled, autoScan, modes, tokens) (wraps `update_repo`)
2. **`blog-cli generate-api-key`** — generate a new API key for a repo (wraps `generate_api_key`)
3. **`blog-cli replay-event`** — replay a historical GitHub event into the blog (wraps `replay_event`)

After Section L, ALL 19 MCP tools have CLI surface.

---

## L.1 `blog-cli update-repo` command

**Usage:**
```
blog-cli update-repo --repo owner/repo [--enabled true|false] [--auto-scan true|false]
```

**Implementation:** POST to `/mcp` → `update_repo` tool.

**Tests (`tests/cli/admin-commands.test.ts`):**
1. `parseArgs: update-repo --repo --enabled parsed correctly`
2. `parseArgs: update-repo without --repo throws`
3. `parseArgs: update-repo --auto-scan flag parsed as boolean`

---

## L.2 `blog-cli generate-api-key` command

**Usage:**
```
blog-cli generate-api-key --repo owner/repo
```

**Implementation:** POST to `/mcp` → `generate_api_key` tool. Print generated key.

**Tests (`tests/cli/admin-commands.test.ts`):**
4. `parseArgs: generate-api-key --repo parsed correctly`
5. `parseArgs: generate-api-key without --repo throws`

---

## L.3 `blog-cli replay-event` command

**Usage:**
```
blog-cli replay-event --repo owner/repo --event-type pr_opened [--count N]
```

**Implementation:** POST to `/mcp` → `replay_event` tool.

**Tests (`tests/cli/admin-commands.test.ts`):**
6. `parseArgs: replay-event --repo and --event-type parsed correctly`
7. `parseArgs: replay-event --count parsed as number`
8. `parseArgs: replay-event without --repo throws`
9. `parseArgs: replay-event without --event-type throws`

---

## File changes summary

| File | Change |
|---|---|
| `src/cli/main.ts` | Add `update-repo`, `generate-api-key`, `replay-event` command handlers |
| `tests/cli/admin-commands.test.ts` | 9 new CLI admin tests (new file) |

**Expected test delta:** +9 tests (431 → 440), 0 new skips.

---

## ParsedArgs additions

```typescript
// Add to ParsedArgs interface:
enabled?: boolean;     // for update-repo
autoScan?: boolean;    // for update-repo
eventType?: string;    // for replay-event
count?: number;        // for replay-event
```

---

## Implementation order (TDD)

1. L.2 (`generate-api-key`) — simplest, just --repo
2. L.1 (`update-repo`) — boolean flag parsing
3. L.3 (`replay-event`) — event-type + count

Look at `tests/cli/thread-commands.test.ts` (Section K) as the model for all tests.
