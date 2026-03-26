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

## 2026-03-26 16:45 cycle

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
