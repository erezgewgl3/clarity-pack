---
phase: 17-structured-human-wait-truthful-verdicts-centerpiece
plan: 02
subsystem: structured-human-wait
tags: [wait-02, wait-03, wait-04, sc5, parity, blocker-chain, situation-room, reader, anti-divergence, beaaa-972]
requires:
  - "17-01 contracts: listClarityHumanWaitsForCompany + ClarityHumanWaitRow (clarity-human-wait-repo.ts)"
  - "17-01 engine: nodeMeta.structuredWaitOwnerUserId + structuredWaitOneLiner + priority-0 AWAITING_HUMAN leaf branch (blocker-chain.ts)"
  - "16-02 prefetch threading (situation-room.ts buildSnapshotPrefetch -> sharedPrefetch -> both builders' ctx)"
provides:
  - "applyStructuredWait(nodeMeta, startId, waitMap) — the single SC5 anti-divergence merge primitive (apply-structured-wait.ts)"
  - "per-company waitMap prefetch on SnapshotPrefetchBundle, threaded into BOTH SR builders"
  - "Reader path waitMap (built per-request from ctx.db) threaded into walkBlockerChain"
  - "structured wait merged into nodeMeta[rootId] at ALL THREE root-meta write sites via the one shared helper"
  - "EdgeNodeMeta + WalkOutput.nodeMeta extended in lockstep (parity test pins them equal)"
affects:
  - src/worker/situation/apply-structured-wait.ts (NEW — the merge helper)
  - src/worker/handlers/situation-room.ts (waitMap prefetch + threading)
  - src/worker/handlers/org-blocked-backlog.ts (EdgeNodeMeta + SR-backlog root merge)
  - src/worker/handlers/flatten-blocker-chain.ts (WalkOutput.nodeMeta + Reader root merge + per-request waitMap)
  - src/worker/situation/build-employees-rollup.ts (SR-rollup root merge)
  - "downstream 17-03 (Editor-Agent populator writes the rows these sites now consume), 17-05 (full cross-surface matrix pins all four surfaces to one verdict)"
tech-stack:
  added: []
  patterns:
    - "single shared merge helper called IDENTICALLY at N write sites (SC5 anti-divergence) — no site inline-duplicates the merge logic"
    - "one per-company prefetch Map threaded into both builders' ctx (mirrors 16-02 nameByUuid/edgeGraph)"
    - "enhancement-vs-prerequisite degrade split: a thrown wait SELECT defaults to an EMPTY waitMap and continues (vs the issues/agents SELECT failure which returns a null bundle / RPC fallback)"
    - "clone-before-mutate on the SHARED edge-graph memo (org-blocked-backlog mergeRootWait) — never mutate a memo other consumers read"
key-files:
  created:
    - src/worker/situation/apply-structured-wait.ts
  modified:
    - src/worker/handlers/situation-room.ts
    - src/worker/handlers/org-blocked-backlog.ts
    - src/worker/handlers/flatten-blocker-chain.ts
    - src/worker/situation/build-employees-rollup.ts
    - test/worker/handlers/flatten-blocker-chain-parity.test.mjs
    - test/worker/situation/snapshot-prefetch.test.mjs
decisions:
  - "Reader path builds its OWN waitMap (it does NOT route through the situation-room prefetch); the merge is still the SAME shared helper, so SC5 holds across the two independent prefetch sources"
  - "buildEdges (SR backlog) writes NO root-meta entry, so the wait is merged in buildOrgBlockedBacklog via a clone-safe local mergeRootWait that ENSURES a root entry then calls the shared helper — never mutating the shared edgeGraph memo"
  - "Wait SELECT is an ENHANCEMENT not a prerequisite: its failure defaults to an empty waitMap (conservative floor), distinct from the public.* prefetch SELECTs whose failure returns a null bundle"
metrics:
  duration: ~40m
  tasks_completed: 3
  files_created: 1
  files_modified: 6
  tests_passing: 1300
  completed: 2026-06-11
---

# Phase 17 Plan 02: Structured-wait SC5 merge (three-site parity) Summary

Built the SC5 anti-divergence primitive — one `applyStructuredWait` helper fed by one per-company `waitMap` — and called it IDENTICALLY at all three root-meta write sites (Reader, SR rollup, SR backlog), so the persisted structured human-wait row from 17-01 now reaches `nodeMeta[rootId]` on every consuming surface. This is the #1 landmine of the phase: it kills the BEAAA-972 cross-surface bug by construction (the same blocked issue can no longer read AWAITING_HUMAN in the Situation Room and AWAITING_AGENT_STUCK in the Reader).

## What Was Built

