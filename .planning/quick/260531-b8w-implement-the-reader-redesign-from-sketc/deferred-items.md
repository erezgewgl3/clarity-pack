# Deferred items — quick 260531-b8w

## Out-of-scope pre-existing test failure (NOT fixed here)

**Test:** `test/worker/handlers/situation-artifacts.test.mjs:352` —
"situation.artifacts: per-agent arrays sorted DESC by createdAt"

**Status:** Pre-existing, documented in STATE.md (Plan 08-02 gates row, line 50:
"full suite 2374 (2373 pass, 1 pre-existing out-of-scope `situation-artifacts`
fail)"). This quick task (Reader redesign) touched only
`src/ui/surfaces/reader/*` + `src/ui/primitives/{ref-chip,safe-markdown,theme.css}`
+ version files. It changed ZERO worker / situation-room code, so this failure is
unrelated to the 003-B / 004-B redesign.

**Why not fixed here:** SCOPE BOUNDARY — only auto-fix issues DIRECTLY caused by
the current task's changes. This is a worker-tier situation-artifacts assertion,
out of scope for a Reader-surface UI redesign. Carry forward to a situation-room
plan.
