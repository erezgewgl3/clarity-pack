# Phase 11: Honest Blocker Taxonomy (engine) - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the binary owned-vs-unowned classification in the pure `src/shared/blocker-chain.ts` engine with a deterministic, **agent-aware** terminal taxonomy that is the single source of truth every surface reads. The engine recognizes **agent** ownership (`assigneeAgentId`) + heartbeat liveness — not just user ownership — flattens transitively to the human-actionable end, and is degrade-safe per row.

**In scope:** the engine taxonomy + agent-ownership/liveness capture at the engine boundary + a structured per-row verdict, plus updating all consuming surfaces to read it. Read-only classification only.

**Out of scope (later phases):** Editor-Agent named-action sentences (Phase 13), reply-in-place / quick-decision chips (Phase 14), the Needs-you leverage ranking (Phase 12), the cockpit IA redesign (Phase 15). `blocker-chain.ts` must stay pure — no AI/LLM call, no clock, no DB (SC4).
</domain>

<decisions>
## Implementation Decisions

### Agent liveness boundary
- **D-01:** **Caller pre-classifies liveness.** The worker (which already has heartbeat/run-state data) computes working-vs-stuck and passes `nodeMeta.agentState: 'working' | 'stuck' | null` into the engine. The engine stays purely structural — no clock, no time arithmetic — preserving the SC4 determinism test + AI-token grep guard.
- **D-02:** **Stuck = stale heartbeat AND nothing queued** (idle run-state + empty work queue). Computed in the worker, not the engine.
- **D-03:** **Stale window = no heartbeat for ≥ 2× the expected heartbeat interval.** The cadence value is sourced at the worker boundary so the threshold self-tunes to host cadence — no magic number, and none of it lives in the pure engine.
- **D-04:** **Missing liveness ⇒ agent-stuck (conservative).** An agent leaf with a known `assigneeAgentId` but no liveness signal classifies as `AWAITING_AGENT_STUCK`; surfaces show an honest "agent state unknown" line in Watch. Never assert unseen progress.

### Terminal taxonomy & migration
- **D-05:** **Rename + add (clean vocabulary).** Rename `HUMAN_ACTION_ON` → `AWAITING_HUMAN`; add `AWAITING_AGENT_WORKING`, `AWAITING_AGENT_STUCK`, `UNOWNED`. With `UNCLASSIFIED` (D-09) the `Terminal` union is **8 variants** (7 honest kinds + 1 explicit degrade). One vocabulary matching the design seed; no dead alias.
- **D-06:** **Big-bang migration this phase.** Engine + all 17 `blocker-chain` consumers updated together; the phase is not done until every surface reads the new verdict (SC5 single-source-of-truth).
- **D-07:** **Leaf precedence cascade (awaiting-first):** `EXTERNAL`/`CYCLE` pre-empt as today → then `status='awaiting'` ⇒ `AWAITING_HUMAN` → else user-owned ⇒ `AWAITING_HUMAN` → else agent-owned ⇒ `AWAITING_AGENT_WORKING`/`STUCK` by liveness → else `etaIso` + no owner ⇒ `SELF_RESOLVING` → else ⇒ `UNOWNED`. An explicit awaiting-human end beats agent ownership.
- **D-08:** **Test depth = planner discretion.** Hard constraint: the determinism test (100× `JSON.stringify` equality) and the AI-token grep guard in `test/shared/blocker-chain.test.mjs` MUST stay green (SC4).

### Honest unowned vs degrade (TAX-03)
- **D-09:** **Two distinct terminal kinds.** `UNOWNED` (genuine — leaf truly has no user/agent/ETA → "assign owner" is legit, lands in Needs-you) and `UNCLASSIFIED` (the chain build or walk failed → honest fallback line, **never** "assign owner").
- **D-10:** **Boundary = walk-success vs walk-failure.** genuinely-unowned = chain built & walked fine but ownerless. unclassified = the build/walk itself failed (`relations.get` threw, depth/`maxSteps` exceeded, malformed graph). Matches TAX-03's "can't be built OR classified."
- **D-11:** **Remove the `__unowned__` sentinel entirely.** It becomes the real `UNOWNED` kind with no `userId` — the fake `HUMAN_ACTION_ON` "assign owner" lie dies at the source (SC3).
- **D-12:** **UNCLASSIFIED copy:** "Can't determine blocker — open \<issue\> to investigate" + an open-issue affordance and **no** assign button. Exact wording is planner discretion; the no-assign-button rule is locked.

### Structured verdict contract (SC5)
- **D-13:** **Rich verdict object.** Extend `BlockerChainResult` with engine-computed `needsYou: boolean`, `tier: 'needs-you' | 'in-motion' | 'watch'`, `actionAffordance: 'reply' | 'nudge' | 'assign' | 'open' | 'none'`, and optional `degradeReason`. Surfaces render straight from it — zero re-derivation.
- **D-14:** **Engine owns the kind→{tier, affordance, needsYou} mapping** as a pure exported function/table. Phase 12 triage and Phase 15 cockpit both import it — one table, no `ownerName === 'Unassigned'` drift.
- **D-15:** **Split identity (NO_UUID_LEAK).** The verdict carries a human-readable `awaitedPartyLabel` (display) AND separate `targetAgentUuid` / `targetIssueUuid` (mutation-only, never rendered as text) — mirroring the v1.3.0 R3 fix (`leafIssueUuid` carried separately from the human key).
- **D-16:** **No leverage count in the engine.** It stays read-only classification and exposes structural inputs (`pathIds`, edges); the "unblocks → impact" leverage ranking is Phase 12 (Needs-You Triage).

