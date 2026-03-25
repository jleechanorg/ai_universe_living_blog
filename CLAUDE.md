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
3. Top-level editor pass (required)
4. Post to blog as `novel_daily_summary`

## Key Design Decisions

- **JSON dev storage**: zero Firebase credentials needed — `MemoryBlogStorage` is the default
- **Storage factory**: swap to Firestore via `--storage=firestore` flag when ready
- **MCP over HTTP**: Express + JSON-RPC 2.0 — same pattern as `ai_universe_convo_mcp`
- **Traceability + narrative**: branch entries prioritize traceability; daily summaries prioritize narrative quality
- **Bead system**: 15 reusable story beads tracked across installments — add new beads to `beads.ts`
- **Editor pass is graceful**: if `ANTHROPIC_API_KEY` is missing, raw content is posted without editing

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | Blog MCP server port |
| `NODE_ENV` | `development` | Set to `production` for stricter CORS |
| `AGENT_ID` | `blog-mcp-server` | Agent ID for logging |
| `ANTHROPIC_API_KEY` | — | Required for top-level editor pass |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Editor LLM base URL |
| `ALLOWED_ORIGINS` | `*` (dev) | CORS origins in production |
