---
phase: 2
plan: 02-04
plan_name: situation-room-optin-coexistence-ci
status: TASKS_1_2_3_COMPLETE — Task 4 (manual rehearsal) AWAITING_HUMAN
completed_date_partial: 2026-05-14T15:39Z
wave: 4
type: execute
depends_on: ["02-03"]
autonomous: false  # Task 4 is checkpoint:human-verify

dependency_graph:
  requires:
    - "Plan 02-02 (scaffold + primitives: usePoll, ClaritySurfaceRoot, StatePill)"
    - "Plan 02-03 (Editor-Agent + Reader: PauseBanner, EDITOR_AGENT_KEY, tldr_cache)"
    - "Plan 02-03c (useResolvedCompanyId hook)"
    - "Plan 02-01 SMOKE-FINDINGS.md Check F (FALLBACK pattern locked)"
    - "Plan 02-01 SMOKE-FINDINGS.md Finding #4 (deterministic plugin namespace)"
    - "Plan 02-03b API-SHAPES.md (real SDK shapes — no host field on PluginContext)"
  provides:
    - "wrapDataHandler / wrapActionHandler + EXEMPT_HANDLER_KEYS — server-side OPTIN-04 gate for every future handler in Phase 3 / Phase 4"
    - "useOptIn() hook — UI gate primitive every future surface must call before rendering data"
    - "EnableClarityCta — drop-in inline CTA component"
    - "useInstanceConfig — FALLBACK pattern for any future host-config consumer in Phase 3 / Phase 4"
    - "useLeaderElection + usePollWithLeader + createLeaderBroadcast — BroadcastChannel leader-election + follower postMessage bridge (Phase 4 Chat may swap to usePluginStream but the pattern is documented)"
    - "Situation Room page — second user-facing surface; proves the 02-02 primitives generalise beyond Reader"
    - "scripts/coexistence-checks/{01..06}.mjs + run-all.mjs — six COEXIST-01..06 assertions ready to extend in Phase 3/4"
    - ".github/workflows/coexistence.yml — CI workflow gating every PR"
    - "Plan 02-04 conventions doc (see § Conventions Established below)"
  affects:
    - "All existing 02-02/02-03 handlers (resolve-refs / flatten-blocker-chain / issue-reader / ac-checklist / editor-pause-status) now route through opt-in-guard"
    - "ReaderView now calls useOptIn() BEFORE the companyId resolver"

tech_stack:
  added:
    - "BroadcastChannel API (native browser; SDK does not wrap; fallback path documented for older runtimes)"
    - "PluginConfigClient via ctx.config.get() — used by get-instance-config handler"
    - "PluginJobsClient via ctx.jobs.register() — used by the 60s recompute-situation cron"
  patterns:
    - "Opt-in-guard wrap: every non-exempt data/action handler is registered via wrapDataHandler / wrapActionHandler instead of ctx.data.register / ctx.actions.register directly."
    - "Ctx composition: handlers compose their Ctx type from OptInGuardDataCtx / OptInGuardActionCtx (which are themselves composed from real SDK clients) — NO narrow local Ctx interfaces (02-04 critical blocking anti-pattern)."
    - "userId/companyId pass-through: UI reads useHostContext() and threads userId + companyId into usePluginData/usePluginAction params. Worker handlers read params.userId / params.companyId — never a fictional ctx.host.* path (02-03b §5)."
    - "Two-tab leader election: BroadcastChannel; lowest UUID wins; 10s re-announce loop; explicit fallback when BroadcastChannel is undefined."
    - "Follower postMessage bridge: leader broadcasts {kind:'leader-data', payload}; followers consume via channel.onmessage. Pure createLeaderBroadcast helper is unit-testable without React."
    - "useInstanceConfig FALLBACK: SDK does not export useInstanceConfig at 2026.512.0. We ship a thin wrapper around usePluginData('clarity-pack/get-instance-config'); the matching worker handler reads ctx.config.get()."
    - "Coexistence CI: six standalone Node scripts, one per assertion; comment-aware (SQL line + block comments stripped) so doc-comments do not trigger false positives."

