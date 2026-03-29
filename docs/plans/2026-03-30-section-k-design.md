# Section K: Thread CLI + Update Post CLI
**Date:** 2026-03-30
**Status:** Planned — CLI completeness after Section J
**Depends on:** Section J (PR #40) merged to main

---

## Overview

Sections H and J added CLI read/write commands for posts and repos. Section K adds the remaining
CLI surface for thread navigation and post updates:

1. **`blog-cli list-threads`** — list all threads for a repo (wraps `list_threads` tool)
2. **`blog-cli get-thread`** — fetch a thread with all its posts (wraps `get_thread` tool)
3. **`blog-cli update-post`** — update a post's title, content, tags, or status (wraps `update_post` tool)

---

## K.1 `blog-cli list-threads` command

**Usage:**
```
blog-cli list-threads --repo owner/repo [--limit N] [--cursor CURSOR] [--json]
```

**Implementation:** POST to `/mcp` → `list_threads` tool. Render as table or JSON.

**Output (default table):**
```
THREAD-ID          POSTS  FIRST-POST
thread-abc123         3  PR merged: feat/my-feature
thread-def456         1  PR opened: fix/bug-42
```

**Tests (`tests/cli/thread-commands.test.ts`):**
1. `parseArgs: list-threads --repo and defaults parsed correctly`
2. `parseArgs: list-threads --json sets json flag`
3. `parseArgs: list-threads without --repo throws`

---

## K.2 `blog-cli get-thread` command

**Usage:**
```
blog-cli get-thread --repo owner/repo --thread-id <id> [--json]
```

**Implementation:** POST to `/mcp` → `get_thread` tool.

**Tests (`tests/cli/thread-commands.test.ts`):**
4. `parseArgs: get-thread --repo and --thread-id parsed correctly`
5. `parseArgs: get-thread without --repo throws`
6. `parseArgs: get-thread without --thread-id throws`

---

## K.3 `blog-cli update-post` command

**Usage:**
```
blog-cli update-post --repo owner/repo --post-id <id> [--title "new title"] [--content "new content"] [--tags tag1,tag2] [--status published|draft]
```

**Implementation:** POST to `/mcp` → `update_post` tool.

**Tests (`tests/cli/thread-commands.test.ts`):**
7. `parseArgs: update-post --repo --post-id --title parsed correctly`
8. `parseArgs: update-post without --repo throws`
9. `parseArgs: update-post without --post-id throws`
10. `parseArgs: update-post --tags comma-separated parsed as array`

---

## File changes summary

| File | Change |
|---|---|
| `src/cli/main.ts` | Add `list-threads`, `get-thread`, `update-post` command handlers |
| `tests/cli/thread-commands.test.ts` | 10 new CLI thread/update tests (new file) |

**Expected test delta:** +10 tests (421 → 431), 0 new skips.

---

## ParsedArgs additions

```typescript
// Add to ParsedArgs interface:
threadId?: string;
title?: string;
content?: string;
tags?: string[];
status?: string;
```

---

## Implementation order (TDD)

1. K.3 (`update-post`) — parseArgs with title/content/tags/status
2. K.1 (`list-threads`) — list with cursor/limit/json (same pattern as `list`)
3. K.2 (`get-thread`) — fetch thread by ID

Look at `tests/cli/write-commands.test.ts` (Section J) as the model for all CLI tests.
