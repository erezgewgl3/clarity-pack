# Phase 18 — Deferred / Out-of-Scope Items

## Discovered during Plan 18-02 execution (2026-06-14)

### Pre-existing test-env dependency gaps (NOT caused by 18-02)

Running the full suite (`node --test "test/**/*.test.mjs"`) reports 58 failing
files, ALL of which fail at module-load with `ERR_MODULE_NOT_FOUND`:

- `date-fns-tz` (declared in package.json deps as `3.2.0`, but absent from
  `node_modules`) — 40 files
- `react` — 5 files (UI hook tests)
- `playwright` — 2 files (visual regression)
- `xlsx` — 1 file (deliverable-preview)

Root cause: the local `node_modules` is incomplete (a full `pnpm install` has
not materialized these declared deps). NONE of these failures are assertion
failures and NONE are in files touched by Plan 18-02. All 18-02 test files and
every targeted surface suite pass (scrub, rescrub-persisted, chat-chip,
the three *-no-uuid-leak guards, reader-view, employee-row reply-in-place).

Action: run `pnpm install` to restore the declared deps before the next full-suite
gate. Out of scope for 18-02 (no code change — environment only).
