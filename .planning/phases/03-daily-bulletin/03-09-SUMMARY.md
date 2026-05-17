---
phase: 03-daily-bulletin
plan: 09
subsystem: api
tags: [paperclip-plugin, agent-task-delivery, bulletin-compile, draft-validator, circuit-breaker]

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "Plan 03-08 Option B document-readback architecture (deliverAgentTask reads the agent's compile-result issue document); Plan 03-02 verified-numerics compile pipeline (validateDraftSchema slot resolution, verifyDraft pass-2)"
provides:
  - "validateDraftStructure — an exported structure-only BulletinDraft validator (object + masthead + 4-array key checks; NO slot resolution) extracted from validateDraftSchema"
  - "validateDraftSchema now delegates the structural checks to validateDraftStructure then runs the SAME slot-resolution pass — external behaviour for compilePass1 unchanged"
  - "deliverAgentTask's readback (isResultComment/isResultDocument) re-pointed at validateDraftStructure — an agent draft carrying unresolved {{NUMBER:key}} placeholders now PASSES the readback"
  - "a {{NUMBER:key}} regression fixture in agent-task-delivery.test.mjs that reproduces the 03-08 validator-misuse bug"
  - "version 0.4.0 -> 0.5.0; clarity-pack-0.5.0.tgz packed for the closure re-drill"
