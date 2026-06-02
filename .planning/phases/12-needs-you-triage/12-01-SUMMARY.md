---
phase: 12-needs-you-triage
plan: 01
subsystem: shared-engine
tags: [engine-purity, verdict-table, blocker-chain, determinism, NY-03]
requires: []
provides:
  - "classifyVerdict(AWAITING_AGENT_STUCK) → actionAffordance 'assign' (D-05)"
  - "per-kind {tier, actionAffordance, needsYou} table remains the single source of truth"
affects:
  - src/worker/situation/build-employees-rollup.ts
  - src/ui/surfaces/reader/live-blocker-panel.tsx
tech-stack:
  added: []
  patterns:
    - "pure per-kind verdict table (single source of truth, Phase 11 D-14)"
    - "PRIM-03 deterministic engine + AI-token grep guard"
    - "TDD RED (gate test) → GREEN (1-line engine edit)"
key-files:
  created:
    - .planning/phases/12-needs-you-triage/12-01-SUMMARY.md
    - .planning/phases/12-needs-you-triage/deferred-items.md
  modified:
    - src/shared/blocker-chain.ts
    - src/shared/types.ts
    - test/shared/blocker-chain.test.mjs
    - test/worker/situation/build-employees-rollup.test.mjs
decisions:
  - "D-05: AWAITING_AGENT_STUCK affordance flipped to 'assign'; tier 'watch' + needsYou false unchanged"
  - "D-06: 'nudge' kept in the actionAffordance union (dormant, reserved for Phase 14)"
metrics:
  duration: "~20m"
  completed: 2026-06-02
---

# Phase 12 Plan 01: D-05 Stuck-Agent Affordance Summary

One-line edit to the pure verdict table — a stuck agent's honest answer is re-owning the issue, so `classifyVerdict(AWAITING_AGENT_STUCK)` now returns `actionAffordance: 'assign'` (was `'nudge'`); `tier: 'watch'` and `needsYou: false` stay exactly as before, keeping stuck agents out of the loud Needs-you list while gaining the assign affordance NY-03 requires.

## What Changed

- **`src/shared/blocker-chain.ts`** — `classifyVerdict` `case 'AWAITING_AGENT_STUCK'` now returns `{ tier: 'watch', actionAffordance: 'assign', needsYou: false }`. JSDoc added stating the D-05 rationale and that `'nudge'` is reserved for the Phase 14 reply/nudge loop. No other case, the `never` guard, `makeResult`, `makeDegradedResult`, `makeBlockerFreeResult`, `flattenBlockerChain`, or `pickTopChains` touched. Comment kept AI-token-free.
- **`src/shared/types.ts`** — `'nudge'` retained in the `actionAffordance` union (D-06 — dormant, not deleted). Updated the union JSDoc and the inline `AWAITING_AGENT_STUCK` Terminal comment to reflect that stuck rows now offer 'assign'.
- **`test/shared/blocker-chain.test.mjs`** — all-8-kinds table test + the stuck flatten test now assert `actionAffordance: 'assign'` (RED-first gate). Determinism (100× JSON.stringify) and PRIM-03 AI-token grep guard untouched.
- **`test/worker/situation/build-employees-rollup.test.mjs`** — the split-identity (NO_UUID_LEAK) test asserted the old `'nudge'` value; updated to `'assign'` since the engine is the single source of truth. NO_UUID_LEAK assertions unchanged.

## Test Results

- `node --test test/shared/blocker-chain.test.mjs` → **21 pass / 0 fail** (includes Determinism + PRIM-03 AI-token grep guard).
- `node --test test/worker/situation/build-employees-rollup.test.mjs` → **24 pass / 0 fail**.
- `npm run typecheck` (`tsc --noEmit`) → exit 0.
- Full suite `node --test "test/**/*.test.mjs"` → 2342 pass / 7 fail — the 7 are pre-existing Phase 4/4.1 REQUIREMENTS.md traceability failures (CHAT-01..11, CTT-01..08), unrelated to this plan (REQUIREMENTS.md unmodified here). Logged to `deferred-items.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - stale test] build-employees-rollup split-identity assertion updated to 'assign'**
- **Found during:** Full-suite verification after Task 1.
- **Issue:** `test/worker/situation/build-employees-rollup.test.mjs` (line ~606) asserted `actionAffordance === 'nudge'` for an AWAITING_AGENT_STUCK row. This broke directly because of the intended D-05 engine change (single source of truth propagates to consumers).
- **Fix:** Updated the assertion + narrative comment to `'assign'`; left every NO_UUID_LEAK assertion (scrubbed `awaitedPartyLabel`/`humanAction`, mutation-only `targetAgentUuid`/`targetIssueUuid`) unchanged.
- **Files modified:** test/worker/situation/build-employees-rollup.test.mjs
- **Commit:** 6e7c50a

### Out-of-scope (deferred, NOT fixed)

7 pre-existing Phase 4/4.1 REQUIREMENTS.md traceability test failures — see `deferred-items.md`. REQUIREMENTS.md was not modified by this plan; these are unrelated to D-05.

## Notes

- `src/ui/surfaces/reader/live-blocker-panel.tsx` still has `case 'nudge':` switch branches. With D-05 these become dormant/unreachable (no verdict returns 'nudge'), consistent with D-06. Editing that surface (assign-gating, D-09) is the job of later Phase 12 plans, not this wave-1 engine edit — left untouched.
- NO_UUID_LEAK preserved: `classifyVerdict` reads only the discriminant and emits no labels; the rollup NO_UUID_LEAK assertions stayed green.

## TDD Gate Compliance

- RED gate: `test(12-01): gate D-05 stuck-agent affordance to 'assign'` — commit `473bb09` (failed first against the unchanged engine, verified).
- GREEN gate: `feat(12-01): D-05 — stuck-agent affordance becomes 'assign' in classifyVerdict` — commit `cfc0997`.
- No refactor gate needed.

## Self-Check: PASSED
