---
phase: 11-honest-blocker-taxonomy-engine
plan: 01
subsystem: shared-engine
tags: [blocker-chain, taxonomy, verdict, purity, NO_UUID_LEAK]
requires:
  - "src/shared/types.ts Terminal union (4-variant, pre-11-01)"
  - "src/shared/blocker-chain.ts flattenBlockerChain DFS walk"
  - "src/shared/scrub-human-action.ts 4-step UUID scrub"
provides:
  - "8-variant honest Terminal union (AWAITING_HUMAN/AWAITING_AGENT_WORKING/AWAITING_AGENT_STUCK/SELF_RESOLVING/EXTERNAL/CYCLE/UNOWNED/UNCLASSIFIED)"
  - "enriched BlockerChainResult verdict {needsYou, tier, actionAffordance, degradeReason?, awaitedPartyLabel, targetAgentUuid?, targetIssueUuid?}"
  - "exported pure classifyVerdict(terminal): {tier, actionAffordance, needsYou}"
  - "D-07 awaiting-first leaf cascade with agent-ownership/liveness branches"
  - "NO_UUID_LEAK scrub for all 8 kinds; __unowned__ sentinel removed repo-wide in src/shared/"
affects:
  - "src/worker/jobs/humanize-snapshot.ts (now fails tsc — migration checklist for 11-02/03/04)"
  - "src/worker/handlers/org-blocked-backlog.ts (fails tsc — agent-ownership injection + verdict re-triage pending)"
  - "src/worker/handlers/flatten-blocker-chain.ts (fails tsc — EXTERNAL-lie fix + result enrichment pending)"
  - "src/ui/surfaces/reader/live-blocker-panel.tsx (fails tsc — kind string-match migration pending)"
tech-stack:
  added: []
  patterns:
    - "exhaustive switch + const _exhaustive: never (total-function-over-the-union, D-14)"
    - "split identity: human-readable label rendered, *Uuid carried mutation-only (NO_UUID_LEAK, D-15)"
    - "caller-injects-the-impure-bits: agentState pre-resolved string, engine reads no clock (D-01)"
key-files:
  created: []
  modified:
    - src/shared/types.ts
    - src/shared/blocker-chain.ts
    - src/shared/scrub-human-action.ts
    - test/shared/blocker-chain.test.mjs
decisions:
  - "Task 1 type-only (no behavior) intentionally lands the union first so tsc enumerates the downstream consumer migration set (RESEARCH Pitfall 1)"
  - "makeResult() helper centralizes verdict population so every flattenBlockerChain return site carries needsYou/tier/affordance/awaitedPartyLabel + split-identity ids"
  - "maxSteps-exceeded fallthrough degrades to UNCLASSIFIED (D-10), not CYCLE — real revisit detection still emits CYCLE"
metrics:
  duration: "~7 minutes"
  completed: 2026-06-02
  tasks: 3
  files: 4
  commits: 4
---

# Phase 11 Plan 01: Honest Blocker Taxonomy — Shared Engine Contract Summary

The pure shared contract for the honest blocker taxonomy now lands: the `Terminal` union grew from 4 to exactly 8 honest kinds, `BlockerChainResult` carries a structured verdict every surface reads instead of re-deriving from `terminal.kind` or string-matching `ownerName`, the leaf cascade classifies agent-owned leaves (working vs conservatively-stuck) and walks through agents to the human-actionable end, and the `__unowned__` sentinel lie is gone repo-wide in `src/shared/` — replaced by a first-class `UNOWNED` kind whose `assign` affordance is the only honest "assign an owner" path.

## What Shipped

- **8-variant honest `Terminal` union (D-05).** Renamed `HUMAN_ACTION_ON` → `AWAITING_HUMAN` (no dead alias); added `AWAITING_AGENT_WORKING`, `AWAITING_AGENT_STUCK` (each `{agentId, label}`), `UNOWNED` (`{label}`, NO userId — D-11), and `UNCLASSIFIED` (`{label}`, the degrade kind).
- **Enriched `BlockerChainResult` verdict (D-13/D-15).** Added `needsYou`, `tier`, `actionAffordance`, optional `degradeReason`, `awaitedPartyLabel` (the only display string), and mutation-only split-identity `targetAgentUuid`/`targetIssueUuid` carrying the `LineageThread.ownerAgentId` "NEVER rendered as visible text (NO_UUID_LEAK)" provenance idiom.
- **`BlockerChainInput.nodeMeta` gains `assigneeAgentId`/`agentState` (D-01).** Optional, defaulting to null — pre-11-01 callers stay type-clean and fall through to `UNOWNED`/`SELF_RESOLVING`.
- **D-07 awaiting-first leaf cascade.** Order: EXTERNAL → `status==='awaiting'` (AWAITING_HUMAN) → `ownerUserId!=null` (AWAITING_HUMAN, widened) → `assigneeAgentId!=null` (AWAITING_AGENT_WORKING if `agentState==='working'`, else AWAITING_AGENT_STUCK per D-04 conservative-stuck) → `etaIso && no owner` (SELF_RESOLVING) → UNOWNED. Awaiting beats agent ownership; the DFS walk is unchanged so a chain still flattens *through* mid-chain agents to the human leaf (SC2).
- **Exported pure `classifyVerdict()` (D-14).** Maps each of the 8 kinds to its `{tier, actionAffordance, needsYou}` triple 1:1 per design-seed Section 1, with a `const _exhaustive: never` guard so a 9th kind is a compile error.
- **`pickTopChains` re-ranked (Pitfall 6).** Needs-you kinds lead: AWAITING_HUMAN=0, UNOWNED=1, SELF_RESOLVING=2, AWAITING_AGENT_WORKING=3, AWAITING_AGENT_STUCK=4, EXTERNAL=5, CYCLE=6, UNCLASSIFIED=7; copy-then-sort preserved.
- **NO_UUID_LEAK scrub for all 8 kinds.** `UNOWNED_SENTINEL` removed; scrub branches on `terminal.kind`; UNCLASSIFIED yields an honest "open to investigate" line with no assign verb; agent kinds scrub `agentId` to a name or `agent#<8>`.
- **Engine test extended.** Per-kind cases for the 4 new kinds + an 8-row `classifyVerdict` table case + renamed AWAITING_HUMAN case; determinism (100×), AI-token grep guard, and `pickTopChains` purity stay green (15/15).

