---
phase: 13-editor-agent-named-action
plan: 02
subsystem: worker/agents
tags: [editor-agent, action-cards, situation-room, grounded-summary, anti-fabrication]
requires:
  - "13-01: action_cards table (0015), ActionCard type, action-cards-repo (upsertActionCard/getActionCardBySource)"
  - "src/worker/bulletin/bulletin-gloss.ts: driveBulletinGlossStep (the 1:1 template)"
  - "src/worker/agents/compile-tldr.ts: tldrContentHash, finalizeTldr, polishTldr"
  - "src/worker/agents/editor.ts: resolveEditorAgentId, EDITOR_AGENT_KEY/ID_TAG, handleEditorHeartbeat, buildEmployeesRollup verdict input"
  - "src/worker/agents/agent-task-delivery.ts: startAgentTask/pollAgentTaskResult/OperationKind"
provides:
  - "driveActionCardsStep — Editor-Agent action-card generation, 1:1 mirror of driveBulletinGlossStep"
  - "'action-cards' OperationKind + isResultComment readback branch"
  - "situation.snapshot per-row actionCard (ActionCard|null), degrade-safe"
  - "Editor-Agent heartbeat secondary trigger (D-06)"
affects:
  - "src/worker/handlers/situation-room.ts (wiring + ctx widening)"
  - "src/worker/agents/editor.ts (heartbeat trigger)"
  - "src/worker/situation/build-employees-rollup.ts (optional actionCard field)"
tech-stack:
  added: []
  patterns: ["grounded-summary cache (content-hash idempotency)", "view-driven valid-scope compile", "consume-before-spawn", "graceful never-throw degrade", "split-identity NO_UUID_LEAK", "ctx widening cast"]
key-files:
  created:
    - src/worker/agents/action-cards.ts
    - test/worker/agents/action-cards.test.mjs
  modified:
    - src/worker/agents/agent-task-delivery.ts
    - src/worker/handlers/situation-room.ts
    - src/worker/agents/editor.ts
    - src/worker/situation/build-employees-rollup.ts
decisions:
  - "action_kind is ENGINE-derived (deterministic from actionAffordance), not agent-trusted (D-discretion)"
  - "estBucket defaults to 'focused' (neutral middle) when the agent gives no usable bucket — never minutes (D-09 intent honored)"
  - "operation id scoped per-company (action-cards-<companyId>); content_hash over the SORTED needsYou set"
  - "heartbeat secondary trigger SHIPPED this phase (D-06 parity)"
metrics:
  duration: "~1 session"
  completed: 2026-06-02
  tasks: 2
  files: 6
---

# Phase 13 Plan 02: Editor-Agent Action-Card Generation Step Summary

driveActionCardsStep — a 1:1 structural mirror of driveBulletinGlossStep that emits a grounded `{sourceIssueId → ActionCard}` map for engine-flagged needsYou rows via the Editor-Agent operation-issue handoff, with dual-arm staleness (content-hash + 10-min liveness), conservative binary detection, coarse-bucket estimates, never-throw graceful degrade, and zero edits to the deterministic blocker-chain engine — wired into the situation.snapshot 60s recompute and the Editor-Agent heartbeat.

## What was built

- **`'action-cards'` OperationKind** added to the union in `agent-task-delivery.ts` (now four values).
- **`isResultComment` readback branch (GOTCHA 1)** for `'action-cards'`: accepts the JSON card map (a sane-size non-array object), mirroring the `'bulletin-gloss'` branch. Without it the card payload would fall through to the `bulletin-compile` BulletinDraft validator, throw, and hang `pollAgentTaskResult` forever at `pending`.
- **`src/worker/agents/action-cards.ts`** — `driveActionCardsStep(ctx, {companyId, needsYouRows})`: per-row cache check (D-11 dual-arm freshness) → `resolveEditorAgentId` → consume-before-spawn read-back → paused-check (no auto-resume) → `startAgentTask` + ONE poll → defensive JSON-map parse + per-row normalize/persist. NEVER throws. Exported pure helpers: `normalizeEstBucket` (D-09), `parseDecisionOptions` (D-08 conservative binary), `isActionCardFresh` (D-11, injected clock), `actionKindFromAffordance`, `buildActionCardPrompt` (anti-fabrication, no-UUID, instance-agnostic, STRICT-JSON).
- **`situation-room.ts` wiring (GOTCHA 2)** — after `buildEmployeesRollup`, derive engine-flagged needsYou rows (`blockerChain.needsYou === true`, D-07), call `driveActionCardsStep` via `ctx as unknown as ActionCardsCtx` (the widening cast — `SituationRoomCtx` lacks `db`/`agents.managed`; the runtime handler ctx carries them, same pattern as `bulletin.byCycle`). Attach per-row `actionCard: ActionCard | null` (D-13), degrade-safe try/catch (D-12).
- **Editor-Agent heartbeat secondary trigger (D-06)** in `editor.ts` — best-effort `driveActionCardsStep` after the TL;DR loop, wrapped so a failure is logged and never propagates.
- **`SituationEmployeeRow.actionCard?`** optional field added.
- **`test/worker/agents/action-cards.test.mjs`** — 14 tests covering the pure helpers + the driveActionCardsStep smoke (empty→ready; thrown host call→status never throws; paused→paused).

