# Phase 18: No rabbit-holes & plain-English — Specification

**Created:** 2026-06-13
**Ambiguity score:** 0.17 (gate: ≤ 0.20)
**Requirements:** 3 locked

## Goal

Every "Open ↗" on every Clarity surface lands the user on the inline-resolved Clarity Reader (never the raw classic issue page); zero raw or partial agent/UUID identifiers survive into any human-facing text on any surface; and when the AI TL;DR reads "done" while the deterministic engine still classifies the item as blocked, the user is offered a non-destructive "Looks done — close it?" confirm instead of the divergence being hidden.

## Background

Clarity Pack runs on BEAAA at **v1.6.0**. Phase 17 (the centerpiece) shipped truthful cross-surface verdicts — the deterministic engine now classifies `AWAITING_HUMAN` correctly, and every blocked-no-edge class reads one consistent verdict across surfaces. Phase 18 consumes those truthful verdicts to deliver the plain-English / no-rabbit-hole guarantees.

Current state grounding (scouted 2026-06-13):

- **LEG-01 (rabbit-hole routing):** Every "Open ↗" navigates to `/<companyPrefix>/issues/<id>` — the **raw classic Paperclip issue page** (the wall of unresolved inline references). Sites: `src/ui/surfaces/reader/live-blocker-panel.tsx:171`, `src/ui/surfaces/situation-room/employee-row.tsx:238/453/508`, `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx:62`, `src/ui/surfaces/bulletin/lineage-footer.tsx:48`, `src/ui/surfaces/_shared/reply-in-place.tsx:227`. None land the user on the Clarity Reader tab. (Phase 17 D-12 confirmed only `/<companyPrefix>/issues/<id>` routes — whether the host can deep-link a specific *tab* is the one open HOW/research item for discuss-phase.)
- **LEG-02 (raw/partial id leak):** `src/shared/scrub-human-action.ts` still emits `agent#${uuid.slice(0,8)}` as its last-resort fallback (lines 65, 66, 71, 78, 86). That partial hash is exactly the leak LEG-02 forbids ("zero raw **or partial**"). The A1 decision to render the literal "an agent" was specced in the superseded Phase-16 misscope (`.planning/phases/_superseded-legibility-16-18-misscope/`) but **never executed** — those 4 plans are reusable input, not shipped code. Chat `CHT-<8>` topic chips and `run·<8>` fragments bypass the scrub pipeline entirely and render raw hex. The live anchor: Reader BEAAA-972 reads "AWAITING AGENT STUCK — CEO stuck on agent#04fcac7c is stuck".
- **LEG-03 (honest divergence):** No "looks done vs blocked" affordance exists anywhere. It is brand new and depends on Phase 17's now-shipped truthful verdicts and the existing AI TL;DR cache.

The verdict pipeline already has a clean "one engine → one scrub → one verdict" architecture (Phase 11 + v1.4.2 + Phase 17), so these fixes land at identified boundaries (scrub fallback, Open↗ nav targets, a new divergence affordance) — not a redesign. The visual mockup contract is unchanged.

## Requirements

1. **LEG-01 — Open↗ routes to the Clarity Reader, never the raw page**: All "Open ↗" controls land the user on the inline-resolved Clarity Reader view of the target issue.
   - Current: Every Open↗ navigates to `/<companyPrefix>/issues/<id>`, landing on the classic issue tab (the unresolved-reference wall)
   - Target: Open↗ deep-links onto the Clarity Reader tab of the issue across **all four sites** — Reader cross-references, Situation Room rows, the blocked-backlog expander, and the Bulletin footer. If the host genuinely cannot auto-select a tab, the fallback is to route to the issue page with the Reader tab auto-selected (the bar is "user sees the resolved Reader, not the classic wall")
   - Acceptance: A live drill clicking Open↗ from each of the four surfaces lands on the Clarity Reader (inline-resolved TL;DR/refs visible), not the raw classic issue body; no Open↗ path leaves the user on the classic tab as the terminal destination

