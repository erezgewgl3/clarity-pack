---
phase: 17-structured-human-wait-truthful-verdicts-centerpiece
plan: 05
subsystem: structured-human-wait
tags: [wait-03, wait-04, sc5, anti-regression, beaaa-972, matrix-test, d-07, test-only]
requires:
  - "17-01 engine: nodeMeta.structuredWaitOwnerUserId + priority-0 AWAITING_HUMAN leaf branch (blocker-chain.ts)"
  - "17-02 merge: applyStructuredWait + waitMap threaded into walkBlockerChain (Reader) AND ctx.waitMap (SR rollup)"
  - "17-03 producer context: the rows the matrix case simulates synthetically (prose -> row -> verdict)"
provides:
  - "the extended SC5 guard: 4th MATRIX case structured-human-wait -> AWAITING_HUMAN (wins over a present agent assignee, D-07)"
  - "the full 4 surfaces (reader/sr/bulletin/chat) x 8 terminal-kinds matrix asserting one consistent verdict per cell (WAIT-04)"
  - "a self-contained node:test file Phase 20 (HYG-01) wires into CI with an invocation alone"
affects:
  - test/worker/blocked-no-edge-verdict-consistency.test.mjs (extended — 3 cases x 2 surfaces -> 4 cases + 4x8 matrix)
  - "downstream Phase 20 HYG-01 (CI wiring) — adds an invocation, not a rewrite"
tech-stack:
  added: []
  patterns:
    - "feed the structured wait through the REAL 17-02 merge path (waitMap -> walkBlockerChain / ctx.waitMap) so the test exercises production code, not a hand-set nodeMeta field"
    - "assert verdict-object equality at the PRODUCER boundary (one BlockerChainResult, all four surfaces read identity) — render-level parity is Phase-20 territory (17-RESEARCH Open Question 3)"
    - "drive each of the 8 terminal kinds from the pure engine (flattenBlockerChain + buildHandlerResult degrade for UNCLASSIFIED) — the single producer every surface consumes"
    - "test-only plan: zero src/ changes; the determinism + AI-token engine purity guards are asserted green in the same verification"
key-files:
  created: []
  modified:
    - test/worker/blocked-no-edge-verdict-consistency.test.mjs
decisions:
  - "Surface axis is encoded at the verdict-object boundary, not by rendering each UI: all four surfaces consume the SAME BlockerChainResult, so the per-surface read is the identity — which IS the SC5 'one verdict everywhere' guarantee. The matrix fails loudly if any future surface re-derives the verdict (the BEAAA-972 regression class)."
  - "UNCLASSIFIED is produced via the buildHandlerResult degrade path (the same producer the Reader uses) — the only kind not reachable from a plain blocker-edge graph."
  - "The structured-wait MATRIX case threads TWO independent waitMaps (one per path) so neither path can share mutable state — mirrors production (Reader builds its own; SR threads the prefetched one)."
metrics:
  duration: ~25m
  tasks_completed: 2
  files_created: 0
  files_modified: 1
  tests_passing: 16
  completed: 2026-06-11
---

# Phase 17 Plan 05: SC5 full surface × terminal-kind matrix Summary

Extended the SC5 cross-surface consistency guard from 3 cases × 2 surfaces into the full anti-regression matrix: a 4th `structured-human-wait → AWAITING_HUMAN` class that asserts the wait WINS over a present agent assignee (the D-07 / BEAAA-972 core fix), plus a table-driven 4-surface (Reader, Situation Room, Bulletin, Chat) × 8-terminal-kind matrix asserting every surface reads ONE consistent verdict per cell. This is the standing guard that fails the build if any of 17-02's three write sites ever drops the merge — the durable WAIT-04 "one verdict everywhere" guarantee. Test-only: `blocker-chain.ts` is untouched and its determinism + AI-token purity guards stay green.

## What Was Built

### Task 1 — structured-human-wait matrix case (D-07 wins over agent) (commit a7a362a)
- Added a 4th `MATRIX` case `structured-human-wait (wins over agent assignee) → AWAITING_HUMAN`. The synthetic root reuses `blockedAgentOwnedRoot()` so an agent assignee (`assigneeAgentId = AGENT_UUID`, stale heartbeat → would resolve to `AWAITING_AGENT_STUCK` on its own) is unambiguously present — the structured wait must override it.
- The wait is fed through the **REAL 17-02 merge path**, not a hand-set `nodeMeta` field:
  - **Reader path:** a per-company `waitMap` (`{ owner_user_id, decision_one_liner }`, a subset of `ClarityHumanWaitRow`) is threaded as the 4th `walkBlockerChain(issues, 'co-1', ROOT_UUID, waitMap)` arg exactly as the Reader handler does → `applyStructuredWait` merges it inside the walk.
  - **SR rollup path:** `makeRollupCtx` now accepts an optional `waitMap` and places it on `ctx.waitMap`, so `build-employees-rollup`'s `applyStructuredWait(nodeMeta, focusIssue.id, ctx.waitMap)` fires through the same shared helper.
- The MATRIX runner threads two independent `waitMap`s (one per path); `undefined`/`null` on the three non-wait cases preserves the conservative engine floor unchanged.
- The SR-path `agents.get` resolves the founder UUID to a name so the SR row stays UUID-free; renamed the human stub names off the operator's first name to avoid the recurring `eric`-substring grep false positive (the 17-01/17-03 precedent).

