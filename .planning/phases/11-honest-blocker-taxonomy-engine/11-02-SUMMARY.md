---
phase: 11-honest-blocker-taxonomy-engine
plan: 02
subsystem: worker-blocker-builders
tags: [blocker-chain, liveness, agent-ownership, UNCLASSIFIED, SC5, NO_UUID_LEAK]
requires:
  - "Plan 11-01 8-variant Terminal union + enriched BlockerChainResult verdict"
  - "Plan 11-01 exported classifyVerdict(terminal)"
  - "Plan 11-01 BlockerChainInput.nodeMeta {assigneeAgentId, agentState}"
  - "src/worker/situation/classify-employee-state.ts injected-nowMs precedent (5-min window, A2)"
provides:
  - "src/worker/situation/agent-liveness.ts — pure resolveAgentState(): the SINGLE worker liveness source (D-01/D-02/D-03/D-04)"
  - "buildEdges (org-blocked-backlog.ts) captures assigneeAgentId + worker-resolved agentState per node; EdgeNodeMeta type pins the shape"
  - "thrown edge build/flatten ⇒ honest UNCLASSIFIED row (not a silent drop); need_you keyed on chain.needsYou (D-13)"
  - "walkBlockerChain (flatten-blocker-chain.ts) nodeMeta field-set parity with buildEdges (SC5); EXPORTED for the parity test"
  - "graceful() EXTERNAL lie fixed: walk failures ⇒ UNCLASSIFIED + degradeReason (D-10); genuinely-empty graph stays EXTERNAL (Pitfall 3)"
affects:
  - "src/worker/situation/build-employees-rollup.ts (still fails tsc — Plan 11-03: liveness reuse + verdict re-triage + split-identity)"
  - "src/worker/jobs/humanize-snapshot.ts (still fails tsc — Plan 11-04: dead-job switch update or delete)"
  - "src/ui/surfaces/reader/live-blocker-panel.tsx (still fails tsc — Plan 11-04: kind string-match → verdict.actionAffordance)"
tech-stack:
  added: []
  patterns:
    - "Caller-injects-the-impure-bits: resolveAgentState computes liveness in the worker (clock legitimate), engine reads a pre-resolved string (D-01)"
    - "Defensive-cast field reads: every new nodeMeta field read via loose cast + `?? null` (Pitfall 7 / V5)"
    - "Honest degrade over silent drop: a thrown walk surfaces an UNCLASSIFIED row, never vanishes (TAX-03 / D-09)"
    - "Keep-in-sync over collapse: identical nodeMeta field set threaded into both BFS builders, pinned by a same-shape test (RESEARCH OQ1, SC5)"
key-files:
  created:
    - src/worker/situation/agent-liveness.ts
    - test/worker/situation/agent-liveness.test.mjs
    - test/worker/handlers/flatten-blocker-chain-parity.test.mjs
  modified:
    - src/worker/handlers/org-blocked-backlog.ts
    - src/worker/handlers/flatten-blocker-chain.ts
    - test/worker/org-blocked-backlog.test.mjs
decisions:
  - "Liveness math lives ONLY in resolveAgentState (one worker source); both buildEdges + Plan 11-03 rollup import it — engine stays clock-free (D-01)"
  - "D-04 conservative ordering: a known agent with NO heartbeat (Infinity age) ⇒ stuck regardless of queue, checked BEFORE the queued-work fallthrough"
  - "Keep-in-sync (not full collapse) for the two BFS builders this wave (RESEARCH OQ1) — the Reader ctx (PluginIssuesClient) differs structurally from OrgBlockedBacklogCtx; full collapse exceeds wave budget"
  - "walkBlockerChain now propagates a ROOT relations.get throw (mirrors buildEdges) so the handler can emit UNCLASSIFIED; inner-node throws still swallowed (Pitfall 3)"
