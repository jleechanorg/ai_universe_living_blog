# Evidence: feat/worker-poster (P1-3)

## Summary

Implemented `worker-poster` auto-posting for AO lifecycle events (P1-3 of phase2 roadmap).

**PR**: https://github.com/jleechanorg/ai_universe_living_blog/pull/9
**Issue**: jleechan-yl5g

---

## Layer 1 — Unit Tests

`tests/worker-poster.test.ts` — 10 tests, all passing:

```
 ✓ tests/worker-poster.test.ts (10 tests) 4ms
   Test Files  1 passed (1)
   Tests  10 passed (10)
```

Full suite: **57/57 tests passing** across 4 test files.

- `calls create_post via JSON-RPC directly on blogUrl/mcp` — verifies method name and correct JSON-RPC body
- `includes optional branch and message fields` — verifies metadata, custom content
- `throws on non-200 HTTP status` — verifies HTTP error handling (includes HTTP status code)
- `throws when JSON-RPC response contains an error object` — verifies JSON-RPC-level error detection
- `throws when tool result contains isError` — verifies tool-level error surface from JSON result content
- `throws when isError is true but content is empty` — always throws even with empty content
- `includes raw text in error message when isError response is not JSON` — falls back to verbatim text
- `throws with raw text when isError JSON has no error key` — uses raw text when JSON has no error key
- `uses passed-in fetchFn when provided` — verifies fetch injection
- `uses global fetch when fetchFn is not provided` — verifies default fetch is called when no fetchFn given

---

## Layer 2 — Integration Tests

Full test suite results captured in `layer2-integration.txt`.
**57/57 tests passing** including:
- `blog.test.ts` — 17 tests (MemoryBlogStorage, server routes, tools/call MCP wrapper)
- `ao-lifecycle.test.ts` — 11 tests (lifecycle hook)
- `novel.test.ts` — 19 tests (daily-generator, top-level editor)
- `worker-poster.test.ts` — 10 tests (new)

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
    "content": [
      {
        "type": "text",
        "text": "{\n  \"success\": true,\n  \"post\": {\n    \"id\": \"fd2ced1f-99a4-4088-a6a7-a4d709b8a4eb\",\n    \"repoKey\": \"jleechanorg/ai_universe_living_blog\",\n    \"posterId\": \"jc-909\",\n    \"title\": \"pr_created: jleechanorg/ai_universe_living_blog PR#999\",\n    \"content\": \"Worker jc-909 recorded pr_created\",\n    \"eventType\": \"pr_created\",\n    \"status\": \"published\"\n  }\n}"
      }
    ]
  }
}
```

Note: The `create_post` tool result wraps its return value in `content[0].text` as a JSON string per MCP tool result format.

### list_posts
Returns the created post, confirming full round-trip.

---

## Layer 4 — Visual Evidence

- `layer4-visual/01-unit-tests.png` — screenshot of unit tests passing

---

## Files Changed

- `src/hooks/worker-poster.ts` — new: `postEvent()` function
- `src/hooks/index.ts` — new: exports `postEvent` and `WorkerEvent`
- `tests/worker-poster.test.ts` — new: 10 unit tests
- `src/blog/server.ts` — added `tools/call` MCP standard wrapper support (direct dispatch also works)
- `tests/blog.test.ts` — added 2 HTTP integration tests for `tools/call` format
- `docs/evidence/feat/worker-poster/` — 4-layer evidence bundle

## Additional Evidence Files

- `metadata.json` — versioned evidence metadata with SHA-256 checksums and test counts
- `methodology.md` — TDD process, error taxonomy, JSON-RPC protocol, timeout design, mock pattern

---

## Routing: tools/call + Direct Method

The server (`src/blog/server.ts`) now supports **both** dispatch formats:

1. **MCP standard** (`tools/call` wrapper):
   ```json
   { "method": "tools/call", "params": { "name": "create_post", "arguments": { ... } } }
   ```

2. **Direct dispatch** (original, kept for compatibility):
   ```json
   { "method": "create_post", "params": { ... } }
   ```

Both return the same `{ jsonrpc, id, result: { content, isError? } }` structure.
