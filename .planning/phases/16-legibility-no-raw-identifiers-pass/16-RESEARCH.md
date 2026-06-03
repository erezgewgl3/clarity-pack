# Phase 16: Legibility / No-Raw-Identifiers Pass - Research

**Researched:** 2026-06-03
**Domain:** Codebase legibility pass — render-layer + scrub-layer identifier hygiene across the blocker-chain verdict pipeline (Reader, Situation Room, Bulletin, Chat)
**Confidence:** HIGH (all findings are codebase grep/read with exact file:line anchors; no external library research needed)

## Summary

Phase 16 is a **codebase surgery phase**, not a greenfield build. Every requirement maps to an
existing, identified line of code. The blocker-chain verdict pipeline already has a clean
"one verdict everywhere" architecture (Phase 11 + v1.4.2 / commit d736aef): a single pure engine
(`src/shared/blocker-chain.ts`) produces a `Terminal` + `BlockerChainResult`, a single scrub
helper (`src/shared/scrub-human-action.ts`) is the NO_UUID_LEAK chokepoint, and three worker
producers (`flatten-blocker-chain.ts` for the Reader, `build-employees-rollup.ts` +
`org-blocked-backlog.ts` for the Situation Room) all route through them. The legibility defects
are at **two precise points**:

1. **The scrub's own fallback is the leak.** `scrubHumanAction` replaces an unresolved UUID with
   the string `` `agent#${uuid.slice(0, 8)}` `` (6 sites in `scrub-human-action.ts`). That is
   literally the `agent#04fcac7c` seen live on BEAAA-972. It was *designed* as the safety net
   ("never the raw UUID") but LEG-01/LEG-02 now reclassify it as a defect: a partial hash is still
   a machine token. **Every current NO_UUID_LEAK test asserts `agent#<8>` is a VALID output**
   (e.g. `scrub-human-action.test.mjs:94` `assert.match(stuck, /agent#eeeeeeee/)`). This is the
   central tension the planner must resolve — see Pitfall 1.

2. **The Reader renders the raw enum kind as a heading.** `live-blocker-panel.tsx:287` renders
   `` `{terminal.kind.replace(/_/g, ' ')}` `` → `AWAITING AGENT STUCK`. That is LEG-03's exact
   defect. The Situation Room never does this — it renders `"<leaf> — agent stuck"` plain English
   (`employee-row.tsx:482`). So LEG-05 (parity) is fundamentally about making the **Reader** read
   like the **Situation Room**, not the reverse.

