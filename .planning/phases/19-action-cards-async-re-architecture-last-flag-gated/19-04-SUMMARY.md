---
phase: 19-action-cards-async-re-architecture-last-flag-gated
plan: 04
subsystem: worker / action-cards runtime-safety proof + operator flip RPC
tags: [card-03, operator-rpc, kill-switch-flip, storm-safety, off-floor, no-psql, degrade-safe]
requires:
  - "19-01: setActionCardsEnabled / isActionCardsEnabled (action-cards-flag-repo.ts) — the flip primitive + degrade-to-OFF read"
  - "19-02: the three gate points (compile / attach / SWR serve strip) + the storm-safety makeStormCtx CARD-01 burst"
  - "src/worker/handlers/set-opt-in.ts (clone template — register/param-guard/operator posture)"
  - "src/worker/agents/wake-governor.ts DEFAULT_WAKE_CEILING_PER_MIN (the governor ceiling)"
  - "src/worker/agents/action-cards.ts ACTION_CARDS_WARM_MAX_ROWS (the bounded-warm cap), isActionCardLive, rowToCard"
provides:
  - "src/worker/handlers/set-action-cards-flag.ts — operator RPC to flip the action-cards flag ON/OFF (Step-2 enable + panic-OFF), no psql, no redeploy"
  - "registerSetActionCardsFlag wired into worker.ts next to registerSetOptIn"
  - "manifest narrative documenting the new action (no actions[] field in SDK; rides existing database.namespace caps; no version bump)"
  - "test/worker/agents/action-cards-flag-gate.test.mjs — CARD-03 OFF=floor at all 3 gates + ON-switch + liveness + flip round-trip"
  - "storm-safety CARD-03 fold: explicit governor-ceiling + bounded-warm assertions on the existing CARD-01 burst"
affects:
  - "src/worker.ts (registration)"
  - "src/manifest.ts (narrative comment only — no shape/capability change)"
  - "test/loop/storm-safety.test.mjs (CARD-03 assertions folded into the CARD-01 burst, D9)"
tech-stack:
  added: []
  patterns:
    - "operator-scoped flip RPC (clone of set-opt-in; param-guard + parameterized namespaced UPSERT; no escalation param)"
    - "OFF=floor consistency proof at all three gate points (compile / attach / SWR serve strip)"
    - "fold-not-duplicate test extension (CARD-03 ceiling/bounded-warm assertions added to the existing CARD-01 burst per plan-checker D9)"
key-files:
  created:
    - src/worker/handlers/set-action-cards-flag.ts
    - test/worker/handlers/set-action-cards-flag.test.mjs
    - test/worker/agents/action-cards-flag-gate.test.mjs
  modified:
    - src/worker.ts
    - src/manifest.ts
    - test/loop/storm-safety.test.mjs
decisions:
  - "MANIFEST: the SDK 2026.512.0 PaperclipPluginManifestV1 has NO actions[] field (the manifest already documents this for the rc.6 invalidates misread). set-opt-in is NOT declared in the manifest either — it is purely ctx.actions.register. So 'declare in manifest' = a narrative comment + confirming the action rides the already-declared database.namespace.* capabilities. No manifest shape/capability change."
  - "CEILING SOURCE: readCeiling() in wake-governor.ts is module-private; the test uses the exported DEFAULT_WAKE_CEILING_PER_MIN (6) which IS the CI ceiling (no CLARITY_WAKE_CEILING_PER_MIN set), rather than re-reading the env."
  - "FOLD (D9): the ON-no-storm burst already exists in storm-safety.test.mjs (added in 19-02). Per the plan-checker note, the CARD-03 ceiling + bounded-warm assertions were FOLDED into that same CARD-01 burst test, not duplicated."
  - "NO VERSION BUMP: 1.7.5 -> v1.8.0 is Plan 19-05 (deploy step). At default OFF this plan is behaviorally inert."
metrics:
  duration: "~12 min"
  completed: "2026-06-15"
  tasks: 2
  files_changed: 6
requirements: [CARD-03]
---

# Phase 19 Plan 04: Action-cards runtime-safety proof + operator flip RPC Summary

