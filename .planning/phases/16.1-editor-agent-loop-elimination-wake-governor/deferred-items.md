# Phase 16.1 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed here (SCOPE BOUNDARY:
only auto-fix issues directly caused by the current task's changes).

## Pre-existing REQUIREMENTS.md traceability test failures (discovered during Plan 16.1-02)

- **Files:** `test/phases/04-traceability.test.mjs` (3/4 fail), `test/phases/04.1-traceability.test.mjs` (4/4 fail)
- **Failures:** CHAT-01..CHAT-11 and CTT-01..CTT-08 rows missing/not-marked-Implemented/missing phase reference in `.planning/REQUIREMENTS.md`.
- **Verification it is pre-existing:** with Plan 16.1-02's `agent-task-delivery.ts` + test edits stashed, `04-traceability.test.mjs` still fails 3/4 (run 2026-06-08). These tests read `.planning/REQUIREMENTS.md` document state and are unrelated to the worker delivery path / wake-governor changes in this plan.
- **Disposition:** Deferred — a REQUIREMENTS.md bookkeeping issue from a prior phase, not caused by this plan's source changes. Should be addressed when Phase 4 / 4.1 traceability is next reconciled.

## Pre-existing wake-governor.ts typecheck errors (discovered during Plan 16.1-03)

- **File:** `src/worker/agents/wake-governor.ts` (lines 107, 115, 116, 119, 122) — 5x `error TS2345`.
- **Cause:** `WakeGovernorCtx.db` is declared as a narrow Pick shape `{ query; execute }` (no `namespace`), but it is passed to the wake-ledger / wake-kill-switch repos whose ctx requires the full `PluginDatabaseClient` (which includes `namespace`). The narrow ctx is missing `namespace`.
- **Verification it is pre-existing:** `npx tsc --noEmit` reports exactly these 5 errors BOTH with Plan 16.1-03's changes present AND with them stashed (run 2026-06-08). `wake-governor.ts` was authored in Plan 16.1-02 and is untouched by Plan 16.1-03.
- **Disposition:** RESOLVED in Plan 16.1-04 (2026-06-08). `WakeGovernorCtx.db` widened from the narrow `{query;execute}` Pick to the full `PluginDatabaseClient` (and `WakeGovernorCtx.logger` widened to the `PluginLogger` `meta?: Record<string,unknown>` shape, which surfaced once the full ctx was required). `npx tsc --noEmit` now reports 0 errors total (was 5 TS2345). The fix was made as part of wiring the wake-governor caller (the bounded warm in editor.ts + the bulletin cron in compile-bulletin.ts), per the carry-forward instruction. Commit 176e1ea.
