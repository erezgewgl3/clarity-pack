# Phase 12: Needs-You Triage - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Use the Phase 11 terminal taxonomy so "Needs you" tells the truth: it lists **only human-actionable items** (awaiting-human + genuinely-unowned), **ranked by what each unblocks** (leverage, not age), and shows **"Assign owner" only where assignment is genuinely the answer** (genuinely-unowned or stuck-agent rows). Triage keys off the engine's terminal **kind**, never a string match like `ownerName === 'Unassigned'`.

**In scope:** consume the engine's per-row verdict; compute the leverage ranking (the one piece D-16 deliberately kept OUT of the pure engine); fix the assign-owner gating; guarantee excluded items leave Needs-you. Satisfies NY-01, NY-02, NY-03.

**Out of scope (later phases):** the Editor-Agent named-action sentence + "unblocks → impact" prose (Phase 13); reply-in-place / quick-decision chips (Phase 14); the full Pulse + Needs-you/In-motion/Watch IA redesign (Phase 15). No new screen is built here; no non-additive schema.
</domain>

<decisions>
## Implementation Decisions

### Leverage metric (NY-02)
- **D-01:** **Leverage = count of distinct blocked items whose flattened chain terminates at this action** ("items it frees"). Acting once resumes all of them. Reuses chains the engine already walked — the edge set (`reason: 'blocks' | 'awaiting' | 'external'`) already encodes the dependency graph, so this is reverse-counting existing data, **not a new fetch**.
- **D-02:** **Sort = leverage descending; tie-break = stable deterministic issue id.** No time/age input in the sort — keeps ranking fully deterministic and unit-testable. (Explicitly rejected age-based tie-break.)
- **D-03:** **Needs-you is per-leaf deduped.** Collapse to **one action item per distinct leaf**, with leverage = all agents/items that leaf frees. This makes Needs-you **action-centric** ("one action, unblocks N") rather than per-employee. Requires a group-by-leaf step over the per-employee rollup rows.

### Assign-owner gating (NY-03)
- **D-04:** **Stuck-agent stays in the Watch tier** (roadmap SC1: Needs-you excludes stuck) **but its row gains an Assign-owner affordance there.** This satisfies NY-03 ("assign appears on genuinely-unowned OR stuck-agent") without polluting the loud Needs-you list. Assign affordance membership ≠ Needs-you membership.
- **D-05:** **Express it as a 1-line pure-engine edit to `classifyVerdict`:** `AWAITING_AGENT_STUCK` → `actionAffordance: 'assign'` (was `'nudge'`), `tier` stays `'watch'`, `needsYou` stays `false`. Keeps the per-kind `{tier, affordance, needsYou}` table the single source of truth (Phase 11 D-14) — every surface agrees, triage still keys purely off kind, no second mapping to drift. The edit stays deterministic (no AI/clock/DB), preserving the SC4 determinism test + AI-token grep guard.
- **D-06:** **`nudge` affordance may become dormant** after D-05 (no current consumer until the Phase 14 reply/nudge loop). Leaving it in the union is fine; do not delete the variant.

### Surface scope vs Phase 15
- **D-07:** **Leverage is sort-only this phase.** Use it to order rows; do **not** render an "unblocks N" badge or any impact text. The grounded named-action sentence + "unblocks → impact" prose is the Editor-Agent's job in Phase 13. Avoids half-built copy and keeps Phase 12 deterministic.
- **D-08:** **Leverage ranking applies to the Situation Room Needs-you list only.** The org-blocked backlog is not re-ordered by leverage this phase.
- **D-09:** **Assign-owner gating (NY-03) is enforced on every surface that shows an assign affordance** — Situation Room, Reader-view blocker panel, and org-blocked backlog — because they all read the same verdict. Assign shows only on `UNOWNED` (genuinely-unowned) and `AWAITING_AGENT_STUCK` rows; never on `AWAITING_HUMAN` or `UNCLASSIFIED`.
- **D-10:** **No new screen, no IA redesign.** Phase 12 is the honest data/ranking/gating layer the existing surfaces consume; the Pulse + tier IA is Phase 15.

### Routing excluded items (NY-01)
- **D-11:** **Hard invariant — agent-working + self-resolving never appear in Needs-you.** Membership keys off the engine's `needsYou` boolean (D-13/D-14 from Phase 11), never `ownerName === 'Unassigned'` or any string match.
- **D-12:** **Banner's single "most-urgent action" = highest-leverage item** (top of the ranked list; stable-id tie-break), not the oldest. The Phase-8-locked one-line banner (`⚠ N things need you → <action>`) stays; only its pick changes so banner and list-top agree.

### Claude's Discretion
- **Group→tier remapping is planner discretion (D-routing).** Whether the people-view's existing Needs you / Working / Idle groups (Phase 9) get remapped to the engine tiers (needs-you / in-motion / watch) now, or stay as-is with only Needs-you membership corrected, is left to planning — the likely-minimal answer is to leave Working/Idle grouping to the Phase 15 IA redesign and only enforce D-11 here. Hard constraint regardless: excluded items must not be in Needs-you.
- Exact leverage computation locus (in `build-employees-rollup` vs a small shared helper), the group-by-leaf data shape, and determinism-test fixtures for the ranking — planner discretion, provided the sort stays time-free (D-02) and pure.
</decisions>

<specifics>
## Specific Ideas

