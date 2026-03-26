# PR Evidence — feat/ao-lifecycle-hooks

## Claim → Artifact Map

| Claim | Artifact | Key Field |
|-------|----------|-----------|
| 45 unit tests pass | [layer1-tests.txt](layer1-tests.txt) | `"45 passed"` |
| ao-lifecycle tests pass | [layer1-tests.txt](layer1-tests.txt) | `"tests/ao-lifecycle.test.ts (11 tests)"` |
| Novel CLI creates blog post | [layer3-novel-cli.txt](layer3-novel-cli.txt) | `postId: 9dbb626d-836d-4c4a-ad87-7fa798ce806a` |
| MCP /health returns healthy | [layer4-visual/01-health-check.json](layer4-visual/01-health-check.json) | `{"status":"healthy"}` |
| MCP create_post tool succeeds | [layer4-visual/02-create-post.json](layer4-visual/02-create-post.json) | `{"success":true}` |
| MCP list_posts retrieves post | [layer4-visual/03-list-posts.json](layer4-visual/03-list-posts.json) | post `id` matches create_post |
| Workflow file is syntactically valid; branch filter `feat/` matches this branch | [.github/workflows/novel-entry.yml](.github/workflows/novel-entry.yml) | `if: startsWith(github.head_ref, 'feat/')` — `feat/ao-lifecycle-hooks` matches |

## Limitations (What This Evidence Does NOT Prove)

1. **GitHub Actions has not run on this PR**: The workflow has not been observed executing. Screen recording is pending. The workflow is verified to be syntactically correct and to filter on `feat/` (matching `feat/ao-lifecycle-hooks`).
2. **Editor pass not tested**: Novel CLI smoke test ran only the generation pass (114/500 words). The top-level editor pass requires `ANTHROPIC_API_KEY` which was not set.

## Layer 1: Unit Tests ✅ PASS

- **Result**: PASS — 45/45 tests passing (11 ao-lifecycle + 19 novel + 15 blog)
- **Command**: `npm test` (runs `vitest run`)
- **Evidence**: [layer1-tests.txt](layer1-tests.txt) + SHA-256: [layer1-tests.txt.sha256](layer1-tests.txt.sha256)
- **Lint**: `npm run lint` — 0 errors
- **Typecheck**: `npm run typecheck` — 0 errors

## Layer 2: Integration Tests ✅ PASS

Same test suite covers integration paths for:
- Blog MCP server HTTP handler (blog.test.ts)
- Novel branch-entry pipeline end-to-end (novel.test.ts)
- MemoryBlogStorage with real UUIDs and ISO timestamps

## Layer 3: Novel CLI Smoke Test ✅ PASS

- **Command**: `npm run dev:novel -- branch-entry --repo=jleechanorg/ai_universe_living_blog --session=jc-907-hook-test --branch=feat/ao-lifecycle-hooks --pr=999`
- **Evidence**: [layer3-novel-cli.txt](layer3-novel-cli.txt) + SHA-256: [layer3-novel-cli.txt.sha256](layer3-novel-cli.txt.sha256)
- **Post ID**: `9dbb626d-836d-4c4a-ad87-7fa798ce806a`
- **Word count**: 114 (raw entry; editor pass skipped — no `ANTHROPIC_API_KEY`)
- **Scope**: Proves blog MCP `create_post` tool works end-to-end

## Layer 4: Visual Evidence ✅ PASS

### HTTP API Evidence (JSON captures + SHA-256)

| File | Description | SHA-256 |
|------|-------------|----------|
| [01-health-check.json](layer4-visual/01-health-check.json) | `GET /health` → `{"status":"healthy"}` | [01-health-check.json.sha256](layer4-visual/01-health-check.json.sha256) |
| [02-create-post.json](layer4-visual/02-create-post.json) | `POST /mcp` `create_post` → post created | [02-create-post.json.sha256](layer4-visual/02-create-post.json.sha256) |
| [03-list-posts.json](layer4-visual/03-list-posts.json) | `POST /mcp` `list_posts` → post retrievable | [03-list-posts.json.sha256](layer4-visual/03-list-posts.json.sha256) |

### Screenshots
1. **`01-unit-tests-passing.png`** — Terminal showing `npm test` output
2. **`02-workflow-file.png`** — `.github/workflows/novel-entry.yml` displayed
3. **`03-novel-cli-success.png`** — Successful `branch-entry` pipeline output

## Hook Verification

Unit tests (11 cases, all passing):
- `pr_opened` → triggers `branch-entry` with correct args ✅
- `pr_merged` → triggers `branch-entry` with correct args ✅
- `pr_reopened` → triggers `branch-entry` with correct args ✅
- `pr_closed` → triggers `branch-entry` with correct args ✅
- `pr_review_requested` → skips (no-op) ✅
- `pr_comment` → skips (no-op) ✅
- `pr_reviewed` → skips (no-op) ✅
- Error propagation from `runCli` failure ✅
- `buildArgv()` produces correct argv (without eventType) ✅
- `buildArgv()` includes `--event` when provided ✅
- `buildArgv()` full argv assembly ✅
