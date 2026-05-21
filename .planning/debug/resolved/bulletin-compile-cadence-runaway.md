---
slug: bulletin-compile-cadence-runaway
status: resolved
trigger: v0.6.5 closure re-drill (2026-05-18) — compile-bulletin re-fires every ~2 min and publishes a new cycle each time, unbounded; verifier tolerance:0 rejects ~half of attempts
created: 2026-05-18
updated: 2026-05-18
resolved: 2026-05-18
phase: 03-daily-bulletin
related_sessions:
  - tldr-heartbeat-recursion.md (v0.6.5 — its two fixes PROVEN LIVE on this same drill; this is a NEW, separate blocker)
note: RESOLVED — v0.6.6 fixes PROVEN LIVE on the Countermoves re-drill 2026-05-18. Both bugs dead: one clean compile (cycle 8), cadence settled to the next 06:30-ET slot, zero 0.6.6 verifier failures, operation issues flat.
---

# Debug: bulletin-compile-cadence-runaway

## Symptoms

The v0.6.5 closure re-drill (live Countermoves, 2026-05-18 ~07:16–07:31)
confirmed the two `tldr-heartbeat-recursion.md` fixes work (recursion guard
fires; no `malformed array literal`) AND that the compile pipeline publishes
end-to-end. But it exposed two new compile-bulletin operability defects.

### Bug 1 — runaway compile cadence (the blocker)

v0.6.5 activated at 07:16:12. From 07:17 onward the `compile-bulletin` job
re-fired every ~2 minutes and published a NEW cycle each fire:

```
cycle 2 published 07:17:26    cycle 5 published 07:23:26
cycle 3 published 07:19:26    cycle 6 published 07:25:26
cycle 4 published 07:21:26    cycle 7 published 07:31:26
```

Six cycles in ~14 minutes — unbounded; halted only by uninstalling the plugin.
The ~2-min interval is the compile duration (`durationMs ≈ 50s`) gating the
every-minute cron. ROOT CAUSE (hypothesis, not yet pinned): after a publish,
`next_due_at` is not advanced to a future instant — the job's "advance the
schedule pointer" step (compile-bulletin step 7 / `computeNextDueAt`) leaves
`next_due_at` in the past, so the next cron tick immediately re-compiles. A
DAILY bulletin (cron `0 6 30 * * *` America/New_York) must not recompile every
2 minutes. NOTE: the restored snapshot's bulletin rows carried 05-17
`next_due_at` values (legitimately past by 05-18) — the FIRST compile firing is
correct; the failure is that subsequent ones never settle.

### Bug 2 — verifier re-runs live SQL → loses every compile-window race (the ROOT defect)

`editor_agent_failures` (plugin_version 0.6.5) — 2 rows:
- 535 @ 07:28:16 — `completed_7d` claimed 4 / actual 5
- 536 @ 07:30:37 — `open_issues` claimed 8 / actual 7; `completed_7d` claimed 6 / actual 7

`verifyDraft` pass-2 RE-RUNS each `slotDef.sql` at the END of the compile and
exact-matches (`tolerance: 0`) against the draft's numbers. The agent takes ~50s;
during that window the live counts drift, so the re-run SQL disagrees with the
numbers the agent was HANDED at pass-1 → rejection → retry. 54 `bulletin-compile`
operation issues for 6 published cycles ≈ 9× retry overhead; durable breaker
walked to `consecutive=2` (trips at 3; publishes kept resetting it).

DRIFT SOURCE — PINNED (live query of the exact `completed_7d` row set,
2026-05-18). Three issues completed INSIDE the 07:28–07:31 compile windows:
- `a26ea0fb` "Bulletin No. 6 — Monday, 2026-05-18", `origin_kind='plugin:clarity-pack'`,
  completed 07:29:14 — **a published bulletin issue counting itself.** The
  `EXCLUDE_OPERATION_ISSUES_SQL` filter is `NOT LIKE 'plugin:clarity-pack:operation:%'`
  — scoped to the `:operation:` SUB-namespace; a bulletin issue is plain
  `plugin:clarity-pack`, so it slips past the filter.