metrics:
  duration: "~22 minutes"
  completed: 2026-06-02
  tasks: 3
  files: 6
  commits: 4
---

# Phase 11 Plan 02: Worker Agent-Ownership + Liveness + Honest Degrade Summary

Worker-side agent ownership and liveness now ride into the honest taxonomy engine, and walk failures stop lying. A single pure helper (`resolveAgentState`) projects an agent's heartbeat/queue signals to the engine's injected `agentState` string; both worker BFS builders — the shared `buildEdges` (Situation Room / rollup) and the Reader handler's private `walkBlockerChain` — capture `assigneeAgentId` + that resolved liveness into the identical `nodeMeta` field set, so an agent-owned leaf classifies `AWAITING_AGENT_WORKING/STUCK` the same way on every surface (SC5). The `buildEdges` skip-drop and the Reader's `graceful()` EXTERNAL synthesis both became honest: a blocked issue whose walk throws now surfaces an `UNCLASSIFIED` row with a `degradeReason` instead of silently vanishing or pretending the blocker is external (TAX-03 / D-10).

## What Shipped

- **Pure `resolveAgentState` liveness helper (Task 1, D-02/D-03/D-04).** `src/worker/situation/agent-liveness.ts` exports `resolveAgentState({ lastHeartbeatMs, hasQueuedWork, nowMs, expectedCadenceMs? }) → 'working' | 'stuck' | null`. Stale window = `2 * (expectedCadenceMs ?? RUNNING_WINDOW_MS)` — self-tuning when the host exposes a cadence (D-03), else the established 5-min fixed fallback from `classify-employee-state.ts` (Assumption A2). Fresh heartbeat ⇒ working; stale + nothing-queued ⇒ stuck (D-02); a known agent with NO heartbeat (Infinity age) ⇒ stuck regardless of queue (D-04 conservative). `nowMs` is injected — no wall-clock read, no SDK import (mirrors the `classify-employee-state.ts` precedent). This is the SINGLE liveness source both `buildEdges` and Plan 11-03's rollup import; no liveness math reaches the engine (Pitfall 4 closed).
- **`buildEdges` agent capture + honest skip (Task 2, D-01/TAX-03).** A canonical `EdgeNodeMeta` type pins the nodeMeta shape (used by the return type, the accumulator, and the caller — no drift). Each blocker node now carries `assigneeAgentId` (loose-cast `?? null`) and a worker-resolved `agentState` (via `resolveAgentState`, `null` when no agent on the node). A thrown `buildEdges`/`flatten` no longer `continue`s into a silent drop — it pushes an `UNCLASSIFIED` `BlockerChainResult` (via a new `unclassifiedChain` synth, verdict from `classifyVerdict`) carrying a `degradeReason`, so the blocked issue stays visible.
- **`need_you` re-triage off the verdict (Task 2, D-13).** `need_you_count` now keys on `chain.needsYou`, with V4 viewer-scoping preserved by gating on `terminal.kind === 'AWAITING_HUMAN' && terminal.userId === viewerUserId`. The dead `UNOWNED_SENTINEL` import is gone; a genuinely-UNOWNED chain (no userId, org-wide needs-you) no longer inflates the viewer's count.
- **Reader BFS parity + EXTERNAL-lie fix (Task 3, SC5/D-10).** `walkBlockerChain` threads the identical `assigneeAgentId` + `agentState` field set as `buildEdges` (keep-in-sync, RESEARCH OQ1) and is now EXPORTED for a same-shape test. `graceful()` was split into `degraded()` (walk-FAILURE ⇒ `UNCLASSIFIED` + `degradeReason` + the `classifyVerdict` triple) and `noBlockers()` (the genuinely-empty graph stays `EXTERNAL` — Pitfall 3: a blocker-free issue is not a degrade). A ROOT `relations.get` throw now propagates (mirroring `buildEdges`) so the handler's catch surfaces the honest degrade; inner-node throws are still swallowed so the rest of the graph survives.