affects: [03-daily-bulletin, phase-3-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-tier draft validation: a structure-only core (validateDraftStructure) for the result readback, and a slot-resolving wrapper (validateDraftSchema) for the production compile path — the readback never resolves {{NUMBER:key}} slots, slot resolution + numeric verification stay downstream in compilePass1/verifyDraft"

key-files:
  created: []
  modified:
    - "src/worker/bulletin/compile-pass-1.ts — validateDraftStructure extracted + exported; validateDraftSchema delegates to it then runs the slot-resolution pass; compilePass1's call unchanged"
    - "src/worker/agents/agent-task-delivery.ts — readback re-pointed from validateDraftSchema(parsed, {}) to validateDraftStructure(parsed); import + doc-comment updated"
    - "test/worker/agents/agent-task-delivery.test.mjs — {{NUMBER:key}} regression fixture + assertion that the readback accepts a placeholder-bearing draft"
    - "src/manifest.ts — version 0.5.0"
    - "package.json — version 0.5.0"

key-decisions:
  - "The result readback validates STRUCTURE ONLY — it never resolves {{NUMBER:key}} slots. Slot resolution against the real facts table is a downstream compilePass1 concern; the readback's job is purely 'is this a structurally-valid BulletinDraft JSON object'"
  - "validateDraftSchema keeps its signature (body, facts) and its full slot-resolving behaviour for compilePass1 — it now just delegates the structural checks to validateDraftStructure first; the production publish path is provably unchanged"

patterns-established:
  - "Structure-only vs slot-resolving draft validation split — the readback channel and the publish channel use different validation tiers"

requirements-completed: []  # BULL-05, BULL-06, BULL-09, EDITOR-05, READER-02 — NOT complete; Task 3's closure drill DID NOT PASS

# Metrics
duration: ~25min
completed: 2026-05-17
---

# Phase 3 Plan 09: Readback Structure-Only Validator Gap Closure Summary

**The Option B result readback re-pointed at a new structure-only `validateDraftStructure` validator so an agent's placeholder-bearing `BulletinDraft` document is accepted — PROVEN live on the 2026-05-17 Countermoves drill; Phase 3 closure is blocked by a NEW, unrelated standing-number schema-drift gap routed to Plan 03-10.**

## Performance

- **Duration:** ~25 min (auto Tasks 1-2)
- **Started:** 2026-05-17 (prior execution session)
- **Completed (Tasks 1-2):** 2026-05-17
- **Tasks:** 2 of 3 auto-tasks GREEN (Task 3 is a blocking `checkpoint:human-verify` — RUN by Eric, DID NOT PASS)
- **Files modified:** 5

## Accomplishments

- **Split `validateDraftSchema` into a structural core.** Extracted the object + masthead + four-array (`actionInbox`, `departments`, `standingNumbers`, `lineageThreads`) key checks into a NEW exported `validateDraftStructure(body): asserts body is BulletinDraft` — a pure structural validator that does NOT resolve `{{NUMBER:key}}` slots.
- **Kept `validateDraftSchema` byte-equivalent for `compilePass1`.** It now calls `validateDraftStructure(body)` first, then runs the SAME `replaceSlots` loop against the facts table. Its signature `(body, facts)` and external behaviour are unchanged; `compile-pass-1.ts`'s production call `validateDraftSchema(parsed, args.factsTable)` is untouched.
- **Re-pointed the Option B readback.** `agent-task-delivery.ts` `isResultComment` (which `isResultDocument` delegates to) now calls `validateDraftStructure(parsed)` instead of the bug-causing `validateDraftSchema(parsed, {})`. An agent draft whose `editorialSummary` carries unresolved `{{NUMBER:key}}` placeholders now PASSES the readback. The import + the doc-comment block were updated to remove the now-false "empty facts table" assertion.
- **Added a `{{NUMBER:key}}` regression fixture.** `agent-task-delivery.test.mjs` now feeds a structurally-valid `BulletinDraft` whose `department.editorialSummary` contains a literal `{{NUMBER:key}}` placeholder through the readback and asserts it returns `true`. The 03-08 fixture used `editorialSummary: ''` and never caught the bug — this fixture reproduces it.
- **Bumped 0.4.0 -> 0.5.0** — re-scopes the durable circuit breaker past stale `0.4.0` failure history; `npm pack` produced `clarity-pack-0.5.0.tgz`.

## Task Commits

Each auto-task was committed atomically:

1. **Task 1: Split `validateDraftSchema` into a structure-only core, re-point the readback, add a `{{NUMBER:key}}` regression fixture** — `c2b55b9` (feat)
2. **Task 2: Bump version 0.4.0 -> 0.5.0, rebuild artifacts, pack `clarity-pack-0.5.0.tgz`** — `b43f249` (chore)
3. **Task 3: Eric's Countermoves closure re-drill** — `checkpoint:human-verify`, blocking — RUN 2026-05-17, **DID NOT PASS** (see below).

## Files Created/Modified

- `src/worker/bulletin/compile-pass-1.ts` — `validateDraftStructure` extracted + exported (object/masthead/4-array checks, no slot resolution); `validateDraftSchema` rewritten to `validateDraftStructure(body)` + the unchanged `replaceSlots` slot-resolution loop; `compilePass1`'s `validateDraftSchema(parsed, args.factsTable)` call left exactly as-is.
- `src/worker/agents/agent-task-delivery.ts` — import changed `validateDraftSchema` -> `validateDraftStructure`; `isResultComment` calls `validateDraftStructure(parsed)`; doc-comment rewritten to state the readback checks SHAPE ONLY and never resolves slots.
- `test/worker/agents/agent-task-delivery.test.mjs` — readback fixture now carries a `{{NUMBER:key}}` placeholder in a `department.editorialSummary`; explicit assertion that the readback accepts a placeholder-bearing draft.
- `src/manifest.ts` — `version: '0.5.0'` (+ version comment referencing the Plan 03-09 readback fix).
- `package.json` — `"version": "0.5.0"`.

## Suite Delta

- Baseline (Plan 03-08): 689 tests / 687 pass / 0 fail / 2 skip.
- After Plan 03-09: **690 tests / 688 pass / 0 fail / 2 skip** (+1 — the `{{NUMBER:key}}` readback regression test).

## Build + Pack

- All three artifacts rebuilt (`build-worker.mjs`, `build-ui.mjs`, `tsc --project tsconfig.manifest.json`) — clean.
- `npm pack` -> **`clarity-pack-0.5.0.tgz`**.
  - **sha256: `e687615287c65ab65a43356a64983d949dc4eb69fc4ff3b59aa5dadb4785f113`**

## Decisions Made

- **The readback validates structure only.** Slot resolution (`replaceSlots`) belongs downstream in `compilePass1` where the REAL facts table exists; the readback's only job is "is this a structurally-valid `BulletinDraft` JSON object". Resolving slots against an empty facts table (the 03-08 bug) is incorrect at the readback stage.
- **`validateDraftSchema` keeps its full behaviour for `compilePass1`.** Splitting the validator did NOT change the production publish path — `validateDraftSchema` still resolves `{{NUMBER:key}}` slots against `args.factsTable`, and `verifyDraft` pass-2 still re-verifies every numeric before publish.

## Deviations from Plan

None — auto Tasks 1-2 executed exactly as written.

## Issues Encountered

None during the auto-task build. The Task 3 closure drill surfaced a new gap (below) — that is the drill working as designed, not an issue in the planned work.

## Task 3 — Closure Re-Drill: DID NOT PASS

Task 3 is `checkpoint:human-verify` with `gate="blocking"`. Eric ran it on the live Countermoves Hostinger instance, 2026-05-17. **VERDICT: DID NOT PASS — but Plan 03-09's objective is met.**

**Build drilled:** `clarity-pack-0.5.0.tgz` (sha256 `e687615287c65ab65a43356a64983d949dc4eb69fc4ff3b59aa5dadb4785f113`). Installed clean — `pnpm paperclipai plugin list` → `status=ready version=0.5.0 id=0d4fc40a-0541-4b67-8979-9d346cb9c07b`. Pre-drill bookend: snapshot `2026-05-17T07-02-14Z` (postgres.dump 2.98 MB + instance-fs.tar.gz 144 MB, sha256-verified) — recorded snapshot-only practice (Eric's standing choice for Phase 2/3 drills). The plan's `DELETE … WHERE plugin_version='0.4.0'` cleanup returned `DELETE 0` — there were no `0.4.0` rows; the plan mis-scoped the cleanup, harmless.

**PROVEN — Plan 03-09's readback fix works live.** v0.5.0 ran three real `compile-bulletin` runs (07:15, 07:17, 07:19 UTC). The worker log at 07:19:43 shows the structure-only readback ACCEPTING the agent's placeholder-bearing `BulletinDraft` document:

> `[plugin] agent-task-delivery: result DOCUMENT received on operation issue 35c023f5-a6c0-4e5e-9ade-ba652d9839fa (key=compile-result)`

No ~36×-rejection poll loop, no `deliverAgentTask` 300s timeout. The v0.4.0 readback validator-misuse bug — the entire reason Plan 03-09 existed — is **DEAD**. **Tasks 1-2 are GREEN and the readback channel is proven on the live instance.**

**FAILED — a NEW, unrelated gap blocks Phase 3 closure: standing-number schema drift.** Immediately after the draft was accepted, `verifyDraft` pass-2 ran its 5 standing-number `ctx.db.query` calls and ALL FIVE failed at the Paperclip host RPC layer (`ERROR: host handler error {method: "db.query"}`):

- `mrr` — `column "active_subscription_cents" does not exist`
- `briefs_sent_week`, `reply_rate_7d`, `discoveries_7d`, `refund_rate_30d` — `column "tags" does not exist`

The standing-number SQL (`src/worker/bulletin/standing-numbers.ts`, and almost certainly `src/worker/bulletin/facts-table.ts`) references columns that do not exist in the live Paperclip schema — `active_subscription_cents` and an `issues.tags` column are both invented/wrong. `editor_agent_failures` recorded three `plugin_version='0.5.0'` rows (id 529 `consecutive 1`, id 530 `consecutive 2`, id 531 `consecutive 3` — the third with all 5 slots `"actual":"query_failed"`); the breaker tripped at `consecutive=3` and paused the Editor-Agent. No `Bulletin No. N` issue published; `bulletins` still holds only the bootstrap `cycle_number 0`.

**Why the local suite missed it.** The 690-test suite is green because the host-faithful fakes return canned `db.query` results — they never execute the standing-number SQL against a real Paperclip schema. Same "green local suite ≠ live host behaviour" anti-pattern that hid the 03-08 validator-misuse.

**Routing:** the standing-number schema-drift gap → gap-closure **Plan 03-10** — correct the standing-number / facts-table SQL to match Paperclip's actual schema (discover real columns via `\d` on the live tables; a `gsd-debugger` pass against the live schema is the natural first step), re-pack, re-drill. The Option B document-handoff (03-08) + the structure-only readback (03-09) are FULLY PROVEN and must NOT be re-opened. Full write-up: `.planning/debug/bulletin-compile-agent-heartbeat-gap.md` (Plan 03-09 closure re-drill section).

## User Setup Required

None — no external service configuration.

## Next Phase Readiness

- Auto Tasks 1-2 complete and GREEN — the structure-only readback is proven live on Countermoves.
- **Phase 3 is NOT closed.** Task 3's closure drill DID NOT PASS — blocked by the standing-number schema-drift gap, not the readback. A planner must create gap-closure Plan 03-10 (standing-number / facts-table `ctx.db.query` schema-drift fix).
- Phase 3 closes only when a future plan's live Countermoves drill publishes a `Bulletin No. N` issue end-to-end.

## Self-Check: PASSED

- `03-09-SUMMARY.md` — FOUND.
- Commit `c2b55b9` (Task 1) — FOUND in git history.
- Commit `b43f249` (Task 2) — FOUND in git history.
- `src/worker/bulletin/compile-pass-1.ts` — FOUND (modified in `c2b55b9`).
- `src/worker/agents/agent-task-delivery.ts` — FOUND (modified in `c2b55b9`).
- `clarity-pack-0.5.0.tgz` — built artifact (gitignored); sha256 recorded above.

---
*Phase: 03-daily-bulletin*
*Completed (Tasks 1-2): 2026-05-17 — Task 3 closure re-drill DID NOT PASS; routed to gap-closure Plan 03-10*