Delivered CARD-03's two halves: the **redeploy-free flip mechanism** and the
**falsifiable runtime-safety proof**. `set-action-cards-flag` is an operator RPC
(clone of `set-opt-in`) that flips the action-cards flag ON (Step-2 monitored
enable) or OFF (panic — room back to the deterministic floor) via the
parameterized namespaced UPSERT from 19-01 — so on BEAAA, which has **no psql**,
both the Step-2 ON-flip and the panic-OFF are one RPC gesture, not shell. The
CI tests prove the slip-safety contract: with the flag **OFF**, the deterministic
floor renders at **all three gate points** (compile / attach / SWR serve strip);
with the flag **ON**, an action-card op-issue burst across a simulated restart
stays within the governor ceiling and the bounded-warm cap — no wake storm, no
notification storm.

## What Was Built

### Task 1 — set-action-cards-flag operator RPC + registration + manifest narrative (commit eb257c2)
- **`src/worker/handlers/set-action-cards-flag.ts`** — `registerSetActionCardsFlag(ctx)` registers the `set-action-cards-flag` action: guards `companyId` (non-empty string) and `enabled` (boolean), throwing a clear param error and refusing to write on bad input (mirrors the set-opt-in `userId` guard); `setBy` defaults to `'operator'` so no flip is unattributed. Its ONLY write routes through `setActionCardsEnabled(ctx, companyId, enabled, setBy)` (parameterized `$1/$2/$3`; no identifier interpolation — T-19-13). Operator/admin posture matches set-opt-in exactly (no escalation param; `companyId` is a target selector, not an identity claim — T-19-11).
- **`src/worker.ts`** — imported + registered `registerSetActionCardsFlag(ctx)` next to `registerSetOptIn` in the exempt-handlers block.
- **`src/manifest.ts`** — added a release-history narrative documenting the new action and the rationale for NO manifest shape/capability change (the SDK has no `actions[]` field; the action rides the already-declared `database.namespace.*` capabilities). Explicitly NO version bump (that is 19-05).
- **`test/worker/handlers/set-action-cards-flag.test.mjs`** — 6 assertions: ON UPSERT (enabled bound true), OFF write (enabled bound false), `setBy` defaults to `'operator'`, missing `companyId` throws + refuses to write, empty `companyId` throws, non-boolean `enabled` throws + refuses to write.

### Task 2 — CARD-03 OFF-floor + ON-no-storm CI tests (commit 46f173d)
- **`test/worker/agents/action-cards-flag-gate.test.mjs`** (6 tests) — exercises the REAL `isActionCardsEnabled` + `getActionCardsBySources` + `isActionCardLive`/`rowToCard` against a fake db keyed off SQL regex, plus the SHIPPED attach/strip mapping shapes:
  - **Gate 1 (compile):** OFF => `isActionCardsEnabled` is false => the editor heartbeat guard's early-return floor.
  - **Gate 2 (attach):** OFF => `cardsBySource` stays `{}` => every needs-you row's `actionCard` is null (deterministic line).
  - **Gate 3 (SWR serve):** OFF => a FRESH cached slice with a card baked in is stripped to `actionCard:null` (panic-OFF floors instantly, no redeploy).
  - **ON switch:** ON + a live card => the card attaches (proves the gate is a real switch, not a constant floor).
  - **ON but stale:** the liveness arm floors a long-idle card even when ON (degrade-safe).
  - **Flip round-trip:** `setActionCardsEnabled(ON)` opens all gates; `setActionCardsEnabled(OFF)` closes them.