## Verification

- `node --test test/worker/situation/agent-liveness.test.mjs` → 8 pass / 0 fail (working/stuck/D-04/D-03-cadence/purity).
- `node --test test/worker/org-blocked-backlog.test.mjs` → 23 pass / 0 fail (incl. agent-owned WORKING/STUCK terminals + a thrown-edge UNCLASSIFIED-row case + verdict-keyed need_you).
- `node --test test/worker/handlers/flatten-blocker-chain-parity.test.mjs` → 4 pass / 0 fail (nodeMeta key-set parity, identical agent-leaf classification across both builders, root-throw ⇒ UNCLASSIFIED, inner-throw survives).
- `node --test test/shared/blocker-chain.test.mjs` → 15 pass / 0 fail (engine determinism + AI-token grep guard stay green — no clock leaked).
- Source assertions: `grep -c assigneeAgentId org-blocked-backlog.ts` = 10 (≥2), `grep -c UNOWNED_SENTINEL org-blocked-backlog.ts` = 0, `grep -c assigneeAgentId flatten-blocker-chain.ts` = 6 (≥2), `grep -c UNCLASSIFIED flatten-blocker-chain.ts` = 7 (≥1). The only `kind: 'EXTERNAL'` synthesis left is the genuine-empty `noBlockers()` path.
- `npx tsc --noEmit`: the three plan files (`agent-liveness.ts`, `org-blocked-backlog.ts`, `flatten-blocker-chain.ts`) compile clean. Remaining errors are the **expected** migration checklist in `build-employees-rollup.ts` (11-03), `humanize-snapshot.ts` + `live-blocker-panel.tsx` (11-04) — by-design, not a failure of this plan (RESEARCH Pitfall 1, inherited from 11-01).
- No `Date.now()`/`new Date()` reaches `src/shared/blocker-chain.ts` (engine clock-free); the worker clock reads (`nowMs = Date.now()` in `buildEdges`/`walkBlockerChain`) are legitimate worker-tier reads injected INTO the pure helper.

## must_haves coverage

- buildEdges captures assigneeAgentId + agentState so an agent leaf classifies AWAITING_AGENT_WORKING/STUCK (SC1/TAX-01/D-01) — **met** (EdgeNodeMeta + resolveAgentState wiring; agent-terminal tests).
- Liveness (working/stuck) computed in the worker, missing⇒stuck, never in the engine (SC4/D-02/03/04) — **met** (agent-liveness.ts pure helper; 8 tests).
- Reader BFS + shared buildEdges produce the identical nodeMeta field set (SC5) — **met** (parity test asserts key-set equality per node).
- graceful() walk failure ⇒ UNCLASSIFIED + degradeReason, not false EXTERNAL (SC3/TAX-03/D-10) — **met** (degraded() + root-throw propagation; root-throw test).
- A blocker issue that throws during edge build surfaces an UNCLASSIFIED row, not a silent drop (SC3/TAX-03) — **met** (unclassifiedChain synth; thrown-edge test).

## Deviations from Plan

