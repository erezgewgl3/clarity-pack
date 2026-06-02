# Phase 15: Cockpit IA Redesign - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Redesign the **Situation Room page IA only** around "is it mine," loudest-on-top. Add a **Pulse header** (one plain-English status sentence + four vital signs) that answers "how's the company?" before any list, then reorganize the screen into **Needs-you → In-motion → Watch** tiers (loudest-on-top) that answer "what needs me?". This is the capstone of the v1.4.0 "Truthful Situation Room" milestone — the IA redesign the prior phases (9/12/13/14) deliberately deferred to here.

**In scope:**
- A **Pulse header** component: a deterministic one-sentence company-status line + four vital-sign counts (need-you / in-motion / stuck / self-clearing), computed by **aggregating the per-row verdicts the snapshot already carries** (no new fetch).
- Reorganizing `src/ui/surfaces/situation-room/index.tsx` + the row-strip layer into the **Needs-you / In-motion / Watch** three-tier IA (replacing the Phase-9 `Needs you / Working / Idle` people-strip group headers).
- Reusing the EXISTING row components verbatim: `employee-row.tsx` (already renders the Phase-13 action card + Phase-14 `<ReplyInPlace>` + Phase-12 assign gating), `blocked-backlog-expander.tsx`, `owner-picker-popover.tsx`.
- Folding the Phase-8 `needs-you-banner.tsx` role INTO the Pulse header (the Pulse becomes the always-visible status; the highest-leverage top callout is preserved).
- Degrade-safe + instance-agnostic rendering (SC4): the screen renders honestly when the Editor-Agent is down.

**Out of scope (explicit — do NOT change):**
- **No engine change.** `src/shared/blocker-chain.ts` is read-only consumed; no new `Terminal` kind, no edit to `classifyVerdict`, no AI token. The determinism test + AI-token grep guard MUST stay green.
- **No mutation-handler change.** `situation.replyAndResume` / `situation.assignOwner` are reused as-is; no new worker action.
- **No new data / no new fetch.** The Pulse vital signs are aggregations over the verdict fields already on each `situation_employees` row (`tier`, `terminalKind`, `actionAffordance`, `needsYou`) + the `org_blocked_backlog` already in the snapshot. The view only sums/renders; it never re-derives ownership (SC3).
- **No migration.** Confirmed: the `situation.snapshot` payload already carries everything the Pulse + tiers need (see `<code_context>`). A tiny optional `pulse` summary MAY be added to the snapshot return (worker-computed aggregation) to keep the count derivation out of the view — but it reads ONLY existing per-row verdicts, so it is additive-payload-only, NOT a schema/migration change.
- **No reply-in-place re-implementation.** `<ReplyInPlace>` (Phase 14) lives on the Needs-you rows already; Phase 15 only places those rows in the new tier IA.
- **No Bulletin / Reader / org-backlog surface redesign.** Phase 15 is the Situation Room page only.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Pulse header data source + the status sentence (COCK-01 / SC1)

- **D-01: The four vital signs are AGGREGATIONS over the existing per-row verdicts — computed in the worker rollup, surfaced as a small `pulse` summary on the snapshot; the view only renders.** SC3 forbids ownership re-derivation in the view, so the counts are summed from the worker-supplied `blockerChain` verdict fields already on every `situation_employees` row (and the `org_blocked_backlog` overflow). **Locked count definitions (each is a sum over existing verdicts — NO new fetch, NO new classification):**
  - **need-you** = the existing `needsYou.count` (the Phase-12 per-leaf-deduped human-actionable count) — already on the snapshot.
  - **in-motion** = count of rows whose `blockerChain.tier === 'in-motion'` (⇔ `AWAITING_AGENT_WORKING`) PLUS working-state rows (`group === 'working'`). Planner picks the exact denominator; the verdict tier is the source of truth where a chain exists.
  - **stuck** = count of rows whose `blockerChain.terminalKind === 'AWAITING_AGENT_STUCK'` (tier `'watch'`, the design-spec "1 agent stuck").
  - **self-clearing** = count of rows whose `blockerChain.terminalKind === 'SELF_RESOLVING'` (the design-spec "2 clearing themselves").
  **Rejected: compute the counts in the React view from the rows it already has.** While technically a pure sum (no fetch either way), computing in the worker keeps ALL verdict-derived numbers on one side of the bridge (SC3 "no re-derivation of ownership in the view layer"), gives the Pulse a single tested aggregation function, and matches the established `needsYou.count` pattern (already worker-computed). The view stays a dumb renderer.