key_files:
  created:
    - path: "migrations/0003_situation_and_optin.sql"
      role: "situation_snapshots + active_viewers tables (Task 2); idempotent guard for clarity_user_prefs (Task 1)."
    - path: "src/worker/opt-in-guard.ts"
      role: "wrapDataHandler / wrapActionHandler + EXEMPT_HANDLER_KEYS — OPTIN-04 server-side enforcement."
    - path: "src/worker/handlers/get-opt-in.ts"
      role: "Reads caller's clarity_user_prefs row; absence-of-row = opted-OUT default (OPTIN-01)."
    - path: "src/worker/handlers/set-opt-in.ts"
      role: "Writes ONLY params.userId row; OPTIN-03 attack model verified by test (caller cannot spoof targetUserId)."
    - path: "src/worker/handlers/get-instance-config.ts"
      role: "ctx.config.get() reader for the FALLBACK useInstanceConfig pattern."
    - path: "src/worker/handlers/situation-room.ts"
      role: "'situation.snapshot' data handler; reads most-recent row for caller's company; opt-in-guard-wrapped."
    - path: "src/worker/handlers/active-viewer-ping.ts"
      role: "'situation.active-viewer-ping' action; UPSERTs active_viewers row; ROOM-05 gating signal for the 60s job."
    - path: "src/worker/jobs/situation-snapshot.ts"
      role: "60s recompute-situation job; no-op when no active viewers; deterministic blocker_chain via PRIM-03 flattenBlockerChain."
    - path: "src/ui/primitives/use-opt-in.ts"
      role: "Hook: returns {optedIn, loading, toggle}; reads userId from useHostContext."
    - path: "src/ui/primitives/use-instance-config.ts"
      role: "FALLBACK wrapper; usePluginData('clarity-pack/get-instance-config'); LOCKED per 02-01 Check F."
    - path: "src/ui/primitives/use-leader-election.ts"
      role: "BroadcastChannel leader election with fallback for missing BC."
    - path: "src/ui/primitives/use-poll-with-leader.ts"
      role: "Wraps usePoll + useLeaderElection; follower postMessage bridge; pure createLeaderBroadcast helper exported."
    - path: "src/ui/components/enable-clarity-cta.tsx"
      role: "Inline OPTIN-02 'Enable Clarity Pack' CTA."
    - path: "src/ui/surfaces/settings/index.tsx"
      role: "Per-user opt-in toggle; replaces 02-02 settings-stub."
    - path: "src/ui/surfaces/situation-room/index.tsx"
      role: "Main page: useOptIn gate → useResolvedCompanyId → useInstanceConfig → usePollWithLeader + usePluginData → CriticalPathStrip + AgentGrid + ArtifactsShelf + PauseBanner."
    - path: "src/ui/surfaces/situation-room/{agent-card,critical-path-strip,artifacts-shipped-shelf,awaiting-you-pill,sparkline}.tsx"
      role: "Sub-components matching sketches/paperclip-fix-situation-room.html layout."
    - path: "scripts/coexistence-checks/{01..06}.mjs + run-all.mjs"
      role: "COEXIST-01..06 assertions (CI workflow)."
    - path: ".github/workflows/coexistence.yml"
      role: "CI runs all six checks + the negative-case test on every PR + push."
    - path: "test/fixtures/coexistence/bad-public-ddl.sql + bad-unscoped-css.css"
      role: "Negative-case fixtures asserted by test/ci/coexistence-checklist.test.mjs."
  modified:
    - path: "src/manifest.ts"
      role: "Added jobs.schedule capability; instanceConfigSchema.situationRefreshIntervalMs (D-03); jobs[] with recompute-situation cron."
    - path: "src/worker.ts"
      role: "Registers exempt handlers FIRST (get-opt-in / set-opt-in / get-instance-config), then wrapped handlers, then Task-2 Situation Room handlers + job."
    - path: "src/worker/handlers/{ac-checklist,editor-pause-status,flatten-blocker-chain,issue-reader,resolve-refs}.ts"
      role: "Every existing handler now uses wrapDataHandler / wrapActionHandler; Ctx composed from OptInGuardDataCtx / OptInGuardActionCtx (real SDK shapes)."
    - path: "src/ui/index.tsx"
      role: "Promoted SettingsPage + SituationRoom from stubs."
    - path: "src/ui/surfaces/reader/index.tsx"
      role: "useOptIn() gate added BEFORE the companyId resolver."
    - path: "test/worker/{issue-reader,issue-reader-integration,resolve-refs}.test.mjs"
      role: "Threaded userId through handler params; mock db.query returns an opted-in clarity_user_prefs row so the wrap forwards."