**1. [Rule 1 - Bug] `walkBlockerChain` swallowed ROOT relations.get throws, defeating the D-10 degrade.**
- **Found during:** Task 3.
- **Issue:** The pre-existing `walkBlockerChain` inner `try/catch` did `continue` for EVERY thrown `relations.get` — including the root. A root throw therefore produced an empty walk → the `walk.edges.length === 0` "No active blockers" path (now `noBlockers()`/EXTERNAL), so a genuine relations FAILURE could never reach the handler's catch to emit `UNCLASSIFIED`. This silently contradicted the plan's D-10 acceptance criterion ("a thrown relations.get yields UNCLASSIFIED, not EXTERNAL") and broke SC5 (buildEdges propagates root throws; walkBlockerChain did not).
- **Fix:** Added `isRoot` root-throw propagation to `walkBlockerChain` (mirroring `buildEdges`' existing `if (isRoot) throw e` + `finally { isRoot = false }`), so a root failure propagates to the handler's catch → `degraded()` → UNCLASSIFIED, while inner-node throws still `continue` (Pitfall 3 — the rest of the graph survives).
- **Files modified:** `src/worker/handlers/flatten-blocker-chain.ts`.
- **Commit:** `a8a1366`.
- **Tests added:** root-throw ⇒ rejects (handler degrades) + inner-throw ⇒ walk survives, in the parity suite.

**2. [Test alignment] Updated a pre-existing org-blocked-backlog test from "issue skipped" to "UNCLASSIFIED row".**
- **Found during:** Task 2.
- **Issue:** The existing test `…relations.get throws is skipped; the others still produce rows` asserted the OLD silent-drop behavior, which the plan explicitly reverses (TAX-03/D-09).
- **Fix:** Rewrote the test to assert both issues now render and the throwing one is `UNCLASSIFIED` — aligning the test with the plan's honest-degrade contract (not a code deviation; the plan mandated this behavior change).
- **Files modified:** `test/worker/org-blocked-backlog.test.mjs`.
- **Commit:** `10045e1`.

## Threat surface

No new security-relevant surface beyond the plan's threat register. T-11-04 (clock in worker not engine) mitigated: `resolveAgentState` holds all liveness math with `nowMs` injected; the engine branches only on the pre-resolved string (engine determinism + AI-token grep guard stay green). T-11-06 (graceful honesty defect) mitigated: walk failures emit `UNCLASSIFIED` (open affordance, no assign), never a false EXTERNAL chase-action. T-11-07 (loose-cast read) mitigated: every new node-field read keeps `?? null`; a missing `assigneeAgentId`/heartbeat falls through to UNOWNED/SELF_RESOLVING or conservative-stuck, never a crash. T-11-05 (cross-company disclosure) unchanged — all reads stay companyId-scoped. No package installs (T-11-SC accept).

## Notes for Plans 11-03 / 11-04

The remaining `tsc` errors are the next migration steps:
- **`build-employees-rollup.ts` (11-03)** — import `resolveAgentState` (the single liveness source shipped here); re-triage needs-you off `verdict.needsYou`/`tier` (kill the `ownerName === 'Unassigned'` string-match); mirror the `targetAgentUuid`/`targetIssueUuid` split-identity; emit an `UNCLASSIFIED` verdict on chain-build catch instead of `blockerChain = null`. The dead `UNOWNED_SENTINEL` import (L26) must go.
- **`humanize-snapshot.ts` (11-04)** — dead job: add the 4 new kinds to its exhaustive switch, OR confirm zero `register*` wiring (Assumption A3) and DELETE it; remove the `__unowned__` special-case.
- **`live-blocker-panel.tsx` (11-04 UI)** — render the 4 new kinds; gate the action button on `verdict.actionAffordance`, not `terminal.kind === 'HUMAN_ACTION_ON'`.
- **A1 live-drill reminder:** confirm `assigneeAgentId` (and the heartbeat signals) actually ride on a real BEAAA `relations.get` blocker node. A miss is conservative (D-04 ⇒ stuck) but TAX-01 coverage degrades — the plan wired the fields defensively, so a runtime absence does not crash.

## Commits

- `1c348e5` test(11-02): add failing test for resolveAgentState liveness helper (RED)
- `77e76f6` feat(11-02): implement pure resolveAgentState liveness helper (D-02/03/04) (GREEN)
- `10045e1` feat(11-02): capture agent ownership+liveness in buildEdges; UNCLASSIFIED on skip; verdict-keyed need_you
- `a8a1366` feat(11-02): Reader BFS nodeMeta parity + honest UNCLASSIFIED degrade (SC5/D-10)

## Self-Check: PASSED

All 3 created files + the SUMMARY present on disk; all 4 task commits present in git history.
