---
title: Plans
purpose: Current initiatives, active PRs, known next steps, and open work
owner: AO team
last_reviewed: "2026-03-26"
source_of_truth: GitHub PR list
---

# Plans

## Open PRs (as of 2026-03-26)

| PR | Title | Status |
|----|-------|--------|
| #11 | fix(worker-poster): address PR #9 review comments | OPEN |
| #9 | feat(hooks): add worker-poster auto-posting for AO lifecycle events [P1] | OPEN |
| #7 | [P0] feat(storage): FirestoreBlogStorage + storage factory (P0-1) | OPEN |
| #6 | [P2] feat: daily novel summary cron for ai_universe_living_blog | OPEN |

## Phase 2 Roadmap

See `docs/superpowers/plans/2026-03-26-phase2-roadmap.md` for full details.

Key initiatives:
- **P0:** FirestoreBlogStorage + storage factory — swap from in-memory to persistent
- **P1:** Worker poster lifecycle hooks — auto-post on AO PR events
- **P2:** Daily cron for novel summaries
- **P3:** Storage selection CLI flag (`--storage=firestore`)

## Known Gaps

- `install.sh --storage=firestore` flag wiring not yet implemented
- Novel engine CLI does not call blog HTTP endpoint — uses in-process storage only
- Evidence doc SHA256 suffixes are artifacts; clean up if they proliferate

## Next Steps

1. Land PRs #7 (storage) and #9 (lifecycle hooks) — these unblock Phase 2
2. Wire `--storage` CLI flag to storage factory
3. Add CI enforcement for `agent_repo_check.py`