**Primary recommendation:** Fix LEG-01/LEG-02 at the scrub layer (replace the `agent#<8>` fallback
with a plain-English fallback like "an agent" / "an unnamed agent", and tighten the guard regex +
tests). Fix LEG-03 by deleting the `terminal.kind.replace(/_/g,' ')` render and using the existing
`blockerLine()` plain-English mapper as the headline. LEG-04 enriches `focusLine` in
`build-employees-rollup.ts:344-350` via the existing `getTldrByScope(ctx,'issue',issueId)`. LEG-05
is satisfied by-construction once LEG-01/03 land at the shared layer — but requires a cross-surface
wording test. **Do NOT touch `blocker-chain.ts`** (pure engine, AI-token grep guard).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UUID→human-name resolution + scrub | API / Worker (`scrub-human-action.ts` + each producer's `ctx.agents.get` map) | — | The engine is pure (no I/O); name resolution requires host fetch, so it lives in the worker producers, and the final string-scrub is the shared helper. |
| Terminal-kind → plain-English headline | Browser / UI (`live-blocker-panel.tsx blockerLine()`, `employee-row.tsx`) | — | The kind→sentence mapping is a presentation concern; both surfaces already own a (divergent) version. LEG-03/05 consolidate the wording. |
| focusLine TL;DR enrichment | API / Worker (`build-employees-rollup.ts`) | DB (`tldr_cache` read) | The rollup builder already polishes the title; reading the cache is a worker DB read, not a UI fetch. |
| NO_UUID_LEAK regression guard | Test tier (`test/shared/*`, `test/ui/surfaces/**/*no-uuid-leak*`) | — | Guards are source-grep + behavioral string-render tests (no jsdom); they must be extended, not the runtime. |

## Standard Stack

No new libraries. This phase edits existing TypeScript/TSX. Stack is locked by the plugin contract
(React 19 externalized, TS ^5.7.3, esbuild, ESM). `[CITED: CLAUDE.md Technology Stack]`

**No package installation. No Package Legitimacy Audit needed** (zero external packages added).

## Phase Requirements

| ID | Description | Research Support (file:line) |
|----|-------------|------------------------------|
| LEG-01 | No raw/partial agent ids, bare UUIDs, or machine tokens render as text on ANY surface | `scrub-human-action.ts:65,66,71,78,86` (the `agent#<8>` partial-hash fallback — the root cause); chat id-fragment slices `chat/index.tsx:764`, `message-thread.tsx:1121`, `topic-strip.tsx:82` (in-scope decision needed) |
| LEG-02 | Extend NO_UUID_LEAK guard to FAIL on partial-hash labels + short hex fragments + named test | Guard regex lives in `scrub-human-action.ts:22-23` (`UUID_RE_G`/`UUID_RE` — full UUID only); tests at `test/shared/scrub-human-action.test.mjs`, `test/shared/blocker-chain.test.mjs`, `test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs`, `pulse-header-no-uuid-leak.test.mjs`, `_shared/reply-in-place-no-uuid-leak.test.mjs`, `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` |
| LEG-03 | Verdict/terminal lines render as plain-English — no enum tokens | `live-blocker-panel.tsx:287` (`terminal.kind.replace(/_/g,' ')` → `AWAITING AGENT STUCK`) is THE defect; the fix already exists alongside it as `blockerLine()` (`live-blocker-panel.tsx:83-113`) |
| LEG-04 | focusLine enriched from TL;DR cache, falling back to polished issue title | `build-employees-rollup.ts:344-350` (currently `polishTldr(focusIssue.title)` only); read shape `getTldrByScope(ctx,'issue',issueId)` at `tldr-cache.ts:97-111` |
| LEG-05 | Same blocked item, same plain-English verdict wording across Reader + Situation Room | Reader wording `live-blocker-panel.tsx:83-113` + `:287`; SR wording `employee-row.tsx:374-386,476-488`; both read the SAME shared producer chain — see "Shared verdict source" below |

## Architecture Patterns

### The verdict pipeline (data flow)

```
                       ┌─────────────────────────────────────────────┐
                       │  src/shared/blocker-chain.ts  (PURE ENGINE)  │
                       │  flattenBlockerChain → Terminal (8 kinds)    │
                       │  classifyVerdict → {tier,affordance,needsYou}│
                       │  awaitedPartyLabel = terminal.label (RAW,    │
                       │  embeds UUIDs — engine does NO I/O lookup)   │
                       │  ⚠ DO NOT EDIT — AI-token grep guard         │
                       └───────────────┬─────────────────────────────┘
                                       │ raw BlockerChainResult
        ┌──────────────────────────────┼───────────────────────────────┐
        ▼ READER path                  ▼ SITUATION ROOM path            ▼ SR ORG-BACKLOG
  flatten-blocker-chain.ts       build-employees-rollup.ts        org-blocked-backlog.ts
  walkBlockerChain (BFS)         buildEdges (imported from         buildEdges (own) +
  + scrubResultLabel             org-blocked-backlog) +            flattenBlockerChain +
  → scrubHumanAction             flattenBlockerChain +             scrubHumanAction
        │                        scrubHumanAction                       │
        │                              │                                │
        ▼                              ▼                                ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  src/shared/scrub-human-action.ts  (NO_UUID_LEAK CHOKEPOINT)          │
  │  scrubHumanAction(terminal, viewer, nameByUuid) → string              │
  │  ⚠ fallback `agent#${uuid.slice(0,8)}` IS the LEG-01/02 leak          │
  └──────────────────────────────────────────────────────────────────────┘
        │ scrubbed awaitedPartyLabel                  │ scrubbed humanAction/awaitedPartyLabel
        ▼ UI                                          ▼ UI
  live-blocker-panel.tsx                        employee-row.tsx
  :287 terminal.kind.replace(/_/g,' ')  ← LEG-03  :482 "<leaf> — agent stuck" (already plain)
  :83-113 blockerLine() (plain English)           :374-386 "waiting on <party>" (already plain)
```

A reader can trace BEAAA-972: blocked agent-owned issue → both paths attach root meta
(`flatten-blocker-chain.ts:311-361` / `build-employees-rollup.ts:362-404`) → engine returns
`AWAITING_AGENT_STUCK` with label `"<agentUuid> stuck on BEAAA-972"` → scrub resolves the agentUuid,
or (name lookup fails) falls back to `agent#04fcac7c` → Reader prints heading `AWAITING AGENT STUCK`
+ body `agent#04fcac7c is stuck`. Two defects, one line of live output.

### Pattern 1: Plain-English terminal-kind headline (LEG-03)
**What:** Map each of the 8 `Terminal['kind']` discriminants to a sentence, never render the enum.
**When:** Reader headline (`live-blocker-panel.tsx:287`).
**The fix is already half-written** — `blockerLine()` (`live-blocker-panel.tsx:83-113`) is the
total-function-over-the-union the panel already uses for the body `<p>`. The `:287` heading is the
only place the raw kind leaks. Either delete the `<span className="clarity-blocker-kind">` branch or
replace its content with a plain-English category label (a new `kindHeadline()` mirror of
`blockerLine`). Keep the exhaustive `switch` + `never` guard idiom (used in `classifyVerdict`,
`blockerLine`, `primaryActionLabel`).
```typescript
// Source: src/ui/surfaces/reader/live-blocker-panel.tsx:287 (THE DEFECT)
<span className="clarity-blocker-kind">{terminal.kind.replace(/_/g, ' ')}</span>
// Fix: render a plain-English category, e.g. via a kindHeadline(terminal.kind) switch
// returning "Waiting on an agent" / "Blocked — needs an owner" / "Resolving on its own" / etc.
```

### Pattern 2: Plain-English scrub fallback (LEG-01/LEG-02)
**What:** When a UUID does not resolve to a name, emit a human noun ("an agent", "an unnamed
teammate"), NOT `agent#<8hex>`.
**When:** All 6 fallback sites in `scrub-human-action.ts`.
**Tradeoff the planner must lock:** `agent#<8>` carried *disambiguating* information (two unnamed
agents were distinguishable). A plain "an agent" loses that. For v1.5.0's legibility goal this is
acceptable (a non-builder cannot use a hex fragment anyway), but it is a product decision — flag in
discuss-phase. `[ASSUMED]` that "an agent" is the desired replacement wording.

### Pattern 3: TL;DR-cache focusLine enrichment (LEG-04)
**What:** Prefer the cached plain-English TL;DR over the polished title for the SR focus line.
**Where:** `build-employees-rollup.ts:344-350`.
```typescript
// Source: src/worker/situation/build-employees-rollup.ts:344-350 (CURRENT — title only)
if (state !== 'idle' && state !== 'stale') {
  const rawFocus = focusIssue?.title ?? '';
  const polished = polishTldr(rawFocus);
  focusLine = polished.length > 80 ? `${polished.slice(0, 77)}…` : polished || null;
}
// LEG-04: read getTldrByScope(ctx, 'issue', focusIssue.id) first; on a hit use tldr.body
// (truncate ≤80), else fall back to the existing polishTldr(title) path. The cache read shape:
//   getTldrByScope(ctx, surface, scopeId): Promise<TldrRow | null>   (tldr-cache.ts:97)
//   TldrRow.body is the plain-text summary (tldr-cache.ts:33)
```
**Landmine:** the builder runs per-agent inside `Promise.all` (degrade-safe try/catch). A new DB
read per row adds N reads to the snapshot — and PROJECT.md notes the cold snapshot is already
**25.7s, ~4s from the 30s cliff** (PERF-01 is a *later* phase). Keep the read cheap: one
`getTldrByScope` per focus issue, wrapped so a throw degrades silently to the title path
(never blanks, never stalls the snapshot). Consider batching if it measurably regresses cold time.

### Pattern 4: Cross-surface wording parity test (LEG-05)
**What:** A single blocked-item fixture must produce the same plain-English verdict noun in both the
Reader `blockerLine`/headline and the SR `employee-row` chain line.
**Why by-construction-ish:** Both surfaces already consume the SAME scrubbed `awaitedPartyLabel`
from the SAME engine verdict (the v1.4.2 SC5 fix, commit d736aef, unified the *verdict*). What
diverges today is the *surface wording template* around it: Reader `"<label> is stuck"` +
`AWAITING_AGENT_STUCK` heading vs SR `"<leaf> — agent stuck"`. LEG-05 means picking ONE phrasing and
using it on both. The cleanest single-location fix is a shared `verdictWording(terminal.kind)` (or
extend the existing `blockerLine`) that BOTH `live-blocker-panel.tsx` and `employee-row.tsx` import,
so the phrasing lives in one file. There is currently NO shared UI wording helper — see Open
Question 2.

### Anti-Patterns to Avoid
- **Editing `src/shared/blocker-chain.ts` to "fix the label."** The engine label is raw by design
  (it has no name map). `test/shared/blocker-chain.test.mjs:408-415` greps the source for AI tokens
  AND the determinism test runs it 100×. Adding name-resolution or I/O there breaks both. Scrub at
  the producer/UI layer only.
- **Loosening the UUID regex to also strip `agent#xxxxxxxx` at runtime without updating the noun.**
  If you regex-replace `agent#<8>` with empty, you get `" is stuck"`. The fallback must become a
  noun, not a deletion.
- **Adding a per-row TL;DR fetch without a degrade wrapper** (snapshot-time + cliff risk).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID→name resolution | A new resolver | The existing `ctx.agents.get` + `nameByUuid` map pattern in each producer (`flatten-blocker-chain.ts:189-226`, `org-blocked-backlog.ts:462-503`, `build-employees-rollup.ts:415-430`) | Three producers already do this identically with degrade-to-null; reuse it. |
| Terminal-kind → sentence | A new mapper in the panel | Extend/relocate the existing `blockerLine()` switch (`live-blocker-panel.tsx:83-113`) | It is already an exhaustive total function over all 8 kinds with the `never` guard. |
| Scrub before render | A per-surface scrub | The shared `scrubHumanAction` (`scrub-human-action.ts`) | Single source of truth since Phase 8; fix once, all three surfaces inherit it. |
| BFS edge build | A new walker | The shared `buildEdges` (`org-blocked-backlog.ts:270`, imported by the rollup) | SC5 "two builders agree" depends on one shape. |

**Key insight:** The hard architectural work (one engine, one scrub, one verdict) is DONE. Phase 16
is a precision edit at the leak/render boundary, not a re-architecture. The biggest risk is
breaking the existing guards that *currently bless* the `agent#<8>` output.

## Common Pitfalls

### Pitfall 1: The existing NO_UUID_LEAK tests assert `agent#<8>` is VALID — they will fight LEG-02
**What goes wrong:** You tighten the scrub to forbid partial hashes, and a dozen existing tests that
assert `agent#eeeeeeee` / `agent#dddddddd` / `agent#12345678` is the *correct* output go red.
**Why it happens:** `agent#<8>` was the Phase-8 NO_UUID_LEAK *guarantee* (the thing that proved no
raw UUID leaked). LEG-02 inverts that contract.
**Where (must all be updated):**
- `test/shared/scrub-human-action.test.mjs:94,123,144` (`/agent#eeeeeeee/`, `/agent#dddddddd/`, `/agent#12345678/`)
- `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs:121` (`includes('agent#')`)
- the scrub doc-comments `scrub-human-action.ts:34,42,44` ("NEVER the raw UUID" → must become "NEVER a raw UUID *or partial hash*")
**How to avoid:** Treat the test rewrite as a first-class task. The new contract: scrub output must
match NEITHER `UUID_RE` NOR a new `PARTIAL_HEX_RE` (e.g. `/\bagent#[0-9a-f]{6,}\b/i` and/or a bare
`/\b[0-9a-f]{8,}\b/` short-hex catch). Add the new regex to `scrub-human-action.ts` and the named
regression test LEG-02 requires.
**Warning sign:** a green suite after only changing runtime code means you didn't update the guards.

### Pitfall 2: The snapshot cliff (LEG-04 perf)
**What goes wrong:** Adding a `getTldrByScope` read per employee row pushes the 25.7s cold snapshot
over the 30s host timeout → 502s.
**Why:** The rollup is the hot path; PERF-01 (off-request recompute) is a LATER phase (18), so the
snapshot is still synchronous in Phase 16.
**How to avoid:** Wrap the cache read in the existing per-row try/catch; only read for the single
focus issue (not all open issues); measure cold time before/after on BEAAA; if it regresses, batch
the reads or defer LEG-04's read to the (later) off-request path. Degrade-safe: a miss/throw → the
existing `polishTldr(title)` line.

### Pitfall 3: Short-hex false positives in a tightened guard
**What goes wrong:** A bare `/[0-9a-f]{8,}/` short-hex guard flags legitimate content — a git SHA in
a title, "deadbeef" in prose, a hex color, the `BEAAA` company prefix is NOT hex but other tokens
might be.
**Why:** LEG-02 says "short hex id fragments" but text legitimately contains hex.
**How to avoid:** Anchor the partial-hash guard to the *agent#* prefix and to the engine's known
fragment shape (8 hex), not a blanket short-hex scan of arbitrary text. Scope the render-scan to the
*verdict/awaited-party strings*, not the whole DOM. `[ASSUMED]` the intended target is specifically
`agent#<hex>` + bare UUIDs, not all hex-looking substrings.

### Pitfall 4: Chat id-fragment chips are out of the verdict pipeline
**What goes wrong:** You assume the LEG-01 fix at the scrub layer covers all surfaces, but the chat
surface slices ids independently: `chat/topic-strip.tsx:82` (`id.slice(0,8).toUpperCase()` →
`CHT-04FCAC7C`), `chat/message-thread.tsx:1121` (`run · <runId 8>`), `chat/index.tsx:764`
(`issueId.slice(0,8)`). These are issue/run/topic ids rendered as deliberate short labels, NOT
agent-identifier leaks, and they never pass through `scrubHumanAction`.
**How to avoid:** Decide explicitly whether these in-scope for LEG-01 ("machine tokens on ANY
surface") or out (they're intentional CHT-/run- chip labels for a builder-adjacent chat UI). See
Open Question 1. The Reader/SR/Bulletin verdict leak is the live-observed defect; chat chips are a
judgment call.

## Code Examples

### The exact leak source (LEG-01/02)
```typescript
// Source: src/shared/scrub-human-action.ts:71,86 (verbatim)
let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
// ...
return label.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);  // ← agent#04fcac7c
```

### The exact enum-leak source (LEG-03)
```typescript
// Source: src/ui/surfaces/reader/live-blocker-panel.tsx:287 (verbatim)
<span className="clarity-blocker-kind">{terminal.kind.replace(/_/g, ' ')}</span>
// → "AWAITING AGENT STUCK"
```

### The plain-English mapper already present (the LEG-03/05 fix material)
```typescript
// Source: src/ui/surfaces/reader/live-blocker-panel.tsx:90-91 (verbatim)
case 'AWAITING_AGENT_STUCK':
  return `${data.awaitedPartyLabel} is stuck`;
```

### The SR's already-plain wording (the LEG-05 target phrasing)
```typescript
// Source: src/ui/surfaces/situation-room/employee-row.tsx:482 (verbatim)
? `${chain.leafIssueId ?? 'this issue'} — agent stuck`
```

## Project Constraints (from CLAUDE.md)

- **`blocker-chain.ts` is a PURE deterministic engine** — determinism test (100×) + AI-token grep
  guard (`test/shared/blocker-chain.test.mjs:408-415`, bans `openai|anthropic|claude_local|llm|gpt|completion`).
  Do NOT add I/O, name-resolution, or AI tokens. Scrub/render fixes live OUTSIDE it.
- **NO_UUID_LEAK:** UUIDs (and now partial hashes) never render; mutations carry the UUID,
  display stays human. `targetAgentUuid`/`targetIssueUuid`/`leafIssueUuid` are dispatch-only.
- **Additive-only plugin-namespace schema; instance-agnostic** (no `BEAAA`/`COU` literals — the
  pulse-header guard already enforces this, `pulse-header-no-uuid-leak.test.mjs:37`); degrade-safe
  (deterministic floor, no AI dependency in the legibility path).
- **React 19 externalized, TS ^5.7.3, esbuild, scoped CSS under `[data-clarity-surface]`,
  bundle-size CI gate.** No new runtime deps.
- **Visual contract:** match `sketches/` mockups. `Skill("sketch-findings-clarity-pack")` carries
  CSS/visual direction — relevant if the LEG-03 headline gets a new visible label/style. Check it
  before restyling the `clarity-blocker-kind` element.
- **Bookended-by-snapshots:** any BEAAA deploy/drill bookended by DO droplet backup (autonomous
  deploy authorized per MEMORY).

## Runtime State Inventory

This is a **code-only legibility pass** — no rename, no schema change, no data migration.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the `agent#<8>` string is computed at render/scrub time, NOT persisted. `tldr_cache.body` is plain text already. Verified by reading `tldr-cache.ts` (no agent-id-fragment column) + `scrub-human-action.ts` (pure function). | None |
| Live service config | None — no external service holds these strings. | None |
| OS-registered state | None. | None |
| Secrets/env vars | None. | None |
| Build artifacts | None — TS/TSX edits rebuilt by esbuild; bundle-size CI gate applies. | Normal rebuild |

**Caveat:** if a prior snapshot/bulletin persisted a scrubbed `agent#<8>` string into
`tldr_cache.body` or a published bulletin body (possible — `compile-tldr`/bulletin write plain
text), those historical rows are NOT retroactively cleaned by a render-layer fix. **Verify whether
any persisted `tldr_cache.body` / bulletin body contains `agent#`** (a single SQL `LIKE '%agent#%'`
scan on BEAAA during the drill). Likely empty (the leak was in the live blocker panel, which reads
fresh, not the cache), but worth a one-line check. Flagged in Open Question 3.

## Common Pitfalls — Guard File Inventory (LEG-02 work surface)

Every file that currently encodes the NO_UUID_LEAK contract (all must be reviewed when the contract
tightens to forbid partial hashes):

| File | Role | Current contract |
|------|------|------------------|
| `src/shared/scrub-human-action.ts:22-23` | The regexes | `UUID_RE`/`UUID_RE_G` = full UUID only |
| `test/shared/scrub-human-action.test.mjs` | Unit guard | asserts `agent#<8>` is VALID (lines 94,123,144) — **must flip** |
| `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` | Reader-path guard | asserts `includes('agent#')` (line 121) — **must flip** |
| `test/shared/blocker-chain.test.mjs` | Engine determinism + AI-token grep | unaffected by scrub change; do not touch engine |
| `test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs` | SR render-scan | full-UUID regex only — extend to partial-hash |
| `test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs` | Pulse render-scan | full-UUID + prefix-literal — extend |
| `test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs` | Reply primitive render-scan | full-UUID — extend |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw UUID in awaited-party text | `agent#<8>` fallback as the "safe" form | Phase 7-8 (NO_UUID_LEAK) | This is now the LEG-01/02 defect — the safe form is no longer safe enough |
| Per-surface verdict re-derivation | One engine verdict (`classifyVerdict`) every surface reads | Phase 11 + v1.4.2 (commit d736aef) | LEG-05 inherits a unified verdict; only surface *wording* still diverges |
| focusLine = polished issue title | (unchanged — LEG-04 changes it) | v1.2.0 (Phase 8), tldr-cache lookup deferred | LEG-04 finally wires the deferred cache read |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The desired plain-English replacement for `agent#<8>` is a generic noun like "an agent" | Pattern 2 | Loses disambiguation between two unnamed agents; if the operator needs to tell them apart, a different scheme (role-based, ordinal) is needed — confirm in discuss-phase |
| A2 | "short hex id fragments" in LEG-02 targets `agent#<hex>` + bare UUIDs, not all hex substrings | Pitfall 3 | An over-broad guard regex flags git SHAs / hex colors / legit content and fails the build on innocent text |
| A3 | Chat id-fragment chips (`CHT-<8>`, `run · <8>`) are out of LEG-01 scope (intentional labels, not agent-id leaks) | Pitfall 4 / OQ1 | If in-scope, the chat surface needs its own non-pipeline fix (3 extra sites) |
| A4 | No persisted row (tldr_cache.body / bulletin body) contains a stored `agent#<8>` string | Runtime State Inventory / OQ3 | A render-only fix leaves stale persisted partial-hashes visible on cached surfaces |
| A5 | LEG-05 parity is best served by Reader adopting the SR's plain phrasing via a shared wording helper | Pattern 4 / OQ2 | If a NEW shared helper is over-engineered, two small in-place edits may be simpler — planner's call |

## Open Questions

1. **Are chat id-fragment chips (`CHT-04FCAC7C`, `run · 04fcac7c`, issueId.slice(0,8)) in LEG-01
   scope?**
   - What we know: They render hex fragments as deliberate short labels; they bypass `scrubHumanAction`; they are issue/run/topic ids, not agent ids.
   - What's unclear: LEG-01 says "machine tokens … on ANY surface (… Chat)" — literally yes; intent-wise these are UX labels in a builder-facing chat, not the rabbit-hole defect.
   - Recommendation: Surface to discuss-phase. Default OUT (they're not agent identifiers and not the live-observed defect), but cheap to include if Eric wants zero hex anywhere.

2. **One shared wording helper, or two in-place edits, for LEG-05?**
   - What we know: Reader and SR each own a divergent kind→sentence template; there is no shared UI wording module today.
   - What's unclear: Whether a `src/shared/verdict-wording.ts` (UI-importable) is worth the indirection vs. just making the Reader headline read like the SR line in place.
   - Recommendation: Prefer a small shared helper (single source = LEG-05 "lands in ONE place") but keep it pure-string + tested; don't over-build.

3. **Does any persisted body contain a stored `agent#<8>`?**
   - What we know: The live leak was in the fresh-render blocker panel; tldr_cache/bulletin bodies are plain text written by compile paths.
   - Recommendation: One `SELECT ... WHERE body LIKE '%agent#%'` scan on BEAAA during the drill. If non-empty, add a data note (render-fix won't clean history).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥20 + esbuild | TS/TSX build | ✓ (project standard) | per CLAUDE.md pins | — |
| `node:test` runner | LEG-02 regression tests | ✓ (all existing guards use it) | built-in | — |
| BEAAA live instance | LEG-04 cold-snapshot timing + persisted-string scan + live drill | ✓ (DO droplet, autonomous deploy authorized) | v1.4.2 | local build verify if box unreachable |

No external dependencies missing. No fallbacks needed for code work.

## Sources

### Primary (HIGH confidence — codebase reads, this session)
- `src/shared/blocker-chain.ts` (pure engine, 8-kind taxonomy, classifyVerdict) — full read
- `src/shared/scrub-human-action.ts` (NO_UUID_LEAK chokepoint, the `agent#<8>` fallback) — full read
- `src/shared/types.ts` (Terminal union, BlockerChainResult) — full read
- `src/worker/handlers/flatten-blocker-chain.ts` (Reader producer + scrubResultLabel + walkBlockerChain) — full read
- `src/worker/handlers/org-blocked-backlog.ts` (SR org-backlog producer + buildEdges) — full read
- `src/worker/situation/build-employees-rollup.ts` (SR rollup producer + focusLine:344-350) — full read
- `src/worker/db/tldr-cache.ts` (getTldrByScope read shape) — full read
- `src/ui/surfaces/reader/live-blocker-panel.tsx` (`:287` enum leak, `:83-113` blockerLine) — full read
- `src/ui/surfaces/situation-room/employee-row.tsx` (`:482`/`:374-386` SR plain wording) — full read
- `test/shared/scrub-human-action.test.mjs`, `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs`, `test/ui/surfaces/situation-room/{employee-row,pulse-header}-no-uuid-leak.test.mjs`, `test/shared/blocker-chain.test.mjs` — full/targeted reads
- `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `CLAUDE.md` — full reads

### Secondary
- Grep sweeps for `agent#`, `.slice(0,8)`, `terminal.kind`, `NO_UUID_LEAK` across `src/` and `test/`

## Metadata

**Confidence breakdown:**
- LEG-01/02 leak source: HIGH — exact lines (`scrub-human-action.ts:71,86`) verified by read.
- LEG-03 enum-leak source: HIGH — `live-blocker-panel.tsx:287` verified by read.
- LEG-04 focusLine + cache shape: HIGH — `build-employees-rollup.ts:344-350` + `tldr-cache.ts:97` verified.
- LEG-05 shared producer: HIGH — pipeline traced end-to-end; wording divergence localized.
- Product wording decisions (A1, A2, A3, A5): MEDIUM/ASSUMED — need discuss-phase confirmation.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable internal codebase; re-verify line numbers if intervening commits touch the named files)
