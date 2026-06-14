---
phase: 18-no-rabbit-holes-plain-english
plan: 03
subsystem: honest-divergence
tags: [leg-03, looks-done, honest-divergence, confirm-gated, batched-read, tldr-cache, no-uuid-leak, degrade-safe, perf-non-regression]
requires:
  - "11-03/11-04 BlockerChainResult.needsYou (the engine verdict — READ, never computed)"
  - "16.1-04 selectAwaitingYouIssueIds (the pure de-duped needs-you UUID set)"
  - "tldr-cache.ts getTldrByScope template + toPgTextArrayLiteral text[] bridge cast"
  - "09-01 situation.assignOwner privilege boundary (ctx.issues.update + operator actor, A7)"
  - "LiveBlockerPanel's existing flatten-blocker-chain fetch (Reader needsYou source)"
provides:
  - "looksDone(body) — deterministic high-precision completion-phrase detector (D-05/D-06); degrade-safe on null/empty; deterministic floor (no model token)"
  - "getTldrBodiesByScopeIds(ctx,surface,scopeIds) — single = ANY($2::text[]) batched read, DISTINCT ON (scope_id) most-recent body; empty set → zero queries (O(1))"
  - "SituationEmployeeRow.looksDone — the worker-set honest-divergence flag (needsYou AND TL;DR-done), degrade-wrapped from ONE batched read"
  - "LooksDoneAffordance — confirm-gated 'Looks done — close it?' component (Close as done / Keep blocked); never auto-closes; UUID dispatch-only"
  - "situation.closeAsDone — operator-attributed status=done mutation behind the affordance (reuses the already-declared issues.update capability)"
  - "LiveBlockerPanel onVerdict callback — lifts the leaf needsYou verdict to the Reader index with NO second fetch"
affects:
  - src/shared/looks-done.ts (new)
  - src/worker/db/tldr-cache.ts (getTldrBodiesByScopeIds added)
  - src/worker/situation/build-employees-rollup.ts (looksDone flag + optional db on ctx)
  - src/worker/handlers/situation-room.ts (threads ctx.db into the rollup ctx)
  - src/worker/handlers/situation-close-as-done.ts (new)
  - src/worker.ts (registers situation.closeAsDone)
  - src/ui/surfaces/situation-room/looks-done-affordance.tsx (new)
  - src/ui/surfaces/situation-room/employee-row.tsx (renders the affordance on looksDone rows)
  - src/ui/surfaces/reader/index.tsx (gates the affordance on looksDone(tldr.body) AND lifted needsYou)
  - src/ui/surfaces/reader/live-blocker-panel.tsx (onVerdict upward report)
  - "downstream 18-04 (live BEAAA drill — affordance on a done-but-blocked item; warm recompute < ~500ms with LEG-03 active)"
tech-stack:
  added: []
  patterns:
    - "single batched O(1) read into the Phase-16-hardened snapshot hot path: build the needs-you set ONCE (selectAwaitingYouIssueIds), one `= ANY` query, attach flags — never a per-row read (landmine #1)"
    - "degrade-wrapped new DB access: try/catch around the batched read → throw/slow/absent db drops the flag and leaves focusLine intact; never blocks/slows the render (landmine #2)"
    - "deterministic high-precision completion-phrase regex with a per-sentence hedge/negation veto (bias precision over recall — D-06)"
    - "confirm-gated-by-construction mutation: the close fires ONLY from the explicit 'Close as done' handler; no mount/effect auto-close path (T-18.03-STATE)"
    - "verdict lifted from an existing fetch via an onVerdict callback (no new Reader DB read)"
    - "owner-picker scaffold copied + INVERTED from immediate-apply to confirm-gated"
key-files:
  created:
    - src/shared/looks-done.ts
    - src/worker/handlers/situation-close-as-done.ts
    - src/ui/surfaces/situation-room/looks-done-affordance.tsx
    - test/shared/looks-done.test.mjs
    - test/worker/db/tldr-bodies-batch.test.mjs
    - test/worker/situation/build-employees-rollup-looks-done.test.mjs
    - test/ui/surfaces/looks-done-affordance.test.mjs
    - test/worker/handlers/situation-close-as-done.test.mjs
  modified:
    - src/worker/db/tldr-cache.ts
    - src/worker/situation/build-employees-rollup.ts
    - src/worker/handlers/situation-room.ts
    - src/worker.ts
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/reader/index.tsx
    - src/ui/surfaces/reader/live-blocker-panel.tsx
