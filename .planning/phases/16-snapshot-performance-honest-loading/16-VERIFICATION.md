---
phase: 16-snapshot-performance-honest-loading
verified: 2026-06-04T00:00:00Z
status: human_needed
score: 3/4 must-haves verified (all code-verifiable truths VERIFIED; live timing truth verified by recorded drill evidence)
overrides_applied: 0
human_verification:
  - test: "Live cold/warm timing confirmation"
    expected: "Cold /BEAAA/situation-room returns ~2s client / ~1.6s worker (< 5s p95 target); warm serves ~492ms serve-last-good; no 502."
    why_human: "The 16-04-SUMMARY.md records these numbers from a live BEAAA drill on 2026-06-03. The verifier cannot re-run the live drill programmatically. The drill is the gate evidence; a human must confirm the record is authoritative and the box is not regressed."
---

# Phase 16: Snapshot Performance & Honest Loading — Verification Report

**Phase Goal:** The Situation Room cockpit loads fast and honestly — the snapshot returns well under the 30s host timeout even on a cold cache, never 502s, and a slow or failed sub-read floors to the deterministic line rather than blocking the whole view.
**Verified:** 2026-06-04
**Status:** human_needed — all code-verifiable truths VERIFIED; the live timing truth (SC1/SNAP-01) is backed by a recorded drill and can only be re-confirmed by a human.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth (from ROADMAP SC) | Status | Evidence |
|---|------------------------|--------|----------|
| 1 | Cold-cache Situation Room returns well under the 30s timeout (target p95 < ~5s) and never 502s; the 25.7s cold near-cliff is eliminated. | ? UNCERTAIN (human-confirmable) | 16-04-SUMMARY.md records live drill on 2026-06-03: cold 2.0s client / 1.6s worker (12.8x faster than 25.7s baseline), HTTP 200. Code structure (SWR serve-last-good + bounded BFS) makes this structurally durable. Cannot re-run live drill programmatically. |
| 2 | The employees rollup is degrade-safe per row: a slow or failed sub-read floors to the deterministic UNCLASSIFIED line and never blocks or blanks the view. | ✓ VERIFIED | `snapshot-degrade.test.mjs` 6/6 PASS: hung/thrown/slow relations.get all yield UNCLASSIFIED floor rows; snapshot returns 200-shaped payload with every other row intact; concurrency ceiling (≤5 in flight) holds; budget-exhaustion path floors leftover startIds. `withDeadline` + `mapBounded` wired in `situation-room.ts` at lines 395-429 and `build-employees-rollup.ts` line 720. |
| 3 | The confirm-first baseline is recorded (done 2026-06-03: no 502, 6/6 snapshot calls 200, cold 25.7s) and drives the SNAP-01/02 targets. | ✓ VERIFIED | REQUIREMENTS.md SNAP-03 text reads "(Done 2026-06-03: no 502, 6/6 snapshot calls 200, cold 25.7s — drives SNAP-01/02.)". 16-04-SUMMARY.md "Timings vs the recorded SNAP-03 baseline" table present. Checkbox in REQUIREMENTS.md is `[ ]` and traceability row says "Pending" — a documentation inconsistency (the description text confirms it is done). Not a code gap. |
| 4 | The fix is instance-agnostic (no company-prefix literals) and additive-only (plugin-namespace schema; disable/uninstall preserves data). | ✓ VERIFIED | `grep -Ec "'BEAAA-|'COU-|\$\{"` on `situation-room.ts` → 0. SQL strings are static module constants; sole bound param is `$1` (companyId). 16-04 correctly created NO migration (SWR reuses existing `situation_snapshots` table; `ls migrations/` confirms 0016 is the latest — no 0017). No DDL, no public.* mutations. Migration validator `no-procedural-blocks.test.mjs` 15/15 PASS. |

**Score:** 3/4 truths code-verified; SC1 (live timing) is recorded-drill evidence requiring human confirmation.

### Deferred Items

