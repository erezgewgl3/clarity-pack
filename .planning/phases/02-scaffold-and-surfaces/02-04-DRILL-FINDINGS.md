---
plan: 02-04
drill_date: 2026-05-14
drill_target: Countermoves Hostinger (countermoves.gl3group.com)
verdict: PARTIAL — functional contracts PASS, visual fidelity + narration FAIL
operator: eric (driven by Claude as pair-on-keyboard)
parent_plan_status: NOT YET CLOSED — pending Plan 02-08 polish + re-drill
proposed_followon: 02-08
---

# Plan 02-04 Drill Findings — 2026-05-14 against Countermoves

## Status snapshot

| Section | Verdict | Notes |
|---|---|---|
| Install (pre-rehearsal) | PASS after DEV-04 fix | `0003_situation_and_optin.sql`'s `DO $$ ... $$;` guard rejected by host SQL validator; removed + regression test added in commit `aa70e82` |
| Routing (page slot URL) | PASS | `/COU/situation-room` resolves (NOT `/COU/plugins/clarity-pack/situation-room` — SDK uses `routePath` as direct company-scoped segment) |
| OPTIN-01..05 | PASS | CTA renders when off (OPTIN-02); set-opt-in uses `params.userId` not `ctx.host` (OPTIN-03 + DEV-01); `optedInAt` written to plugin namespace clarity_user_prefs (OPTIN-04); default landing classic dashboard (OPTIN-05); absence-of-row = opted out (OPTIN-01) |
| ROOM-05 polling (ping side) | PASS | 4× `situation.active-viewer-ping` at 200 OK at ~60s cadence observed in Network |
| ROOM-05 polling (snapshot side) | PASS | `situation.snapshot` job ticks and inserts; UI reads most-recent row |
| ROOM-01..04, ROOM-08 visual | **FAIL** | See "What broke" below — components mounted, data flowing, but ZERO production styling and narration is raw UUIDs |
| ROOM-06 visibility pause | UNTESTED | Did not reach |
| ROOM-07 leader election | UNTESTED | Did not reach |
| COEXIST-06 (CI workflow) | UNTESTED | Did not reach |
| Section E bookend snapshot | INTENTIONALLY SKIPPED | Per session scope decision — bookend was exercised on Countermoves 2026-05-14 in 02-03c drill (28h prior); CLAUDE.md rule targets BEAAA, not Countermoves |

## What's proven (these constitute the GREEN core of Plan 02-04)

1. **Install pipeline end-to-end:** `npm pack` → `scp` → `install-helper.sh` → `paperclipai plugin uninstall && plugin install` → status `ready` v0.2.0 on Countermoves.
2. **Migration 0003 applies cleanly** (after DEV-04 fix). Plugin namespace has new tables `situation_snapshots` + `active_viewers` alongside the surviving `clarity_user_prefs` from 02-03c.
3. **Opt-in gate end-to-end:** UI renders inline CTA → click triggers `set-opt-in` action with `params: {userId, optedInAt}` → worker writes prefs row → response confirms write. Cross-user write protection (OPTIN-03) confirmed via Network payload inspection: request `params.userId` matches response `userId` exactly.
4. **Active-viewer pinging:** 4 successful 200 pings at ~60s cadence; cron job sees `active_viewers` rows and ticks; `situation_snapshots` row populated.
5. **Snapshot data flow:** `situation.snapshot` data handler returns structured payload (see "Captured snapshot payload" below); UI mounts SituationRoomOptedIn component and renders the payload.

## What broke (the FAIL surface — Plan 02-08 scope)

### DEV-04 — `DO $$ ... $$;` rejected by host SQL validator (FIXED in commit aa70e82)
- Host validator regex `\bdo\s+(?:\$\$|language\b)` rejects PL/pgSQL anonymous blocks at install time
- 0003 had a defensive existence-guard using this syntax → install blew up
- Fix: removed guard (migration order already guaranteed); regression test in `test/migrations/no-procedural-blocks.test.mjs` scans every .sql file with the same regex

