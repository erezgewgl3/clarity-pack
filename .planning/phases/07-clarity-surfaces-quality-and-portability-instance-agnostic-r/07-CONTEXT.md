# Phase 7: Clarity-surfaces quality + portability — Context

**Gathered:** 2026-05-28
**Status:** Ready for planning (prerequisite chunk only)
**Source:** MemPalace discuss drawers + this session's recon + Eric's locked decisions

<domain>
## Phase Boundary

Phase 7 makes the four Clarity Pack surfaces genuinely insightful and **fully instance-agnostic** (must work on any Paperclip instance, not just BEAAA). Five sequenced items (Eric's locked order of pain):

1. **[PREREQUISITE] Ref-resolution fix** — `BEAAA-NNN` cross-reference chips currently render `"BEAAA-807 · unknown"`. Resolve refs via the SDK instead of the SSRF-blocked HTTP path.
2. **[PORTABILITY] De-BEAAA worker ref extraction** + 2 hardcoded UI labels.
3. TL;DR cleanup (markdown render + tighter prompt + refs→titles).
4. Situation Room org-level blocked backlog.
5. Bulletin lineage filter + gloss + clickable.

**THIS PLANNING PASS COVERS ITEMS 1 + 2 ONLY** (the prerequisite chunk). Items 3–5 each have their own discuss gate per the locked "discuss-first" decision and will be planned in later passes. Item 1 is the prerequisite because the SDK ref-resolver it builds also unblocks item 3's TL;DR titles and is the portability fix.

**Hard host constraint:** On paperclipai@2026.525.0 (PR #6547) the scheduled-job + event-handler invocation scopes are DEAD for host calls. All agent-backed and host-reading work must run from valid HTTP-request scopes (data handlers + actions). The ref-resolution fix runs inside the `issue.reader` data handler and the `resolve-refs` data handler — both valid scopes.
</domain>

<decisions>
## Implementation Decisions (LOCKED — do not re-litigate)

### Resolution strategy
- Resolve each ref via **`ctx.issues.get(identifier, companyId)`** in parallel (`Promise.all`), **WITH a cached `ctx.issues.list({companyId})`-and-match-on-`.identifier` fallback** when `get` returns null.
- The fallback also de-risks the single highest-risk unknown: whether the host RPC `issues.get` accepts a human identifier (`'BEAAA-807'`) or only a UUID. SDK signature is `get(issueId, companyId)`; every existing call site passes a UUID; not determinable from types. The live Playwright drill + worker log doubles as the runtime probe for which path fires.
- The pure `resolveRefs()` helper (`src/shared/reference-resolver.ts`) stays UNCHANGED — the fetcher must return `id = the requested identifier` so `byId.get(ref)` hits (otherwise chips still say "unknown").
- Fix BOTH worker paths: the inline fetcher in `issue-reader.ts` AND the standalone `resolve-refs.ts` handler. They do not share code; fixing one leaves the other broken.

### Extraction strategy
- Derive the **EXACT prefix from the current issue's `identifier`** (e.g. `'COU-2486'` → `'COU'`) and narrow the regex to it.
- Broad fallback `/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g` ONLY when `issue.identifier` is null (nullable for plugin-op / fresh issues).
- Mirror the UI's already-portable `prose-with-ref-chips.tsx` pattern.
- **Do NOT** use the host's `extractIssueReferenceIdentifiers` helper or `referencedIssueIdentifiers` field — Eric chose exact-prefix to avoid broad-pattern false positives (e.g. `DAY-90`).

### Labels
- Surface `displayName` (already returned by `companies.resolve-prefix` at `companies-resolve.ts:55`, currently discarded by `useResolvedCompanyId`) into `roster-rail.tsx:105` and `chat/index.tsx:785`.
- Fallback to the URL prefix (`extractCompanyPrefixFromPathname`), NEVER a literal string.
- NOTE: the hook short-circuits on host-context `companyId` BEFORE `resolve-prefix` runs (`use-resolved-company-id.ts:74`) — name plumbing must handle that path; the URL-prefix fallback is acceptable there.

### Open item (resolve during the drill, not a planning blocker)
- The current code gates excerpts on `i._viewer_can_read`, which does NOT exist on the SDK `Issue` type. Confirm whether `ctx.issues.get` enforces viewer permissions server-side (returns null for unreadable) and gate accordingly.

### Process constraints
- **No version bump** — stay `1.0.0` (both `package.json` AND `src/manifest.ts`).
- **Additive-only** — NO migration needed for this chunk.
- **TDD-first.** Existing tests that codify the bugs (the `?ids=` URL + snake_case `key/assignee_user_id/body` mapping + the PRIM-01 "exactly one fetch" assertion) WILL flip red and must be rewritten — intended TDD churn, call it out.
- PRIM-01 "single round-trip" must be **redefined as "one fetcher invocation"** (the pure-resolver boundary), since per-ref `get()` is N calls.

### Claude's Discretion
- Whether to extract a shared `prefixFromIdentifier` helper vs inline derivation (both worker sites need it).
- Whether the `list`-fallback caches at module scope or per-invocation (per-invocation is safer for freshness).
- Exact test fixture identifiers (`COU-`/`ACME-` for the portability tests).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Worker resolution (the fix targets)
- `src/worker/handlers/issue-reader.ts` — REF_PATTERN (line 58), inline fetcher (lines 222-241), stale RawHostIssue (lines 102-109), the root `ctx.issues.get` call (line ~160).
- `src/worker/handlers/resolve-refs.ts` — standalone handler, same 3 bugs (lines 124-228), stale RawHostIssue (lines 38-45).
- `src/shared/reference-resolver.ts` — pure `resolveRefs()` (unchanged; the "unknown" placeholder is lines 38-53).
- `src/worker/agents/editor.ts` — `extractRefsFromBody` hardcoded regex (line 126); `readTldrInputs` (~288) re-extracts and may need the prefix threaded.

### UI (reference pattern + label sites)
- `src/ui/surfaces/reader/prose-with-ref-chips.tsx` — the already-portable extraction pattern to mirror.
- `src/ui/primitives/use-resolved-company-id.ts` — `extractCompanyPrefixFromPathname` + the hook that discards `displayName` (short-circuit at line 74).
- `src/ui/surfaces/chat/roster-rail.tsx:105` + `src/ui/surfaces/chat/index.tsx:785` — the two hardcoded "BEAAA" labels.
- `src/worker/handlers/companies-resolve.ts:55` — already returns `displayName`.
- `src/ui/primitives/ref-chip.tsx` — NO change needed (renders `card.id · card.status`).

### Test harness
- `test/worker/issue-reader.test.mjs` (+ `-integration` + `-degradation`), `test/worker/resolve-refs.test.mjs`, `test/shared/reference-resolver.test.mjs`.

### SDK ground truth
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — `get(issueId, companyId): Promise<Issue|null>`; `list(input)` has no ids/identifier filter.
- `@paperclipai/shared` Issue type — camelCase `identifier/title/status/assigneeUserId/description` (no `key`, no `body`).

### Deploy / verify
- `.planning/DEPLOY-RUNBOOK.md` — Path A to BEAAA.
- Recon source: workflow run `wf_ef5f2db9-be6` (full findings transcribed in 07-RESEARCH.md).
</canonical_refs>

<specifics>
## Specific Ideas

- The visible `"· unknown"` (vs empty chips) means the host responds but `i.key` is null → `byId` map keyed by null → requested identifier misses. Confirms the bug is the stale field mapping + ignored `?ids=`, and that `ctx.http.fetch` may not actually be throwing on this host (open question for the drill).
- `editor.ts:extractRefsFromBody` feeds `issue-reader.ts:196` (TL;DR `inputs.refs`) — so the portability fix touches the TL;DR input path even though TL;DR *rendering* is deferred to item 3.
</specifics>

<deferred>
## Deferred Ideas

- **Items 3–5** (TL;DR markdown/prompt/titles; Situation Room blocked backlog; bulletin lineage) — planned in later passes after their own discuss gates.
- The `_viewer_can_read` excerpt-gate replacement — settled empirically during the drill.
- Consuming the host's `referencedIssueIdentifiers` precompute — explicitly rejected for v1 (false-positive risk).
</deferred>

<scope_fence>
## Scope Fence

IN SCOPE (this plan): worker ref RESOLUTION (both paths) + worker ref EXTRACTION portability (both regexes) + 2 UI label swaps via existing `displayName`. No schema, no migration, no version bump.

OUT OF SCOPE (this plan): TL;DR rendering/prompt changes, Situation Room blocked backlog, bulletin lineage, any UI visual redesign, ref-chip/tldr-strip component changes.
</scope_fence>

---

# ITEM 3 — TL;DR cleanup (markdown render + tighter prompt + refs→titles)

**Discussed:** 2026-05-29 (fast discuss; items 1+2 CLOSED & VERIFIED LIVE on BEAAA first)
**Status:** Ready for planning (this is the NEXT plan — 07-02)

<domain>
## Phase Boundary (item 3)

Make the Editor-Agent's TL;DR — and the resolved reference excerpts — actually readable. Three sub-fixes: (a) render the markdown the agent emits instead of showing literal `## BLUF` / `**bold**` / `- bullets` / `[label](url)`; (b) tighten the compile prompt to a hard, founder-readable shape; (c) resolve `BEAAA-NNN` references in the TL;DR to their titles inline using the Phase 7-01 SDK resolver. **OUTPUT QUALITY ONLY** — the compile *trigger* (view-driven compile, paused-agent behaviour) is unchanged.

Builds directly on the 07-01 SDK ref-resolver (`resolveRefsViaSdk` + `prefixFromIdentifier`). Stay 1.0.0; additive-only; NO migration; NO new runtime deps; TDD-first.
</domain>

<decisions>
## Implementation Decisions (item 3 — LOCKED via fast discuss 2026-05-29)

### Markdown rendering
- **D-I3-01:** Render the TL;DR (and the Anchored-to excerpt) markdown with a **hand-rolled minimal safe renderer that emits React nodes — NEVER `dangerouslySetInnerHTML`.** Cover the markdown the Editor-Agent actually emits: headings (`##`/`###`), `**bold**`, `*italic*`, `-`/`*`/numbered bullets, `[label](url)` links, inline `` `code` ``, and paragraph breaks. No new runtime dep (constraint) — the renderer is plugin-local.

### Refs → titles display
- **D-I3-02:** In the TL;DR, resolve each `BEAAA-NNN` token to its title via the **existing 07-01 SDK resolver** (`resolveRefsViaSdk`; per-ref `ctx.issues.get` + cached `list` fallback) and render it as **ID + title together** — e.g. `BEAAA-704 — CSO review of updated strategy` — keeping the raw ID traceable. **Post-process the compiled body** (do NOT trust the agent to avoid raw IDs). Extraction is **prefix-derived / instance-agnostic** — reuse `prefixFromIdentifier` (no BEAAA hardcoding).

### Compile prompt
- **D-I3-03:** Tighten the compile prompt to a hard shape: **1–2 sentence headline + ≤3 bullets + a length cap**, voice = "for a busy founder: the decision / current state / next action." (Locked in the MemPalace bundle drawer; confirmed.)

### Scope
- **D-I3-04:** Item 3 covers BOTH the **TL;DR strip** AND the **"Anchored to (resolved)" ref-card excerpt** (same renderer applied to both — user saw raw `## BLUF …` in the excerpt live). The **inline prose ref chips (READER-03)** stay as-is (`ID · status` clickable link — already verified working in 07-01); item 3 does NOT change the inline-chip format.

### Claude's Discretion
- Exact renderer feature surface + the length-cap number; whether the markdown renderer lives in a shared util vs per-surface; whether refs→titles also applies inside the rendered excerpt body or only the TL;DR strip (planner's call, guided by D-I3-02).
</decisions>

<canonical_refs>
## Canonical References (item 3)

- `.planning/phases/07-clarity-surfaces-quality-and-portability-instance-agnostic-r/07-01-SUMMARY.md` — the shipped SDK resolver + `prefixFromIdentifier` this item reuses.
- `src/worker/handlers/sdk-ref-fetch.ts` — `resolveRefsViaSdk` (per-ref get + list fallback; echoes id = requested identifier).
- `src/worker/agents/editor.ts` — `prefixFromIdentifier`, `extractRefsFromBody`, and the TL;DR **compile prompt** (D-I3-03 target).
- `src/ui/surfaces/reader/` — the TL;DR strip component (`tldr-strip.tsx`) + the Anchored-to ref-card / deliverable components (D-I3-01/04 render targets); `prose-with-ref-chips.tsx` (the portable extraction pattern).
- MemPalace `clarity_pack/decisions` drawer `drawer_clarity_pack_decisions_af74a33adb4d28b47ae8894e` (the bundle findings) + `drawer_clarity_pack_decisions_394cc7ae3f7501b17fb0a245` (items 1+2 live-drill closure + the operator-perception lesson that motivates item 3).
</canonical_refs>

<deferred>
## Deferred Ideas (item 3)

- **Item 4** (Situation Room org-level blocked backlog) + **Item 5** (bulletin lineage filter+gloss+clickable) — each its own discuss gate + plan.
- **Compile-trigger reliability / auto-resume of a paused Editor-Agent** — explicitly LOCKED OUT (explicit-resume-only by design). If the TL;DR shows "Compiling…" forever, that is a paused agent, not an item-3 concern.
- **Plan 05-10** (npm publish + milestone close) — separately operator-gated.
</deferred>

---

# ITEM 4 — Situation Room org-level blocked backlog

**Discussed:** 2026-05-29 (fast discuss; items 1+2 and item 3 CLOSED & VERIFIED LIVE first)
**Status:** Ready for planning (next plan — 07-03)

<domain>
## Phase Boundary (item 4)

The Situation Room reports "No blockers" on every agent card while ~24 issues sit `status=blocked` — the opposite of the plugin's core promise ("every blocker chain flattened to a single human action"). Root cause: `situation-snapshot.ts buildEmployeeRow` walks blockers PER AGENT from `current_focus_issue_id`, gated `if (startId)`; every agent is idle/Standby (no focus) → empty chain → "No blockers". FIX: add an ORG-LEVEL blocked-issue backlog — walk `status=blocked` issues directly, flatten each to its single human action via the EXISTING blocker-chain flattener, surface them clickable. Compute in the situation DATA HANDLER (valid HTTP-request scope), NOT the scope-dead recompute-situation job. OUTPUT/INSIGHT only — no new schema.
</domain>

<decisions>
## Implementation Decisions (item 4 — LOCKED via fast discuss 2026-05-29)

### Placement (D-I4-01)
- A **top-of-room banner** ("N blocked · M need you" style summary) that **expands to a full panel** with the backlog list. The existing agent grid stays as-is (the misleading per-agent "No blockers" is left untouched for this item — the banner is the org-truth surface).

### Row content (D-I4-02)
- Each blocked-issue row shows: **issue title + the single flattened human action + owner (display NAME, never a UUID) + age** (how long it has been blocked).

### Click target (D-I4-03)
- **Two affordances per row:** (a) open the issue (`/<prefix>/issues/<identifier>`), and (b) **"open chat with <owner>"** — REUSE the existing Situation Room engagement-entry / Open-chat pattern + the chat deep-link carrier (ROOM-09 lineage; URL_HASH `{"employee":"<uuid>"}` decode).

### Scope + ordering (D-I4-04)
- ALL company-wide `status=blocked` issues, **ranked HUMAN_ACTION_ON first** (reuse the flattener's `pickTopChains` ranking — HUMAN_ACTION_ON outranks SELF_RESOLVING/EXTERNAL/CYCLE), **capped at ~12–15** with a "N total" count + an overflow indicator. Keeps the panel scannable.

### Compute location + reuse (D-I4-05)
- Compute in the **situation DATA HANDLER** (valid scope), NOT the scope-dead recompute-situation job (the job's `companies.list`/`state.*` fail every tick — PR #6547). Walk `status=blocked` directly (`ctx.issues.list({ companyId, status: 'blocked' })` or list+filter). Flatten each via the EXISTING `src/shared/blocker-chain.ts` (PRIM-03/04/05 deterministic DFS; `pickTopChains` ranks HUMAN_ACTION_ON first) — do NOT re-implement flattening. Resolve owner→display-name via the D-09 `ctx.agents.get` pattern (NO_UUID_LEAK).

### Claude's Discretion
- Exact banner copy + collapse/expand interaction; the precise cap number (12–15); age formatting ("blocked 3d" vs since-timestamp); whether the banner auto-expands when M (need-you count) > 0.

### Constraints
- Stay version **1.0.0**; additive-only; **NO migration** (the backlog is COMPUTED, not stored — no schema); **NO new runtime deps**; **TDD-first**; instance-agnostic (no BEAAA hardcoding). New requirement id likely **ROOM-12** (ROOM-09/10/11 are taken — Phase 6.1).
</decisions>

<canonical_refs>
## Canonical References (item 4)

- `src/worker/handlers/` situation data handler + `src/worker/.../situation-snapshot.ts` (`buildEmployeeRow` — the current per-agent `current_focus_issue_id`-gated walk; the new org-walk lives in the DATA HANDLER).
- `src/shared/blocker-chain.ts` — the deterministic flattener + `pickTopChains` (PRIM-03/04/05) to REUSE for each blocked issue.
- Situation Room UI (the ROOM-09 engagement-entry / "Open chat with <Role>" pattern + the chat deep-link carrier `parseChatDeepLink` / URL_HASH) — REUSE for the per-row "chat with owner" affordance.
- `src/worker/handlers/resolve-refs.ts` — the D-09 `ownerName` via `ctx.agents.get` NO_UUID_LEAK pattern to REUSE for owner display names.
- MemPalace `clarity_pack/decisions` drawer `drawer_clarity_pack_decisions_af74a33adb4d28b47ae8894e` finding #4 (the original diagnosis) + `drawer_clarity_pack_decisions_c261097e92ac88e11f361376` (item 3 closure + the 2-connection deploy technique).
- `.planning/DEPLOY-RUNBOOK.md` Path A (deploy) — minimize SSH connections (rm+cat-over-stdin upload + one install here-string).
</canonical_refs>

<deferred>
## Deferred Ideas (item 4)

- Fixing the per-agent "No blockers" walk itself (the banner/panel is the org-truth surface; the per-agent text is left for a possible later polish).
- The scope-dead recompute-situation JOB — NOT revived here (we compute in the handler instead; the job stays a best-effort no-op).
- **Item 5** (bulletin lineage) + **Plan 05-10** (npm publish) — separately gated.
</deferred>

---

# ITEM 3.1 — Unified ref-aware markdown rendering (operator feedback on item 3)

**Discussed:** 2026-05-29 (operator reviewed item 3 live on BEAAA-828)
**Status:** Ready for planning (next plan — 07-04; JUMPS AHEAD of item 4 / 07-03 which is planned-but-deferred)

<domain>
## Phase Boundary (item 3.1)

**Operator feedback after item 3 shipped:** "The TLDR looks perfect. The rest of the reader looks half rendered… still asterisks, and still BEAAA-704 etc. that do not show the title. The way things are rendered in the TLDR should be rendered in the rest of the reader as well." Root cause: the **main Reader prose body** is rendered by `src/ui/surfaces/reader/prose-with-ref-chips.tsx`, which (a) renders text segments as PLAIN TEXT (literal `## BLUF`, `**bold**`, `-` bullets) and (b) renders refs as `RefChip` showing `ID · status` (never the title). Item 3 only applied SafeMarkdown to the TL;DR strip + the Anchored-to excerpt — the main prose body was in NO item's render scope. FIX: a UNIFIED ref-aware markdown renderer used everywhere.
</domain>

<decisions>
## Implementation Decisions (item 3.1 — LOCKED via operator review 2026-05-29)

### Unified clickable titled chips (operator's exact ask: "a clickable chip with a title, but I also want the same behavior in TLDR")
- **D-I31-01 — RefChip shows "ID — title", clickable, status as a small badge.** `ref-chip.tsx` already resolves `{id, title, status}` via the `resolve-refs` handler — it currently renders only `ID · status`; change it to render `ID — <title>` (still the clickable link to `/<prefix>/issues/<id>`), keeping status as a small badge/dot. Long titles: wrap or clamp with the full title on hover (Claude's discretion). Degrade: if title unresolved, show the bare ID (current behavior).
- **D-I31-02 — SafeMarkdown becomes ref-aware.** Add an opt-in mode (e.g. `linkRefs` + a `companyPrefix`) so that during inline parsing, `PREFIX-NNN` tokens render as a `RefChip` (clickable titled chip) instead of plain text. Instance-agnostic: derive the prefix via `extractCompanyPrefixFromPathname` (broad `/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g` fallback). Keyed nodes (no React key warnings — mirror the existing prose-with-ref-chips keying).
- **D-I31-03 — BOTH the TL;DR strip AND the main prose body (AND the Anchored-to excerpt) render via ref-aware SafeMarkdown.** `prose-with-ref-chips.tsx` is REWRITTEN to delegate to ref-aware SafeMarkdown (markdown + titled clickable chips) instead of its plain-text split. `tldr-strip.tsx` enables ref-awareness on its SafeMarkdown. The excerpt (`ref-card.tsx`) also enables ref-awareness for consistency (chips inside the quote).
- **D-I31-04 — SUPERSEDE the item-3 worker-side TL;DR text rewrite.** With client-side titled chips, the worker `src/worker/handlers/tldr-ref-titles.ts` rewrite (body → "ID — title" text) is REDUNDANT and would DOUBLE-RENDER (chip "ID — title" + trailing " — title" text). Remove the wire-in from `issue-reader.ts` (and the now-unused `tldr-ref-titles.ts` module + its tests). READER-10's "refs resolve to ID — title" is now delivered client-side via the chip (clickable — strictly better); READER-10 stays Implemented (re-verified at drill).

### Claude's Discretion
- Long-title handling (wrap vs clamp+tooltip); whether the status badge stays a word ("done") or a colored dot; exact ref-aware SafeMarkdown API shape (prop name).

### Constraints
- Stay version **1.0.0**; additive-only; **NO migration**; **NO new runtime deps**; **TDD-first**; instance-agnostic. Preserve READER-03 (chips clickable — now ENHANCED with titles) + the XSS guards from item 3 (no `dangerouslySetInnerHTML`, href allowlist) UNCHANGED. The `tldr-strip.tsx` empty/compiling/paused branches + the stamp stay byte-unchanged.
</decisions>

<canonical_refs>
## Canonical References (item 3.1)

- `src/ui/surfaces/reader/prose-with-ref-chips.tsx` — the main prose body (REWRITE to ref-aware SafeMarkdown).
- `src/ui/primitives/safe-markdown.tsx` + `.ts` — item-3 renderer (ADD ref-awareness).
- `src/ui/primitives/ref-chip.tsx` — the clickable chip (CHANGE display to "ID — title"; it already resolves the title via `resolve-refs`).
- `src/ui/surfaces/reader/tldr-strip.tsx` + `ref-card.tsx` — enable ref-awareness on their SafeMarkdown.
- `src/worker/handlers/tldr-ref-titles.ts` + `src/worker/handlers/issue-reader.ts` (the item-3 wire-in) — REMOVE (superseded by D-I31-04).
- `src/ui/primitives/use-resolved-company-id.ts` — `extractCompanyPrefixFromPathname` (instance-agnostic prefix).
- MemPalace `clarity_pack/decisions` `drawer_clarity_pack_decisions_c261097e92ac88e11f361376` (item 3 closure).
</canonical_refs>

<deferred>
## Deferred Ideas (item 3.1)

- **Item 4** (07-03, PLANNED) — Situation Room org blocked backlog; RESUME after item 3.1 ships. **Item 5** + **Plan 05-10** — later.
</deferred>

---

# ITEM 5 — Bulletin lineage filter + gloss + clickable (LAST Phase 7 chunk)

**Discussed:** 2026-05-29 (fast discuss; items 1+2 / 3 / 3.1 / 4 all CLOSED & VERIFIED LIVE first)
**Status:** Ready for planning (next plan — 07-06; items 4=07-03, 3.1=07-04 already shipped)

<domain>
## Phase Boundary (item 5)

The Daily Bulletin's "ONE ARTIFACT, END-TO-END" section (the `lineageThreads` — the LineageFooter / lineage-grouper output) renders a FLAT chronological list of recent activity that includes routine/scheduled outputs (Daily Founder digest, Daily CEO status report ×2, Nightly Auditor Report) + duplicates → it reads like a LOG, not an insight; the heading says "one artifact" but shows many; the squares are NOT clickable. FIX: filter the noise, add a one-line plain-English gloss per surviving thread, and make each square clickable. This is bulletin OUTPUT QUALITY — the bulletin still compiles via the view-driven compileNow/byCycle path (unchanged).
</domain>

<decisions>
## Implementation Decisions (item 5 — LOCKED via fast discuss 2026-05-29)

### Filter (D-I5-01)
- Drop **routine/scheduled outputs + exact duplicates** from the lineage threads; **KEEP agent-self substantive outputs** (an agent's own real work product stays; only its scheduled/routine digests + dupes are removed). Operator chose "Routine + duplicates (keep agent-self)" over the more aggressive "routine + agent-self + duplicates". The filter is heuristic (routine = scheduled/digest/report cadence outputs) — be conservative; when unsure, keep.

### Gloss (D-I5-02)
- Each surviving thread gets a **one-line plain-English gloss** ("what this means for you") generated by the **Editor-Agent (LLM)** — same engine + view-driven compile path as the TL;DR (compile on view, cache, refs→titles via the existing resolver where useful). The Editor-Agent IS running on BEAAA (verified in the item-3/item-4 drills). Paused-agent → no gloss (graceful: show the thread without a gloss, or a "gloss pending" state — NOT an error). Do NOT auto-resume a paused agent (locked, like the TL;DR).

### Clickable (D-I5-03)
- Each lineage square gets **TWO affordances** — open the issue (`/<prefix>/issues/<identifier>`) + "open chat with <owner/agent>" — reusing the ROOM-09 `buildChatDeepLink` carrier, mirroring the item-4 row pattern.

### Heading (D-I5-04 — Claude's discretion)
- The "ONE ARTIFACT, END-TO-END" heading shows many threads — reframe it to match reality (e.g. a count, or a clearer label). Planner/executor's call; not a blocker.

### Constraints
- Stay version **1.0.0**; additive-only; **prefer NO migration** (reuse the existing TL;DR/bulletin cache structures or an ephemeral/computed gloss; only add a migration if a gloss cache is genuinely required — flag it, don't assume); **NO new runtime deps**; **TDD-first**; instance-agnostic. The bundle UI is creeping (5 ceiling recalibrations 688→704 kB this milestone) — keep the UI delta lean. New requirement id likely **BULL-10** (verify the next free BULL id).
</decisions>

<canonical_refs>
## Canonical References (item 5)

- The bulletin worker compile + lineage grouper: `src/worker/jobs/compile-bulletin.ts` + the lineage-grouper (Plan 03-03/03-10 lineage — search `lineage`/`lineageThreads` under src/worker/) — the FILTER (D-I5-01) + the GLOSS compile (D-I5-02) integrate here.
- The Editor-Agent LLM compile path: `src/worker/agents/compile-tldr.ts` + the session LLM adapter (Plan 03-05 `session-llm-adapter.ts`) + the view-driven driver (`driveTldrCompileStep` / the bulletin compileNow/byCycle) — the gloss reuses this engine.
- The bulletin UI: the LineageFooter / lineage component (Plan 03-03 — search `LineageFooter`/`lineage` under src/ui/surfaces/bulletin/) — render the gloss + the two clickable affordances.
- The ROOM-09 `buildChatDeepLink` employee-only carrier (deep-link.mjs) — reuse for "open chat".
- The SDK resolver `resolveRefsViaSdk` + `prefixFromIdentifier` (07-01) — for any refs→titles in the gloss.
- MemPalace `clarity_pack/decisions`: `drawer_clarity_pack_decisions_af74a33adb4d28b47ae8894e` finding #5 (the original diagnosis) + `drawer_clarity_pack_decisions_3edc62ded111d79685d475ec` (item-4 closure + the deploy/drill patterns).
- `.planning/DEPLOY-RUNBOOK.md` Path A (2-connection deploy).
</canonical_refs>

<deferred>
## Deferred Ideas (item 5)

- Plan 05-10 (rc→1.0.0 npm publish + Phase 5/milestone close) — operator-gated; the natural NEXT after item 5 closes (Phase 7 complete).
- The bulletin daily 06:30 cron is best-effort only (scheduled-job scope dead, PR #6547) — out of scope; the bulletin reliably compiles on the operator opening the Bulletin page + "Generate now".
</deferred>

---

*Phase: 07-clarity-surfaces-quality-and-portability*
*Context gathered: 2026-05-28 (items 1+2) + 2026-05-29 (item 3 + item 4 + item 3.1 + item 5)*
