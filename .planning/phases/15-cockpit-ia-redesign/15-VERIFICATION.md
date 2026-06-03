---
phase: 15-cockpit-ia-redesign
verified: 2026-06-03T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open the Situation Room on BEAAA and confirm the PulseHeader displays a plain-English status sentence and four vital-sign count chips (need you / in motion / stuck / self-clearing) at the top, before any employee list."
    expected: "A non-blank sentence such as 'N things need you · M in motion.' is visible at page top; four labelled chips with integer counts render below it; the banner (if the old one is somehow still present) is absent."
    why_human: "The render path is correct and tested programmatically, but the actual visual appearance and host CSS token rendering (gold/green/amber tints for the four vital chips) can only be confirmed by a human viewing the live page."
  - test: "Confirm the three tiers — Needs you, In motion, Watch — render in that order (loudest-on-top) with headers and row counts, and that the org-blocked backlog expander appears in Watch, not Needs you."
    expected: "Needs you tier is first (top); In motion is second; Watch is third. Each header shows its title and a count. The '+ N more blocked issues' expander is inside the Watch tier footer."
    why_human: "Tier ordering and BlockedBacklogExpander placement within Watch is live CSS layout — only a human looking at the rendered page can confirm."
  - test: "Pick one agent in the Needs-you tier and verify the Phase-13 action card sentence (or deterministic fallback) + Phase-14 reply-in-place inline input are both visible."
    expected: "The row shows a plain-English named action (or 'waiting on <party> (ISSUE-ID)' fallback) and a reply input / quick-decision chips (if available)."
    why_human: "The action card content is Editor-Agent output — only a human can verify the correct deterministic degrade vs AI content and that the reply input actually appears inline."
  - test: "Verify In-motion rows are calm (no action buttons, legible 'what each agent is working on' text) and Watch rows are quiet (honest affordance visible — stuck shows OwnerPickerPopover, external shows Open arrow)."
    expected: "An In-motion row shows agent name + focus line + 'moving · no action needed' with no action buttons. A Watch stuck row shows 'agent stuck' + Assign owner popover. An external Watch row shows 'Open ↗'."
    why_human: "CSS calm/quiet visual presentation (contrast, opacity) and correct affordance rendering must be confirmed by a human reading the live page; automated tests verify source structure, not rendered CSS."
---

# Phase 15: Cockpit IA Redesign Verification Report

