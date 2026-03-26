# Evidence: `feat/install-smoke-test` — install.sh smoke test

## Claim class: integration test (install.sh E2E)

## Summary

`tests/install.test.ts` was written using TDD before touching `install.sh`. The test
defined the expected behavior: `bash install.sh --target=<tmp-git-repo> --blog-only`
must (1) place `dist/blog/server.js` in `node_modules/ai-universe-living-blog/`
and (2) the blog MCP server must start and return HTTP 200 with `{status: "ok"}` from
`/health`.

Three bugs were exposed and fixed before the test passed:

| Bug | Root cause | Fix |
|-----|-----------|-----|
| `cp -r dir dest/` flattens contents | `cp -r .../dist/blog "${dest}/dist/"` put files flat in `dest/dist/` | `mkdir -p "${dest}/dist/blog" && cp .../. "${dest}/dist/blog/"` |
| `ERR_MODULE_NOT_FOUND express` | Dependencies not copied to target `node_modules/` | Added `cp -r "${SRC_ROOT}/node_modules/"* "${TARGET}/node_modules/"` to `install_blog()` |
| `npm run build` broken in `--source` path | Copied symlinks in `.bin/` resolve to non-existent paths | Skip `npm install` when `--source=` is used (local source already has deps + dist) |

A fourth bug was exposed in the server itself: `/health` returned `{status: "healthy"}`
but the test required `{status: "ok"}`. Fixed by updating `src/blog/server.ts`.

## Layer 1 — Test file
`tests/install.test.ts` — real E2E: creates temp git repo, runs install.sh via `--source=`
(local build), spawns server, hits HTTP `/health`, asserts `{status: "ok"}`.

## Layer 2 — `package.json` script
```json
"test:install": "vitest run tests/install.test.ts"
```

## Layer 3 — Test log (PASS)

```
$ npm run test:install

 RUN  v1.6.1
 ✓ tests/install.test.ts > install.sh smoke test > installs blog MCP server and /health responds 200 with {status: "ok"} 18122ms
 Test Files  1 passed (1)
 Tests  1 passed (1)
 Duration  18.41s
```

Full suite: 41 passed | 6 skipped (47 total).

## Layer 4 — install.sh end-to-end run

```
$ bash install.sh --target=/tmp/demo --source=$(pwd) --blog-only
[install] ai-universe-living-blog installer
[install] Target: /tmp/demo
[install] Using local source: /Users/jleechan/.worktrees/ai_universe_living_blog
[install] Installing blog MCP server...
[install]   → Blog server: /tmp/demo/node_modules/ai-universe-living-blog/dist/blog
[install]   → MCP path: /tmp/demo/node_modules/ai-universe-living-blog/dist/blog/server.js
[install] Install complete!

# server.js confirmed present:
$ find /tmp/demo/node_modules/ai-universe-living-blog/dist/blog/ -name "*.js"
server.js, storage.js, tools.js, storage-factory.js, storage-firestore.js
```

## Verdict

**INSUFFICIENT** for E2E claim class (no screen recording captured). This is an **integration test** —
real I/O and HTTP, but no agent/session orchestration. Evidence class: **integration test**.