- **`test/loop/storm-safety.test.mjs`** — FOLDED the CARD-03 assertions into the existing CARD-01 burst (D9, no duplicate burst): after authoring 12 action-card op-issues through the REAL governed `startAgentTask` path across a simulated restart, asserted the wakes stay within `DEFAULT_WAKE_CEILING_PER_MIN` (no wake storm) and the `ACTION_CARDS_WARM_MAX_ROWS <= 5` bounded-warm cap holds (a needs-you spike can't fan out into one giant compile). The provenance-suppression + non-notifying mark-done assertions (zero self-trigger recursion, A1) were already in that burst.

## Verification

- `node --test test/worker/handlers/set-action-cards-flag.test.mjs test/worker/agents/action-cards-flag-gate.test.mjs test/loop/storm-safety.test.mjs` — **15/15 pass**.
- `npx tsc --noEmit -p tsconfig.json` — **exit 0** (clean).
- `node --test test/shared/blocker-chain.test.mjs` (determinism floor + AI-free guard) — **21/21 pass**; `src/shared/blocker-chain.ts` UNTOUCHED by this plan.
- Full `node --test` sweep: 18 pre-existing failures (7 `scripts/safety/*` CLI harness tests + 1 Phase-17 `snapshot-prefetch` count drift) — ALL verified pre-existing at the parent commit (eb257c2^) and unrelated to the 6 files this plan touched. Logged to `deferred-items.md` (SCOPE BOUNDARY — not fixed here).

## Structural notes (per key_reminders)

- The **snapshot-502 absence is structural by construction** — the on-request compile was DELETED in 19-02 and a static gate forbids its return, so the request path does ZERO AI work. This plan's ON-burst test proves the remaining **heartbeat** path stays bounded (no wake storm). The live 502/notification empirical confirm is **19-05 Step-1**.
- The flip is the literal "flip ONE DB row, room back to the known-good floor with zero deploy latency" guarantee — the SWR serve-path strip (19-02) means even a fresh cached slice floors on a panic-OFF.

## Deviations from Plan

### Manifest "declaration" — narrative comment, not an actions[] entry (Rule 3 — blocking interpretation)

The plan said "declare the `set-action-cards-flag` action in `src/manifest.ts` alongside `set-opt-in` (same shape/capability)." But the SDK 2026.512.0 `PaperclipPluginManifestV1` has **no `actions[]` field** (the manifest itself documents this for the prior rc.6 `invalidates` misread), and `set-opt-in` is NOT declared in the manifest either — it is purely `ctx.actions.register`. So the truthful "declaration" is: register it programmatically (done in worker.ts) + add a manifest narrative comment confirming the action rides the already-declared `database.namespace.*` capabilities with no shape/capability change. No manifest schema entry exists to add. Documented inline in both the handler and the manifest.

### Ceiling source — exported constant, not module-private readCeiling (binding choice)

The storm-safety fold initially imported `readCeiling` from wake-governor.ts; it is module-private (not exported). Switched to the exported `DEFAULT_WAKE_CEILING_PER_MIN` (6), which IS the CI ceiling since no `CLARITY_WAKE_CEILING_PER_MIN` is set. Equivalent and avoids broadening the governor's export surface.

## Known Stubs

None. The flip handler is fully implemented over the 19-01 `setActionCardsEnabled` UPSERT and unit-proven (6 tests). The OFF-floor + ON-no-storm proofs are CI-falsifiable. No UI-facing placeholders introduced.

## Notes for Downstream Plans

- **19-05 (deploy + A1 live confirm):** the `set-action-cards-flag` RPC is the Step-2 ON-flip + panic-OFF gesture (no psql). The two-source version bump 1.7.5 -> v1.8.0 is owed there. The A1 non-notifying claim is asserted in CI here; the live empirical confirmation (no "Someone updated" notification in the Step-1 quiet window) is still owed in 19-05 Step-1.
- **Deferred (out of scope):** `scripts/safety/*` CLI harness test failures + the Phase-17 `snapshot-prefetch` 2-vs-3 SELECT count drift — see `deferred-items.md`.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes. The flip handler is operator-scoped (T-19-11 mitigated: posture matches set-opt-in, no escalation param) and parameterized (T-19-13 mitigated: the only write is the bound UPSERT). The ON-burst proves T-19-12 (flag-ON compile-burst DoS) bounded by the governor ceiling + bounded-warm cap.

## Self-Check: PASSED

- src/worker/handlers/set-action-cards-flag.ts — FOUND
- test/worker/handlers/set-action-cards-flag.test.mjs — FOUND
- test/worker/agents/action-cards-flag-gate.test.mjs — FOUND
- commit eb257c2 — FOUND
- commit 46f173d — FOUND