- **D-02: The one-sentence status is a DETERMINISTIC TEMPLATE from the counts — the always-on baseline; the Editor-Agent prose is an OPTIONAL enrichment that degrades to the template.** SC4 demands the screen "renders honestly when the Editor-Agent is down," so the Pulse sentence MUST have a deterministic floor. The baseline template is generated purely from the four counts (e.g. *"The company is mostly moving — N need you, M in motion."* / *"N things need you."* / *"Nothing needs you — M in motion."*). When a fresh Editor-Agent status gloss exists (see D-03), it REPLACES the template line; when absent or stale, the template shows. The vital-sign chips are ALWAYS deterministic counts (never AI). **Rejected: Editor-Agent-generated sentence as the primary with no deterministic floor** — would blank or lie when the agent is cold, violating SC4 and the milestone's core honesty value. **Rejected: deterministic-only, no AI enrichment ever** — leaves the editorial "how's the company?" voice (the design-spec's *"The company is mostly moving"*) on the table; the optional enrichment is cheap and degrade-safe.

- **D-03: The optional Editor-Agent Pulse sentence reuses the existing grounded-summary pipeline (parity with Phase 13 action cards / bulletin gloss) OR is deferred to a follow-up — planner discretion, with the deterministic template as the must-ship floor.** A Pulse status gloss is a single grounded sentence over the snapshot counts/state, structurally identical to `driveBulletinGlossStep` / `driveActionCardsStep`. The HONEST minimum for Phase 15 is the deterministic template (D-02); shipping the AI enrichment this phase vs deferring it is the planner's call (the template alone satisfies SC1 + SC4). If shipped, it MUST: degrade to the template when stale/absent (10-min staleness rule, Phase 13 D-11), carry zero raw UUIDs (NO_UUID_LEAK), and run in the existing `situation.snapshot` valid-scope handler (no new cron) under governance parity.

### Area 2 — Tier mapping (COCK-02 / SC2 / SC3)

- **D-04: The three VISUAL tiers map directly off the engine verdict's `tier` field + `terminalKind` — no view re-derivation.** The real engine tier values (confirmed in `src/shared/types.ts` `BlockerChainResult.tier` and `classifyVerdict` in `src/shared/blocker-chain.ts`) are **`'needs-you' | 'in-motion' | 'watch'`**. The locked verdict→visual-tier mapping table:

  | Visual tier | Engine `tier` | Terminal kinds (`terminalKind`) | `needsYou` | What it shows | Row affordance |
  |---|---|---|---|---|---|
  | **Needs you** | `'needs-you'` | `AWAITING_HUMAN`, `UNOWNED` | `true` | named action + reply-in-place (Phase 13/14); leverage-ranked (Phase 12) | `reply` (AWAITING_HUMAN) / `assign` (UNOWNED) |
  | **In motion** | `'in-motion'` | `AWAITING_AGENT_WORKING` | `false` | calm "what each agent is working on" gist + age; NO action | `none` |
  | **Watch** | `'watch'` | `AWAITING_AGENT_STUCK`, `SELF_RESOLVING`, `EXTERNAL`, `CYCLE`, `UNCLASSIFIED` | `false` | quietly-stalled: stuck-agent (assign/redirect), external, cycle, self-resolving, + the org overflow backlog | `assign` (STUCK) / `open` (EXTERNAL/CYCLE/UNCLASSIFIED) / `none` (SELF_RESOLVING) |

  This is exactly the design-spec §3 Section 1 table and §3 Section 3 tier layout. The view reads `blockerChain.tier` / `blockerChain.terminalKind` verbatim (already on the row, threaded by `build-employees-rollup.ts`) — it NEVER re-classifies. **Confirmed against Phase 12 D-04:** stuck-agent stays in **Watch** (NOT Needs-you), carrying its `actionAffordance: 'assign'` there.

