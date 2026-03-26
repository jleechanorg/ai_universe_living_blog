---
title: Quality Gates
purpose: Tests, PR evidence requirements, merge gates, and coding rules
owner: AO team
last_reviewed: "2026-03-26"
source_of_truth: CLAUDE.md
---

# Quality Gates

## Merge Prerequisites

Every PR must pass ALL of the following before merge:

1. `npm test` — Vitest unit + integration tests
2. `python3 scripts/agent_repo_check.py` — structural doc validation
3. **4-layer PR evidence** (see below)
4. CodeRabbit review — APPROVED (not just commented)
5. All inline comments resolved (Major/Critical are blockers)

## PR Evidence Standard — /4layer Required

Every PR requires 4-layer evidence. This is non-negotiable.

### Layer 1: Unit Tests
```bash
npm test
# Attach: test output (pass/fail counts, timing)
```

### Layer 2: Integration / End-to-End Tests
```bash
npm test -- --reporter=verbose
# Attach: full test output
```

### Layer 3: MCP/HTTP API Tests (Real Local Server)
```bash
npm run dev:blog &
sleep 2

curl -s http://localhost:8081/health | jq .
curl -s -X POST http://localhost:8081/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"health_check","arguments":{}}}' | jq .
# Attach: curl outputs
```

### Layer 4: Visual Evidence (Required)
- Minimum 3 screenshots with captions
- Minimum 1 screen recording (~30–60s) showing full flow
- Save to `docs/evidence/<branch-name>/`

## Evidence Directory Structure

```
docs/evidence/<branch-name>/
  layer1-tests.txt
  layer2-integration.txt
  layer3-api/
    health.json
    create_post.json
    list_posts.json
  layer4-visual/
    01-*.png / 01-*.json
    demo.mp4
  evidence.md
```

## Proof of Work Mandate

An agent cannot submit code and call it done. It must prove the code works. Screenshots and recordings transform the human's role from syntax checker to product reviewer.

## No Bypass Allowed

Do not attempt to bypass these gates. `// eslint-disable` comments, empty tests, and fake evidence are detectable and will cause PR rejection.
