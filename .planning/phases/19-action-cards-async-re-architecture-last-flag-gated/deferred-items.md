# Phase 19 — Deferred Items (out-of-scope discoveries)

Logged per the executor SCOPE BOUNDARY rule. These are pre-existing failures NOT
caused by the current plan's changes — do NOT fix them inside a Phase-19 plan.

## Plan 19-04 (2026-06-15) — pre-existing test failures in the full `node --test` sweep

The full sweep shows 18 failing subtests; ALL are pre-existing and unrelated to
the six files Plan 19-04 touched (set-action-cards-flag.ts, worker.ts,
manifest.ts, action-cards-flag-gate.test.mjs, storm-safety.test.mjs,
set-action-cards-flag.test.mjs). Verified by running the same failing tests at the
parent commit (eb257c2^ = 082cf31) where they ALSO fail.

Failing files (out of scope for Phase 19):
- `scripts/safety/test/gate.test.mjs`
- `scripts/safety/test/restore.test.mjs`
- `scripts/safety/test/restore-tar-cve.test.mjs`
- `scripts/safety/test/snapshot.test.mjs`
- `scripts/safety/test/snapshot-pglite.test.mjs`
- `scripts/safety/test/snapshot-postgres-mock.test.mjs`
- `scripts/safety/test/verify.test.mjs`
- `test/worker/situation/snapshot-prefetch.test.mjs` — the single subtest
  "prefetch — issues exactly TWO db.query calls (one public.issues, one
  public.agents)" expects 2 prefetch SELECTs but the current builder issues 3
  (last touched by Phase 17 commit 0e055c7, not Plan 19-04).

These are the snapshot/restore/verify safety-CLI harness tests (env-dependent —
pglite/postgres mock harnesses) plus one Phase-17 prefetch count drift. They do
NOT gate Plan 19-04: the plan's own test set (set-action-cards-flag, the CARD-03
gate test, and the storm-safety burst incl. the folded CARD-03 ceiling/bounded-warm
assertions) is fully green, and `tsc --noEmit` is clean.
