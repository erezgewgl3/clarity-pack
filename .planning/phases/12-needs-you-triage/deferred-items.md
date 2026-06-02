# Phase 12 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed (SCOPE BOUNDARY rule).

## From Plan 12-01 (2026-06-02)

### Pre-existing REQUIREMENTS.md traceability failures (7 tests)
- **Files:** `test/phases/04-traceability.test.mjs`, `test/phases/04.1-traceability.test.mjs`
- **Failures:**
  - `REQUIREMENTS.md has a traceability row for every CHAT-01..CHAT-11`
  - `every CHAT-01..CHAT-11 row is marked Implemented`
  - `every CHAT-01..CHAT-11 row carries a Phase 4 plan reference`
  - `REQUIREMENTS.md has a traceability row for every CTT-01..CTT-08`
  - `every CTT-01..CTT-08 row is marked Implemented`
  - `every CTT-01..CTT-08 row carries a Phase 4.1 plan reference`
  - `every CTT-01..CTT-08 row is on Phase 4.1`
- **Why deferred:** These assert content of `.planning/REQUIREMENTS.md` (Phase 4 chat + Phase 4.1 CTT requirement rows). Unrelated to the Phase 12 / D-05 engine edit; REQUIREMENTS.md was not modified by Plan 12-01 (last touched in Phase 11). Pre-existing — out of scope per the SCOPE BOUNDARY rule. The plan's own verification target (`test/shared/blocker-chain.test.mjs`) is fully green (21/21).
- **Suggested owner:** a REQUIREMENTS.md traceability backfill task (not a code change).

## From Plan 12-03 (2026-06-02)

### Plan 12-02's leverage-sort test fails against not-yet-landed 12-02 source (1 test)
- **File:** `test/worker/situation/build-employees-rollup.test.mjs`
- **Failure:** `rollup — needs_you band ordered by leverage then stable leaf id (time-free, D-02), not by activity age` (Test 10 — got `ag-new` !== expected order against the parallel agent's in-progress source).
- **Why deferred:** This test (+ `build-employees-rollup.ts`) is OWNED by Plan 12-02 (NY-02 leverage ordering), which is running in parallel and has un-committed working-tree changes mid-flight. Plan 12-03 is explicitly forbidden from touching `leverage.ts` / `build-employees-rollup.ts`. The test was updated ahead of its implementation; it goes green when 12-02 lands. Out of scope per the SCOPE BOUNDARY rule.
- **Suggested owner:** Plan 12-02 (closes when its leverage sort lands).
- **Note:** Plan 12-03's own scope is fully green — `test/worker/org-blocked-backlog.test.mjs` 27/27, `npm run build`, and `tsc --noEmit` all pass.
- **RESOLVED (2026-06-02, Plan 12-02):** The leverage sort landed (commit `e741f68`). Test 10 was rewritten to assert the NY-02 contract (needs_you band = leverage-DESC, stable-leaf-id-ASC, time-free) and is GREEN. The three rollup files + `leverage.test.mjs` pass 47/47.

## From Plan 12-02 (2026-06-02)

### Pre-existing REQUIREMENTS.md traceability failures (7 tests) — STILL out of scope
- Same 7 CHAT-01..CHAT-11 / CTT-01..CTT-08 traceability failures logged from Plan 12-01 above. Re-confirmed pre-existing during 12-02 execution: running `test/phases/04-traceability.test.mjs` with the 12-02 source code *stashed* (baseline `b67d291`) reproduces the same failures, proving they are not caused by the leverage work. REQUIREMENTS.md was not touched by Plan 12-02. Out of scope per the SCOPE BOUNDARY rule.
- **Suggested owner:** a REQUIREMENTS.md traceability backfill task (not a code change).