## Verification

- `node --test test/shared/blocker-chain.test.mjs` → 15 pass / 0 fail (was 10 baseline).
- `npx tsc --noEmit` → the three shared files (`types.ts`, `blocker-chain.ts`, `scrub-human-action.ts`) compile clean; the only errors are the **expected** `never`-exhaustiveness / `HUMAN_ACTION_ON`-no-overlap migration errors in unmigrated consumers (`humanize-snapshot.ts`, `org-blocked-backlog.ts`, `flatten-blocker-chain.ts`, `live-blocker-panel.tsx`). Full-repo green is reached after Plans 11-02/03/04 — this is the live migration checklist (RESEARCH Pitfall 1), not a failure of this plan.
- `__unowned__` / `UNOWNED_SENTINEL` absent from all of `src/shared/`.
- AI-token grep guard: `blocker-chain.ts` contains zero `openai|anthropic|claude_local|llm|gpt|completion` tokens; engine reads no clock (`agentState` injected as a pre-resolved string).

## must_haves coverage

- 8 honest kinds, HUMAN_ACTION_ON renamed, no dead alias — **met** (types.ts union; `grep` confirms `HUMAN_ACTION_ON` absent from types.ts).
- Leaf classified by user owner / agent owner / liveness / ETA / unowned; awaiting beats agent ownership — **met** (cascade order; per-kind tests).
- Chain walks through agents to the human-actionable leaf; no mid-chain agent terminal — **met** (DFS walk unchanged; AWAITING_AGENT_WORKING test exercises a single-agent leaf, walk continuation is the existing PRIM-03 behavior).
- classifyVerdict maps all 8 kinds to {tier, affordance, needsYou} per the table — **met** (exported, never-guarded; 8-row table test).
- `__unowned__` sentinel removed; UNOWNED is a real kind with no userId — **met** (repo-wide grep CLEAN in src/shared/).
- Engine stays pure (100× determinism + AI-token grep guard) — **met** (both tests green).
- Verdict carries human-readable awaitedPartyLabel + separate mutation-only *Uuid fields — **met** (BlockerChainResult shape + scrub).
- Engine stays read-only classification, no leverage/unblocks-impact count (deferred to Phase 12) — **met** (no impact-count field added; D-16 honored).

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 are marked `tdd="true"` in the plan but their own verification is type/source-based and the plan explicitly sequences the new behavioral test cases into Task 3 ("after Task 3 adds the new cases"); the determinism + grep-guard tests stayed green throughout, and the full per-kind behavioral suite is green at Task 3 close. No bugs, missing-functionality, or blocking issues required auto-fix.

## Threat surface

No new security-relevant surface beyond the plan's threat register. T-11-01 (NO_UUID_LEAK) mitigated: `awaitedPartyLabel` is the only display string and is scrubbed to zero raw UUIDs for all 8 kinds; `targetAgentUuid`/`targetIssueUuid` carry the NEVER-rendered provenance comment. T-11-02 (purity) mitigated: AI-token guard + 100× determinism green, no clock read. T-11-03 (UNOWNED-vs-UNCLASSIFIED honesty) mitigated: classifyVerdict gives UNOWNED `assign` and UNCLASSIFIED `open` — a walk-failure can never surface a false "assign owner". No package installs (T-11-SC accept).

## Notes for Plans 11-02/03/04

The `tsc` errors **are** the migration checklist:
- `humanize-snapshot.ts` — exhaustive switch + `__unowned__` special-case need the 4 new kinds (or delete the dead file after confirming zero imports per Open Question 3).
- `org-blocked-backlog.ts` — inject `assigneeAgentId`/`agentState` into `buildEdges` nodeMeta; re-triage `need_you` off `verdict.needsYou`; emit UNCLASSIFIED on catch instead of silent drop.
- `flatten-blocker-chain.ts` — fix the `graceful()` EXTERNAL lie (walk-failure → UNCLASSIFIED); enrich return shape; consider collapsing its private BFS into shared `buildEdges`.
- `live-blocker-panel.tsx` / `employee-row.tsx` / `needs-you-banner.tsx` — gate affordances on `verdict.actionAffordance` / `verdict.tier`, not `kind === 'HUMAN_ACTION_ON'` or `ownerName === 'Unassigned'`.

## Commits

- `4555520` feat(11-01): extend Terminal union to 8 honest kinds + enriched verdict
- `9790fef` feat(11-01): D-07 awaiting-first cascade + exported classifyVerdict mapping
- `372247b` feat(11-01): remove __unowned__ sentinel from scrub + engine tests for 4 new kinds

## Self-Check: PASSED

All 4 modified files present on disk; all 3 task commits present in git history.
