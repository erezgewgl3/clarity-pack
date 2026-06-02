---
phase: 12-needs-you-triage
plan: 02
subsystem: worker/situation
tags: [needs-you, leverage, triage, NO_UUID_LEAK, determinism]
requires:
  - "12-01: classifyVerdict AWAITING_AGENT_STUCK → actionAffordance 'assign', needsYou false (engine green)"
  - "Phase 11: engine verdict (needsYou/tier/actionAffordance) on every blockerChain"
provides:
  - "src/worker/situation/leverage.ts — pure reverse-count leverage + per-leaf dedup + leverage-DESC stable sort"
  - "build-employees-rollup: Needs-you ranked by leverage, per-leaf deduped, banner topAction = highest-leverage"
affects:
  - "Situation Room Needs-you list ordering + count + banner topAction (D-08 SR-only)"
tech-stack:
  added: []
  patterns:
    - "Caller computes the impure/ranking bits over engine-supplied structural data (D-16) — leverage lives in the worker, never the engine"
    - "Copy-then-sort, time-free deterministic ordering (mirrors blocker-chain.ts pickTopChains)"
key-files:
  created:
    - src/worker/situation/leverage.ts
    - test/worker/situation/leverage.test.mjs
  modified:
    - src/worker/situation/build-employees-rollup.ts
    - test/worker/situation/build-employees-rollup-needsyou.test.mjs
    - test/worker/situation/build-employees-rollup.test.mjs
decisions:
  - "Per-leaf dedup key = blockerChain.targetIssueUuid (the engine leaf node UUID, === picked.pathIds[last]); read as a structural dispatch key only, never rendered (NO_UUID_LEAK)"
  - "needs_you band is re-ordered by leverage within the global locked status-bucket layout; non-needs-you groups untouched (D-08; Working/Idle grouping left to Phase 15)"
  - "count = number of distinct deduped action items (one per leaf), replacing the prior agentId-Set count (D-03)"
metrics:
  duration: ~35m
  completed: 2026-06-02
  tasks: 2
  files: 5
---

# Phase 12 Plan 02: Leverage-Ranked Needs-You Triage Summary

Needs-you now tells the truth and ranks by leverage: a pure `leverage.ts` helper reverse-counts the engine's existing chain leaves ("items each action frees"), the rollup orders the needs_you band leverage-descending with a time-free stable-id tie-break, collapses per leaf, and repoints the banner topAction to the highest-leverage item — all with NO new host fetch and NO_UUID_LEAK preserved.

## What Was Built

### Task 1 — Pure leverage helper (`src/worker/situation/leverage.ts`)
- `computeLeverageByLeaf(rows)`: for each needs-you row, +1 leverage to the leaf its chain terminates at (the last `pathIds` element, falling back to `targetIssueUuid`); rows sharing a leaf collapse into ONE action item carrying `leverage` = the count and a deterministic representative (smallest-agentId among collapsed). Reverse-counts existing engine data — no fetch, no clock, no I/O (D-01/D-03).
- `sortActionItemsByLeverage(items)`: copy-then-sort by leverage DESCENDING, tie-break by `stableId` (leaf key) ASCENDING. Reads NO timestamp/age field → deterministic, clock-independent (D-02). Does not mutate input.
- Header comment cites D-01/D-02/D-03 and states leverage is sort-only (D-07) and Situation-Room-only (D-08). Emits NO rendered "unblocks N" string.