decisions:
  - id: "D-02-04-01"
    statement: "Handlers read userId from params, NOT from a fictional ctx.host.currentUserId."
    rationale: "SDK 2026.512.0 PluginContext has no `host` field (types.d.ts:1292-1345 + 02-03b API-SHAPES §5). The plan text used the fictional shape; following it would have produced eight more silent failures matching the 02-03 drill. Documented in opt-in-guard.ts header + every handler's Ctx comment."
    impact: "Permanent UI contract: every Clarity surface that calls usePluginData / usePluginAction MUST pass {userId, ...other params}."
  - id: "D-02-04-02"
    statement: "Ctx types compose from real SDK interface types (OptInGuardDataCtx, etc.); no narrow inline Ctx shapes."
    rationale: "Plan 02-04's critical_blocking_anti_pattern guard. The 02-03 'eight SDK shape drifts' all came from handlers redeclaring narrow local Ctx types that lied about the SDK. This plan eliminates that escape hatch."
    impact: "Every new handler in Phase 3/4 must follow the same composition pattern; CI / typecheck enforce."
  - id: "D-02-04-03"
    statement: "useInstanceConfig is a local FALLBACK wrapper (option b), not an SDK re-export (option a)."
    rationale: "Locked by 02-01 SMOKE-FINDINGS.md Check F (FALLBACK REQUIRED). SDK 2026.512.0 does not export useInstanceConfig at any subpath. Verified against node_modules/@paperclipai/plugin-sdk/dist/ui/hooks.d.ts (no match)."
    impact: "Phase 3 (Bulletin) and Phase 4 (Chat) use the same wrapper if they need host config."
  - id: "D-02-04-04"
    statement: "Coexistence CI checks strip SQL comments before grepping for forbidden patterns."
    rationale: "Initial COEXIST-03 run failed against the clean tree because 0002_tldrs_and_editor.sql contains a doc-comment listing 'drop table' as part of describing the host validator's keyword set. Comments are documentation; the rule applies to executable SQL only."
    impact: "Future migrations may freely document the forbidden keywords in -- or /* ... */ comments."
  - id: "D-02-04-05"
    statement: "instanceConfigSchema ships as JSON Schema (Record-of-properties), not Zod."
    rationale: "PaperclipPluginManifestV1.instanceConfigSchema typechecks against JsonSchema (Record<string, unknown>). The SDK's docstring suggests Zod for authoring-side validation; the manifest itself carries the JSON-schema form."
    impact: "Phase 3 Bulletin / Phase 4 Chat that add config fields use the same plain-object shape."