### DEV-05 — page-slot URL pattern is `/{companyPrefix}/{routePath}`, NOT `/{companyPrefix}/plugins/{pluginId}/{routePath}`
- Discovered when `/COU/plugins/clarity-pack/situation-room` 404'd
- Correct: `/COU/situation-room` (SDK `routePath` IS the company-scoped segment)
- Documentation gap; plan 02-04 references prove the pattern but rehearsal `<how-to-verify>` was ambiguous
- ACTION: pin the URL form in 02-08 SUMMARY's "verified URL patterns" appendix

### DEV-06 — NO CSS exists for any Clarity Pack component (BLOCKING for ROOM-01..04)
- `dist/ui/index.css` is 8.2 KB — bundled but contains zero rules for Clarity classnames
- `clarity-cta-button`, `clarity-cta`, `clarity-cta-heading`, etc. — all just semantic classnames with no styling backing them
- Same problem in Situation Room components: `agent-card`, `critical-path-strip`, `awaiting-you-pill`, `sparkline`, `artifacts-shipped-shelf`, `editorial-desk-footer`
- **Effect on screen:** every component renders as default-browser unstyled HTML — plain text in a vertical stack, no layout, no colors, no spatial separation, no hover affordances. Buttons look identical to surrounding `<p>` elements.
- The mockup `sketches/paperclip-fix-situation-room.html` shows the intended design; what renders is essentially `<div>{text}</div>` repeated.
- **Why unit tests missed it:** structural assertions (component renders, props honored) pass; visual fidelity has no test surface.

### DEV-07 — React key warnings in render
- `EnableClarityCta` triggers "Each child in a list should have a unique key prop"
- `ClaritySurfaceRoot` (from `SituationRoomOptedIn`) triggers the same
- No actual list rendering in these components; warning likely comes from passing an array via a children prop without Fragment keys
- Polish, non-blocking, but visible in console for every page load

### DEV-08 — Vite HMR WebSocket connection errors at runtime (build noise)
- Production bundle includes a Vite client trying to connect to `wss://127.0.0.1:13100/`
- Either the build is using Vite dev-mode bundle (wrong target) or has a stray Vite client import
- Plan 02-04 Task 2 build configuration should NOT include the Vite HMR client in production output
- Console errors visible on every page load; harmless functionally but noisy

### DEV-09 — useHostContext companyId/userId works on PAGE slots (NOT a defect — clarifying note)
- Confirmed via the set-opt-in payload: `companyId: "62b33a78-..."`, `params.userId: "E8TMB44X20gw..."`
- 02-03c's `useResolvedCompanyId` resolver was specific to detail-tab slots — page slots get host context normally
- Recommendation: document this distinction in 02-03b-API-SHAPES.md as Finding #11

### DEV-10 — `useOptIn().toggle()` doesn't invalidate the `get-opt-in` cache
- After `setOptIn({...})` succeeds (200 OK with row written), the UI still shows the CTA because `usePluginData('get-opt-in')` returns stale `optedInAt = null`
- Hard refresh forces fresh data → UI flips to opted-in render branch
- Expected behavior: `toggle()` should mark the data stale or refetch; standard pattern with mutating actions
- Fix path: either `usePluginAction` returns an invalidate handle, or `useOptIn` wires a manual invalidate after toggle

### DEV-11 — Critical Path narration is raw UUIDs, not human names (BLOCKING for ROOM-02)
- `terminal.label` values: `"Owner unknown — assign b2a22e50-d772-4b70-bb50-4f4e93c2e984 first"`
- The b2a22e50 / 58f86f42 strings are agent ids (not user ids). The narration loop treats them as opaque strings.
- The plan promised "one-line plain-English narration" — the *shape* is one line, but the *content* isn't English; it's an identifier lookup that was never resolved.
- Fix path: blocker-chain terminal labelling must resolve agent id → agent.displayName + user id → user.name; "__unowned__" terminal needs human-friendly handling ("nobody assigned" not "Owner unknown")