decisions:
  - "Completion-phrase set chosen (D-06 precision tuning): done / complete / completed / shipped / merged / delivered / resolved / finished, matched only in a completion-CLAIM position (optional copula lead-in: is/are/was/were/has been/have been/'s/been/now). Per-sentence HEDGE/NEGATION veto disqualifies a matching sentence containing any of: not / n't / almost / nearly / partially / partly / soon / once / when / after / before / until / unless / if / pending / awaiting / blocked / cannot / can't / isn / aren / wasn / still need / to be / needs to. Result: 'This task is done.'→true, 'Almost done, blocked on review.'→false, 'Please merge the branch.'→false (imperative, not a claim). Bias is precision — tolerate misses over a false 'close it?' prompt."
  - "Query-count proof (SPEC line 82 / O(1) acceptance): the fake-db tests COUNT query() calls — empty needs-you set → 0 queries (short-circuit, no `= ANY('{}')`); non-empty set → EXACTLY 1 query for the whole set; DISTINCT ON (scope_id) returns the most-recent body per scope."
  - "The close mutation is a NEW worker action (situation.closeAsDone), not in the plan's Task-3 files_modified list. RATIONALE: the affordance dispatches a status flip and there was no registered close/status action (assign-owner only patches assignee); a confirm-gated close that dispatched to a non-existent action would be a dead button (project HARD rule: NO DEAD BUTTONS). The handler is a minimal additive mirror of situation-assign-owner (same privilege boundary, the already-declared issues.update capability, operator actor) — no new capability, no version bump. Logged as deviation Rule 2."
  - "Reader needsYou is LIFTED from LiveBlockerPanel's existing flatten-blocker-chain fetch via a new optional onVerdict callback, satisfying 'AND the panel's needsYou' with ZERO new Reader DB reads. live-blocker-panel.tsx was edited (not in Task-3 files_modified) for this single optional callback; absent callback → no behavior change. Logged as deviation Rule 3 (necessary wiring)."
  - "ctx.db threaded into the rollup ctx (situation-room.ts, not in Task-2 files_modified) as a one-line addition; EmployeesRollupCtx.db is OPTIONAL so old fixtures + the degrade path set no flag. The batched read is the one new access into the snapshot hot path; degrade-wrapped per the Phase-16 perf non-regression guard. Logged as deviation Rule 3."
  - "focusLine = polishTldr(title) is UNCHANGED (landmine #10 — LEG-03 adds a SEPARATE done-flag, not a focusLine source change). blocker-chain.ts is NOT touched (landmine #6 — the verdict is read, never computed)."
metrics:
  duration: ~70m
  tasks_completed: 3
  files_created: 8
  files_modified: 7
  tests_passing: "50 (18-03 owned: 21 looks-done + 6 batched-read + 6 rollup-flag + 17 affordance + 5 close-handler) / all related surface + rollup + blocker-chain suites green"
  completed: 2026-06-14
---

# Phase 18 Plan 03: Honest-Divergence "Looks done — close it?" Affordance Summary

LEG-03 surfaces the honest divergence — when the AI TL;DR reads "done" but the deterministic engine still classifies the item blocked (needsYou) — as a confirm-gated "Looks done — close it?" affordance on BOTH the Reader and the SR needs-you row, triggered by a deterministic high-precision completion-phrase regex over `tldr_cache.body` (D-05/D-06) AND a blocked-family verdict (D-07), fed on the SR by a SINGLE batched O(1) `tldr_cache` read degrade-wrapped into the Phase-16-hardened snapshot hot path. It never auto-closes; it is absent when the inputs agree or either is missing.

## What Shipped

**Task 1 — `looksDone` + `getTldrBodiesByScopeIds`.** A deterministic, precision-biased completion-phrase detector (per-sentence completion-claim match with a hedge/negation veto) and a batched `= ANY($2::text[])` `tldr_cache` read (DISTINCT ON most-recent body per scope; empty set short-circuits to zero queries). Both unit-proven, including the query-count O(1) acceptance.

**Task 2 — the SR-row done-flag.** After the per-agent fan-out (NOT inside the per-row loop), `buildEmployeesRollup` builds the needs-you set once (`selectAwaitingYouIssueIds`), issues ONE batched read, and attaches `looksDone: true` to needs-you rows whose cached TL;DR reads done. Degrade-wrapped (throw/slow/absent `db` → no flag, focusLine intact). `focusLine = polishTldr(title)` unchanged; `blocker-chain.ts` untouched. `ctx.db` threaded from `situation-room.ts`.

