# Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE) - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Give Paperclip employee agents a STRUCTURED, machine-readable way to declare "blocked on a human decision X" so the deterministic engine (`src/shared/blocker-chain.ts`) classifies it as `AWAITING_HUMAN` (needs-you) instead of conservatively parking it in Watch — the deep fix behind the BEAAA-972 confusion — and prove every blocked-no-edge class classifies truthfully across a full surface × terminal-kind matrix.

In scope (requirements WAIT-01..04):
- The structured human-wait signal + its additive plugin-namespace capture.
- The engine classifying a structured human-wait as `AWAITING_HUMAN` (needs-you), winning over a nominal agent assignee.
- Truthful classification of the whole blocked-no-edge family (blocked+agent-owned, blocked+human-owned, blocked+unowned, structured-human-wait).
- Extending the SC5 cross-surface consistency guard into a FULL surface × terminal-kind matrix; `blocker-chain.ts` stays pure (determinism + AI-token grep guards pass).

ALSO in scope (operator-seeded into Phase 17 on 2026-06-10 — STATE.md "PHASE 17 SEED" + memory `reader-breadcrumb-legibility-bug`; deliberately NOT deferred to Phase 18):
- The Reader goal-ancestry **breadcrumb** fix (mission-paragraph dump + 404 prefix-less links).
- The Reader "ANCHORED TO" **ref-card** legibility cleanup (lead plain-English, demote machine codes).

NOT in scope (belongs elsewhere): the action-card async re-architecture (Phase 19, flag-gated, LOCKED last); the broader plain-English / "Open ↗ → Reader" / "Looks done — close it?" legibility work (Phase 18, LEG-01..03). The two Reader fold-ins above are the only legibility items pulled forward, by explicit operator decision.

</domain>

<decisions>
## Implementation Decisions

