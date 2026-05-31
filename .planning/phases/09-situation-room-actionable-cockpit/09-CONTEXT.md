# Phase 9: Situation Room actionable cockpit - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the Situation Room from a read-only status board into an **actionable cockpit**: one people view in three groups (Needs you / Working / Idle) where every stuck or idle agent ends in a **functional** button that resolves it in place — assign owner, open chat, wake, assign work, stand down. The dead `AgentCard` grid (and its dead pipelines) is removed; the assign-owner path mutates the real Paperclip issue. Ships as v1.3.0.

Scope is fixed by `09-SPEC.md` (9 locked requirements). This discussion only clarifies HOW to implement what the SPEC locks.
</domain>

<spec_lock>
## Locked by SPEC.md (do not re-open)

`09-SPEC.md` locks 9 requirements + 11 acceptance checks. Highlights downstream agents must treat as fixed:
- **R3 / R4 (the hero):** assign-owner mutates the real issue via a NEW `situation.assignOwner` worker action calling `ctx.issues.update(leafIssueId, { assigneeAgentId }, companyId, actor)` with operator actor attribution; **NO dead buttons** — every surfaced affordance performs or is absent (never `disabled`/no-op).
- **R1:** delete the `AgentCard` grid + `situation.artifacts` handler + `recompute-situation` cron job.
- **R2:** three-group buckets computed at the worker tier; UI verbatim.
- **R5:** banner counts unowned blockers (un-frozen).
- **R6:** org-backlog + critical-path → one "+N more blocked issues" expander at the end of Needs-you.
- **R7:** assign applies immediately; Stand down confirms first.
- **R8:** add `issues.update` capability; bump v1.3.0 (package.json + manifest); snapshot-bookended BEAAA reinstall + live drill.
- **R9:** no new migration; text-nodes-only; NO_UUID_LEAK; CSS scoped.

Read `09-SPEC.md` in full before planning.
</spec_lock>

<decisions>
## Implementation Decisions (this discussion)

### Owner picker
- **D-01:** The `[Assign owner ▾]` picker lists the **full agent roster, grouped/ordered by role/title** (a CEO scans by function), with the **Editor-Agent excluded**. **No** "smart"/least-busy/relevance sorting — present everyone clearly and let the operator choose (honors the trust-the-clarification-loop / no-prefill rule). Source the roster from the existing `chat.roster` handler.

### "Take it myself"
- **D-02:** Keep the "Take it myself" item, with **honest framing**. It assigns the issue to the operator (`assigneeUserId`), the row then **leaves the Needs-you group** and renders "with you — handling manually", and it **drops from the unowned/stuck count**. It MUST NOT imply an agent will act (assigning to a human does not trigger agent work on this host). This is the single place `assigneeUserId` (vs `assigneeAgentId`) is used.

### Empty-group display
- **D-03:** **Always render all three group headers** (Needs you / Working / Idle), each with its count, even when empty. An empty group shows its header plus a muted "— none —" line. Consistent structure — the operator always sees all three buckets, so a zero in any bucket is itself a signal (e.g. "Working — none" is meaningful). No special win-line; an empty Needs-you simply reads "Needs you · 0 — none".

### Stand-down aftermath
- **D-04:** A stood-down (paused) agent **stays visible in the Idle group** with a "paused" marker and a **one-click Resume** that reuses the existing `agents.resumeHeartbeat` action. Pausing is reversible in-place — no trip to classic UI to undo it.

