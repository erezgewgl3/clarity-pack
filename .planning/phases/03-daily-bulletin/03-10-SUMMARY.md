---
phase: 03-daily-bulletin
plan: 10
subsystem: api
tags: [paperclip-plugin, bulletin-compile, standing-numbers, schema-drift, verifier, gap-closure]

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "Plan 03-02 verified-numerics compile pipeline (STANDING_NUMBER_SLOTS registry, computeStandingNumbers, verifyDraft pass-2); Plan 03-09 structure-only readback (validateDraftStructure) — both proven live on the 2026-05-17 drill"
provides:
  - "STANDING_NUMBER_SLOTS rewritten with 5 agent-operations slots (open_issues, completed_7d, blocked_issues, agent_spend_mtd, budget_used_pct) whose SQL uses only columns verified present in the live Paperclip schema (03-10-SCHEMA-FINDINGS.md §2)"
  - "verifyDraft pass-2 fixed automatically — it re-runs slotDef.sql by key from the same STANDING_NUMBER_SLOTS array"
  - "cents->dollars currency-format fix in the agent_spend_mtd slot (SQL divides by 100.0 so facts-table formatFact's currency Intl formatter is correct)"
  - "version 0.5.0 -> 0.6.0; clarity-pack-0.6.0.tgz packed for the closure re-drill"
