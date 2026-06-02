---
phase: 11-honest-blocker-taxonomy-engine
verified: 2026-06-02T18:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "No raw UUID reaches any rendered human-facing label on the Reader surface (CR-01 / NO_UUID_LEAK / D-15 / SC5)"
  gaps_remaining: []
  regressions: []
---

# Phase 11: Honest Blocker Taxonomy Engine Verification Report

**Phase Goal:** Replace the binary owned-vs-unowned classification with a deterministic, agent-aware terminal taxonomy that is the single source of truth every surface reads from.
**Verified:** 2026-06-02
**Status:** passed
**Re-verification:** Yes — after gap closure (Plans 11-05, 11-06, 11-07)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each blocked item is classified into exactly one honest terminal kind (awaiting-human / agent-working / agent-stuck / self-resolving / external / cycle / genuinely-unowned) using agent ownership (assigneeAgentId) + heartbeat liveness, not just user ownership | ✓ VERIFIED | `src/shared/types.ts`: 8-kind Terminal union confirmed. `src/shared/blocker-chain.ts`: D-07 cascade covers all 8 kinds including `assigneeAgentId` + liveness (`agentState`). `resolveAgentState` in `agent-liveness.ts` injects working/stuck from heartbeat. Both BFS builders populate assigneeAgentId + agentState in nodeMeta. Engine test: 21/21 pass including per-kind cases. |
| 2 | A chain waiting on another agent flattens transitively to the human-actionable end; no mid-chain "poke the agent" terminal is ever surfaced | ✓ VERIFIED | `flattenBlockerChain` DFS walk continues through intermediate nodes; agent-owned nodes are only terminal when they are the LEAF. The D-07 cascade at a leaf places AWAITING_HUMAN above AWAITING_AGENT_*, so a user-awaited leaf pre-empts the agent. |
| 3 | A row whose chain cannot be built or classified shows an honest deterministic fallback line, never a false "assign owner" | ✓ VERIFIED | `flatten-blocker-chain.ts`: walk failure → `makeDegradedResult()` (UNCLASSIFIED, `actionAffordance: 'open'`, `needsYou: false`). `classifyVerdict('UNCLASSIFIED')` returns `{ tier: 'watch', actionAffordance: 'open', needsYou: false }` (no assign). `live-blocker-panel.tsx` UNCLASSIFIED branch: renders "Can't determine blocker — open to investigate". Reader-view test passes 26/26 including the UNCLASSIFIED+no-assign case. |
| 4 | blocker-chain.ts stays pure and deterministic — determinism test + AI-token grep guard pass | ✓ VERIFIED | `grep -iE '(openai\|anthropic\|claude_local\|llm\|gpt\|completion)' src/shared/blocker-chain.ts` → 0 matches. No `Date.now()` or `new Date()` in the file. `node --test test/shared/blocker-chain.test.mjs` → 21/21 pass including "Determinism — same input produces same output bytes across 100 invocations" and the "PRIM-03 deterministic-graph-only" AI-token guard. |
| 5 | Every surface (Situation Room, org-blocked backlog banner, Reader blocker panel) renders straight from the engine verdict; no view-layer ownership re-derivation; no raw UUID reaches any rendered human-facing label (NO_UUID_LEAK / D-15 / SC5) | ✓ VERIFIED | **Situation Room + backlog: unchanged VERIFIED.** `employee-row.tsx`: `showAssign = actionAffordance==='assign'`; 0 UNASSIGNED/HUMAN_ACTION_ON hits. `needs-you-banner.tsx`: `actionAffordance==='assign'` partition. `build-employees-rollup.ts:391`: `awaitedPartyLabel: humanAction` (scrubbed). **Reader panel: now VERIFIED (CR-01 closed).** `flatten-blocker-chain.ts:218`: `return { ...result, awaitedPartyLabel: scrubHumanAction(terminal, viewerUserId, nameByUuid) }` — the success-path scrub, mirroring org-blocked-backlog.ts:402-471. `live-blocker-panel.tsx` `blockerLine()`: all 8 kinds render `data.awaitedPartyLabel` (the scrubbed string) — no `t.label` in any rendered expression (grep returns 0 hits). All three blocker surfaces render only scrubbed labels. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/shared/types.ts` | 8-variant Terminal union + enriched BlockerChainResult | ✓ VERIFIED | 8 kinds confirmed; BlockerChainResult has needsYou/tier/actionAffordance/awaitedPartyLabel/targetAgentUuid/targetIssueUuid. |
| `src/shared/blocker-chain.ts` | D-07 awaiting-first cascade + exported classifyVerdict() + makeDegradedResult + makeBlockerFreeResult | ✓ VERIFIED | `export function classifyVerdict` confirmed; `export function makeDegradedResult` at line 138; `export function makeBlockerFreeResult` at line 175 (forces actionAffordance 'none' for blocker-free case, WR-01). Both EXTERNAL branches name `current` (WR-05). |
| `src/shared/scrub-human-action.ts` | NO_UUID_LEAK scrub for all 8 kinds; step comments renumbered 1-5 | ✓ VERIFIED | `UNOWNED_SENTINEL` and `__unowned__` absent. Handles all 8 kinds. Step comments contiguous 1-5 (IN-02 closed). |
| `test/shared/blocker-chain.test.mjs` | Per-kind cases + classifyVerdict table + determinism + grep guard | ✓ VERIFIED | 21/21 pass; new WR-01/WR-05/IN-04 fixtures all green. |
| `src/worker/situation/agent-liveness.ts` | Pure resolveAgentState() — positive-value cadence guard (> 0); return type 'working' \| 'stuck' (no dead null) | ✓ VERIFIED | `expectedCadenceMs > 0` guard present (line 68). Return type narrowed to `'working' \| 'stuck'` (WR-04 closed). 11/11 tests pass including cadence-zero fixture. |
| `src/worker/handlers/flatten-blocker-chain.ts` | scrubResultLabel exported; scrubHumanAction called on success path; makeDegradedResult + makeBlockerFreeResult adopted; WR-03 call-site guard | ✓ VERIFIED | `scrubHumanAction(terminal, viewerUserId, nameByUuid)` at line 218. `scrubResultLabel` exported (lines 170-219). `buildHandlerResult` routes degrade → `makeDegradedResult`, blocker-free → `makeBlockerFreeResult`. `expectedCadenceMs > 0` at line 333 (WR-03). `agents.get` loop (nameByUuid) at lines 196-215. |
| `src/worker/handlers/org-blocked-backlog.ts` | scrubHumanAction called; RelationNodeProjection exported; WR-03 call-site guard | ✓ VERIFIED | `scrubHumanAction` call confirmed. `export type RelationNodeProjection` declared. `expectedCadenceMs > 0` guard present (WR-03). |
| `src/worker/situation/build-employees-rollup.ts` | scrubHumanAction called; rowTargetsViewer single-source predicate (WR-06) | ✓ VERIFIED | `scrubHumanAction` at line 331. `export function rowTargetsViewer` at line 59; used at line 423 — standalone `terminal.userId` re-derivation eliminated (SC5 single-source). `awaitedPartyLabel: humanAction` (scrubbed) at line 391. |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | blockerLine() renders data.awaitedPartyLabel for all UUID-bearing kinds; no t.label in rendered strings; button wired or omitted + type="button"; IN-01 comment corrected | ✓ VERIFIED | `Select-String -Pattern 't\.label'` → 0 matches in blockerLine(). `awaitedPartyLabel` referenced 14 times. `type="button"` at line 264. `onClick={onAction}` wired; `showButton = actionLabel !== null && onAction !== null` (WR-02). Comment at lines 48-51 correctly references `flatten-blocker-chain.ts` as the scrub site (IN-01). |
| `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` | NO_UUID_LEAK fixture: success-path returns UUID-free awaitedPartyLabel across all kinds | ✓ VERIFIED | 8/8 pass including AWAITING_HUMAN, AWAITING_AGENT_STUCK, EXTERNAL, CYCLE, UNOWNED success-path scrub, viewer-You substitution, agents.get-throws degrade, absent-ctx degrade, WR-01 blocker-free 'none'. |
| `test/worker/situation/build-employees-rollup-viewer-single-source.test.mjs` | WR-06 agreement test: __targetsViewer and needs-you count agree | ✓ VERIFIED | 4/4 pass: rowTargetsViewer unit truth-table, viewer-owned-counts agreement, UNOWNED-via-assign partition, non-viewer → 0. |
| `test/ui/surfaces/situation-room/employee-row-actions.test.mjs` | UUID-pattern render-scan: source-scan asserts blockerLine reads awaitedPartyLabel NOT t.label; behavioral guard asserts scrubHumanAction yields UUID-free output | ✓ VERIFIED | 19/19 pass. "CR-01 source-scan" test: `assert.match(body, /data\.awaitedPartyLabel/)` + `assert.doesNotMatch(body, /\bt\.label\b/)`. "CR-01 behavioral guard" test: imports real `scrubHumanAction`, asserts all 8 UUID-bearing-kind fixtures scrub to UUID-free output. UUID_RE constant `[0-9a-f]{8}-...` present at line 24. |
| `src/ui/surfaces/situation-room/employee-row.tsx` | showAssign gated on actionAffordance; UNASSIGNED removed | ✓ VERIFIED | `showAssign = chain?.actionAffordance === 'assign'` confirmed. 0 hits for `ownerName === 'Unassigned'` or `UNASSIGNED` constant. |
| `src/ui/surfaces/situation-room/needs-you-banner.tsx` | actionAffordance==='assign' partition; UNASSIGNED removed | ✓ VERIFIED | Partition uses `actionAffordance === 'assign'`. 0 hits for UNASSIGNED sentinel. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `flatten-blocker-chain.ts` | `scrubHumanAction` | `scrubResultLabel` on success path (line 218) | ✓ WIRED | `scrubHumanAction(terminal, viewerUserId, nameByUuid)` called. 4 references in file. `nameByUuid` built from `ctx.agents.get` loop. |
| `flatten-blocker-chain.ts` | `ctx.agents.get` | nameByUuid resolution for ownerUserId/assigneeAgentId/leaf | ✓ WIRED | `agents.get` loop at lines 196-215 (7 references in file). `try/catch → null` degrade, NEVER the raw UUID. |
| `flatten-blocker-chain.ts` | `makeBlockerFreeResult` | `buildHandlerResult` when `walk.edges.length === 0` | ✓ WIRED | Line 251: `return makeBlockerFreeResult(startId, 'No active blockers')` — actionAffordance 'none' (WR-01). |
| `live-blocker-panel.tsx` | `data.awaitedPartyLabel` (scrubbed) | `blockerLine()` — all UUID-bearing kinds | ✓ WIRED | All 8 cases render `data.awaitedPartyLabel`. No `t.label` in any returned string. |
| `live-blocker-panel.tsx` | `onAction` (wired dispatch) | `openIssue` / `replyInChat` / `nudge` per affordance | ✓ WIRED | `open` → `nav.navigate(/${companyPrefix}/issues/${issueId})`; `reply` → `buildChatDeepLink + navigate`; `nudge` → `issues.requestWakeup`. `assign`/'none' → `null` (no button). |
| `build-employees-rollup.ts` | `rowTargetsViewer` | single predicate replaces two independent viewer-targeting computations | ✓ WIRED | `rowTargetsViewer(terminal, viewerUserId)` at line 423 (WR-06 / SC5). |
| `org-blocked-backlog.ts` | `RelationNodeProjection` | exported type, imported by flatten-blocker-chain.ts (IN-03) | ✓ WIRED | Declared once in org-blocked-backlog.ts; imported at line 46 of flatten-blocker-chain.ts. |
| `classifyVerdict` | all surfaces | imported + called in handlers and blocker-chain.ts | ✓ WIRED | Used in flatten-blocker-chain.ts, org-blocked-backlog.ts, build-employees-rollup.ts, and blocker-chain.ts itself. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `live-blocker-panel.tsx` | `data` (BlockerChainResult) | `usePluginData('flatten-blocker-chain', ...)` | Yes — real BFS walk via `ctx.issues.relations.get` | ✓ FLOWING |
| `live-blocker-panel.tsx` | `data.awaitedPartyLabel` | `scrubResultLabel(ctx, companyId, viewerUserId, result)` in the worker handler | Scrubbed string — UUID-free by construction (nameByUuid from ctx.agents, then scrubHumanAction) | ✓ FLOWING (scrubbed) |
| `live-blocker-panel.tsx` | `blockerLine(data)` | all 8 switch branches render `data.awaitedPartyLabel` | Scrubbed display string — no t.label leaks | ✓ FLOWING (NO_UUID_LEAK closed) |

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without a live Paperclip server). The Reader panel requires a browser/host context.

### Probe Execution

Step 7c: No phase-declared probes. No conventional `scripts/*/tests/probe-*.sh` applicable (pure engine/UI change phase).

### Test Suite Results

| Suite | Command | Result | Status |
|-------|---------|--------|--------|
| Engine tests | `node --test test/shared/blocker-chain.test.mjs` | 21/21 pass | ✓ PASS |
| Scrub tests | `node --test test/shared/scrub-human-action.test.mjs` | 7/7 pass | ✓ PASS |
| Liveness tests | `node --test test/worker/situation/agent-liveness.test.mjs` | 11/11 pass | ✓ PASS |
| Scrub handler tests | `node --test test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` | 8/8 pass | ✓ PASS |
| Viewer single-source tests | `node --test test/worker/situation/build-employees-rollup-viewer-single-source.test.mjs` | 4/4 pass | ✓ PASS |
| NO_UUID_LEAK render-scan | `node --test test/ui/surfaces/situation-room/employee-row-actions.test.mjs` | 19/19 pass | ✓ PASS |
| Full suite | `node --test test/worker/**/*.test.mjs test/shared/**/*.test.mjs test/ui/**/*.test.mjs` | 2160/2161 pass, 1 skip, 0 fail | ✓ PASS |
| TypeScript | `npx tsc --noEmit` | 0 errors | ✓ PASS |

The single skip is the pre-existing `chat-messages.test.mjs` "U7 WATCHDOG-FIRE-AND-FORGET" timing-flaky test, already logged in `deferred-items.md` and confirmed passing in isolation (32/32). It touches no file in Phase 11.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| TAX-01 | 11-01, 11-02, 11-03, 11-04 | Engine classifies into honest terminal kinds using agent ownership + heartbeat liveness | ✓ SATISFIED | 8-kind Terminal union; D-07 cascade; resolveAgentState with positive-cadence guard (WR-03/WR-04 closed); both BFS builders populate assigneeAgentId/agentState with shared RelationNodeProjection (IN-03); classifyVerdict maps all 8 kinds. Engine test 21/21. |
| TAX-02 | 11-01, 11-02 | Chain waiting on another agent flattens transitively to the human-actionable end | ✓ SATISFIED | DFS walk continues through non-leaf nodes; AWAITING_AGENT_* only fires at a leaf. Confirmed by engine test fixture. |
| TAX-03 | 11-01, 11-02, 11-03, 11-04 | Degrade-safe — honest fallback, never false "assign owner"; NO_UUID_LEAK sub-contract | ✓ SATISFIED | Walk failures → UNCLASSIFIED (open affordance, no assign) across all three worker surfaces. NO_UUID_LEAK: all three surfaces now call scrubHumanAction before return (org-blocked-backlog, build-employees-rollup confirmed from prior; flatten-blocker-chain now VERIFIED by line 218). Reader panel renders only data.awaitedPartyLabel (scrubbed), never t.label. WR-02: no dead button (type="button" + real onClick or omitted). WR-01: blocker-free → actionAffordance 'none' → no button. |

**Orphaned requirements check:** REQUIREMENTS.md maps TAX-01, TAX-02, TAX-03 to Phase 11 only. All three claimed by Plan files. No orphaned requirements.

### Anti-Patterns Found

All prior BLOCKER anti-patterns are now resolved. No new anti-patterns introduced.

| File | Line | Pattern | Severity | Notes |
|------|------|---------|----------|-------|
| _(none remaining)_ | — | — | — | CR-01 closed; WR-01/02/03/04/05/06 closed; IN-01/02/03/04 closed. |

Prior warnings from 11-REVIEW.md that are confirmed closed:
- **CR-01** (BLOCKER): `flatten-blocker-chain.ts` now calls `scrubResultLabel` → `scrubHumanAction` on success path. `live-blocker-panel.tsx` renders `data.awaitedPartyLabel`, never `t.label`. **CLOSED.**
- **WR-01**: `makeBlockerFreeResult` forces actionAffordance 'none' for blocker-free case. **CLOSED.**
- **WR-02**: Button renders only with real `onClick` + `type="button"`, else omitted. **CLOSED.**
- **WR-03**: `resolveAgentState` helper + both call sites guard `expectedCadenceMs > 0`. **CLOSED.**
- **WR-04**: `resolveAgentState` return type narrowed to `'working' | 'stuck'`. **CLOSED.**
- **WR-05**: Both EXTERNAL branches name `current` (the leaf); both agree with `targetIssueUuid`. **CLOSED.**
- **WR-06**: `rowTargetsViewer` single-source predicate eliminates two independent viewer-targeting computations. **CLOSED.**
- **IN-01**: Panel comment at lines 48-51 correctly names `flatten-blocker-chain.ts` as the scrub site. **CLOSED.**
- **IN-02**: Step comments in `scrub-human-action.ts` renumbered 1-5 (no skipped Step 3). **CLOSED.**
- **IN-03**: `RelationNodeProjection` type declared once in `org-blocked-backlog.ts`, imported by `flatten-blocker-chain.ts`. **CLOSED.**
- **IN-04**: Hand-built `degraded()` and `noBlockers()` row constructors replaced by `makeDegradedResult` / `makeBlockerFreeResult`. **CLOSED.**

### Human Verification Required

None. All observable behaviors verified via code/grep analysis and the test suite.

### Gaps Summary

No gaps. All 5/5 must-have truths are VERIFIED. All CR-01, WR-01..WR-06, and IN-01..IN-04 findings from 11-REVIEW.md are closed. The full test suite (2160 pass, 0 fail) and `tsc --noEmit` (0 errors) confirm no regressions.

---

_Verified: 2026-06-02_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — initial verification found CR-01 gap; Plans 11-05/11-06/11-07 closed all gaps_
