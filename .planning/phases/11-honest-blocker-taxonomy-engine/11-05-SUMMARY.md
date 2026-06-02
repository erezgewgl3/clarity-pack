---
phase: 11-honest-blocker-taxonomy-engine
plan: 05
subsystem: shared-engine-and-worker-liveness
tags: [blocker-chain, liveness, WR-01, WR-03, WR-04, WR-05, IN-02, IN-04, engine-purity, PRIM-03]
requires:
  - "Plan 11-01 8-variant Terminal union + enriched BlockerChainResult verdict (actionAffordance 'none' already a valid member)"
  - "Plan 11-01 exported classifyVerdict(terminal) + private makeResult success-path assembler"
  - "Plan 11-02 src/worker/situation/agent-liveness.ts resolveAgentState (D-02/D-03/D-04)"
  - "11-REVIEW.md warnings WR-01/WR-03/WR-04/WR-05 + IN-02/IN-04"
provides:
  - "src/shared/blocker-chain.ts — export makeDegradedResult(terminal, startId, degradeReason?): the SINGLE shared degrade-row constructor Wave 2 (11-06) adopts (IN-04)"
  - "src/shared/blocker-chain.ts — export makeBlockerFreeResult(startId, label): blocker-free synthetic row forced to actionAffordance 'none' (WR-01 root)"
  - "src/shared/blocker-chain.ts — both EXTERNAL branches now name `current` (the leaf) so label and targetIssueUuid agree (WR-05)"
  - "src/worker/situation/agent-liveness.ts — positive-value cadence guard (>0) so a host cadence of 0 falls back to RUNNING_WINDOW_MS, not a 0-width window (WR-03)"
  - "src/worker/situation/agent-liveness.ts — resolveAgentState return type narrowed to 'working' | 'stuck'; nullability lives at the call site (WR-04)"
  - "src/shared/scrub-human-action.ts — step comments renumbered contiguous 1-5 (IN-02)"
affects:
  - "src/worker/handlers/flatten-blocker-chain.ts (Wave 2 / 11-06: degraded() + noBlockers() adopt makeDegradedResult + makeBlockerFreeResult; WR-03 caller follow-up at :184)"
  - "src/worker/handlers/org-blocked-backlog.ts (Wave 2 / 11-06: WR-03 caller follow-up at :289; adopt makeDegradedResult)"
  - "src/ui/surfaces/reader/live-blocker-panel.tsx (Wave 3 / 11-07: a blocker-free row now carries 'none' so the dead 'Open ↗' button is gone)"
tech-stack:
  added: []
  patterns:
    - "Single shared row-constructor for degrade rows (makeDegradedResult) so a future verdict field cannot be silently missed by hand-built objects across handlers (IN-04)"
    - "Forced-non-actionable verdict for the blocker-free case (makeBlockerFreeResult) — deliberately NOT classifyVerdict, because EXTERNAL->'open' is correct for genuine externals (WR-01)"
    - "Positive-value guard over nullish coalescing when 0 is a meaningful-but-invalid host value (WR-03)"
    - "Nullability at the call site, not the helper — narrowed return type forces callers to own the null case (WR-04)"
    - "Engine purity invariant held through every edit: 100x determinism + AI-vendor-token grep guard stay green (PRIM-03 / SC4)"
key-files:
  created: []
  modified:
    - src/shared/blocker-chain.ts
    - src/worker/situation/agent-liveness.ts
    - src/shared/scrub-human-action.ts
    - test/shared/blocker-chain.test.mjs
    - test/worker/situation/agent-liveness.test.mjs
decisions:
  - "WR-01 'none' approach: a dedicated makeBlockerFreeResult helper that OVERRIDES the verdict to non-actionable ('none'/'watch'/needsYou false), rather than touching classifyVerdict's EXTERNAL->'open' mapping — a real external blocker stays openable; only the blocker-free synthetic row is silenced (cited in code comment)."
  - "WR-05 root: the only-external-children branch labeled externalEdge.to (a refused child the walk never recursed into) while targetIssueUuid was the leaf (current) — an id mis-attribution. Both EXTERNAL branches now name current; the dead externalEdge local was dropped."
  - "WR-03: a host cadence of 0 is meaningful-but-invalid (a 0-width stale window). A POSITIVE-value guard (expectedCadenceMs > 0) falls back to RUNNING_WINDOW_MS; nullish coalescing would have passed 0 through."
  - "Call-site WR-03 follow-ups (flatten-blocker-chain.ts:184, org-blocked-backlog.ts:289) are deferred to Wave 2 (11-06) by plan scope — this plan changes only the helper."