- The design seed **§3 Section 1** taxonomy table + the **Needs-you (N) row spec** are the literal target: "equal rows (no hero card), ranked by what each unblocks (not age) … No 'Assign owner' here" — Phase 12 delivers the ranking + the assign-suppression; the per-row named-action sentence/impact/estimate it describes is layered on in Phase 13.
- Per-leaf dedup (D-03) means the Needs-you list anticipates Phase 15's action-centric framing — but Phase 12 only establishes the grouping + order, not the redesigned screen.
- The reverse-dependency leverage count is computable from the existing `edges` (no new host fetch) — the same data the engine already walks forward for the blocker chain.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition + requirements
- `.planning/ROADMAP.md` — Phase 12 goal + 4 success criteria (the acceptance spine); note SC1 (Needs-you = awaiting-human + genuinely-unowned, stuck excluded) vs NY-03 reconciliation captured in D-04.
- `.planning/REQUIREMENTS.md` — **NY-01 / NY-02 / NY-03** (the requirements this phase satisfies).
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` — §1 (the wrong "9 unowned → assign owners" status quo this phase fixes), §3 **Needs-you (N) row spec** ("ranked by what each unblocks … No 'Assign owner' here"), §3 Section 1 (engine terminal-taxonomy table — tier/action columns triage consumes).

### The engine verdict + per-kind table (single source of truth — consumed, lightly edited)
- `src/shared/blocker-chain.ts` — `classifyVerdict()` (the pure per-kind `{tier, actionAffordance, needsYou}` table; D-05 edits the `AWAITING_AGENT_STUCK` row), `flattenBlockerChain`, `pickTopChains`, and the `edges`/`pathIds` structural data the leverage count reads.
- `src/shared/types.ts` — `Terminal` union + `BlockerChainResult` (the rich verdict: `needsYou`, `tier`, `actionAffordance`, `awaitedPartyLabel`, mutation-only UUIDs).
- `test/shared/blocker-chain.test.mjs` — determinism (100× `JSON.stringify`) + AI-token grep guard; MUST stay green after the D-05 table edit (SC4 / Phase 11 D-08).

### Triage consumers to update
- `src/worker/situation/build-employees-rollup.ts` — the Needs-you compute + sort; today sorts by status bucket + `oldestUnowned`/`oldestTargeting`. D-01/02/03 add the leverage rank + per-leaf dedup; D-12 repoints the banner `topAction`; D-11 keeps the `needsYou`-keyed membership (already migrated off the string match in Phase 9/11).
- `src/ui/surfaces/situation-room/{employee-row,needs-you-banner,owner-picker-popover}.tsx` — assign affordance gating (D-04/D-09); banner highest-leverage pick (D-12).
- `src/ui/surfaces/reader/{index,live-blocker-panel}.tsx` and the org-blocked backlog surface — assign-gating enforcement (D-09).

### Cross-cutting constraints + history
- `.planning/phases/11-honest-blocker-taxonomy-engine/11-CONTEXT.md` — D-13 (rich verdict), D-14 (engine owns the kind→{tier,affordance,needsYou} table — the reason D-05 edits the engine, not a second table), D-16 (leverage deliberately kept OUT of the engine → it lives here).
- `.planning/phases/08-situation-room-people-first-cockpit/08-CONTEXT.md` — the Needs-you **top-banner-only** lock (per-row highlight REJECTED) that D-12 preserves.
- `CLAUDE.md` — engine-purity (PRIM-03), NO_UUID_LEAK (the verdict's split display-label vs mutation-UUID, already enforced), governance parity, additive-schema rule (no migration intended this phase).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`classifyVerdict()`** (`blocker-chain.ts`) — the pure per-kind table; D-05 is a 1-line edit to its `AWAITING_AGENT_STUCK` row. Phase 12 triage imports this table rather than re-deriving (D-14).
- **`flattenBlockerChain` + `edges`/`pathIds`** — the dependency data the leverage count (D-01) reverse-walks; no new host fetch needed.
- **`build-employees-rollup.ts`** — already migrated off `ownerName === 'Unassigned'` to `needsYou === true && actionAffordance === 'assign'` (Phase 9/11); Phase 12 adds the leverage sort + per-leaf dedup + banner repoint on top of the existing `needsYou` compute.
- **`scrub-human-action.ts`** + verdict split-identity — NO_UUID_LEAK already enforced; per-leaf dedup must keep the human display label vs mutation UUID separation.

### Established Patterns
- **Pure-engine + AI-token grep guard** (PRIM-03): the D-05 table edit must keep the determinism test green; the leverage sort must stay time-free (D-02) to remain deterministic.
- **Caller computes the impure bits, engine takes structured facts** (Phase 11 D-01): leverage is a worker/triage computation over engine-supplied structural data, never an engine concern (D-16).

### Integration Points
- Leverage ranking + per-leaf dedup land in the Situation Room Needs-you compute (D-08).
- Assign-gating (`UNOWNED` + `AWAITING_AGENT_STUCK` only) enforced across SR, Reader panel, org-blocked backlog (D-09).
- No new migration (read-only triage; additive-schema rule untouched).

</code_context>

<deferred>
## Deferred Ideas

- **Named-action sentence + "unblocks → impact" prose + time estimate on each Needs-you row** — Phase 13 (Editor-Agent). Phase 12 only ranks (sort-only, D-07).
- **Reply-in-place / quick-decision chips that act on the ranked row** — Phase 14.
- **Pulse header + remapping the people-view groups to engine tiers (Needs-you / In-motion / Watch)** — Phase 15 IA redesign. The group→tier remap is explicitly left out of Phase 12 (D-routing discretion).
- **Re-ordering the org-blocked backlog by leverage** — out of Phase 12 scope (D-08); ranking is Situation-Room-only this phase.
- **`R3-self-assign-one-assignee`** (host "one assignee" rule on already-agent-owned rows) — tracked separately; may fold into the Phase 14 action-layer rework, not here.

### Reviewed Todos (not folded)
None — no todo matches surfaced for Phase 12.

</deferred>

---

*Phase: 12-needs-you-triage*
*Context gathered: 2026-06-02*