### Task 2 — Apply rank + dedup + banner repoint (`build-employees-rollup.ts`)
- Needs-you SET = the union of the two engine-verdict partitions (`unowned` = `needsYou===true && actionAffordance==='assign'`, plus viewer-targeted via `rowTargetsViewer`), de-duped by agentId. Membership keys STRICTLY off the engine verdict — never `ownerName === 'Unassigned'` (D-11). Agent-working / self-resolving / stuck rows have `needsYou===false` and never target the viewer, so they are excluded by construction.
- Leverage computed over the needs-you rows (feeding each row's `blockerChain.targetIssueUuid` as the leaf key); needs_you partition re-ordered leverage-DESC / stable-id-ASC and spliced back into the global locked status-bucket layout (non-needs-you groups untouched, D-08).
- `needsYou.count` = distinct deduped action items (one per leaf, D-03), replacing the prior agentId-Set count.
- `needsYou.topAction` repointed from `oldestUnowned`/`oldestTargeting` to the HIGHEST-LEVERAGE action item (`rankedItems[0]`); `humanAction` stays the already-scrubbed string, `leafIssueId`/`leafIssueUuid` carried for the picker (NO_UUID_LEAK, R4 no-dead-button).

## Verification — commands run

| Command | Result |
|---------|--------|
| `node --test test/worker/situation/leverage.test.mjs` | PASS — `tests 8 / pass 8 / fail 0` |
| `node --test .../build-employees-rollup-needsyou.test.mjs .../build-employees-rollup.test.mjs .../build-employees-rollup-viewer-single-source.test.mjs` | PASS — `tests 39 / pass 39 / fail 0` |
| `node --test` (all four situation files together) | PASS — `tests 47 / pass 47 / fail 0` |
| `node --test test/shared/blocker-chain.test.mjs` (engine purity / determinism / AI-grep guard) | PASS — `tests 21 / pass 21 / fail 0` |
| `npx tsc --noEmit` (package.json `typecheck`) | PASS — `TSC_EXIT:0` |

Output tails (representative):
```
ℹ tests 47
ℹ pass 47
ℹ fail 0
```
```
=== typecheck ===
TSC_EXIT:0
```

### Acceptance-criteria proofs
- **Leverage sort is time-free / deterministic:** `leverage.test.mjs` Test 6 (byte-identical re-sort + no input mutation) and Test 7 (order unchanged when wildly different `__activityMs` stamps are attached, in both input orders). Rollup-level: `build-employees-rollup-needsyou.test.mjs` D-02 test (flipping the lone row to NEWEST does not change the highest-leverage topAction).
- **Source purity:** `grep -nE "Date\.now|ctx\." src/worker/situation/leverage.ts` matches ONLY the purity comment on line 28 — no `Date.now(` call, no `ctx.` access in code.
- **No new fetch for leverage:** `git diff HEAD` over `build-employees-rollup.ts` adds zero `ctx.issues.*` / `ctx.agents.*` calls — leverage reads only `r.blockerChain.*` fields already in hand.
- **NO_UUID_LEAK preserved:** `topAction.humanAction` carries no raw UUID (needsyou Test 11); the existing `awaitedPartyLabel`/`humanAction` scrub path and split display-label vs mutation-UUID separation are untouched (main rollup Test 22 still green).

## Deviations from Plan

### Test update (in-scope, owned file)
**[Rule 3 — Blocking] `build-employees-rollup.test.mjs` Test 10 rewritten to the NY-02 contract**
- **Found during:** Task 2 GREEN — the plan's verify command includes this file.
- **Issue:** Test 10 encoded the pre-NY-02 within-blocked ordering ("oldest activity first"), which D-02 deliberately replaces (needs_you band is now leverage-DESC / stable-leaf-id-ASC, time-free).
- **Fix:** Rewrote the test to assert the new deterministic order (equal leverage → leaf `x1` before `x2`), keeping the test's intent (deterministic within-needs_you ordering) honest. The test file is owned by this plan.
- **Commit:** `e741f68`

No other deviations — the helper locus, dedup key, and fixtures were planner discretion (D-02/D-03) and stayed time-free + pure.

## Deferred Issues (out of scope — SCOPE BOUNDARY)
- 7 pre-existing REQUIREMENTS.md traceability failures (`test/phases/04-traceability.test.mjs` CHAT-01..11 / CTT-01..08). Re-confirmed pre-existing by stashing the 12-02 source and reproducing them on baseline `b67d291`. REQUIREMENTS.md was not touched by this plan. Logged in `deferred-items.md`.

## Commits
- `eff6376` test(12-02): add failing leverage helper tests (RED)
- `d62e5fd` feat(12-02): pure leverage helper — reverse-count + per-leaf dedup + stable sort
- `a5d9c9f` test(12-02): add leverage rank + per-leaf dedup + D-12 topAction tests (RED)
- `e741f68` feat(12-02): leverage-rank Needs-you + per-leaf dedup + highest-leverage topAction

## Self-Check: PASSED

- FOUND: src/worker/situation/leverage.ts
- FOUND: test/worker/situation/leverage.test.mjs
- FOUND: .planning/phases/12-needs-you-triage/12-02-SUMMARY.md
- FOUND commits: eff6376, d62e5fd, a5d9c9f, e741f68
