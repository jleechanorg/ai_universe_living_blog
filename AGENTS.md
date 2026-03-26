# AGENTS.md — ai_universe_living_blog

<!-- agent-harness:start -->
## Agent Navigation

Start here for any task. Read only the docs relevant to your goal.

**Read first:**
- `docs/agent/index.md` — full doc index and reading order

**Task routing:**
- Building a feature or refactoring → `docs/agent/architecture.md` + `docs/agent/quality.md`
- Runtime issue or debugging → `docs/agent/reliability.md`
- Security concern or secrets → `docs/agent/security.md`
- Current plans and open work → `docs/agent/plans.md`

**Validation before merge:**
```bash
npm test && python3 scripts/agent_repo_check.py
```

**This repo uses an AGENTS.md agent instructions file** — agents should read this as the primary instructions alongside `CLAUDE.md`.
<!-- agent-harness:end -->

---

## Project Overview

AO worker living blog + novel engine. Per-repo PR lifecycle feed (blog) surfaced via MCP, with serialized AI worker fiction (novel) auto-generated per branch/PR and daily.

See `docs/agent/index.md` for the full doc index.
