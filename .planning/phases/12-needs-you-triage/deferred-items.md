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