None identified.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/worker/util/map-bounded.ts` | mapBounded + withDeadline exports; no p-limit dep | ✓ VERIFIED | File exists, 80 lines. Exports exactly `mapBounded` and `withDeadline` (grep confirms 2 `export` statements). `grep -c "p-limit"` → 0. Canonical RESEARCH shapes verbatim. |
| `test/worker/util/map-bounded.test.mjs` | 8 tests covering concurrency ceiling + deadline floor | ✓ VERIFIED | node --test: **8/8 PASS**. Concurrency-ceiling asserts max-in-flight === limit; reject-floor asserts onTimeout() not a throw; timer-cleared asserts no late fire. |
| `src/worker/situation/snapshot-cache.ts` | SWR read (ORDER BY taken_at DESC LIMIT 1) + write (ON CONFLICT computed_for_company_id, content_hash DO NOTHING) | ✓ VERIFIED | File exists, 141 lines. Read SQL: `WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1`. Write SQL: ON CONFLICT target matches migrations/0003 line 43 exactly (`computed_for_company_id, content_hash`). No `viewer_user_id` column. WARNING 5 confirmation present in comments. |
| `src/worker/situation/build-employees-rollup.ts` (buildNeedsYou export) | Exported pure buildNeedsYou(rows, viewerUserId): NeedsYou; NO fetch | ✓ VERIFIED | `export function buildNeedsYou` at line 877. Pure: no ctx/fetch access. buildEmployeesRollup calls it (no inlined duplicate). mapBounded import at line 55, wired at line 720. |
| `src/worker/handlers/situation-room.ts` | SWR serve-last-good + per-call buildNeedsYou + no setInterval/jobs.schedule | ✓ VERIFIED | `readLatestSnapshot` / `writeSnapshot` / `buildNeedsYou` imports present. FRESHNESS_MS=60000. Fire-and-forget via `void (async () => {…})()` at line 652. `grep -n "setInterval("` → 0 results; `grep -n "jobs\.schedule"` → 0 results. |
| `test/worker/situation/snapshot-cache.test.mjs` | 11 tests; T-16-03 no cross-viewer leak asserted | ✓ VERIFIED | node --test: **11/11 PASS**. Dedicated test "two DIFFERENT viewerUserIds over the SAME rows yield DIFFERENT counts". "cached payload is the VIEWER-INVARIANT slice ONLY (no needsYou key)" asserts `written.needsYou === undefined`. |
| `test/worker/situation/snapshot-prefetch.test.mjs` | 8 tests; round-trip-count + memoized BFS + viewer-scope | ✓ VERIFIED | node --test: **8/8 PASS**. Asserts exactly 2 db.query calls; agents.get not called; relations.get walks exactly once per distinct startId. |
| `test/worker/situation/snapshot-degrade.test.mjs` | 6 tests; hung/thrown/slow floors to UNCLASSIFIED; 200 preserved; ceiling holds | ✓ VERIFIED | node --test: **6/6 PASS**. Budget-exhaustion override (~200ms) runs sub-second. |
| `migrations/0017_*` (OPTIONAL) | Either absent (with documented reason) or a single additive CREATE INDEX | ✓ VERIFIED | File is absent. `16-04-TASK2-DECISION.md` records "SKIP — SWR read is sub-ms on a small table." No DDL emitted, additive-only preserved. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `situation-room.ts` | `src/worker/util/map-bounded.ts` | `import { mapBounded, withDeadline }` | ✓ WIRED | Import at line 39; mapBounded called at line 395 (edge-graph build); withDeadline called at line 420. |
| `build-employees-rollup.ts` | `src/worker/util/map-bounded.ts` | `import { mapBounded }` | ✓ WIRED | Import at line 55; called at line 720 replacing Promise.all fan-out. |
| `situation-room.ts` | `plugin_clarity_pack_cdd6bda4bd.situation_snapshots` | `readLatestSnapshot / writeSnapshot (ctx.db)` | ✓ WIRED | Both imports present; read called at line 628; write-back called at lines 660 and 692. |
| `situation-room.ts` | `build-employees-rollup.ts (buildNeedsYou)` | per-call needsYou recompute | ✓ WIRED | Import at line 52; called at lines 646 (serve-last-good path) and 685 (cache miss path). |
| `buildEdges` walk → `unclassifiedChain('relations-walk-timeout')` | TIMEOUT_SENTINEL in edgeGraph | withDeadline deadline floor | ✓ WIRED | TIMEOUT_SENTINEL defined at line 207; stored at line 422-426; org-blocked-backlog floors via the existing unclassifiedChain shape. |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `snapshot-cache.ts` readLatestSnapshot | `rows[0].payload` | `SELECT payload, taken_at FROM plugin_clarity_pack_cdd6bda4bd.situation_snapshots WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1` | Yes — real namespace DB query, returns previously-written viewer-invariant slice | ✓ FLOWING |
| `snapshot-cache.ts` writeSnapshot | payload written | INSERT via `ctx.db.execute` into namespace table | Yes — real write to plugin namespace | ✓ FLOWING |
| `situation-room.ts` (serve-last-good path) | `slice.situation_employees` | Cached `ViewerInvariantSlice` from DB | Yes — rows were computed by a previous synchronous recompute and written; served immediately on cache hit | ✓ FLOWING |
| `situation-room.ts` (cache miss path) | `employees` | `computeViewerInvariantSlice` → SQL prefetch (2 SELECTs) + shared BFS | Yes — real `ctx.db.query` on public.issues/public.agents; real `buildEdges` RPC calls bounded by mapBounded/withDeadline | ✓ FLOWING |
| `buildNeedsYou` | `needsYou.count` | Pure filter over `rows[].blockerChain.terminal` (in-memory, no fetch) | Yes — viewer-scoped partition of already-built rows; pure function | ✓ FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| mapBounded concurrency ceiling | `node --test test/worker/util/map-bounded.test.mjs` | 8/8 pass | ✓ PASS |
| withDeadline floors hung + rejected | (same suite) | 8/8 pass | ✓ PASS |
| snapshot-cache SWR read/write + T-16-03 no cross-viewer leak | `node --test test/worker/situation/snapshot-cache.test.mjs` | 11/11 pass | ✓ PASS |
| SQL prefetch N+1 collapse + viewer-scope | `node --test test/worker/situation/snapshot-prefetch.test.mjs` | 8/8 pass | ✓ PASS |
| Degrade-safe hung/thrown/slow + budget exhaustion | `node --test test/worker/situation/snapshot-degrade.test.mjs` | 6/6 pass | ✓ PASS |
| buildEmployeesRollup with bounded fan-out | `node --test test/worker/situation/build-employees-rollup.test.mjs` | 28/28 pass | ✓ PASS |
| Situation room handler SWR wiring | `node --test test/worker/situation-room-handler.test.mjs` | 10/10 pass | ✓ PASS |
| Migration validator (no procedural blocks) | `node --test test/migrations/no-procedural-blocks.test.mjs` | 15/15 pass | ✓ PASS |

**Combined Phase 16 situation/snapshot suites: 53/53 PASS.**

---

## Probe Execution

Step 7c: SKIPPED — no phase-declared probe scripts; Phase 16 is a worker-path code change, not a migration/tooling phase with conventional probe harnesses.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SNAP-01 | 16-02, 16-03, 16-04 | Fast cold load; no 502; 25.7s cliff eliminated | ✓ SATISFIED | Live drill (2026-06-03): cold 2.0s client/1.6s worker, HTTP 200 (recorded in 16-04-SUMMARY.md). Code structure: SWR serve-last-good decouples serve from recompute; bounded BFS + deadline floor eliminate 30s hang risk. |
| SNAP-02 | 16-01, 16-02, 16-03 | Degrade-safe rollup; bounded pool + deadline floor; honest render | ✓ SATISFIED | snapshot-degrade 6/6 PASS; mapBounded wired in situation-room.ts + build-employees-rollup.ts; withDeadline floors hung/thrown walks; UNCLASSIFIED sentinel stored in shared edgeGraph; live drill: room rendered fully with 0/1/18+51 tiers, zero blanks. |
| SNAP-03 | 16-04 Task 3 | Confirm-first baseline recorded (cold 25.7s, 6/6 200, no 502) | ✓ SATISFIED | REQUIREMENTS.md text says "(Done 2026-06-03: no 502, 6/6 snapshot calls 200, cold 25.7s — drives SNAP-01/02.)". Checkbox/traceability row not updated (documentation inconsistency, not a code gap). 16-04-SUMMARY.md "Timings vs SNAP-03 baseline" table present. |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/worker/handlers/situation-room.ts` | 533, 562 | `setInterval` appears in comments | ℹ Info | Comments say "NO cron, NO setInterval" — they are negative-instruction reminders. `grep -n "setInterval("` → 0 actual calls. Not a stub or debt marker. |