### DEV-12 — Agent card content is sparse (BLOCKING for ROOM-01)
- Captured payload shows `now_doing: null`, `velocity_7d: []`, `latest_artifact: null` for both ceo + editor agents
- Plan promised cards with role, StatePill, age, "now doing" line, blocker chain terminal, latest artifact 1-line snippet, 7-day sparkline
- Currently delivered: role (`ceoStandby` — concatenation of role+state with no space; should be "CEO" + a state pill), age (`<1m`), state ("Standby"), blocker chain terminal text (raw UUID — see DEV-11)
- Missing: state pill chrome, sparkline rendering (empty array but no fallback UX), now-doing prose ("Editor-Agent prose pass" was supposed to fill this), latest artifact preview
- The Editor-Agent prose-pass component referenced in the plan ("kind-derived sentence default — Editor-Agent prose pass is a Phase 3 polish" per the original Task 4 verbatim verdict text) was deferred to Phase 3 — but agent cards need SOMETHING in `now_doing` even before prose, e.g. "idle — last activity 14d ago"

### DEV-13 — Awaiting You count includes "__unowned__" terminals
- The terminal kind `HUMAN_ACTION_ON` with `userId: "__unowned__"` is being counted as "awaiting you" (count=2 in the captured payload)
- Semantically, `__unowned__` is "awaiting whoever should own the agent" — not Eric specifically
- Plan ROOM-08 says "Awaiting You inbox pill shows count + age of oldest item + deep-link to relevant task" — implies items where the operator (Eric) is the named human action target
- Fix path: the awaiting-you count should filter `userId === currentViewerId`, OR `__unowned__` should be treated as a separate "unassigned" bucket with its own UI affordance

## Captured snapshot payload (2026-05-14T19:15:26.34Z)

This is the raw `situation.snapshot` data handler response, captured from the Network tab. It is the input to whatever the planner / executor designs for Plan 02-08.

```json
{
  "data": {
    "employees": [
      {
        "role": "ceo",
        "state": "Standby",
        "age_ms": 0,
        "userId": "b2a22e50-d772-4b70-bb50-4f4e93c2e984",
        "now_doing": null,
        "velocity_7d": [],
        "blocker_chain": {
          "isStale": false,
          "pathIds": ["b2a22e50-d772-4b70-bb50-4f4e93c2e984"],
          "startId": "b2a22e50-d772-4b70-bb50-4f4e93c2e984",
          "terminal": {
            "kind": "HUMAN_ACTION_ON",
            "label": "Owner unknown — assign b2a22e50-d772-4b70-bb50-4f4e93c2e984 first",
            "userId": "__unowned__"
          }
        },
        "latest_artifact": null
      },
      {
        "role": "editor",
        "state": "Standby",
        "age_ms": 0,
        "userId": "58f86f42-9fa3-4922-acff-985191ca15a7",
        "now_doing": null,
        "velocity_7d": [],
        "blocker_chain": {
          "isStale": false,
          "pathIds": ["58f86f42-9fa3-4922-acff-985191ca15a7"],
          "startId": "58f86f42-9fa3-4922-acff-985191ca15a7",
          "terminal": {
            "kind": "HUMAN_ACTION_ON",
            "label": "Owner unknown — assign 58f86f42-9fa3-4922-acff-985191ca15a7 first",
            "userId": "__unowned__"
          }
        },
        "latest_artifact": null
      }
    ],
    "critical_path": [
      {
        "isStale": false,
        "pathIds": ["b2a22e50-d772-4b70-bb50-4f4e93c2e984"],
        "startId": "b2a22e50-d772-4b70-bb50-4f4e93c2e984",
        "terminal": {
          "kind": "HUMAN_ACTION_ON",
          "label": "Owner unknown — assign b2a22e50-d772-4b70-bb50-4f4e93c2e984 first",
          "userId": "__unowned__"
        }
      },
      {
        "isStale": false,
        "pathIds": ["58f86f42-9fa3-4922-acff-985191ca15a7"],
        "startId": "58f86f42-9fa3-4922-acff-985191ca15a7",
        "terminal": {
          "kind": "HUMAN_ACTION_ON",
          "label": "Owner unknown — assign 58f86f42-9fa3-4922-acff-985191ca15a7 first",
          "userId": "__unowned__"
        }
      }
    ],
    "awaiting_you_count": 2,
    "artifacts_shipped_today": [],
    "awaiting_you_oldest_age": null,
    "taken_at": "2026-05-14 19:15:26.34495+00"
  }
}
```

### Captured set-opt-in request/response (proof of OPTIN-03 + DEV-01 honored)

