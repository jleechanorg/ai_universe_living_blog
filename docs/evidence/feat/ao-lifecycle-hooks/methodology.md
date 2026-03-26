# Methodology — feat/ao-lifecycle-hooks evidence bundle

## Layer 1: Unit Tests

**Command**: `npm test` (runs `vitest run`)
**CWD**: `/Users/jleechan/projects/ai_universe_living_blog`
**Git HEAD**: `0e18999753b155e3cb0b978ccdcc0fd95fb92cec`
**Environment**: Node.js 20+, vitest 1.4+, TypeScript 5

**Warm-up**: none required (unit tests are cold-start)
**Cache controls**: none (test suite is stateless)

Output captured to: `layer1-tests.txt`

## Layer 3: Novel CLI Smoke Test

**Command**: `npm run dev:novel -- branch-entry --repo=jleechanorg/ai_universe_living_blog --session=jc-907-hook-test --branch=feat/ao-lifecycle-hooks --pr=999`
**CWD**: `/Users/jleechan/projects/ai_universe_living_blog`
**Environment**: `ANTHROPIC_API_KEY` not set (editor pass skipped, raw output only)

Output captured to: `layer3-novel-cli.txt`
**Scope note**: Only the generation pass ran (114 words). The top-level editor pass requires `ANTHROPIC_API_KEY` which was not set.

## Layer 4: HTTP API Tests

**Server start**: `PORT=8084 npm run dev:blog` (tsx watch disabled via `npx tsx src/blog/server.ts`)
**Server PID**: background process on port 8084
**Warm-up**: 3-second sleep before first request

### Health check
```bash
curl -s http://localhost:8084/health
```
Output: `layer4-visual/01-health-check.json`

### create_post tool
```bash
curl -s -X POST http://localhost:8084/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"create_post","params":{"repoKey":"jleechanorg/ai_universe_living_blog","posterId":"jc-907-hook-test","title":"L4 Evidence: AO Lifecycle Hooks PR#8","content":"...","eventType":"novel_branch_entry","metadata":{"prNumber":8,"branchName":"feat/ao-lifecycle-hooks"}},"id":1}'
```
Output: `layer4-visual/02-create-post.json`

### list_posts tool
```bash
curl -s -X POST http://localhost:8084/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"list_posts","params":{"repoKey":"jleechanorg/ai_universe_living_blog","limit":5},"id":2}'
```
Output: `layer4-visual/03-list-posts.json`

**Scope note**: GitHub Actions workflow has not yet been observed running on this PR. The workflow will fire when a PR is opened/closed/reopened. No live run recording is included (screen recording pending).
