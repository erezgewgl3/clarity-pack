# Phase 9: Situation Room actionable cockpit — Discussion Log

> **Audit trail only.** Not consumed by downstream agents. Decisions live in `09-CONTEXT.md`; requirements in `09-SPEC.md`.

**Date:** 2026-05-31
**Phase:** 09-situation-room-actionable-cockpit
**Mode:** discuss (SPEC loaded — 9 requirements locked; discussion scoped to HOW only)
**Areas discussed:** Owner picker · "Take it myself" · Empty-group display · Stand-down aftermath

## Pre-discussion context

Heavy design pre-work this session before spec/discuss: interactive design dialogue (brainstorming), an approved clickable mockup (`sketches/clarity-situation-room-redesign.html`), a 5-agent constraints-research pass (SDK write capabilities, action surface, host HTTP, removal safety, visual contract), and a SPEC at ambiguity 0.08. As a result most "what/why" and much "how" was already locked; this discussion targeted only the remaining genuine user-facing implementation choices.

## Areas selected

User selected all four offered gray areas.

## Questions & selections

### Owner picker contents
- **Options:** (a) Full roster, role-ordered, Editor hidden *(recommended)* · (b) Full roster, alphabetical · (c) Smart relevant/least-busy first
- **Selected:** (a) Full roster, role-ordered, Editor-Agent hidden, no smart sorting.
- **Note:** Honors the no-prefill / trust-the-clarification-loop rule. Roster from existing `chat.roster`.

### "Take it myself" meaning
- **Options:** (a) Keep, honest framing *(recommended)* · (b) Drop — agents only · (c) Keep + open chat
- **Selected:** (a) Keep with honest framing — assigns `assigneeUserId` = operator; row leaves Needs-you, shows "with you — handling manually", drops from unowned/stuck count; never implies an agent will act.

### Empty-group display
- **Options:** (a) Hide empties + win-line *(recommended)* · (b) Always show all three · (c) Hide all silently
- **Selected:** (b) Always render all three group headers with counts; empty groups show "— none —". (Operator overrode the recommendation — wants all three buckets always visible so a zero in any bucket is itself a signal.)

### Stand-down aftermath
- **Options:** (a) Stay visible, paused + Resume *(recommended)* · (b) Vanish · (c) Collapsed "Stood down (N)" subsection
- **Selected:** (a) Paused agent stays in Idle with a "paused" marker + one-click Resume (reuses `agents.resumeHeartbeat`).

## Deferred ideas captured

Dependency-edge removal (needs `issue.relations.write`); inline backlog issue-picker for idle Assign-work; bubbling stale into Needs-you; bulk assign-all / keyboard triage / throughput chart; npm publish (internal-only).

## Todos

`todo.match-phase 9` → 0 matches.
