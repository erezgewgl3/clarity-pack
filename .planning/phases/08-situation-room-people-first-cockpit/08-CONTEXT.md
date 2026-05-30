# Phase 8: Situation Room people-first cockpit — Context

**Gathered:** 2026-05-30
**Status:** Ready for planning
**Source:** Live-drill critique + locked design decisions (this session)

<domain>
## Phase Boundary

Phase 8 redesigns the Situation Room around **employees instead of issues**. The v1.1.11 Situation Room renders as a single collapsed band ("32 blocked · 0 need you") over empty canvas, expanding to a flat table of 32 blocked issues. The operator critique (verbatim): *"It's kind of tough to understand who's doing what... If there are things I need to shift? If there's anyone that's stuck? That's the goal of the situation room, and I'm not really seeing it here."*

**Diagnosis** (locked in this session's transcript): the `situation.snapshot` worker handler returns only `{ org_blocked_backlog, taken_at }`. The UI faithfully renders 100% of what the worker computes. There is no per-employee row data being computed at all. So this is not a CSS bug — it is a feature gap. The screen is organized around the wrong primary axis (issues, not people).

**What ships:** a per-employee row strip — one row per company-scope agent — surfacing state, focus line, age, and (where applicable) an inline blocker-chain leaf ending in a named human action. Sorted blocked-first → stale → idle → moving (idle-loud). One persistent top banner for "needs you" — no per-row highlights.

**What does NOT ship:** the existing ROOM-12 org-blocked-backlog stays untouched. Phase 8 adds the people axis ABOVE it; both render in the same Situation Room. The blocker-chain pipeline (`flattenBlockerChain` + `pickTopChains` + `humanize-snapshot`) ships byte-identical — Phase 8 only consumes it, never re-implements.

</domain>

<decisions>
## Implementation Decisions (LOCKED via operator picks 2026-05-30)

### Primary axis
- **People-first cockpit** (LOCKED). Primary axis = employees. One row per agent with state, current focus, age signal, and inline blocker chain. Rejected: editorial tri-panel (issue-centric), heatmap grid (abstract).
- Rationale: matches the value prop verbatim — "who is doing what, who is stuck, what to shift." A CEO scans **people**, not issues.

### Idle-agent posture
- **Loud — idle is a CEO problem** (LOCKED). Idle agents render amber and bubble up near stuck agents. Rejected: quiet/gray (idle as default healthy state), stale-only (only flag >24h idle).
- Rationale: an agent with no assigned work is wasted org capacity. The CEO should see it and decide to assign or stand them down. The cockpit calls out to *unblock AND to assign* — not just unblock.

### "Needs you" surface placement
- **Top banner only** (LOCKED). One persistent line: `⚠ N things need you → <single most-urgent action>`. Click jumps to the responsible agent row + opens chat. Rejected: per-row highlight (yellow left-bar on the agent row), both (banner + highlight).
- Rationale: keeps per-agent rows clean. Banner carries the urgency; rows carry the data.

### State enum (deterministic classifier)
- Exactly five states: `running` | `reviewing` | `blocked` | `idle` | `stale` (plus `unknown` for degrade-safe fallback).
- Boundaries are deterministic and pure-function-testable:
  - `running` = active heartbeat-run in last 5 min
  - `reviewing` = open assigned issue with `status='in_review'` AND no active run
  - `blocked` = open assigned issue with `status='blocked'`
  - `idle` = no open assigned issue AND last activity < 24h
  - `stale` = no open assigned issue AND last activity ≥ 24h
- Classifier lives in `src/worker/situation/classify-employee-state.ts`. Single source of truth.

### Focus-line voice (Reader parity)
- The per-agent one-line focus description (`focusLine`) MUST be polished by the same `polishTldr()` pipeline as the Reader TL;DR. ISO→human dates, restated-paren strip, lone-ref-paren strip, jargon glossary. Identical voice; identical code path.
- Source: the focus issue's compiled TL;DR (if present) → polish; else the issue title → polish. Truncated at worker tier to ~80 chars. UI never re-truncates.
- `focusLine` is `null` for `idle` and `stale` states (no work-in-flight to describe).

### Blocker-chain reuse (NO new logic)
- Phase 8 consumes `src/shared/blocker-chain.ts` `flattenBlockerChain` + `pickTopChains` (already exported as of Plan 07-03) + the humanize-snapshot scrub (the `scrubHumanAction` mirror from Plan 07-03 hotfix `35d4945`). NO_UUID_LEAK preserved by construction — `__unowned__` → `"Unassigned"`, never raw UUID.
- Surface per agent: one chain (the agent's blocking work, if `state === 'blocked'`). NOT a list — single most-relevant chain per row.

### Sort posture (idle-loud)
- Sort order at worker tier: `blocked` (oldest blocker age first) → `stale` (oldest activity first) → `idle` (oldest activity first) → `reviewing` → `running` (most recently active first). UI consumes verbatim.
- Idle/stale rows carry amber styling (`--clarity-state-idle` / `--clarity-state-stale` CSS tokens). Running/reviewing carry green (`--clarity-state-running`).

### Coexistence with ROOM-12
- Phase 7's ROOM-12 org-blocked-backlog stays byte-identical. It already lives in `situation.snapshot` as `org_blocked_backlog`. Phase 8 adds `employees: SituationEmployeeRow[]` alongside it — additive only. Banner replaces the v1.1.11 `clarity-blocked-banner` toggle with the always-visible needs-you banner; expansion below shows employees first, then ROOM-12 backlog as a secondary panel.

### What we explicitly do NOT do
- NO new database migration (everything computed at HTTP-request time in the existing `situation.snapshot` handler).
- NO new runtime dependencies.
- NO re-implementation of blocker-chain logic (reuse shared module).
- NO change to the Reader/Chat/Bulletin surfaces.
- NO per-row "needs you" highlight (top banner only — locked).
- NO heatmap/grid layout (people-first only — locked).

### Claude's Discretion (filled by planner)
- Exact CSS token values (within the design system's amber/green family).
- Sort tie-breakers WITHIN a bucket beyond what's specified above.
- Exact bundle-size delta budget — recalibrate per Phase 5/7 precedent if needed.
- Test fixture shapes for the classifier (state transitions at exact threshold boundaries).
- Whether to ship as one plan or split into worker/UI/drill plans.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Situation Room worker surface
- `src/worker/handlers/situation-room.ts` — current handler shape. Returns `{ org_blocked_backlog, taken_at }` only.
- `src/worker/handlers/org-blocked-backlog.ts` — Plan 07-03's ROOM-12 builder (the reuse target for the chain pipeline).
- `src/worker/jobs/situation-snapshot.ts` — the scope-dead recompute job (DO NOT re-add per-employee compute here — situation.snapshot DATA HANDLER is the valid HTTP-request scope, per Plan 07-03's lesson).

### Existing Situation Room UI
- `src/ui/surfaces/situation-room/` — current React tree. The `clarity-blocked-banner` component is what renders today and what gets replaced/wrapped.
- `src/ui/primitives/theme.css` — design tokens.

### Shared chain pipeline (consume, do not re-implement)
- `src/shared/blocker-chain.ts` — `flattenBlockerChain` + `pickTopChains` (already exported as of Plan 07-03).
- `src/shared/humanize-snapshot.ts` — `scrubHumanAction` (NO_UUID_LEAK guard).
- `src/shared/reference-resolver.ts` — chip resolution if any chip rendering is needed.

### Polish pipeline (consume verbatim)
- `src/worker/agents/compile-tldr.ts` — `polishTldr()` export. The same pipeline that runs on Reader TL;DRs and (since v1.1.11) on chat agent bodies. Phase 8's `focusLine` MUST run through this.

### Roster + agent reads
- `@paperclipai/plugin-sdk` — `ctx.agents.list`, `ctx.agents.get`, `ctx.issues.list`, `ctx.issues.get`. Same APIs Plan 07-03 used.
- `@paperclipai/mcp-server` — heartbeat-runs feed (read shape).

### Plan 07-03 lessons (NO_UUID_LEAK + degrade-safe)
- `phases/07-clarity-surfaces-quality-and-portability-instance-agnostic-r/07-03-SUMMARY.md` — the live-drill hotfix (commit `35d4945`) for the chain-flattener leaking raw UUIDs through the `__unowned__` terminal. Phase 8 inherits this guard.

### v1.1.11 polish pipeline (Reader voice in chat — same target voice here)
- `src/worker/handlers/chat-messages.ts` — the polishTldr wire-in at read time (lines ~389-398). Phase 8's `focusLine` should follow the same pattern.

### Operator critique screenshots (design ground truth for what NOT to ship)
- `situation-room-current-state-2026-05-30.png` — the empty cockpit (collapsed band).
- `situation-room-expanded-2026-05-30.png` — the flat issue table (wrong axis).

### Project plumbing
- `CLAUDE.md` — project guardrails (stack pins, coexistence guarantees, bookended-by-snapshots rule).
- `.planning/REQUIREMENTS.md` — ROOM-13..18 spec authored 2026-05-30.
- `.planning/ROADMAP.md` — Phase 8 success criteria (6 items, all verifiable).
- `.planning/STATE.md` — current shipped version (v1.1.11), v1.2.0 is Phase 8's ship label.

</canonical_refs>

<specifics>
## Specific Ideas

### Worker tier — `SituationEmployeeRow` shape (target)
```ts
type EmployeeState = 'running' | 'reviewing' | 'blocked' | 'idle' | 'stale' | 'unknown';
type AgeBucket = 'fresh' | 'aging' | 'stale';

type SituationEmployeeRow = {
  agentId: string;       // uuid
  name: string;          // resolved displayName, NEVER UUID
  role: string;          // resolved role/title
  state: EmployeeState;
  focusIssueId: string | null;       // human identifier (e.g. BEAAA-1086), NOT uuid
  focusLine: string | null;          // polished one-liner, ~80 chars
  lastActivityAt: string;            // ISO; computed from heartbeat + comment activity
  ageBucket: AgeBucket;              // <4h fresh / 4-24h aging / >24h stale
  blockerChain: {
    rootIssueId: string;             // human identifier
    leafIssueId: string;             // human identifier
    humanAction: string;             // scrubbed via humanize-snapshot
    ownerName: string;               // NO_UUID_LEAK: "Unassigned" if __unowned__
    ownerAgentId: string | null;     // agent uuid for buildChatDeepLink
  } | null;
  doneTodayCount: number;            // closed-by-this-agent today (informational)
};
```

### Worker tier — handler signature
`situation.snapshot` returns:
```ts
{
  org_blocked_backlog: OrgBlockedBacklog,   // unchanged from ROOM-12
  employees: SituationEmployeeRow[],         // NEW — sorted blocked → stale → idle → reviewing → running
  needsYou: {
    count: number,                           // employees where blockerChain.ownerAgentId === viewerAgentId
    topAction: { agentId, humanAction, leafIssueId } | null,
  },
  taken_at: string,
}
```

### UI tier — layout sketch (from locked design)
```
Situation Room                       Live · 14:07  ↻
─────────────────────────────────────────────────────
⚠ 1 thing needs you → ping HoUW on BEAAA-1243
─────────────────────────────────────────────────────
● CTO            running 4m       Scope-β rev2
   └ blocked by HoUW co-sign (BEAAA-1243, 0d)
     → Action: ping HoUW              [open chat]

● Underwriter    blocked 9h       Async co-sign
   └ delegated to HoUW (BEAAA-1243)
     → Watch — chain healthy

● Claims Arch    idle 2d ⚠        last: BEAAA-1103
   → Nothing assigned             [assign work]

● HoUW           running 12m      Co-sign rev 2
   → moving · no action

● Actuary        running 1h       BEAAA-808 ADR
   → moving · no action
─────────────────────────────────────────────────────
Org backlog (ROOM-12) — collapsed by default · 32 issues
```

### Plan structure (recommended split)
- Plan 08-01: worker tier (handler grows + classifier + per-employee builder + polish wire-in + tests).
- Plan 08-02: UI tier (employee row strip + state-pill component + inline chain leaf + banner rewire + CSS tokens + tests).
- Plan 08-03: BEAAA live drill (Playwright probe of ≥3 states, ≥1 blocked with chain leaf, ≥1 idle bubbled, needs-you banner click flow).

Planner may split differently if they see a better dependency chain.

</specifics>

<deferred>
## Deferred Ideas

- **Per-row "needs you" highlight** — explicitly REJECTED by operator. Top banner only.
- **Editorial tri-panel layout** — REJECTED. Wrong axis.
- **Heatmap grid layout** — REJECTED. Too abstract.
- **Done-today rolling strip** — discussed in the original sketch; treat as nice-to-have in the per-row footer rather than a dedicated strip. Planner discretion.
- **Tap-to-stand-down for stale agents** — premise is sound (operator can decommission a stuck/forgotten agent) but adds a new write path. Defer to a follow-up phase after live use.
- **CTO agent-state inference from chat last-message-from** — would let us flag "agent thinks it's running but has been silent 6h." Defer; lastActivityAt covers 90% of the value.
- **Per-employee mini-chart** (last 7 days of throughput) — would be lovely but is a separate analytics surface. Defer.

</deferred>

---

*Phase: 08-situation-room-people-first-cockpit*
*Context gathered: 2026-05-30 from operator critique + locked design decisions in this session.*