No TBD, FIXME, or XXX markers found in any Phase 16 modified file.

---

## SWR + No-Cross-Viewer-Leak + No-Background-Loop + Additive-Only Code-vs-Claim Check

### SWR Path Exists and Caches Only Viewer-Invariant Slice

VERIFIED. The cached type `ViewerInvariantSlice` (snapshot-cache.ts:47-51) contains `org_blocked_backlog`, `situation_employees`, and `pulse` — NOT `needsYou`. The test at `snapshot-cache.test.mjs:360-374` asserts `written.needsYou === undefined`. The handler builds `needsYou = buildNeedsYou(slice.situation_employees, viewerUserId)` on every call, post-serve, in both the fresh-serve and miss paths.

### buildNeedsYou Is a Pure Per-Call Recompute (T-16-03 — No Cross-Viewer Leak)

VERIFIED. `buildNeedsYou(rows, viewerUserId)` at `build-employees-rollup.ts:877` takes no `ctx` argument, makes no DB or RPC calls, and re-runs the `partitionNeedsYouRows` + `rankNeedsYouRows` pipeline over the already-built rows. The two-viewerUserId test (snapshot-cache.test.mjs:218-236) asserts distinct counts. Wired in both serve paths in `situation-room.ts` (lines 646, 685).

### No Background Loop Added

