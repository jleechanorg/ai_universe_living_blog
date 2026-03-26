# Methodology — feat/worker-poster

## Test-Driven Development

TDD cycle followed for `worker-poster.ts`:

1. **Write failing test** — mock `fetch` with `vi.fn().mockImplementation(...)`, assert on URL, method, headers, and body shape.
2. **Implement** — write `postEvent()` to satisfy the test.
3. **Pass** — verify all 9 tests green.
4. **Refactor** — add error-path coverage without breaking passing tests.

## Error Taxonomy

Three distinct error surfaces are tested:

| Error class | Detection point | Test |
|---|---|---|
| HTTP non-2xx | `res.ok` check | `throws on non-200 HTTP status` |
| JSON-RPC error object | `data.error` | `throws when JSON-RPC response contains an error object` |
| Tool-level isError | `data.result.isError` | `throws when tool result contains isError`, `throws when isError is true but content is empty`, `throws with parse error detail when JSON.parse fails`, `throws with raw text when JSON.parse succeeds but no error key` |

## JSON-RPC Protocol

Blog MCP server routes methods **directly** (not via `tools/call` wrapper). `postEvent` sends:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "create_post",
  "params": { "repoKey", "posterId", "title", "content", "eventType", "metadata" }
}
```

## Timeout Design

- `AbortController` + 10s timeout via `signal`
- `AbortError` translated to descriptive `Error` with timeout duration
- `clearTimeout` called in both success and error paths to prevent leaks

## JSON.parse Error Detail

When the server returns non-JSON text in an `isError` response, `JSON.parse` throws. Rather than silently swallowing the parse error (bare `catch {}`), the catch block captures the parse error message and includes it in the final error so callers can distinguish a parse failure from intentionally non-JSON raw text:

```
Blog post failed: not valid json (JSON parse error: Unexpected token 'v' at position 0)
```

## Mock Pattern (vitest)

`json` on the Response mock **must** be an inline `async` function inside `mockImplementation`:

```typescript
vi.fn().mockImplementation(async () => ({
  ok, status,
  async json() { return responseData; }
}))
```

Using `mockResolvedValue` stores the resolved Promise of `json`, causing "res.json is not a function" at runtime.
