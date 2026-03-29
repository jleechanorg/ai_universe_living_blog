---
title: Plans
purpose: Current initiatives, active PRs, known next steps, and open work
owner: AO team
last_reviewed: "2026-03-29"
source_of_truth: GitHub PR list
---

# Plans

## Open PRs

None — all design doc sections (A–F) are implemented and merged.

## Completed Milestones (2026-03-29)

| PR | Title |
|----|-------|
| #33 | feat(cli): blog-cli daily-summary command |
| #32 | feat(server): AUTO_SCAN_ENABLED + AUTO_SCAN_INTERVAL_MS env vars |
| #31 | feat(blog): IP-based rate limiting (Section C) |
| #30 | feat(blog): Demo Mode (Section D) |
| #29 | feat(novel): FIFO bidirectional chat (Section E) |
| #28 | feat(cli): --output=both and --output=none modes |
| #27 | feat(cli): blog-cli entry point (Section A) |
| #19 | feat: Remote Mode + Auto-Scan Architecture |

## Current State

- **Tests:** 332 passing (30 files)
- **Design doc coverage:** 100% (Sections A–F)
- **Auto-merge:** Skeptic cron runs every 30 min, merges on CI + MERGEABLE + no CHANGES_REQUESTED
- **Storage backends:** memory (default), file (STORAGE_TYPE=file), firestore (STORAGE_TYPE=firestore)

## Known Gaps (resolved)

- ~~`install.sh --storage=firestore` flag wiring~~ — storage factory wired via STORAGE_TYPE env var
- ~~Novel engine CLI does not call blog HTTP endpoint~~ — `--output=both` implemented in blog-cli
- ~~`daily-summary` was stubbed in blog-cli~~ — implemented in PR #33

## Next Steps

1. Monitor Firestore integration in production (ADC / emulator tested locally)
2. Consider adding webhook HMAC validation tests
3. Consider adding integration tests that exercise the full AutoScanner poll cycle