### Task 1 — applyStructuredWait helper + waitMap prefetch (commit c750e0f)
- `src/worker/situation/apply-structured-wait.ts` (NEW): `applyStructuredWait(nodeMeta, startId, waitMap)` — pure, no I/O, deterministic. Reads `waitMap.get(startId)`; on a hit sets `structuredWaitOwnerUserId` + `structuredWaitOneLiner` on `nodeMeta[startId]`; no-op otherwise (and a defensive no-op when the root entry is absent). This is the SINGLE place the merge logic lives — every call site delegates to it.
- `src/worker/handlers/situation-room.ts` `buildSnapshotPrefetch`: ONE company-scoped `listClarityHumanWaitsForCompany(ctx, companyId)` SELECT → `waitMap` (`Map<issue_id, ClarityHumanWaitRow>`). DEGRADE-SAFE and distinct from the issues/agents SELECTs: those are prerequisites (throw → null bundle → RPC fallback), but a thrown wait SELECT defaults to an EMPTY waitMap and CONTINUES (the wait is an enhancement). `waitMap` added to `SnapshotPrefetchBundle` and threaded into BOTH builders' ctx via the existing `sharedPrefetch` spread (alongside `nameByUuid`/`edgeGraph`).
- `src/worker/handlers/org-blocked-backlog.ts`: added optional `waitMap?` to the `SnapshotPrefetch` type so the threaded ctx field type-checks in both builders (`EmployeesRollupCtx extends OrgBlockedBacklogCtx extends SnapshotPrefetch`).

### Task 2 — Merge at all three root-meta write sites (commit 0e055c7)
- Extended BOTH nodeMeta shapes in lockstep: `WalkOutput.nodeMeta` (flatten-blocker-chain.ts) and `EdgeNodeMeta` (org-blocked-backlog.ts) gained `structuredWaitOwnerUserId: string | null` + `structuredWaitOneLiner: string | null`. Every existing nodeMeta literal in both files (root + blocker-target) now initializes the two fields to null.
- **Reader (flatten-blocker-chain.ts):** `walkBlockerChain` gained an optional `waitMap` param. The handler builds it per-request from `listClarityHumanWaitsForCompany` (the Reader does NOT route through the SR prefetch) — degrade-safe (thrown SELECT / absent db → empty map → conservative floor, never a 502) — and threads it in. The root-meta literal inits the two fields null, then `applyStructuredWait(nodeMeta, startId, waitMap)` runs inside the best-effort try block.
- **SR rollup (build-employees-rollup.ts):** the focus root-meta inject literal inits the two fields null; `applyStructuredWait(nodeMeta, focusIssue.id, ctx.waitMap)` runs whether or not the inject fired (the root entry can pre-exist from a deeper graph). `nodeMeta` is the local `{ ...memo.nodeMeta }` clone, so the shared memo is never mutated.
- **SR backlog (org-blocked-backlog.ts):** `buildEdges` writes NO root-meta entry (only blocker targets) and an empty-edges blocked root is exactly the BEAAA-972 divergence point — so the merge happens in `buildOrgBlockedBacklog` via a clone-safe local `mergeRootWait(nodeMeta, rootId)` that shallow-clones the map, ENSURES a root entry (init null fields), then calls the shared helper. Applied in BOTH the memo and the non-memo branches. Cloning keeps the shared `edgeGraph` memo pristine for the next consumer.
- All three sites call the single helper exactly ONCE; `grep` confirms no site inline-duplicates the `waitMap.get`/field-set logic (only apply-structured-wait.ts does).

### Task 3 — Parity test widened (commit 045c647)
- `test/worker/handlers/flatten-blocker-chain-parity.test.mjs`: the same-shape assertion now also asserts `structuredWaitOwnerUserId` + `structuredWaitOneLiner` are present in BOTH builders' nodeMeta, so `EdgeNodeMeta ≡ WalkOutput.nodeMeta` stays pinned after both gained the two fields. Structure unchanged — only the expected field set widened.

## Verification Results
- `tsc --noEmit` clean across the whole project after every task (the plan's `node --check src/...ts` is not valid on Node 24, which does not type-strip under `--check`; `tsc --noEmit` is the correct, stronger equivalent and is the project's `typecheck` script).
- `node --test test/worker/handlers/flatten-blocker-chain-parity.test.mjs` → 4/4 pass (the widened same-shape assertion green).
- `grep -c "applyStructuredWait("` → 1 in each of the three write-site files (helper called everywhere, never inlined).
- Both nodeMeta field sets declare the two fields (`grep structuredWaitOwnerUserId` → flatten-blocker-chain.ts + org-blocked-backlog.ts).
- Full worker + shared suite: 1300/1300 pass (includes the 17-01 engine verdict test + the 100-run blocker-chain determinism guard + the AI-token purity grep guard — blocker-chain.ts untouched here, all green).
- Company-scope (T-17-04): the wait SELECT is `WHERE company_id = $1`; the waitMap is built per-company and threaded only into that company's snapshot — pinned by the new assertion in snapshot-prefetch.test.mjs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] snapshot-prefetch round-trip-count test broke on the new wait SELECT**
- **Found during:** Task 2 full-suite verification (the failure traces to the Task 1 prefetch SELECT).
- **Issue:** `test/worker/situation/snapshot-prefetch.test.mjs` Test 1 asserts "exactly TWO db.query prefetch SELECTs". The new `clarity_human_waits` SELECT made it three, failing the assertion.
- **Fix:** Mirrored the existing `situation_snapshots` exclusion precedent — the `clarity_human_waits` read is a plugin-NAMESPACE read, conceptually distinct from the public.* N+1-collapse round-trip contract the suite measures. Tracked it on its own `waitSelectSql` spy, excluded it from `dbQuerySql`, and ADDED an explicit assertion that exactly ONE company-scoped wait SELECT fires per snapshot. The "exactly TWO public.* prefetch SELECTs" contract stays honest and the new wait query is now pinned.
- **Files modified:** test/worker/situation/snapshot-prefetch.test.mjs
- **Commit:** 0e055c7

