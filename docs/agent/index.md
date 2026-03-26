---
title: Agent Index
purpose: Navigation hub for agents working in this repository
owner: AO team
last_reviewed: "2026-03-26"
source_of_truth: AGENTS.md
---

# Agent Documentation Index

## Quick Start

1. Read `AGENTS.md` for task routing
2. Read this index to find the right leaf doc
3. Open only the docs you need — progressive disclosure, not full context dump

## Leaf Docs

| Doc | When to read |
|-----|-------------|
| `docs/agent/architecture.md` | Understanding system structure, module boundaries, storage interface |
| `docs/agent/quality.md` | Writing tests, PR evidence, merge gates |
| `docs/agent/reliability.md` | Debugging runtime issues, understanding SLOs and fallback behavior |
| `docs/agent/security.md` | Handling secrets, auth, trust boundaries |
| `docs/agent/plans.md` | Current initiatives, active PRs, known next steps |

The index doc itself is `docs/agent/index.md` — it is not listed above.

## Project Entry Points

- **Blog MCP server:** `npm run dev:blog` → `http://localhost:8081/mcp`
- **Novel engine:** `npm run dev:novel -- branch-entry --repo=... --session=... --branch=... --pr=N`
- **Tests:** `npm test` (Vitest)
- **Lint:** `npm run lint` (if configured)

## Pre-merge Validation

```bash
npm test && python3 scripts/agent_repo_check.py
```

Both must pass before any PR is ready to merge.