### Structured human-wait — declaration mechanism (WAIT-01)
- **D-01:** The Editor-Agent (the only AI in the system; already reads every comment to compile TL/DRs) INTERPRETS an employee agent's normal prose and detects "blocked on a human decision." It writes a STRUCTURED row to an additive plugin-namespace table. The pure engine reads that row → `AWAITING_HUMAN`. **No new employee-agent behavior or convention is required** — employee agents stay regular Paperclip hires that only "talk"; they do NOT carry the Clarity MCP server, so the signal must be derivable from what they already produce (comments).
- **D-02:** The blocker-chain ENGINE stays AI-free (SC4). The AI produces the *data row* the engine consumes (exactly as `ownerUserId`/TL;DRs are produced today); the classification itself is deterministic. This satisfies SC1 (additive plugin-namespace capture) without breaching SC4 (no AI in `blocker-chain.ts`).
- **D-03:** Detection is tuned for **HIGH PRECISION**, not recall. Only declare a human-wait when the prose clearly names a decision/question awaiting a specific person. A MISSED wait falls back to today's honest-conservative Watch floor (no worse than now); a FALSE POSITIVE would put a fake item in the Needs-you tier and erode trust in the centerpiece — so precision wins.
- **D-04:** The declared wait is **re-derived each compile** (SWR-cached, re-evaluated on the Editor-Agent's next reactive pass). It clears automatically when the comments no longer show an open wait (human replied, or the agent posted progress/resolution) or the issue leaves blocked status. Self-healing and live — mirrors the existing reactive TL;DR recompile. NOT sticky-until-explicit-resolution.

### What the structured wait captures + how it renders (WAIT-02)
- **D-05:** The structured row captures `{ polished decision one-liner (the "what"), owner user id (the "who") }`. The Needs-you row reads **"`<owner> to decide: <one-liner>`"**. The one-liner is produced in the SAME `polishTldr` / Reader voice already used in `build-employees-rollup.ts` — voice parity by construction. The row tells you the actual decision, not merely that something is blocked.
- **D-06:** The structured-wait owner is **ALWAYS the company's primary human (the founder — Eric on BEAAA)**, ignoring any issue-level human assignee, for the structured-wait path. This is a deliberate **single-operator simplification** consistent with the v1.5.0 lock ("legible-for-non-builders, NOT multi-operator" — memory `v150-scope-locked`). Resolve "the company's primary human" GENERICALLY — no company-prefix or name literals (stay instance-agnostic per the constraint).
  - **Scope note:** D-06 applies ONLY to the new structured-human-wait signal. Native `blocked+human-owned` issues (WAIT-03) keep their own native `ownerUserId` from the existing cascade — D-06 does not override that path.

### Truthful-verdict precedence (WAIT-03)
- **D-07:** When an issue has BOTH a structured human-wait AND an agent assignee, the **structured wait WINS** → `AWAITING_HUMAN` (needs-you), not `AWAITING_AGENT_WORKING/STUCK`. A real human decision must not hide behind a nominally-assigned agent — this is the core BEAAA-972 fix. It extends the engine's existing "awaiting beats agent ownership" rule (`blocker-chain.ts:305-307`). The structured wait ranks at priority 0 alongside native `AWAITING_HUMAN`.
- **D-08:** The structured human-wait **REUSES the existing `AWAITING_HUMAN` terminal kind** — NO 9th kind is added. The 8-kind union (`AWAITING_HUMAN / AWAITING_AGENT_WORKING / AWAITING_AGENT_STUCK / SELF_RESOLVING / UNOWNED / EXTERNAL / CYCLE / UNCLASSIFIED`) and the SC5 matrix stay at 8 columns; `pickTopChains` priority ranking is unchanged. The structured wait emits `AWAITING_HUMAN` with the decision one-liner in the label and the existing `reply` affordance (answering the decision IS the action). SC3's four classes still each classify truthfully — `blocked+human-owned` and `structured-human-wait` both honestly mean "a human must act."
- **D-09:** The remaining blocked-no-edge classes keep their existing honest terminals: `blocked+agent-owned` → `AWAITING_AGENT_STUCK` (D-04 conservative-stuck), `blocked+unowned` → `UNOWNED` ("assign an owner first"). WAIT-03 verifies all four classify truthfully across the matrix.

### SC5 full matrix (WAIT-04)
- **D-10:** Extend the existing SC5 cross-surface consistency guard into a FULL matrix: every surface (Reader, Situation Room, Bulletin, Chat) × every terminal kind reads ONE consistent verdict. Keep `blocker-chain.ts` pure — the determinism test (JSON.stringify equality over 100 runs) and the AI-token grep guard must still pass. (Planner decides exact matrix encoding/CI placement; coordinates with Phase 20's CI codification.)

### Reader legibility fold-ins (operator-seeded)
- **D-11:** Breadcrumb — **DROP the root company-mission goal segment entirely** (its `goal.title` is the whole 1k+ char mission paragraph; never a useful nav target — operator: "I know what the company does"). Truncate any OTHER long segment (project/parent) to a short label. Source: `src/worker/handlers/issue-reader.ts` `deriveAncestry()`; `src/ui/surfaces/reader/index.tsx` (~line 354 documents the pathology); `src/ui/surfaces/reader/breadcrumb.tsx`.
- **D-12:** Breadcrumb links — **link only confirmed-routable segments, plain text otherwise.** Add the `/<companyPrefix>/` prefix to URLs we KNOW route (confirmed `/<prefix>/issues/<id>` per memory `paperclip-issue-url-pattern`); render any segment with no confirmed host page as plain, non-clickable text. Zero dead links, zero 404. `companyPrefix` is available via `extractCompanyPrefixFromPathname(useHostLocation().pathname)` (already used by ContinueInChatButton in `index.tsx`). **Research item:** planner/researcher must confirm which host goal/project page routes actually exist before linking those segments.
- **D-13:** Ref-cards ("ANCHORED TO") — **lead plain-English, demote machine codes.** Show the human title / what's-going-on first; move `BEAAA-NNN` to a subtle secondary position (or hide it); translate `Stuck`/`Standby` status code-chips into plain words (or drop). Get raw identifiers/status-codes out of the Reader's face but keep them recoverable. Source: `src/ui/surfaces/reader/ref-card.tsx`.

### Claude's Discretion
- Exact plugin-namespace table shape (columns, indexes) and migration number — additive-only, plugin namespace (planner/researcher to design; coordinate with existing repos like `clarity-agent-owners-repo`).
- Exact Editor-Agent prompt/heuristic for high-precision human-wait detection (subject to the existing governance/budget/circuit-breaker patterns).
- Exact SC5 matrix encoding and where in CI it runs.
- Precise breadcrumb-segment truncation length and ref-card visual treatment (within D-11/D-13 intent).

</decisions>

<specifics>
## Specific Ideas

- Operator voice on the breadcrumb (memory `reader-breadcrumb-legibility-bug`): "every time I click on the reader it shows [the company description] — I know what the company does. Clicking on it gives an error." → drop the mission crumb + kill the 404.
- Operator voice on ref-cards: they read like "task-tracker plumbing, not 'just tell me what's going on'." → raw identifiers/status-codes out of the Reader's face. This is the core "zero rabbit-holes / legible-for-non-builders" value (memory `v150-scope-locked`).
- The structured-wait row is the durable centerpiece artifact regardless of who writes it; the Editor-Agent is the populator, the pure engine is the consumer (mirrors the TL;DR producer/consumer split).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

The project has no formal external ADR/spec docs for this phase — requirements live in REQUIREMENTS.md + ROADMAP.md, and the implementation contract lives in the engine + handler source below.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §WAIT-01..04 (lines 34-37) — the four locked requirements; LEG-01..03 (lines 41-43) are Phase 18, NOT this phase except the two seeded Reader fold-ins.
- `.planning/ROADMAP.md` §"Phase 17" (lines 101-111) — goal, success criteria SC1-SC4, depends-on Phase 16.
- `.planning/STATE.md` "PHASE 17 SEED" (line 27) — the operator decision to fold the two Reader legibility fixes into Phase 17.

### Classification engine (the contract — keep PURE, AI-free)
- `src/shared/blocker-chain.ts` — `flattenBlockerChain` D-07 awaiting-first cascade (leaf selection lines 274-360); `classifyVerdict` kind→tier/affordance map (lines 60-90); `pickTopChains` priority ranking (lines 386-424). The structured signal plugs into this cascade; engine stays deterministic.
- `src/worker/handlers/org-blocked-backlog.ts` — builds `nodeMeta` from native primitives (`ownerUserId`/`status`/`assigneeAgentId`, lines 334-369); Shape-A vs durable-flip handling (lines 600-616). The structured-wait row feeds `nodeMeta` here.
- `src/worker/handlers/flatten-blocker-chain.ts` — mirror field-set for SC5 parity.
- `src/worker/situation/build-employees-rollup.ts` — `polishTldr` / Reader-voice helper for the decision one-liner (D-05).

### Reader fold-ins
- `src/worker/handlers/issue-reader.ts` — `deriveAncestry()` (the breadcrumb source: mission-dump + prefix-less URLs).
- `src/ui/surfaces/reader/index.tsx` — ~line 354 documents the mission-title pathology; `extractCompanyPrefixFromPathname` usage (ContinueInChatButton) for D-12.
- `src/ui/surfaces/reader/breadcrumb.tsx` — renders the segment links that 404.
- `src/ui/surfaces/reader/ref-card.tsx` — the "ANCHORED TO" cards (D-13).

### Prior decisions reused
- `.planning/phases/_superseded-legibility-16-18-misscope/16-CONTEXT.md` — the superseded 16-18 verdict-wording shared-helper input (ROADMAP says Phase 17 reuses it where it informs the classification surface).
- Memory `reader-breadcrumb-legibility-bug` — full diagnosis + fix sketch for D-11/D-12 (also in MemPalace clarity_pack/decisions).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `polishTldr` (`build-employees-rollup.ts`): produce the decision one-liner in Reader voice — voice parity for D-05.
- `extractCompanyPrefixFromPathname(useHostLocation().pathname)` (already used in `reader/index.tsx`): the instance-agnostic company-prefix source for D-12.
- `scrubHumanAction` / `nameByUuid` (`org-blocked-backlog.ts`): existing UUID→name scrub keeps the new row's render free of raw UUIDs (NO_UUID_LEAK already enforced).
- Plugin-namespace repo pattern (`src/worker/db/clarity-agent-owners-repo.ts`, `action-cards-repo.ts`, etc.): the model for an additive plugin-namespace table + `ctx.db.execute` writes.
- Editor-Agent comment-reading + governance/circuit-breaker scaffolding (`src/worker/agents/editor.ts`, `circuit-breaker.ts`, `self-loop-filter.ts`): the populator runs inside existing governance (caps, pause/terminate, no-storm guards from Phase 16.1).

### Established Patterns
- 8-kind terminal union + needs-you-first ranking is the single source of truth (`blocker-chain.ts`); reusing `AWAITING_HUMAN` (D-08) means NO change to the union or ranking.
- Producer/consumer split: AI produces data (TL;DRs, and now human-wait rows); the deterministic engine consumes data. Keeps `blocker-chain.ts` AI-free (SC4).
- Reactive SWR recompile (Phase 16/16.1): the human-wait row follows the same re-derive-on-compile lifecycle (D-04).
- Degrade-safe floor: when the Editor-Agent is down, no new rows are written → items fall to the honest conservative Watch floor (NOT a fabricated needs-you).

### Integration Points
- New: additive plugin-namespace table for human-wait rows + a repo; Editor-Agent write path; `org-blocked-backlog.ts` / `flatten-blocker-chain.ts` read of the row into `nodeMeta`.
- Engine: the leaf cascade gains the structured-wait branch ranked at/above `AWAITING_HUMAN`, winning over agent ownership (D-07).
- Reader: `deriveAncestry` (drop mission crumb + prefix URLs), `breadcrumb.tsx` (conditional link vs plain text), `ref-card.tsx` (de-code).
- CI: SC5 full surface × terminal-kind matrix (coordinates with Phase 20).

</code_context>

<deferred>
## Deferred Ideas

- A 9th distinct terminal kind for structured waits (`AWAITING_HUMAN_DECISION`) — rejected for v1.5.0 (D-08); revisit only if telemetry needs to separate structured from native human-owned.
- Multi-operator owner routing (per-issue human assignee for structured waits) — explicitly out (D-06 single-operator simplification per `v150-scope-locked`); a future milestone if Clarity ever serves multiple operators.
- A deterministic agent-emitted marker grammar / Clarity MCP tool for employee agents — not chosen now (would require prompting every agent and wiring the MCP server into regular hires); could become a deterministic fast-path later if the Editor-Agent-only path proves insufficient.
- Phase 18 legibility (Open ↗ → Reader, full NO_UUID_LEAK to partial hashes, "Looks done — close it?") and Phase 19 action-card async re-arch — separate phases; do not pull further forward.

</deferred>

---

*Phase: 17-structured-human-wait-truthful-verdicts-centerpiece*
*Context gathered: 2026-06-10*
