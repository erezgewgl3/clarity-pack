# Phase 13: Editor-Agent Named Action - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Layer the **human sentence** on top of the honest deterministic engine. For each row the Phase 11 engine already classified as **human-actionable** (`needsYou === true` — i.e. `AWAITING_HUMAN` or genuinely-`UNOWNED`), the **Editor-Agent** (Editorial Desk) emits a grounded **action card**: a single named action + the awaited party + a coarse time estimate (+ optional yes/no decision options when the source issue poses a binary), each carrying its source issue. The card is cached in the additive plugin namespace and refreshed on the Editor-Agent heartbeat + the existing 60s on-view recompute, **reusing the existing TL;DR / bulletin-gloss grounded-summary pipeline verbatim** (same operation-issue handoff, same cache table family, same governance parity). A hard guardrail makes a stale-or-absent card **degrade to the deterministic engine line** — never blank, never invent urgency. The two halves stay visibly separate: **no AI in `blocker-chain.ts`** (PRIM-03 + AI-token grep guard stay green).

**In scope:** the action-card data shape; the additive cache table; the Editor-Agent generation step (mirrors `driveTldrCompileStep` / `driveBulletinGlossStep`); the grounding / anti-fabrication rules; binary-detection; the coarse-bucket estimate rule; the staleness signal + concrete threshold + degrade-to-deterministic-line behavior; wiring generation into the existing valid-scope SR data handler (the 60s recompute) + the Editor-Agent heartbeat; **rendering the named-action sentence + party + estimate on the EXISTING Needs-you row** (minimal — no new screen). Satisfies ACT-01, ACT-02, ACT-03.

**Out of scope (later phases):**
- **Reply-in-place / quick-decision chips that ACT on the card** (post-to-agent + unblock+resume) — **Phase 14** (DO-01/02/04/05). Phase 13 *produces* `decisionOptions` data; it does NOT wire the Send/chip action loop.
- **The full Pulse header + Needs-you / In-motion / Watch tier IA + the redesigned card LAYOUT** — **Phase 15** (COCK-01/02). Phase 13 renders the sentence inline on the existing Phase-8/9 employee row; the rich card visual is Phase 15.
- **No engine change.** `blocker-chain.ts` is read-only consumed; no new Terminal kind, no AI token.
- **No public.* mutation.** Only an additive plugin-namespace migration.
</domain>

<decisions>
## Implementation Decisions

### Storage — action-card cache (ACT-01, SC4)

- **D-01: New additive table `plugin_clarity_pack_cdd6bda4bd.action_cards` in `migrations/0015_action_cards.sql`** (next number after `0014_bulletins_multicompany.sql`). Mirrors the `tldr_cache` table family (validator-legal: fully-qualified schema name, `CREATE TABLE IF NOT EXISTS`, inline `UNIQUE` for the idempotency/index key, `COMMENT ON` apostrophe-free). Additive-only; plugin disable leaves it intact. **Rejected: reuse `tldr_cache`** with a synthetic `surface`/`scope_id` (as `bulletin-gloss` does) — rejected because action cards are *structured* (party + estimate + decision options + source issue), not a free-text body; jamming them into `tldr_cache.body` as JSON would lose typed columns, queryability per-leaf, and a clean staleness hash column. A dedicated table is the honest shape. **Rejected: reuse `situation_snapshots`** — that table is dead (never written post-Phase-9 per `situation-room.ts` WARNING 5) and is a whole-snapshot blob, not a per-leaf keyed cache.

