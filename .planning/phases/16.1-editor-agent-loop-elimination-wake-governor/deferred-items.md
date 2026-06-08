# Phase 16.1 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed here (SCOPE BOUNDARY:
only auto-fix issues directly caused by the current task's changes).

## Pre-existing REQUIREMENTS.md traceability test failures (discovered during Plan 16.1-02)

- **Files:** `test/phases/04-traceability.test.mjs` (3/4 fail), `test/phases/04.1-traceability.test.mjs` (4/4 fail)
- **Failures:** CHAT-01..CHAT-11 and CTT-01..CTT-08 rows missing/not-marked-Implemented/missing phase reference in `.planning/REQUIREMENTS.md`.
- **Verification it is pre-existing:** with Plan 16.1-02's `agent-task-delivery.ts` + test edits stashed, `04-traceability.test.mjs` still fails 3/4 (run 2026-06-08). These tests read `.planning/REQUIREMENTS.md` document state and are unrelated to the worker delivery path / wake-governor changes in this plan.
- **Disposition:** Deferred — a REQUIREMENTS.md bookkeeping issue from a prior phase, not caused by this plan's source changes. Should be addressed when Phase 4 / 4.1 traceability is next reconciled.