2. **LEG-02 — Zero raw or partial agent/UUID identifiers in human-facing text**: Every agent reference shows a human name/role or the literal "an agent"; no surface leaks a raw UUID or a partial `agent#<hex>` hash.
   - Current: `scrub-human-action.ts` falls back to `agent#<8>` partial hashes; chat `CHT-<8>`/`run·<8>` chips render raw hex; tests currently BLESS `agent#<8>` as acceptable output
   - Target: (a) the scrub last-resort fallback changes from `agent#${uuid.slice(0,8)}` to the literal lowercase **"an agent"** (real human name/role resolved first via the SR employee name-resolution path; "an agent" is the last resort only); (b) all four surfaces (Reader, Situation Room, Bulletin, Chat) render-scrub so no partial hash reaches the DOM; (c) the NO_UUID_LEAK render-scan guard is extended to FAIL on `agent#<hex{6,}>` and bare UUIDs, anchored — NOT a blanket short-hex rule that false-positives on git SHAs; (d) **chat id-fragment chips** (`CHT-<8>`, `run·<8>`) are humanized to readable labels; (e) **already-persisted leaked strings** (e.g. `tldr_cache` rows, focus summaries) are re-scrubbed at read-time (additive, no destructive migration)
   - Acceptance: a named regression test asserts `agent#<8>` and bare UUIDs FAIL the guard (inversion of today's tests); a live drill confirms BEAAA-972's Reader stuck-terminal reads with a human name or "an agent" and no hash; the Chat surface shows zero `CHT-<8>`/`run·<8>` hex fragments; a historical row that captured `agent#<8>` pre-fix reads clean on the next read

3. **LEG-03 — "Looks done — close it?" honest-divergence affordance**: When the AI TL;DR reads done but the deterministic engine still classifies the item blocked, a non-destructive close confirm is surfaced (not hidden).
   - Current: No divergence affordance exists; a "done"-reading TL;DR on a still-blocked item is silently inconsistent
   - Target: On the **Reader** (next to the TL;DR) AND the **Situation Room needs-you row**, surface a "Looks done — close it?" affordance when the TL;DR done-signal contradicts the engine's blocked verdict. Clicking opens a confirm ("Close as done" / "Keep blocked") — it **never auto-closes**. Degrade-safe: when no TL;DR exists or the engine verdict is absent, the affordance simply does not appear (no false prompt)
   - Acceptance: a test fixture where TL;DR=done + engine=blocked renders the affordance on both Reader and SR; the affordance is absent when TL;DR and engine agree, and absent when either input is missing; clicking does not mutate issue state without an explicit confirm selection

## Boundaries

**In scope:**
- Re-pointing all four Open↗ sites to land on the Clarity Reader (with the issue-page + Reader-auto-select fallback)
- Changing the scrub last-resort fallback `agent#<8>` → "an agent", wired behind real name/role resolution
- Render-scrubbing all four surfaces (Reader, Situation Room, Bulletin, Chat)
- Extending the NO_UUID_LEAK guard (anchored `agent#<hex{6,}>` + UUID) and inverting the tests that currently bless `agent#<8>`
- Humanizing Chat `CHT-<8>` / `run·<8>` id-fragment chips
- Re-scrubbing already-persisted leaked strings at read-time (additive)
- A non-destructive "Looks done — close it?" confirm on the Reader and the SR needs-you row

**Out of scope:**
- `blocker-chain.ts` engine edits — pure deterministic engine, guarded by determinism + AI-token grep (LEG-03 reads the verdict, never changes the engine)
- Any AI/LLM in the deterministic path — the affordance and scrub are deterministic; no new AI dependency
- Action-cards async re-architecture / `ACTION_CARDS_ENABLED` — Phase 19, flag-gated, LOCKED last
- Snapshot performance re-architecture — owned by Phase 16 (shipped) / not re-opened here
- Non-additive / destructive migrations to rewrite historical persisted strings — re-scrub on read instead
- New visual design beyond text/label substitution and the one new affordance — the mockup contract is unchanged
- Auto-closing issues — LEG-03 is confirm-gated by construction

## Constraints

- **Additive-only plugin-namespace schema** — disable/uninstall preserves data (coexistence guarantee #3/#6); no destructive migration for the persisted re-scrub.
- **Degrade-safe deterministic floor** — every new affordance/scrub renders correctly when the Editor-Agent/TL;DR cache is absent; no AI token in `blocker-chain.ts` (determinism + AI-token grep guards stay green).
- **Instance-agnostic** — no company-prefix literals; routing uses `companyPrefix` from host context.
- **Scoped CSS gate** — any new styling passes `check-css-scope.mjs`; bundle-size gate respected.
- **Host tab deep-link feasibility is unverified** — whether `/<companyPrefix>/issues/<id>` can target the Clarity Reader tab is a discuss-phase/research HOW item; LEG-01's locked fallback (issue page + Reader auto-selected) bounds the risk.
- **Continuous flag-gated BEAAA deploy** — bookend = automated DO backups; two-source version bump (BOTH `package.json` AND `src/manifest.ts`) per DEPLOY-RUNBOOK.

## Acceptance Criteria

- [ ] Open↗ from the Reader cross-refs, Situation Room rows, blocked-backlog expander, and Bulletin footer each land on the Clarity Reader view (not the classic issue body) in a live BEAAA drill
- [ ] `scrub-human-action.ts` last-resort fallback emits "an agent" (never `agent#<hex>`); a real human name/role is shown when resolvable
- [ ] NO_UUID_LEAK guard FAILS on `agent#<hex{6,}>` and bare UUIDs; the previously-blessing tests are inverted to assert failure
- [ ] No surface (Reader/SR/Bulletin/Chat) renders a raw UUID or partial `agent#<8>` hash — verified by the render-scan guard
- [ ] Chat `CHT-<8>` and `run·<8>` id-fragment chips render as human-readable labels (zero hex fragments)
- [ ] A persisted row that captured `agent#<8>` before the fix reads clean on the next read (read-time re-scrub), with no destructive migration
- [ ] The "Looks done — close it?" affordance appears on BOTH the Reader and the SR needs-you row when TL;DR=done contradicts engine=blocked
- [ ] The affordance is absent when TL;DR and engine agree, and absent when either input is missing (no false prompt)
- [ ] The affordance never mutates issue state without an explicit "Close as done" confirm selection

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                        |
|--------------------|-------|------|--------|--------------------------------------------------------------|
| Goal Clarity       | 0.85  | 0.75 | ✓      | Reader-tab bar + LEG-03 confirm-action both pinned           |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Chat chips IN, persisted re-scrub IN, 4 sites, Reader+SR     |
| Constraint Clarity | 0.78  | 0.65 | ✓      | Invariants known; host tab-deeplink feasibility = HOW item   |
| Acceptance Criteria| 0.80  | 0.70 | ✓      | Guard-inversion + Open↗ drill + confirm-not-auto-close       |
| **Ambiguity**      | 0.17  | ≤0.20| ✓      | Gate passed round 1                                          |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective | Question summary | Decision locked |
|-------|-------------|-----------------|-----------------|
| 1 | Researcher | LEG-01 bar — land on Reader tab vs issue page, which surfaces? | Land on Reader tab, ALL 4 sites (Reader/SR/backlog/Bulletin), with issue-page+Reader-auto-select fallback |
| 1 | Researcher/Boundary | LEG-02 breadth — which optional extras in scope? | Chat id-fragment chips IN **and** persisted-string re-scrub on read IN (atop the locked core: "an agent" fallback + 4-surface render-scrub + guard extension) |
| 1 | Researcher/Failure | LEG-03 surfaces + action verb? | Reader **and** SR needs-you row; non-destructive confirm ("Close as done"/"Keep blocked"), never auto-close |

---

*Phase: 18-no-rabbit-holes-plain-english*
*Spec created: 2026-06-13*
*Next step: /gsd:discuss-phase 18 — implementation decisions (tab deep-link mechanism, shared wording helper home, divergence trigger definition, chat-chip humanization render layer)*