metrics:
  duration: "~20 minutes"
  completed: 2026-06-02
  tasks: 3
  files: 5
  commits: 6
---

# Phase 11 Plan 05: Honest-Taxonomy Engine + Liveness Hardening Summary

The pure shared engine and the worker liveness helper now build on a correct, single-source foundation for the Wave-2 scrub and Wave-3 Reader render. This plan closed the engine/shared-layer warnings from 11-REVIEW.md — the WR-03 cadence-zero window collapse, the WR-04 dead `| null` return type, the WR-05 EXTERNAL label mis-attribution, the IN-02 step-number gap, and the IN-04 missing shared degrade-row constructor — and landed the `'none'` affordance the blocker-free case needs (WR-01 root). Engine purity (PRIM-03 / SC4) held through every edit: the 100x-determinism test and the AI-vendor-token grep guard stay green, and no clock or AI token entered `blocker-chain.ts`.

## What Shipped

- **WR-03 cadence-zero collapse + WR-04 dead `| null` (Task 1).** `resolveAgentState` now computes the cadence via a POSITIVE-value guard — `typeof expectedCadenceMs === 'number' && expectedCadenceMs > 0 ? expectedCadenceMs : RUNNING_WINDOW_MS` — so a host value of `0` falls back to the established 5-min window instead of collapsing the stale band to `2 * 0 = 0` (which had falsely classified a fresh-heartbeat agent `stuck`). The return type is narrowed from `'working' | 'stuck' | null` to `'working' | 'stuck'`; the doc comment now states nullability belongs at the call site (callers supply `null` when `assigneeAgentId == null`). The call sites themselves are untouched this plan (Wave 2's WR-03 follow-up).
- **WR-05 EXTERNAL label mis-attribution (Task 2).** The only-external-children branch previously labeled `External (${externalEdge.to})` — a refused child node the walk never recursed into — while `targetIssueUuid` was the leaf (`current`). The label now reads `External (${current})`, so the label and `targetIssueUuid` name the SAME node, matching the reached-via-external branch. The now-dead `externalEdge` local was dropped.
- **IN-04 shared degrade-row constructor (Task 2).** `blocker-chain.ts` now exports `makeDegradedResult(terminal, startId, degradeReason?)` — the single source for the UNCLASSIFIED degrade row that the three hand-built objects in the worker handlers will adopt in Wave 2 (11-06). It mirrors `makeResult`'s assembly (classifyVerdict-derived verdict, `pathIds = [startId]` when present, `isStale` false, `targetAgentUuid` null, `targetIssueUuid` = `startId || null`, optional `degradeReason`) so a future verdict field cannot be silently missed by a hand-built object. The success-path `makeResult` is unchanged.
- **WR-01 blocker-free `'none'` affordance (Task 2).** `blocker-chain.ts` now exports `makeBlockerFreeResult(startId, label)`, which forces the genuinely-blocker-free synthetic row to `actionAffordance: 'none'`, `tier: 'watch'`, `needsYou: false`. This deliberately OVERRIDES the verdict rather than routing the synthetic `EXTERNAL` terminal through `classifyVerdict` — `classifyVerdict(EXTERNAL)` correctly returns `'open'` for a genuine external blocker (which is openable), and that mapping is intentionally left untouched. Only the blocker-free case is silenced; Wave 2's `noBlockers()` will consume this shape, killing the dead "Open ↗" button on a no-blockers row.
- **IN-02 step renumber (Task 3).** `scrub-human-action.ts`'s inline step comments are contiguous `1-2-3-4-5` again (the removed sentinel branch had left a gap at Step 3). Comment-only — no branch logic, UUID regex, signature, or behavior changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a wrong RED-test fixture for the WR-05 reached-via-external assertion**
- **Found during:** Task 2 (GREEN run)
- **Issue:** My initial RED fixture used edge `A→B reason=external` and asserted `targetIssueUuid === 'B'`. That fixture is structurally impossible to reach: external edges are filtered out of `continuingEdges`, so the walk never recurses into B — A is the leaf and the only-external-children branch fires on A, making `targetIssueUuid === 'A'`. The assertion was testing a non-existent code path, not a defect.
- **Fix:** Re-pointed the fixture at the genuinely reachable only-external-children leaf path (`A→B blocks`, `B→C external`), asserting the EXTERNAL label and `targetIssueUuid` both name the leaf `B` and that the refused external child `C` is NOT in the label. This is the real WR-05 invariant.
- **Files modified:** test/shared/blocker-chain.test.mjs
- **Commit:** 5a5520f

No other deviations — the three source edits matched the plan's chosen approaches exactly. No authentication gates occurred. No new package installs (threat T-11-05-SC N/A).

## Verification

- `node --test test/shared/blocker-chain.test.mjs` → 21/21 pass, including "Determinism — same input produces same output bytes across 100 invocations" and the "PRIM-03 deterministic-graph-only" AI-token guard.
- `node --test test/shared/scrub-human-action.test.mjs` → 7/7 pass (behavior unchanged by the comment renumber).
- `node --test test/worker/situation/agent-liveness.test.mjs` → 11/11 pass, including the new `expectedCadenceMs = 0` fresh-heartbeat → `working` fixture (WR-03) plus the undefined-cadence regression and the D-04 no-signal → `stuck` guard.
- Full worker suite (`test/worker/**/*.test.mjs`) → 1032/1032 pass (no regression from the return-type narrowing — callers already supply `null` themselves).
- Engine purity: AI-vendor-token grep `(openai|anthropic|claude_local|llm|gpt|completion)` → 0 matches in `blocker-chain.ts`; `Date.now|new Date` → 0 matches.
- `export function makeDegradedResult` present in `blocker-chain.ts`; `expectedCadenceMs > 0` present in `agent-liveness.ts`; `resolveAgentState` signature is `'working' | 'stuck'` (the surviving `| null` grep match is the file-header describing the engine's injected `agentState` string, not the helper signature).
- `npx tsc --noEmit` → 0 errors total (the return-type narrowing introduced no new caller errors).

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`. T-11-05-01 (EXTERNAL label info-disclosure) is handled by keeping the label UUID-bearing in the pure engine and deferring the scrub to the Wave-2 boundary, as planned — WR-05 only makes the label name `current` consistently, which narrows (not widens) what the label can leak. T-11-05-02 (engine purity tampering) is held green by the determinism + AI-token guards. No threat flags raised.

## Known Stubs

None. All three edits are complete and tested; no placeholder values, no unwired data paths. `makeDegradedResult` and `makeBlockerFreeResult` are exported and exercised by tests; their Wave-2 adoption in the worker handlers is the explicit next-wave step (11-06), not a stub.

## For Wave 2 (11-06) and Wave 3 (11-07)

- 11-06 should replace the hand-built `degraded()` object in `flatten-blocker-chain.ts` (and the org-blocked-backlog equivalent) with `makeDegradedResult`, and replace `noBlockers()`'s `classifyVerdict(EXTERNAL)` assembly with `makeBlockerFreeResult` so the blocker-free row carries `'none'`.
- 11-06 also owns the WR-03 CALLER follow-up at `flatten-blocker-chain.ts:184` and `org-blocked-backlog.ts:289` (the helper is now correct; the call sites passing cadence still need their own audit).
- 11-07's Reader render now receives `actionAffordance: 'none'` for a no-blockers issue — the dead `.clarity-blocker-action` "Open ↗" button (WR-02) should be omitted/handled for the `'none'` affordance.

## Self-Check: PASSED

All 5 modified files exist on disk and all 5 per-task commits (93e096a, 4c3d3d9, f7543e9, 5a5520f, 5a08967) are present in git history.