**Phase Goal:** Redesign the whole Situation Room screen around "is it mine," loudest-on-top — one Pulse glance answers "how's the company?", then Needs-you / In-motion / Watch tiers answer "what needs me?".
**Verified:** 2026-06-03
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A Pulse header states company status in one plain-English sentence + four vital signs (need-you / in-motion / stuck / self-clearing counts), answering "how's the company?" before any list. | VERIFIED | `src/ui/surfaces/situation-room/pulse-header.tsx` exports `<PulseHeader>` rendering a `.clarity-pulse-sentence` line from `buildPulseSentence(counts)` and four `.clarity-pulse-vital` chips (you/mov/stk/slf). `pulse-header.test.mjs` 15/15 pass. `pulse-header-no-uuid-leak.test.mjs` 8/8 pass. Worker aggregates the four counts in `build-pulse-summary.ts` and returns them as `snapshot.pulse`; `build-pulse-summary.test.mjs` 7/7 pass. |
| 2 | The screen is organized into Needs-you → In-motion → Watch tiers, loudest-on-top: Needs-you carries named actions + reply-in-place; In-motion is calm with legible focusLine text; Watch holds stuck-agent / external / cycle / overflow. | VERIFIED | `src/ui/surfaces/situation-room/tier-strip.tsx` defines `TIER_ORDER = ['needs-you','in-motion','watch']` and `visualTierOf()` partitioning by `blockerChain.tier`. `tier-strip.test.mjs` 23/23 pass including the stuck-agent-lands-in-Watch lock (D-04). `EmployeeRow` gates body by `visualTier` (not `row.group`). `BlockedBacklogExpander` mounted in Watch only. `index.tsx` mounts `<PulseHeader>` + `<TierStrip>`, `NeedsYouBanner` grep count is 0. |
| 3 | The cockpit consumes the engine verdict (Phase 11/12) and Editor-Agent cards (Phase 13) directly — no re-derivation of ownership in the view layer. | VERIFIED | `TierStrip.visualTierOf()` reads `row.blockerChain?.tier` verbatim; `EmployeeRow.visualTier` mirrors the same rule; no `.sort()` in the view (tier-strip.test.mjs assert); `buildPulseSummary` reads only existing `blockerChain.tier`/`terminalKind`/`group` fields (no new fetch, no re-classification). `blocker-chain.ts` last modified pre-Phase-15 (commit cfc0997). |
| 4 | Rows stay degrade-safe and instance-agnostic (no company-prefix literals); the screen renders honestly when the Editor-Agent is down. | VERIFIED | `tier-degrade.test.mjs` 10/10 pass: absent pulse → deterministic floor sentence (non-blank), tier partition with `actionCard: null` on every row classifies correctly (zero AI dependency), UNCLASSIFIED chain still partitions. `pulse-sentence.ts` never returns empty string. `pulse-header-no-uuid-leak.test.mjs` 8/8 pass: zero UUID matches in rendered text; no `companyPrefix` literal in new files. CSS check-css-scope 226 selectors all scoped. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/worker/situation/build-pulse-summary.ts` | Pure aggregation: employees + needsYou.count → {needYou,inMotion,stuck,selfClearing} | VERIFIED | Exports `buildPulseSummary` + `PulseSummary`; pure (no ctx/await/fetch); degrades to all-zero; 7/7 tests green. |
| `src/worker/handlers/situation-room.ts` | situation.snapshot return widened with additive `pulse` field | VERIFIED | Imports `buildPulseSummary`; calls it after `employeesWithCards` computed; returns `pulse` in the snapshot object (6 `pulse` occurrences); no migration added (16 migration files, 0016 was Phase 14). |
| `test/worker/situation/build-pulse-summary.test.mjs` | Count-definition + degrade tests | VERIFIED | 7/7 pass: need-you verbatim, in-motion no-double-count, stuck, self-clearing, representative set, all-zero degrade, purity scan. |
| `src/ui/surfaces/situation-room/pulse-sentence.ts` | Pure counts → deterministic status sentence + adjective | VERIFIED | Exports `buildPulseSentence`; pure (no hook/AI/fetch import); four count-regime phrasings + plural correctness + never returns empty string. |
| `src/ui/surfaces/situation-room/pulse-header.tsx` | `<PulseHeader>` — sentence + four vital-sign chips | VERIFIED | Exports `PulseHeader` + `PulseSummary`; 4 `clarity-pulse-vital` chip references via VITALS map; calls `buildPulseSentence`; zero `companyPrefix`/`dangerouslySetInnerHTML`; absent pulse → all-zero floor. |
| `src/ui/primitives/theme.css` | Scoped `.clarity-pulse*` + `.clarity-tier*` CSS under `[data-clarity-surface='situation-room']` | VERIFIED | Lines 950-1025: `.clarity-pulse*` rules. Lines 1118-1225: `.clarity-tier*` rules. All 226 selectors scoped (check-css-scope green). |
| `test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs` | Render-scan UUID guard extended to PulseHeader | VERIFIED | 8/8 pass: structural + behavioral scan, guard fixture proves UUID_RE is meaningful. |
| `src/ui/surfaces/situation-room/tier-strip.tsx` | `<TierStrip>` — partitions rows by blockerChain.tier, renders three tiers loudest-on-top, reuses EmployeeRow, folds BlockedBacklogExpander into Watch | VERIFIED | Exports `TierStrip`; `TIER_ORDER = ['needs-you','in-motion','watch']`; `visualTierOf()` reads `blockerChain?.tier` verbatim with chainless fallback; `<BlockedBacklogExpander>` mounted exactly once in the `watch` branch; 23/23 tests pass. |
| `src/ui/surfaces/situation-room/index.tsx` | SR body renders `<PulseHeader>` + `<TierStrip>`, replacing `<NeedsYouBanner>` + `<EmployeeRowStrip>` | VERIFIED | Imports `PulseHeader` + `TierStrip`; `SituationData` has `pulse?: PulseSummary`; renders `<PulseHeader pulse={payload.pulse} />` + `<TierStrip>`; `grep -c NeedsYouBanner` → 0; fetch/poll/ping/forceRefetch plumbing untouched. |
| `src/ui/surfaces/situation-room/employee-row.tsx` | Calm tier-variant presentation for In-motion / Watch rows | VERIFIED | Lines 226-233: `visualTier` derived from `chain?.tier` with chainless fallback; line 328: stamps `clarity-tier-row-${visualTier}` on root; lines 354/472/482: body gate on `visualTier` (not `row.group`); In-motion shows calm moving line (no action cluster); Watch shows quiet verdict + honest affordance. |
| `test/ui/surfaces/situation-room/tier-strip.test.mjs` | Partition-contract test (23 cases) | VERIFIED | 23/23 pass including the D-04 stuck-agent-→-Watch lock, all tier memberships, BlockedBacklogExpander placement, no-.sort(), and EmployeeRow tier-variant cases. |
| `test/ui/surfaces/situation-room/tier-degrade.test.mjs` | SC4 degrade test (10 cases) | VERIFIED | 10/10 pass: absent pulse, deterministic floor, no-AI-dependency partition, UNCLASSIFIED degrade, index mounts Pulse+TierStrip (not NeedsYouBanner). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `situation-room.ts` | `build-pulse-summary.ts` | `buildPulseSummary(employeesWithCards, needsYou)` | WIRED | Import at line 52-54; call at line 214; returned in snapshot at line 229. |
| `pulse-header.tsx` | `pulse-sentence.ts` | `buildPulseSentence(pulse)` | WIRED | Import at line 30; called at line 76 in the render function. |
| `index.tsx` | `pulse-header.tsx` | `<PulseHeader pulse={payload.pulse} />` | WIRED | Import at line 49; render at line 244. `payload.pulse` is the worker-computed summary. |
| `index.tsx` | `tier-strip.tsx` | `<TierStrip employees={...} ... />` | WIRED | Import at line 50; render at lines 251-260 with all required props. |
| `tier-strip.tsx` | `employee-row.tsx` | `<EmployeeRow key={row.agentId} ... />` per row | WIRED | Import at line 41; used in the rows map at line 150. |
| `tier-strip.tsx` | `blockerChain.tier` | `visualTierOf()` partition on `row.blockerChain?.tier` | WIRED | Lines 91-103: reads `.tier` verbatim; chainless fallback reads `.group`. |
| `employee-row.tsx` | `visualTier` body gate | `chain?.tier` → body section by `visualTier` | WIRED | Lines 226-233 compute `visualTier`; lines 354/472/482 gate three body sections on it (not `row.group`). |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `<PulseHeader>` | `pulse` prop | Worker `buildPulseSummary(employeesWithCards, needsYou)` → snapshot `.pulse` → `payload.pulse` in `index.tsx` → prop | Yes: pure sum over real per-row `blockerChain.tier`/`terminalKind` + `needsYou.count` | FLOWING |
| `<TierStrip>` | `employees` | Worker `buildEmployeesRollup` → `situation_employees` → `payload.situation_employees` in `index.tsx` → `employees` prop | Yes: real DB-driven agent rollup with per-row engine verdict | FLOWING |
| `buildPulseSentence` | `pulse` argument | `<PulseHeader>` passes `counts` (the prop's value or PULSE_FLOOR) | Yes: real four-integer counts from worker aggregation | FLOWING |
| Tier partition | `row.blockerChain?.tier` | Engine `classifyVerdict` (Phase 11 `blocker-chain.ts`) → worker rollup → `SituationEmployeeRow.blockerChain.tier` | Yes: deterministic engine verdict, not string-matched | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| build-pulse-summary pure aggregation | `node --test test/worker/situation/build-pulse-summary.test.mjs` | 7/7 pass | PASS |
| PulseHeader sentence + chips | `node --test test/ui/surfaces/situation-room/pulse-header.test.mjs` | 15/15 pass | PASS |
| NO_UUID_LEAK render-scan on PulseHeader | `node --test test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs` | 8/8 pass | PASS |
| TierStrip partition contract (incl. stuck→Watch lock) | `node --test test/ui/surfaces/situation-room/tier-strip.test.mjs` | 23/23 pass | PASS |
| SC4 degrade (no AI dependency) | `node --test test/ui/surfaces/situation-room/tier-degrade.test.mjs` | 10/10 pass | PASS |
| Engine purity (PRIM-03) | `node --test test/shared/blocker-chain.test.mjs` | 21/21 pass (PRIM-03 LLM-token guard green) | PASS |
| TypeScript compilation | `npx tsc --noEmit` | exit 0, no output | PASS |
| Worker build | `node scripts/build-worker.mjs` | green (2.5 MB) | PASS |
| UI build | `node scripts/build-ui.mjs` | green (742.8 kB) | PASS |
| CSS scope gate | `node scripts/check-css-scope.mjs` | 226 selectors all scoped | PASS |
| Bundle size ceiling | `node scripts/check-ui-bundle-size.mjs` | 760,646 B of 762,880 B ceiling (745 kB); 0 SheetJS | PASS |

---

### Probe Execution

Step 7c: SKIPPED — Phase 15 is a UI-only IA redesign (no new CLI, no migration probe, no scripts/*/tests/probe-*.sh declared for this phase).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COCK-01 | 15-01, 15-02 | Pulse header: one-sentence status + four vital signs | SATISFIED | `buildPulseSummary` (worker) + `buildPulseSentence` + `<PulseHeader>` chain fully implemented and tested. `snapshot.pulse` carries {needYou,inMotion,stuck,selfClearing}. |
| COCK-02 | 15-03 | SR organized Needs-you → In-motion → Watch, loudest-on-top | SATISFIED | `<TierStrip>` + `EmployeeRow` tier-variant implemented; partition test 23/23 green; `NeedsYouBanner` grep 0; `BlockedBacklogExpander` in Watch. |

Note: REQUIREMENTS.md traceability table still shows COCK-01 as "Pending" — that is a stale documentation state in REQUIREMENTS.md. The implementation and all tests confirm it is satisfied. This is a doc-only discrepancy; no code gap.

Pre-existing out-of-scope requirements with "Pending" status (NY-01/02/03, DO-02): these are Phase 12 + Phase 14 requirements tracked separately. Phase 15's scope is COCK-01 + COCK-02 only.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found in Phase 15 files. | — | — | — | — |

Debt-marker scan on all five Phase 15 source files (`build-pulse-summary.ts`, `pulse-sentence.ts`, `pulse-header.tsx`, `tier-strip.tsx`, index.tsx tier-wiring, `employee-row.tsx` tier-variant): zero TBD/FIXME/XXX/HACK/PLACEHOLDER hits.

---

### Human Verification Required

#### 1. PulseHeader visual rendering on BEAAA

**Test:** Open the Situation Room on the live BEAAA instance. Confirm the PulseHeader block appears at the top of the page above any employee tier. Check: (a) a non-blank status sentence is visible; (b) four labelled chips display with integer counts (need you / in motion / stuck / self-clearing) with colour tints (gold/green/amber/calm); (c) the old Phase-8/9 standalone banner is absent.
**Expected:** The sentence reads something like "N things need you · M in motion." (or "Nothing needs you — M in motion." or "The board is clear."). Four chips render with real counts from the current BEAAA snapshot. No old banner.
**Why human:** CSS token rendering (host Tailwind colour vars for gold/green/amber) and the live sentence text can only be confirmed by reading the rendered DOM. The deterministic sentence logic is proven by tests; the host CSS inheritance is not testable without the live page.

#### 2. Three-tier IA layout on BEAAA

**Test:** On the live Situation Room, confirm the three tier headers ("Needs you" / "In motion" / "Watch") appear in that top-to-bottom order with their count pills. Confirm the org-blocked-backlog expander ("+ N more blocked issues") is inside the Watch tier, not the Needs-you tier.
**Expected:** Needs you is at the top, then In motion, then Watch. The expander is under Watch. Each tier shows its count (a zero is acceptable and meaningful).
**Why human:** Tier header ordering and expander placement in rendered CSS layout must be confirmed visually.

#### 3. Needs-you row action stack and In-motion calm presentation

**Test:** On BEAAA, click on a row in the Needs-you tier. Confirm a named action sentence (or "waiting on <party> (ISSUE-ID)" fallback) and a reply input (or "Open ↗") are visible. Then look at an In-motion row: confirm it shows agent name + focus line + "moving · no action needed" with no action buttons.
**Expected:** Needs-you row: named action visible, reply input present (or Open ↗ if out-of-system). In-motion row: calm single-line presentation with no buttons.
**Why human:** The action card content comes from the Editor-Agent; only a human can verify it is correctly present vs the fallback and that reply-in-place actually opens inline.

#### 4. Watch tier stuck-agent and external presentation

**Test:** If any Watch tier rows are visible, confirm: a stuck-agent row shows "agent stuck" phrasing + an Assign owner popover trigger; an external-wait row shows "Open ↗". Confirm these rows are quieter (lower contrast) than Needs-you rows.
**Expected:** Stuck row: assign popover present. External row: Open arrow present. No action buttons on self-resolving rows. Visual contrast is lower than Needs-you.
**Why human:** The CSS quiet/loud distinction (opacity/colour) and the correct affordance per terminalKind must be confirmed by a human reading the live page.

---

### Gaps Summary

No gaps. All 4 success criteria are verified against the codebase. Human verification items cover the live BEAAA visual drill (which is explicitly noted in the phase objective as a "deploy-time gate").

The four human verification items are the live BEAAA drill that the phase itself identified as the deploy-time gate. They are not blockers to the automated verification result; they are the final pre-ship human confirmation step.

---

*Verified: 2026-06-03*
*Verifier: Claude (gsd-verifier)*