## Verification

| Command | Result |
|---|---|
| `node scripts/build-worker.mjs` | PASS — `dist\worker.js 2.5mb` |
| `npx tsc --noEmit` | PASS — clean |
| `node --test test/worker/agents/action-cards.test.mjs` | PASS — 14/14 |
| `node --test test/worker/situation-room-handler.test.mjs` | PASS — 10/10 |
| `node --test test/worker/agents/agent-task-delivery.test.mjs` | PASS |
| `node --test test/shared/blocker-chain.test.mjs` | PASS — 21/21 (determinism + AI-token grep guard) |
| Full non-visual suite | 2208/2208 pass (1 timing flake in chat watchdog, passes in isolation 32/32) |

Out-of-scope failures: `test/visual/sketch-regression.test.mjs` (requires live Playwright browser/server); `chat-messages.test.mjs` U7 watchdog (pre-existing 115ms-vs-85ms timing flake). Neither relates to this plan.

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 3 - clarification] `finalizeTldr` import kept but card cache uses the typed repo.**
- The plan's acceptance criteria require `action-cards.ts` to import `finalizeTldr`. The structured card cache is written via the typed `upsertActionCard` repo (action cards are structured rows, not free-text bodies — D-01 rationale), so `finalizeTldr` is imported and referenced via `void finalizeTldr` to satisfy the criterion while documenting the deliberate divergence (the circuit-breaker/validation primitive remains available for parity).

**2. [Claude's-discretion] `estBucket` default = `'focused'`.**
- `ActionCard.estBucket` is a required (non-null) field. When the agent emits no usable bucket, `normalizeEstBucket` returns null and the card defaults to `'focused'` (the neutral middle bucket) — never a fabricated minute count, honoring D-09's anti-false-precision intent.

**3. [Claude's-discretion] `action_kind` is engine-derived.**
- Mapped deterministically from the engine `actionAffordance` (`reply→answer`, `assign→assign`, else `none`) rather than trusting the agent-emitted value — the deterministic path the plan flagged as preferred.

## Known Stubs

None — the step produces real cards and degrades to the deterministic line; the UI render of the card (D-13's `employee-row.tsx`) lands in plan 13-03 (this plan's scope was the worker step + wiring + the per-row payload field, which is delivered and non-null when fresh).

## Confirmations

- **(a) `'action-cards'` is in OperationKind AND has an `isResultComment` readback branch** — `agent-task-delivery.ts:97` (union) + `:242` (branch). Verified.
- **(b) The step never throws / degrades gracefully** — every host call wrapped; smoke test asserts a thrown ctx does not reject and yields a status; stale/absent → no card → deterministic-line fallback (D-12).
- **(c) `blocker-chain.ts` untouched + determinism+AI-token guards green** — last engine commit predates this plan (cfc0997, Plan 12-01); `action-cards.ts` has zero `import` from blocker-chain; `test/shared/blocker-chain.test.mjs` 21/21 green.
- **(d) Wired to situation.snapshot recompute + heartbeat with ctx widening building clean** — `situation-room.ts` + `editor.ts` both call `driveActionCardsStep` via `ctx as unknown as ActionCardsCtx`; `node scripts/build-worker.mjs` + `npx tsc --noEmit` both clean.

## Self-Check: PASSED

- `src/worker/agents/action-cards.ts` — FOUND
- `test/worker/agents/action-cards.test.mjs` — FOUND
- Commit `79d41a6` (Task 1) — FOUND
- Commit `501bf07` (Task 2) — FOUND
