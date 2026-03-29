# Section J: CLI Write Commands + Repo Management CLI
**Date:** 2026-03-30
**Status:** Planned — production CLI completeness after Section I
**Depends on:** Section I (PR #39) merged to main

---

## Overview

Section H gave us CLI read commands (list/get/search/stats).
Section J adds the write-side CLI surface and repo management:

1. **`blog-cli delete`** — delete a post by ID from the CLI (wraps `delete_post` tool from Section G)
2. **`blog-cli unregister-repo`** — remove a registered repo from the CLI (wraps `unregister_repo` tool)
3. **`blog-cli list-repos`** — list all registered repos (wraps `list_repos` tool)
4. **`blog-cli export`** — export all posts for a repo to a JSON file (wraps `export_repo` tool from Section H)

---

## J.1 `blog-cli delete` command

**Usage:**
```
blog-cli delete --repo owner/repo --post-id <id>
```

**Implementation:** POST to `/mcp` → `delete_post` tool. Print confirmation or error.

**Output:**
```
Deleted post abc123 (thread pruned: true)
```

**Tests (`tests/cli/write-commands.test.ts`):**
1. `delete` removes post — subsequent `get` returns error
2. `delete` on unknown ID prints error message (non-zero exit)

---

## J.2 `blog-cli unregister-repo` command

**Usage:**
```
blog-cli unregister-repo --repo owner/repo
```

**Implementation:** POST to `/mcp` → `unregister_repo` tool.

**Tests (`tests/cli/write-commands.test.ts`):**
3. `unregister-repo` removes repo — subsequent `list-repos` no longer shows it
4. `unregister-repo` on unknown repo prints error

---

## J.3 `blog-cli list-repos` command

**Usage:**
```
blog-cli list-repos [--json]
```

**Implementation:** POST to `/mcp` → `list_repos` tool. Render as table or JSON.

**Output:**
```
REPO                    ENABLED  AUTO-SCAN
owner/repo1             true     true
owner/repo2             false    false
```

**Tests (`tests/cli/write-commands.test.ts`):**
5. `list-repos` shows registered repos
6. `list-repos --json` outputs raw JSON

---

## J.4 `blog-cli export` command

**Usage:**
```
blog-cli export --repo owner/repo [--output posts.json]
```

**Implementation:** POST to `/mcp` → `export_repo` tool. Write JSON to file or stdout.

**Tests (`tests/cli/write-commands.test.ts`):**
7. `export` writes valid JSON file with posts
8. `export` without `--output` prints to stdout

---

## File changes summary

| File | Change |
|---|---|
| `src/cli/main.ts` | Add `delete`, `unregister-repo`, `list-repos`, `export` command handlers |
| `tests/cli/write-commands.test.ts` | 8 new CLI write tests (new file) |

**Expected test delta:** +8 tests (409 → 417), 0 new skips.

---

## Implementation order (TDD)

1. J.3 (`list-repos`) — read-only, simplest
2. J.1 (`delete`) — uses delete_post tool from Section G
3. J.2 (`unregister-repo`) — uses unregister_repo tool
4. J.4 (`export`) — uses export_repo from Section H

Look at `tests/cli/list-get-search.test.ts` (Section H) as the model for all CLI tests.
