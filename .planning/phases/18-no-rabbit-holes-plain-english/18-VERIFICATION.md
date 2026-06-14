---
phase: 18-no-rabbit-holes-plain-english
verified: 2026-06-15T00:00:00Z
status: human_needed
score: 10/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "LEG-01 Tier-1 re-probe — does the live host honor ?tab=clarity-reader or #tab=clarity-reader?"
    expected: "If a carrier is honored, buildReaderHref returns the base + carrier; Open↗ lands directly on the Clarity Reader tab without the operator needing to click. If no carrier is honored, Tier-2 remains correct and the acceptance-risk note is formally closed."
    why_human: "The deep-link probe (scripts/probes/reader-tab-deeplink.mjs) was deferred because the Clarity UI was blank at plan-execution time. The UI is now live at v1.7.1. Re-running the probe requires a live BEAAA session with a working Reader and is not automatable from this codebase."
  - test: "LEG-03 live-positive demo — affordance visible on a real done-but-blocked item"
    expected: "The 'Looks done — close it?' confirm banner appears on BOTH the Reader TL;DR area and the SR needs-you row for a live issue whose TL;DR cached body reads as done (looksDone fires) AND whose engine verdict is AWAITING_HUMAN or AWAITING_AGENT_STUCK (needsYou=true). Clicking 'Keep blocked' leaves the issue open."
    why_human: "No done-but-blocked item currently exists on BEAAA (confirmed by the 18-04 live drill). The present-case path is unit-test-proven across 17 tests (looks-done-affordance, looks-done, build-employees-rollup-looks-done). A live-positive demo requires a real BEAAA issue to reach that state (e.g. the Editor compiles a 'Feature is done' TL;DR while the item remains blocked in the chain). This is the same pattern as Phase 17's WAIT-04 live rider."
---

# Phase 18: No Rabbit-Holes & Plain-English — Verification Report