metrics:
  start_time: "2026-05-14T15:08:43Z"
  end_time_tasks_1_2_3: "2026-05-14T15:39:45Z"
  duration_minutes_tasks_1_2_3: 31
  task_4_status: "AWAITING_HUMAN — Phase 2 closure manual rehearsal against local Paperclip clone"
  commits:
    - hash: "0eabd63"
      message: "test(02-04): Task 1 RED — opt-in gate contracts (5 new test files)"
    - hash: "3a8a6aa"
      message: "feat(02-04): Task 1 GREEN — opt-in gate end-to-end (OPTIN-01..05)"
    - hash: "05dcb88"
      message: "test(02-04): Task 2 RED — Situation Room contracts (5 new test files)"
    - hash: "25a4ea7"
      message: "feat(02-04): Task 2 GREEN — Situation Room (ROOM-01..08)"
    - hash: "81cf2ab"
      message: "test(02-04): Task 3 RED — coexistence CI checklist (6 checks + fixtures)"
    - hash: "11d0680"
      message: "feat(02-04): Task 3 GREEN — coexistence CI workflow (COEXIST-06)"
  test_count:
    pre_plan: 141
    post_tasks_1_2_3: 266
    delta: 125  # +54 (Task 1) + 48 (Task 2) + 23 (Task 3)
  files_changed:
    created: 28
    modified: 12

requirements_addressed:
  - id: "OPTIN-01"
    artifact: "migrations/0001_init.sql (clarity_user_prefs PK user_id) + src/worker/handlers/get-opt-in.ts returns optedInAt:null when no row"
  - id: "OPTIN-02"
    artifact: "src/ui/primitives/use-opt-in.ts + src/ui/components/enable-clarity-cta.tsx + ReaderView+SituationRoom call useOptIn before rendering data"
  - id: "OPTIN-03"
    artifact: "src/worker/handlers/set-opt-in.ts reads userId from params only; test asserts spoofed targetUserId/forUser fields are ignored"
  - id: "OPTIN-04"
    artifact: "src/worker/opt-in-guard.ts wraps every non-exempt handler; returns {error:'OPT_IN_REQUIRED'} for opted-out callers"
  - id: "OPTIN-05"
    artifact: "src/ui/surfaces/settings/index.tsx contains literal 'default landing' copy; default_landing column defaults to 'classic'"
  - id: "ROOM-01"
    artifact: "src/ui/surfaces/situation-room/agent-card.tsx + index.tsx renders one AgentCard per snapshot.employees row"
  - id: "ROOM-02"
    artifact: "src/ui/surfaces/situation-room/critical-path-strip.tsx; the 60s job's pickTopChains() caps at 3"
  - id: "ROOM-03"
    artifact: "AgentCard renders StatePill+age, now-doing line, blocker_chain terminal, latest_artifact preview, Sparkline"
  - id: "ROOM-04"
    artifact: "src/ui/surfaces/situation-room/artifacts-shipped-shelf.tsx"
  - id: "ROOM-05"
    artifact: "src/worker/jobs/situation-snapshot.ts active-viewer 90s gate + SituationRoom's useEffect ping interval"
  - id: "ROOM-06"
    artifact: "usePollWithLeader passes pauseOnHidden:true; underlying usePoll honours document.visibilityState"
  - id: "ROOM-07"
    artifact: "src/ui/primitives/use-leader-election.ts (BroadcastChannel election) + src/ui/primitives/use-poll-with-leader.ts (follower postMessage bridge); two-tab acceptance test asserts follower receives leader payload"
  - id: "ROOM-08"
    artifact: "src/ui/surfaces/situation-room/awaiting-you-pill.tsx; count + age + useHostNavigation deep-link"
  - id: "COEXIST-06"
    artifact: ".github/workflows/coexistence.yml runs scripts/coexistence-checks/run-all.mjs on every PR; the six COEXIST-01..06 scripts are all green against the as-shipped tree"