- `e21155eb` + `bbbe3583` "Recover missing next step COU-68",
  `origin_kind='stranded_issue_recovery'`, completed 07:28:51 + 07:29:47 —
  **Paperclip's own productivity-reconciliation engine** auto-creating +
  auto-completing recovery issues, churning independently of clarity-pack.

Both sources are real `public.issues` rows genuinely transitioning to `done`
mid-compile. Filtering cannot prevent this — Paperclip churns its own board
during any 50s window. THEREFORE the root defect is the verifier's re-run, not
the filter: `verifyDraft` must validate the draft against the FROZEN facts
snapshot handed to pass-1 (`computeStandingNumbers`' output at compile START),
not a fresh SQL re-run at compile END. The draft claimed 4 because it was GIVEN
4 — it is faithful; re-running and getting 5 makes the verifier wrong.

FIX DIRECTION (Bug 2, v0.6.6):
- `verifyDraft` checks the draft's resolved numbers against the same
  `standingNumbers`/`factsTable` object passed into `compilePass1` — verifying
  "did the agent transcribe the numbers we gave it" (catches hallucination),
  NOT "do the numbers still match a live re-query" (unwinnable race).
- Secondary cleanup: broaden `EXCLUDE_OPERATION_ISSUES_SQL` to
  `NOT LIKE 'plugin:clarity-pack%'` (whole namespace) so a bulletin issue never
  counts itself — defensible regardless, though Bug 2's fix makes it moot.

FIX DIRECTION (hypothesis — v0.6.6 work, confirm in debug):
- Bug 1: `next_due_at` must advance to the next genuine schedule slot
  (next 06:30 America/New_York strictly after `now()`), not to a past instant.
  Inspect `computeNextDueAt` + the compile-bulletin step that writes it.
- Bug 2: verify the draft against the SAME facts snapshot the agent was handed
  (the numbers `computeStandingNumbers` produced at compile START), not against
  a fresh re-run of the SQL at compile END. Re-running the SQL re-introduces the
  race the facts snapshot exists to eliminate. (Alternatively: a small nonzero
  tolerance — but freezing to the handed facts is the correct fix.)

## Evidence (Countermoves, 2026-05-18 drill)

- Restored pre-cascade snapshot `2026-05-17T12-52-04Z`, swapped onto live;
  uninstalled v0.6.3 (carried in that snapshot); installed v0.6.5.
- bulletins table after the run: cycle 0 (pending bootstrap), 1 (published
  05-17), 2–7 (all published 05-18 07:17–07:31).
- operation issues: 54 `bulletin-compile` + 8 `tldr-compile` — BOUNDED (the
  recursion guard held); the 54 is verifier-retry churn, not recursion.
- editor_agent_failures 0.6.5: 2 rows (both verifier tolerance:0 rejections).
- Plugin uninstalled ~07:32 to halt the cadence; live Paperclip healthy on 3100;
  all data preserved.

## Process note

The host-faithful local suite cannot model the live compile-window timing (the
~50s gap between facts-compute and verify) nor the schedule-pointer advance —
exactly the standing open recommendation in `tldr-heartbeat-recursion.md`. A
faithful integration test of the compile-bulletin job control flow (fire →
publish → next_due_at advance → idle) is wanted before the v0.6.6 re-drill.

---

## v0.6.6 Fix Applied (2026-05-18)

Both bugs implemented + the local suite is green (723 pass / 0 fail / 2
pre-existing skips). `tsc --noEmit` clean; `dist/worker.js` builds (183.5kb).

### Bug 1 — runaway cadence — ROOT CAUSE PINNED + FIXED

The hypothesis ("`computeNextDueAt` leaves `next_due_at` in the past") was
WRONG — `computeNextDueAt` always returns a future 06:30-ET instant. The actual
root cause, pinned by reading the full job + `publishBulletin` + repo:

The schedule pointer was advanced **only on the success/duplicate path** (old
step 7) **and only on the just-published per-cycle row**
(`UPDATE … WHERE cycle_number = $2`). EVERY failure `continue` — verifier
rejection, pass-1 throw, publish `failed`, an unexpected per-company throw —
returned to the loop WITHOUT advancing `next_due_at`. `getNextDueAtForCompany`
reads the pointer off the `MAX(cycle_number)` row; whenever a tick hit a failure
path it left a STALE, past `next_due_at` on that row, so the next every-minute
heartbeat tick re-entered the compile immediately. The scattered per-cycle
pointer also meant the bootstrap cycle-0 row and prior cycles kept their stale
values. The verifier rejecting ~half the attempts (Bug 2) is what kept the
failure paths firing — Bug 1 + Bug 2 were a coupled runaway.

Fix (`src/worker/jobs/compile-bulletin.ts`):
- New `advanceScheduleForCompany(ctx, companyId, now)` helper —
  `UPDATE bulletins SET next_due_at = $1 WHERE company_id = $2`. It is
  COMPANY-SCOPED (advances EVERY row for the company in one statement — the
  pointer is a schedule fact, not a per-cycle historical fact) and best-effort
  (its own try/catch; a schedule-write hiccup is logged and never aborts the
  loop).
- It is called on EVERY path that consumed a due tick: a verified publish, an
  idempotent duplicate, AND every failure `continue` (reconcile/resume failure,
  standing-numbers failure, pass-1 throw, verifier rejection, publish failure,
  breaker-open skip) AND the per-company catch-all when `gatePassed` is set.
- A failed cycle is re-attempted by the D-22 15-minute retry timer
  (`bulletin_compile_failures.next_retry_at`), NOT by the every-minute cron.
- Old step 7's per-cycle `UPDATE … WHERE cycle_number = $2` is removed.

### Bug 2 — verifier re-run race — FIXED

`verifyDraft` (`src/worker/bulletin/bulletin-verifier.ts`) is rewritten:
- New signature `verifyDraft(draft, frozenStandingNumbers)` — pure, sync,
  I/O-free. It compares `draft.standingNumbers` against the FROZEN
  `StandingNumberRow[]` the pipeline built from `computeStandingNumbers` at
  compile START and handed to `compilePass1`. No SQL re-run → no compile-window
  race. Verifies "did the agent faithfully transcribe the numbers we gave it"
  (still catches hallucination — a drifted or invented value/slot is rejected
  with the same typed `{slot,claimed,actual,tolerance}` / `UNKNOWN_SLOT`
  results). Tolerances unchanged (exact for count/currency, ±0.01 pct/ratio).
- The compile job passes the in-hand `standingNumberRows` array to `verifyDraft`
  (`compile-bulletin.ts` step 5).

Secondary cleanup (`src/worker/bulletin/standing-numbers.ts`):
- `EXCLUDE_OPERATION_ISSUES_SQL` broadened from `plugin:clarity-pack:operation:%`
  to the whole `plugin:clarity-pack%` namespace, so a published bulletin issue
  (`origin_kind = 'plugin:clarity-pack'`) can no longer count itself in
  `completed_7d`. NULL-safe guard retained; `$1` stays the sole bound param
  (T-03-10 holds). Note `stranded_issue_recovery` issues are NOT clarity-pack's
  and are intentionally still counted — they are real Paperclip board activity;
  Bug 2's frozen-snapshot verifier is what makes that churn harmless.

### Test coverage added (the process-note ask)

- `compile-bulletin-end-to-end.test.mjs` — two new Bug-1 regression tests:
  `a successful publish then an immediate re-fire does NOT recompile (cadence
  settles)` and `a verifier rejection still advances next_due_at — no
  every-minute retry`. The in-memory db model was made host-faithful for the
  schedule pointer (`getNextDueAtForCompany` prefers a live row; the
  `SET next_due_at` UPDATE is company-scoped).
- `host-faithful-ctx.mjs` — the shared host-faithful db fake's `SET next_due_at`
  branch updated to the company-scoped shape.
- `verifier.test.mjs` — rewritten for the frozen-snapshot signature; adds a
  test proving a faithful transcription passes even when the live count has
  since drifted (the exact Bug-2 scenario).
- `standing-numbers.test.mjs` — asserts the broadened `plugin:clarity-pack%`
  exclusion and that the narrow operation-only pattern is gone.
- `bulletin-content-defects.test.mjs` — Defect-D `makeThrowingCtx` re-pointed:
  the post-`cycleNumber` unexpected-crash seam is now `publishBulletin`'s
  un-try-wrapped idempotency pre-check (`publish_precheck`); a new test asserts
  the v0.6.6 contract that a `next_due_at`-advance failure after a clean publish
  is logged + swallowed and does NOT trip the breaker.

## v0.6.6 Re-Drill — PASS (live Countermoves, 2026-05-18)

Bookended per the MemPalace clarity_pack runbook. Pre-install snapshot
`2026-05-18T11-39-14Z` (DB 3.4 MB + FS 210 MB, sha256-verified at creation;
restore path already proven end-to-end on this box by the v0.6.5 drill).

OPERATOR GOTCHA surfaced — recorded for the runbook: the first install
reported `Installed clarity-pack v0.6.5` despite a tarball named `0.6.6.tgz`.
Two causes: (1) `src/manifest.ts` hardcodes `version` as a literal — `npm version`
bumps `package.json` only, never the manifest, which is the version Paperclip
actually reads; (2) `dist/` was stale — `npm run build` had not been re-run
after the fix (and the aggregate `build` script chains via `pnpm`, which may be
absent locally — run `build:worker`/`build:ui`/`build:manifest` individually).
FIX: bump BOTH `package.json` and `src/manifest.ts`, rebuild, repack, verify
`dist/manifest.js` shows the new version BEFORE shipping the tarball. Also: the
`test` script `node --test test/` is broken on Node ≥21 — changed to
`node --test "test/**/*.test.mjs"`.

Drill result (schema `plugin_clarity_pack_cdd6bda4bd`):
- Bug 1 PROVEN FIXED — v0.6.6 compiled exactly ONE cycle (cycle 8, published
  11:45:42). `next_due_at` advanced to `2026-05-19 10:30:00+00` (= 06:30
  America/New_York, the next genuine daily slot). Across a ~12-min watch
  (5–6 every-minute cron ticks — v0.6.5 would have published 5–6 new cycles)
  NO cycle 9 fired. Cadence settled to daily.
- Bug 2 PROVEN FIXED — `editor_agent_failures` carried zero `0.6.6` rows
  (only pre-existing 0.6.0×3, 0.6.5×2, NULL×3). The frozen-snapshot verifier
  did not lose the compile-window race.
- Bounded — operation issues flat at 64 (v0.6.5's 62 + 2 for the one v0.6.6
  compile); none of v0.6.5's ~9× verifier-retry churn.

Note: the board still carried cycles 0–8 (the v0.6.5-drill rows 2–7 survived
the non-destructive uninstall — the namespace is plugin-owned). Cosmetic; the
v0.6.6 verdict rests on cycle 8 and the settled pointer.

Phase 03 (daily-bulletin) closure unblocked — BULL-05/06/09.

---

## 2026-05-21 — REGRESSION SURFACED + ROOT CAUSE FOUND + 0.8.4 PASS

**Status:** RESOLVED 2026-05-21 — definitive root cause identified; one-line fix shipped in 0.8.4; operator drill verified.
**Owning plan:** Plan 04.1-11 (cross-phase patch — Phase 3 fix bundled under Phase 4.1 plan numbering for operator-drill efficiency).
**Related memory:** `bulletin-cadence-gate-string-bug.md`.

**The cadence runaway returned** during Eric's Plan 04.1-10 closure work (post-Phase-3 closure, post-Phase-4 closure). At ~10:00 UTC 2026-05-21, Countermoves had ~687 published bulletin issues with `Bulletin No. N — Thursday, 2026-05-21` titles created every ~2 minutes. Same shape as the v0.6.5 drill but on a different week. v0.6.6's two fixes (verifier frozen snapshot + advance-on-every-path) were still in place and working; this was a NEW, latent bug they couldn't have caught.

### Root cause (definitive)

`src/worker/jobs/compile-bulletin.ts:315` used STRING comparison instead of Date comparison:

```ts
if (now.toISOString() < nextDueAtIso) { continue; }
```

- `now.toISOString()` produces `"2026-05-21T09:36:59.000Z"` (with 'T' separator at pos 10)
- Postgres `timestamptz` returns `"2026-05-21 10:30:00+00"` (with space separator at pos 10)
- Lexicographic compare: 'T' (ASCII 84) > ' ' (ASCII 32)
- Same-day timestamps → string compare reverses the chronological relation
- Gate fails every cron tick → fresh compile every minute → unbounded runaway

**Why v0.6.6's closure drill passed:** by the time of the v0.6.6 drill, `next_due_at` had advanced to the next day (06:30 EDT tomorrow, i.e. `2026-05-19 10:30:00+00`), so the day-digit difference at position 9 dominated the lexicographic compare and accidentally produced the correct ordering. v0.6.6 fixed the ADVANCE behavior (which was the original Bug 1 cause); the GATE that READS the advanced value was the latent bug. The v0.6.6 drill ran a CROSS-DAY scenario which accidentally worked; the SAME-DAY scenario reproduced 2026-05-21.

### Fix shipped (Plan 04.1-11, 0.8.4)

Extracted the gate decision into a pure exported helper `isPastDue(now: Date, nextDueAtIso: string): boolean` using Date comparison. The compile-bulletin per-company loop now reads:

```ts
import { isPastDue } from './compile-bulletin.ts';

if (!isPastDue(now, nextDueAtIso)) continue;
```

The helper uses `now.getTime() < new Date(nextDueAtIso).getTime()` — works regardless of source format (ISO-T from JS, space-separator from Postgres). One-line semantic fix; the rest of the per-company loop is byte-identical.

### Verification (Countermoves drill 2026-05-21)

- Pre-install snapshot bookend per the runbook.
- Pushed `next_due_at` to (now + 5 minutes) via psql to FORCE the gate into the same-day-future scenario:

```bash
psql "$DB_URL" -c "UPDATE plugin_clarity_pack_cdd6bda4bd.bulletins SET next_due_at = (now() + interval '5 minutes') WHERE company_id = '...';"
```

- Cron fires every 1 minute; gate held for 4 fires (no-op), released on the 5th fire (compiled cycle 706 at 10:30:55 UTC), `next_due_at` then advanced to the next 06:30-ET slot via the v0.6.6 advance-on-every-path mechanism, and stayed silent for the remainder of the watch window.
- `SELECT COUNT(*) ... WHERE published_at > now() - interval '10 minutes'` → 1.
- **PASS — definitive.**

### Memory + regression tests

- New project memory: `bulletin-cadence-gate-string-bug.md` — captures the string-vs-Date pattern so future plans don't repeat it. Includes the trigger phrase to self ("If I'm comparing two timestamp strings with `<` or `>`, RED FLAG — convert to `Date.getTime()` on both sides.").
- New test: `test/worker/jobs/compile-bulletin-gate.test.mjs` — pins the `isPastDue` helper against both ISO-T and Postgres-space formats, same-day AND cross-day fixtures. Includes the regression-pinning assertion that the OLD string-compare logic was lexicographic and would have produced the WRONG answer for case 1 (same-day-future). 9 cases total.
- Drill-scenario rule established: cron-gate drills MUST explicitly exercise the same-day case. v0.6.6's drill missed this because the drill ran when `next_due_at` was already a different day. Filed in `bulletin-cadence-gate-string-bug.md`.

Both ensure this bug class is detectable at build time, not at the next Phase 3 closure drill.

### Outstanding operator cleanup

**707 stranded `Bulletin No. N — Thursday, 2026-05-21` issues remain on Countermoves** pending DELETE-by-cycle-number cleanup. Eric will run at the keyboard. Intentionally manual to keep the audit trail visible during the diagnosis window. Not blocking Wave 5 closure (the stranded issues do not affect plugin functionality — they just clutter the Issues list).

### Cross-phase notation

This fix is structurally Phase 3 territory (it patches `src/worker/jobs/compile-bulletin.ts`, last modified in Plan 03-10 v0.6.6) but was bundled into Plan 04.1-11 (Phase 4.1) for operator-drill efficiency — Eric ran ONE Countermoves drill verifying both Fix A (cadence) and Fix B (marker classifier allowlist) instead of two separate drills. Plan 04.1-11's SUMMARY frontmatter carries `cross-phase: true` and a dedicated cross-phase note section. Anyone tracing the Phase 3 cadence-runaway history reads the full story end-to-end here without bouncing between Phase 3 and Phase 4.1 directories.
