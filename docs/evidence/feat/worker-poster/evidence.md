# Evidence: feat/worker-poster (P1-3)

## Summary

Implemented `worker-poster` auto-posting for AO lifecycle events (P1-3 of phase2 roadmap).

**PR**: https://github.com/jleechanorg/ai_universe_living_blog/pull/9
**Issue**: jleechan-yl5g

---

## Layer 1 — Unit Tests

`tests/worker-poster.test.ts` — 6 tests, all passing:

```
 ✓ tests/worker-poster.test.ts (6 tests) 3ms
   Test Files  1 passed (1)
   Tests  6 passed (6)
```

Full suite: **38/38 tests passing** across 3 test files.

- `calls create_post via JSON-RPC directly on blogUrl/mcp` — verifies method name and correct JSON-RPC body
- `includes optional branch and message fields` — verifies metadata, custom content
- `throws on non-200 HTTP status` — verifies HTTP error handling
- `throws when JSON-RPC response contains an error object` — verifies JSON-RPC-level error detection
- `throws when tool result contains isError` — verifies tool-level error surface from result content
- `uses passed-in fetchFn when provided` — verifies fetch injection

---

## Layer 2 — Integration Tests

Full test suite results captured in `layer2-integration.txt`.
**38/38 tests passing** including:
- `blog.test.ts` — 15 tests (MemoryBlogStorage, server routes)
- `novel.test.ts` — 19 tests (daily-generator, top-level editor)
- `worker-poster.test.ts` — 6 tests (new)

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

---

## Files Changed

- `src/hooks/worker-poster.ts` — new: `postEvent()` function
- `src/hooks/index.ts` — new: exports `postEvent` and `WorkerEvent`
- `tests/worker-poster.test.ts` — new: 6 unit tests
- `docs/evidence/feat/worker-poster/` — new: 4-layer evidence bundle

---

## Note: Direct Method Routing

The blog server dispatches methods directly (`method: 'create_post'`). `worker-poster.ts` calls `create_post` directly in the JSON-RPC `method` field — matching the live server routing. JSON-RPC error responses (HTTP 200 with `error` object) and tool-level `isError` flags are both detected and thrown as errors.