deviations_from_plan:
  - id: "DEV-01"
    rule: "Rule 2 — missing critical functionality"
    plan_text: "set-opt-in handler: `const userId = ctx.host.currentUserId;`"
    reality: "SDK 2026.512.0 PluginContext has NO `host` field (verified empirically against node_modules/@paperclipai/plugin-sdk/dist/types.d.ts lines 1292-1345 + 02-03b API-SHAPES §5). Plan 02-03 shipped with eight handlers using the same fictional access pattern and exploded on the Countermoves drill."
    fix: "Following the 02-03b convention: UI reads userId from useHostContext().userId and threads it as a param; worker handlers read params.userId. Same for companyId. Documented in opt-in-guard.ts header + every Ctx-type comment."
    impact: "Permanent: every Phase-3 / Phase-4 handler that needs caller identity MUST follow this pattern."
    commit: "3a8a6aa"
  - id: "DEV-02"
    rule: "Rule 1 — bug in plan-text regex"
    plan_text: "regex for COEXIST-03 DROP TABLE check did not strip SQL comments"
    reality: "Initial run of coexistence checks failed against the clean tree because migrations/0002_tldrs_and_editor.sql contains a doc-comment listing 'drop table' as part of describing the host validator's keyword set."
    fix: "Strip SQL line + block comments before grepping in checks #2, #3, #5."
    impact: "Future migrations may freely document forbidden patterns in comments."
    commit: "11d0680"
  - id: "DEV-03"
    rule: "Rule 1 — typecheck bug from plan-text Zod usage"
    plan_text: "instanceConfigSchema as JS object with `type:'number', default:60_000`"
    reality: "PaperclipPluginManifestV1.instanceConfigSchema typechecks against JsonSchema (Record<string, unknown>). The plan-text shape was JS-object-shaped which works at runtime but the SDK docstring suggests Zod. Attempted Zod first (z.object({...})) but TS errored because ZodObject does not satisfy the JsonSchema index signature."
    fix: "Ship JSON Schema shape: { type:'object', properties: { situationRefreshIntervalMs: { type:'number', minimum:30000, maximum:600000, default:60000 } } }."
    impact: "Phase 3/4 config fields use the same plain-object shape; Zod stays available for authoring-side validation only."
    commit: "25a4ea7"

conventions_established:
  - id: "CONV-02-04-01"
    name: "Opt-in-guard wrap pattern"
    summary: "Every non-exempt handler MUST register via wrapDataHandler(ctx, key, fn) or wrapActionHandler(ctx, key, fn). The exempt set is EXEMPT_HANDLER_KEYS = {'get-opt-in', 'set-opt-in', 'clarity-pack/get-instance-config'}. Phase 3 Bulletin + Phase 4 Chat: every new handler MUST follow this pattern unless it is a boot-time config read."
  - id: "CONV-02-04-02"
    name: "userId / companyId pass-through"
    summary: "UI calls useHostContext() and threads userId + companyId into usePluginData / usePluginAction params. Worker handlers read params.userId / params.companyId. NEVER ctx.host.* (no such field on PluginContext)."
  - id: "CONV-02-04-03"
    name: "Composed Ctx types"
    summary: "Handler Ctx types compose from OptInGuardDataCtx / OptInGuardActionCtx (which themselves compose from real SDK clients). NO narrow inline Ctx interfaces. Past pain: 02-03 shipped with 8 SDK shape drifts that came from local-narrow Ctx types — 02-04 structurally prevents the repeat."
  - id: "CONV-02-04-04"
    name: "useInstanceConfig FALLBACK"
    summary: "SDK 2026.512.0 does NOT export useInstanceConfig. Use the local wrapper at src/ui/primitives/use-instance-config.ts. Phase 3 / Phase 4 host-config consumers use the same pattern."
  - id: "CONV-02-04-05"
    name: "BroadcastChannel leader election + follower postMessage"
    summary: "Multi-tab polling uses useLeaderElection (BroadcastChannel; lowest UUID wins) + usePollWithLeader (broadcasts leader-data; followers consume via channel.onmessage). Pure createLeaderBroadcast helper is exported for non-React testing."
  - id: "CONV-02-04-06"
    name: "Coexistence CI baseline"
    summary: "scripts/coexistence-checks/{01..06}.mjs implement the six COEXIST assertions; run-all.mjs chains them; .github/workflows/coexistence.yml runs on every PR. Phase 4 will replace #5 (currently a chat_messages-table-not-created stub) with the real disable-plugin/messages-still-visible integration test."