- **D-05: The tier IA REPLACES the Phase-9 people-strip group headers (`Needs you / Working / Idle`); the per-employee rows are reused, re-partitioned by VERDICT TIER (issue/action-centric), not by agent STATE.** This is the IA redesign Phases 9/12/13/14 explicitly deferred to Phase 15. **The design-spec-vs-code reconciliation that MUST be made explicit (see `<specifics>`):**
  - The Phase-9 `EmployeeGroup` (`'needs_you' | 'working' | 'idle'`, in `group-employee-state.ts`, derived from agent **state** via `groupForState`) is a DIFFERENT axis from the engine verdict `tier` (`'needs-you' | 'in-motion' | 'watch'`, derived from the **blocker chain**). They overlap but are not identical: an `idle` agent has no blocker chain (no tier); a `working` agent maps to `in-motion`; a `needs_you`-group agent's chain may be `needs-you` OR `watch` (a stuck-agent blocker is `group: needs_you` historically but `tier: watch`).
  - **Locked partition rule for Phase 15:** partition the rendered rows by **verdict tier where a blocker chain exists**, falling back to the agent-state group for chainless rows. Concretely:
    - **Needs-you tier** = rows with `blockerChain.tier === 'needs-you'` (the Phase-12 leverage-ranked, per-leaf-deduped human-actionable set; order preserved from the worker).
    - **In-motion tier** = `blockerChain.tier === 'in-motion'` rows + chainless `group === 'working'` rows (agents actively running with no blocker) — the calm "what each agent is working on" list.
    - **Watch tier** = `blockerChain.tier === 'watch'` rows (stuck / self-resolving / external / cycle / unclassified) + the `<BlockedBacklogExpander>` (org overflow) folded in here (the design-spec puts "29 more blocked issues" in Watch). Idle/stale agents with no blocker chain are AWARENESS items — planner discretion whether they render as a quiet Watch sub-list or a collapsed count (lean: a quiet "N idle agents" line in Watch, preserving the Phase-9 stand-down/resume affordances behind a disclosure).
  - **Rejected: keep the Phase-9 `Needs you / Working / Idle` people-strip and only relabel headers.** That keeps the IA agent-centric ("organize by agent") when the design-spec's locked principle is "organize by ownership not by agent" — the whole point of Phase 15. **Rejected: drop the per-employee row entirely for a pure issue list.** The Needs-you rows are already action-centric (Phase-12 per-leaf dedup); the In-motion/idle rows ARE agent-centric by nature ("what each agent is working on"), so the `EmployeeRow` component is the right reuse — re-partition it, don't replace it.

- **D-06: Reuse `EmployeeRow` for tier rows, but the In-motion + Watch presentations are CALMER per the design spec (lower contrast, content-text legible, no loud action cluster).** The design-spec is explicit: In-motion is *"calm, lower-contrast reassurance — one line per working agent (name + what they're working on + age) … content text must be clearly legible — not the dimmest thing on the row"*; Watch is *"quietly stalled … awareness, not act-now."* Planner discretion on whether this is (a) CSS-tier-class variants on the existing `EmployeeRow` (lean — `EmployeeRow` already renders `working` rows as a calm "moving · no action needed" line and `needs_you` rows with the action cluster), or (b) light-weight calm row variants. Hard constraints: the In-motion gist text (`focusLine`) is legible (not the dimmest element); Watch rows keep their honest affordance (stuck → assign/redirect, external/cycle → Open↗) per D-04; Needs-you rows keep the full Phase-13 action card + Phase-14 `<ReplyInPlace>`.

### Area 3 — Banner → Pulse fold (COCK-01)

- **D-07: The Phase-8 `needs-you-banner.tsx` role folds INTO the Pulse header; the Pulse becomes the single always-visible status surface.** The Pulse's "need-you" vital sign + the one-sentence status SUPERSEDE the old `⚠ N things need you → <action>` banner line. The highest-leverage **top-action callout** (the banner's `[Assign first ▾]` / `[Open chat]` behavior, driven by `needsYou.topAction`, the Phase-12 D-12 highest-leverage pick) is PRESERVED — rendered inside or directly under the Pulse as the single top callout, OR (lean) simply dropped in favor of the Needs-you tier's `lead`-styled top row (the mockup marks row 1 `qrow lead` with the gold border, which IS the highest-leverage callout). Planner discretion on placement; the **Phase-8 lock still holds: top-callout-only, per-row highlight on every Needs-you row was REJECTED** (see `08-CONTEXT.md` referenced lock). **Rejected: keep the standalone banner AND add a Pulse** — two competing status lines is exactly the noise the single-glance Pulse is meant to kill (design-spec principle "one glanceable pulse").

### Area 4 — Degrade contract (SC4)

