---
phase: 03-daily-bulletin
plan: 04
subsystem: worker+ui
tags: [bulletin, errata, failed-compile-banner, dst-ci, coexistence, gap-closure]
status: AWAITING-CHECKPOINT

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "bulletins-repo.ts (appendErratum, listErrataByCycle, recordCompileFailure, getLatestCompileFailure); compile-bulletin.ts two-pass pipeline; publish.ts two-phase write; bulletin-by-cycle.ts data handler; circuit-breaker BULLETIN_COMPILE_AGENT_KEY; computeNextDueAt DST-safe scheduler; the 6-check Phase 2 coexistence suite"
provides:
  - "bulletin-errata.ts — two handlers in one file: data 'bulletin.errata.byCycle' + action 'bulletin.errata.add' (T-03-22 server-side compile_status='published' check; append-only, never rewrite)"
  - "bulletin-latest-status.ts — data handler 'bulletin.latestCompileStatus' returning CompileFailureStatus ({kind:'ok'} | {kind:'failed', attemptAt, nextRetryAt, reason, attemptN})"
  - "publishBulletin priorCycleErratumSnapshot arg — after a verified publish, snapshots prior cycle's errata as ctx.issues.createComment on the prior issue (append-only, non-fatal on failure), then UPDATEs bulletin_errata.applied_to_issue_comment_id"
  - "compile-bulletin.ts retry accounting — one bulletin_compile_failures row per retry attempt with attempt_n incremented + next_retry_at advanced 15 min; attempt_n>=3 trips the circuit-breaker"
  - "FailedCompileBanner React component — renders 'Bulletin compile failed at HH:MM · retrying at HH:MM' when latestCompileStatus.kind==='failed' and nextRetryAt>now"
  - "ErrataFooter React component — footer-scoped errata list below the bulletin body; returns null on empty"
  - "settings page errata composer form (usePluginAction('bulletin.errata.add'))"
  - "scripts/coexistence-checks/07-bulletin-disable.mjs — 7th coexistence check; asserts 0004_bulletin.sql has no DROP/DELETE-public/DROP COLUMN"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Errata-as-comment snapshot — published cycles are immutable; corrections accrete as bulletin_errata rows and surface on the prior cycle's Paperclip issue as an appended comment on the NEXT cycle's publish (D-18), with applied_to_issue_comment_id guarding against replay"
    - "Failed-compile banner state machine — bulletin_compile_failures rows are the source of truth; the banner shows when the most recent row has next_retry_at>now and self-clears when next_retry_at<=now (D-22)"
    - "DST CI matrix — end-to-end pipeline simulation (cron-tick x hours x computeNextDueAt + job invocation) across the 4 US DST-boundary calendar days, not just the pure-helper kernel"

key-files:
  created:
    - src/worker/handlers/bulletin-errata.ts
    - src/worker/handlers/bulletin-latest-status.ts
    - src/ui/surfaces/bulletin/errata-footer.tsx
    - src/ui/surfaces/bulletin/failed-compile-banner.tsx
    - scripts/coexistence-checks/07-bulletin-disable.mjs
    - test/worker/bulletin/errata.test.mjs
    - test/worker/bulletin/failed-compile-banner.test.mjs
    - test/worker/bulletin/dst-ci-matrix.test.mjs
    - test/worker/bulletin/idempotency.test.mjs
    - test/ci/coexistence-bulletin-disable.test.mjs
  modified:
    - src/worker/jobs/compile-bulletin.ts
    - src/worker/bulletin/publish.ts
    - src/worker/handlers/bulletin-by-cycle.ts
    - src/worker.ts
    - src/shared/types.ts
    - src/shared/bulletin-rendering.ts
    - src/ui/surfaces/bulletin/index.tsx
    - src/ui/surfaces/settings/index.tsx
    - src/ui/styles/bulletin.css
    - scripts/coexistence-checks/run-all.mjs
    - test/ci/coexistence-checklist.test.mjs
    - test/ui/bulletin-page.test.mjs