**2. [Rule 3 — Blocking] Plan verify command `node --check <ts>` is unusable on Node 24**
- **Found during:** Task 1 verification.
- **Issue:** The plan's `<automated>` verify uses `node --check src/...ts`, but Node 24 (this env) does not strip TypeScript types under `--check`, so it throws a `SyntaxError` on every `.ts` file regardless of correctness.
- **Fix:** Used the project's real type-check (`npx tsc --noEmit`, the `typecheck` script) as the equivalent-and-stronger check, plus `node --test` for the test files (which DO import `.ts` via the project loader). All acceptance grep checks were run verbatim. No code-path change.
- **Files modified:** none (verification-method substitution only).

Otherwise: plan executed as written. No architectural changes, no auth gates, no checkpoints (fully autonomous plan).

## Threat Model Compliance
- T-17-04 (info disclosure, waitMap prefetch): mitigated — `listClarityHumanWaitsForCompany` is `WHERE company_id = $1`; the waitMap is built per-company and threaded only into that company's snapshot. The Reader path likewise builds a per-`companyId` map. The new snapshot-prefetch assertion pins the company-scope.
- T-17-05 (tampering, SC5 divergence / BEAAA-972 class): mitigated — single shared `applyStructuredWait` + single waitMap per surface; the widened parity test (Task 3) pins the two nodeMeta shapes equal; the full cross-surface matrix in 17-05 will pin all four surfaces to one verdict.
- T-17-06 (DoS, wait SELECT in the hot prefetch path): mitigated — one additional bounded `WHERE company_id = $1` SELECT per snapshot; a thrown SELECT defaults to an empty waitMap and continues (degrade-safe), inheriting the Phase-16 prefetch degrade discipline.
- T-17-SC (installs): N/A — zero packages installed this plan.

## Known Stubs
None. The merge helper and threading are fully wired and exercised by the existing suite. The wait ROWS themselves are written by the 17-03 Editor-Agent populator (downstream); until then the waitMap is legitimately empty and every site degrades to the conservative engine floor by design (not a stub — the producer/consumer split is intentional, mirroring 17-01's note).

## Notes for Downstream Plans
- **17-03 (Editor-Agent populator):** writes the `clarity_human_waits` rows that these three sites now consume. Once a row exists for a blocked issue, every surface reads AWAITING_HUMAN for it (the 17-01 priority-0 engine branch + this plan's three-site merge). The populator's `deleteClarityHumanWait` self-clear (D-04) removes the row → the next snapshot's waitMap omits it → the verdict reverts to the node's own state, on every surface in lockstep.
- **17-05 (full cross-surface matrix):** add the `structured-human-wait → AWAITING_HUMAN` row and widen the matrix from 2 surfaces to 4 (Reader + SR + Bulletin + Chat). The helper + waitMap shape this plan ships is what makes "one verdict everywhere" assertable at the producer boundary.
- The SR backlog merge intentionally lives in `buildOrgBlockedBacklog` (not `buildEdges`) because `buildEdges` has no root-issue facts (it only does `relations.get`). Any future move of the root-meta inject into `buildEdges` must carry the wait merge with it to preserve SC5.

## Self-Check: PASSED
- src/worker/situation/apply-structured-wait.ts — FOUND
- src/worker/handlers/situation-room.ts (modified) — FOUND
- src/worker/handlers/org-blocked-backlog.ts (modified) — FOUND
- src/worker/handlers/flatten-blocker-chain.ts (modified) — FOUND
- src/worker/situation/build-employees-rollup.ts (modified) — FOUND
- test/worker/handlers/flatten-blocker-chain-parity.test.mjs (modified) — FOUND
- test/worker/situation/snapshot-prefetch.test.mjs (modified) — FOUND
- Commit c750e0f — FOUND
- Commit 0e055c7 — FOUND
- Commit 045c647 — FOUND
