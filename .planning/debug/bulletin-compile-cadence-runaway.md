---
slug: bulletin-compile-cadence-runaway
status: investigating
trigger: v0.6.5 closure re-drill (2026-05-18) — compile-bulletin re-fires every ~2 min and publishes a new cycle each time, unbounded; verifier tolerance:0 rejects ~half of attempts
created: 2026-05-18
updated: 2026-05-18
phase: 03-daily-bulletin
related_sessions:
  - tldr-heartbeat-recursion.md (v0.6.5 — its two fixes PROVEN LIVE on this same drill; this is a NEW, separate blocker)
note: surfaced by the v0.6.5 live drill on Countermoves; root cause not yet pinned — this is the v0.6.6 work
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
