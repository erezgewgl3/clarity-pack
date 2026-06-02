---
phase: 11-honest-blocker-taxonomy-engine
verified: 2026-06-02T12:00:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "No raw UUID may reach a rendered human-facing label on ANY surface (NO_UUID_LEAK — D-15 / TAX-03)"
    status: failed
    reason: >
      The Reader's flatten-blocker-chain worker handler returns flattenBlockerChain() raw
      with no scrubHumanAction call. makeResult() sets awaitedPartyLabel = terminal.label
      (blocker-chain.ts:119), where terminal.label embeds raw UUIDs:
      AWAITING_HUMAN → "${meta.ownerUserId} to act on ${current}" (ownerUserId = user UUID,
      current = issue UUID from relations.get .id). AWAITING_AGENT_WORKING/STUCK →
      "${meta.assigneeAgentId} working/stuck on ${current}" (both UUIDs). EXTERNAL →
      "External (${current})" (issue UUID). UNOWNED → "Owner unknown — assign ${current} first"
      (issue UUID). CYCLE → "Cycle: <uuid1> → <uuid2>..." (node-id UUIDs).
      live-blocker-panel.tsx blockerLine() renders t.label directly for AWAITING_HUMAN (line 72),
      SELF_RESOLVING (line 78), EXTERNAL (line 80), CYCLE (line 82), UNOWNED (line 84).
      primaryActionLabel() at line 136 uses data.awaitedPartyLabel (= same raw terminal.label).
      For AWAITING_AGENT_WORKING/STUCK it compounds: `${data.awaitedPartyLabel} is working —
      ${t.label}` (lines 74-76) — both awaitedPartyLabel AND t.label are the same raw UUID-bearing
      string. By contrast, org-blocked-backlog.ts:471 and build-employees-rollup.ts:331 both call
      scrubHumanAction before returning; flatten-blocker-chain.ts does not. The render-scan test
      in employee-row-actions.test.mjs only checks that targetAgentUuid/targetIssueUuid don't appear
      in JSX text nodes — it does NOT check that t.label / awaitedPartyLabel are UUID-free, so the
      test passes while raw UUIDs flow through. The comment on live-blocker-panel.tsx:64-67 asserting
      NO_UUID_LEAK is false for this code path (confirmed by CR-01 in 11-REVIEW.md).
    artifacts:
      - path: "src/worker/handlers/flatten-blocker-chain.ts"
        issue: "Lines 94-100: returns flattenBlockerChain() raw — no scrubHumanAction call anywhere in the file"
      - path: "src/shared/blocker-chain.ts"
        issue: "Line 119: makeResult sets awaitedPartyLabel = terminal.label (raw, unscrubbeed). Labels at lines 236, 246, 260, 265, 215, 225, 281, 185 embed raw ownerUserId / assigneeAgentId / current node-id UUIDs."
      - path: "src/ui/surfaces/reader/live-blocker-panel.tsx"
        issue: "blockerLine() lines 72, 78, 80, 82, 84 render t.label directly. Line 136 renders data.awaitedPartyLabel (= raw t.label) in primaryActionLabel. Lines 74-76 compound both into one string."
    missing:
      - "Call scrubHumanAction in flatten-blocker-chain.ts after flattenBlockerChain() returns, passing a nameByUuid map resolved from ctx.agents/users for ownerUserId, assigneeAgentId, and current (the leaf node id). Mirror org-blocked-backlog.ts:402-444 name-resolution pattern."
      - "In live-blocker-panel.tsx blockerLine(), for AWAITING_HUMAN and all UUID-bearing kinds, render data.awaitedPartyLabel (which will be scrubbed after the above fix) instead of t.label."
      - "Update the falsey comment on live-blocker-panel.tsx:64-67 to accurately reflect the actual scrub location (flatten-blocker-chain.ts handler, not the panel itself)."
      - "Fix the NO_UUID_LEAK render-scan test in employee-row-actions.test.mjs to also verify that t.label / awaitedPartyLabel rendered strings contain no UUID-pattern text, not just that targetAgentUuid/targetIssueUuid field names are absent from JSX expressions."
---

# Phase 11: Honest Blocker Taxonomy Engine Verification Report

