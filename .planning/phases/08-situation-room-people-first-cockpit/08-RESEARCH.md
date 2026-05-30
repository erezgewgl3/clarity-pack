# Phase 8: Situation Room people-first cockpit — Research

**Researched:** 2026-05-30
**Domain:** Clarity Pack v1.2.0 — Situation Room redesign (worker handler extension + UI roll-up)
**Confidence:** HIGH (all SDK surfaces verified against `node_modules/@paperclipai/{plugin-sdk,shared}/dist/types`; all reuse targets confirmed from existing source; Plan 07-03 NO_UUID_LEAK lesson read end-to-end)

## Summary

Phase 8 is **additive** to a Situation Room that already ships ROOM-12 (org-blocked-backlog), ROOM-09/10/11 (engagement entry, artifact chips, Critical Path), and ROOM-01..08 (agent grid). The whole `situation.snapshot` HTTP-request scope is alive and proven (Plan 07-03 lived in it). Phase 8 widens the handler's return shape to include `employees: SituationEmployeeRow[]`, computes it from `ctx.agents.list` + a per-agent `ctx.issues.list({ companyId, assigneeAgentId, status })` walk, polishes `focusLine` with the existing `polishTldr`, reuses the `flattenBlockerChain` + `pickTopChains` + `scrubHumanAction` pipeline byte-identical (the NO_UUID_LEAK guarantee comes free), and renders one row strip + one needs-you banner.

**Critical realization that simplifies the plan:** the `@paperclipai/shared` `Agent` interface (verified at `node_modules/.pnpm/@paperclipai+shared@2026.512.0/.../dist/types/agent.d.ts:54-78`) already carries `lastHeartbeatAt: Date | null` and `title: string | null`. **Phase 8 does NOT need to hit the `/api/companies/<id>/heartbeat-runs` REST feed** — the heartbeat timestamp is on the agent object itself. This eliminates the `ctx.http.fetch` capability dependency from Plan 07-03's stack and shortens the per-employee compute to two SDK calls (`agents.list` + `issues.list`).

**Primary recommendation:** Ship as 3 plans — Plan 08-01 (worker handler extension + classifier + tests), Plan 08-02 (UI row strip + state-pill tokens + banner rewire + CSS + tests), Plan 08-03 (BEAAA live drill). The worker tier is largest because the classifier is new; the UI tier is mostly the row component + 5 new CSS tokens + a banner replacement.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Roster read (17 agents on BEAAA) | Worker (`ctx.agents.list`) | — | SDK-blessed, same call Plan 04-04 chat-roster uses; never from UI |
| Per-agent assigned-issues read | Worker (`ctx.issues.list({assigneeAgentId, status})`) | — | UI never hits Paperclip HTTP directly (SCAF-05); SDK list filter handles this |
| State classification (running/reviewing/blocked/idle/stale) | Worker (pure classifier `src/worker/situation/classify-employee-state.ts`) | — | Locked deterministic boundaries; unit-testable; UI consumes the enum |
| Heartbeat timestamp | Already on Agent (`lastHeartbeatAt`) | — | No new feed call — the SDK Agent type carries it |
| `focusLine` polish | Worker (`polishTldr` from `compile-tldr.ts`) | — | Same pipeline as Reader + Chat (v1.1.11). Pure, no I/O, safe to call N=17 times |
| Blocker-chain flatten | Worker (`flattenBlockerChain` + `pickTopChains` + `scrubHumanAction`) | — | Reuse byte-identical (single source of truth per Plan 07-03) |
| Owner-name resolution (NO_UUID_LEAK) | Worker (`ctx.agents.get` D-09 pattern) | — | Mirror Plan 07-03 `org-blocked-backlog.ts:386-407`; degrade silently to null/"Unassigned" |
| Sort (blocked → stale → idle → reviewing → running) | Worker (deterministic) | — | UI consumes verbatim; testable in classifier suite |
| Needs-you banner | UI (top of `situation-room` surface) | Worker (computes `needsYou` count + topAction) | Banner replaces the v1.1.11 `clarity-blocked-banner` toggle; data computed once at handler time |
| Row state pills + chain leaf inline | UI (`src/ui/surfaces/situation-room/employee-row.tsx` new) | — | All UI text comes from worker-already-polished fields; no UI re-derivation |
| Open-chat affordance per row | UI (reuses `buildChatDeepLink({route:'employee-only'})`) | — | URL_HASH carrier; single source of truth; same pattern as ROOM-09/12 |
| Coexistence with ROOM-12 | UI composition (Phase 8 banner ABOVE; ROOM-12 backlog SECONDARY collapsed panel) | — | Additive only; ROOM-12 worker payload and UI component byte-identical |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Primary axis — People-first cockpit (LOCKED).** Rejected: editorial tri-panel, heatmap grid.

**Idle-agent posture — Loud (idle is a CEO problem) (LOCKED).** Idle agents render amber and bubble up near stuck. Rejected: quiet/gray, stale-only.

**"Needs you" surface placement — Top banner only (LOCKED).** One persistent line: `⚠ N things need you → <single most-urgent action>`. Click jumps to the responsible agent row + opens chat. Rejected: per-row highlight, both.

**State enum (deterministic classifier):** Exactly `running` | `reviewing` | `blocked` | `idle` | `stale` (plus `unknown` for degrade). Boundaries:
- `running` = active heartbeat-run in last 5 min
- `reviewing` = open assigned issue with `status='in_review'` AND no active run
- `blocked` = open assigned issue with `status='blocked'`
- `idle` = no open assigned issue AND last activity < 24h
- `stale` = no open assigned issue AND last activity ≥ 24h

Classifier lives in `src/worker/situation/classify-employee-state.ts`. Single source of truth.

**Focus-line voice (Reader parity):** `focusLine` MUST be polished by `polishTldr()`. ISO→human dates, restated-paren strip, lone-ref-paren strip, jargon glossary. Identical voice, identical code path. Source: focus issue's compiled TL;DR (if present) → polish; else issue title → polish. Truncated at worker tier to ~80 chars. `null` for idle/stale.

**Blocker-chain reuse (NO new logic):** Consume `src/shared/blocker-chain.ts` `flattenBlockerChain` + `pickTopChains` (already exported as of Plan 07-03) + the `scrubHumanAction` mirror from Plan 07-03 hotfix `35d4945`. NO_UUID_LEAK preserved by construction.

**Sort posture (idle-loud):** `blocked` (oldest blocker age first) → `stale` (oldest activity first) → `idle` (oldest activity first) → `reviewing` → `running` (most recently active first). UI consumes verbatim.

**Coexistence with ROOM-12:** ROOM-12 stays byte-identical. Phase 8 adds `employees: SituationEmployeeRow[]` alongside `org_blocked_backlog`. Phase 8's needs-you banner replaces the v1.1.11 `clarity-blocked-banner` toggle; ROOM-12 backlog becomes a secondary collapsed panel below.

**Explicitly NOT in scope:** No new schema, no new runtime dependency, no re-implementation of blocker-chain logic, no changes to Reader/Chat/Bulletin surfaces, no per-row needs-you highlight, no heatmap/grid layout.

### Claude's Discretion