self_check_pending: true  # filled below

known_stubs: []  # nothing currently rendering placeholder data; all data flows are wired
known_threat_flags: []
---

# Phase 2 Plan 02-04: Situation Room + Opt-In + Coexistence CI Summary

**One-liner:** Opt-in gate end-to-end (clarity_user_prefs + opt-in-guard wrap on every existing handler + Settings page + EnableClarityCta + useOptIn hook); Situation Room page with 60s materialized snapshot, BroadcastChannel leader election + follower postMessage bridge, deterministic blocker-chain narration (PRIM-03); coexistence CI workflow runs 6 COEXIST-01..06 assertions on every PR.

## Status

- **Tasks 1, 2, 3:** COMPLETE (RED+GREEN commit pair each; 6 task commits total).
- **Task 4:** AWAITING HUMAN — `checkpoint:human-verify` blocking gate. Operator runs the manual rehearsal against a local Paperclip clone (NOT BEAAA, NOT Hostinger) bookended by clarity-safety snapshot + restore-on-clone, then types "approved — phase 2 closed" to close Phase 2.

## Conventions Established (forwarded to Phase 3 / Phase 4)

See `conventions_established` frontmatter above. The six conventions are:
1. **Opt-in-guard wrap** — every non-exempt handler routes through `wrapDataHandler` / `wrapActionHandler`.
2. **userId / companyId pass-through** — UI threads identity through params; worker reads params (no `ctx.host.*` — that field does not exist on PluginContext).
3. **Composed Ctx types** — handler Ctx composes from `OptInGuardDataCtx` / `OptInGuardActionCtx` (real SDK shapes). No narrow inline Ctx interfaces.
4. **useInstanceConfig FALLBACK** — local wrapper around `usePluginData('clarity-pack/get-instance-config')`. SDK does NOT export the hook.
5. **BroadcastChannel leader election + follower postMessage** — `useLeaderElection` + `usePollWithLeader`. Pure `createLeaderBroadcast` helper is testable without React.
6. **Coexistence CI baseline** — six standalone Node scripts; comment-aware grep; one CI workflow ungating every PR.

## Decisions Made

See `decisions` frontmatter above (D-02-04-01..05).

## Deviations from Plan

See `deviations_from_plan` frontmatter above (DEV-01, DEV-02, DEV-03). Three deviations, all documented with rationale + commit hash. The major one (DEV-01) prevents a repeat of the 02-03 "eight SDK shape drifts" disaster.

## Test Suite Delta

| Metric | Pre-plan | Post Tasks 1+2+3 | Delta |
|--------|----------|------------------|-------|
| Tests passing | 141 | 266 | +125 |
| Tests failing | 0 | 0 | 0 |
| New test files | — | 11 | +11 |

Suite-by-suite breakdown:
- Task 1: 5 new test files; 54 new tests (opt-in-guard, set-opt-in, get-opt-in, use-opt-in, settings-page, handlers-wrapped).
- Task 2: 5 new test files; 48 new tests (situation-snapshot, situation-room-handler, use-leader-election, use-poll-with-leader, situation-room).
- Task 3: 1 new test file; 23 new tests (coexistence-checklist).

## Build Status

- `npx tsc --noEmit` — clean (exit 0).
- `node scripts/build-ui.mjs` — clean (`dist/ui/index.js` 43.2kb).
- `node scripts/build-worker.mjs` — clean (`dist/worker.js` 36.4kb).
- `node scripts/check-css-scope.mjs` — clean (47 selectors, all scoped).
- `node scripts/coexistence-checks/run-all.mjs` — all 6 checks PASS.

## Phase 2 Cumulative Posture

Plans 02-01 (PARTIAL — Linux Check B deferred, non-blocking), 02-02, 02-03+02-03b+02-03c, and 02-04 are all CLOSED or close-pending on Task 4.