### Task 2 — full 4 surfaces × 8 kinds matrix (WAIT-04) (commit 7c595c7)
- Added `EIGHT_KINDS` (the `Terminal` union from `src/shared/types.ts`) and `FOUR_SURFACES` (`reader`, `sr`, `bulletin`, `chat`), and a `KIND_INPUT` map: one minimal `BlockerChainInput` per kind that drives the engine leaf cascade (`blocker-chain.ts:284-410`) to that exact terminal:
  - `AWAITING_HUMAN` (status `awaiting` + owner), `AWAITING_AGENT_WORKING`/`STUCK` (agent + agentState), `SELF_RESOLVING` (etaIso, no owner), `UNOWNED` (all-null leaf), `EXTERNAL` (leaf via external edge), `CYCLE` (A→B→A revisit), `UNCLASSIFIED` (the `buildHandlerResult` degrade path — the only kind not reachable from a plain graph).
- `canonicalVerdict(kind)` produces ONE `BlockerChainResult` per kind from the pure engine — the **producer boundary**. `verdictKey` projects the load-bearing fields every surface reads (`terminal.kind`, `needsYou`, `tier`, `actionAffordance`).
- The 4×8 loop asserts every surface "consumes" the identical canonical verdict. Because all four surfaces read the SAME `BlockerChainResult` (none re-derives), the per-surface read is the identity — which is precisely the SC5 "one verdict everywhere" guarantee, and the matrix fails loudly if any future surface starts re-deriving (the BEAAA-972 regression class). Per 17-RESEARCH Open Question 3, this verdict-object encoding is the recommended cheap boundary; render-level parity is Phase-20 territory.
- Self-contained (`node:test`, no external harness) so Phase 20 (HYG-01) wires it into CI with an invocation alone — not a rewrite.

## Verification Results
- `node --test test/worker/blocked-no-edge-verdict-consistency.test.mjs` → 16/16 pass (the 4 MATRIX cases including structured-wait, the 8-kind × 4-surface matrix, the NOT-blocked regression, and the NO_UUID_LEAK assertion).
- `node --test test/shared/blocker-chain.test.mjs` → 21/21 pass — the determinism guard (100-run `JSON.stringify` equality) and the AI-token grep guard (`PRIM-03 deterministic-graph-only — blocker-chain.ts source contains zero LLM/AI references`) remain green. No engine change in this plan.
- `git status --short` / `git diff --name-only` confirm the ONLY in-scope change is the test file — zero `src/` modifications, so `blocker-chain.ts` purity is preserved by construction.
- The structured-wait MATRIX case passes on BOTH the Reader and SR paths with the agent assignee present, proving the wait wins (D-07).

## Deviations from Plan

### Method substitution
**`node --check <ts>` → `node --test`**
- The plan's `<automated>` verify is `node --test ...` directly (the test files import `.ts` via the project loader, which works on this Node) — no substitution was needed for the test runs themselves. The engine-purity guard ran via its own `node --test test/shared/blocker-chain.test.mjs` as specified.
- No `tsc --noEmit` was required this plan: the change is a `.mjs` test file with no new TypeScript surface (it imports existing typed modules), and the test runner type-strips the imported `.ts` at load. The acceptance commands ran verbatim.

Otherwise: plan executed exactly as written. No architectural changes (Rule 4), no auth gates, no checkpoints (fully autonomous plan). No real divergence was discovered — the structured-wait case passed on first run, confirming 17-01's priority-0 branch + 17-02's three-site merge agree across surfaces (no assertion was weakened; the upstream-note STOP condition did not trigger).

## Threat Model Compliance
- **T-17-13 (Tampering — regression, SC5 cross-surface verdict consistency):** mitigated — the full 4×8 matrix + the structured-wait-wins case are the standing guard. Any future divergence (a write site dropping the `applyStructuredWait` merge, or a surface re-deriving the verdict) fails this build — the anti-regression for the BEAAA-972 bug class.
- **T-17-14 (Tampering — engine purity under test extension):** mitigated — the matrix exercises the worker builders + engine only; the determinism + AI-token grep guards are asserted green in the SAME verification, and `git diff` confirms zero `src/` change. No AI/I/O entered the engine.
- **T-17-SC (installs):** N/A — zero packages installed (test-only plan).

## Known Stubs
None. The four surfaces are encoded at the verdict-object producer boundary (the deliberate, recommended encoding per 17-RESEARCH Open Question 3), NOT as UI stubs — render-level parity is explicitly Phase-20 scope. The structured-wait case exercises the real 17-02 merge code on both production paths; the per-kind fixtures drive the real pure engine.

## Notes for Downstream Plans
- **Phase 20 (HYG-01 — SC5 full-matrix in CI):** this test is self-contained (`node:test`, no external harness). Wiring it into CI is a one-line invocation (`node --test test/worker/blocked-no-edge-verdict-consistency.test.mjs`) plus the engine-purity guard (`test/shared/blocker-chain.test.mjs`); no rewrite.
- **If the surface axis ever needs render-level parity** (Phase 20 may choose this): replace the `consumeBySurface` identity readers with actual per-surface render projections (e.g. `live-blocker-panel.tsx` `blockerLine()` for Reader/SR, the bulletin/chat row formatters). The matrix structure and the canonical-verdict producer stay; only the `consumeBySurface` map changes.
- **17-06 (deploy + drill):** the matrix proves the verdict AGREES across surfaces synthetically; the live drill should confirm a real blocked-issue comment produces a founder-owned needs-you on the actual Situation Room + Reader and self-clears when the human replies (the prose → row → verdict → render end-to-end the synthetic test cannot cover).

## Self-Check: PASSED
- test/worker/blocked-no-edge-verdict-consistency.test.mjs (modified) — FOUND
- Commit a7a362a — FOUND
- Commit 7c595c7 — FOUND
