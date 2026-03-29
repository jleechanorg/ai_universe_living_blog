---
title: Plans
purpose: Current initiatives, active PRs, known next steps, and open work
owner: AO team
last_reviewed: "2026-03-30"
source_of_truth: GitHub PR list
---

# Plans

## Open PRs

None — all design doc sections (A–L) are implemented and merged. Roadmap complete.

## Completed Milestones

| PR | Title |
|----|-------|
| #42 | feat(cli): Section L — update-repo, generate-api-key, replay-event |
| #41 | feat(cli): Section K — list-threads, get-thread, update-post |
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

## Current State (ROADMAP COMPLETE)

- **Tests:** 432 passing | 8 skipped (440 total) — 6 skip Firestore emulator, 1 ANTHROPIC_API_KEY, 1 storage-factory
- **TDD roadmap coverage:** 100% (all phases + Sections A–L)
- **CLI coverage:** 100% — all 19 MCP tools have CLI surface
- **Auto-merge:** Skeptic cron runs every 30 min, merges on CI + MERGEABLE + no CHANGES_REQUESTED
- **Storage backends:** memory (default), file, firestore
- **GitHub Actions:** ci.yml, skeptic-cron.yml, skeptic-gate.yml, novel-entry.yml, daily-summary.yml
- **Firestore emulator:** running in CI via Java 21 + firebase-tools
- **Observability:** GET /metrics Prometheus endpoint
- **Auth:** optional X-API-Key via AUTH_API_KEY env var
- **Idempotency:** webhook delivery_id deduplication

## CLI Commands (complete)

| Command | Tool | Section |
|---|---|---|
| branch-entry | novel pipeline | A |
| daily-summary | novel pipeline | A |
| chat | chat_worker | A |
| config | — | A |
| register-repo | register_repo | A |
| list | list_posts | H |
| get | get_post | H |
| search | search_posts | H |
| stats | get_repo_stats | H |
| delete | delete_post | J |
| unregister-repo | unregister_repo | J |
| list-repos | list_repos | J |
| export | export_repo | J |
| list-threads | list_threads | K |
| get-thread | get_thread | K |
| update-post | update_post | K |
| update-repo | update_repo | L |
| generate-api-key | generate_api_key | L |
| replay-event | replay_event | L |

## Next Steps

1. Consider enabling `ANTHROPIC_API_KEY` as a repo secret to un-skip 1 test + enable novel editor pass in GHA
2. Roadmap is complete — all 19 MCP tools implemented + full CLI surface + auth + idempotency + Firestore in CI
