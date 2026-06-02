# Phase 12: Needs-You Triage - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 12-needs-you-triage
**Areas discussed:** Leverage metric (NY-02), Assign-owner on stuck-agent rows (NY-03), Surface scope vs Phase 15, Routing excluded items (NY-01)

---

## Leverage metric (NY-02)

### Q1 — What "what each unblocks" counts
| Option | Description | Selected |
|--------|-------------|----------|
| Blocked items it frees | Count distinct blocked items whose flattened chain terminates at this action | ✓ |
| Full downstream subtree | Count the entire transitive set waiting behind the leaf | |
| Idle agents it wakes | Rank by stalled agents waiting on this action | |

**User's choice:** Blocked items it frees.

### Q2 — Tie-break when leverage is equal
| Option | Description | Selected |
|--------|-------------|----------|
| Oldest first | Fall back to age (existing oldestUnowned logic) | |
| Genuinely-unowned first | Surface UNOWNED above awaiting-human | |
| Stable / deterministic id | Break ties by issue id, no time input | ✓ |

**User's choice:** Stable / deterministic id.
**Notes:** Keeps the sort fully time-free and testable.

### Q3 — Several agents waiting on the same leaf
| Option | Description | Selected |
|--------|-------------|----------|
| Per-leaf, deduped | One Needs-you item per distinct action, leverage = all it frees | ✓ |
| Per-employee, shared score | Keep per-employee rows; each shows same leverage, sort adjacently | |
| You decide | Planner picks | |

**User's choice:** Per-leaf, deduped.
**Notes:** Makes Needs-you action-centric ("one action, unblocks N").

---

## Assign-owner on stuck-agent rows (NY-03)

### Q1 — Where stuck-agent lives + what you can do
| Option | Description | Selected |
|--------|-------------|----------|
| Watch tier, assign offered | Stays out of Needs-you (Watch), gains Assign-owner there | ✓ |
| Promote to Needs-you | Surface stuck agent IN Needs-you with Assign | |
| Assign + nudge both | Keep in Watch, offer both nudge and assign | |

**User's choice:** Watch tier, assign offered.
**Notes:** Honors SC1 (stuck excluded from Needs-you) while satisfying NY-03.

### Q2 — How to express the stuck→assign affordance
| Option | Description | Selected |
|--------|-------------|----------|
| Edit the engine table | classifyVerdict: AWAITING_AGENT_STUCK → 'assign', tier stays 'watch' | ✓ |
| Triage-layer override | Leave engine at 'nudge'; second Phase-12 mapping | |
| You decide | Planner picks | |

**User's choice:** Edit the engine table.
**Notes:** Single source of truth (Phase 11 D-14); 1-line pure edit; `nudge` may go dormant until Phase 14.

---

## Surface scope vs Phase 15

### Q1 — Show leverage as text or sort-only
| Option | Description | Selected |
|--------|-------------|----------|
| Sort-only now | Rank silently; prose deferred to Phase 13 | ✓ |
| Show a bare count | Render minimal "unblocks N" badge now | |
| You decide | Planner picks | |

**User's choice:** Sort-only now.

### Q2 — Which surfaces Phase 12 touches
| Option | Description | Selected |
|--------|-------------|----------|
| Ranking SR-only, gating everywhere | Leverage rank on SR Needs-you; assign-gating on all 3 surfaces | ✓ |
| Situation Room only | Confine ranking AND gating to SR | |
| All surfaces, fully | Ranking + gating + backlog re-order across all 3 | |

**User's choice:** Ranking SR-only, gating everywhere.
**Notes:** No new screen; IA redesign stays in Phase 15.

---

## Routing excluded items (NY-01)

### Q1 — How excluded items are "routed elsewhere"
| Option | Description | Selected |
|--------|-------------|----------|
| Stay in existing groups | Only guarantee not-in-Needs-you; defer group remap to Phase 15 | |
| Remap groups to engine tiers now | Switch people-view to engine tiers this phase | |
| You decide | Planner judges the grouping mapping | ✓ |

**User's choice:** You decide (planner discretion).
**Notes:** Hard invariant regardless — excluded items must not appear in Needs-you (keys off engine `needsYou`).

### Q2 — What the one-line banner points to now
| Option | Description | Selected |
|--------|-------------|----------|
| Highest-leverage action | Banner = top-ranked Needs-you item | ✓ |
| Keep oldest | Banner stays oldest even though list ranks by leverage | |
| You decide | Planner aligns banner with list-top | |

**User's choice:** Highest-leverage action.
**Notes:** Banner and list-top agree; Phase 8 one-line-banner lock preserved, only the pick changes.

---

## Claude's Discretion

- People-view group→engine-tier remapping (Needs you/Working/Idle → needs-you/in-motion/watch): planner discretion, likely deferred to Phase 15; hard constraint is the NY-01 exclusion invariant.
- Leverage computation locus (rollup vs shared helper), group-by-leaf data shape, and ranking determinism fixtures — planner discretion, provided the sort stays time-free and pure.

## Deferred Ideas

- Named-action sentence + "unblocks → impact" prose + estimate per row — Phase 13.
- Reply-in-place / quick-decision chips — Phase 14.
- Pulse header + group→tier remap — Phase 15.
- Org-blocked backlog re-order by leverage — out of Phase 12 scope.
- `R3-self-assign-one-assignee` host one-assignee rule — tracked separately; may fold into Phase 14.