- Exact CSS token values (within the design system's amber/green family).
- Sort tie-breakers WITHIN a bucket beyond what's specified above.
- Exact bundle-size delta budget — recalibrate per Phase 5/7 precedent if needed.
- Test fixture shapes for the classifier (state transitions at exact threshold boundaries).
- Whether to ship as one plan or split into worker/UI/drill plans.

### Deferred Ideas (OUT OF SCOPE)

- Per-row "needs you" highlight — REJECTED.
- Editorial tri-panel layout — REJECTED.
- Heatmap grid layout — REJECTED.
- Done-today rolling strip — nice-to-have, planner discretion.
- Tap-to-stand-down for stale agents — defers a new write path; follow-up phase.
- CTO agent-state inference from chat last-message-from — defer; `lastActivityAt` covers 90%.
- Per-employee mini-chart (7-day throughput) — separate analytics surface; defer.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROOM-13 | `situation.snapshot` returns `employees: SituationEmployeeRow[]` alongside `org_blocked_backlog`. One row per company-scope agent; degrade-safe per-row; instance-agnostic; NO migration. | Handler extension at `src/worker/handlers/situation-room.ts` (already widened with `issues` + `agents` in Plan 07-03). New per-employee builder mirrors `org-blocked-backlog.ts` structure. |
| ROOM-14 | State classifier deterministic + pure-function-testable; 5 states + `unknown`; thresholds 5min/4h/24h. | New file `src/worker/situation/classify-employee-state.ts`; Agent.`lastHeartbeatAt` + Issue.`status` + Issue.`lastActivityAt` are all on existing SDK types. |
| ROOM-15 | `focusLine` polished by `polishTldr()`. Falls back from TL;DR → title; truncated to ~80 chars at worker tier. | `polishTldr` exported at `src/worker/agents/compile-tldr.ts:370`. Pure. Same wire pattern as `src/worker/handlers/chat-messages.ts:398`. |
| ROOM-16 | `blockerChain: {rootIssueId, leafIssueId, humanAction, ownerName, ownerAgentId}` reuses Plan 07-03 pipeline. `ownerName: 'Unassigned'` for `__unowned__`. | `flattenBlockerChain` + `pickTopChains` + `scrubHumanAction` directly importable from existing modules. |
| ROOM-17 | Sort blocked → stale → idle → reviewing → running, oldest-first within bucket. Amber styling for idle/stale; green for running/reviewing. | Pure sort at worker tier; 5 new CSS tokens at `src/ui/primitives/theme.css` (no existing tokens for these state names). |
| ROOM-18 | One persistent top banner; `needsYou.count` = rows where `blockerChain.ownerAgentId === viewerAgentId`; click → open chat with chain owner via `buildChatDeepLink({route:'employee-only'})`. | `buildChatDeepLink` employee-only carrier proven in Plan 07-03. |

## Standard Stack

### Core (FORCED — already in repo, no install)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@paperclipai/plugin-sdk` | 2026.512.0 (or 2026.525.0 — host pin) | `ctx.agents.list` + `ctx.agents.get` + `ctx.issues.list` + `ctx.issues.get` + `ctx.issues.relations.get` | The only public worker API; same as Plan 07-03 |
| TypeScript | ^5.7.3 | Type-check on the new classifier + `SituationEmployeeRow` shape | Host pin; matches existing codebase |
| esbuild | ^0.27.3 | UI bundle | Host pin; same as Plan 07-03 |
| React | peer ^19 | Row strip + banner components | Externalized per CLAUDE.md |

### Supporting (already imported elsewhere — REUSE; do not re-import differently)
| Function / Module | File | Purpose |
|---|---|---|
| `flattenBlockerChain` | `src/shared/blocker-chain.ts:49` | Deterministic DFS → single Terminal per chain |
| `pickTopChains` | `src/shared/blocker-chain.ts:211` | HUMAN_ACTION_ON-first ranking (single source of truth, exported Plan 07-03 Task 1) |
| `polishTldr` | `src/worker/agents/compile-tldr.ts:370` | Pure 4-pass polish: isoDateToHuman → stripRestatedParenAfterRef → stripParensAroundLoneRef → applyJargonGlossary. Returns `''` on empty input. |
| `scrubHumanAction` (the Plan 07-03 mirror) | `src/worker/handlers/org-blocked-backlog.ts:85-115` | Strips raw UUIDs from `terminal.label`. **Currently NOT exported** — see [Pitfall 1](#pitfall-1) below. |
| `buildChatDeepLink({route:'employee-only'})` | `src/ui/surfaces/chat/deep-link.mjs:152-164` | URL_HASH carrier for open-chat affordance |
| `formatAge(ms)` | `src/ui/primitives/state-pill-format.ts:37` | Age formatter: `<1m / Nm / Nh / Nd`. Returns `?` on `<0`/non-finite. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| `Agent.lastHeartbeatAt` (already on SDK type) | Hit `/api/companies/<id>/heartbeat-runs?limit=N` via `ctx.http.fetch` | Extra HTTP, extra capability, network failure surface | **Use lastHeartbeatAt** — no HTTP needed. The console-log evidence at `.playwright-mcp/console-2026-05-29T13-21-32-738Z.log:18` shows the heartbeat-runs endpoint exists, but the SDK already exposes the timestamp on the Agent object via `lastHeartbeatAt: Date \| null`. |
| New per-agent state field on `clarity_user_prefs` | Compute fresh in `situation.snapshot` data handler | Adds migration + storage path for derived data | **Compute fresh** — Plan 07-03 precedent; locked decision says NO new schema. |
| New `polish-focus-line.ts` helper | Inline `polishTldr` call in handler | Duplicates polish pipeline; voice drift risk | **Reuse `polishTldr` directly** — locked decision says identical code path. |

**Installation:** None — all dependencies are already in the repo. No new `pnpm install`.

**Version verification:** N/A — Phase 8 adds no external packages. Verified by reading `package.json` `dependencies` (held byte-identical at Plan 07-03 close: `clarity-pack@1.0.0`).

## Package Legitimacy Audit

Phase 8 installs **zero new packages** — all functions are imported from existing files in `src/`. No registry verification needed; no slopcheck run needed. The `package.json` `dependencies` field stays byte-identical from v1.1.11 ship (per locked decision "NO new runtime dependency"). This is the strongest possible legitimacy posture — nothing to audit because nothing is added.

## Architecture Patterns

### System Architecture Diagram

```
                           ┌─────────────────────────────────────────────┐
                           │  Browser tab: /<prefix>/situation-room      │
                           │  (data-clarity-surface="situation-room")    │
                           └───────────────┬─────────────────────────────┘
                                           │  React 19 (peer, not bundled)
                                           ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  index.tsx <SituationRoomBody>                       │
                  │  usePluginData('situation.snapshot', {companyId,...})│
                  │  ┌────────────────────────────────────────────────┐  │
                  │  │  <NeedsYouBanner needsYou={…} />               │  │
                  │  │  <EmployeeRowStrip employees={…} />            │  │
                  │  │     └→ buildChatDeepLink('employee-only')      │  │
                  │  │  <OrgBlockedBacklogBanner backlog={…} />       │  │
                  │  │     (ROOM-12, collapsed by default)            │  │
                  │  │  <AgentGrid /> (ROOM-01..08 byte-identical)    │  │
                  │  └────────────────────────────────────────────────┘  │
                  └───────────────┬─────────────────────────────────────┘
                                  │  RPC bridge (host injects ctx)
                                  ▼
       ┌──────────────────────────────────────────────────────────────────┐
       │  Worker process — situation.snapshot data handler                 │
       │  (src/worker/handlers/situation-room.ts)                          │
       │                                                                    │
       │  ┌─────────────────────────────────────────────────────────────┐  │
       │  │ Plan 07-03 (UNCHANGED):                                       │ │
       │  │   buildOrgBlockedBacklog(ctx, companyId, viewerUserId)        │ │
       │  │      → org_blocked_backlog                                    │ │
       │  └─────────────────────────────────────────────────────────────┘  │
       │                                                                    │
       │  ┌─────────────────────────────────────────────────────────────┐  │
       │  │ Plan 08-01 (NEW):                                             │ │
       │  │   buildEmployeesRollup(ctx, companyId, viewerUserId)          │ │
       │  │                                                                │ │
       │  │   1. ctx.agents.list({companyId})           → 17 Agents       │ │
       │  │   2. For each agent (sequential; degrade-safe per row):       │ │
       │  │        a. ctx.issues.list({companyId, assigneeAgentId,        │ │
       │  │              status: 'in_progress'/'in_review'/'blocked'})    │ │
       │  │        b. classifyEmployeeState({agent, openIssues})          │ │
       │  │              → 'running'|'reviewing'|'blocked'|'idle'|'stale' │ │
       │  │        c. Pick focus issue (status priority + most recent)    │ │
       │  │        d. ctx.issues.get(focus.id) → body for TL;DR source    │ │
       │  │           (or just title fallback)                            │ │
       │  │        e. polishTldr(tldr-or-title).slice(0, 80) → focusLine  │ │
       │  │        f. IF state==='blocked': buildEdges() +                │ │
       │  │           flattenBlockerChain() + pickTopChains(_, 1) +       │ │
       │  │           scrubHumanAction() + agents.get(ownerUuid).name     │ │
       │  │   3. sortBuckets() → blocked → stale → idle → reviewing →    │ │
       │  │       running                                                  │ │
       │  │   4. computeNeedsYou(rows, viewerAgentId) →                   │ │
       │  │       {count, topAction}                                       │ │
       │  │                                                                │ │
       │  │   → {employees, needsYou}                                      │ │
       │  └─────────────────────────────────────────────────────────────┘  │
       │                                                                    │
       │  Return: {org_blocked_backlog, employees, needsYou, taken_at}     │
       └────────────────────────────────────────────────────────────────────┘
```

The flow is **identical in shape to Plan 07-03's**: same handler scope, same degrade-safe pattern (per-row try/catch), same SDK calls, same NO_UUID_LEAK guard, same instance-agnostic posture. The only structural addition is the per-agent `issues.list` loop.

### Recommended Project Structure

```
src/worker/
├── situation/                       # NEW directory
│   ├── classify-employee-state.ts   # NEW (pure classifier, ROOM-14)
│   └── build-employees-rollup.ts    # NEW (the per-agent builder, ROOM-13/15/16/17)
├── handlers/
│   ├── situation-room.ts            # MODIFY — wire build-employees-rollup
│   └── org-blocked-backlog.ts       # UNCHANGED (but see Pitfall 1 — may need to export scrubHumanAction)
└── agents/
    └── compile-tldr.ts              # UNCHANGED (polishTldr already exported)

src/ui/surfaces/situation-room/
├── employee-row-strip.tsx           # NEW (ROOM-17 rendering)
├── employee-row.tsx                 # NEW (single row + state pill + chain leaf)
├── needs-you-banner.tsx             # NEW (ROOM-18 — replaces the v1.1.11 toggle layout)
├── org-blocked-backlog-banner.tsx   # UNCHANGED (Plan 07-03)
├── agent-card.tsx                   # UNCHANGED (Phase 8 doesn't replace per-card grid; lives below the strip)
└── index.tsx                        # MODIFY — mount NeedsYouBanner + EmployeeRowStrip

src/ui/primitives/
└── theme.css                        # MODIFY — add 5 state tokens

test/worker/situation/
├── classify-employee-state.test.mjs # NEW (every state transition boundary)
└── build-employees-rollup.test.mjs  # NEW (mirrors org-blocked-backlog.test.mjs)

test/ui/surfaces/situation-room/
├── employee-row-strip.test.mjs      # NEW (source-grep idiom, no jsdom)
└── needs-you-banner.test.mjs        # NEW
```

### Pattern 1: Worker handler extension (mirror Plan 07-03)

**What:** Widen `situation.snapshot` to compute `employees` + `needsYou` alongside `org_blocked_backlog`.

**Example (from `src/worker/handlers/situation-room.ts:66-112` — current state):**
```typescript
export function registerSituationRoomHandlers(ctx: SituationRoomCtx): void {
  wrapDataHandler(ctx, 'situation.snapshot', async (params) => {
    const companyId = ...;
    const viewerUserId = ...;

    // EXISTING (Plan 07-03):
    let org_blocked_backlog: OrgBlockedBacklog;
    try {
      org_blocked_backlog = await buildOrgBlockedBacklog(ctx, companyId, viewerUserId);
    } catch (e) {
      ctx.logger?.warn?.(...);
      org_blocked_backlog = { ...EMPTY_BACKLOG };
    }

    // NEW (Plan 08-01):
    let employees: SituationEmployeeRow[] = [];
    let needsYou: NeedsYou = { count: 0, topAction: null };
    try {
      const rollup = await buildEmployeesRollup(ctx, companyId, viewerUserId);
      employees = rollup.employees;
      needsYou = rollup.needsYou;
    } catch (e) {
      ctx.logger?.warn?.('situation.snapshot: employees rollup failed', { ... });
      // degrade silently; org_blocked_backlog + agent grid still render
    }

    const rows = await ctx.db.query<SnapshotRow>('SELECT … situation_snapshots …', [companyId]);
    const row = rows[0];
    if (!row) {
      return { org_blocked_backlog, employees, needsYou, taken_at: new Date().toISOString() };
    }
    const payload = row.payload as Record<string, unknown>;
    return { ...payload, org_blocked_backlog, employees, needsYou, taken_at: row.taken_at };
  });
}
```

### Pattern 2: Pure classifier (deterministic, no I/O)

**Source:** `src/worker/situation/classify-employee-state.ts` (NEW file)

```typescript
// Pure — testable in stock node:test, no SDK import.
export type EmployeeState = 'running' | 'reviewing' | 'blocked' | 'idle' | 'stale' | 'unknown';

export type ClassifyInput = {
  /** Agent.lastHeartbeatAt as ms-since-epoch, or null. */
  lastHeartbeatMs: number | null;
  /** Most-recent open assigned issue's status (priority: blocked > in_review > in_progress). */
  topOpenIssueStatus: 'in_progress' | 'in_review' | 'blocked' | null;
  /** Last activity (heartbeat OR most-recent issue lastActivityAt — whichever is more recent), ms. */
  lastActivityMs: number | null;
  /** Now() injected for testability. */
  nowMs: number;
};

const RUNNING_WINDOW_MS = 5 * 60 * 1000;       // 5 min
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24h

export function classifyEmployeeState(input: ClassifyInput): EmployeeState {
  const { lastHeartbeatMs, topOpenIssueStatus, lastActivityMs, nowMs } = input;
  const heartbeatAge = lastHeartbeatMs != null ? nowMs - lastHeartbeatMs : Infinity;
  const activityAge = lastActivityMs != null ? nowMs - lastActivityMs : Infinity;

  if (heartbeatAge < RUNNING_WINDOW_MS) return 'running';
  if (topOpenIssueStatus === 'in_review') return 'reviewing';
  if (topOpenIssueStatus === 'blocked') return 'blocked';
  if (topOpenIssueStatus == null) {
    // No open assigned issue → idle/stale based on activity age
    if (!Number.isFinite(activityAge) || activityAge >= STALE_WINDOW_MS) return 'stale';
    return 'idle';
  }
  // Has an in_progress open issue but no recent heartbeat → still classify as
  // running (the LOCKED definition says active-heartbeat OR active-in_progress;
  // operator semantics treat in_progress as "moving"). Defer to running for the
  // happy case; if heartbeat is also stale this would arguably go to a different
  // bucket — discuss with planner if edge becomes load-bearing.
  return 'running';
}
```

### Pattern 3: `focusLine` polish wire-in (mirror chat-messages.ts:398)

```typescript
import { polishTldr } from '../agents/compile-tldr.ts';
// ...
const rawFocus = tldrCache?.body ?? focusIssue?.title ?? '';
const polished = polishTldr(rawFocus);
const focusLine = polished.length > 80 ? polished.slice(0, 77) + '…' : polished || null;
```

**Note on `polishTldr` purity:** verified at `compile-tldr.ts:370-378` — no I/O, no async, runs 4 regex passes (`isoDateToHuman`, `stripRestatedParenAfterRef`, `stripParensAroundLoneRef`, `applyJargonGlossary`), returns `''` on empty input. Safe to call 17 times per request (cost dominated by the I/O above; polish itself is microseconds).

### Pattern 4: Banner replacement strategy

The v1.1.11 surface has a `clarity-blocked-banner` toggle (collapsible "32 blocked · 0 need you"). Phase 8's locked design says the new top banner is ALWAYS-VISIBLE (no toggle) and reads:

- `⚠ N things need you → <topAction.humanAction>` when `needsYou.count > 0`
- `✓ 0 need you — N moving · M idle · K stuck` when `needsYou.count === 0`

The ROOM-12 backlog **is not removed** — it moves to a secondary collapsed panel below the employee strip. Mount order in `index.tsx`:
1. `<NeedsYouBanner needsYou={payload.needsYou} />` (NEW — Phase 8 top)
2. `<EmployeeRowStrip employees={payload.employees} />` (NEW — Phase 8 main)
3. `<OrgBlockedBacklogBanner backlog={payload.org_blocked_backlog} companyId={...} />` (UNCHANGED — Plan 07-03, but force `defaultExpanded={false}` since it's secondary now)
4. `<header className="clarity-room-header">` with `<AwaitingYouPill>` (UNCHANGED)
5. `<CriticalPathStrip>` (UNCHANGED)
6. `<AgentGrid>` (UNCHANGED)

**Note on `OrgBlockedBacklogBanner` `defaultExpanded`:** currently auto-expands when `needYouCount > 0` (per Plan 07-03 SUMMARY decision). Phase 8 should override this — the new top banner now carries the urgency; ROOM-12 backlog stays collapsed-by-default for both states. If this requires a prop change, document it.

### Anti-Patterns to Avoid

- **Re-implementing the blocker-chain walk inside `build-employees-rollup.ts`.** The org-blocked-backlog builder already has `buildEdges()` at `org-blocked-backlog.ts:216-275`. Either factor it out to a shared helper or import it. Do NOT copy-paste the BFS.
- **Calling `polishTldr` in the UI tier.** Voice consistency requires single-source compute. Worker tier polishes once; UI renders text nodes.
- **Inserting `dangerouslySetInnerHTML` anywhere in the new components.** Plan 07-03's banner is text-nodes-only; Phase 8 follows. The Reader v1.1.x markdown chip pipeline lives only on Reader/Bulletin TL;DR surfaces.
- **Adding a 6th state to the enum.** The classifier is locked at 5 + `unknown`. If a per-row defect needs a new state (e.g. "paused"), the row's `state` field can degrade to `unknown` and the UI renders a neutral pill.
- **Re-deriving `focusLine` from `now_doing` (the Phase 2 EmployeeSnapshot field).** That field is populated by the scope-dead `recompute-situation` job and is unreliable on BEAAA. Phase 8 reads fresh from `ctx.issues.list` in the data handler.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Blocker-chain flattening | Custom DFS | `flattenBlockerChain` (`src/shared/blocker-chain.ts:49`) | PRIM-03 invariant; deterministic; cycle detection; LLM-free terminal selection — pinned by grep guard test |
| HUMAN_ACTION_ON-first ranking | Custom sort | `pickTopChains` (`src/shared/blocker-chain.ts:211`) | Plan 07-03 made it the single source of truth; the snapshot job + org-blocked-backlog builder both import it |
| Per-issue edge graph build | Custom BFS over relations | Either factor the existing BFS out of `org-blocked-backlog.ts:216-275` OR import it after exporting from that module | Same `MAX_CHAIN_DEPTH=6`, same `relations.get` pattern; consistency wins |
| UUID-free `humanAction` label | Custom regex strip | `scrubHumanAction` (`org-blocked-backlog.ts:85`) — currently a file-private helper; export it OR mirror it in the new builder | Plan 07-03 hotfix `35d4945` proved a unit-test miss; the only safe pattern is sharing the function |
| Focus-line voice polish | Re-write date formatter | `polishTldr` (`compile-tldr.ts:370`) | Reader + Chat both use this; voice consistency is a locked decision |
| Owner-name resolution | Custom `agents.get` | The D-09 pattern (`org-blocked-backlog.ts:386-407` — dedupe distinct UUIDs, parallel `ctx.agents.get`, degrade null on throw) | NO_UUID_LEAK is asserted by tests; the pattern degrades silently to null which the UI renders as "Unassigned" |
| Open-chat deep-link build | Custom URL build | `buildChatDeepLink({route:'employee-only', companyPrefix, assigneeAgentId})` (`deep-link.mjs:152`) | URL_HASH carrier is the only one the host preserves end-to-end (proven by Plan 04.2-03 carrier-survival probe); single source of truth |
| Age formatting | Custom `ms → human` | `formatAge` (`state-pill-format.ts:37`) | Already used in the agent card, awaiting-you pill, org-blocked-backlog banner — consistency |
| Heartbeat freshness read | `ctx.http.fetch('/api/companies/X/heartbeat-runs?limit=N')` | `Agent.lastHeartbeatAt` (already on the SDK type) | No HTTP, no capability dependency, no network failure — the timestamp ships with `agents.list()` |

**Key insight:** Phase 8 is structurally **lean** because the Situation Room has already accumulated 7 phases worth of pipeline code. The deep work was done by Plans 02-04/02-08 (chain + humanize), 06.1-06 (viewer-id substitution), 07-03 (org backlog + scrubHumanAction). Phase 8 binds them with a new axis (per-employee rows) and a new top-banner UI — but reaches for zero new primitives.

## Runtime State Inventory

> Phase 8 is a **feature addition**, not a rename/refactor. Skipping the migration-style inventory.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 8 computes at HTTP-request time; no schema change | None |
| Live service config | None — no cron/job changes; the dead `recompute-situation` job stays dead | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | The dist UI bundle will grow (estimated +6-10kB per Plan 07-03/07-05 precedent). The ceiling at `scripts/check-ui-bundle-size.mjs:149` is currently **716 kB**; Phase 8 will likely need a recalibration to ~720-724 kB (justified by the new banner + row strip components). | Recalibrate `UI_BUNDLE_BYTES_CEILING` in the same plan that adds the UI tier; document deltas; verify zero SheetJS sentinels. |

## Common Pitfalls

### Pitfall 1: `scrubHumanAction` is file-private to `org-blocked-backlog.ts`

**What goes wrong:** Plan 07-03 hotfix `35d4945` added `scrubHumanAction` as a non-exported local function at `org-blocked-backlog.ts:85-115`. Phase 8's per-employee builder needs the same NO_UUID_LEAK guard at the chain terminal. If Plan 08-01 copy-pastes it, a future blocker-chain change requires fixing it in two places.

**Why it happens:** The function is tightly bound to the file's UUID regex constants (`UUID_RE_G`, `UUID_RE_G`, the `UNOWNED_SENTINEL`) and the `nameByUuid` Map shape — when Plan 07-03 shipped, it was the only caller.

**How to avoid:** Plan 08-01 should `export function scrubHumanAction` from `org-blocked-backlog.ts` (or extract it into a new `src/shared/scrub-human-action.ts` alongside the other shared chain helpers) and import it from the new per-employee builder. The other UUID regex constants (`UUID_RE_G`, `UNOWNED_SENTINEL`) should travel with it.

**Warning signs:** A test that asserts `row.humanAction` contains no UUID exists for the org-backlog rows (Plan 07-03 hotfix tests). Phase 8 needs the equivalent test on `employees[i].blockerChain.humanAction`. If you find yourself writing the regex strip a second time, stop — export the existing one.

### Pitfall 2: The recompute-situation job is scope-dead — do NOT add per-employee compute there

**What goes wrong:** A naive plan would extend `src/worker/jobs/situation-snapshot.ts` `buildEmployeeRow` (which already does a similar walk) to emit the new `SituationEmployeeRow`. But that job is scope-dead on `paperclipai@2026.525.0` (per PR #6547 — see `situation-room.ts:11-14`); its host calls fail every tick on the current BEAAA host.

**Why it happens:** The Phase 2 design assumed a 60s materialized snapshot; the host's job-runner scope was later hardened in a way that broke the SDK calls inside jobs but not data handlers.

**How to avoid:** Plan 08-01 MUST compute in the **`situation.snapshot` DATA HANDLER** (HTTP-request scope — proven valid in Plan 07-03). The handler is at `src/worker/handlers/situation-room.ts`; the job at `src/worker/jobs/situation-snapshot.ts` should remain UNCHANGED. The new builder lives in a new file `src/worker/situation/build-employees-rollup.ts` and is called from the handler.

**Warning signs:** A grep `git diff src/worker/jobs/situation-snapshot.ts` should produce zero lines added by Phase 8. If it doesn't, you're in the wrong scope.

### Pitfall 3: `ctx.issues.list` does not accept a `status[]` filter — only single `status`

**What goes wrong:** Verified at `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1058-1069` — `PluginIssuesClient.list` takes `status?: Issue["status"]` (singular). A naive plan that calls `issues.list({ companyId, assigneeAgentId, status: ['in_progress','in_review','blocked'] })` will fail typecheck and at runtime either reject the param or silently match nothing.

**Why it happens:** SDK list filters are scalar by design.

**How to avoid:** Issue THREE list calls per agent (one per status) OR a single unfiltered `issues.list({companyId, assigneeAgentId})` followed by client-side filter on `status ∈ {in_progress, in_review, blocked}`. The single-unfiltered-list approach is cheaper if BEAAA agents typically have <50 open assigned issues each — likely true. **Recommendation:** single unfiltered list per agent + client-side `.filter(i => OPEN_STATUSES.has(i.status))`. Bound the per-agent fetch by `limit: 50` (defensive).

**Warning signs:** TypeScript compile error on `status: [...]`. Fix at the type boundary, not by casting.

### Pitfall 4: 17 agents × 2 SDK calls per agent = 34 RPCs per situation.snapshot tick

**What goes wrong:** Naive sequential `for (const agent of agents) { await issues.list(...); await issues.get(...); }` blocks for `2 × 17 × roundtrip_ms`. At a 50ms roundtrip, that's 1.7s per snapshot — over the 2s-ish soft latency budget the existing handler sets.

**Why it happens:** SDK RPC calls go through a JSON-RPC stdio bridge; each await is a real serial roundtrip.

**How to avoid:** Run the per-agent compute **in parallel via `Promise.all`** — the per-agent function is independent. Pattern (mirrors Plan 07-01 `sdk-ref-fetch.ts:50-55`):

```typescript
const rows = await Promise.all(
  agents.map(async (agent) => {
    try {
      return await buildOneEmployeeRow(ctx, agent, companyId, viewerUserId);
    } catch (e) {
      ctx.logger?.warn?.(...);
      return degradeSafeRow(agent);  // {agentId, name, role, state: 'unknown'}
    }
  })
);
```

The expected wall-clock with parallel-17 + 2 RPCs each + 50ms RTT is roughly **150-300ms** (dominated by the slowest agent's compute). The ROOM-12 builder is sequential (`for (const issue of blocked)`) and runs alongside this — they should parallelize too via `Promise.all` at the handler level if latency budget matters.

**Warning signs:** Live-drill console shows `situation.snapshot 200` taking >2s consistently. Profile to confirm the SDK roundtrips are the bottleneck before optimizing further.

### Pitfall 5: Slot component prop-shape rule (cross-phase memory `slot-component-prop-shape-rule`)

**What goes wrong:** Plugin SLOT components destructure `{context}` from props per `PluginPageProps` / `PluginDetailTabProps`. The Situation Room IS a page-slot component, so its top-level signature is `function SituationRoom(_props?: PluginPageProps)` — verified at `src/ui/surfaces/situation-room/index.tsx:98`. Any new child components Phase 8 mounts (banner, row strip) are NOT plugin slots themselves; they receive normal React props. This pitfall is documented because Plan 02-03c failed two drills on this.

**How to avoid:** New components (`<NeedsYouBanner>`, `<EmployeeRowStrip>`, `<EmployeeRow>`) take normal typed props. They do NOT receive `{slot, context}` — that pattern is for slot-root components only.

### Pitfall 6: `companyId === null` at first paint (Plan 02-03b regression)

**What goes wrong:** The detail-tab host-bridge gap means `useHostContext().companyId` can be `null` at first paint; the recovery path is `useResolvedCompanyId` (already used at `index.tsx:121`). New components that consume the snapshot payload must tolerate `companyId === null` returning the existing loading/error states.

**How to avoid:** Pass `companyId: string` (post-resolution) into the new banner/strip — never `string | null`. The resolution gate is already in place at `index.tsx:148-163`. Phase 8's new components mount inside `<SituationRoomBody>` which is post-gate.

### Pitfall 7: The `__unowned__` sentinel — Plan 07-03 NO_UUID_LEAK lesson verbatim

**What goes wrong:** The flattener at `src/shared/blocker-chain.ts:177-180` emits `terminal.label = \`Owner unknown — assign ${current} first\`` where `current` is a raw node UUID. Plan 07-03's first drill (commit `b3dc5d37`) shipped the org-backlog without the humanize-snapshot scrub, and the live BEAAA drill caught `humanAction: "Owner unknown — assign 7b5c7deb-8135-4d23-b41b-6cf7b724e945 first"` → NO_UUID_LEAK violation. The hotfix at `35d4945` added `scrubHumanAction` and pinned it with 6 RED-first tests.

**Why it happens:** The flattener INTENTIONALLY embeds the UUID so the job's humanize step can resolve it to a name. The HTTP-request data handler scope does NOT run the snapshot job, so the raw label leaks if you don't apply your own scrub.

**How to avoid:** Phase 8's per-employee builder MUST run `scrubHumanAction(terminal, viewerUserId, nameByUuid)` on every `blockerChain.humanAction` before emitting it. The Phase 8 test suite MUST include a "humanAction contains no UUID for any terminal kind" assertion — identical shape to Plan 07-03's hotfix test at `test/worker/org-blocked-backlog.test.mjs`.

**Warning signs:** Live drill on BEAAA shows a row whose `blockerChain.humanAction` contains a hex UUID like `7b5c7deb-8135-...`. The unit test won't catch this if it only checks `ownerName` — explicitly grep the label.

### Pitfall 8: Banner CSS scoping (SCAF-06)

**What goes wrong:** A new top-level banner adds CSS rules. Every rule MUST be scoped under `[data-clarity-surface]` or a more specific surface selector (`[data-clarity-surface='situation-room']`). The CI gate `scripts/check-css-scope.mjs` runs at 164 selectors green; a Phase 8 violation fails the gate.

**How to avoid:** Open `src/ui/primitives/theme.css`, find the situation-room section (line 588), add new selectors INSIDE that scope. Run `node scripts/check-css-scope.mjs` after every CSS save.

## Code Examples

### Reading `Agent.lastHeartbeatAt`
```typescript
// Source: node_modules/.pnpm/@paperclipai+shared@2026.512.0/.../dist/types/agent.d.ts:74
// Already on the Agent shape returned from ctx.agents.list({companyId})
const agents = await ctx.agents.list({ companyId });
for (const agent of agents) {
  const heartbeatMs = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).getTime() : null;
  // ...
}
```

### Listing assigned issues per agent
```typescript
// Source: node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1058-1069
// status is singular; if you need multiple, list-then-filter
const openIssues = await ctx.issues.list({
  companyId,
  assigneeAgentId: agent.id,
  limit: 50,
});
const OPEN_STATUSES = new Set(['in_progress', 'in_review', 'blocked'] as const);
const open = openIssues.filter(i => OPEN_STATUSES.has(i.status as 'in_progress' | 'in_review' | 'blocked'));
// Issue.lastActivityAt and Issue.assigneeAgentId verified at .../dist/types/issue.d.ts:266,317
```

### Polishing the focus line (mirror chat-messages.ts:398)
```typescript
// Source: src/worker/agents/compile-tldr.ts:370 (export verified)
import { polishTldr } from '../agents/compile-tldr.ts';

// Pure, no I/O, safe to call N=17 times per request
const rawSource = tldrCacheRow?.body ?? issueLike?.title ?? '';
const polished = polishTldr(rawSource);   // returns '' on empty
const focusLine = polished.length > 80
  ? polished.slice(0, 77) + '…'
  : (polished || null);
```

### Open-chat affordance (mirror Plan 07-03)
```typescript
// Source: src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx (Plan 07-03)
import { buildChatDeepLink } from '../chat/deep-link.mjs';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { useHostLocation, useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';

const location = useHostLocation();
const { navigate } = useHostNavigation();
const companyPrefix = extractCompanyPrefixFromPathname(location.pathname) ?? '';

function handleOpenChat(ownerAgentId: string) {
  const deepLink = buildChatDeepLink({
    route: 'employee-only',
    companyPrefix,
    assigneeAgentId: ownerAgentId,
  });
  if (deepLink) navigate(deepLink.to);
}
```

### Test fixture shape (mirror Plan 07-03 test pattern)
```javascript
// Source: test/worker/org-blocked-backlog.test.mjs:38-71
// Plain-object ctx stub — no devDep, no jsdom.
function makeCtx({
  agents = [],                     // Agent[] returned by agents.list
  issuesByAssignee = {},           // { agentId: Issue[] }
  relations = {},                  // { issueId: { blockedBy, blocks } }
  agentsByUuid = {},               // { uuid: { name } } for agents.get
  agentsThrow = false,
  noAgents = false,
} = {}) {
  const ctx = {
    logger: { info(){}, warn(){}, error(){}, debug(){} },
    issues: {
      async list(input) {
        return issuesByAssignee[input?.assigneeAgentId ?? ''] ?? [];
      },
      async get(id) { /* …*/ },
      relations: { async get(id) { return relations[id] ?? { blockedBy: [], blocks: [] }; } },
    },
  };
  if (!noAgents) {
    ctx.agents = {
      async list(input) { return agents; },
      async get(uuid) {
        if (agentsThrow) throw new Error('agents.get boom');
        return agentsByUuid[uuid] ?? null;
      },
    };
  }
  return ctx;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-agent compute lives in `src/worker/jobs/situation-snapshot.ts` (the `recompute-situation` cron job) | Per-agent compute lives in the `situation.snapshot` DATA HANDLER (`src/worker/handlers/situation-room.ts`) | Plan 07-03 (2026-05-29) — host PR #6547 broke job-scope SDK calls | The job is scope-dead but harmless; new work computes fresh at HTTP-request time. The materialized snapshot row is empty/stale on BEAAA — the handler's no-row path now returns a fresh payload. |
| `pickTopChains` was a private function inside the job | `pickTopChains` is exported from `src/shared/blocker-chain.ts` | Plan 07-03 Task 1 (2026-05-29) | Single source of truth — both the job and any new handler/builder share one ranking implementation |
| `humanizeChain` runs in the JOB (`src/worker/jobs/humanize-snapshot.ts`) | Mirrored as `scrubHumanAction` in the data handler (`src/worker/handlers/org-blocked-backlog.ts:85`) | Plan 07-03 hotfix `35d4945` (2026-05-29) | NO_UUID_LEAK preserved in BOTH scopes; Phase 8 inherits the contract |
| Editor-Agent's TL;DR voice differed from chat | `polishTldr` runs on both: Reader TL;DRs AND chat agent messages | v1.1.11 (2026-05-30) — see `chat-messages.ts:398` | Phase 8's `focusLine` is the third surface; same code path |
| Heartbeat-runs feed accessed via REST | `Agent.lastHeartbeatAt` exposed directly on the SDK type | Already present in `@paperclipai/shared` Agent shape (verified 2026-05-30) | Phase 8 needs no HTTP capability for heartbeat freshness |

**Deprecated/outdated:**
- The Phase 2 `EmployeeSnapshot.now_doing` field (populated by the dead job's `current_task_summary` read) — Phase 8's `focusLine` is the replacement. The old field stays on the type for back-compat with the job; the UI no longer relies on it (the dead job emits nothing, so it's effectively null everywhere on BEAAA).
- The `clarity-blocked-banner` collapsible toggle UI affordance (currently in `org-blocked-backlog-banner.tsx`) — Phase 8 keeps the component but the new always-visible needs-you banner takes the top-of-room slot. ROOM-12 backlog stays as a secondary panel.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Agent.lastHeartbeatAt` reflects the real "currently running" signal accurately within a 5-min window | Pattern 2 / Pitfall 4 | Worst case: `running` state classifies incorrectly. The live BEAAA drill will catch this; fallback is to add a probe step in Plan 08-03 that compares `lastHeartbeatAt` against an `executionRunId`-set Issue (which Issue.d.ts:268 exposes). | `[ASSUMED]`
| A2 | The 17 agents on BEAAA × 2 SDK calls each completes within ~300ms via `Promise.all` | Pitfall 4 | Worst case: handler times out. Mitigation: a per-row try/catch already ensures partial degradation. If consistently over budget, Plan 08-01 should add a `?lite=1` param that skips the per-agent issues.list and emits state='unknown' for agents whose blockerChain compute exceeded a per-agent timeout. | `[ASSUMED]`
| A3 | `ctx.issues.list({companyId, assigneeAgentId})` returns reasonable counts (<50 open per agent on BEAAA) — making client-side filter cheaper than 3 status-scoped lists | Pitfall 3 | Worst case: BEAAA has an agent with thousands of historical open issues. Mitigation: `limit: 50` defensively in the call. If still slow, switch to 3 status-scoped parallel lists. | `[ASSUMED]`
| A4 | `Agent.title` is reliably populated on BEAAA (not always null) so it can be the `role` field source preferred over `Agent.role` (which Plan 06.1 found often returns "general") | Pattern 1 / Role display | Worst case: `role` shows "agent" generically on idle rows. Mitigation: prefer `title ?? role ?? 'agent'`. The Phase 2/6.1 fix already preferred `name` over `role` for the agent-card; Phase 8 does the same. | `[ASSUMED]`
| A5 | The `OrgBlockedBacklogBanner` will accept `defaultExpanded` as a prop OR can be left alone in collapsed state with a CSS override | Banner replacement strategy | Worst case: ROOM-12 backlog auto-expands when `need_you_count > 0`, fighting with the new top banner for prominence. Mitigation: either pass an explicit `defaultExpanded={false}` prop (which may require a small component change) or rely on the new top banner being visually dominant enough to make the duplication tolerable. | `[ASSUMED]`
| A6 | Phase 8's UI bundle delta is ≤8kB (similar to Plan 07-03 banner +8,073B or Plan 07-05 lineage +3,811B) | Bundle ceiling | Worst case: delta exceeds 716kB ceiling and gate fails. Mitigation: recalibrate per Plan 05-04 / 07-02 / 07-03 / 07-05 precedent; verify zero SheetJS sentinels. The ceiling has trended up ~4kB per UI-touching plan. | `[ASSUMED]`
| A7 | `viewerAgentId` for `needsYou.count` matching is derivable from `viewerUserId` via `ctx.agents.list` lookup (i.e., one of the 17 agents has `owner_user_id === viewerUserId`) OR Phase 8 keys on `viewerUserId` directly (the host's CEO user_id) and matches `blockerChain.ownerAgentId`'s OWNER (the chain leaf's userId) against it | ROOM-18 | Worst case: needs-you count is always 0 because the chain's `ownerAgentId` is the AGENT uuid and `viewerUserId` is the USER uuid — different namespaces. Mitigation: the existing `org_blocked_backlog.need_you_count` already solves this at `org-blocked-backlog.ts:419-425` by comparing `terminal.userId === viewerUserId`. Phase 8 should mirror that semantic exactly — `needsYou.count` = rows where `blockerChain.terminal.userId === viewerUserId` (NOT `ownerAgentId === viewerAgentId`). | `[ASSUMED]` (verify against Plan 07-03 semantics in Plan 08-01) |

**Total assumed claims:** 7. Discuss-phase / planner should confirm A4 (BEAAA `Agent.title` population), A5 (`defaultExpanded` prop addition or accept the duplication), A7 (needs-you key semantics).

## Open Questions

1. **Should `scrubHumanAction` be exported from `org-blocked-backlog.ts` or extracted to a new `src/shared/scrub-human-action.ts`?**
   - What we know: the function is pure, has 4 tightly-coupled regex constants, and is tested at `test/worker/org-blocked-backlog.test.mjs`. The shared module `src/shared/blocker-chain.ts` already houses the chain primitives.
   - What's unclear: whether the cleanest move is export-from-current or extract-to-shared. The extract-to-shared option is more disciplined; the export-from-current option is one-line cheaper.
   - Recommendation: planner picks. The locked decision is "reuse, don't re-implement" — either satisfies that.

2. **For the `idle` and `stale` states (no open assigned issue), what is `lastActivityAt`?**
   - What we know: `Issue.lastActivityAt` is the per-issue field (verified at `.../shared/dist/types/issue.d.ts:317`). For agents WITH no open issues, the per-issue field is unavailable.
   - What's unclear: the cheapest "last activity" signal for an idle agent. Options:
     (a) `Agent.lastHeartbeatAt` directly (every agent has one, even idle).
     (b) The most-recent issue (any status, including `done`) assigned to the agent — needs an `issues.list` call.
     (c) Use only `lastHeartbeatAt` for the idle/stale boundary.
   - Recommendation: **(a) — `lastHeartbeatAt` only for idle/stale boundary**. It's free (already on the agent), monotonic, and survives idle agents. The `lastActivityMs` input to the classifier becomes `agent.lastHeartbeatAt`. A more nuanced "what was their last commented-on issue" can be a follow-up (v1.2.1).

3. **`doneTodayCount` — drop or keep?**
   - What we know: the LOCKED `SituationEmployeeRow` shape includes `doneTodayCount: number`. Issue.d.ts:294 has `completedAt: Date | null` and `Issue.assigneeAgentId`, so the query is theoretically possible: `issues.list({companyId, assigneeAgentId, status: 'done', limit: 50})` then client-side filter `completedAt >= startOfToday`.
   - What's unclear: cost. Adds a 3rd SDK call per agent (17 × 3 = 51 RPCs). Skips can be done via `Promise.all` so wall-clock is still ~300ms parallel. The info value: low to medium ("Karen shipped 3 things today" is nice but not load-bearing for the cockpit's primary value prop).
   - Recommendation: **defer `doneTodayCount` to v1.2.1 OR mark it optional in the type and emit `0` for v1.2.0**. The locked SUCCESS CRITERIA #6 does not mention doneToday; it's informational only.

4. **For the focus issue selection when an agent has multiple open issues, what's the priority order?**
   - What we know: not locked in CONTEXT.md.
   - Recommendation: planner discretion per LOCKED. Suggest: priority = `blocked` > `in_review` > `in_progress` (which lines up with the state classifier output), then tie-break by `lastActivityAt DESC`. Document in Plan 08-01.

5. **Should ROOM-12's auto-expand behavior change when Phase 8 ships?**
   - What we know: Plan 07-03 SUMMARY documents `auto-expanded when needYouCount > 0`. With Phase 8's always-visible top banner taking the urgency role, the ROOM-12 banner becoming a secondary collapsed panel makes more sense.
   - Recommendation: Plan 08-02 adds a `defaultExpanded={false}` prop to `OrgBlockedBacklogBanner` (small component change). Confirms the "ROOM-12 stays — just below" composition.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | TypeScript compile + tests | ✓ | ≥20 (host engines pin per CLAUDE.md) | — |
| `@paperclipai/plugin-sdk` `ctx.agents.list` + `.get` | Worker builder | ✓ | 2026.512.0 (or 2026.525.0 — same shape) | — |
| `@paperclipai/plugin-sdk` `ctx.issues.list` + `.get` + `.relations.get` | Worker builder | ✓ | same | — |
| `polishTldr` exported function | `focusLine` polish | ✓ | already at `compile-tldr.ts:370` | — |
| `flattenBlockerChain` + `pickTopChains` | Chain compute | ✓ | already at `blocker-chain.ts:49,211` | — |
| `scrubHumanAction` (file-private) | NO_UUID_LEAK guard | ✓ (after export — see Pitfall 1) | already at `org-blocked-backlog.ts:85` | Re-mirror in new file (anti-pattern; see Pitfall 1) |
| `buildChatDeepLink({route:'employee-only'})` | Open-chat affordance | ✓ | already at `deep-link.mjs:152` | — |
| BEAAA live host | Plan 08-03 drill | ✓ (tunnel up at `localhost:3100`) | `paperclipai@2026.525.0` (current) | None — drill is the closure gate |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Security Domain

> CLAUDE.md does not flag `security_enforcement` explicitly; project-wide ASVS-style domain analysis is documented per-plan in Phase 7. Phase 8 adds NO new HTTP routes, NO new write paths, NO new schema. The same-origin trust model is unchanged.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 8 introduces no auth paths; reuses host session via `ctx` |
| V3 Session Management | no | — |
| V4 Access Control | yes | `wrapDataHandler` opt-in-guard wraps the handler (already in place at `situation-room.ts:67`). Phase 8 inherits. |
| V5 Input Validation | yes | `params.companyId` + `params.userId` are validated at `situation-room.ts:68-80`; Phase 8 reuses verbatim. The Phase 8 builder receives already-validated inputs. |
| V6 Cryptography | no | No new crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| NO_UUID_LEAK (info disclosure of internal IDs in operator-facing text) | Information Disclosure | `scrubHumanAction` mirror (Plan 07-03 hotfix `35d4945`). Phase 8 MUST reuse. |
| XSS via untrusted `humanAction` / `focusLine` text | Tampering | React text nodes only — no `dangerouslySetInnerHTML`. Plan 07-03's banner pattern is the contract. |
| DoS via unbounded `issues.list` or `relations.get` | Denial of Service | Per-agent `limit: 50` defensively; `MAX_CHAIN_DEPTH=6` in the existing builder; per-row try/catch degrades to `state: 'unknown'`. |
| Cross-tenant leak via `companyId` confusion | Information Disclosure | Single-tenant v1 deploy (CLAUDE.md). The handler scopes every SDK call by `companyId`. |
| Opt-out user sees the new banner | Authorization | `wrapDataHandler` already returns `{error: 'OPT_IN_REQUIRED'}` for opted-out users; UI renders `<EnableClarityCta>`. Phase 8 inherits. |

## Sources

### Primary (HIGH confidence)

- `node_modules/.pnpm/@paperclipai+shared@2026.512.0/node_modules/@paperclipai/shared/dist/types/agent.d.ts:54-78` — Agent interface verified (carries `lastHeartbeatAt`, `title`, `role`, `status`, `id`, `name`)
- `node_modules/.pnpm/@paperclipai+shared@2026.512.0/.../dist/types/issue.d.ts:253-321` — Issue interface verified (carries `assigneeAgentId`, `status`, `lastActivityAt`, `executionRunId`, `executionLockedAt`)
- `node_modules/.pnpm/@paperclipai+shared@2026.512.0/.../dist/constants.d.ts:26` — `IssueStatus` enum = `"backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled"` verified
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1057-1151` — `PluginIssuesClient` shape; `list({companyId, assigneeAgentId, status, limit, offset})` returns `Promise<Issue[]>`
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1158-1185` — `PluginAgentsClient.list({companyId, status, limit, offset})` + `.get(agentId, companyId)`
- `src/worker/handlers/situation-room.ts:1-113` — current data handler shape, the integration target
- `src/worker/handlers/org-blocked-backlog.ts:1-447` — Plan 07-03 builder + `scrubHumanAction` mirror (the reuse target for Phase 8)
- `src/shared/blocker-chain.ts:1-231` — `flattenBlockerChain` (line 49) + `pickTopChains` (line 211)
- `src/worker/jobs/humanize-snapshot.ts:1-180` — Plan 02-08 humanize pipeline (the originator of the scrub pattern)
- `src/worker/agents/compile-tldr.ts:370-378` — `polishTldr` export (4-pass polish pipeline)
- `src/worker/handlers/chat-messages.ts:389-398` — v1.1.11 polish wire-in pattern (Phase 8's `focusLine` mirror)
- `src/ui/surfaces/chat/deep-link.mjs:106-167` — `buildChatDeepLink` including `route:'employee-only'` (Plan 06.1-12 hotfix)
- `src/ui/surfaces/situation-room/index.tsx:1-300` — current UI surface composition (the mount target)
- `src/ui/primitives/theme.css:1-1411` — design tokens (no `--clarity-state-idle/stale/running/reviewing/blocked` yet; Phase 8 must add)
- `scripts/check-ui-bundle-size.mjs:149` — current `UI_BUNDLE_BYTES_CEILING = 716 * 1024` (716 kB)
- `.planning/phases/07-clarity-surfaces-quality-and-portability-instance-agnostic-r/07-03-SUMMARY.md:1-200` — the Plan 07-03 reuse precedent (full read)
- `runbook/operator-gotchas.md:1-100` — operator gotchas (none specific to Phase 8 surface area; the bookended-by-snapshots rule applies to the deploy)

### Secondary (MEDIUM confidence)

- `.playwright-mcp/console-2026-05-29T13-21-32-738Z.log:18-79` — empirical evidence that `/api/companies/<id>/heartbeat-runs?limit=200` exists as a REST endpoint, though Phase 8 doesn't need it
- `.planning/STATE.md:21-200` — v1.1.x ship state, the polish pipeline that lives at `compile-tldr.ts` was iteratively hardened across v1.1.6 → v1.1.9
- `.planning/REQUIREMENTS.md:106-115` — ROOM-13..18 spec authored 2026-05-30

### Tertiary (LOW confidence)

- None — Phase 8 needs no external web research. The entire problem space is internal-codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all SDK shapes verified against `node_modules/@paperclipai/{plugin-sdk,shared}` `.d.ts` files.
- Architecture: HIGH — mirrors Plan 07-03 byte-identically; the only new structural piece is the per-agent loop, which is well-precedented.
- Pitfalls: HIGH — pitfall 7 (NO_UUID_LEAK) was directly observed in the Plan 07-03 live drill and pinned by tests; pitfalls 2 (scope-dead job) and 3 (singular status filter) are from the SDK types + Plan 07-03 SUMMARY.

**Research date:** 2026-05-30
**Valid until:** estimate 14 days — the SDK pin can shift with a host upgrade (paperclipai@2026.525.0 → next monthly), but the underlying Agent + Issue type shapes are stable across recent releases. The `polishTldr` voice will continue to evolve (v1.1.6 → 1.1.9 trend); Phase 8's wire-in is decoupled from voice details.

---

*Phase: 08-situation-room-people-first-cockpit*
*Research completed: 2026-05-30 — answers the 15 implementation questions from the orchestrator's spawn message with concrete file paths, line numbers, SDK signatures, and reuse targets.*
