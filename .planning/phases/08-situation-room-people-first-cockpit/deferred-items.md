# Phase 8 — Deferred / Out-of-Scope Items

## Pre-existing test failure (NOT caused by Plan 08-01)

- **Test:** `situation.artifacts: per-agent arrays sorted DESC by createdAt`
- **File:** `test/worker/handlers/situation-artifacts.test.mjs:392`
- **Symptom:** `assert.ok(Array.isArray(arr) && arr.length === 5)` fails (the
  per-agent merged attachments+documents array does not reach length 5).
- **Independence proof:** the failure reproduces identically when
  `src/worker/handlers/{situation-room,org-blocked-backlog}.ts` are checked out
  at the pre-Plan-08-01 commit `d526987`. `situation-artifacts.test.mjs` imports
  `registerSituationArtifactsHandlers` and does NOT import any module created or
  modified by Plan 08-01 (`scrub-human-action.ts`, `classify-employee-state.ts`,
  `build-employees-rollup.ts`, `situation-room.ts`, `org-blocked-backlog.ts`).
- **Disposition:** out of scope for Plan 08-01 (deviation-rules SCOPE BOUNDARY —
  only auto-fix issues DIRECTLY caused by the current task's changes). Logged here
  for a future debug pass; not fixed under this plan.
