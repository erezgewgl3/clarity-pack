# Phase 20 — Deferred Items / cross-plan findings

## From Plan 20-01 (2026-06-15) — safety-CLI suite needs serial execution in CI

The 7 safety-CLI tests (gate / restore / restore-tar-cve / snapshot /
snapshot-pglite / snapshot-postgres-mock / verify) are honestly green
**per-file** and **deterministically green with `--test-concurrency=1`**, but a
single parallel `node --test` invocation of all 7 produces a FLAKY `fail 1`
(observed on `verify.test.mjs` V3). Root cause: the PGlite/WASM-backed
snapshot/restore/snapshot-pglite files contend for shared temp + WASM resources
when node --test runs files concurrently, starving the stub-HTTP-server verify
test.

This is NOT a 20-01 blocker: the current default `test` script glob
(`test/**/*.test.mjs`) does not even match `scripts/safety/test/*`, so the suite
is presently excluded from the default sweep. Plan 20-02 ("widen the CI test glob
to recurse so the safety-CLI suite actually runs") is where this surfaces.

**Action for 20-02:** run the safety-CLI suite with `--test-concurrency=1` (or as
its own dedicated serial CI step) so the WASM contention cannot produce a flaky
red. Do NOT rely on a single parallel invocation across all 7. (Fixing this is a
CI-runner concern, not a test-file change — D-07 forbids lib/behavior changes.)