Eric can now:
- Toggle Clarity Pack on/off for himself in the Settings page (default OFF — absence of `clarity_user_prefs` row).
- Open any issue → Reader tab. When opted-out, sees inline "Enable Clarity Pack" CTA. When opted-in, sees TL;DR + ref chips + breadcrumb + AC checklist + activity + right-rail Live Blocker (one typed terminal — PRIM-05).
- Navigate to `/situation-room` → see the live agent grid + critical path strip + artifacts shelf, polling every 60s only when the tab is visible, with only one tab in the browser doing the actual fetch (the others receive the leader's payload via BroadcastChannel postMessage).
- Watch the Editor-Agent compile TL;DRs under standard Paperclip governance (pause/resume from classic admin UI).
- Watch the coexistence CI workflow run all six COEXIST-01..06 assertions on every PR; failures bisect to the specific assertion.

What remains for Phase 2 closure:
- **Task 4 manual rehearsal** (this plan's checkpoint). Operator runs against a local Paperclip clone bookended by clarity-safety snapshot + restore-on-clone per the bookended-by-snapshots rule. The five rehearsal sections (A Situation Room visual fidelity, B Polling cadence + leader election, C Opt-in flow, D Coexistence CI green, E REHEARSAL.md row + restore) are detailed in 02-04-PLAN.md `<how-to-verify>` and will be presented to the operator by the orchestrator.

## Files Created or Modified

See `key_files` frontmatter above. 28 new files, 12 modified.

## Forward Links (consumed by Phase 3 / Phase 4)

- **Phase 3 Bulletin:** the BulletinPage will reuse `useOptIn`, `EnableClarityCta`, `ClaritySurfaceRoot`, `PauseBanner`, the opt-in-guard wrap, and the `useInstanceConfig` FALLBACK pattern for any new instanceConfigSchema field it lands.
- **Phase 4 Chat:** the ChatPage will reuse the same primitives. Because Chat uses `usePluginStream` (not polling) it will NOT need `usePollWithLeader`, but the BroadcastChannel pattern is documented for any future polling surface. The COEXIST-05-stub script must be replaced with the real "disable plugin → messages still visible as classic Paperclip comments" integration test in Phase 4.

## Self-Check: PASSED

Verified 2026-05-14T15:40Z. All 30 claimed file paths exist on disk; all 6 claimed commit hashes (`0eabd63`, `3a8a6aa`, `05dcb88`, `25a4ea7`, `81cf2ab`, `11d0680`) are present in `git log` on the master branch.

```text
FOUND: migrations/0003_situation_and_optin.sql
FOUND: src/worker/opt-in-guard.ts
FOUND: src/worker/handlers/get-opt-in.ts
FOUND: src/worker/handlers/set-opt-in.ts
FOUND: src/worker/handlers/get-instance-config.ts
FOUND: src/worker/handlers/situation-room.ts
FOUND: src/worker/handlers/active-viewer-ping.ts
FOUND: src/worker/jobs/situation-snapshot.ts
FOUND: src/ui/primitives/use-opt-in.ts
FOUND: src/ui/primitives/use-instance-config.ts
FOUND: src/ui/primitives/use-leader-election.ts
FOUND: src/ui/primitives/use-poll-with-leader.ts
FOUND: src/ui/components/enable-clarity-cta.tsx
FOUND: src/ui/surfaces/settings/index.tsx
FOUND: src/ui/surfaces/situation-room/{index,agent-card,critical-path-strip,artifacts-shipped-shelf,awaiting-you-pill,sparkline}.tsx
FOUND: scripts/coexistence-checks/{01..06}.mjs + run-all.mjs
FOUND: .github/workflows/coexistence.yml
FOUND: test/fixtures/coexistence/{bad-public-ddl.sql, bad-unscoped-css.css}
```

Test suite: 266 passing / 0 failing. typecheck: clean. Builds (ui + worker): clean. Coexistence run-all: 6/6 PASS.

Task 4 deferral is explicitly noted (checkpoint:human-verify gate; operator runs manual rehearsal per 02-04-PLAN.md `<how-to-verify>`).