affects: [03-daily-bulletin, phase-3-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standing-number slot SQL is column-bound to a live-introspected schema reference (03-10-SCHEMA-FINDINGS.md §2) — no column may be used that is not confirmed present by a live `\\d` query; the registry SHAPE (5 slots, parameterized SQL, format, displayName) is the locked contract while the specific numbers are planner's discretion per 03-CONTEXT.md line 92"

key-files:
  created: []
  modified:
    - "src/worker/bulletin/standing-numbers.ts — STANDING_NUMBER_SLOTS array fully rewritten (5 agent-operations slots); header NOTE + doc-comment updated; computeStandingNumbers/StandingNumbersCtx/imports unchanged"
    - "test/worker/bulletin/standing-numbers.test.mjs — ordered + sorted key assertions repointed to the 5 new keys"
    - "test/worker/bulletin/verifier.test.mjs — fixtures repointed: mrr->agent_spend_mtd (currency), reply_rate_7d->budget_used_pct (pct); mismatch slot assertions updated"
    - "test/worker/bulletin/compile-bulletin-end-to-end.test.mjs — cannedDraft param mrr->spend, slot key -> agent_spend_mtd, comment reworded"
    - "test/worker/bulletin/bulletin-by-cycle-handler.test.mjs — stub draft slot key -> agent_spend_mtd"
    - "test/worker/agents/agent-task-delivery.test.mjs — readback fixture slot key -> agent_spend_mtd ({{NUMBER:key}} regression fixture untouched)"
    - "test/helpers/host-faithful-ctx.mjs — helper cannedDraft slot key -> agent_spend_mtd (verifier no longer UNKNOWN_SLOT-rejects the canned draft)"
    - "src/manifest.ts — version 0.6.0; comment rewritten to explain the breaker re-scope past stale 0.5.0 failure rows"
    - "package.json — version 0.6.0"

key-decisions:
  - "The 5 Standing Numbers were a CRM/SaaS-business model (MRR, cold-email reply rate, discoveries, refunds); Paperclip is an agent-orchestration platform with no customer/revenue/sales data. The pivot to agent-operations metrics (open/completed/blocked issues, agent spend MTD, budget used MTD) is dictated by the schema, not a product choice — sanctioned by 03-CONTEXT.md line 92 (numbers are TBD per real core tables; only the SHAPE + BULL-05 are locked)"
  - "verifyDraft's strict reject-on-query_failed behaviour is NOT weakened — the fix is correct columns, not laxer verification (BULL-05/06: a wrong/unverifiable number must never publish)"
  - "agent_spend_mtd SQL converts cents->dollars (/ 100.0) — the old mrr slot passed raw cents into facts-table formatFact's dollar Intl formatter, a latent x100 error; the conversion is the fix and is kept exactly"
  - "compile-pass-1.ts buildPrompt needed NO edit — the facts table and standing numbers are injected as JSON DATA (JSON.stringify), so the new keys flow through automatically; the static prompt prose names no specific CRM number"

patterns-established:
  - "Live-schema-bound SQL: standing-number slot SQL is verified against a live `\\d` introspection capture (03-10-SCHEMA-FINDINGS.md), never extrapolated from the host repo or a CRM mental model"

requirements-completed: []  # BULL-05, BULL-06 — code fix landed; NOT verified complete until Task 4's live closure drill PASSES

# Metrics
duration: ~9min (autonomous Tasks 1-3)
completed: 2026-05-17
---

# Phase 03 Plan 10: Standing-Number Schema-Drift Fix Summary

**One-liner:** Rewrote `STANDING_NUMBER_SLOTS` from a CRM/SaaS-business model (MRR, cold-email reply rate, refunds — all referencing columns that do not exist in Paperclip) to 5 agent-operations metrics whose SQL is column-verified against a live `\d` introspection of the Countermoves Paperclip schema, fixing the standing-number gap that blocked the Plan 03-09 closure drill.

## What Was Built

### Task 1 — STANDING_NUMBER_SLOTS rewrite (commit `17b1340`)

The old 5 slots referenced invented columns and failed every `verifyDraft` pass-2 `ctx.db.query` on the 03-09 live drill (`active_subscription_cents`, `issues.tags`, `issue_comments.author_role` — none exist in Paperclip's schema). Replaced with 5 agent-operations slots, every column verified present in `03-10-SCHEMA-FINDINGS.md §2`:

| key | displayName | format | SQL (`$1` = companyId) |
|---|---|---|---|
| `open_issues` | Open issues | `count` | `SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status NOT IN ('done','cancelled') AND hidden_at IS NULL` |
| `completed_7d` | Issues completed · 7d | `count` | `SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'done' AND completed_at >= now() - interval '7 days'` |
| `blocked_issues` | Blocked · awaiting action | `count` | `SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'blocked' AND hidden_at IS NULL` |
| `agent_spend_mtd` | Agent spend · MTD | `currency` | `SELECT ROUND(COALESCE(spent_monthly_cents,0) / 100.0)::bigint AS value FROM public.companies WHERE id = $1` |
| `budget_used_pct` | Budget used · MTD | `pct` | `SELECT CASE WHEN COALESCE(budget_monthly_cents,0) = 0 THEN 0 ELSE spent_monthly_cents::numeric / budget_monthly_cents::numeric END AS value FROM public.companies WHERE id = $1` |

- `verifyDraft` (pass-2) re-runs `slotDef.sql` by key from this same array — fixing the array fixes the verifier automatically (no `bulletin-verifier.ts` change needed).
- T-03-10 SQL-injection invariant preserved: every `sql` is a static module-constant string, `$1` (companyId) the sole bound param, no template literals. The source-grep test's `/\$\{[^}]*\}/` assertion still passes.
- Cents->dollars currency-bug fix: `agent_spend_mtd` SQL divides by `100.0` so `facts-table.ts` `formatFact`'s `'currency'` Intl formatter receives dollars (the old `mrr` slot passed raw cents — a latent x100 error).
- `computeStandingNumbers`, `StandingNumbersCtx`, imports, exported signatures unchanged.

### Task 2 — test-fixture repoint (commit `f80e4c2`)

Repointed every test/helper keyed to an old slot name to the new keys (by format: `mrr`->`agent_spend_mtd` currency, `reply_rate_7d`->`budget_used_pct` pct):

- `standing-numbers.test.mjs` — ordered + sorted key arrays.
- `verifier.test.mjs` — fixtures + `result.mismatches[0].slot` assertions. UNKNOWN_SLOT `'foo'` test untouched.
- `compile-bulletin-end-to-end.test.mjs` — `cannedDraft` param `mrr`->`spend`, slot key, comment.
- `bulletin-by-cycle-handler.test.mjs`, `agent-task-delivery.test.mjs` — stub draft slot keys (the Plan 03-09 `{{NUMBER:key}}` regression fixture left untouched).
- `test/helpers/host-faithful-ctx.mjs` — helper `cannedDraft` slot key (an out-of-scope discovery: this helper drives 3 host-faithful happy-path tests; without the fix the verifier `UNKNOWN_SLOT`-rejected the canned draft and no bulletin published — caught by the suite, fixed inline as a Rule-3 blocking-issue fix; see Deviations).

**`compile-pass-1.ts` `buildPrompt` — checked, NO edit needed.** The facts table and standing numbers are injected as JSON DATA (`JSON.stringify(args.factsTable)`, `JSON.stringify(args.standingNumbers)`); the new keys flow through automatically. The static prompt prose names no specific CRM number (`mrr`/`MRR`/`briefs`/`reply rate`/`discoveries`/`refund`) — confirmed by reading lines 213-230. `compile-pass-1.ts` was therefore not modified.

**Suite delta:** 690 tests, 688 pass / 0 fail / 2 skip — count unchanged (this task changed fixture values, not test count), exactly as the plan predicted.

### Task 3 — version bump + rebuild + pack (commit `b4a1a9e`)

- `src/manifest.ts` + `package.json` version `0.5.0` -> `0.6.0`. Manifest comment rewritten to explain the bump: `circuit-breaker.ts` `CLARITY_PACK_VERSION` stamps this version on `editor_agent_failures` rows; the bump re-scopes the durable breaker past the 3 stale `plugin_version='0.5.0'` failure rows (ids 529-531) the 03-09 drill left, so the breaker starts clean for the 03-10 re-drill.
- All 3 artifacts rebuilt (all exit 0): `dist/worker.js` (176.0 KB), `dist/ui/index.js` (105.1 KB), `dist/manifest.js` (verified carries `version: '0.6.0'`).
- `npm pack` -> **`clarity-pack-0.6.0.tgz`** — **sha256 `9101d3575b298efb0801cccadf6785a73b911dd1c1372887340280fa396df3e2`** (npm shasum / package size 70.1 kB / 9 files).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `test/helpers/host-faithful-ctx.mjs` `cannedDraft` keyed to the old `mrr` slot**
- **Found during:** Task 2 (first full `node --test` run after the 5 listed test files were updated)
- **Issue:** 3 host-faithful happy-path tests (`compile-bulletin-host-faithful.test.mjs` cases 1, bootstrap-end-to-end, write-via-query) failed — the shared helper `host-faithful-ctx.mjs` has its own `cannedDraft` whose `standingNumbers` entry still used `key: 'mrr'`. After Task 1, `mrr` is no longer a real slot, so `verifyDraft` returned `{ok:false, kind:'UNKNOWN_SLOT'}` and the compile never published.
- **Fix:** Repointed the helper's `cannedDraft` slot key `mrr`->`agent_spend_mtd` (param `mrr`->`spend`), the same currency-format mapping the plan prescribed for the 5 listed files. The plan named 5 test files explicitly but the host-faithful helper is a 6th, transitively keyed to the old slot name; fixing it is squarely within Task 2's intent ("every test keyed to the old slot names").
- **Files modified:** `test/helpers/host-faithful-ctx.mjs`
- **Commit:** `f80e4c2`

### Plan-text vs verify-text note (not a deviation)

Task 3's `<verify>` says "grep `src/manifest.ts` for `0.5.0` -> 0 matches", but the same task's `<action>` explicitly directs the manifest comment to reference the stale `plugin_version='0.5.0'` failure rows and the `0.5.0 -> 0.6.0` bump. The `<action>` wins: the `version:` field is `0.6.0`; the 2 remaining `0.5.0` strings are intentional descriptive comment text naming the rows being re-scoped past. Recorded here for the verifier so it is not flagged as an unmet criterion.

## Task 4 — Closure Re-Drill: DID NOT PASS (2026-05-17)

Task 4 is a `checkpoint:human-verify` with `gate="blocking"`. Eric ran the live Countermoves Hostinger Paperclip drill on 2026-05-17: pre-drill snapshot `2026-05-17T09-25-46Z` taken (DB dump + 156 MB FS tar, at `~/clarity-pack/.planning/snapshots/`), `clarity-pack-0.6.0.tgz` installed (`status=ready version=0.6.0`, plugin id `0d4fc40a-0541-4b67-8979-9d346cb9c07b`), `compile-bulletin` job fired.

**Verdict:** DID NOT PASS — no `Bulletin No. N` published; `bulletins` remains `cycle_number=0 / compile_status=pending`.

**What the drill PROVED (Plan 03-10's actual goal — achieved):** the schema-verified `STANDING_NUMBER_SLOTS` SQL now *executes* against the live schema. Pass-1 produced real values (`open_issues=2, completed_7d=17, blocked_issues=0, agent_spend_mtd=0, budget_used_pct=0`) with NO `column does not exist` / `host handler error`. The standing-number schema-drift gap is closed.

**NEW gap surfaced — `BULLETIN-VERIFIER-COUNTS-OWN-OPERATION-ISSUE`:** `editor_agent_failures` rows 532–534 (`plugin_version=0.6.0`, consecutive 1→3, breaker tripped → Editor-Agent paused) all read:
`verifier rejected: [{"slot":"open_issues","claimed":2,"actual":3,"tolerance":0}]`

Root cause — the bulletin-compile pipeline counts its own dispatch issue:
1. Pass-1 computes `open_issues` → 2 (before the operation issue exists), freezes it into the agent prompt.
2. The worker creates the `Compile Daily Bulletin` operation issue (e.g. COU-21) — itself an open `public.issues` row → 3.
3. The agent writes the `compile-result` document, *then* marks the operation issue done. The worker's readback fires on the document (written before the issue is marked done), so pass-2 re-runs the `open_issues` SQL while the operation issue is still open → 3.
4. `verifyDraft` `count`-format slots have `tolerance: 0` (confirmed `src/worker/bulletin/bulletin-verifier.ts` — only `pct` gets ±1pp, `ratio` ±0.01) → `claimed 2 ≠ actual 3` → hard reject, every cycle.

This bug was masked before Plan 03-10: while the SQL threw `query_failed`, pass-2 never reached the number comparison. Fixing the columns let pass-2 run far enough to expose that `open_issues` is a moving target the compiler races against itself.

**Routed to gap-closure Plan 03-11:** exclude clarity-pack operation issues from the issue-counting standing-number SQL (`open_issues`; review `completed_7d` / `blocked_issues`) — correct on the merits (a user "Open issues" count must not include the compiler's own plumbing) and removes the self-race. Open question for the planner: whether `count` slots also need a small tolerance for the residual case of a real issue created mid-compile. Needs a quick live schema check on how operation issues are identifiable in `public.issues` (the `issues.tags` column does not exist per 03-10-SCHEMA-FINDINGS §2).

**Phase 3 remains OPEN.** BULL-05/06 schema-drift code fix landed and is proven live; BULL-09 closure still blocked by the verifier-count gap above.

## Self-Check: PASSED

- FOUND: `src/worker/bulletin/standing-numbers.ts` (STANDING_NUMBER_SLOTS rewritten)
- FOUND: `clarity-pack-0.6.0.tgz` (sha256 `9101d3575b298efb0801cccadf6785a73b911dd1c1372887340280fa396df3e2`)
- FOUND commit `17b1340` — feat(03-10): rewrite STANDING_NUMBER_SLOTS with schema-verified columns
- FOUND commit `f80e4c2` — test(03-10): repoint standing-number fixtures to the 5 schema-verified keys
- FOUND commit `b4a1a9e` — chore(03-10): bump version 0.5.0 -> 0.6.0 and pack clarity-pack-0.6.0.tgz