### Claude's Discretion (planner/researcher)
- Plan split (single plan vs worker/UI/drill split à la Phase 8's 08-01/02/03).
- Exact `situation.assignOwner` handler shape (mirror `agent.takeOwnership`'s authority gate).
- Whether `group` is a new field on `SituationEmployeeRow` or a derived worker-tier bucket map (R2 only mandates worker-tier + UI-verbatim).
- Popover component choice for the picker (reuse an existing popover pattern).
- Confirm-dialog + toast copy; "paused" marker styling; win-line exact wording.
- Bundle-ceiling recalibration if needed (per Phase 5/7/8 precedent).
</decisions>

<specifics>
## Specific Ideas

- The approved interactive mockup `sketches/clarity-situation-room-redesign.html` is the **visual + interaction ground truth** — group structure, row anatomy, action clusters, gold-reserved-for-ownership/chat accent, warm-dark palette, the live "row jumps from Needs-you into Working after assign" behavior. Build to match its structure (not necessarily pixel-perfect).
- Operator's headline rule, verbatim intent: *"ensure everything we're surfacing is functional — when I click it, it does what it's supposed to. There were a lot of buttons before that just didn't work."* This is SPEC R4 and the phase's acceptance spine.
- Gold (`--clarity-you`) stays reserved for ownership/chat affordances (assign owner, open chat); neutral chrome for open-issue/wake/stand-down (per the UI-SPEC color reservation).
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements + design
- `.planning/phases/09-situation-room-actionable-cockpit/09-SPEC.md` — **Locked requirements — MUST read before planning.**
- `sketches/clarity-situation-room-redesign.html` — approved interactive mockup (visual + interaction contract).
- `.planning/phases/08-situation-room-people-first-cockpit/08-CONTEXT.md` — prior cockpit decisions: 5-state enum, idle-loud premise, blocker-chain reuse, NO_UUID_LEAK, focusLine via polishTldr, SituationEmployeeRow shape.

### Worker — mutation + reuse
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — `ctx.issues.update` (lines 1097-1101: patch incl. `assigneeAgentId`/`assigneeUserId`/`status`), `createComment` (1124-1126), relations (912-921), capability doc comments (1041-1054).
- `src/worker/handlers/agent-take-ownership.ts` — viewer-authority gate (ownerUserId===userId + `ctx.agents.get` company scope) to MIRROR for `situation.assignOwner`. NOTE it writes a plugin-namespace side table, NOT `ctx.issues.update` — assignOwner is the first handler to call `ctx.issues.update` (needs the new capability).
- `src/worker/agents/editor.ts:663` + `bulletin.action.approve` — existing `ctx.issues.update` call sites (the proven pattern).
- `src/worker/handlers/situation-room.ts` + `src/worker/situation/build-employees-rollup.ts` + `src/worker/situation/classify-employee-state.ts` — the live HTTP-scope rollup to extend with worker-tier grouping (R2). The `recompute-situation` cron job is DEAD — do NOT add compute there.
- `src/worker/handlers/chat-roster.ts` — owner-picker roster source (Editor-Agent already excluded).
- `src/worker/handlers/agent-resume-heartbeat.ts` (`agents.resumeHeartbeat`) — Resume for stood-down agents.
- `src/shared/blocker-chain.ts` (`flattenBlockerChain`/`pickTopChains`) + `src/shared/humanize-snapshot.ts` (`scrubHumanAction`, NO_UUID_LEAK) — consume, do not re-implement.
- `src/worker/agents/compile-tldr.ts` (`polishTldr`) — focusLine voice (unchanged).

### UI — restructure / delete
- `src/ui/surfaces/situation-room/index.tsx` — `SituationRoomBody` to restructure into 3 groups; remove AgentCard grid + `situation.artifacts` fetch + refreshKey re-resolve pattern (keep the force-refetch idea for post-assign).
- `src/ui/surfaces/situation-room/{employee-row,employee-row-strip,needs-you-banner,org-blocked-backlog-banner,critical-path-strip,agent-card,awaiting-you-pill}.tsx` — restructure/merge/delete per SPEC.
- `src/ui/primitives/theme.css` (Situation Room block ~565-826 + state tokens 600-606) — group section styles; remove dead grid CSS (1033-1066, 1242).
- `src/ui/surfaces/chat/deep-link.mjs` (`buildChatDeepLink` employee-only) — Open chat / Assign work routing.
- `src/ui/surfaces/chat/shortcuts-popover.tsx` / reader reverse-topics popover — popover patterns to reuse for the owner picker.

### Project guardrails + deploy
- `CLAUDE.md` — capability/trust model, bookended-by-snapshots rule, text-nodes-only, version-in-two-places.
- DEPLOY runbook (Phase 8 used Path A local-tarball install) + `runbook/` safety CLI — for the v1.3.0 BEAAA reinstall.
- `.claude/skills/sketch-findings-clarity-pack/SKILL.md` — validated CSS/design patterns (auto-loaded during UI build).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ctx.issues.update(...)`** — the only core-issue mutation path; typed; already used (editor.ts:663). assignOwner calls it with `actor` for audit attribution. NEVER `ctx.db` for public.issues.
- **`agent.takeOwnership` authority gate** — copy the viewer===owner + company-scope checks.
- **`chat.roster`** — owner picker source (Editor-Agent excluded by id).
- **`ctx.issues.requestWakeup`** (cap `issues.wakeup`, DECLARED) — Wake button.
- **`ctx.agents.pause`** (cap `agents.pause`, DECLARED) — Stand down; **`agents.resumeHeartbeat`** action — Resume.
- **`buildChatDeepLink` employee-only** — Open chat / Assign work navigation (proven, URL_HASH carrier).
- **`refreshKey` force-refetch** (index.tsx SituationRoomBody) — re-resolve the snapshot after an assign succeeds.

### Established Patterns
- Worker-tier compute, UI renders verbatim (ROOM-17 discipline) — apply to grouping (R2).
- All new actions/handlers wrapped by opt-in-guard (`wrapActionHandler`/`wrapDataHandler`).
- Version literal in BOTH `package.json` AND `src/manifest.ts` (host reads dist/manifest.js).
- T-08-UI: React text nodes only; agent/user UUIDs are consumed as args/keys, never rendered.
- CSS scoped to `[data-clarity-surface='situation-room']`; `check-css-scope` + `check-ui-bundle-size` gates.

### Integration Points
- `situation.snapshot` DATA HANDLER (live HTTP scope) — where the employees rollup is computed; add the `group` bucket here.
- `src/manifest.ts` — add `issues.update` to capabilities[]; remove the `recompute-situation` job entry; remove `situation.artifacts` registration; bump version.
- `src/worker.ts` — register `situation.assignOwner`; de-register `situation.artifacts` + `recompute-situation`.
- Tests touching the dead grid (7 files: `test/ui/situation-room.test.mjs`, `agent-card-*`, `artifact-chip-row`, `clarity-pack-css-rules`, `no-react-key-warnings`, `runtime-css-injection`) — rewrite to assert the grouped render.
</code_context>

<deferred>
## Deferred Ideas

- **Dependency-edge removal** (`ctx.issues.relations.removeBlockers`) — needs the `issue.relations.write` capability (only `.read` declared); status/owner assignment covers the real case. Future phase.
- **Inline backlog issue-picker for idle "Assign work"** — v1.3.0 routes to chat to brief; picker is a fast-follow.
- **Bubbling stale agents into Needs-you** — stale stays in Idle (deeper amber, sorted first). Revisit only if ignored live.
- **Bulk "assign all unowned" / keyboard triage / per-agent throughput chart** — Command-cockpit features, deferred.
- **npm / Clipmart publish** — clarity-pack is internal-only (local-tarball install).

### Reviewed Todos (not folded)
None — `todo.match-phase 9` returned 0 matches.
</deferred>

---

*Phase: 09-situation-room-actionable-cockpit*
*Context gathered: 2026-05-31*
