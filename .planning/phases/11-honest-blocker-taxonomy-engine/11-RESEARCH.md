# Phase 11: Honest Blocker Taxonomy (engine) - Research

**Researched:** 2026-06-02
**Domain:** Pure deterministic graph-classification engine refactor + big-bang type migration across worker + UI consumers (TypeScript / ESM / Paperclip plugin)
**Confidence:** HIGH (all findings verified by reading the actual source files in this repo; no external library claims)

## Summary

This is a **read-only, code-only** refactor of the pure engine `src/shared/blocker-chain.ts` and its `Terminal` / `BlockerChainResult` contracts in `src/shared/types.ts`, plus a coordinated update of every consumer that reads those types. No new migration, no new capability, no AI/LLM call enters the engine. The work is structural: extend the leaf-terminal cascade (D-07), add 4 new `Terminal` kinds (D-05), enrich `BlockerChainResult` with an engine-computed verdict (D-13), expose a pure `kind→{tier, affordance, needsYou}` mapping (D-14), remove the `__unowned__` sentinel (D-11), and inject worker-computed agent ownership + liveness at the engine boundary (D-01..D-04).

The single largest planning risk is **the type migration is a compile-time fan-out, not a behavioral one**: `Terminal` is a discriminated union consumed by `switch`/`if` statements and `terminal.kind === 'HUMAN_ACTION_ON'` guards in **8 source files** (plus tests). The TypeScript exhaustiveness check in `humanize-snapshot.ts` (`const _exhaustive: never = t`) will **fail to compile** the moment new kinds are added until every `switch` is updated — this is a feature, not a bug: it mechanically enumerates the migration checklist. The "17 consumers" figure in CONTEXT counts test files, doc references, and presentational components; the **actual code that reads the engine result is 8 files** (enumerated below with file:line and read-pattern).

The second risk is **two parallel edge/`nodeMeta` builders that must stay in sync**: `buildEdges` in `org-blocked-backlog.ts` (the exported, shared one, also used by `build-employees-rollup.ts`) and `walkBlockerChain` in `flatten-blocker-chain.ts` (the Reader panel's independent BFS). Both build `nodeMeta` with the OLD 3-field shape `{ownerUserId, etaIso, status}` and **neither captures `assigneeAgentId` per blocker node today**. Agent-ownership + liveness injection (D-01) must extend BOTH (or be centralized) — otherwise the Reader panel and the Situation Room will classify the same chain differently, violating SC5 (single source of truth).

**Primary recommendation:** Treat `src/shared/types.ts` (the `Terminal` union + `BlockerChainResult`) and the new pure mapping function as the Wave-0 contract; land them first so the `never`-exhaustiveness compile error becomes the live migration checklist. Centralize the agent-ownership/liveness `nodeMeta` capture in the shared `buildEdges` and have the Reader handler reuse it (kill the duplicate `walkBlockerChain`), so liveness is computed in exactly one worker location and the engine stays a pure consumer.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-16 — authoritative; do NOT re-litigate)

**Agent liveness boundary**
- **D-01:** Caller pre-classifies liveness. The worker computes working-vs-stuck and passes `nodeMeta.agentState: 'working' | 'stuck' | null` into the engine. Engine stays purely structural — no clock, no time arithmetic.
- **D-02:** Stuck = stale heartbeat AND nothing queued (idle run-state + empty work queue). Computed in the worker.
- **D-03:** Stale window = no heartbeat for ≥ 2× the expected heartbeat interval; cadence sourced at the worker boundary (self-tuning, no magic number in the engine).
- **D-04:** Missing liveness ⇒ agent-stuck (conservative). Agent leaf with known `assigneeAgentId` but no liveness signal ⇒ `AWAITING_AGENT_STUCK`; surfaces show honest "agent state unknown".

**Terminal taxonomy & migration**
- **D-05:** Rename `HUMAN_ACTION_ON` → `AWAITING_HUMAN`; add `AWAITING_AGENT_WORKING`, `AWAITING_AGENT_STUCK`, `UNOWNED`. With `UNCLASSIFIED` (D-09) the union is **8 variants**. No dead alias.
- **D-06:** Big-bang migration this phase. Engine + all blocker-chain consumers updated together; not done until every surface reads the new verdict.
- **D-07:** Leaf precedence cascade (awaiting-first): `EXTERNAL`/`CYCLE` pre-empt as today → then `status='awaiting'` ⇒ `AWAITING_HUMAN` → else user-owned ⇒ `AWAITING_HUMAN` → else agent-owned ⇒ `AWAITING_AGENT_WORKING`/`STUCK` by liveness → else `etaIso` + no owner ⇒ `SELF_RESOLVING` → else ⇒ `UNOWNED`.
- **D-08:** Test depth = planner discretion. HARD: the determinism test (100× `JSON.stringify` equality) and the AI-token grep guard MUST stay green.

**Honest unowned vs degrade (TAX-03)**
- **D-09:** Two distinct terminal kinds. `UNOWNED` (genuine — leaf truly has no user/agent/ETA → "assign owner" legit, lands in Needs-you) and `UNCLASSIFIED` (chain build/walk failed → honest fallback, **never** "assign owner").
- **D-10:** Boundary = walk-success vs walk-failure. genuinely-unowned = built & walked fine but ownerless. unclassified = build/walk failed (`relations.get` threw, depth/`maxSteps` exceeded, malformed graph).
- **D-11:** Remove the `__unowned__` sentinel entirely. It becomes real `UNOWNED` with no `userId`.
- **D-12:** UNCLASSIFIED copy: "Can't determine blocker — open <issue> to investigate" + open-issue affordance and **no** assign button. Exact wording planner discretion; no-assign-button rule locked.

**Structured verdict contract (SC5)**
- **D-13:** Extend `BlockerChainResult` with engine-computed `needsYou: boolean`, `tier: 'needs-you' | 'in-motion' | 'watch'`, `actionAffordance: 'reply' | 'nudge' | 'assign' | 'open' | 'none'`, and optional `degradeReason`. Surfaces render straight from it — zero re-derivation.
- **D-14:** Engine owns the kind→{tier, affordance, needsYou} mapping as a pure exported function/table. Phase 12 + Phase 15 import it — one table, no `ownerName === 'Unassigned'` drift.
- **D-15:** Split identity (NO_UUID_LEAK). Verdict carries human-readable `awaitedPartyLabel` (display) AND separate `targetAgentUuid` / `targetIssueUuid` (mutation-only, never rendered as text).
- **D-16:** No leverage count in the engine. Exposes structural inputs (`pathIds`, edges); leverage ranking is Phase 12.

### Claude's Discretion
- Exact determinism-test fixtures and depth (D-08); exact UNCLASSIFIED copy (D-12); internal naming of verdict fields; how the worker sources heartbeat cadence for the 2× stale window (D-03).