VERIFIED. `grep -n "setInterval("` on situation-room.ts → 0 results. `grep -n "jobs\.schedule"` → 0 results. The fire-and-forget revalidation is `void (async () => {…})()` at line 652, invoked inside the valid data-handler scope, not via cron or setInterval.

### Additive-Only Schema

VERIFIED. No migration 0017 was created (`ls migrations/` confirms 0016 is the latest). The SWR write reuses the existing `situation_snapshots` table (migration 0003) with no DDL change. ON CONFLICT target matches migration 0003 line 43 exactly. All SQL is namespace-qualified (`plugin_clarity_pack_cdd6bda4bd.situation_snapshots`). No public.* mutations.

### Instance-Agnostic (No Company-Prefix Literals)

VERIFIED. `grep -Ec "'BEAAA-|'COU-|\$\{"` on situation-room.ts → 0. SQL strings are static module constants; sole bound param is `$1` (companyId).

---

## Human Verification Required

### 1. Live Cold/Warm Timing Confirmation

**Test:** Open `/BEAAA/situation-room` cold (after a worker restart or cache flush); reload warm within the 60s freshness window.
**Expected:** Cold returns well under the 30s timeout (target ~2s, as recorded); warm serves near-instant (sub-second); a new `situation_snapshots` row appears after the warm serve (background revalidate). HTTP 200 in both cases, no 502.
**Why human:** The 16-04-SUMMARY.md records these timings from a live drill on 2026-06-03 (cold 2.0s client / 1.6s worker; warm 492ms). The verifier cannot re-run the live BEAAA drill programmatically. The code structure (SWR + bounded BFS + deadline floor) makes the result structurally durable, but only a human can confirm the BEAAA box has not regressed since the drill.

---

## Gaps Summary

No code gaps. The sole human-verification item is the live timing confirmation — the recorded drill on 2026-06-03 is strong evidence (cold 2.0s vs 25.7s baseline, 12.8x speedup, no 502), and the code structure (SWR serve-last-good, bounded concurrency, deadline floor) makes the result durable. The status is `human_needed` per the verification decision tree because a human item exists, not because a code truth failed.

One minor documentation inconsistency: REQUIREMENTS.md SNAP-03 checkbox is `[ ]` (unchecked) and its traceability row says "Pending", while the requirement text itself says "(Done 2026-06-03...)". This is a clerical tracking gap, not a code gap. The 16-04-SUMMARY.md confirms the baseline measurement was recorded and is the driving input to SNAP-01/02.

---

_Verified: 2026-06-04_
_Verifier: Claude (gsd-verifier)_
