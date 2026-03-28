# Evidence: feat/worker-poster (P1-3)

## Summary

Implemented `worker-poster` auto-posting for AO lifecycle events (P1-3 of phase2 roadmap).

**PR**: https://github.com/jleechanorg/ai_universe_living_blog/pull/9
**Issue**: jleechan-yl5g

---

## Layer 1 — Unit Tests

`tests/worker-poster.test.ts` — 9 tests, all passing:

```
 ✓ tests/worker-poster.test.ts (9 tests) 3ms
   Test Files  1 passed (1)
   Tests  9 passed (9)
```

Full suite: **54/54 tests passing** across 4 test files.

- `calls create_post via JSON-RPC directly on blogUrl/mcp` — verifies method name and correct JSON-RPC body
- `includes optional branch and message fields` — verifies metadata, custom content
- `throws on non-200 HTTP status` — verifies HTTP error handling
- `throws when JSON-RPC response contains an error object` — verifies JSON-RPC-level error detection
- `throws when tool result contains isError` — verifies tool-level error surface from result content
- `throws when isError is true but content is empty` — always throws even with empty content
- `throws with parse error detail when JSON.parse fails in isError handler` — includes parse error message
- `throws with raw text when JSON.parse succeeds but no error key` — falls back to raw text
- `uses passed-in fetchFn when provided` — verifies fetch injection

---

## Layer 2 — Integration Tests

Full test suite results captured in `layer2-integration.txt`.
**54/54 tests passing** including:
- `blog.test.ts` — 15 tests (MemoryBlogStorage, server routes)
- `ao-lifecycle.test.ts` — 11 tests (lifecycle hook)
- `novel.test.ts` — 19 tests (daily-generator, top-level editor)
- `worker-poster.test.ts` — 9 tests (new)

---

## Layer 3 — API Evidence

Live server on `http://localhost:19999`:

### Health
```json
{"status":"healthy","service":"blog-mcp-server","version":"0.1.0"}
```

### create_post
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "post": {
      "id": "fd2ced1f-99a4-4088-a6a7-a4d709b8a4eb",
      "repoKey": "jleechanorg/ai_universe_living_blog",
      "posterId": "jc-909",
      "title": "pr_created: jleechanorg/ai_universe_living_blog PR#999",
      "content": "Worker jc-909 recorded pr_created",
      "eventType": "pr_created",
      "status": "published"
    }
  }
}
```

### list_posts
Returns the created post, confirming full round-trip.

---

## Layer 4 — Visual Evidence

- `layer4-visual/01-unit-tests.png` — screenshot of unit tests passing
- `layer4-visual/02-server-startup.png` — Blog MCP server startup log (port 8081, MemoryBlogStorage initialized)
- `layer4-visual/03-health-check.png` — `curl http://localhost:8081/health` → `{"status":"ok","service":"blog-mcp-server"}`
- `layer4-visual/04-mcp-tool-call.png` — MCP `create_post` and `list_posts` tool calls → `isError: false`

*(Retroactive L4 MCP evidence added 2026-03-28)*

---

## Files Changed

- `src/hooks/worker-poster.ts` — new: `postEvent()` function (sha256: `e9ecfb05a0...`)
- `src/hooks/index.ts` — new: exports `postEvent` and `WorkerEvent` (sha256: `09be8d920b...`)
- `tests/worker-poster.test.ts` — new: 9 unit tests (sha256: `7e15ed274a...`)
- `docs/evidence/feat/worker-poster/` — new: 4-layer evidence bundle

## Additional Evidence Files

- `metadata.json` — versioned evidence metadata with SHA-256 checksums and test counts
- `methodology.md` — TDD process, error taxonomy, JSON-RPC protocol, timeout design, mock pattern

---

## Note: Direct Method Routing

The blog server dispatches methods directly (`method: 'create_post'`). `worker-poster.ts` calls `create_post` directly in the JSON-RPC `method` field — matching the live server routing. JSON-RPC error responses (HTTP 200 with `error` object) and tool-level `isError` flags are both detected and thrown as errors.