```
Request POST (multiplexed bridge):
{
  "companyId": "62b33a78-4f4a-4ab7-9977-a27be86f9853",
  "params": {
    "userId": "E8TMB44X20gwBYvFz3Qf4jUO71bc8k1B",
    "optedInAt": "2026-05-14T19:09:36.948Z"
  }
}

Response 200:
{
  "data": {
    "userId": "E8TMB44X20gwBYvFz3Qf4jUO71bc8k1B",
    "optedInAt": "2026-05-14T19:09:36.948Z"
  }
}
```

## Scope proposal for Plan 02-08

Plan 02-08 must close the visual + narration gaps so Plan 02-04 can flip from PARTIAL to APPROVED. Scope candidates:

### Task 1 (auto, TDD): CSS for all Clarity surfaces
- Write actual CSS rules backing every `clarity-*` classname referenced in current source
- Target: `dist/ui/index.css` grows from 8.2 KB to a meaningful size (~15-25 KB after Plan 02-08 — actual size depends on how many primitives are styled)
- DOM-snapshot tests using JSDOM that assert each component renders with a recognizable visual structure (not just "renders without crashing")
- Includes: `clarity-cta-*`, `clarity-surface-root`, `agent-card`, `critical-path-strip`, `awaiting-you-pill`, `sparkline`, `artifacts-shipped-shelf`, `editorial-desk-footer`, plus the Reader-side primitive styling that the 02-03c drill noted was missing
- Source of truth: `sketches/paperclip-fix-situation-room.html` (sketch class structure → real CSS)

### Task 2 (auto, TDD): UUID-to-name narration humanization
- Critical-path terminal labelling: agent ids → agent.displayName, user ids → user.name
- `__unowned__` terminal → "no owner assigned" plus a CTA to assign one
- Now-doing prose: even before the full Editor-Agent prose pass (Phase 3), provide a kind-derived fallback ("Standby for 14 days" / "Last activity: <time ago>")
- New worker handler or extension of existing situation-snapshot job that joins agent/user names

### Task 3 (auto, TDD): Polish defect cluster
- DEV-07 React key warnings — fix the array-prop pattern
- DEV-08 Vite WebSocket noise — exclude Vite dev client from production build
- DEV-10 useOptIn cache invalidation — invalidate `get-opt-in` after `setOptIn` succeeds
- DEV-13 Awaiting You filtering — exclude `__unowned__` from count or split into separate bucket

### Task 4 (checkpoint:human-verify, blocking): Re-drill against Countermoves
- Re-pack, scp, uninstall + install, browser drill
- Verdict: "approved — phase 2 closed" only after side-by-side proportions to mockup pass AND console clean of new errors AND awaiting-you semantics correct
- Append second Phase 2 rehearsal row to `runbook/REHEARSAL.md`

## Wins to celebrate (the rehearsal pattern worked)

This is the SECOND drill on Plan 02-04 (counting the executor's self-check as drill #0). The drill pattern caught real gaps unit tests missed — same shape as Plan 02-03 → 02-03b → 02-03c. The cost of the drill is bounded; the cost of shipping these defects to BEAAA later would be unbounded.

Specifically prevented from reaching BEAAA:
- DEV-04 install-time blocker (host validator rejects PL/pgSQL)
- DEV-06 entire CSS gap (would have been Eric's first impression on production)
- DEV-11/12/13 UX semantics (UUIDs visible to operator, wrong "awaiting you" count)

## Files of record

- `.planning/phases/02-scaffold-and-surfaces/02-04-PLAN.md` (the plan)
- `.planning/phases/02-scaffold-and-surfaces/02-04-SUMMARY.md` (the executor's self-reported close, predates this drill)
- `.planning/phases/02-scaffold-and-surfaces/02-04-DRILL-FINDINGS.md` (this file)
- `.planning/phases/02-scaffold-and-surfaces/02-08-PLAN.md` (to be created by gsd-planner from this file)
- `runbook/REHEARSAL.md` (to be appended with Phase 2 rehearsal row marked PARTIAL after 02-08 closes)
- Commits: `aa70e82` (DEV-04 fix), prior 7 commits via Plan 02-04 executor (`0eabd63..405aed1`)