key-decisions:
  - "Errata are append-only — the action handler re-verifies the target cycle's compile_status='published' server-side (T-03-22) before accepting; a published bulletin's issue body is NEVER mutated, only commented on."
  - "Errata snapshot-as-comment is non-fatal — if ctx.issues.createComment throws, the current cycle still publishes successfully; the failure is logged via ctx.logger.warn and the erratum stays unsnapshotted (applied_to_issue_comment_id NULL) for a later retry."
  - "The failed-compile banner is driven entirely by bulletin_compile_failures rows — no separate banner state; next_retry_at>now is the single show/hide predicate, so the banner self-clears without any explicit dismissal."
  - "One bulletin_compile_failures row per retry ATTEMPT (Plan 03-02 wrote one row per failure) — attempt_n carries the 1/2/3 retry count and next_retry_at advances 15 min each time; attempt_n>=3 routes through the existing recordFailure circuit-breaker."

patterns-established:
  - "Two-handler-per-file registration (data + action) for a single feature surface — bulletin-errata.ts exports one registerBulletinErrata that wires both keys"
  - "Coexistence check as a static migration-SQL scan — 07-bulletin-disable.mjs reads 0004_bulletin.sql and fails on DROP TABLE / DELETE FROM public / ALTER ... DROP COLUMN rather than running a live uninstall"

requirements-completed: [BULL-01, BULL-02, BULL-07, BULL-08]

# Metrics
duration: ~40min
completed: 2026-05-16
---

# Phase 3 Plan 04: Errata + Failed-Compile Banner + DST CI + Coexistence Summary

**Phase 3 closure plan — errata made first-class (append-only, snapshot-as-comment on the next cycle), the failed-compile banner wired end-to-end (worker status handler + React banner), the DST CI matrix completed to a full 4-day end-to-end pipeline simulation, and a 7th coexistence check added so a future change that drops the bulletins data fails the build.**

## Performance

