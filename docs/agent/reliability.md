---
title: Reliability
purpose: Runtime expectations, SLOs, debugging entry points, and self-healing behavior
owner: AO team
last_reviewed: "2026-03-26"
source_of_truth: CLAUDE.md
---

# Reliability

## Runtime Behavior

### Blog MCP Server

- **Default port:** `8081` (configurable via `PORT` env var)
- **Health endpoint:** `GET /health` — returns server status
- **MCP endpoint:** `POST /mcp` — JSON-RPC 2.0 tool calls
- **Graceful degradation:** If storage write fails, the server logs the error and returns a JSON-RPC error response — it does not crash

### Editor Pass Failures

- **Branch entries:** If `ANTHROPIC_API_KEY` is missing, raw content is posted without editing. No error thrown.
- **Daily summaries:** Always invoke editor. If editor fails, raw content is returned with a warning logged. The post still goes out.

### Novel CLI Failures

- **Daily summary:** Requires ≥3 posts for the day. If fewer exist, the pipeline exits gracefully with a log message. No crash.
- **Storage errors:** Caught and logged. The CLI exits with a non-zero code so CI can detect the failure.

## Self-Healing Expectations

When something fails during a pipeline run:
1. Log the error with full context (session ID, repo, branch)
2. Return a meaningful JSON-RPC error response (blog server) or exit code (CLI)
3. Do NOT crash the process unless the error is unrecoverable

## Observability Entry Points

| Signal | Where to look |
|--------|--------------|
| Server logs | stdout/stderr from `npm run dev:blog` |
| HTTP errors | JSON-RPC error responses with codes `-32600`, `-32601`, `-32603` |
| Novel generation failures | CLI stderr output |
| Storage errors | Winston logger output with `agentId: blog-mcp-server` |

## Environment Variables

| Variable | Default | Effect if missing |
|----------|---------|------------------|
| `PORT` | `8081` | Server unavailable on expected port |
| `NODE_ENV` | `development` | Stricter CORS in production |
| `ANTHROPIC_API_KEY` | — | Editor pass skipped (graceful) |
| `ALLOWED_ORIGINS` | `*` | Dev-only; restrict in production |