- **D-02: Column sketch (one row per distinct source/leaf issue per company):**
  ```
  id                   bigserial PRIMARY KEY
  company_id           text NOT NULL                 -- multi-company correct (0014 lesson)
  source_issue_id      text NOT NULL                 -- the LEAF/source issue UUID the card grounds in (== verdict.targetIssueUuid / pathIds[last])
  named_action         text NOT NULL                 -- the single plain-English action sentence (Editorial Desk voice)
  awaited_party        text NOT NULL                 -- the human-readable awaited party (NO UUID); grounded in the verdict's scrubbed awaitedPartyLabel
  est_bucket           text NOT NULL                 -- coarse estimate bucket (D-09), e.g. 'quick' | 'focused' | 'deep' — NOT free-form minutes
  action_kind          text NOT NULL                 -- 'answer' | 'decide' | 'assign' | 'none' (grounded in the engine actionAffordance)
  decision_options     jsonb                         -- NULL unless the source issue poses an explicit binary (D-08); e.g. ["Approve","Reject"]
  content_hash         text NOT NULL                 -- staleness key (D-05): hash over (verdict fingerprint + issue revision inputs)
  generated_at         timestamptz NOT NULL DEFAULT now()
  compiled_by_agent_id text NOT NULL                 -- governance audit (EDITOR_AGENT_ID_TAG)
  source_revisions     text[] NOT NULL DEFAULT '{}'  -- EDITOR-04 self-loop filter parity with tldr_cache
  tags                 text[] NOT NULL DEFAULT '{}'
  UNIQUE (company_id, source_issue_id, content_hash)
  ```
  `UNIQUE (company_id, source_issue_id, content_hash)` is the EDITOR-03-style idempotency key (same input twice = one LLM call; `ON CONFLICT DO NOTHING`). The most-recent-card read is `WHERE company_id=$1 AND source_issue_id=$2 ORDER BY generated_at DESC LIMIT 1`. `text[]` columns are bound via the `toPgTextArrayLiteral` + `$N::text[]` cast pattern (the v0.6.5 Bug 2 fix in `tldr-cache.ts`). A new repo `src/worker/db/action-cards-repo.ts` mirrors `tldr-cache.ts` (`upsertActionCard` / `getActionCardBySource`).

- **D-03: The card is keyed by the LEAF issue (`source_issue_id` = `verdict.targetIssueUuid`), not per-employee.** This matches Phase 12's per-leaf dedup (D-03): one action, one card, regardless of how many agents/items that leaf frees. `source_issue_id` IS the dispatch/grounding key — it is a UUID, stored and used as a key only, **never rendered** (NO_UUID_LEAK). The human `leafIssueId` / `awaited_party` are the display fields.

### Generation — reuse the grounded-summary pipeline (SC4)

