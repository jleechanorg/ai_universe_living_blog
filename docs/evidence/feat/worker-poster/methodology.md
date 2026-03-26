# Methodology — feat/worker-poster

## Test-Driven Development

TDD cycle followed for `worker-poster.ts`:

1. **Write failing test** — mock `fetch` with `vi.fn().mockImplementation(...)`, assert on URL, method, headers, and body shape.
2. **Implement** — write `postEvent()` to satisfy the test.
3. **Pass** — verify all 10 tests green.
4. **Refactor** — add error-path coverage without breaking passing tests.

## Error Taxonomy

Four distinct error surfaces are tested:

| Error class | Detection point | Test |
|---|---|---|
| HTTP non-2xx | `res.ok` check | `throws on non-200 HTTP status` |
| JSON-RPC error object | `data.error` | `throws when JSON-RPC response contains an error object` |
| Tool-level isError | `data.result.isError` | `throws when tool result contains isError` |
| Empty isError content | `data.result.content?.[0]` | `throws when isError is true but content is empty` |
| Non-JSON isError text | `JSON.parse` fallback | `includes raw text in error message when isError response is not JSON` |
| JSON isError no error key | `inner.error` guard | `throws with raw text when isError JSON has no error key` |

## JSON-RPC Protocol

The server (`src/blog/server.ts`) supports **two dispatch formats**:

**Direct dispatch** — `postEvent` sends:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "create_post",
  "params": { "repoKey", "posterId", "title", "content", "eventType", "metadata" }
}
```

**MCP standard** (`tools/call` wrapper) — also accepted:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "create_post", "arguments": { ... } }
}
```

Both return `{ jsonrpc, id, result: { content: [{ type, text }], isError? } }`.

## Timeout Design

- `AbortController` + 10s timeout via `signal`
- `AbortError` translated to descriptive `Error` with timeout duration
- `clearTimeout` called in both success and error paths to prevent leaks

## isError Response Handling

When `isError: true`, the server returns `{ content: [{ type: 'text', text: '...' }] }`. The text may be:
- **JSON**: `{"error": "message"}` — extracted and used as the error message
- **non-JSON**: raw text used verbatim as the error message

## Mock Pattern (vitest)

`json` on the Response mock **must** be an inline `async` function inside `mockImplementation`:

```typescript
vi.fn().mockImplementation(async () => ({
  ok, status,
  async json() { return responseData; }
}))
```

Using `mockResolvedValue` stores the resolved Promise of `json`, causing "res.json is not a function" at runtime.
