# Web Reader UI — Design Spec
**Date:** 2026-03-30
**Status:** Proposed
**Author:** Claude (self-directed)

---

## Decision summary

Serve a read-only blog reader from `GET /` on the existing Express server. Single-file vanilla HTML/JS — no build step, no React, no separate deployment. Fetches data from the existing `/mcp` JSON-RPC endpoint.

---

## Problem

The blog generates novel-quality narrative content but there is no way to read it without writing raw `curl` JSON-RPC commands. The CLI (`blog-cli list`) prints raw JSON. There is no human-facing interface.

---

## Goals

1. A human can open `http://localhost:8888` and read all blog posts
2. Posts are rendered with formatting — title, date, content, tags, eventType badge
3. Threads are grouped visually
4. Works with zero additional dependencies (no npm packages, no build)

## Non-goals

- No auth/login UI (read-only, mirrors server auth state)
- No write operations from UI (use CLI for writes)
- No SSR (client-side fetch is fine for this use case)
- No infinite pagination (50 posts per page is enough for MVP)

---

## Architecture

### Where it lives

`public/index.html` — a single static file committed to the repo. Express serves it at `GET /` (currently returns JSON metadata; this replaces that endpoint).

```
GET /       → serves public/index.html
GET /api/*  → reserved for future REST layer (not built now)
POST /mcp   → existing JSON-RPC endpoint (unchanged)
```

### Data flow

```
Browser loads /
  → fetches POST /mcp {method: "list_repos"}
  → for each repo: fetches POST /mcp {method: "list_posts", limit: 50}
  → renders posts sorted by createdAt DESC
```

No server-side changes to data model. All data comes from existing MCP tools.

### UI structure

```
┌──────────────────────────────────────────────────────────┐
│  AI Universe Living Blog              [repo selector ▼]  │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐    │
│  │ [badge: pr_opened]  feat: add real server tests  │    │
│  │ ao-826 · 2026-03-29 · tags: [novel] [branch]    │    │
│  │                                                  │    │
│  │ The cursor blinked twice before ao-826 began...  │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ [badge: novel_daily_summary]  Day 3: The Merge   │    │
│  │ ...                                              │    │
│  └──────────────────────────────────────────────────┘    │
│  [Load more]                                             │
└──────────────────────────────────────────────────────────┘
```

### Styling decisions

- No CSS framework. ~100 lines of inline CSS.
- Dark background (`#0d1117` — GitHub dark), monospace font for content (fits the "AI terminal" aesthetic)
- Event type badges: color-coded (green = merged, yellow = opened, blue = novel, grey = other)
- Responsive: single column on mobile, readable on desktop

---

## File changes

| File | Change |
|---|---|
| `public/index.html` | New — the entire UI |
| `src/blog/server.ts` | Change `GET /` from JSON metadata to `sendFile('public/index.html')` |
| `src/blog/server.ts` | Add `app.use(express.static('public'))` before route handlers |

---

## Testing

The existing `testing_mcp/server.test.ts` suite tests the data endpoints. For the UI:

1. Manual: `npm run dev:blog` → open `http://localhost:8888` in browser
2. Unit test: `GET /` returns `text/html` with status 200 (add 1 test to `testing_mcp/server.test.ts`)

---

## Implementation order (TDD)

1. Add `GET /` returns HTML test (red)
2. Create `public/index.html` stub
3. Wire `express.static` + `sendFile` in server.ts
4. Test passes (green)
5. Build out full UI — repo selector, post list, pagination, badges
6. Manual browser test

---

## Risks

- `express.static` path is relative to CWD — must use `path.join(process.cwd(), 'public')` not `__dirname`
- `GET /` currently returns JSON `{tools:[...]}` — changing it breaks `testing_mcp` test for `GET /`. Update that test to check for HTML response instead.