### Deferred Ideas (OUT OF SCOPE)
- Needs-you leverage / "unblocks → impact" ranking — **Phase 12**.
- Editor-Agent named-action sentences + action cards — **Phase 13**.
- Reply-in-place + quick-decision chips — **Phase 14**.
- Cockpit IA redesign (Pulse + Needs-you / In-motion / Watch tiers) — **Phase 15** (the engine's `tier` field feeds it but the screen is not redesigned here).
- `issue.relations.write` capability (clear `blockedByIssueIds`) — **Phase 14** decision.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TAX-01 | Engine classifies each blocked item into one honest terminal kind — awaiting-human / agent-working / agent-stuck / self-resolving / external / cycle / genuinely-unowned — recognizing **agent** ownership (`assigneeAgentId`), not just user ownership. | The 8-variant `Terminal` union (D-05) + the D-07 cascade in `flattenBlockerChain`; agent ownership injected via `nodeMeta.assigneeAgentId` + `nodeMeta.agentState` from `buildEdges` (worker). See "Architecture Patterns → Pattern 1/2". |
| TAX-02 | A chain waiting on another agent flattens transitively to the human-actionable end; no mid-chain "poke the agent" terminal. | The existing DFS already walks transitively to a leaf via `continuingEdges` (blocker-chain.ts:106-187). TAX-02 is satisfied by the existing walk continuing *through* agent nodes; the terminal kind is chosen only at the leaf. A mid-chain agent is never a terminal because it has outgoing `'blocks'` edges. |
| TAX-03 | Degrade-safe — a row whose chain can't be built or classified shows an honest fallback, never a false "assign owner." | `UNCLASSIFIED` kind (D-09/D-10) for walk-failure; `actionAffordance: 'open'` + no assign button (D-12). The worker's existing degrade-safe try/catch sites (org-blocked-backlog.ts:271-291, build-employees-rollup.ts:365-373, flatten-blocker-chain.ts:53-58) are where `UNCLASSIFIED` is emitted instead of silently skipping or falling back to `__unowned__`. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Terminal taxonomy / cascade decision | Pure engine (`src/shared/`) | — | PRIM-03: deterministic graph code, no clock/DB/AI. The choice of which terminal fires is owned entirely by `blocker-chain.ts`. |
| kind→{tier, affordance, needsYou} mapping | Pure engine (`src/shared/`) | — | D-14: one exported pure function/table; Phase 12 + 15 import it. |
| Agent ownership capture (`assigneeAgentId` per node) | Worker (`buildEdges`) | — | D-01: worker has the data on the wire (`IssueRelationIssueSummary.assigneeAgentId`); engine consumes injected facts. |
| Liveness computation (working/stuck/stale) | Worker (`build-employees-rollup` + `buildEdges`) | — | D-01/D-02/D-03: requires clock + heartbeat cadence + run-state — explicitly forbidden in the engine. |
| NO_UUID_LEAK scrub of display label | Worker / shared (`scrub-human-action.ts`) | — | D-15: display label is human-readable; UUIDs carried separately as mutation-only fields. |
| Rendering the verdict (tier/affordance) | UI (`src/ui/surfaces/`) | — | D-13: surfaces render straight from the verdict; zero re-derivation. |

## Standard Stack

No new packages. This phase ships **zero dependency changes** — it is an internal refactor of first-party source. The forced stack (from `CLAUDE.md`) is unchanged: TypeScript `^5.7.3`, ESM, Node ≥20, `@paperclipai/plugin-sdk@2026.512.0` (peer/externalized). Tests run via the built-in `node --test` runner with native TS loading (the existing `test/**/*.test.mjs` import `.ts` directly — verified `npm test` = `node --test "test/**/*.test.mjs"`).

**Installation:** None. `[VERIFIED: repo package.json — no new deps]`

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. (Verified: the change set is confined to `src/shared/`, `src/worker/`, `src/ui/`, and `test/`; no `package.json` dependency edits are required by any locked decision.)

## Runtime State Inventory

> This phase is a **code-only refactor with no migration and no live-instance write**. The taxonomy is read-only classification. Still, because it touches the rendered output that drives operator action, the inventory is completed explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — verified: `situation.snapshot` computes everything FRESH per call (situation-room.ts:1-11, 121-127); the `situation_snapshots` table is no longer written or read (dead since Plan 09-01). No taxonomy value is persisted anywhere. The `clarity_agent_owners` side table (migration 0013) stores operator-claimed owners but is keyed by `agent_id`/`owner_user_id`, not by terminal kind — untouched by this phase. | none |
| Live service config | **None** — verified: no cron/routine/job emits or caches the terminal kind. The 60s on-view recompute (`situation.snapshot`) is request-scoped. | none |
| OS-registered state | **None** — no OS-level registration references terminal kinds. | none |
| Secrets/env vars | **None** — no secret or env var names reference the taxonomy. The MCP env (`PAPERCLIP_*`) is unrelated. | none |
| Build artifacts | **dist/** is rebuilt from `src/` by `pnpm build`; `dist/manifest.js` carries the version literal. **The version literal lives in BOTH `package.json` and `src/manifest.ts`** (MEMORY: plugin-version-bump-two-sources) — if this phase ships a version bump, bump both. No stale egg-info/binary concern (TS/ESM, no compiled native artifacts). | rebuild `dist/` before any drill; bump both version sites if versioning |

**The canonical question:** After every file in the repo is updated, what runtime systems still have the old taxonomy cached, stored, or registered? **Answer: none.** The taxonomy exists only in computed-fresh request output; there is no persistence layer to migrate. This is the cleanest possible refactor surface.

## Architecture Patterns

### System Architecture Diagram

```
                 ┌─────────────────────── WORKER (impure: clock, SDK I/O, liveness) ──────────────────────┐
                 │                                                                                          │
 ctx.issues.list │   buildEdges(ctx, companyId, startId)          [org-blocked-backlog.ts — SHARED]         │
 (status=blocked)│      ├─ ctx.issues.relations.get  ──► blockedBy[] per node                              │
       │         │      ├─ per-node nodeMeta = { ownerUserId, etaIso, status,                              │
       ▼         │      │                          assigneeAgentId,        ◄── NEW (D-01 agent ownership)  │
  blocked issues │      │                          agentState }            ◄── NEW (D-01 liveness 'working'│
       │         │      │                                                       |'stuck'|null; from D-02/03│
       │         │      └─ edges[] = {from,to,reason}                           computed in worker, NOT eng)│
       │         │                                                                                          │
       │         │   liveness compute (D-02/D-03): heartbeat age ≥ 2× cadence AND idle run-state           │
       │         │      └─ source cadence at worker boundary (D-03) ; missing ⇒ 'stuck' (D-04)             │
       │         └──────────────────────────────────┬───────────────────────────────────────────────────┘
       │                                             │ { edges, nodeMeta(+agent fields) }
       ▼                                             ▼
 ┌──────────────────────── PURE ENGINE (no clock, no DB, no AI — PRIM-03) ─────────────────────────┐
 │  flattenBlockerChain(input)            [blocker-chain.ts]                                          │
 │    DFS walk (UNCHANGED) ──► leaf                                                                   │
 │    leaf terminal cascade (D-07 awaiting-first):                                                    │
 │      EXTERNAL / CYCLE  (pre-empt, unchanged)                                                       │
 │        else status='awaiting'        ⇒ AWAITING_HUMAN                                              │
 │        else nodeMeta.ownerUserId     ⇒ AWAITING_HUMAN                                              │
 │        else nodeMeta.assigneeAgentId ⇒ AWAITING_AGENT_WORKING | AWAITING_AGENT_STUCK (by agentState)│
 │        else etaIso & no owner        ⇒ SELF_RESOLVING                                              │
 │        else                          ⇒ UNOWNED                                                     │
 │      walk/build failure (caught upstream) ⇒ UNCLASSIFIED  (degradeReason set)                     │
 │                                                                                                    │
 │  classifyVerdict(terminal)  [NEW pure exported fn — D-14]                                          │
 │    ⇒ { needsYou, tier, actionAffordance }  per the design-seed §3 Section 1 table                 │
 │                                                                                                    │
 │  → BlockerChainResult { startId, pathIds, terminal, isStale,                                       │
 │                          needsYou, tier, actionAffordance, degradeReason?,                         │
 │                          awaitedPartyLabel, targetAgentUuid?, targetIssueUuid? }  (D-13/D-15)      │
 └────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                   │ rich verdict
       ┌───────────────────────────────────────────┼───────────────────────────────────────────────┐
       ▼                          ▼                 ▼                          ▼                      ▼
 build-employees-       org-blocked-backlog   humanize-snapshot      flatten-blocker-chain    Reader live-
 rollup.ts (Needs-you   .ts (OrgBlockedRow    .ts (label scrub,      .ts (Reader handler;     blocker-panel.tsx
 re-triage off tier/    .terminalKind)        exhaustive switch —    its OWN walkBlockerChain (renders
 needsYou, NOT          + scrub-human-        MUST add new kinds)    DUPLICATE — see Pitfall 2) terminal.kind)
 ownerName==='Unassigned')action.ts (sentinel)
```

### Recommended File Structure (changes only)

```
src/shared/
├── types.ts                  # Terminal union 4→8 variants; BlockerChainResult enriched (D-13/D-15)
├── blocker-chain.ts          # flattenBlockerChain cascade (D-07); pickTopChains priority update;
│                             #   NEW exported classifyVerdict() pure mapping (D-14); __unowned__ GONE (D-11)
└── scrub-human-action.ts     # UNOWNED_SENTINEL removed; scrub handles new kinds; awaitedPartyLabel honored

src/worker/
├── handlers/org-blocked-backlog.ts   # buildEdges: capture assigneeAgentId + agentState per node (D-01)
├── handlers/flatten-blocker-chain.ts # REUSE shared buildEdges (kill duplicate walkBlockerChain) OR mirror
├── situation/build-employees-rollup.ts # Needs-you re-triage off verdict.tier/needsYou (NOT ownerName string)
│                                        # liveness compute (heartbeat age vs cadence) lives here / shared helper
├── situation/classify-employee-state.ts # existing stuck/stale logic — REUSE as liveness input source
└── jobs/humanize-snapshot.ts          # exhaustive switch over Terminal — MUST handle 4 new kinds (compile gate)

src/ui/surfaces/
├── situation-room/employee-row.tsx       # render off verdict; assign affordance gated on actionAffordance==='assign'
├── situation-room/needs-you-banner.tsx   # partition off verdict.tier, NOT ownerName==='Unassigned'
├── situation-room/owner-picker-popover.tsx # unchanged shape; rendered only when affordance==='assign'
├── situation-room/org-blocked-backlog-banner-types.ts # OrgBlockedRow.terminalKind widens to 8-kind union
└── reader/live-blocker-panel.tsx         # render new kinds (today only special-cases HUMAN_ACTION_ON)
```

### Pattern 1: Caller-injects-the-impure-bits (D-01) — established in this codebase

The codebase already splits "engine takes structured facts, worker computes them." `classify-employee-state.ts` is the proof: it is a **pure function with `nowMs` injected** (`classify-employee-state.ts:28` — *"Now() injected for testability — never read inside the function"*). It already computes a 5-state classification including `blocked`/`stale` from heartbeat age. Liveness (`agentState: 'working'|'stuck'`) is the same shape: compute it in the worker, inject the verdict into `nodeMeta`.

```typescript
// src/shared/blocker-chain.ts — the engine's INPUT shape gains two NEW per-node fields.
// Source: blocker-chain.ts:22-31 (current) — extended per D-01.
export type BlockerChainInput = {
  startId: string;
  edges: BlockerEdge[];
  nodeMeta: Record<string, {
    ownerUserId: string | null;
    etaIso: string | null;
    status: string;
    assigneeAgentId?: string | null;   // NEW (D-01) — agent ownership, captured by worker buildEdges
    agentState?: 'working' | 'stuck' | null; // NEW (D-01) — liveness, pre-computed by worker (D-02/03/04)
  }>;
  viewerUserId: string;
  maxAgeMs?: number;
};
```

### Pattern 2: The leaf-terminal cascade lives in exactly ONE place (blocker-chain.ts:110-181)

The current leaf-selection block is a linear `if`-cascade inside the DFS `while` loop. The D-07 awaiting-first cascade slots in **verbatim ordering**:

```typescript
// Source: blocker-chain.ts:110-181 (current cascade — extended per D-07).
// The leaf block already runs in priority order. D-07 inserts the agent branch
// BETWEEN the user-owner branch and the SELF_RESOLVING branch, and replaces the
// __unowned__ fallback with the real UNOWNED kind.
//
//   1. lastReason === 'external'                       → EXTERNAL   (UNCHANGED, line 120)
//   2. all outgoing edges external                     → EXTERNAL   (UNCHANGED, line 134)
//   3. status === 'awaiting'                           → AWAITING_HUMAN  (D-07: awaiting beats agent)
//   4. ownerUserId != null                             → AWAITING_HUMAN  (was gated on status==='awaiting'; D-07 widens)
//   5. assigneeAgentId != null                         → AWAITING_AGENT_WORKING | _STUCK by agentState (D-04: missing⇒stuck)
//   6. etaIso != null && no owner                      → SELF_RESOLVING  (UNCHANGED, line 160)
//   7. else                                            → UNOWNED  (REPLACES __unowned__ fallback, line 176-181)
// CYCLE is emitted earlier in the loop (line 91) — UNCHANGED.
// UNCLASSIFIED is NOT emitted by flattenBlockerChain itself — see Pattern 3.
```

> **Determinism preservation note (SC4/D-08):** the new branches read only `nodeMeta` fields (no clock, no `Date.now()`, no random). `agentState` is a pre-resolved enum string. Adding them keeps `JSON.stringify(flattenBlockerChain(input))` byte-stable across 100 runs because the inputs are fixed. The cascade order is fixed and total. **Do not** read any time value inside the engine to derive working/stuck — that is D-01's whole point and would break the determinism test.

### Pattern 3: UNCLASSIFIED is a degrade kind emitted at the WORKER boundary, not inside the pure walk (D-09/D-10)

The pure `flattenBlockerChain` always succeeds today (it has a `maxSteps` fallthrough → CYCLE at line 191). Per D-10, "unclassified = the build/walk itself failed (`relations.get` threw, depth/`maxSteps` exceeded, malformed graph)." The build-failure sites are in the **worker**, where the try/catch already exists:

- `org-blocked-backlog.ts:271-291` — `buildEdges` throws → currently `continue` (issue silently dropped). **Change:** emit an `UNCLASSIFIED` row instead of dropping (TAX-03 honesty).
- `build-employees-rollup.ts:365-373` — chain build throws → currently `blockerChain = null`. **Change:** emit an `UNCLASSIFIED` verdict so the row shows the honest fallback line.
- `flatten-blocker-chain.ts:53-58` — relations walk throws → currently synthesizes a fake `EXTERNAL` "Relations unavailable" terminal (flatten-blocker-chain.ts:129-141). **Change:** this `graceful()` helper should emit `UNCLASSIFIED`, not `EXTERNAL` (today it lies by labeling a walk failure as EXTERNAL).

The `maxSteps`-exceeded path (blocker-chain.ts:190-196) currently emits `CYCLE`; per D-10 a depth-limit overrun is "unclassified," so the pure engine MAY emit `UNCLASSIFIED` for that one internal path (it is still deterministic — no clock involved). Planner discretion on whether the `maxSteps` fallthrough becomes `UNCLASSIFIED` vs stays `CYCLE`; D-10 text favors `UNCLASSIFIED`.

### Anti-Patterns to Avoid
- **Re-deriving tier/affordance in the UI from `ownerName === 'Unassigned'`.** This is the exact drift D-14 exists to kill. The UI must read `verdict.tier` / `verdict.actionAffordance`. Today `employee-row.tsx:137` (`isUnowned = chain.ownerName === UNASSIGNED`) and `needs-you-banner.tsx:67-72` both string-match — these are the migration's primary UI targets.
- **Reading a clock inside `blocker-chain.ts`.** Breaks SC4 + the AI-token-adjacent purity contract. Liveness is injected (D-01).
- **Letting the two edge builders diverge.** `buildEdges` (shared) and `walkBlockerChain` (Reader) must produce the same `nodeMeta` shape or the Reader panel classifies differently than the Situation Room (SC5 violation). Prefer collapsing to one.
- **Keeping `__unowned__` as a "soft" alias.** D-11 is explicit: remove it. Leaving it lets the fake "assign owner" lie persist via `scrub-human-action.ts:53-56` and `humanize-snapshot.ts:112-117`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-issue blocker edge graph (BFS) | A new walk in the Reader handler | The EXPORTED `buildEdges` from `org-blocked-backlog.ts` (already shared with `build-employees-rollup.ts`) | A duplicate `walkBlockerChain` already exists in `flatten-blocker-chain.ts:74-127` and is the root of the SCarbon-copy-drift risk. Collapse to one. |
| Chain ranking | A new sort | `pickTopChains` (blocker-chain.ts:211) — update its `priority()` switch for the new kinds | Single source of truth for ordering; its `default: 99` already tolerates unknown kinds, but the new kinds need explicit priorities. |
| NO_UUID_LEAK scrub | A new label sanitizer | `scrubHumanAction` (scrub-human-action.ts) — extend for new kinds + `awaitedPartyLabel` | Single source since Plan 08-01; `humanize-snapshot.ts` is the parallel JOB-path version (now dead-job but still compiled — must stay type-valid). |
| Liveness (working/stuck) | New heartbeat math in the engine | Worker-side compute reusing `classify-employee-state.ts` heartbeat-age logic | D-01/D-02; the 5-state classifier already distinguishes `running` (fresh heartbeat) from `stale` — `agentState` is a projection of that. |
| Tier/affordance/needsYou decision | Per-surface conditionals | The NEW pure `classifyVerdict()` exported from the engine (D-14) | One table; Phase 12 + 15 import it. |

**Key insight:** Almost everything this phase needs already exists as a shared, pure, tested primitive. The phase is 80% "extend the existing contract + thread one new field" and 20% "add a pure mapping function." The danger is *re-implementing* rather than *extending* — especially the duplicate BFS.

## The Authoritative Consumer Map (the big-bang migration checklist — D-06)

CONTEXT says "17 consumers." Grepping every importer/caller of `flattenBlockerChain` / `pickTopChains` / `blocker-chain` and the `Terminal` / `BlockerChainResult` types yields **8 source files that actually read the engine contract**, plus tests and presentational components. Here is the real list with file:line and HOW each reads the result. **This is the migration checklist.**

### Tier A — read/produce the `Terminal` discriminant directly (compile-gated by the union change)

| # | File | How it reads the result | Sites to change |
|---|------|------------------------|-----------------|
| 1 | `src/shared/blocker-chain.ts` | **Produces** all terminals; `pickTopChains` switches on `terminal.kind` (L216-227). Emits `HUMAN_ACTION_ON` (L149, L177 with `userId:'__unowned__'`), `SELF_RESOLVING`, `EXTERNAL`, `CYCLE`. | The cascade (L110-181), the `__unowned__` fallback (L176-181), `pickTopChains` priority (L215-228). Add `classifyVerdict()`. |
| 2 | `src/shared/types.ts` | **Defines** `Terminal` union (L38-42) + `BlockerChainResult` (L44-49). | Union 4→8; enrich result (D-13/D-15). |
| 3 | `src/shared/scrub-human-action.ts` | `terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId === UNOWNED_SENTINEL` (L53), `!== UNOWNED_SENTINEL` (L65). Exports `UNOWNED_SENTINEL='__unowned__'` (L19). | Remove sentinel; handle `AWAITING_HUMAN`/`UNOWNED`/`UNCLASSIFIED`; honor `awaitedPartyLabel`. |
| 4 | `src/worker/jobs/humanize-snapshot.ts` | **Exhaustive `switch (t.kind)`** (L155-172) with `const _exhaustive: never = t` (L170). Special-cases `HUMAN_ACTION_ON`+`__unowned__` (L112), viewer-`You` (L143-148). | **Compile gate** — adding kinds fails `tsc` here until all 8 are in the switch. (This file is a dead JOB path but still compiled by `typecheck`.) |
| 5 | `src/worker/handlers/flatten-blocker-chain.ts` | Imports `flattenBlockerChain`; `graceful()` synthesizes `{ kind:'EXTERNAL' }` for walk-failure (L129-141) — **a lie per D-10**. Has its OWN `walkBlockerChain` BFS (L74-127). | Emit `UNCLASSIFIED` from `graceful()`; collapse duplicate BFS into shared `buildEdges`. |
| 6 | `src/worker/handlers/org-blocked-backlog.ts` | `buildEdges` builds `nodeMeta` (L215-219, NO `assigneeAgentId`). `pickTopChains` (L300). `terminal.kind === 'HUMAN_ACTION_ON'` + `UNOWNED_SENTINEL` viewer-match (L332, L370-374). `OrgBlockedRow.terminalKind: Terminal['kind']` (L72). | Capture `assigneeAgentId`+`agentState` in `nodeMeta`; need_you off `verdict.needsYou`; emit `UNCLASSIFIED` on skip (L279). |

### Tier B — read `BlockerChainResult` / `terminal.kind` for rendering or triage

| # | File | How it reads the result | Sites to change |
|---|------|------------------------|-----------------|
| 7 | `src/worker/situation/build-employees-rollup.ts` | `flattenBlockerChain`+`pickTopChains` (L284-285). Re-triages Needs-you via **`r.blockerChain.ownerName === 'Unassigned'`** (L464) — the string-match D-13/D-14 kills. `terminal.kind==='HUMAN_ACTION_ON'`+`UNOWNED_SENTINEL` (L291, L321, L358). | Re-triage off `verdict.tier`/`verdict.needsYou`; emit `UNCLASSIFIED` on chain-build throw (L365-373). |
| 8 | `src/ui/surfaces/reader/live-blocker-panel.tsx` | Consumes `BlockerChainResult` via `usePluginData('flatten-blocker-chain')` (L67). Renders `terminal.kind === 'HUMAN_ACTION_ON'` special-case (L34, L81, L91); else `terminal.kind.replace(/_/g,' ')` (L87). | Render the 4 new kinds; gate the action button on `verdict.actionAffordance`, not `kind==='HUMAN_ACTION_ON'`. |

### Tier C — read the worker row shape (string-matched ownership; migrate to verdict fields)

| # | File | How it reads | Sites to change |
|---|------|-------------|-----------------|
| 9 | `src/ui/surfaces/situation-room/employee-row.tsx` | `isUnowned = chain.ownerName === UNASSIGNED` (L137) drives the assign-vs-chat branch (L264). `UNASSIGNED='Unassigned'` (L66). | Gate assign cluster on `actionAffordance==='assign'`; gate nudge/reply on the verdict, not the string. |
| 10 | `src/ui/surfaces/situation-room/needs-you-banner.tsx` | Partitions `unownedBlocked`/`ownedBlocked` via `blockerChain?.ownerName === UNASSIGNED` (L67-72). `UNASSIGNED='Unassigned'` (L50). | Partition off `verdict.tier`/`needsYou`. |
| 11 | `src/ui/surfaces/situation-room/owner-picker-popover.tsx` | Presentational; takes `leafIssueId`/`leafIssueUuid` props. Does NOT read `Terminal`. | No type change; only WHEN it's rendered (gated upstream on `affordance==='assign'`). |
| 12 | `src/ui/surfaces/situation-room/index.tsx` | Imports `BlockerChainResult` for `critical_path?:` field type (L51, L62); passes rows through. | Type widens automatically; verify no re-derivation in the page body. |
| 13 | `src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts` | `OrgBlockedRow.terminalKind: string` (L18) — UI mirror of the worker row. | Widen/confirm the kind union; consume verdict fields if surfaced. |

### Not consumers (CONTEXT false positives — verified by reading)
- `src/worker/bulletin/action-inbox-query.ts` — does NOT import blocker-chain or `Terminal`; reads `blockerAttention.state` (a different host field). **No change.**
- `src/worker/bulletin/lineage-grouper.ts` — pure activity-clustering; only *mirrors the shape* of blocker-chain in a comment. **No change.**
- `src/worker/handlers/agent-take-ownership.ts` — persists operator-claimed owners to `clarity_agent_owners`; references `__unowned__` only in a comment (L7). **No code change** (update the stale comment optionally).
- `src/ui/surfaces/reader/index.tsx` — mounts `<LiveBlockerPanel>` (L416) but does not read the result itself. **No change.**

### Tests that pin the contract (must stay green or be updated alongside — D-08)
- `test/shared/blocker-chain.test.mjs` — determinism (100×, L92-114), AI-token grep guard (L192-199), the 4 current-kind cases + `pickTopChains` ordering. **MUST stay green.** New kinds need new cases; the grep guard's banned regex (`openai|anthropic|claude_local|llm|gpt|completion`) must not be tripped by any new code.
- `test/worker/situation/build-employees-rollup.test.mjs` + `-needsyou.test.mjs` — assert `ownerName === 'Unassigned'` for unowned (L146, L79). These assertions encode the OLD string-match; they will need updating to assert `verdict.tier`/`needsYou`.
- `test/worker/org-blocked-backlog.test.mjs` — stubs `relations.get`; will need `assigneeAgentId` + `agentState` fixtures for the new agent terminals.
- `test/ui/reader-view.test.mjs`, `test/ui/live-blocker-panel-null-context.test.mjs` — Reader panel rendering.

## What the Determinism Test + AI-Token Grep Guard Assert (SC4 / D-08)

`test/shared/blocker-chain.test.mjs` is the engine's purity contract. Plans MUST preserve these:

1. **Determinism (L92-114):** `JSON.stringify(flattenBlockerChain(input))` is byte-identical across 100 invocations for a fixed input. **Implication:** every new field added to `BlockerChainResult` must be deterministically derived from the input (no `Date.now()`, no `Math.random()`, no `Set`/`Map` iteration-order dependence in the serialized output). The existing code already sorts adjacency edges (L59-61) for this reason.
2. **AI-token grep guard (L192-199):** reads `blocker-chain.ts` source and asserts the regex `/\b(openai|anthropic|claude_local|llm|gpt|completion)\b/i` does NOT match. **Implication:** do not introduce any identifier or comment in `blocker-chain.ts` containing those tokens. The new pure `classifyVerdict()` and the cascade must use neutral vocabulary (`working`/`stuck`/`tier`/`affordance` are all safe).
3. **`pickTopChains` purity (L181-190):** asserts it does not mutate the input array. The new priority switch must keep `[...chains].sort(...)` (copy-then-sort), as it does today (L229).
4. **Per-kind terminal cases (L19-90):** one test per current kind asserting `terminal.kind` + payload fields. New kinds (`AWAITING_AGENT_WORKING/STUCK`, `UNOWNED`, `UNCLASSIFIED`, renamed `AWAITING_HUMAN`) need analogous cases. The existing `HUMAN_ACTION_ON` test (L19-38) becomes the `AWAITING_HUMAN` test.

## The kind→{tier, affordance, needsYou} Mapping (D-14) — mapped against design-seed §3 Section 1

The design seed table is the literal spec. Mapping each Terminal kind to the verdict triple:

| Terminal kind | `tier` | `actionAffordance` | `needsYou` | Source (design-seed §3 Section 1) |
|---|---|---|---|---|
| `AWAITING_HUMAN` | `needs-you` | `reply` | `true` | "leaf owned by/referencing a user, or status awaiting → In Needs-you: Yes → named action → reply-in-place" |
| `AWAITING_AGENT_WORKING` | `in-motion` | `none` | `false` | "heartbeat fresh & progressing → drops to In motion → action: none" |
| `AWAITING_AGENT_STUCK` | `watch` | `nudge` | `false` | "agent idle/stale, nothing queued → Watch (not Needs-you) → nudge/redirect (the only surviving assign-style action)" |
| `SELF_RESOLVING` | `watch` | `none` | `false` | "has ETA → In Needs-you: No → 'clears by <date>'" (Watch, informational) |
| `EXTERNAL` | `watch` | `open` | `false` | "shown in Watch → chase-external" |
| `CYCLE` | `watch` | `open` | `false` | "shown in Watch → break-loop" |
| `UNOWNED` (genuine) | `needs-you` | `assign` | `true` | "truly no owner anywhere → In Needs-you: Yes → this is where 'Assign owner' legitimately lives" |
| `UNCLASSIFIED` (degrade) | `watch` | `open` | `false` | D-12: "Can't determine blocker — open <issue> to investigate" + open-issue affordance, **no** assign button |

> **Affordance vocabulary note (Phase 10 input):** the spike (10-03-SPIKE-FINDINGS.md) proved **comment-alone resumes Shapes A & B** — i.e. an awaiting/blocked agent resumes natively on a reply comment, no transition needed to *trigger*. This **confirms** the `AWAITING_HUMAN → reply` affordance is real (the reply will actually resume). For `AWAITING_AGENT_STUCK → nudge`: the spike's Shape-B result (a `status='blocked'` idle agent woke on a comment) supports that a `nudge` on a stuck agent is *plausible*, but the spike's durability nuance (issue re-settled to `blocked` without a `{status:'in_progress'}` flip) is a **Phase 14** concern, not Phase 11. **For Phase 11 the `nudge` affordance is just a label/flag** — the engine only flags the row; no resume plumbing is built here (that's Phase 14). The spike does NOT require any change to the Phase 11 taxonomy; it validates that the affordances the taxonomy emits are actionable downstream.

This table SHOULD be the body of the pure `classifyVerdict(terminal): { tier, actionAffordance, needsYou }` exported from `blocker-chain.ts` (or a sibling pure module). It is a total function over the 8-kind union — add the `never`-exhaustiveness guard so a future kind addition is compile-gated.

## Common Pitfalls

### Pitfall 1: The `never`-exhaustiveness switch hides until the union grows — then everything fails to compile at once
**What goes wrong:** `humanize-snapshot.ts:155-172` has `switch (t.kind) { … default: const _exhaustive: never = t }`. The moment `types.ts` gains a 5th kind, `tsc --noEmit` (the `typecheck` script) fails here. If `humanize-snapshot.ts` is overlooked because it's a "dead job," the whole build stays red.
**Why it happens:** the file is dead at runtime (Plan 09-01 deleted its caller) but is still in `src/` and compiled by `typecheck`.
**How to avoid:** Land `types.ts` first (Wave 0). The resulting compile errors *are* the checklist. Update every `switch`/exhaustive guard. Consider deleting `humanize-snapshot.ts` if truly dead (verify no `import` remains) — but that is a separate decision; safest is to update its switch.
**Warning signs:** `tsc` error "Type 'X' is not assignable to type 'never'".

### Pitfall 2: Two divergent edge/nodeMeta builders classify the same chain differently
**What goes wrong:** `buildEdges` (org-blocked-backlog.ts, shared by the Situation Room) gets the new `assigneeAgentId`/`agentState` capture, but `walkBlockerChain` (flatten-blocker-chain.ts, the Reader panel's private BFS) does not — so the Reader classifies an agent-owned leaf as `UNOWNED` while the Situation Room classifies it as `AWAITING_AGENT_WORKING`. SC5 (single source of truth) silently breaks.
**Why it happens:** the two builders are separate code paths built in different phases (07 vs 02).
**How to avoid:** Collapse `walkBlockerChain` into the exported `buildEdges` (the Reader handler imports the shared one). If a full collapse is too large for this phase, at minimum thread the identical `nodeMeta` field set into both and add a test that both produce the same shape.
**Warning signs:** Reader blocker panel and Situation Room row disagree on the same issue in a live drill.

### Pitfall 3: `graceful()` in the Reader handler lies by emitting EXTERNAL for a walk failure
**What goes wrong:** flatten-blocker-chain.ts:129-141 synthesizes `{ kind:'EXTERNAL', label:'Relations unavailable' }` when the walk throws or the graph is empty. Per D-10 that is exactly the `UNCLASSIFIED` case — labeling it EXTERNAL is a false classification (and would render a "chase external" affordance on a row that is actually a build failure).
**How to avoid:** `graceful()` emits `UNCLASSIFIED` with `degradeReason` set. Note the **empty-graph** case (no blockers at all, L60) is different from a **walk failure** (L55) — an issue with genuinely no blockers may not be `UNCLASSIFIED` at all; planner must distinguish "no blockers (don't render a panel)" from "walk failed (render honest fallback)". Today both collapse to EXTERNAL.

### Pitfall 4: Liveness time-math accidentally lands in the pure engine
**What goes wrong:** a plan computes `heartbeatAge = now - lastHeartbeat ≥ 2× cadence` inside `blocker-chain.ts` to derive `working`/`stuck`. This reads a clock → breaks the determinism test → and the AI-token grep guard is adjacent (the purity contract).
**How to avoid:** D-01 is explicit — the worker computes `agentState` and injects it as a string enum. Reuse `classify-employee-state.ts`'s heartbeat-age logic (it already lives in the worker with `nowMs` injected). The engine only branches on the pre-computed string.
**Warning signs:** `Date.now()` / `new Date()` / cadence arithmetic appearing in `src/shared/blocker-chain.ts`.

### Pitfall 5: NO_UUID_LEAK regression via the new `awaitedPartyLabel` / split-identity fields (D-15)
**What goes wrong:** the new `targetAgentUuid`/`targetIssueUuid` fields are added to the verdict, and a UI surface renders one of them as text (the exact v1.3.0 R3 class of bug — MEMORY: a human key was passed where a UUID was needed, and conversely a UUID must never be rendered).
**How to avoid:** D-15 mirrors the proven `leafIssueUuid` split already in `build-employees-rollup.ts` (L75-80, L334-352: UUID carried as a mutation-only arg, human `leafIssueId` is the only rendered identifier). `awaitedPartyLabel` is the display string (scrubbed via `scrubHumanAction`); the `*Uuid` fields are dispatch-only. Keep the existing UUID-shape source-scan tests; add coverage for the new fields. `scrub-human-action.ts` must produce `awaitedPartyLabel` with zero raw UUIDs for all 8 kinds.
**Warning signs:** the UUID regex source-scan tests (e.g. in build-employees-rollup tests) start failing; a raw hex UUID appears in a rendered row during a drill.

### Pitfall 6: `pickTopChains` priority `default: 99` silently mis-ranks the new kinds
**What goes wrong:** `pickTopChains` (blocker-chain.ts:215-228) only enumerates `HUMAN_ACTION_ON/SELF_RESOLVING/EXTERNAL/CYCLE`; the renamed + new kinds fall through to `default: 99` and sort last, so `AWAITING_HUMAN`/`UNOWNED` (the Needs-you kinds) could rank BELOW `CYCLE`.
**How to avoid:** Update the `priority()` switch to put the needs-you kinds first (`AWAITING_HUMAN`, `UNOWNED` highest), then in-motion/watch. Align with the `tier` ordering. Update `test/shared/blocker-chain.test.mjs` `pickTopChains` cases.

### Pitfall 7: `assigneeAgentId` is available per-node only via a loose cast (not a typed SDK field on the relation summary)
**What goes wrong:** a plan assumes `IssueRelationIssueSummary` (from `@paperclipai/shared`, not introspectable in node_modules) types `assigneeAgentId` on each `blockedBy[]` entry. It may or may not be present at runtime.
**How to avoid:** Follow the established convention — `org-blocked-backlog.ts:202-210` already reads blocker-node fields via a loose inline cast with defensive `?? null` fallbacks. The root-issue `IssueLike` (L122) already declares `assigneeAgentId`. Capture it the same way: `blocker.assigneeAgentId ?? null`. If absent, the node has no agent owner → falls through the cascade to `UNOWNED` or `SELF_RESOLVING`, which is the conservative-correct outcome. **Verify the field is populated against a real BEAAA relations.get during the drill** (the spike confirmed `assigneeAgentId` is a real issue field — 10-03-SPIKE-FINDINGS uses it).

## Code Examples

### Current leaf cascade (the skeleton D-07 extends) — verbatim
```typescript
// Source: src/shared/blocker-chain.ts:147-181 (current)
if (meta?.ownerUserId != null && meta.status === 'awaiting') {
  const terminal: Terminal = { kind: 'HUMAN_ACTION_ON', userId: meta.ownerUserId, label: `${meta.ownerUserId} to act on ${current}` };
  return { startId: input.startId, pathIds, terminal, isStale: false };
}
if (meta?.etaIso != null && meta.ownerUserId == null) {
  const terminal: Terminal = { kind: 'SELF_RESOLVING', etaIso: meta.etaIso, label: `Self-resolving by ${meta.etaIso}` };
  return { startId: input.startId, pathIds, terminal, isStale: false };
}
// Fallback: deterministic unowned terminal (the __unowned__ LIE — D-11 removes this).
const terminal: Terminal = { kind: 'HUMAN_ACTION_ON', userId: '__unowned__', label: `Owner unknown — assign ${current} first` };
return { startId: input.startId, pathIds, terminal, isStale: false };
```

### Current nodeMeta build (where agent ownership must be captured — D-01) — verbatim
```typescript
// Source: src/worker/handlers/org-blocked-backlog.ts:211-223 (current — assigneeAgentId NOT captured per node)
for (const blocker of blockedBy) {
  const toId = blocker.id ?? blocker.issueId ?? blocker.key ?? '';
  if (!toId) continue;
  edges.push({ from: id, to: toId, reason: 'blocks' });
  nodeMeta[toId] = {
    ownerUserId: blocker.assigneeUserId ?? blocker.ownerUserId ?? null,
    etaIso: blocker.etaIso ?? null,
    status: blocker.status ?? 'awaiting',
    // D-01 ADD: assigneeAgentId: (blocker as { assigneeAgentId?: string|null }).assigneeAgentId ?? null,
    // D-01 ADD: agentState: <worker-computed liveness for that agent, or null>
  };
  if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) queue.push({ id: toId, depth: depth + 1 });
}
```

### The Needs-you re-triage string-match to replace (D-13/D-14) — verbatim
```typescript
// Source: src/worker/situation/build-employees-rollup.ts:463-465 (current — the drift D-14 kills)
const unowned = rows.filter(
  (r) => r.group === 'needs_you' && r.blockerChain && r.blockerChain.ownerName === 'Unassigned',
);
// REPLACE WITH: filter on r.blockerChain.verdict.needsYou / verdict.tier === 'needs-you'
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Binary owned/unowned via `__unowned__` sentinel + `ownerName==='Unassigned'` string-match | 8-kind taxonomy + engine-computed verdict (tier/affordance/needsYou) read straight by surfaces | This phase (11) | Removes the fake "assign owner" on every agent-owned row; surfaces stop re-deriving ownership |
| User-only ownership (`assigneeUserId`) in `nodeMeta` | Agent-aware ownership (`assigneeAgentId` + injected liveness) | This phase (11) | Agent-run org rows classify honestly instead of all reading as ownerless |
| Walk-failure mislabeled as `EXTERNAL` (graceful()) | `UNCLASSIFIED` degrade kind, no assign button | This phase (11) | TAX-03 honesty; no false affordance on a build failure |

**Deprecated/outdated by this phase:**
- `UNOWNED_SENTINEL = '__unowned__'` (scrub-human-action.ts:19) — removed (D-11).
- `ownerName === 'Unassigned'` triage predicate (build-employees-rollup.ts, employee-row.tsx, needs-you-banner.tsx) — replaced by verdict fields (D-14).
- `humanize-snapshot.ts` — already a dead JOB path (caller deleted Plan 09-01); kept only for type-validity. Candidate for deletion if no import remains (verify).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `IssueRelationIssueSummary.assigneeAgentId` is populated per `blockedBy[]` node at runtime on BEAAA. | Pitfall 7, Pattern 1 | If absent, agent leaves classify as UNOWNED/SELF_RESOLVING (conservative-safe) but TAX-01 agent-ownership coverage degrades. **Verify with a real `relations.get` during the drill.** The spike confirmed `assigneeAgentId` exists as an issue field; whether it rides on the *relation summary* node specifically is the open bit. |
| A2 | The worker can source the expected heartbeat cadence (D-03 "2× expected interval") at its boundary. | D-03, Pattern 1 | If no cadence is exposed, the worker must fall back to a fixed window (the `STALE_WINDOW_MS`/`RUNNING_WINDOW_MS` constants already in `classify-employee-state.ts` are the existing precedent: 5min running / 24h stale). D-04 (missing⇒stuck) bounds the failure to conservative. |
| A3 | `humanize-snapshot.ts` is dead at runtime (no live caller) but still compiled. | Pitfall 1, State of the Art | If it has a live caller after all, its switch update is load-bearing, not cosmetic. Verified no import in the consumer grep, but confirm `register*` wiring in `worker.ts` does not invoke it. |
| A4 | No persisted artifact stores the terminal kind (everything computed fresh). | Runtime State Inventory | If a cache table did store kinds, a migration would be needed. Verified: `situation_snapshots` is dead/unwritten; `situation.snapshot` computes fresh (situation-room.ts). |

## Open Questions

1. **Should `walkBlockerChain` (Reader) be fully collapsed into the shared `buildEdges` this phase, or just kept-in-sync?**
   - What we know: they are duplicate BFS builders; divergence breaks SC5.
   - What's unclear: the collapse touches the Reader handler's ctx typing (`PluginIssuesClient` vs the structural `OrgBlockedBacklogCtx`).
   - Recommendation: collapse if it fits the wave budget; otherwise add a same-shape test and thread identical fields. Either way the `nodeMeta` field set MUST match.

2. **Does the `maxSteps`-exceeded internal fallthrough (blocker-chain.ts:190-196) become `UNCLASSIFIED` or stay `CYCLE`?**
   - What we know: D-10 text ("depth/maxSteps exceeded" → unclassified) favors `UNCLASSIFIED`; the current code emits `CYCLE`.
   - Recommendation: emit `UNCLASSIFIED` for the depth-limit path (still deterministic, no clock) to match D-10 exactly; keep real cycle-detection (L75-101) as `CYCLE`.

3. **Should the dead `humanize-snapshot.ts` be deleted rather than migrated?**
   - What we know: its caller was deleted in Plan 09-01; it's compiled by `typecheck` only.
   - Recommendation: confirm zero imports, then either delete (cleanest) or update its switch. Deletion removes one exhaustiveness site from the checklist.

## Environment Availability

> Skipped — this phase has no NEW external dependencies. It is a code-only refactor using the already-installed `@paperclipai/plugin-sdk@2026.512.0`, TypeScript `^5.7.3`, and the `node --test` runner (all present per `package.json` and `node_modules/`). The only "environment" touch is the optional **live BEAAA drill** to verify A1 (per-node `assigneeAgentId` population) — reachable via the documented `ariclaw` SSH + DO-backup bookend (MEMORY: beaaa-deploy-mechanics), but the engine + consumer tests are fully exercisable offline with stubbed ctx (the established `makeCtx`/`makeJobCtx` plain-object stub idiom).

## Security Domain

> `security_enforcement` is not set false in config; included. This phase is read-only classification (CTT-07 no-mutate invariant holds **by construction** — the engine and its consumers do not write to `public.*`). The only security-relevant control is NO_UUID_LEAK.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched. |
| V3 Session Management | no | — |
| V4 Access Control | yes (inherited) | Viewer-scoping already enforced: `needsYou`/`need_you_count` key on the UI-supplied `viewerUserId` (situation-room.ts:81-82, org-blocked-backlog.ts:370-374). Preserve when re-triaging off the verdict. |
| V5 Input Validation | yes | `nodeMeta` fields read via defensive `?? null` casts (org-blocked-backlog.ts:202-219). New `assigneeAgentId`/`agentState` reads must keep the same defensive posture. |
| V6 Cryptography | no | — |
| V7 Information Disclosure (NO_UUID_LEAK) | yes — **primary** | Never render `targetAgentUuid`/`targetIssueUuid` as text (D-15). `awaitedPartyLabel` produced via `scrubHumanAction` with zero raw UUIDs. Mirrors the proven v1.3.0 R3 `leafIssueUuid` split (build-employees-rollup.ts:75-80). UUID-shape source-scan tests pin it. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Raw UUID rendered as operator-facing text | Information Disclosure | `scrubHumanAction` + split-identity verdict fields (D-15); source-scan + render-scan tests. |
| Cross-tenant disclosure via shared lookup | Information Disclosure | Per-company `companyId` scoping on every `ctx.issues.*`/`ctx.agents.*` call (already enforced). v1 is single-tenant but the contract is documented (humanize-snapshot.ts:13-17). |
| Engine reads a clock/AI → non-determinism / purity break | Tampering | SC4 determinism test + AI-token grep guard; liveness injected (D-01). |
| Plugin mutates a core `public.*` table | Tampering | CTT-07 holds by construction (read-only classification); no `ctx.issues.update` in any Phase 11 path. |

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/shared/blocker-chain.ts` — current `flattenBlockerChain` cascade (L49-197), `pickTopChains` (L211-230), `__unowned__` fallback (L176-181).
- `src/shared/types.ts` — `Terminal` union (L38-42), `BlockerChainResult` (L44-49).
- `src/shared/scrub-human-action.ts` — `UNOWNED_SENTINEL` (L19), scrub logic (L46-76).
- `test/shared/blocker-chain.test.mjs` — determinism (L92-114), AI-token grep guard (L192-199), per-kind + `pickTopChains` cases.
- `src/worker/handlers/org-blocked-backlog.ts` — `buildEdges` nodeMeta build (L167-226), ranking + scrub + need_you (L295-397).
- `src/worker/situation/build-employees-rollup.ts` — chain pipeline (L274-374), Needs-you string-match (L463-465).
- `src/worker/situation/classify-employee-state.ts` — pure 5-state classifier, injected `nowMs` (L18-62) — liveness precedent.
- `src/worker/handlers/flatten-blocker-chain.ts` — duplicate `walkBlockerChain` (L74-127), `graceful()` EXTERNAL lie (L129-141).
- `src/worker/jobs/humanize-snapshot.ts` — exhaustive `switch`+`never` guard (L155-172), `__unowned__` handling (L112).
- `src/worker/handlers/situation-room.ts` — `situation.snapshot` fresh-compute, no persistence (L68-135).
- `src/ui/surfaces/{situation-room/{employee-row,needs-you-banner,owner-picker-popover,index,org-blocked-backlog-banner-types},reader/{index,live-blocker-panel}}.tsx/.ts` — UI read sites.
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` §3 Section 1 (taxonomy table), §2, §5.
- `.planning/phases/11-honest-blocker-taxonomy-engine/11-CONTEXT.md` — D-01..D-16.
- `.planning/phases/10-unblock-resume-spike/10-03-SPIKE-FINDINGS.md` — comment-alone resumes Shapes A & B (informs `reply`/`nudge` affordance validity).
- `.planning/{ROADMAP,REQUIREMENTS}.md` — Phase 11 goal, SC1..SC5, TAX-01/02/03.
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — `PluginIssuesClient.relations` returns `IssueRelationIssueSummary[]` (from `@paperclipai/shared`); `Issue.assigneeAgentId` (L925); `PluginAgentsClient.list/get` (L1158+).
- `CLAUDE.md` — PRIM-03 engine purity, NO_UUID_LEAK, CTT-07, additive-schema, forced stack pins.
- `.planning/config.json` — `nyquist_validation: false` (Validation Architecture section omitted).

### Secondary / Tertiary
- None. Every claim is sourced from first-party repo files read this session.

## Metadata

**Confidence breakdown:**
- Consumer map (8 code files + tests): HIGH — every file read end-to-end; false positives explicitly disproven.
- Engine cascade / determinism contract: HIGH — read `blocker-chain.ts` + its test verbatim.
- Type migration scope (the `never` compile gate): HIGH — exhaustive switch located and read.
- Agent-ownership per-node availability (A1): MEDIUM — `assigneeAgentId` is a real issue field (confirmed) and read elsewhere via loose cast; whether it rides on the *relation summary node* specifically needs a live `relations.get` check. Bounded by D-04 (missing⇒stuck) so a miss is conservative.
- Liveness cadence sourcing (A2/D-03): MEDIUM — the codebase has fixed-window precedent (`classify-employee-state.ts`); whether the host exposes a per-agent expected cadence is unverified, but the fallback is established.

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 (stable — first-party code; only the host SDK shape or a BEAAA host bump could invalidate A1/A2)
