---
title: Plans
purpose: Current initiatives, active PRs, known next steps, and open work
owner: AO team
last_reviewed: "2026-03-30"
source_of_truth: GitHub PR list
---

# Plans

## Open PRs

- **Section K (jc-1290):** blog-cli list-threads/get-thread/update-post → target 431 tests

## Completed Milestones

| PR | Title |
|----|-------|
| #40 | feat(cli): Section J — blog-cli delete/unregister-repo/list-repos/export |
| #39 | feat(blog): Section I — webhook idempotency + optional X-API-Key auth |
| #38 | feat(blog): Section H — CLI read commands + export_repo + replay_event |
| #37 | feat(blog): Section G — search, delete, stats, metrics, Firestore emulator |
| #36 | test(scanner): AutoScanner full poll-cycle integration tests (10 tests) |
| #35 | test(webhook): HMAC validation + event routing (10 tests) |
| #34 | docs: update stale ARCHITECTURE.md and agent/plans.md notes |
| #33 | feat(cli): blog-cli daily-summary command |
| #32 | feat(server): AUTO_SCAN_ENABLED + AUTO_SCAN_INTERVAL_MS env vars |
| #31 | feat(blog): IP-based rate limiting (Section C) |
| #30 | feat(blog): Demo Mode (Section D) |
| #29 | feat(novel): FIFO bidirectional chat (Section E) |
| #28 | feat(cli): --output=both and --output=none modes |
| #27 | feat(cli): blog-cli entry point (Section A) |
| #19 | feat: Remote Mode + Auto-Scan Architecture |

## Current State

- **Tests:** 421 total (413 passing, 8 skipped) — 6 skip require Firestore emulator, 1 requires ANTHROPIC_API_KEY, 1 storage-factory Firestore
- **TDD roadmap coverage:** 100% (Phases 1–5 from `docs/plans/2026-03-27-tdd-roadmap.md`)
- **Design doc coverage:** 100% (Sections A–K planned)
- **Auto-merge:** Skeptic cron runs every 30 min, merges on CI + MERGEABLE + no CHANGES_REQUESTED
- **Storage backends:** memory (default), file (STORAGE_TYPE=file), firestore (STORAGE_TYPE=firestore)
- **GitHub Actions:** ci.yml, skeptic-cron.yml, skeptic-gate.yml, novel-entry.yml, daily-summary.yml
- **Firestore emulator:** running in CI via Java 21 + firebase-tools (G)
- **CLI read commands:** blog-cli list/get/search/stats (H)
- **CLI write commands:** blog-cli delete/unregister-repo/list-repos/export (J)
- **CLI thread commands:** blog-cli list-threads/get-thread/update-post (K — in progress)
- **Data tools:** export_repo, replay_event (H); search_posts, delete_post, get_repo_stats (G)
- **Observability:** GET /metrics Prometheus endpoint (G)
- **Auth:** optional X-API-Key via AUTH_API_KEY env var (I)
- **Idempotency:** webhook delivery_id deduplication via X-GitHub-Delivery (I)

## Known Gaps (resolved)

- ~~`install.sh --storage=firestore` flag wiring~~ — storage factory wired via STORAGE_TYPE env var
- ~~Novel engine CLI does not call blog HTTP endpoint~~ — `--output=both` implemented in blog-cli
- ~~`daily-summary` was stubbed in blog-cli~~ — implemented in PR #33
- ~~Webhook HMAC validation tests missing~~ — implemented in PR #35
- ~~AutoScanner full poll-cycle integration tests missing~~ — implemented in PR #36
- ~~Firestore tests skipped in CI~~ — Firestore emulator added in Section G (PR #37)
- ~~No CLI read commands~~ — list/get/search/stats added in Section H (PR #38)

## Next Steps

1. Merge Section K (jc-1290) — blog-cli list-threads/get-thread/update-post → 431 tests
2. Consider enabling `ANTHROPIC_API_KEY` as a repo secret to activate novel editor pass in GHA (un-skips 1 test)
3. Post-K: roadmap largely complete — all 19 MCP tools have CLI surface, full auth + idempotency, Firestore in CI
