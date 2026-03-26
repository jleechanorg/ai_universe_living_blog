# Layer 4 Visual Evidence — feat/ao-lifecycle-hooks (PR #8)

## L4 Criterion
Real MCP server started, real HTTP endpoints called, real JSON-RPC responses captured.

## Evidence Files

| File | Description |
|------|-------------|
| `01-health-check.json` | `GET /health` — server alive, returns `{"status":"healthy"}` |
| `02-create-post.json` | `POST /mcp` — `create_post` tool, post `41ac86e6-...` created with `novel_branch_entry` event type |
| `03-list-posts.json` | `POST /mcp` — `list_posts` tool, confirms created post is retrievable |

## Reproduction

```bash
cd ~/projects/ai_universe_living_blog
PORT=8084 npm start:blog 2>&1 &
sleep 2

# Health check
curl -s http://localhost:8084/health

# Create post
curl -s -X POST http://localhost:8084/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"create_post","params":{"repoKey":"jleechanorg/ai_universe_living_blog","posterId":"jc-907","title":"Test","content":"Body","eventType":"novel_branch_entry"},"id":1}'

# List posts
curl -s -X POST http://localhost:8084/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"list_posts","params":{"repoKey":"jleechanorg/ai_universe_living_blog","limit":5},"id":2}'
```

## What PR #8 Adds

`handlePrEvent()` in `src/hooks/ao-lifecycle.ts` — auto-triggers novel `branch-entry` pipeline when AO workers open/merge/reopen/close PRs. GitHub Actions workflow (`.github/workflows/novel-entry.yml`) fires on PR `opened`/`closed`/`reopened` for `feat/`/`fix/`/`chore/`/`docs/`/`refactor/` branches and runs `npm run start:novel -- branch-entry ...` with correct `--event` type.