**Task 3 — the confirm-gated affordance.** `LooksDoneAffordance` (owner-picker scaffold inverted to confirm-gated) shows "Looks done — close it?" → "Close as done" / "Keep blocked". The close dispatches `situation.closeAsDone` (a minimal additive `ctx.issues.update({status:'done'})` handler, operator-attributed) ONLY from the explicit handler — no mount/effect auto-close. The SR row renders it on `row.looksDone === true`; the Reader gates it on `looksDone(data.tldr?.body)` AND the `needsYou` verdict lifted from `LiveBlockerPanel`'s existing fetch (no new Reader DB read). UUID is dispatch-only (NO_UUID_LEAK).

## Deviations from Plan

### Auto-added critical functionality / necessary wiring

**1. [Rule 2 - Missing critical functionality] New `situation.closeAsDone` worker action + worker.ts registration.**
- **Found during:** Task 3. The plan's Task-3 `files_modified` listed only UI files, but the affordance must dispatch a close (status) mutation and no registered close/status action existed (`situation.assignOwner` only patches the assignee). A confirm-gated close dispatching to a non-existent action would be a dead button — a violation of the project's hard NO-DEAD-BUTTONS rule.
- **Fix:** Added `src/worker/handlers/situation-close-as-done.ts` (a minimal additive mirror of `situation-assign-owner.ts`: `wrapActionHandler`, `reqStr`, operator actor, one `ctx.issues.update({status:'done'})` via the leaf UUID) and registered it in `src/worker.ts`. Uses the ALREADY-declared `issues.update` capability — no new capability, no manifest slot change, no version bump.
- **Files modified:** `src/worker/handlers/situation-close-as-done.ts` (new), `src/worker.ts`. **Commit:** 0cc9fb2.

**2. [Rule 3 - Blocking wiring] `LiveBlockerPanel` `onVerdict` callback (live-blocker-panel.tsx, not in Task-3 files_modified).**
- **Found during:** Task 3. The Reader index has `data.tldr.body` but not the `needsYou` verdict, and the plan forbids a new Reader DB read. The panel is the single owner of the `flatten-blocker-chain` fetch.
- **Fix:** Added an OPTIONAL `onVerdict` callback that lifts the already-fetched `{ needsYou, leafIssueId, leafIssueUuid }` up to the index (reported in an effect, never during render). Absent callback → no behavior change.
- **Files modified:** `src/ui/surfaces/reader/live-blocker-panel.tsx`. **Commit:** 0cc9fb2.

**3. [Rule 3 - Blocking wiring] `ctx.db` threaded into the rollup ctx (situation-room.ts, not in Task-2 files_modified).**
- **Found during:** Task 2. The batched read needs a `db` client, which `EmployeesRollupCtx` did not carry and `situation-room.ts` did not pass into the rollup.
- **Fix:** Added an OPTIONAL `db: Pick<PluginDatabaseClient,'query'>` to `EmployeesRollupCtx` and a one-line `db: ctx.db` in the rollup call. Optional → old fixtures + the degrade path set no flag. **Commit:** bd1b568.

## Perf Non-Regression Guard (Eric's flag — honored)

The batched `tldr_cache` read is the ONE new access into the Phase-16-hardened snapshot hot path. It is: (a) a SINGLE `= ANY` query scoped to the needs-you set — query-count test proves empty→0, non-empty→exactly 1 (never O(rows)); (b) degrade-wrapped — a throw/slow read or absent `db` drops the flag and leaves `focusLine` and the SWR serve-last-good path exactly as today; it cannot re-introduce the 25.7s cold cliff. `focusLine` and the deterministic engine are untouched.

## Threat Mitigations Applied

- **T-18.03-STATE (Tampering / unintended close):** confirm-gated by construction — the close dispatch exists only inside the explicit "Close as done" handler; a structural test asserts no `closeAsDone()`/`dispatchClose()` call in any `useEffect`, and a behavioral test asserts no dispatch on open/toggle/dismiss.
- **T-18.03-I (Info disclosure / UUID):** `leafIssueUuid` is a dispatch-only prop; render-scan tests assert it never appears in a JSX text node or template; the host validates the UUID server-side on `ctx.issues.update`.
- **T-18.03-DOS (snapshot hot path):** single O(1) `= ANY` query, degrade-wrapped (see Perf guard).
- **T-18.03-SC (npm installs):** zero packages added (TS/TSX/mjs only).

## Self-Check: PASSED

- All 8 created files exist on disk (verified).
- All three task commits exist: 7f68448, bd1b568, 0cc9fb2 (verified via `git log`).
- 50 plan-owned tests pass; `check-css-scope.mjs` exits 0 (226 selectors all scoped); `blocker-chain.ts` absent from the diff; `focusLine` assignment unchanged.
- Full-suite failures (59) are all pre-existing environment issues (missing `node_modules`: react / date-fns-tz / xlsx / playwright) or the known Phase-20-scoped CHAT/CTT traceability rows — none reference any file created or edited in this plan.