**Phase Goal:** "No rabbit-holes & plain-English" — LEG-01: every Open↗ lands on the inline-resolved Clarity Reader; LEG-02: eliminate every raw/partial agent/UUID identifier from human-facing text on all four surfaces; LEG-03: surface the honest divergence ("Looks done — close it?" confirm) when the AI TL;DR reads done but the deterministic engine still classifies the item blocked.
**Verified:** 2026-06-15T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All five Open↗ issue-open sites route through `buildReaderHref()` (single-source helper) | ✓ VERIFIED | `grep` confirms 5 call sites (live-blocker-panel.tsx:232, employee-row.tsx:249, blocked-backlog-expander.tsx:64, lineage-footer.tsx:50, reply-in-place.tsx:229); render-scan test 11/11 green |
| 2 | Chat deep-links (openChatWithOwner/assignWork) are NOT re-pointed | ✓ VERIFIED | `buildChatDeepLink` retained in employee-row.tsx and lineage-footer.tsx; landmine #8 test passes |
| 3 | `scrub-human-action.ts` last-resort fallback emits "an agent", never `agent#<hex>` | ✓ VERIFIED | Zero `agent#${` template literals in scrub module (grep returns empty); AGENT_FALLBACK constant = 'an agent'; 7/7 scrub tests green including three inverted assertions |
| 4 | PARTIAL_HEX_RE anchored guard is imported by runtime AND guard-tests (no drift) | ✓ VERIFIED | 14/14 rescrub-persisted tests green; anchored guard confirmed not blanket `/[0-9a-f]{8,}/`; all three *-no-uuid-leak test files import from the single source |
| 5 | Chat chips humanized: CHT-<8> resolves to topic title; run·<8> resolves to agent name or "an agent" | ✓ VERIFIED | Zero `.slice(0,8)` hex renders in topic-strip.tsx and message-thread.tsx (grep returns only a comment); 7/7 chat-chip-humanized tests green |
| 6 | Read-time rescrubPersisted wired on Reader / SR / Bulletin with zero new DB fetches | ✓ VERIFIED | rescrubPersisted called on blockerLine (live-blocker-panel.tsx), focusLine/chain.awaitedPartyLabel (employee-row.tsx), editorialSummary (department-section.tsx); no new ctx.db.query in the changed render paths |
| 7 | LEG-02 Reader activity-actor UUID leak fixed (commit 3f06cc7) | ✓ VERIFIED | `resolveActivityAuthorNames` + `commentToActivity` + `rescrubPersisted` floor in issue-reader.ts confirmed; 7/7 issue-reader-activity-actor-scrub tests green; live drill confirmed actors resolve to role names |
| 8 | `looksDone()` is a deterministic high-precision completion-phrase detector with no AI/LLM token | ✓ VERIFIED | 21/21 looks-done tests green including precision-biased cases, null/empty degrade; blocker-chain.ts determinism + AI-token test (PRIM-03) still 21/21 green |
| 9 | SR-row done-flag batched read is O(1) queries, degrade-wrapped, focusLine untouched | ✓ VERIFIED | 6/6 tldr-bodies-batch tests prove empty→0 queries, non-empty→exactly 1; 6/6 rollup-looks-done tests prove degrade on throw; focusLine assignment unchanged (landmine #10) |
| 10 | LooksDoneAffordance is confirm-gated by construction: no auto-close, UUID dispatch-only | ✓ VERIFIED | 17/17 looks-done-affordance tests green; no `dispatchClose` in effect/mount; UUID prop is never rendered as text (render-scan tests pass) |
| 11 | LEG-01 Tier-1 (host tab deep-link) is verified live on restored BEAAA | ? UNCERTAIN | Probe was deferred because the UI was blank at plan-execution time. UI is now live at v1.7.1. Re-probe required to determine whether `?tab=clarity-reader` / `#tab=clarity-reader` changes the behavior from Tier-2 (accepted, flagged by 18-01 SUMMARY) |

**Score:** 10/11 truths verified (1 deferred to human)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| — | — | — | No later-phase coverage for the two riders below; they are riders, not phase blockers |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/primitives/reader-href.ts` | Single-source buildReaderHref | ✓ VERIFIED | Exists; pure helper; no instance literal; returns Tier-2 fallback `/${companyPrefix}/issues/${identifier}` |
| `scripts/probes/reader-tab-deeplink.mjs` | Live host deep-link probe | ✓ VERIFIED | Exists; verdict line = DEFERRED (not TIER1_HONORED=false); deferred honestly per 18-01 SUMMARY |
| `test/ui/primitives/reader-href.test.mjs` | Unit + render-scan | ✓ VERIFIED | 11/11 pass |
| `src/shared/scrub-human-action.ts` | AGENT_FALLBACK, PARTIAL_HEX_RE, rescrubPersisted, humanizeChatChip | ✓ VERIFIED | All four exports present and correct; zero `agent#${` template literals remain |
| `test/shared/rescrub-persisted.test.mjs` | rescrubPersisted unit + idempotency | ✓ VERIFIED | 14/14 pass |
| `test/ui/surfaces/chat/chat-chip-humanized.test.mjs` | Chat chip humanization | ✓ VERIFIED | 7/7 pass |
| `src/shared/looks-done.ts` | Deterministic completion-phrase detector | ✓ VERIFIED | Exists; precision-biased; no AI token; 21/21 pass |
| `src/worker/db/tldr-cache.ts` (getTldrBodiesByScopeIds added) | Batched = ANY read | ✓ VERIFIED | Function exists; 6/6 batch tests pass |
| `src/ui/surfaces/situation-room/looks-done-affordance.tsx` | Confirm-gated close affordance | ✓ VERIFIED | Exists; 17/17 pass; wired into employee-row.tsx and reader/index.tsx |
| `src/worker/handlers/situation-close-as-done.ts` | closeAsDone worker action | ✓ VERIFIED | Exists; 5/5 tests pass; registered in worker.ts |
| `test/worker/handlers/issue-reader-activity-actor-scrub.test.mjs` | LEG-02 gap fix tests | ✓ VERIFIED | 7/7 pass |
| `package.json` version 1.7.1 | Bumped version (source 1) | ✓ VERIFIED | `"version": "1.7.1"` |
| `src/manifest.ts` version '1.7.1' | Bumped version (source 2) | ✓ VERIFIED | `version: '1.7.1'` — byte-identical |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `reader/live-blocker-panel.tsx:232` | `buildReaderHref` | `nav.navigate(buildReaderHref(companyPrefix, issueId))` | ✓ WIRED | grep confirmed |
| `situation-room/employee-row.tsx:249` | `buildReaderHref` | single openIssue callback | ✓ WIRED | grep confirmed; chat deep-links untouched |
| `situation-room/blocked-backlog-expander.tsx:64` | `buildReaderHref` | `navigate(buildReaderHref(companyPrefix, identifier))` | ✓ WIRED | grep confirmed |
| `bulletin/lineage-footer.tsx:50` | `buildReaderHref` | `navigate(buildReaderHref(companyPrefix, identifier))` | ✓ WIRED | grep confirmed |
| `_shared/reply-in-place.tsx:229` | `buildReaderHref` | `navigate(buildReaderHref(companyPrefix, leafIssueId))` | ✓ WIRED | grep confirmed |
| `scrub-human-action.ts` → `AGENT_FALLBACK` | every fallback site | zero `agent#${` template literals | ✓ WIRED | grep returns empty on source |
| `worker/situation/build-employees-rollup.ts` | `getTldrBodiesByScopeIds` | ONE batched read after per-agent Promise.all | ✓ WIRED | lines 77-79 import confirmed; rollup test green |
| `reader/index.tsx` | `looksDone(data.tldr?.body)` + lifted `needsYou` | onVerdict callback from LiveBlockerPanel | ✓ WIRED | lines 63-64, 434-439 confirmed |
| `situation-room/employee-row.tsx` | `LooksDoneAffordance` | `row.looksDone === true && chain.leafIssueId` guard | ✓ WIRED | lines 48, 485-486 confirmed |
| `issue-reader.ts` | `resolveActivityAuthorNames` + `rescrubPersisted` | `commentToActivity` floor | ✓ WIRED | lines 347-349, 614 confirmed; 7/7 tests green |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `looks-done-affordance.tsx` | `leafIssueUuid` (dispatch-only) | SR rollup `looksDone` flag + `chain.leafIssueUuid` | Dispatch-only, never rendered | ✓ FLOWING (UUID dispatch-only confirmed by render-scan) |
| `build-employees-rollup.ts` | `looksDone` flag | `getTldrBodiesByScopeIds` → `looksDone(body)` | One real `= ANY` query to `tldr_cache` | ✓ FLOWING (6/6 batch tests + rollup tests) |
| `issue-reader.ts` activity actors | `actor` field | `resolveActivityAuthorNames` → `ctx.agents.get` | Real agent name lookup or AGENT_FALLBACK | ✓ FLOWING (7/7 scrub tests including live confirmation) |
| `scrub-human-action.ts` `rescrubPersisted` | persisted strings | regex over in-memory strings only | No new DB fetch (idempotent) | ✓ FLOWING (ZERO new `ctx.db` calls in render paths) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `looksDone` precision-biased: "This task is done." → true; hedged → false | `node --test test/shared/looks-done.test.mjs` | 21/21 pass | ✓ PASS |
| rescrubPersisted cleans `agent#04fcac7c` → "an agent", idempotent | `node --test test/shared/rescrub-persisted.test.mjs` | 14/14 pass | ✓ PASS |
| buildReaderHref returns Tier-2 fallback, no tab carrier, no instance literal | `node --test test/ui/primitives/reader-href.test.mjs` | 11/11 pass | ✓ PASS |
| LooksDoneAffordance: present on done∧needsYou; absent on agreement/missing; no auto-close | `node --test test/ui/surfaces/looks-done-affordance.test.mjs` | 17/17 pass | ✓ PASS |
| Activity actor: UUID → resolved name or AGENT_FALLBACK, never raw UUID | `node --test test/worker/handlers/issue-reader-activity-actor-scrub.test.mjs` | 7/7 pass | ✓ PASS |
| SR rollup: done-flag O(1) batched, degrade-wrapped, focusLine unchanged | `node --test test/worker/situation/build-employees-rollup-looks-done.test.mjs` | 6/6 pass | ✓ PASS |
| Phase-18 aggregate suite | All 11 owned test files | 109/109 pass | ✓ PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes for this phase. The phase declares a live Playwright drill (18-04 Task 4) as the acceptance probe, which was executed manually and recorded in 18-04-SUMMARY.md. The deep-link probe (`scripts/probes/reader-tab-deeplink.mjs`) is a node script deferred per 18-01 SUMMARY.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/probes/reader-tab-deeplink.mjs` | `node scripts/probes/reader-tab-deeplink.mjs` | Verdict = DEFERRED (UI was blank at execution; not TIER1_HONORED=false) | DEFERRED — re-runnable now that UI is live at v1.7.1 |
| Live BEAAA drill (18-04 Task 4, Playwright) | Manual drill via operator tunnel | LEG-01 PASS (Tier-2); LEG-02 PASS (gap fixed in-flight); LEG-03 PARTIAL (absent-case confirmed; present-case deferred — no live fixture) | PASS with riders per 18-04-SUMMARY.md |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LEG-01 | 18-01 | Every Open↗ routes through buildReaderHref to the Clarity Reader | ✓ SATISFIED | 5 sites confirmed; render-scan green; Tier-2 shipped with acceptance-risk flagged; live drill PASS |
| LEG-02 | 18-02, 18-04 (gap fix) | Zero raw/partial agent/UUID identifiers in human-facing text | ✓ SATISFIED | AGENT_FALLBACK wired at all 6 scrub sites; chat chips humanized; read-time rescrub on 3 surfaces; Reader activity-actor gap caught and fixed in 3f06cc7; live drill PASS |
| LEG-03 | 18-03 | "Looks done — close it?" honest-divergence affordance | ✓ SATISFIED (code-proven) | looksDone, getTldrBodiesByScopeIds, LooksDoneAffordance, situation.closeAsDone all implemented and tested; SR rollup wired; Reader wired; 109/109 owned tests pass; live-positive deferred (no live fixture) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/ui/primitives/reader-href.ts` | 49 | Returns Tier-2 fallback (`/${companyPrefix}/issues/${identifier}`) — no tab carrier | ℹ Info | Intentional: Tier-1 probe DEFERRED, not FAILED. Upgrading to Tier-1 is a one-line change once probe settles. Acceptance-risk flagged in 18-01-SUMMARY and 18-04-SUMMARY. |
| `src/worker/situation/build-employees-rollup-looks-done.test.mjs` | — | Degrade path tested but no live BEAAA done⊥blocked fixture | ℹ Info | Intentional: the live-positive rider follows the Phase-17 WAIT-04 pattern. Code is correct; environment has no fixture. |

No `TBD`, `FIXME`, or `XXX` debt markers found in any Phase-18-modified files. No unreferenced stubs. No empty implementations.

### Human Verification Required

#### 1. LEG-01 Tier-1 Re-Probe (Deep-Link Carrier)

**Test:** With the Clarity UI live at v1.7.1, run `node scripts/probes/reader-tab-deeplink.mjs` per its operator walkthrough. It will navigate the BEAAA host to `/<prefix>/issues/BEAAA-972?tab=clarity-reader` and `/<prefix>/issues/BEAAA-972#tab=clarity-reader` and record whether the host lands on the Clarity Reader tab.

**Expected:** Two outcomes are both acceptable:
- TIER1_HONORED=true + winning carrier: add one line to `buildReaderHref` to append the carrier; no surface edit needed.
- TIER1_HONORED=false: Tier-2 remains correct; the LEG-01 SPEC bar ("not the classic tab as the terminal destination") is physically unsatisfiable without a host feature; formally accept the Tier-2 risk as documented in 18-01-SUMMARY.md.

**Why human:** Requires a live BEAAA browser session with a working Reader tab. Not automatable from the codebase.

#### 2. LEG-03 Live-Positive Demo (Affordance on Real Done-But-Blocked Item)

**Test:** Wait for (or seed) a real BEAAA issue where the Editor has compiled a TL;DR containing an explicit completion phrase (e.g. "Feature is complete and delivered") while the deterministic engine still classifies it as needs-you (AWAITING_HUMAN or blocked). Open the Reader for that issue and load the Situation Room.

**Expected:** The "Looks done — close it?" banner appears next to the TL;DR on the Reader, and the SR needs-you row shows the same affordance. Clicking "Keep blocked" leaves the issue open (no mutation). The affordance is absent on all items where the inputs agree or either is missing.

**Why human:** No done-but-blocked item currently exists on BEAAA (confirmed by 18-04 live drill). The present-case is unit-test-proven across 17 tests; this is a live-fixture demo only. Same rider pattern as Phase 17 WAIT-04.

### Gaps Summary

No blocking gaps were found. All three requirements (LEG-01, LEG-02, LEG-03) have substantive, wired, data-flowing implementations verified in the codebase. The two human verification items are riders:
- LEG-01 rider: the Tier-1 deep-link re-probe (now unblocked with the UI live) — outcome is one-line upgrade or formal Tier-2 acceptance, neither of which is a defect.
- LEG-03 rider: live-positive demo (deferred because no done-but-blocked item exists on BEAAA) — consistent with Phase-17 precedent.

The LEG-02 gap (Reader activity-actor UUID leak) was caught during the 18-04 live drill and fixed in commit 3f06cc7 with 7 tests before the phase closed. The fix is verified in code and confirmed live.

---

_Verified: 2026-06-15T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
