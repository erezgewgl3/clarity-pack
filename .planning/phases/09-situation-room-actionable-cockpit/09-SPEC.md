# Phase 9: Situation Room actionable cockpit — Specification

**Created:** 2026-05-31
**Ambiguity score:** 0.08 (gate: ≤ 0.20)
**Requirements:** 9 locked
**Ships as:** v1.3.0

## Goal

The Situation Room changes from a read-only status board (with a dead, duplicated agent grid and disabled "Open chat with Unassigned" buttons) into an **actionable cockpit**: one people view in three groups (Needs you / Working / Idle) where every stuck or idle agent ends in a **functional** button that resolves it in place — assign an owner, open chat, wake, assign work, or stand down — with the assign-owner path actually mutating the core Paperclip issue.

## Background

Today's `src/ui/surfaces/situation-room/index.tsx` stacks six things: `NeedsYouBanner` → `EmployeeRowStrip` (flat blocked-first list) → `OrgBlockedBacklogBanner` → `AwaitingYouPill` → `CriticalPathStrip` → a legacy `AgentCard` grid. Live problems confirmed this session by code-read + a 5-agent constraints-research pass:

- **Two layouts, one dead.** The `AgentCard` grid (`payload.employees`) is fed by a materialized snapshot whose `recompute-situation` cron job fails every tick on host `2026.525.0` (PR #6547). It renders a wall of false "Standby / No blockers" that contradicts the live people strip above it. `AgentCard` has exactly one importer; removing it is contained (tests only).
- **Dead buttons.** Blocked-unowned rows render `[Open chat with Unassigned]` **disabled** (deep link is null when the owner is `__unowned__`) — `employee-row.tsx:122`. There is no affordance to assign an owner, even though the chain leaf literally says "assign an owner first."
- **Frozen banner.** `needsYou.count` only counts chains already owned by the viewer (`needs-you-banner.tsx`), so in an all-unowned org it is permanently "✓ 0 need you" — the cockpit's headline signal can never fire.
- **Three overlapping blocker views.** Per-agent chains (rows), org-blocked-backlog (ROOM-12 banner), and the Critical Path strip all show the same stuck work three ways.

The capability to fix this exists and is already used in-repo: `ctx.issues.update(issueId, { assigneeAgentId | assigneeUserId | status }, companyId, actor)` (`src/worker/agents/editor.ts:663`, `bulletin.action.approve`). But `issues.update` is **not** in the manifest capabilities and the plugin has never mutated a core issue's assignee. Design approved this session via an interactive mockup (`sketches/clarity-situation-room-redesign.html`).

## Requirements

1. **One people view, three groups**: the Situation Room renders a single grouped people view; the dead grid is gone.
   - Current: `index.tsx` renders banner + flat row strip + org-backlog banner + awaiting-you pill + critical-path strip + `AgentCard` grid (`payload.employees`, dead-job-fed).
   - Target: one view with exactly three labeled groups — **§ Needs you**, **§ Working**, **§ Idle** — fed solely by `situation_employees`. The `AgentCard` grid, the `situation.artifacts` handler (grid's only consumer), and the `recompute-situation` cron job are removed.
   - Acceptance: the rendered surface contains exactly the three group sections; no `.clarity-agent-grid` / `.clarity-agent-card` in the DOM; `agent-card.tsx` deleted with no remaining importer; `recompute-situation` removed from manifest `jobs[]` and worker registration.

2. **Worker-tier grouping (deterministic, UI verbatim)**: each employee row carries its display group, computed at the worker.
   - Current: worker emits `situation_employees` sorted blocked→stale→idle→reviewing→running; UI renders one flat strip.
   - Target: a pure classifier assigns each row `group ∈ {needs_you, working, idle}` — `needs_you` = `blocked` (owned or unowned); `working` = `running | reviewing`; `idle` = `idle | stale`. The UI renders the worker order verbatim with no client-side grouping or re-sort.
   - Acceptance: a pure-function unit test maps every state (incl. `unknown`) to the correct group; a UI test asserts rows appear under the worker-assigned group and that no grouping/sorting logic runs client-side.

3. **Assign owner — act in place (the hero fix)**: the operator assigns an owner to an unowned blocking issue directly from a row, mutating the real issue.
   - Current: no assign affordance; `[Open chat with Unassigned]` is disabled; `issues.update` capability absent; plugin never mutates a core issue assignee.
   - Target: a new opt-in-guarded worker action `situation.assignOwner` (viewer-authority gate mirroring `agent.takeOwnership`) calls `ctx.issues.update(<blockerChain.leafIssueId>, { assigneeAgentId }, companyId, actor)` with `actor` = the operator. The blocked-unowned row's `[Assign owner ▾]` popover lists the agent roster (reuses `chat.roster`) plus a "Take it myself" item (`assigneeUserId`). On success the snapshot force-refetches and the row re-resolves.
   - Acceptance: clicking Assign owner → picking an agent reassigns the actual core issue (verified by re-reading the issue: `assigneeAgentId` == picked agent); the Paperclip audit trail attributes the change to the operator (`actor`), not the plugin worker; manifest `capabilities[]` includes `issues.update`.

4. **No dead buttons — every surfaced action is functional** *(operator's headline requirement)*: each state surfaces only actions that actually perform.
   - Current: rows render buttons that are disabled or no-op when their precondition isn't met (e.g. disabled "Open chat with Unassigned"; the v1.2.0 idle "Assign work" / "Stand down" were affordance-only no-ops).
   - Target: per-state action sets, each wired to a real succeeding action — **blocked-unowned** → Assign owner + Open issue; **blocked-owned** → Open chat (owner) + Wake (`requestWakeup`) + Open issue; **idle** → Assign work (opens chat to brief the agent); **stale** → Assign work + Stand down (`ctx.agents.pause`); **running/reviewing** → Open chat. If an action cannot be performed for a row, its button is **absent**, never rendered disabled or bound to a no-op.
   - Acceptance: a live BEAAA drill clicks every distinct action type ≥ once and observes the real effect (issue reassigned / chat opens scoped to the agent / wake fired / agent paused); an automated test asserts no rendered action button is `disabled` or bound to a no-op handler; zero "Open chat with Unassigned"-style dead affordances remain.

5. **Un-frozen needs-you banner**: the banner reflects unowned blockers, not just viewer-owned ones.
   - Current: `needsYou.count` counts only chains whose `ownerAgentId` resolves to the viewer → permanently 0 in an all-unowned org.
   - Target: count = (unowned blocked rows) + (chains whose owner resolves to the viewer). Urgent variant reads "⚠ N stuck · M unowned → assign owners …" with `[Assign first ▾]` that scrolls to the oldest unowned blocked row and opens its picker. Neutral variant only when the count is genuinely 0.
   - Acceptance: with ≥ 1 unowned blocked agent the banner shows a non-zero count + urgent styling; `[Assign first ▾]` opens the oldest unowned row's picker; after all blockers are owned the banner flips to the neutral "✓ 0 need you — N working · M idle" form.

6. **Org-backlog + critical-path folded into one expander**: the residual blocked-issue list and the critical-path narrative collapse into a single drill-down at the end of Needs-you.
   - Current: `OrgBlockedBacklogBanner` and `CriticalPathStrip` render as two separate sections.
   - Target: blocked issues not represented by an agent row fold into a single "+ N more blocked issues" expander at the **end of the Needs-you group**; the critical-path narrative moves into that expander. No standalone org-backlog banner or critical-path strip remains.
   - Acceptance: the DOM shows one expander inside Needs-you; no separate `.clarity-blocked-banner` toggle and no `.clarity-critical-path` strip; expanding lists the residual blocked issues.

7. **Confirm posture split**: frictionless on assign, guarded on pause.
   - Current: n/a (no functional mutations today).
   - Target: Assign owner and Assign work apply immediately with toast feedback (no intermediate confirm); Stand down (`ctx.agents.pause`) shows a confirm dialog before firing.
   - Acceptance: Stand down renders a confirm — cancel performs no pause, confirm fires `ctx.agents.pause`; Assign owner fires with no intermediate confirm step.

8. **Capability + version + safety bookend**: the first plugin core-issue mutation ships behind the project's safety rule.
   - Current: manifest has no `issues.update`; version is 1.2.1.
   - Target: add `issues.update` to manifest `capabilities[]`; bump version to **1.3.0** in BOTH `package.json` and the `src/manifest.ts` literal; deploy to BEAAA bookended by a verified pre-snapshot + rehearsed restore path.
   - Acceptance: manifest `capabilities[]` includes `issues.update`; both version literals read `1.3.0`; a pre-action snapshot exists and its restore-smoke passed before reinstall; the host install validator on `2026.525.0` accepts the new capability.

9. **Coexistence + security preserved**: no regressions to the trust model.
   - Current: T-08-UI text-nodes-only; NO_UUID_LEAK via `scrubHumanAction`; additive-only schema; all CSS scoped to `[data-clarity-surface]`.
   - Target: no new migration; agent/user UUIDs never rendered as text (React text nodes only, no `dangerouslySetInnerHTML`); `scrubHumanAction` NO_UUID_LEAK preserved; all new CSS under `[data-clarity-surface='situation-room']`; `focusLine` voice still via `polishTldr` (unchanged code path).
   - Acceptance: `check-css-scope` passes; grep shows no `dangerouslySetInnerHTML` in new components; no DDL touches `public.*` and no new migration file is added; live drill shows zero raw-UUID leaks in any human-facing string.

## Boundaries

**In scope:**
- The three-group people view (Needs you / Working / Idle) replacing the flat strip + dead grid.
- New `situation.assignOwner` worker action (`ctx.issues.update`, actor-attributed) + the agent-roster picker (incl. "Take it myself").
- Functional per-state action set: Assign owner, Open chat, Wake, Assign work (→ chat), Stand down (→ `ctx.agents.pause`), Open issue.
- Un-frozen needs-you banner (counts unowned blockers) + `[Assign first ▾]`.
- Org-backlog + critical-path merged into one "+N more blocked issues" expander.
- Confirm dialog on Stand down; immediate apply on assign.
- `issues.update` capability add; v1.3.0 bump (package.json + manifest); snapshot-bookended BEAAA reinstall + live assign-owner drill.
- Removal of `AgentCard` grid, `situation.artifacts` handler, and the `recompute-situation` cron job.

**Out of scope:**
- True dependency-edge removal (`ctx.issues.relations.removeBlockers` / `issue.relations.write`) — status/owner assignment covers the real "assign an owner first" case; edge-removal needs a capability we won't add this phase.
- An inline backlog issue-picker for idle "Assign work" — v1.3.0 routes to chat to brief the agent (per the "trust-the-clarification-loop" rule); a picker is a fast-follow.
- Bubbling stale agents up into Needs-you — stale stays in Idle (deeper amber, sorted first); revisit only if it's ignored in live use.
- Per-agent throughput charts, keyboard triage, bulk "assign all unowned" — Command-cockpit features, deferred.
- npm / Clipmart publish — clarity-pack is internal-only (local-tarball install).

## Constraints

- Core-issue mutation MUST go through the typed `ctx.issues.*` client with `actor` attribution — never `ctx.db.execute` (which is plugin-namespace-only and cannot touch `public.issues`).
- Grouping and sort are computed at the worker tier; the UI renders verbatim (same discipline as the locked ROOM-17 sort).
- React text nodes only; no second Tailwind; inherit host CSS tokens; new CSS scoped to `[data-clarity-surface='situation-room']`. UI bundle stays under the established ceiling (recalibrate per Phase 5/7/8 precedent if needed; ~729 kB baseline).
- `focusLine` voice unchanged (`polishTldr`); `scrubHumanAction` NO_UUID_LEAK preserved by construction.
- Bookended-by-snapshots: no install/upgrade/migration against live BEAAA without a verified recent snapshot + rehearsed restore.

## Acceptance Criteria

- [ ] Situation Room renders exactly three groups (Needs you / Working / Idle); no `.clarity-agent-grid` in the DOM.
- [ ] `agent-card.tsx`, the `situation.artifacts` handler, and the `recompute-situation` cron job are removed (deleted + de-registered), suite green.
- [ ] Row group is assigned at the worker tier; a pure-function test covers every state→group mapping; UI does no client-side grouping/sorting.
- [ ] Clicking Assign owner → pick agent reassigns the real core issue (post-action re-read shows the new `assigneeAgentId`), attributed to the operator in the audit trail.
- [ ] Manifest `capabilities[]` includes `issues.update`; both version literals (`package.json` + `src/manifest.ts`) read `1.3.0`.
- [ ] No rendered action button is `disabled` or bound to a no-op; a live drill clicks Assign owner, Open chat, Wake, Assign work, and Stand down and each performs its real effect.
- [ ] Needs-you banner shows a non-zero count + urgent styling when ≥1 unowned blocker exists; `[Assign first ▾]` opens the oldest unowned row's picker; flips to neutral when zero.
- [ ] Org-backlog + critical-path appear only as a single "+N more blocked issues" expander inside Needs-you; no standalone banner or strip.
- [ ] Stand down shows a confirm before pausing; Assign owner applies with no intermediate confirm.
- [ ] `check-css-scope` passes; no `dangerouslySetInnerHTML` in new components; no DDL on `public.*`; no new migration file; zero raw-UUID leaks in the live drill.
- [ ] BEAAA reinstall is preceded by a verified snapshot + rehearsed restore; live assign-owner drill PASSES.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                            |
|--------------------|-------|------|--------|------------------------------------------------------------------|
| Goal Clarity       | 0.94  | 0.75 | ✓      | Actionable cockpit, 3 groups, act-in-place assign-owner          |
| Boundary Clarity   | 0.90  | 0.70 | ✓      | Explicit out-of-scope (edge-removal, idle picker, stale bubble)  |
| Constraint Clarity | 0.90  | 0.65 | ✓      | ctx.issues.update only, actor attribution, capability, snapshot  |
| Acceptance Criteria| 0.92  | 0.70 | ✓      | No-dead-buttons live-drill check is falsifiable                  |
| **Ambiguity**      | 0.08  | ≤0.20| ✓      | Heavy design pre-work (approved mockup + constraints research)   |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective       | Question summary                                  | Decision locked                                                                 |
|-------|-------------------|---------------------------------------------------|---------------------------------------------------------------------------------|
| 0     | Brainstorming     | Action model for stuck/unowned rows               | Act in place (mutate via worker action), not route-only                          |
| 0     | Brainstorming     | How far to take the redesign                      | "One cockpit": delete grid, three groups, un-freeze banner, merge backlog        |
| 0     | Brainstorming     | Group structure                                   | Needs you / Working / Idle; stuck work on top; org-backlog → Needs-you expander  |
| 0     | Brainstorming     | Stale + owned-blocker placement                   | Stale stays in Idle (deeper amber, first); owned blockers stay in Needs-you      |
| 1     | Simplifier        | Which actions ship in v1.3.0?                     | All four (assign / chat+wake / assign-work / stand-down) — must all be functional |
| 1     | Failure Analyst   | Confirm posture on consequential mutations        | Split: assign instant, pause confirms                                            |
| 1     | Boundary Keeper   | Operator's hard requirement                       | NO dead buttons — every surfaced affordance performs; else it is absent (R4)     |

---

*Phase: 09-situation-room-actionable-cockpit*
*Spec created: 2026-05-31*
*Next step: /gsd:discuss-phase 9 — implementation decisions (how to build what's specified above)*