**Phase Goal:** Replace the binary owned-vs-unowned classification with a deterministic, agent-aware terminal taxonomy that is the single source of truth every surface reads from.
**Verified:** 2026-06-02
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each blocked item is classified into exactly one honest terminal kind (awaiting-human / agent-working / agent-stuck / self-resolving / external / cycle / genuinely-unowned) using agent ownership (assigneeAgentId) + heartbeat liveness, not just user ownership | ✓ VERIFIED | `src/shared/types.ts`: 8-kind Terminal union confirmed. `src/shared/blocker-chain.ts`: D-07 cascade at lines 232-284 covers all 8 kinds including agent-ownership (assigneeAgentId) + liveness (agentState). `resolveAgentState` in `agent-liveness.ts` injects working/stuck from heartbeat. Both BFS builders (org-blocked-backlog.ts + flatten-blocker-chain.ts) populate assigneeAgentId + agentState in nodeMeta. Engine test: 15/15 pass including per-kind cases. |
| 2 | A chain waiting on another agent flattens transitively to the human-actionable end; no mid-chain "poke the agent" terminal is ever surfaced | ✓ VERIFIED | `flattenBlockerChain` DFS walk (blocker-chain.ts lines 164-291) continues walking through intermediate nodes. Agent-owned nodes are only terminal when they are the LEAF (no continuing outgoing edges). The awaiting-first cascade (D-07) at a leaf places AWAITING_HUMAN above AWAITING_AGENT_*, so a user-awaited leaf pre-empts the agent. The engine test exercises single-agent-leaf classification; the walk's pass-through for non-leaf agent nodes is the unmodified PRIM-03 DFS behavior carried from Phase 2. |
| 3 | A row whose chain cannot be built or classified shows an honest deterministic fallback line, never a false "assign owner" | ✓ VERIFIED | `flatten-blocker-chain.ts`: walk failure → `degraded()` at lines 72-73, 82-83 (UNCLASSIFIED, `actionAffordance: 'open'`, `needsYou: false`). `org-blocked-backlog.ts`: thrown edge → UNCLASSIFIED row. `build-employees-rollup.ts` lines 403-435: thrown chain → UNCLASSIFIED row. `classifyVerdict('UNCLASSIFIED')` returns `{ tier: 'watch', actionAffordance: 'open', needsYou: false }` (no assign). `live-blocker-panel.tsx` UNCLASSIFIED branch (line 85-88): renders "Can't determine blocker — open to investigate". Reader-view test passes 26/26 including the UNCLASSIFIED+no-assign case. |
| 4 | blocker-chain.ts stays pure and deterministic — determinism test + AI-token grep guard pass | ✓ VERIFIED | `grep -iE '\\b(openai\|anthropic\|claude_local\|llm\|gpt\|completion)\\b' src/shared/blocker-chain.ts` → 0 matches. No `Date.now()` or `new Date()` in the file. `node --test test/shared/blocker-chain.test.mjs` → 15/15 pass including "Determinism — same input produces same output bytes across 100 invocations" and "PRIM-03 deterministic-graph-only" AI-token guard. |
| 5 | Every surface (Situation Room, org-blocked backlog banner, Reader blocker panel) renders straight from the engine verdict; no view-layer ownership re-derivation; string-matches on ownerName==='Unassigned'/kind==='HUMAN_ACTION_ON' eliminated | ✗ FAILED | Situation Room and org-blocked backlog: VERIFIED (employee-row.tsx uses showAssign = actionAffordance==='assign'; needs-you-banner.tsx uses actionAffordance==='assign' partition; no UNASSIGNED/HUMAN_ACTION_ON string-matches in src/). Reader panel: PARTIALLY FAILED. The panel reads from the engine verdict (actionAffordance, needsYou, terminal.kind) — no string-match re-derivation. BUT it renders t.label / awaitedPartyLabel which carry raw UUIDs because flatten-blocker-chain.ts does not call scrubHumanAction. The SC5 "no view-layer re-derivation" is met (affordance gates work), but the NO_UUID_LEAK sub-contract of SC5/D-15 is violated: the Reader panel renders UUID-bearing labels for AWAITING_HUMAN, AWAITING_AGENT_WORKING/STUCK, EXTERNAL, CYCLE, UNOWNED. |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/shared/types.ts` | 8-variant Terminal union + enriched BlockerChainResult | ✓ VERIFIED | 8 kinds confirmed; BlockerChainResult has needsYou/tier/actionAffordance/awaitedPartyLabel/targetAgentUuid/targetIssueUuid. No HUMAN_ACTION_ON in live logic. |
| `src/shared/blocker-chain.ts` | D-07 awaiting-first cascade + exported classifyVerdict() | ✓ VERIFIED | `export function classifyVerdict` confirmed at line 60; cascade at lines 229-284 follows D-07 order; `__unowned__` absent (0 grep hits). |
| `src/shared/scrub-human-action.ts` | NO_UUID_LEAK scrub for all 8 kinds; sentinel removed | ✓ VERIFIED | `UNOWNED_SENTINEL` and `__unowned__` absent (0 grep hits). Handles all 8 kinds including UNOWNED, UNCLASSIFIED, AWAITING_AGENT_*. |
| `test/shared/blocker-chain.test.mjs` | Per-kind cases + classifyVerdict table + determinism + grep guard | ✓ VERIFIED | 15/15 pass; cases for AWAITING_AGENT_WORKING, AWAITING_AGENT_STUCK, UNOWNED, UNCLASSIFIED, classifyVerdict-table, determinism, AI-token guard all confirmed passing. |
| `src/worker/situation/agent-liveness.ts` | Pure resolveAgentState() — single liveness source | ✓ VERIFIED | File exists; pure (no SDK/IO/clock read — nowMs injected); imported by both flatten-blocker-chain.ts and org-blocked-backlog.ts. |
| `src/worker/handlers/flatten-blocker-chain.ts` | BFS builder with nodeMeta {assigneeAgentId, agentState}; UNCLASSIFIED degrade | ✓ VERIFIED (INCOMPLETE) | nodeMeta field-set mirrors buildEdges (SC5). UNCLASSIFIED degrade on walk failure confirmed. BUT: scrubHumanAction is absent — raw UUIDs flow through to the Reader panel (CR-01). |
| `src/worker/handlers/org-blocked-backlog.ts` | scrubHumanAction called at line 471 | ✓ VERIFIED | `scrubHumanAction(terminal, viewerUserId, nameByUuid)` call confirmed at line 471. 6 import/call references. |
| `src/worker/situation/build-employees-rollup.ts` | scrubHumanAction called at line 331; verdict-driven needs-you | ✓ VERIFIED | `scrubHumanAction` call confirmed at line 331. `awaitedPartyLabel: humanAction` (the scrubbed value) at line 391. needsYou/tier/actionAffordance from classifyVerdict verdict. |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | All 8 kinds render; actionAffordance gates; NO_UUID_LEAK | ✗ STUB (partial) | All 8 kinds render via blockerLine() exhaustive switch — no blank lines. actionAffordance gates confirmed (primaryActionLabel uses the affordance, not kind). NO_UUID_LEAK VIOLATED: blockerLine() renders t.label raw for 5 of 8 kinds; awaitedPartyLabel (= raw t.label) used in button label. |
| `src/ui/surfaces/situation-room/employee-row.tsx` | showAssign gated on actionAffordance; UNASSIGNED removed | ✓ VERIFIED | `showAssign = chain?.actionAffordance === 'assign'` confirmed at line 159. 0 hits for `ownerName === 'Unassigned'` or `UNASSIGNED` constant. `actionAffordance` referenced 3 times. |
| `src/ui/surfaces/situation-room/needs-you-banner.tsx` | actionAffordance==='assign' partition; UNASSIGNED removed | ✓ VERIFIED | Lines 71-79: partition uses `actionAffordance === 'assign'`. 0 hits for UNASSIGNED sentinel. `actionAffordance` referenced 12 times. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `flatten-blocker-chain.ts` | `scrubHumanAction` | import + call before return | ✗ NOT_WIRED | The file imports `resolveAgentState` from agent-liveness.ts but has zero `scrubHumanAction` references. Returns `flattenBlockerChain()` result raw. |
| `flatten-blocker-chain.ts` | `flattenBlockerChain` | call at line 94 | ✓ WIRED | Called at line 94 with startId/edges/nodeMeta/viewerUserId/maxAgeMs. |
| `live-blocker-panel.tsx` | engine verdict fields | reads actionAffordance/needsYou/tier | ✓ WIRED | Reads `data.actionAffordance`, `data.needsYou`, `data.awaitedPartyLabel`, `terminal.kind`. No string-match re-derivation. |
| `live-blocker-panel.tsx` | scrubbed labels | renders awaitedPartyLabel (supposed to be scrubbed) | ✗ BROKEN | awaitedPartyLabel = raw terminal.label (set in makeResult:119). Panel renders this unscrubbed. |
| `org-blocked-backlog.ts` | `scrubHumanAction` | call at line 471 | ✓ WIRED | Called with (terminal, viewerUserId, nameByUuid). |
| `build-employees-rollup.ts` | `scrubHumanAction` | call at line 331 | ✓ WIRED | `awaitedPartyLabel: humanAction` (the scrubbed string) at line 391. |
| `classifyVerdict` | all surfaces | imported + called in handlers and blocker-chain.ts | ✓ WIRED | Used in flatten-blocker-chain.ts, org-blocked-backlog.ts, build-employees-rollup.ts, and blocker-chain.ts itself. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `live-blocker-panel.tsx` | `data` (BlockerChainResult) | `usePluginData('flatten-blocker-chain', ...)` | Yes — real BFS walk via `ctx.issues.relations.get` | ✓ FLOWING (data source genuine) |
| `live-blocker-panel.tsx` | `data.awaitedPartyLabel` | `makeResult():119` → `terminal.label` | Raw UUID-bearing label from BFS walk | ✗ HOLLOW_PROP — the label is genuine but contains raw UUIDs that should be scrubbed before rendering; scrub is present in other surfaces but missing here |
| `live-blocker-panel.tsx` | `t.label` (rendered in blockerLine) | same BFS walk | Raw UUID-bearing label | ✗ HOLLOW_PROP — same root cause as awaitedPartyLabel |

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without a live Paperclip server). The Reader panel requires a browser/host context.

### Probe Execution

Step 7c: No phase-declared probes found in PLAN files. No conventional `scripts/*/tests/probe-*.sh` pattern relevant to this phase (Phase 11 is pure engine/UI code changes, not a migration or CLI phase).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| TAX-01 | 11-01, 11-02, 11-03, 11-04 | Engine classifies into honest terminal kinds using agent ownership + heartbeat liveness | ✓ SATISFIED | 8-kind Terminal union; D-07 cascade; resolveAgentState; both BFS builders populate assigneeAgentId/agentState; classifyVerdict maps all 8 kinds. Engine test 15/15. |
| TAX-02 | 11-01, 11-02 | Chain waiting on another agent flattens transitively to the human-actionable end | ✓ SATISFIED | DFS walk continues through non-leaf nodes regardless of agent ownership; AWAITING_AGENT_* only fires at a leaf. |
| TAX-03 | 11-01, 11-02, 11-03, 11-04 | Degrade-safe — honest fallback, never false "assign owner" | ✓ PARTIALLY SATISFIED | Walk failures correctly produce UNCLASSIFIED (open affordance, no assign) across all three worker surfaces. UNCLASSIFIED vs UNOWNED distinction (D-09) correct. BUT: the NO_UUID_LEAK component of TAX-03 (an honest fallback must not expose raw UUIDs in the fallback line) fails for the Reader path: the UNCLASSIFIED degrade label itself is "Relations unavailable" (UUID-safe), but the success path's terminal labels embed raw UUIDs without scrubbing. The TAX-03 spec says "honest fallback, never a false assign" — the assign gate is correct. The NO_UUID_LEAK breach is a co-violation (D-15/CR-01). |

**Orphaned requirements check:** REQUIREMENTS.md maps TAX-01, TAX-02, TAX-03 to Phase 11 only. All three are claimed by Plan files in this phase. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/worker/handlers/flatten-blocker-chain.ts` | 94-100 | `scrubHumanAction` absent — raw UUID labels flow to Reader | Blocker | NO_UUID_LEAK invariant breach; user-visible raw UUIDs in labels for AWAITING_HUMAN, AWAITING_AGENT_*, EXTERNAL, UNOWNED, CYCLE kinds |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | 72, 74-76, 78, 80, 82, 84, 136 | `t.label` and `data.awaitedPartyLabel` rendered raw (UUID-bearing) | Blocker | DOM receives raw user/agent/issue UUIDs as visible text |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | 64-67 | Comment falsely asserts `awaitedPartyLabel` / `terminal.label` are "scrubbed display strings — never a raw UUID (NO_UUID_LEAK)" | Warning | Misleading invariant comment; discourages reviewers from re-checking. Becomes accurate only after CR-01 is fixed. |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | 156 | `<button className="clarity-blocker-action">{actionLabel}</button>` with no `onClick`, no `type="button"` | Warning | Dead button for all affordances (reply/nudge/assign/open); R4 "no dead buttons" regression on Reader surface. For a blocker-free issue (noBlockers() → EXTERNAL → actionAffordance='open'), renders a dead "Open ↗" button. |
| `src/worker/situation/agent-liveness.ts` | 57 | `const staleWindowMs = 2 * (expectedCadenceMs ?? RUNNING_WINDOW_MS)` | Warning | When host provides `expectedCadenceMs === 0`, `0 ?? RUNNING_WINDOW_MS` = `0` (nullish coalescing passes `0` through), yielding `staleWindowMs = 0`. Every agent with any heartbeat is permanently classified `stuck`, flooding the board with false nudge rows. |
| `src/worker/handlers/org-blocked-backlog.ts` | 12, 110, 310, 378 | Comments reference `HUMAN_ACTION_ON` (old kind name) | Info | Stale comments only; no live logic uses the old name. No functional impact. |

### Human Verification Required

None identified. All observable behaviors can be verified via code/grep analysis. The live-drill reminder in 11-04-SUMMARY.md (confirm `assigneeAgentId` rides on a real BEAAA `relations.get` at runtime) is a deployment concern, not a verification gap — the code is correct and conservative (D-04 sticks → stuck when signal absent).

### Gaps Summary

**One BLOCKER gap prevents phase goal achievement:**

**CR-01 (NO_UUID_LEAK breach — Reader panel):** The `flatten-blocker-chain` worker handler is the sole chain producer that does not call `scrubHumanAction` before returning. The result's `awaitedPartyLabel` equals `terminal.label` verbatim (set in `makeResult` at `blocker-chain.ts:119`). Engine labels embed raw UUIDs at the construction sites: `ownerUserId` (user UUID), `assigneeAgentId` (agent UUID), and `current` (the graph node id, which at runtime is the Paperclip issue UUID from `relations.get .id`, per `paperclip-issue-url-pattern` project memory). `live-blocker-panel.tsx`'s `blockerLine()` renders `t.label` directly for 5 of 8 kinds, and `primaryActionLabel()` interpolates `data.awaitedPartyLabel` into button text. The render-scan test (employee-row-actions.test.mjs) passes because it only checks `targetAgentUuid`/`targetIssueUuid` field names — it does not detect UUID pattern strings inside `t.label` or `awaitedPartyLabel`. The comment at `live-blocker-panel.tsx:64-67` asserting the NO_UUID_LEAK invariant is factually incorrect for this code path.

The other surfaces (Situation Room, org-blocked backlog) are correct: `org-blocked-backlog.ts:471` and `build-employees-rollup.ts:331` both call `scrubHumanAction` and set `awaitedPartyLabel` to the scrubbed output.

**Three warnings (non-blocking for replan, but should be logged):**

- **WR-01/WR-02:** A blocker-free issue renders a dead "Open ↗" button (no `onClick`, no `type="button"`). Root: `noBlockers()` returns EXTERNAL terminal → `classifyVerdict` yields `actionAffordance: 'open'` → `primaryActionLabel` returns `'Open ↗'` → panel renders it with no handler.
- **WR-03:** `resolveAgentState` with `expectedCadenceMs === 0` yields `staleWindowMs = 0`, classifying every agent with any heartbeat as `stuck`. The `??` nullish coalescing passes `0` through (it substitutes only null/undefined).

**Root cause grouping:** CR-01 and the comment defect share one root: the `flatten-blocker-chain.ts` handler was not updated to mirror the scrub step that both other handlers already perform. The fix is localized to that one file (+ the panel comment update). WR-01/02 and WR-03 are independent issues.

---

_Verified: 2026-06-02_
_Verifier: Claude (gsd-verifier)_
