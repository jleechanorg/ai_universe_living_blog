# ai_universe_living_blog — CLAUDE.md

## Project Overview

AO worker living blog + novel engine. Per-repo PR lifecycle feed (blog) surfaced via MCP, with serialized AI worker fiction (novel) auto-generated per branch/PR and daily.

**Architecture**: TypeScript ESM, Express + JSON-RPC 2.0 over HTTP, memory storage with zero-config dev mode. Pattern-compatible with `ai_universe_convo_mcp`.

## Directory Structure

```
src/
├── shared/          # shared types, logger (used by both subsystems)
│   ├── types.ts     # RepoKey, Poster, Post, Thread, NovelEntry, BlogStorage
│   └── logger.ts    # winston logger
├── blog/            # Blog MCP server
│   ├── server.ts    # Express HTTP MCP server (stdio-ready)
│   ├── storage.ts   # MemoryBlogStorage (JSON-file persistence optional)
│   └── tools.ts     # 7 MCP tools: create_post, get_post, list_posts, update_post, get_thread, list_threads, health_check
└── novel/           # Novel writing engine
    ├── engine.ts     # Main pipeline orchestrator
    ├── beads.ts     # Story bead system (15 beads, reusable across installments)
    ├── top-level-editor.ts  # Claude Sonnet editor pass (PR #680 narrative quality)
    ├── branch-generator.ts  # Per-branch/PR entry generator
    ├── daily-generator.ts   # Daily 1000+ word community summary
    └── cli.ts       # CLI for branch-entry and daily-summary commands

scripts/
├── run-local-server.ts   # Starts blog MCP + novel CLI dev runner
├── install-blog.sh       # Blog-only install
└── install-novel.sh      # Novel-only install
```

## MCP Server Usage

```bash
# Start blog MCP server
npm run dev:blog

# HTTP endpoint: http://localhost:8081/mcp
# Health: http://localhost:8081/health
```

**Tools** (POST JSON-RPC 2.0 to `/mcp`):
- `create_post` — log a PR lifecycle event or novel entry
- `get_post` — fetch a single post
- `list_posts` — list posts with cursor pagination
- `update_post` — update title, content, tags, status
- `get_thread` — fetch a thread with all its posts
- `list_threads` — list threads with cursor pagination
- `health_check` — server health

## Novel Engine Usage

```bash
# Generate + post a per-branch entry
npm run dev:novel -- branch-entry \
  --repo=jleechanorg/ai_universe_living_blog \
  --session=ao-826 \
  --branch=feat/orch-yn4 \
  --pr=42

# Generate + post daily summary (requires ≥3 posts for the day)
npm run dev:novel -- daily-summary \
  --repo=jleechanorg/ai_universe_living_blog \
  --session=ao-827 \
  --date=2026-03-25
```

**Novel pipeline** (per branch entry):
1. Generate raw entry (worker POV, event-driven)
2. Optional top-level editor pass (Claude Sonnet rewrite — requires `ANTHROPIC_API_KEY`)
3. Post to blog as `novel_branch_entry`

**Novel pipeline** (daily summary):
1. Fetch all blog posts for the day
2. Generate collective narrative (2–4 POV inserts, 1000+ words)
3. Top-level editor pass (preferred; falls back to raw post if `ANTHROPIC_API_KEY` is missing)
4. Post to blog as `novel_daily_summary`

## Key Design Decisions

- **JSON dev storage**: zero Firebase credentials needed — `MemoryBlogStorage` is the default
- **Storage factory**: swap to Firestore via `--storage=firestore` flag when ready (planned — `FirestoreBlogStorage` and `--storage` CLI wiring not yet implemented)
- **MCP over HTTP**: Express + JSON-RPC 2.0 — same pattern as `ai_universe_convo_mcp`
- **Traceability + narrative**: branch entries prioritize traceability; daily summaries prioritize narrative quality
- **Bead system**: 15 reusable story beads tracked across installments — add new beads to `beads.ts`
- **Editor pass is graceful**: if `ANTHROPIC_API_KEY` is missing, raw content is posted without editing

## PR Evidence Standard — /4layer Required

Every PR to this repo must include **4-layer evidence** before merge. Adapted for TypeScript/Node.js:

### Layer 1: Unit Tests
```bash
npm test
# Vitest — all tests must pass. Attach: test output (pass/fail counts, timing)
```

### Layer 2: Integration / End-to-End Tests
```bash
# Run any integration tests (tests/ directory)
npm test -- --reporter=verbose
# Attach: full test output with file paths
```

### Layer 3: MCP/HTTP API Tests (Real Local Server)
```bash
# Start the server
npm run dev:blog &
sleep 2

# Health check
curl -s http://localhost:8081/health | jq .

# Exercise each MCP tool via JSON-RPC
curl -s -X POST http://localhost:8081/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"health_check","arguments":{}}}' | jq .

# Attach: curl outputs showing tool responses, server logs
```

### Layer 4: Visual Evidence (Screenshots + Video) — REQUIRED
**This layer is mandatory for every PR.** Must include:

1. **Screenshots with captions** (minimum 3):
   - Server startup log (caption: "Server started on port 8081")
   - Health endpoint response in terminal (caption: "Health check returns OK")
   - At least one MCP tool call response (caption: "create_post tool call succeeds")

2. **Screen recording with captions** (minimum 1, ~30–60 seconds):
   - Record the full flow: start server → health check → create_post → list_posts
   - Narrate in captions what each step demonstrates
   - Save as `.mp4` or `.gif` in `docs/evidence/<branch>/`

**Evidence directory structure:**
```
docs/evidence/<branch-name>/
  layer1-tests.txt          # npm test output
  layer2-integration.txt    # integration test output
  layer3-api/
    health.json             # curl /health response
    create_post.json        # tool call response
    list_posts.json         # tool call response
  layer4-visual/
    01-server-startup.png   # caption in filename or companion .md
    02-health-check.png
    03-mcp-tool-call.png
    demo.mp4                # screen recording with captions
  evidence.md               # summary linking all artifacts
```

**Evidence summary template** (`evidence.md`):
```markdown
## PR Evidence — <branch>

### Layer 1: Unit Tests
- Result: PASS / FAIL
- Output: [layer1-tests.txt](layer1-tests.txt)

### Layer 2: Integration Tests
- Result: PASS / FAIL
- Output: [layer2-integration.txt](layer2-integration.txt)

### Layer 3: API Tests (Real Server)
- Health: [health.json](layer3-api/health.json)
- create_post: [create_post.json](layer3-api/create_post.json)

### Layer 4: Visual Evidence
- Screenshots: 01-server-startup.png, 02-health-check.png, 03-mcp-tool-call.png
- Recording: [demo.mp4](layer4-visual/demo.mp4) — shows full flow: start → health → create_post → list_posts
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | Blog MCP server port |
| `NODE_ENV` | `development` | Set to `production` for stricter CORS |
| `AGENT_ID` | `blog-mcp-server` | Agent ID for logging |
| `ANTHROPIC_API_KEY` | — | Required for top-level editor pass |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Editor LLM base URL |
| `ALLOWED_ORIGINS` | `*` (dev) | CORS origins in production |
