# Phase 16: Legibility / No-Raw-Identifiers Pass — Context

**Gathered:** 2026-06-03
**Status:** Ready for planning
**Source:** Operator decisions on the 5 research open questions (A1–A5) + live BEAAA anchor.

<domain>
## Phase Boundary

Make every Clarity surface legible to a non-builder: no raw or partial agent identifiers, no bare UUIDs, no machine/enum tokens surfaced as user-visible text — across Reader, Situation Room, Bulletin, AND Chat. Verdict/terminal lines read as plain-English sentences; the Situation Room focus line is enriched from the TL;DR cache; the same blocked item reads with the same plain-English wording on Reader and Situation Room.

This is **codebase surgery at identified boundaries**, not a redesign — the visual mockup contract is unchanged. The verdict pipeline already has a clean "one engine → one scrub → one verdict" architecture (Phase 11 + v1.4.2); the fixes land at the scrub fallback, the Reader enum→text render, the focusLine builder, and a shared wording helper.

Covers requirements: **LEG-01, LEG-02, LEG-03, LEG-04, LEG-05** (see .planning/REQUIREMENTS.md).
</domain>

<decisions>
## Implementation Decisions (locked)

### A1 — Unresolvable-agent fallback copy → "an agent"
When an agent id cannot resolve to a human name/role, render the literal lowercase **"an agent"** (sentence-fit) — NEVER a partial hash or any id. The fix must first wire in the SAME agent name-resolution path the Situation Room employee rows already use, so the COMMON case shows the real human name/role; **"an agent"** is the last-resort fallback only. The live defect `agent#04fcac7c` (Reader stuck-terminal) must read e.g. "the CEO's agent" (resolved) or "an agent" (unresolved) — never the hash.

### A2 — Guard regex scope → anchored, not over-broad
Extend the NO_UUID_LEAK render-scan guard to FAIL on `agent#<hex>` partial-hash labels and bare UUIDs. Anchor the new pattern to `agent#<hex{6,}>` and the existing UUID shape — do NOT add a blanket "any short hex" rule that would false-positive on git SHAs or legitimate hex content (Pitfall: over-broad short-hex regex).

### A3 — Chat id-fragment chips → IN SCOPE (humanize them)
`CHT-<8>` topic-id chips and `run·<8>` run-id fragments in the **Chat surface** ARE in scope for this phase. Replace them with human-readable labels (e.g. the topic title / a friendly run reference) so the Chat surface carries no raw id fragments. This widens Phase 16 to touch the chat surface — plan a dedicated task for it. (These bypass the verdict scrub pipeline, so they need their own humanization at the chat render layer.)

### A4 — Render-time scrub is authoritative; persisted strings best-effort
The render-time scrub + extended guard is the authoritative fix (display never leaks). ALSO check for already-persisted leaked strings (e.g. `tldr_cache` rows, focus summaries) that captured `agent#<8>` before the fix; remediate if cheap/additive (re-scrub on read is preferred over a destructive migration). Do not add a non-additive migration.

### A5 — LEG-05 wording parity via a SHARED helper
The plain-English verdict/terminal WORDING must come from ONE shared helper consumed by BOTH the Reader blocker panel and the Situation Room rows — not two divergent maps. The Reader currently renders the raw enum (`terminal.kind.replace(/_/g,' ')` → "AWAITING AGENT STUCK"); it must read like the Situation Room ("agent stuck"). Land the wording in the shared producer/helper layer so Reader + SR stay in lockstep by construction.

### Claude's Discretion
- Exact shared-helper location/signature (reuse the existing `blockerLine()` switch at `reader/live-blocker-panel.tsx:83-113` as the wording source if it's the cleanest single home).
- Whether the focusLine tldr-cache read is per-row inline or batched — but it MUST be degrade-wrapped (a thrown/missing cache read falls back to the polished title; never blocks the row) and must not materially worsen the 25.7s cold-snapshot time (PERF-01/off-request is Phase 18, NOT here).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — LEG-01..05 verbatim + carried invariants.
- `.planning/ROADMAP.md` — Phase 16 section + success criteria.

### Research (this phase) — has all file:line anchors
- `.planning/phases/16-legibility-no-raw-identifiers-pass/16-RESEARCH.md`

### Code anchors (from research, HIGH confidence)
- `src/shared/scrub-human-action.ts` — the `agent#${uuid.slice(0,8)}` fallback at ~:71,86 (LEG-01 root cause); regexes ~:22-23 (LEG-02).
- `test/shared/scrub-human-action.test.mjs` (~:94,123,144) + `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` (~:121) — tests that currently BLESS `agent#<8>` and MUST be inverted.
- `src/ui/surfaces/reader/live-blocker-panel.tsx` — enum→heading defect at ~:287; plain-English `blockerLine()` switch at ~:83-113 (LEG-03/LEG-05).
- `src/ui/surfaces/situation-room/employee-row.tsx` (~:374-386,476-488) — SR verdict wording (LEG-05 parity target).
- `src/worker/situation/build-employees-rollup.ts` (~:344-350) — focusLine title-only (LEG-04).
- `src/worker/db/tldr-cache.ts` (~:97-111) — `getTldrByScope(ctx,'issue',issueId)` read shape (LEG-04).
- Shared producers: `src/worker/handlers/flatten-blocker-chain.ts`, `src/worker/situation/org-blocked-backlog.ts` → `src/shared/scrub-human-action.ts`.
- Chat chips: chat surface render layer (CHT-/run· fragments) — research to pinpoint exact file in pattern-mapping.

### Project guidance
- `./CLAUDE.md` — stack pins, scoped-CSS gate, conventions.
- `.claude/skills/sketch-findings-clarity-pack/` — visual/CSS direction (if the chat-chip humanization needs styling).
</canonical_refs>

<specifics>
## Specific Ideas

- **Live anchor (BEAAA, 2026-06-03):** Reader BEAAA-972 renders "AWAITING AGENT STUCK — CEO stuck on agent#04fcac7c is stuck — Assign owner". Target after fix: a plain sentence with the human agent name (or "an agent") and no enum heading, matching the Situation Room's "agent stuck" wording.
- LEG-02 named regression test must assert `agent#<8>` and bare UUIDs FAIL the guard (the inversion of today's tests).
</specifics>

<deferred>
## Deferred Ideas

- **Off-request / async snapshot recompute (PERF-01..03)** — Phase 18, flag-gated. Phase 16 must NOT regress the cold-snapshot time, but does NOT fix it.
- **Editor-Agent prose enrichment (PROSE-01..03)** — Phase 17.
- Non-additive migration to rewrite historical persisted strings — out of scope (re-scrub on read instead).
</deferred>

<scope_fence>
## Scope Fence

IN SCOPE: agent-id/UUID/partial-hash leak elimination at the scrub + render layers (all four surfaces); NO_UUID_LEAK guard extension + inverted tests; Reader enum→plain-English via shared wording helper; Reader/SR wording parity; focusLine from tldr_cache (degrade-wrapped); Chat CHT-/run· chip humanization.

OUT OF SCOPE: `blocker-chain.ts` edits (pure engine — determinism + AI-token guards); any AI/LLM in the deterministic path; non-additive schema; the snapshot perf re-arch (Phase 18); Editor-Agent prose (Phase 17); new visual design beyond text/label substitution.
</scope_fence>

---

*Phase: 16-legibility-no-raw-identifiers-pass*
*Context gathered: 2026-06-03 (operator decisions A1–A5 + 16-RESEARCH.md)*