- **D-04: New worker module `src/worker/agents/action-cards.ts` exporting `driveActionCardsStep(ctx, {companyId, verdictRows})`, a 1:1 structural mirror of `driveBulletinGlossStep`** (`src/worker/bulletin/bulletin-gloss.ts`). One Editor-Agent operation per recompute emits a **JSON map `{ source_issue_id → {namedAction, awaitedParty, estBucket, actionKind, decisionOptions?} }`** (not N tasks), keyed by a content-hash of the human-actionable verdict set, exactly as the gloss step emits `{threadId→gloss}`. It reuses verbatim: `resolveEditorAgentId` (op-issue agent discovery, NO dead reconcile), `startAgentTask` / `pollAgentTaskResult` (the operation-issue handoff via `OPERATION_ORIGIN_KIND_PREFIX`), the CONSUME-BEFORE-SPAWN read-back (the `bulletin-gloss` BUG-2 fix — a done op's result is read before spawning a new one), the PAUSED-check (no auto-resume on a passive view), and `finalizeTldr`-style validation + circuit breaker (`recordFailure` / `recordSuccess`). **Rejected: inventing a parallel agent-invocation mechanism** — forbidden by the "reuse the existing grounded-summary pattern" constraint and would duplicate the hard-won scope-dead-job / consume-before-spawn fixes.

- **D-05: New `OperationKind` value `'action-cards'`** added to the union in `agent-task-delivery.ts` (currently `'bulletin-compile' | 'tldr-compile' | 'bulletin-gloss'`). The operation id is `action-cards-<companyId>` (or a snapshot-scoped id) so the idempotency search + consume-before-spawn key per company per recompute. The agent files its result under the existing `RESULT_DOCUMENT_KEY = 'compile-result'` (the proven delivery channel), as raw JSON, then marks the op done — identical to gloss.

- **D-06: Refresh cadence = the EXISTING 60s on-view recompute + the Editor-Agent heartbeat — NO new tight loop, NO new cron.** The 60s recompute is realized by the `situation.snapshot` **data handler** (`src/worker/handlers/situation-room.ts`), which is the **valid HTTP-request scope** the UI polls while the SR is open (the cron writer is dead per PR #6547 — `situation-room.ts` WARNING 5). `driveActionCardsStep` is invoked from inside that handler (after `buildEmployeesRollup`), exactly where `driveTldrCompileStep` lives for the Reader and `driveBulletinGlossStep` lives for the Bulletin. The Editor-Agent heartbeat path (`handleEditorHeartbeat` in `editor.ts`) is the secondary trigger, mirroring TL;DR. Governance parity is inherited for free: same agent, same budget caps / pause-terminate / audit, same circuit breaker.

### Grounding & anti-fabrication (SC1, SC3 / ACT-03)

- **D-07: The Editor-Agent annotates ONLY rows the engine flagged `needsYou === true`.** `driveActionCardsStep` receives the human-actionable verdict subset already computed by `build-employees-rollup.ts` (the `needsYouRows` set) — it cannot see, and therefore cannot annotate, agent-working / self-resolving / external / cycle rows. This is the structural guardrail against manufactured urgency (ACT-03): the AI never decides *whether* a row needs a human; the deterministic engine does. The prompt is grounded in the source issue's body/title/comments (the same inputs `readTldrInputs` gathers) + the scrubbed `awaitedPartyLabel`, and the prompt instructs "describe only what the issue says; do NOT invent deadlines, urgency, or parties not named in the source."

- **D-08: Binary detection is CONSERVATIVE — `decisionOptions` is emitted ONLY when the source issue text poses an explicit binary.** The Editor-Agent is instructed to populate `decisionOptions` (e.g. `["Approve","Reject"]`, `["Ship","Hold"]`) **only** when the issue clearly asks a yes/no or pick-one question; otherwise it returns `null` (a free-text answer is expected). The default is `null`. This prevents fabricating a false binary on an open-ended question. (Phase 14 renders the chips; Phase 13 only produces the data, honestly absent when not warranted.)

- **D-09: Time estimate = a COARSE BUCKET, never manufactured-precise minutes.** The Editor-Agent emits `est_bucket ∈ {'quick','focused','deep'}` (roughly: quick ≈ a few minutes / one decision; focused ≈ up to ~30 min review; deep ≈ needs real work-block). A coarse bucket cannot manufacture false precision the way "est. 12 minutes" would, and it degrades honestly (a missing/garbage bucket → omit the estimate, not a fake number). The display renders the bucket as plain words ("quick decision" / "~30-min review" / "deep work"). **Rejected: grounded numeric minutes** — there is no honest signal in the issue to ground a minute count; it would be invented precision, violating SC1's "cannot manufacture false precision."

- **D-10: `awaited_party` and `named_action` carry ZERO raw UUIDs (NO_UUID_LEAK).** The prompt forbids UUIDs/internal ids in the sentences (same instruction the gloss prompt uses). Belt-and-suspenders: the persisted `awaited_party` / `named_action` are run through the existing `scrubHumanAction`-family / UUID-strip guard before caching, and the render-scan UUID-pattern test (Phase 11 11-07 NO_UUID_LEAK guard) is extended to cover the action-card render path. `source_issue_id` / any agent UUID stay key/dispatch-only.

### Staleness & degrade guardrail (SC2 / ACT-02)

- **D-11: Staleness signal = content-hash mismatch OR generated_at age > 10 minutes.** A card is **fresh** iff its `content_hash` equals the hash recomputed from the current verdict fingerprint + issue-revision inputs (the `tldrContentHash`-style hash over the source issue body/comments/refs + the terminal kind + the awaited party) **AND** `generated_at` is within 10 minutes of now. A mismatch (the issue or its classification changed) **OR** age > 10 min ⇒ the card is treated as stale. **Concrete N = 10 minutes** — chosen because the SR recompute is 60s and the Editor-Agent typically finalizes a result in ~1.5–2 min; 10 min is ~5 recompute cycles of slack so a momentarily-slow agent does not flap the row to the degraded line, while a genuinely stale card (agent down / issue moved on) falls back promptly. The hash-mismatch arm is the *correctness* signal (catches a changed issue immediately); the 10-min arm is the *liveness* backstop (catches a silently-dead agent).

- **D-12: When a card is stale OR absent, the row degrades to the DETERMINISTIC engine line — never blank, never fabricated urgency (SC2).** The degraded line is the EXISTING deterministic `blockerChain.humanAction` / `awaitedPartyLabel` already on the row (the scrubbed engine output, e.g. *"waiting on you — Founder ruling, <leafIssueId>"*). This reuses the Phase 11 `makeDegradedResult` / `scrubHumanAction` discipline: the engine line is always present (the engine ran first and is degrade-safe per row), so the action-card layer can ALWAYS fall back to it. The fallback shows the party + leaf identifier with NO estimate and NO decision options (those are AI-only enrichments — honestly omitted when the AI sentence is unavailable). The action-card step itself NEVER throws (mirrors `driveBulletinGlossStep`): every host call is wrapped; a hiccup yields `status:'compiling' | 'paused' | 'unavailable'` and the row renders the deterministic line.

### Render scope — produce + cache + render-minimal this phase (SC1)

- **D-13: Phase 13 produces + caches the card AND renders the named-action sentence + party + estimate on the EXISTING Needs-you employee row** (`src/ui/surfaces/situation-room/employee-row.tsx` + the SR index that threads the snapshot). SC1 says "each human-actionable row SHOWS a grounded named action…", so the sentence must literally appear now — but **minimally**: the existing row gains the Editorial sentence + a small "waiting on <party> · <estimate bucket>" line, replacing/augmenting the current deterministic `humanAction` text when a fresh card exists, and falling back to the deterministic text (D-12) when it does not. **No new screen, no Pulse, no tier reorg, no rich card layout, no reply input, no chips** — that is Phase 15 (layout) + Phase 14 (action loop). The snapshot payload from `situation.snapshot` gains an optional per-row `actionCard` field (null when degraded) the UI reads. **Rejected: produce-and-cache only (no render until Phase 15)** — would make SC1 literally false this phase ("row shows…"); the minimal inline render is the honest minimum.

- **D-14: The action card data shape is a shared type `ActionCard` in `src/shared/types.ts`** (alongside `TLDR` / `BlockerChainResult`), consumed by both the worker (cache + step) and the UI (render). It carries display fields only on the render surface (`namedAction`, `awaitedParty`, `estBucket`, `decisionOptions`) plus the mutation-only `sourceIssueUuid` (key/dispatch only, never rendered) — the same split-identity discipline as `BlockerChainResult` (D-15 of Phase 11).

### Engine separation (PRIM-03)

- **D-15: All Editor-Agent action generation lives in `src/worker/agents/action-cards.ts` + the prompt — NEVER in `src/shared/blocker-chain.ts`.** The engine remains pure read-only classification; the action-card step *consumes* the verdict (`needsYou`, `awaitedPartyLabel`, `targetIssueUuid`, `actionAffordance`) as structured input. The determinism test (100× `JSON.stringify`) and the AI-token grep guard on `blocker-chain.ts` (`test/shared/blocker-chain.test.mjs`) MUST stay green — no AI/LLM token may enter the engine file. This mirrors the established split: the engine flags the row; the Editorial Desk writes the sentence.

### Claude's Discretion
- Exact `est_bucket` enum labels and their human-display strings (D-09), and whether to store a nullable numeric hint alongside the bucket (lean: bucket-only).
- Exact `action_kind` enum mapping from the engine `actionAffordance` (`reply`→`answer`, `assign`→`assign`, etc.) and whether `action_kind` is engine-derived (deterministic, preferred) vs agent-emitted.
- The precise `content_hash` input fingerprint composition (D-11) — must include enough of the issue revision + verdict that a meaningful change busts the cache, while staying deterministic (no clock in the hash).
- Operation-id scoping for `'action-cards'` (per-company vs per-company-per-snapshot) and the consume-before-spawn recency window (reuse the gloss/`TLDR_CONSUME_RECENCY_MS` value).
- Prompt wording for the Editorial Desk action-card voice (reuse the `compile-tldr.ts` / `bulletin-gloss.ts` voice rules; STRICT-JSON output like gloss).
- Determinism-test / unit-test fixtures for the pure helpers (binary-detection conservatism is enforced by prompt + a JSON-shape validator; the bucket-normalizer + UUID-scrub + staleness predicate are pure and unit-testable).
- Whether the heartbeat path (D-06 secondary trigger) ships this phase or is deferred to the view-driven path only (the view-driven SR handler is the must-have; heartbeat is parity-nice-to-have).

## Decision → Requirement / Success-Criteria map
- **ACT-01 / SC1** → D-01..D-04, D-09, D-13, D-14 (named action + party + estimate, generated, carrying source issue, rendered on the row).
- **ACT-02 / SC2** → D-11, D-12 (staleness signal + concrete 10-min threshold; degrade to the deterministic line, never blank/fabricate).
- **ACT-03 / SC3** → D-07, D-08, D-15 (annotate only engine-flagged rows; conservative binary detection; no AI in engine).
- **SC4** → D-01, D-04, D-05, D-06 (additive cache table; reuse TL;DR/gloss pipeline; heartbeat + 60s recompute; governance parity).
</decisions>

<specifics>
## Specific Ideas

- **Design-spec Section 2 (the literal target — the action-card shape):**
  > "For each row the engine classifies as `AWAITING_HUMAN` (or `AWAITING_AGENT_STUCK`), the Editor-Agent emits a structured **action card**: `{ awaitedParty, namedAction (sentence), estMinutes, actionKind: answer|decide|nudge|none, decisionOptions?, targetIssueId, sourceIssueId, generatedAt }`."
  (Note: Phase 13 narrows the engine input to `needsYou === true` rows per Phase-12 D-04 — stuck-agent stays in Watch — and substitutes a coarse `estBucket` for `estMinutes` per D-09's anti-false-precision rule.)

- **Design-spec Section 2 guardrails (verbatim intent):**
  > "The Editor-Agent **cannot invent urgency** — it only writes sentences for rows the engine already flagged. It surfaces the *question*; the operator makes the call. `decisionOptions` (yes/no chips) only when the issue text poses a binary."
  > "**Grounded + freshness-stamped** (same pattern as existing TL;DR/bulletin, which has a pass-2 verifier). Each card carries its source issue."
  > "**Stale → degrade**, not fabricate: if a card is stale, the row falls back to the deterministic line ('waiting on you — Founder ruling, BEAAA-649'). Cached in the plugin namespace; refreshed on the Editor-Agent heartbeat + the existing 60s on-view recompute."

- **Design-spec Section 3 Needs-you row spec (what the rendered sentence aims at — full visual is Phase 15):**
  > "Each row = named-action sentence + who + *unblocks →* impact + time estimate + running total." (Phase 13 ships the *named-action sentence + who + estimate*; the "unblocks → impact" leverage prose builds on Phase 12's sort-only leverage and lands with the Phase 15 layout. The `BEAAA-NN` in the spec is illustrative — instance-agnostic, no company-prefix literals.)

- **Editorial Desk voice:** reuse the established voice from `compile-tldr.ts` (`buildPrompt`) — direct address ("you"), active verbs, concrete-over-nominal, human dates, translate agent jargon, STRICT-JSON output like `bulletin-gloss.ts` `buildGlossPrompt`. The deterministic polish passes (`polishTldr` — ISO→human date, jargon glossary) can be applied to `named_action` for parity.

- **The deterministic degrade line already exists on every row:** `build-employees-rollup.ts` populates `blockerChain.humanAction` / `awaitedPartyLabel` via `scrubHumanAction(terminal, …)`, present even on a thrown chain (the UNCLASSIFIED honest-fallback path). The action-card layer never has to synthesize a fallback — it falls back to this.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition + requirements
- `.planning/ROADMAP.md` — **Phase 13** goal + 4 success criteria (the acceptance spine); the v1.4.0 framing ("deterministic engine + Editor-Agent supplying the named sentence on top; the two halves stay visibly separate — no AI in `blocker-chain.ts`").
- `.planning/REQUIREMENTS.md` — **ACT-01 / ACT-02 / ACT-03** (the three requirements this phase satisfies) + the Out-of-Scope table (no public.* mutation; additive plugin-namespace migrations only).

### The design ground truth
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` — **§3 Section 2** (the Editor-Agent named-action card shape + the cannot-invent-urgency / grounded / stale→degrade guardrails — THE spec for this phase), **§3 Section 3 "Needs you (N)" row spec** (the named-action sentence + who + estimate the row renders), **§2 locked decision 2** (named action + reply-in-place + decision chips — chips are Phase 14), **§5 scope** ("additive action-card cache table … must stay additive-only"), **§6 verification target 3 + 5** (named action per row; Editor-Agent down/stale → degrade, never blank/fabricate).

### The engine verdict this phase consumes (read-only; NO edit)
- `src/shared/blocker-chain.ts` — `classifyVerdict()` (the per-kind `{tier, actionAffordance, needsYou}` table), `flattenBlockerChain`, `makeDegradedResult` (the degrade-row constructor the fallback line traces to), `scrubHumanAction` discipline. **Pure — stays AI-free (D-15).**
- `src/shared/types.ts` — `Terminal` union + `BlockerChainResult` (`needsYou`, `tier`, `actionAffordance`, `awaitedPartyLabel`, `targetIssueUuid`/`targetAgentUuid` split-identity); `TLDR` type (the shape the new `ActionCard` type mirrors).
- `test/shared/blocker-chain.test.mjs` — determinism (100× `JSON.stringify`) + AI-token grep guard; MUST stay green (no AI token enters the engine).

### The grounded-summary pipeline this phase REUSES (the pattern, per SC4)
- `src/worker/bulletin/bulletin-gloss.ts` — **the closest analog: `driveBulletinGlossStep`** (per-view, valid-scope, ONE op emits a JSON `{id→sentence}` map, content-hash-keyed cache, consume-before-spawn read-back, PAUSED-check, graceful degrade, NEVER throws). `driveActionCardsStep` is a 1:1 structural mirror.
- `src/worker/agents/editor.ts` — `driveTldrCompileStep` (the per-issue view-driven driver), `resolveEditorAgentId` (op-issue agent discovery, no dead reconcile), `consumeExistingTldrOpResult` (CONSUME-BEFORE-SPAWN), `handleEditorHeartbeat` (the heartbeat secondary-trigger path), `EDITOR_AGENT_KEY` / `EDITOR_AGENT_ID_TAG`.
- `src/worker/agents/compile-tldr.ts` — `tldrContentHash` (the content-hash recipe for the staleness key), `finalizeTldr` (validation + circuit breaker + cache write), `prepareTldrCompile` (cache-check + cap gate), the Editorial Desk `buildPrompt` voice, `polishTldr` (deterministic polish), `recordFailure`/`recordSuccess` parity.
- `src/worker/agents/agent-task-delivery.ts` — `startAgentTask` / `pollAgentTaskResult` / `OperationKind` (add `'action-cards'`) / `OPERATION_ORIGIN_KIND_PREFIX` / `RESULT_DOCUMENT_KEY` (the operation-issue handoff + document read-back).
- `src/worker/db/tldr-cache.ts` — the cache-repo template (`upsertTldr` / `getTldrByScope`, `toPgTextArrayLiteral` + `$N::text[]` cast for `text[]` columns — the v0.6.5 Bug 2 fix); `src/worker/db/action-cards-repo.ts` mirrors it.
- `migrations/0002_tldrs_and_editor.sql` — the additive-table template (qualified schema name, `IF NOT EXISTS`, inline `UNIQUE`, `COMMENT ON`, the validator-legality notes); `migrations/0014_bulletins_multicompany.sql` — the multi-company-key lesson (`company_id` in the keys) + validator constraints (create/alter/comment only, no `DO`/`CREATE INDEX`/standalone `DROP`).

### Where generation is wired + where the row renders
- `src/worker/handlers/situation-room.ts` — the **`situation.snapshot` data handler = the valid-scope 60s recompute** (cron is dead, PR #6547); `driveActionCardsStep` slots in here after `buildEmployeesRollup`, and the per-row `actionCard` field is added to the returned payload.
- `src/worker/situation/build-employees-rollup.ts` — the human-actionable `needsYouRows` set (D-07 input) + `blockerChain.{humanAction,awaitedPartyLabel,targetIssueUuid,needsYou,actionAffordance}` (the grounding inputs + the degrade-line source).
- `src/ui/surfaces/situation-room/employee-row.tsx` (+ the SR index that threads the snapshot, + `needs-you-banner.tsx`) — the minimal inline render of the named-action sentence + party + estimate (D-13), with degrade-to-deterministic-line.

### Cross-cutting constraints + history
- `CLAUDE.md` — engine purity (PRIM-03), NO_UUID_LEAK, governance parity (Editor-Agent = regular org-chart hire; budget caps / pause-terminate / audit), additive-schema rule, plugin namespace `plugin_clarity_pack_cdd6bda4bd`, the TL;DR / bulletin cache tables, the 60s-on-view-recompute + Editor-Agent-heartbeat mechanics, MCP read pattern, instance-agnostic rule.
- `.planning/phases/11-honest-blocker-taxonomy-engine/11-CONTEXT.md` — D-13 (rich verdict), D-14 (engine owns the kind→{tier,affordance,needsYou} table), D-15 (split-identity NO_UUID_LEAK), D-16 (leverage kept OUT of the engine).
- `.planning/phases/12-needs-you-triage/12-CONTEXT.md` — D-03 (per-leaf dedup — the card is keyed per leaf), D-07 (named-action sentence + "unblocks → impact" + estimate **explicitly deferred from Phase 12 to here**), D-11 (`needsYou`-keyed membership the card consumes).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (real files read, with paths)
- **`driveBulletinGlossStep`** (`src/worker/bulletin/bulletin-gloss.ts`) — the EXACT template for `driveActionCardsStep`: a per-view step that resolves the Editor-Agent, content-hash-checks the cache, consumes an existing done op's result before spawning, PAUSED-checks (no auto-resume), runs ONE op emitting a JSON map, finalizes into the cache, and NEVER throws (degrades to a non-error status + null enrichment). Phase 13 copies its skeleton and swaps the prompt + the cache table + the JSON map shape.
- **`driveTldrCompileStep` + `consumeExistingTldrOpResult` + `resolveEditorAgentId` + `handleEditorHeartbeat`** (`src/worker/agents/editor.ts`) — the view-driven driver, the consume-before-spawn fix (PR #6547 / scope-dead-job workaround), the agent-id discovery, and the heartbeat trigger. All reused as-is or mirrored.
- **`tldrContentHash` / `finalizeTldr` / `polishTldr` / `buildPrompt` voice / circuit breaker** (`src/worker/agents/compile-tldr.ts`) — the staleness-hash recipe, the validate+cache+breaker primitive, the deterministic polish, the Editorial Desk voice, governance-parity failure recording.
- **`upsertTldr` / `getTldrByScope` / `toPgTextArrayLiteral`** (`src/worker/db/tldr-cache.ts`) — the cache-repo template + the `text[]`-binding fix the new `action-cards-repo.ts` copies.
- **`build-employees-rollup.ts` `needsYouRows` + `blockerChain` fields** — the human-actionable subset (D-07 generation input) and the deterministic `humanAction`/`awaitedPartyLabel` degrade-line source (D-12). `computeLeverageByLeaf` / `leverage.ts` already collapse per-leaf — the card keys off the same `targetIssueUuid` leaf key (D-03 parity).
- **`migrations/0002_tldrs_and_editor.sql` + `0014_bulletins_multicompany.sql`** — additive-table + multi-company-key + validator-legality templates for `0015_action_cards.sql`.

### Established Patterns
- **Grounded-summary cache:** content-hash idempotency (`UNIQUE(...,content_hash)` + `ON CONFLICT DO NOTHING`), most-recent-by-`generated_at` read, `text[]` via `$N::text[]` cast. Action cards adopt this verbatim.
- **View-driven compile in a valid HTTP scope (NOT a cron):** scheduled jobs are scope-dead on `paperclipai@2026.525.0` (PR #6547); the must-succeed compile happens in the data handler the UI polls (`situation.snapshot` for SR, `bulletin.byCycle` for the gloss, `issue.reader` for TL;DR). Phase 13's 60s recompute IS this handler.
- **Consume-before-spawn:** the agent marks its op `done` after delivering; `startAgentTask`'s idempotency reuse excludes terminal ops, so the driver must READ the done op's result before spawning a new one (the `bulletin-gloss` BUG-2 / `reader-tldr-stuck-compiling` fix). Mandatory for the action-card step too.
- **Graceful degrade, never-throw:** every host call wrapped; a hiccup yields a status, not an exception; the row always has the deterministic engine line to fall back to.
- **Governance parity by construction:** generation runs as the same managed Editor-Agent via the operation-issue handoff (budget caps / pause / audit) — no direct-HTTP LLM call; the circuit breaker + `EDITOR_AGENT_ID_TAG` audit field apply.
- **Split-identity / NO_UUID_LEAK:** display strings scrubbed; UUIDs (`source_issue_id`) are key/dispatch-only, never rendered — mirrors `BlockerChainResult` D-15.

### Integration Points
- **Consumes** the Phase 11 verdict (`blockerChain.{needsYou, awaitedPartyLabel, targetIssueUuid, actionAffordance}`) + the Phase 12 per-leaf ranked `needsYouRows` from `build-employees-rollup.ts` — read-only.
- **New** `plugin_clarity_pack_cdd6bda4bd.action_cards` table (`migrations/0015_action_cards.sql`) + `action-cards-repo.ts` + `action-cards.ts` (the step) + `ActionCard` type in `types.ts` + `'action-cards'` `OperationKind`.
- **Wires** generation into `situation-room.ts` (the 60s recompute handler) + `editor.ts` heartbeat; **renders** minimally on `employee-row.tsx` (the existing Needs-you row), degrading to the deterministic line.
- **Touches NO** `blocker-chain.ts` logic (read-only import only), NO public.* table, NO new cron loop.
</code_context>

<deferred>
## Deferred Ideas

- **Reply-in-place + quick-decision chips that ACT (post to the agent + unblock+resume)** — **Phase 14** (DO-01/02/04/05). Phase 13 produces the `decisionOptions` + `actionKind` data; Phase 14 wires the Send / chip action loop using the Phase 10 unblock-resume recipe, across SR + Reader panel + org-blocked backlog.
- **Full Pulse header + Needs-you / In-motion / Watch tier IA + the rich card LAYOUT** — **Phase 15** (COCK-01/02). Phase 13's inline render is deliberately minimal; the redesigned card visual + the "unblocks → impact / running total" prose (building on Phase 12 leverage) land there.
- **Heartbeat-path generation as a hard requirement** — the view-driven SR handler is the must-have (D-06); shipping the `handleEditorHeartbeat` secondary trigger this phase vs deferring it to a follow-up is planner discretion (parity-nice-to-have).
- **Numeric grounded time estimates** — rejected as false precision (D-09); revisit only if a real grounded signal (e.g. an issue-level SLA field) appears in the host model.
- **Reworking the Bulletin "Requires Your Decision" inbox to share the action-card mechanism** — out of scope (REQUIREMENTS.md Out-of-Scope: the bulletin decision inbox is a separate surface with its own loop).

### Reviewed Todos (not folded)
None — no todo matches surfaced for Phase 13.
</deferred>

---

*Phase: 13-editor-agent-named-action*
*Context gathered: 2026-06-02*