- **D-08: The "honest when AI down" contract, locked per layer:**
  - **Pulse sentence** → falls back to the deterministic count template (D-02). The vital-sign chips are always deterministic counts (never AI). The Pulse NEVER blanks.
  - **Needs-you rows** → already degrade-safe per row: a fresh `actionCard` renders the named sentence; a stale/absent card falls back to the deterministic `blockerChain.humanAction` / `awaitedPartyLabel` line (Phase 13 D-12, already implemented in `employee-row.tsx`). `<ReplyInPlace>` reachability is computed off `terminalKind` (deterministic).
  - **Tiers themselves** → render purely from the engine verdict (`blockerChain.tier`/`terminalKind`), which is deterministic, engine-only, and present even on a thrown chain (the `UNCLASSIFIED` honest-fallback row from `build-employees-rollup.ts`'s catch). So tier membership is degrade-safe BY CONSTRUCTION — it does not depend on the Editor-Agent at all.
  - **Editor-Agent fully down** → Pulse shows the template sentence + real counts; every Needs-you row shows its deterministic line; In-motion/Watch are unaffected (verdict-only). The board is fully legible and honest with zero AI output. This is the SC4 acceptance.

### Area 5 — Reuse boundary (the final-assembly constraint)

- **D-09: Phase 15 is the FINAL assembly — it consumes, never re-derives.** It reuses, unchanged: the engine verdict (`blocker-chain.ts`, `classifyVerdict`), the worker rollup (`build-employees-rollup.ts`), the snapshot handler (`situation-room.ts`, modulo the optional `pulse` summary add), `employee-row.tsx`, `blocked-backlog-expander.tsx`, `owner-picker-popover.tsx`, `<ReplyInPlace>` (`src/ui/surfaces/_shared/reply-in-place.tsx`), `isReplyReachable` (`src/shared/reply-reachable.ts`), the action-card render (already in `employee-row.tsx`). The NEW code is: the `<PulseHeader>` component, the tier-partition layer (a rewrite of `index.tsx` + `employee-row-strip.tsx`'s grouping), and (optional) the worker `pulse` summary aggregation + (optional) the Editor-Agent Pulse-sentence step.

### Area 6 — Instance-agnostic + NO_UUID_LEAK (constraints)

- **D-10: The Pulse + tiers render human labels only — no company-prefix literals, no UUID text.** The company prefix comes from the existing `companyPrefix` var (`extractCompanyPrefixFromPathname`, already threaded through `index.tsx`); no `BEAAA`/`COU` literal anywhere (the mockup's `BEAAA-649` is illustrative, instance-agnostic in code). All UUIDs (`leafIssueUuid`, `targetAgentUuid`, `targetIssueUuid`, `ownerAgentId`, `actionCard.sourceIssueUuid`) stay dispatch-only — never rendered. The Phase-11 11-07 / Phase-14 NO_UUID_LEAK render-scan UUID-pattern guard MUST be extended to cover the new `<PulseHeader>` render path (and any new tier-list component). The Pulse counts are integers; the sentence is scrubbed prose; the vital-sign labels are static English.

### Claude's Discretion
- Exact deterministic Pulse template wording (D-02) + the count→adjective mapping ("mostly moving" / "needs attention"), provided it is pure and degrade-safe.
- Whether the optional Editor-Agent Pulse sentence (D-03) ships this phase or defers (the deterministic template is the must-ship floor).
- Whether the worker `pulse` summary is a new snapshot field (D-01, lean) vs a pure view-side sum (the view stays dumb either way; lean keeps it worker-side for SC3 cleanliness).
- Exact In-motion / Watch calm-row presentation: CSS tier-class variants on `EmployeeRow` (lean) vs light row variants (D-06).
- Placement of the preserved top-leverage callout: inside the Pulse vs the `lead`-styled top Needs-you row vs dropped in favor of the lead row (D-07).
- How chainless idle/stale agents surface in the Watch tier (quiet line vs collapsed count), preserving stand-down/resume (D-05).
- The CSS — the mockup `cockpit-redesign-v3.html` is the visual ground truth (Pulse / .vitals / .tier / .qrow / .calm / .mrow / .watch / .wrow); map its tokens to host CSS (Clarity Pack inherits host Tailwind, ships no parallel theme).
- New CSS class names + the `clarity-` prefix convention (matching the existing `clarity-employee-row` / `clarity-group-section` families).

## Decision → Requirement / Success-Criteria map
- **COCK-01 / SC1** → D-01, D-02, D-03, D-07 (Pulse header: one-sentence status + four vital signs; deterministic floor + optional AI enrichment; banner folds in).
- **COCK-02 / SC2** → D-04, D-05, D-06 (Needs-you → In-motion → Watch tiers, loudest-on-top; calm legible In-motion; Watch holds stuck/external/cycle/overflow).
- **SC3** → D-01, D-04, D-05, D-09 (counts + tiers consume the worker verdict + cards directly; zero view-layer ownership re-derivation).
- **SC4** → D-02, D-08 (deterministic Pulse template + per-row deterministic fallback + verdict-only tier membership = honest when the Editor-Agent is down).
- **Constraints** → D-09 (reuse boundary, no engine/mutation/data change), D-10 (instance-agnostic, NO_UUID_LEAK), `<domain>` (no migration).
</decisions>

<specifics>
## Specific Ideas

### Design-spec Pulse + tier quotes (the literal target — `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` §3 Section 3)

> **The Pulse** (top, always visible): one editorial sentence + four vital signs (need you / in motion / stuck / clearing themselves). "How's the company?" answered before any list.

> **Needs you** (N): equal rows (no hero card), **ranked by what each unblocks** (not age). Each row = named-action sentence + who + *unblocks →* impact + time estimate + running total. Reply-in-place inline (input + Send), yes/no chips when binary, "Open ↗" escape. **No "Assign owner"** here.

> **In motion** (N): calm, lower-contrast reassurance — one line per working agent (name + what they're working on + age). Content text (the "what they're working on" gist) must be clearly legible — not the dimmest thing on the row.

> **Watch** (N): quietly stalled — stuck agents (the one place redirect/assign survives), external waits, dependency cycles, and the org-wide overflow backlog. Awareness, not act-now.

> UX principles: one glanceable pulse; organize by ownership not by agent; rank by leverage; human-scale sentences + time estimates; calm scales with control; do-it-here.

### Design-spec §3 Section 1 engine taxonomy table (the verdict→tier source — already implemented in `classifyVerdict`)

> | Terminal | In "Needs you"? | Action |
> | `AWAITING_HUMAN` | **Yes** | named action → reply-in-place |
> | `AWAITING_AGENT_WORKING` | **No** → drops to "In motion" | none |
> | `AWAITING_AGENT_STUCK` | **Watch** (not "Needs you") | nudge / redirect (the only surviving assign-style action) |
> | `SELF_RESOLVING` | **No** | "clears by \<date\>" |
> | `EXTERNAL` / `CYCLE` | shown in Watch | chase-external / break-loop |
> | `UNOWNED` (genuine) | **Yes** | this is where "Assign owner" legitimately lives |

### The mockup (visual ground truth)
`.superpowers/brainstorm/1041-1780319036/content/cockpit-redesign-v3.html` — the exact Pulse (`.pulse` → `.when` / `.head` with gold `<b>` highlights / `.vitals` four `.vital` chips: `you`/`mov`/`stk`/`slf`), the three `.tier` blocks with `.tier-h` (italic-serif title + count pill + meta), Needs-you `.qrow`/`.qrow.lead` (rank + ⚑ star + action sentence + sub-line with green `.imp` impact + `.est` estimate + `.replybar` input/Send/Open + `.chips`), In-motion `.calm`/`.mrow` (green dot + name + legible `.gist` + age + "+2 more" overflow), Watch `.wrow`/`.wrow.red` (stuck red / external ↗ / overflow ▦). The illustrative `BEAAA-649` / "~12 min total" are NOT instance literals — render from real data.

### CRITICAL design-spec-vs-code reconciliation (flag for the planner — D-05)
There are **TWO different grouping axes in the codebase that the design spec conflates under one vocabulary:**
1. **Engine verdict `tier`** = `'needs-you' | 'in-motion' | 'watch'` — derived from the BLOCKER CHAIN (`classifyVerdict` in `blocker-chain.ts`; on `BlockerChainResult.tier` in `types.ts:63`). This is what the design-spec "tiers" mean.
2. **Phase-9 `EmployeeGroup`** = `'needs_you' | 'working' | 'idle'` — derived from the AGENT STATE (`groupForState` in `group-employee-state.ts`; on `SituationEmployeeRow.group`). This is the CURRENT people-strip partition (`employee-row-strip.tsx`).
They are NOT the same field and NOT 1:1 (note `needs_you` with underscore vs `needs-you` with hyphen — the underscore is agent-state, the hyphen is verdict-tier). Phase 15's IA must partition by the **verdict tier** (axis 1) for rows that have a blocker chain, and fold chainless agents (idle/working, axis 2) into In-motion/Watch as awareness items (D-05). Do NOT assume `group === 'needs_you'` ⇔ `tier === 'needs-you'`: a stuck-agent row is `group: needs_you` but `tier: watch`.

### Sketch-findings visual direction (`Skill("sketch-findings-clarity-pack")`)
- Warm-dark paper-on-ink palette; `--you` gold = Eric/needs-you, `--live` green = in-motion, `--warn` amber / `--alert` terracotta = watch. The mockup's tokens (`--gold`/`--green`/`--red`/`--amber`/`--ink*`) are this same family.
- Type: Instrument Serif italic for display titles/tier headers (matches the mockup's `font-family:Georgia,serif;font-style:italic` tier titles); Geist body; Geist Mono for IDs/meta.
- **Degraded states always name themselves — no silent failures, no forever-spinners.** Directly reinforces SC4: the Pulse template floor + per-row deterministic line.
- Clarity Pack ships NO parallel Tailwind/theme — inherit host CSS, map the mockup tokens to host design tokens at build time.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition + requirements
- `.planning/ROADMAP.md` — **Phase 15** goal + 4 success criteria (the acceptance spine); the v1.4.0 milestone framing (deterministic engine + Editor-Agent on top; the two halves stay visibly separate — no AI in `blocker-chain.ts`).
- `.planning/REQUIREMENTS.md` — **COCK-01** (Pulse header: one-sentence status + vital signs) + **COCK-02** (Needs-you → In-motion → Watch tiers, loudest-on-top; calm In-motion; Watch holds stuck/external/cycle/overflow) + the Out-of-Scope table.

### The design ground truth
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` — **§3 Section 3 "Cockpit information architecture"** (the Pulse + the three-tier layout — THE spec for this phase), **§3 Section 1** (the engine taxonomy table — verdict→tier, already implemented), **§2 locked decisions** (named action + reply-in-place; "the screen has one job: one glance answers how's the company, the next answers what needs me"), **§6 verification targets** (Needs-you only genuinely-human items; named action per row; Editor-Agent down → degrade, never blank/fabricate; NO_UUID_LEAK + instance-agnostic + degrade-safe).
- `.superpowers/brainstorm/1041-1780319036/content/cockpit-redesign-v3.html` — the mockup the design-spec §3 Section 3 cites (the Pulse + 3-tier visual ground truth; CSS class scaffold).
- `Skill("sketch-findings-clarity-pack")` — validated palette / type / "degraded states name themselves" direction (inherit host CSS; no parallel Tailwind).

### Upstream phase CONTEXTs this phase assembles
- `.planning/phases/11-honest-blocker-taxonomy-engine/11-CONTEXT.md` — D-13 (the rich verdict: `needsYou`/`tier`/`actionAffordance`), D-14 (the engine OWNS the kind→{tier,affordance,needsYou} table — Phase 15 consumes it, never re-derives), D-15 (split-identity NO_UUID_LEAK), D-16 (leverage kept out of the engine → Phase 12).
- `.planning/phases/12-needs-you-triage/12-CONTEXT.md` — D-01/02/03 (leverage rank + per-leaf dedup — the Needs-you tier order), **D-04 (stuck-agent → Watch tier, NOT Needs-you — the tier-mapping lock)**, D-11 (needsYou-keyed membership), the D-routing note ("group→tier remap is left to the Phase 15 IA redesign" — THIS phase).
- `.planning/phases/13-editor-agent-named-action/13-CONTEXT.md` — D-12 (per-row degrade to the deterministic line — the Needs-you degrade contract), D-13 (the action card already rendered on `employee-row.tsx`), the `ActionCard` shape; D-11 (the 10-min staleness rule the optional Pulse sentence reuses).
- `.planning/phases/14-do-it-here-action-loop/14-CONTEXT.md` — D-07 (the ONE shared `<ReplyInPlace>`, already on the Needs-you rows), D-10 (the reachable predicate `isReplyReachable`), the §Surface note ("reply-in-place ships in the Situation Room first; the IA round is later" — THIS phase).

### The engine verdict + type surface (read-only consume; NO edit)
- `src/shared/types.ts` — `BlockerChainResult.tier` = **`'needs-you' | 'in-motion' | 'watch'`** (the REAL tier values, §63); the 8-kind `Terminal` union (§43-51); `ActionCard` (§107-125).
- `src/shared/blocker-chain.ts` — `classifyVerdict()` (the per-kind `{tier, actionAffordance, needsYou}` table — the verdict→tier source of truth; **do NOT edit**); pure / AI-free (the determinism + AI-token guards in `test/shared/blocker-chain.test.mjs` MUST stay green).
- `src/shared/reply-reachable.ts` — `isReplyReachable(terminalKind)` (already consumed by the Needs-you rows; reused as-is).

### The EXISTING Situation Room page + components Phase 15 redesigns (REAL paths read)
- `src/ui/surfaces/situation-room/index.tsx` — **the top-level page component** (`SituationRoom` → `SituationRoomOptedIn` → `SituationRoomBody`). Today: opt-in gate → company resolve → active-viewer ping → `usePluginData('situation.snapshot')` + `usePollWithLeader` → renders `<NeedsYouBanner>` + `<EmployeeRowStrip>`. **Phase 15 rewrites the body's layout: add `<PulseHeader>`, replace the banner + group-strip with the tier IA.**
- `src/ui/surfaces/situation-room/employee-row-strip.tsx` — the CURRENT Phase-9 three-group people view (`Needs you / Working / Idle` headers via `GROUP_META`, partitions by `row.group`). **Phase 15 replaces its group-header IA with the verdict-tier IA** (or supersedes it with a new tier-list component reusing `EmployeeRow`).
- `src/ui/surfaces/situation-room/employee-row.tsx` — the per-agent row; ALREADY renders the Phase-13 action card (`row.actionCard` → named sentence + `estBucketLabel`), the Phase-14 `<ReplyInPlace>` (reply branch), the Phase-12 assign gating (`showAssign` off `actionAffordance === 'assign'`), Open↗, working/idle clusters. **Reused verbatim; re-partitioned into tiers; calm variant for In-motion/Watch (D-06).**
- `src/ui/surfaces/situation-room/needs-you-banner.tsx` — the Phase-8 one-line banner (3 variants off `needsYou`). **Phase 15 folds its role into the Pulse header (D-07).**
- `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx` — the org-overflow + critical-path drill-down (already has `<ReplyInPlace>` + assign gating per row). **Reused; relocated into the Watch tier (D-05).**
- `src/ui/surfaces/situation-room/owner-picker-popover.tsx` — the assign dispatch (`situation.assignOwner`). Reused as-is.
- `src/ui/surfaces/_shared/reply-in-place.tsx` — the ONE shared reply primitive (Phase 14). Reused as-is on Needs-you rows.

### The worker rollup + handler (the data the Pulse + tiers consume — NO new fetch)
- `src/worker/situation/build-employees-rollup.ts` — builds `situation_employees[]` (each row's `blockerChain.{tier, terminalKind, actionAffordance, needsYou, awaitedPartyLabel, leafIssueId, leafIssueUuid, needsDurabilityFlip}`) + the Phase-12 leverage-ranked, per-leaf-deduped `needsYou.{count, topAction}`. **The Pulse vital signs are a sum over these existing verdict fields (D-01) — the optional `pulse` summary aggregation lands here or in the handler.**
- `src/worker/handlers/situation-room.ts` — the `situation.snapshot` data handler (the valid-scope 60s recompute; cron is dead per PR #6547). Returns `{ org_blocked_backlog, situation_employees (with per-row actionCard), needsYou, taken_at }`. **Phase 15 MAY add an optional `pulse` summary field here (worker-computed counts) — additive payload, no migration.**
- `src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts` — the `OrgBlockedRow` / `OrgBlockedBacklog` UI types (Watch-tier overflow data).

### Cross-cutting constraints + history
- `CLAUDE.md` — NO_UUID_LEAK (UUIDs never rendered as text), instance-agnostic (no company-prefix literals; use `companyPrefix` var), engine purity (PRIM-03 — no AI in `blocker-chain.ts`), governance parity, same-origin trusted UI, additive-schema rule, the visual contract must match `sketches/` + the design spec, plugin namespace `plugin_clarity_pack_cdd6bda4bd`.
- `.planning/phases/08-situation-room-people-first-cockpit/08-CONTEXT.md` — the Needs-you **top-banner-only** lock (per-row highlight REJECTED) that the Pulse top-callout fold (D-07) preserves.
- `MEMORY.md` → `clarity-pack-plugin-page-routes.md` (page route `/<companyPrefix>/situation-room`), `phase-8-closed.md` + Phase 9 state (the people-first cockpit Phase 15 supersedes), `plugin-version-bump-two-sources.md` (version in BOTH `package.json` + `src/manifest.ts` for the live ship).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (real files read, with paths)
- **`src/ui/surfaces/situation-room/index.tsx`** — the SR page entry. The body (`SituationRoomBody`) already owns the snapshot fetch + `forceRefetch` + `companyPrefix`/`navigate` threading + opt-in/loading/error states. Phase 15 rewrites ONLY the render block (lines ~228-254: `<NeedsYouBanner>` + `<EmployeeRowStrip>` → `<PulseHeader>` + tier IA); the fetch/gate/poll plumbing is reused verbatim.
- **`src/ui/surfaces/situation-room/employee-row.tsx`** — the per-agent row with the FULL action stack already wired (Phase-13 `row.actionCard` named-sentence render + `estBucketLabel` helper; Phase-14 `<ReplyInPlace>` reply branch + `isReplyReachable(chain.terminalKind)`; Phase-12 `showAssign` gating; deterministic-line fallback when no fresh card). Reused as the tier-row renderer.
- **`src/ui/surfaces/situation-room/employee-row-strip.tsx`** — the partition-and-render layer (`byGroup` + `GROUP_META` + `GROUP_ORDER` + the empty-group "— none —" rule + the `<BlockedBacklogExpander>` mount). Phase 15 swaps its grouping axis (state-group → verdict-tier) and headers; the partition-then-render skeleton + empty-tier signal are reused.
- **`src/ui/surfaces/situation-room/blocked-backlog-expander.tsx`** — the org-overflow drill-down (reply/assign/Open per orphan row). Relocated into the Watch tier.
- **`src/ui/surfaces/situation-room/needs-you-banner.tsx`** — the Phase-8 banner (`NeedsYou` type + `topAction` highest-leverage pick + the `[Assign first ▾]` scroll-to-picker DOM handler). Its `count`/`topAction` data feeds the Pulse "need-you" vital sign + top callout (D-07); the component itself is superseded.
- **`src/worker/situation/build-employees-rollup.ts`** — already emits every per-row verdict field the Pulse aggregates + the deduped `needsYou.count`. The Pulse summary (D-01) sums these.
- **`src/worker/handlers/situation-room.ts`** — the snapshot handler; the optional `pulse` field lands here (additive payload).

### Established Patterns
- **Verdict-gated rendering, never string-match** (Phase 11/12): every affordance/tier reads `blockerChain.{tier, terminalKind, actionAffordance, needsYou}` — the Pulse counts + tier partition follow this (D-01/D-04), never `ownerName === 'Unassigned'`.
- **Worker computes, view renders** (Phase 11 D-01): the Pulse aggregation is a worker concern (D-01); the view sums nothing it can avoid (SC3).
- **Per-row degrade-safe + deterministic floor** (Phase 13 D-12 / sketch-findings "degraded states name themselves"): the Pulse template + per-row deterministic line (D-02/D-08).
- **Partition-then-render with an always-rendered empty signal** (`employee-row-strip.tsx`): an empty tier still renders its header + count (a zero is itself a signal) — carried into the tier IA.
- **Split-identity / NO_UUID_LEAK render-scan guard** (Phase 11 11-07 / Phase 14): extend the UUID-pattern render-scan to `<PulseHeader>` + any new tier component (D-10).
- **Force-refetch idiom** (`forceRefetch` / `onAssignSuccess`): a successful reply/assign/stand-down bumps `refreshKey` so the row re-resolves into its new tier live — reused across the tier IA.

### Integration Points
- **Pulse counts** = aggregations over the existing `situation_employees[].blockerChain.{tier, terminalKind}` + `needsYou.count` + `org_blocked_backlog` (D-01) — read-only, no new fetch.
- **Tiers** reuse `EmployeeRow` (Needs-you = full action stack; In-motion/Watch = calm variants, D-06), partitioned by `blockerChain.tier`/`terminalKind` (D-04/D-05), with `<BlockedBacklogExpander>` folded into Watch.
- **Needs-you tier order** = the worker's existing Phase-12 leverage rank (preserved; not re-sorted in the view).
- **Touches NO** `blocker-chain.ts` logic, NO mutation handler, NO new capability, NO migration, NO new data fetch.
</code_context>

<deferred>
## Deferred Ideas

- **Editor-Agent Pulse status sentence (the AI enrichment over the deterministic template)** — MAY ship this phase or defer (D-03); the deterministic template floor is the must-ship. If deferred, it's a clean follow-up reusing the gloss/action-card pipeline.
- **In-motion "+N more" overflow collapse, running-total minutes, "unblocks → impact" leverage prose** — the mockup shows these; the impact/running-total prose builds on Phase-12 leverage + Phase-13 cards. Planner discretion whether the full editorial richness ships now or trims to the honest minimum (Pulse + tiers + reused rows). Hard floor: SC1 (Pulse sentence + four counts) + SC2 (three tiers, loudest-on-top).
- **`R3-SELF-01` (take-it-myself / one-assignee guard on already-agent-owned rows)** — REQUIREMENTS.md Future; not part of the IA redesign. Surfaces in the action layer, not here.
- **Reworking Reader / org-backlog / Bulletin surfaces to the tier IA** — out of scope; Phase 15 is the Situation Room page only.
- **Reviving the dead `situation_snapshots` materialized table** — out of scope (cron writer dead per PR #6547; the handler computes fresh; additive-only leaves the empty table).

### Reviewed Todos (not folded)
None surfaced for Phase 15.
</deferred>

---

*Phase: 15-cockpit-ia-redesign*
*Context gathered: 2026-06-03*