### Claude's Discretion
- Exact determinism-test fixtures and depth (D-08); exact UNCLASSIFIED copy (D-12); internal naming of verdict fields; how the worker sources heartbeat cadence for the 2× stale window (D-03).
</decisions>

<specifics>
## Specific Ideas

- The **design seed Section 1 table** is the literal spec for the 7 honest terminals and their tier/action columns — implement against it, don't re-derive the taxonomy.
- `org-blocked-backlog.ts` **already fetches `assigneeAgentId` (≈L123) and throws it away** — agent-ownership capture is wiring data that's already on the wire into `nodeMeta`, not a new fetch path.
- Honest-result discipline (Core Value): a row we can't classify must say so plainly and never fabricate a "false assign owner." That is the whole point of `UNCLASSIFIED`.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition + the taxonomy spec
- `.planning/ROADMAP.md` — Phase 11 goal + 5 success criteria (the acceptance spine).
- `.planning/REQUIREMENTS.md` — **TAX-01 / TAX-02 / TAX-03** (the requirements this phase satisfies).
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` **§3 Section 1** (the engine terminal-taxonomy table — Terminal / Detected-from / In-Needs-you / Action columns; THE spec), §2 (Editor-Agent action-card boundary — downstream consumer of the verdict), §5 (scope: engine classification inherited free by org-blocked backlog + Reader panel).

### The engine + type surface being changed
- `src/shared/blocker-chain.ts` — `flattenBlockerChain` (the pure DFS being extended), `pickTopChains`, the `__unowned__` sentinel being removed (D-11).
- `src/shared/types.ts` §38–49 — `Terminal` union (4→8 variants) and `BlockerChainResult` (the rich verdict per D-13).
- `test/shared/blocker-chain.test.mjs` — determinism (100×) + AI-token grep guard; MUST stay green (SC4).

### Agent-ownership capture + consumers (the 17 readers; big-bang per D-06)
- `src/worker/handlers/org-blocked-backlog.ts` — `buildEdges`/`nodeMeta` build; already pulls `assigneeAgentId` (≈L123) — the agent-ownership/liveness injection point.
- `src/worker/jobs/situation-snapshot.ts` — `relations.get` BFS, `MAX_CHAIN_DEPTH=6`; the parallel edge/nodeMeta build to keep in sync.
- `src/worker/situation/build-employees-rollup.ts` — re-triages "Needs you" off the terminal kind (not `ownerName === 'Unassigned'`).
- `src/ui/surfaces/situation-room/{employee-row,needs-you-banner,owner-picker-popover}.tsx`, `src/ui/surfaces/reader/{index,live-blocker-panel}.tsx`, `src/shared/scrub-human-action.ts`, `src/worker/bulletin/{action-inbox-query,lineage-grouper}.ts`, `src/worker/handlers/{flatten-blocker-chain,agent-take-ownership}.ts` — verdict consumers to migrate.

### Cross-cutting constraints + history
- `CLAUDE.md` — engine-purity (PRIM-03), NO_UUID_LEAK, governance parity, additive-schema rule.
- `.planning/phases/10-unblock-resume-spike/10-CONTEXT.md` + Phase 10 spike findings — whether an `AWAITING_AGENT_STUCK` row is actually resumable (informs the `nudge` affordance); comment-alone resumes Shapes A & B.
- `MEMORY.md` → `beaaa-deploy-mechanics.md` — the v1.3.0 **R3** bug (human key passed where a UUID was needed) that D-15's split-identity prevents.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`flattenBlockerChain` + `pickTopChains`** (`blocker-chain.ts`) — extend in place; keep pure. The existing leaf-terminal selection is the skeleton the awaiting-first cascade (D-07) slots into.
- **`org-blocked-backlog.ts` buildEdges** — already fetches `assigneeAgentId`; wiring it into `nodeMeta` is the agent-ownership capture (no new fetch).
- **`scrub-human-action.ts`** — the NO_UUID_LEAK scrub the verdict's display label must keep honoring (D-15).

### Established Patterns
- **Pure-engine + AI-token grep guard** (PRIM-03): the determinism contract this phase must preserve.
- **CTT-07 no-mutate invariant**: irrelevant here by construction — the engine is read-only classification.
- **Caller-injects-the-impure-bits**: liveness (D-01) follows the same "engine takes structured facts, worker computes them" split the codebase already uses.

### Integration Points
- 17 `blocker-chain` consumers migrate to the rich verdict (D-06).
- `build-employees-rollup` Needs-you re-triage keys off `tier`/`needsYou` (D-13/D-14), not a string match.
- `owner-picker-popover` / assign affordance now appears only on `UNOWNED` (and, in Phase 12, stuck-agent) rows — never on `AWAITING_HUMAN` or `UNCLASSIFIED`.
- No new migration intended (read-only; additive-schema rule untouched).
</code_context>

<deferred>
## Deferred Ideas

- **Needs-you leverage / "unblocks → impact" ranking** — Phase 12 (D-16 keeps it out of the engine).
- **Editor-Agent named-action sentences + action cards** — Phase 13 (engine only flags the rows; prose is layered on top).
- **Reply-in-place + quick-decision chips** — Phase 14.
- **Cockpit IA redesign (Pulse + Needs-you / In-motion / Watch tiers)** — Phase 15. The engine's `tier` field feeds it but the screen is not redesigned here.
- **`issue.relations.write` capability (clear `blockedByIssueIds`)** — Phase 14 decision (per Phase 10 D-10); not needed for read-only classification.

### Reviewed Todos (not folded)
None — no todo matches surfaced for Phase 11.
</deferred>

---

*Phase: 11-honest-blocker-taxonomy-engine*
*Context gathered: 2026-06-02*