- **Duration:** ~40 min (Tasks 1-2; Task 3 is a pending human-verify checkpoint)
- **Completed (Tasks 1-2):** 2026-05-16
- **Tasks:** 2 of 3 (Task 3 = Eric's Countermoves Phase 3 closure drill — AWAITING CHECKPOINT)
- **Files:** 22 touched — 10 created, 12 modified

## Accomplishments

- **Errata first-class (BULL-07)** — `bulletin-errata.ts` registers `bulletin.errata.byCycle` (data) + `bulletin.errata.add` (action); the action re-verifies the cycle's `compile_status='published'` server-side before writing an append-only `bulletin_errata` row, and validates `body` non-empty / ≤2000 chars.
- **Errata snapshot-as-comment** — `publishBulletin` gained an optional `priorCycleErratumSnapshot` arg; after a verified publish it appends the prior cycle's errata as a comment on the prior cycle's Paperclip issue via `ctx.issues.createComment`, then sets `applied_to_issue_comment_id` so the snapshot never replays. The prior issue body is never mutated; a `createComment` failure is logged and non-fatal.
- **Failed-compile banner (BULL-08)** — `bulletin-latest-status.ts` registers `bulletin.latestCompileStatus` returning `{kind:'ok'}` or `{kind:'failed', attemptAt, nextRetryAt, reason, attemptN}`; `FailedCompileBanner` renders the literal `'Bulletin compile failed at HH:MM · retrying at HH:MM'` at the top of the bulletin page and self-clears once `nextRetryAt<=now`.
- **Retry accounting** — `compile-bulletin.ts` now writes one `bulletin_compile_failures` row per retry attempt (`attempt_n` incremented, `next_retry_at` advanced 15 min); `attempt_n>=3` trips the `BULLETIN_COMPILE_AGENT_KEY` circuit-breaker → Editor-Agent paused → banner stays visible until manual resume.
- **DST CI matrix completed (BULL-01)** — `dst-ci-matrix.test.mjs` runs full cron-tick × hours × `computeNextDueAt` × job-invocation simulations across 2026-03-08, 2026-03-09, 2026-11-01, 2026-11-02, asserting exactly one compile per calendar day at 06:30 wall-clock and a determinism (byte-equal) re-run.
- **Idempotency locked (BULL-02)** — `idempotency.test.mjs` proves same-`content_hash` re-fire is a hard no-op, different-`content_hash` re-fire produces a new `compile_failure` row (not a republish), and errata-as-comment does not re-create the comment on later cycles.
- **Coexistence check 07** — `07-bulletin-disable.mjs` statically scans `0004_bulletin.sql` for `DROP TABLE` / `DELETE FROM public.*` / `ALTER ... DROP COLUMN`; added to `run-all.mjs` and the `coexistence-checklist.test.mjs` `CHECK_FILES` array — the Phase 2 suite is now 7 checks.

## Task Commits

TDD (test → feat), committed atomically:

1. **Task 1: RED — bulletin closure contracts** — `ec9c08c` (test) — 5 test files, 629 insertions; all fail (target files absent).
2. **Task 2: GREEN — errata + failed-compile status + DST matrix + coexistence** — `e65088a` (feat) — 18 files, 687 insertions; all RED tests turn green.

_Task 3 (Eric's Countermoves Phase 3 closure drill) is a `checkpoint:human-verify` blocking gate — not yet run._

## Deviations from Plan

None material. The plan's per-task `<action>` blocks were executed as written across two atomic commits (RED-all then GREEN-all). The plan's `files_modified` list anticipated a `bulletin.css` extension; the GREEN commit added rules to `src/ui/styles/bulletin.css` (the styles-dir CSS file), matching the same `[data-clarity-surface="bulletin"]` scoping convention.

## Verification

- `node --test "test/**/*.test.mjs"` — **660 tests / 658 pass / 0 fail / 2 skip** (baseline 626 after quick task 260516-gx4; +34).
- `npx tsc --noEmit` — clean.
- `node scripts/build-worker.mjs` — clean (`dist/worker.js` 159.7 KB unminified).
- `node scripts/build-ui.mjs` — clean (`dist/ui/index.js` 105.1 KB unminified).
- `npx tsc --project tsconfig.manifest.json` — clean.
- `node scripts/coexistence-checks/run-all.mjs` — **7/7 PASS** (COEXIST-01..07, including the new 07-bulletin-disable).

_Bundle measurement-basis note (carried from Plan 03-01/03-02): `scripts/build-{worker,ui}.mjs` emit unminified dev artifacts; the plan's `du -k` acceptance thresholds are interpreted against the minified production build._

## Checkpoint — Task 3 (AWAITING)

**Type:** `checkpoint:human-verify` (blocking gate). Plan 03-04 — and Phase 3 — is NOT complete until Eric runs the Phase 3 closure drill on Countermoves and reports "approved — phase 3 closed". Full drill instructions are in `03-04-PLAN.md` Task 3 `<how-to-verify>`. It exercises: the errata composer on the settings page, errata-as-comment on the next cycle, the failed-compile banner (synthetic `bulletin_compile_failures` row), and plugin-disable coexistence (prior `Bulletin No. N` issues survive in classic Paperclip).

## Next Phase Readiness

- All Phase 3 auto work is complete and green. After Eric's Task-3 drill PASSES, Phase 3 closes and the milestone advances to Phase 4 (Employee Chat).
- BULL-01, BULL-02, BULL-07, BULL-08 are implemented; final confirmation pending the closure drill.

## Self-Check: PASSED

- `src/worker/handlers/bulletin-errata.ts` — FOUND
- `src/worker/handlers/bulletin-latest-status.ts` — FOUND
- `src/ui/surfaces/bulletin/failed-compile-banner.tsx` — FOUND
- `scripts/coexistence-checks/07-bulletin-disable.mjs` — FOUND
- Commit `ec9c08c` (RED) — FOUND
- Commit `e65088a` (GREEN) — FOUND

---
*Phase: 03-daily-bulletin*
*Plan 03-04 — Tasks 1-2 complete; Task 3 awaiting closure-drill checkpoint*
*Completed (build): 2026-05-16*
