# Evolve Loop Findings — ai_universe_living_blog

## 2026-03-26 14:20 cycle

### Zero-touch rate: 0% (0/0 — no merges yet, first cycle)

### System state
- Active AO sessions: 8 (ao-986, ao-987, ao-988, ao-989, jc-895, jc-896, jc-900, jc-901)
- Open PRs: 1 (PR #2 — full Phase 1 implementation)
- Closed this cycle: PR #1 (superseded by PR #2)

### PR #2 status
- Branch: `feat/orch-yn4`
- Mergeable: clean, no conflicts
- CI: Cursor Bugbot neutral (pass)
- Tests: 34/34 passing, TypeScript build clean
- CodeRabbit: 28+ review rounds, all original Critical/Major issues resolved
- Blocker: CR has not reviewed latest commits (last push 14:02Z, last CR review 12:33Z)
- Action taken: Posted `@coderabbitai review` to trigger fresh review

### Issues resolved in PR #2 (confirmed in current branch)
1. ✅ `get_thread` scoped by `repoKey` (was Major, first raised 2026-03-25)
2. ✅ Invalid timestamp guard in `branch-generator.ts` (was Major)
3. ✅ CLI arg parsing handles `--key val` and `--key=val` (was Major)
4. ✅ `threadId` validation + cross-repo rejection (was Critical)
5. ✅ `approve: true` in `.coderabbit.yaml`
6. ✅ `cleanup` trap registered before `git clone` (was Minor — last known actionable)

### Friction points
- CR review loop: 28+ rounds over 5 hours. Root cause: each push triggers new CR review; agents dismiss and push more fixes without waiting for CR to verify. Pattern creates noise but code quality is solid.

### Beads created
- None this cycle (no new gaps found — existing PR work is code-complete)

### Next cycle priorities
1. Watch for CR APPROVED on PR #2 → merge
2. If CR APPROVED: verify 6-green (CI, mergeable, CR APPROVED, Bugbot neutral, inline resolved, evidence)
3. After merge: publish to npm / set up install test

### Fixes dispatched
- None this cycle — code is ready, waiting on CR

---

## 2026-03-26 17:45 cycle

### Zero-touch rate: 69% (20/29 merged — agent-orchestrator 76%, jleechanclaw 25%)

### System state
- Active sessions: 18 total (7 ao-*, 5 jc-new living blog, 3 jc-old, 2 cc-*, 1 wc-*)
- Living blog workers: jc-905..909 all active (Firestore, install-test, ao-hooks, daily-cron, worker-poster)
- agent-orchestrator open PRs: #202 (clean, CR CHANGES_REQUESTED, no worker), #206/#201 (unstable CI), #207 (no [agento] tag)

### Friction points found

1. **PR #202 unassigned** (agent-orchestrator, CR CHANGES_REQUESTED): No worker assigned. Lifecycle-worker should auto-pick up. Monitor next cycle.

2. **ao-1016 stuck 1h+**: MCP mail registration error (`Agent 'claude' not registered globally`). Sitting on `session/ao-1016` branch, no PR, no progress. Not killing — lifecycle-worker should reap it.

3. **lifecycle-worker running manually** (not via launchd): `ps aux` shows `node /Users/jleechan/bin/ao lifecycle-worker jleechanclaw` started outside launchd. Risk: dies silently on shell exit. Should be bootstrapped via launchd plist.

4. **Zero-touch rate below target**: 69% vs expected 80%+. Root cause: 5 non-[agento] merged PRs were operator harness fixes (stuck-detector, doctor, evidence-gate, prose-polish, upstream-consolidation). These are legitimate operator PRs, not tagging gaps.

### Beads created
- None (no new gaps beyond existing roadmap — ao-1016 MCP mail issue is jleechan-v7oa equivalent)

### Fixes dispatched
- None new this cycle — living blog Phase 2 workers already running
- lifecycle-worker bootstrap: deferred (running, just not via launchd — note for operator)

### Living blog Phase 2 status
- jc-905 (Firestore storage): working — reading code structure
- jc-906 (install smoke test): working — created feat/install-smoke-test branch, writing TDD test
- jc-907 (AO lifecycle hooks): working — reading plan
- jc-908 (daily summary cron): ready — received task
- jc-909 (worker poster): working — progressing

---

### Zero-touch rate: 100% (1/1 — PR #2 merged zero-touch)

### Phase 1 SHIPPED
- PR #2 merged at 14:57 UTC — full Phase 1 implementation on main
- PR #1 closed as superseded
- No open PRs

### New project rule added
- `/4layer` evidence standard added to CLAUDE.md
- All future PRs require: unit tests, integration tests, MCP API tests (real server), visual evidence (screenshots with captions + screen recording with captions)
- Evidence stored in `docs/evidence/<branch>/`

### Roadmap — What's Left

#### P0 — Foundation gaps (blocks real usage)
1. **Firestore storage backend** — `--storage=firestore` flag is wired but `FirestoreBlogStorage` not implemented. MemoryBlogStorage loses data on restart. Needed for production use.
2. **Install verification test** — `install.sh` has not been run against a real target repo. Need a smoke test that installs to a temp repo and verifies the MCP server starts.
3. **4-layer evidence for Phase 1** — No Layer 4 visual evidence exists for the shipped code. First PR after this should include retroactive evidence or the next feature PR must include it.

#### P1 — Worker integration
4. **AO lifecycle hooks** — Auto-trigger `novel branch-entry` when AO worker opens/closes a PR. Currently manual CLI only. Need a hook or webhook that fires on `[agento]` PR events.
5. **Daily summary cron** — `novel daily-summary` must run automatically at EOD. Add cron/launchd job or GitHub Actions workflow.
6. **Worker blog posting** — Workers should `create_post` on key lifecycle events (PR created, review requested, merge). Currently nothing posts automatically.

#### P2 — Quality / observability
7. **Persistent storage path** — JSON file storage mode (currently just MemoryBlogStorage). Allows data to survive restarts without Firestore.
8. **MCP server health monitoring** — No alerting if server dies. Add a heartbeat or launchd KeepAlive wrapper.
9. **Novel config file support** — `--config` flag exists but `loadNovelConfig` not fully validated in tests.

#### P3 — Polish
10. **README install section** — install.sh is in the repo but README doesn't explain the one-liner install flow clearly.
11. **npm publish** — Package not yet published to npm registry. Blocked on install verification (P0 item 2).

## 2026-03-26 17:58 cycle (healthy)

### Zero-touch rate: 69% → unchanged

### Progress
- PR #6 opened: `[P2] feat/daily-summary-cron` (jc-908) — `shouldRunDailySummary` + GitHub Actions workflow
- jc-906 patching install.sh (`--source=` flag)
- jc-907 implementing `src/hooks/ao-lifecycle.ts`
- jc-905 reviewing test context, jc-909 exploring repo

### Friction: none new
### Fixes: none new (workers progressing autonomously)

## 2026-03-26 18:09 cycle (healthy — 2 new PRs)

### Progress
- PR #7 opened: `[P0] feat(storage): FirestoreBlogStorage + storage factory` (jc-905)
- PR #8 opened: `[P1] feat(hooks): AO lifecycle hook + GitHub Actions workflow` (jc-907)
- jc-906 (install smoke test) still working
- jc-909 (worker-poster) still working
- Total open: 3/5 tasks have PRs

### Friction: none new

---

## 2026-03-26 18:20 — /nextsteps assessment

### Ryan transcript proof standard applied
Per OpenAI Ryan talk: PRs must have visual proof (screenshots + screen recording) showing the feature actually works end-to-end, not just passing tests.

### All 5 Phase 2 PRs now open
- PR #6: feat/daily-summary-cron (jc-908) — shouldRunDailySummary + GH Actions cron
- PR #7: feat/firestore-storage (jc-905) — FirestoreBlogStorage, 47 tests
- PR #8: feat/ao-lifecycle-hooks (jc-907) — handlePrEvent(), 8 tests, GH Actions
- PR #9: feat/worker-poster (jc-909) — postEvent(), 38 tests
- PR #5 equivalent: feat/install-smoke-test (jc-906) — in progress

### Critical gap: L4 visual evidence missing from all PRs
None of PRs #6-9 have:
- Screenshots of MCP server running + /health endpoint response
- Screenshots of MCP tool calls (create_post, list_posts) working
- Screen recording of end-to-end flow (start → health → create_post → list_posts)

This is the "proof a real app is being built" standard per Ryan's talk.

### Action: Dispatch L4 evidence workers for each open PR
Bead created: jleechan-eup3

---

## 2026-03-26 18:30 cycle (L4 evidence dispatch)

### Zero-touch rate: 69% → unchanged (no new merges)

### System state
- Workers: jc-905..909 all alive; jc-906 thinking 22+ min (install smoke test); jc-908 checking CR state for PR #6
- Open PRs: #6 (daily-summary-cron), #7 (firestore-storage), #8 (ao-lifecycle-hooks), #9 (worker-poster)
- PR #8 has 1 approval (CR); PRs #6, #7, #9 have 0 approvals
- GraphQL remaining: ~1000 (low — no new ao spawns this cycle)

### Action taken: L4 evidence dispatch
- Sent L4 evidence tasks to 3 idle workers via ao send (no new spawns):
  - jc-905 → PR #7 (firestore-storage) — start server on port 8083, capture /health + create_post + list_posts
  - jc-907 → PR #8 (ao-lifecycle-hooks) — start server on port 8084, capture /health + create_post + list_posts
  - jc-909 → PR #9 (worker-poster) — start server on port 8085, capture /health + create_post + list_posts
- jc-908 still busy with PR #6 CR check — L4 task will be queued after it finishes

### Friction points
- GraphQL exhaustion: 3988/5000 used — prevents ao spawn; workaround: ao send to existing idle workers
- jc-906 stuck thinking 22+ min: may be context-exhausted on install smoke test task
- jc-908 stuck 23+ min on CR review state check: possible GraphQL stall inside worker

### Beads
- jleechan-eup3: L4 evidence gap for PRs #6-9 — dispatched to 3 workers

### Next cycle priorities
1. Verify jc-905/907/909 added evidence to their PRs
2. Send L4 evidence task to jc-908 for PR #6 when it finishes
3. Check jc-906 — if stuck, it needs to be restarted on install smoke test
4. Watch for CR APPROVED on PRs once evidence is added

---

## 2026-03-26 18:40 cycle (healthy — L4 evidence in progress)

### Zero-touch rate: 69% → unchanged

### System state
- Workers: jc-905..909 all alive. jc-906 at 10% until auto-compact (writing install.test.ts). jc-908 still on PR #6 CR check.
- Open PRs: #6-9, 0 approvals each, no merges
- **GraphQL CRITICAL: 336 remaining** — REST-only mode, no ao spawn

### Progress since last cycle
- jc-905: L4 evidence flowing — health check JSON captured for feat/firestore-storage ✅
- jc-906: Actively writing install.test.ts, will auto-compact soon (not stuck)
- jc-907/909: Active, working on PR #9-related branches

### Friction: none new (GraphQL exhaustion was pre-existing)

### Beads: none new

### Fixes: none (workers progressing autonomously)

---

## 2026-03-26 18:51 cycle (PR #8 close to 6-green)

### Zero-touch rate: 69% → unchanged (monitoring for PR #8 merge)

### Key progress
- **PR #7**: jc-905 completed — L4 evidence pushed, ESM fix included, 40 tests pass. CI pending.
- **PR #8**: jc-907 reports CI ✅, mergeable ✅, CR APPROVED ✅, Bugbot ✅. Running evidence-reviewer (criterion 6). Close to 6-green merge!
- **PR #6**: jc-908 fixing CR comment — shell interpolation `${{ inputs.date }}` in workflow
- **PR #9**: jc-909 polling CI status

### GraphQL: EXHAUSTED (0 remaining) — REST-only

### New friction: jc-906 auto-compact
- jc-906 hit 0% context → auto-compacted → went idle
- Re-prompted via ao send with resume task (install smoke test continuation)

### Fixes dispatched
- ao send jc-906: resume install smoke test + L4 evidence after auto-compact

---

## 2026-03-26 19:02 cycle (5 PRs open, PR #8 unblocked)

### Zero-touch rate: 69% → watching for PR #8 merge

### System state
- PRs: 5 open (#6-10), no new merges
  - PR #10 new: `[P1] test(install): add install.sh smoke test` (jc-906 created earlier)
  - PR #8: CI=success ✅, CR APPROVED ✅, but jc-907 stuck on reviewDecision:null
- Workers: jc-908 at 11% (auto-compact imminent), jc-909 at 4% (queued msg triggered)
- GraphQL: 3918 (recovered after reset)

### Friction
1. **jc-907 polling loop**: `reviewDecision: null` interpreted as blocked. Clarified via ao send: null is expected for this repo, proceed with merge if 6-green.
2. **jc-906 uncommitted changes**: post-auto-compact work on feat/jleechan-ugm0 but PR #10 is on feat/install-smoke-test. Sent commit+switch instructions.

### Fixes dispatched
- ao send jc-907: clarify reviewDecision:null, proceed to merge PR #8 if 6-green
- ao send jc-906: commit uncommitted changes to feat/install-smoke-test, update PR #10

---

## 2026-03-26 19:12 cycle (PR #8 MERGED ✅)

### Zero-touch rate: 69% → living blog PR #8 merged zero-touch

### Key events
- **PR #8 MERGED**: [agento] feat(hooks): AO lifecycle hook — merged at 18:26 UTC by jleechan2015 token (zero-touch agent merge)
- jc-907 session cleaned up after completing merge
- **PR #9**: CI=success, CR APPROVED, mergeable=true — merge instruction sent to jc-909 (at 2% ctx, imminent auto-compact)
- 4 PRs remaining: #6 (daily-summary-cron), #7 (firestore-storage), #9 (worker-poster), #10 (install-smoke-test)

### Workers
- jc-907: DEAD (task complete — merged PR #8)
- jc-909: 2% until auto-compact, merge instruction sent
- jc-908: alive, working on PR #6
- jc-905/906: alive, idle

### Fixes dispatched
- ao send jc-909: merge PR #9 before auto-compact
