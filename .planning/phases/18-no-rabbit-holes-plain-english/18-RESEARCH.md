# Phase 18: No rabbit-holes & plain-English — Research

**Researched:** 2026-06-13
**Domain:** Codebase surgery — Open↗ nav re-point, scrub-layer + render-layer identifier hygiene, one new deterministic divergence affordance, on the Phase-16-hardened snapshot path.
**Confidence:** HIGH (every claim below is a codebase read/grep with exact file:line anchors verified this session; the one genuinely external item — D-01 host deep-link — is resolved with live-probe evidence already in the repo)

## Summary

Phase 18 is a precision edit at three identified boundaries, not a redesign. The verdict pipeline (one engine → one scrub → one verdict) is already built (Phase 11/17). All five Open↗ sites share one identical nav call shape; the scrub leak is six fallback lines in one shared module; the divergence affordance reads two signals (a regex over `tldr_cache.body` + the engine's `needsYou` verdict) that already exist — the only NEW data access is a single batched `tldr_cache` read into the snapshot hot path, which must be scoped to the needs-you set and degrade-wrapped.

**The single most important finding (D-01):** The repo already contains live-probe-verified evidence (Plan 04.2-03, run on Countermoves COU-2215, 2026-05-23) that **the host strips `?query` and `{ state }` from `navigate()` but preserves the URL fragment (`#hash`) end-to-end**, and that the target Clarity surface reads it back via `useHostLocation().hash` on mount. This is the chat deep-link carrier (`src/ui/surfaces/chat/deep-link.mjs`). BUT a detailTab is host-rendered: the host owns the issue-detail tab bar and only mounts `ReaderView` once the Reader tab is the active tab. There is **no evidence the host reads any URL param/hash to pre-select a detailTab**, and a client-intent flag inside `ReaderView` cannot select the tab because the component is not mounted until the tab is already active. This is the crux of the DEFAULT recommendation below.

**Primary recommendation:** Default to a **two-tier LEG-01 fix** — (1) attempt the host-honored URL deep-link (`?tab=clarity-reader` AND `#tab=clarity-reader`, belt-and-suspenders) with a Phase-1-of-the-phase host probe; (2) if the host does not honor it (the likely outcome given the detailTab mount model), ship the **locked SPEC fallback**: route to `/<prefix>/issues/<id>` and have the host land on the classic tab — but per D-02 the bar is "user sees the inline-resolved Reader". Since Clarity cannot force-select a host-owned tab from inside its own slot, the **fallback must be delivered by the host probe outcome**: either the host honors a deep-link (best), or LEG-01 ships with the issue-page nav PLUS a one-time on-mount Reader auto-select **driven from the most-outer Clarity mount point that the host renders before tab selection** (see D-01 §"If the host does not honor a URL tab-select"). Treat the host probe as the first task of the phase — it determines which branch ships.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Open↗ → Reader-tab deep-link | Host routing + Browser/UI | — | The host owns the detailTab bar; Clarity emits a nav target and (fallback) reads its own URL signal on mount. |
| UUID→human-name resolution | API / Worker (`scrub-human-action.ts` + each producer's `nameByUuid` map) | — | Engine is pure (no I/O); name resolution is a worker fetch, final string-scrub is the shared helper. |
| "an agent" fallback wording | Shared module (`src/shared/scrub-human-action.ts`) | — | Single scrub vocabulary; CONTEXT made the shared-helper home Claude's Discretion with single-source intent. |
| Render-scrub all 4 surfaces | Browser/UI shared helper | — | Render-layer pass over already-fetched strings (Reader, SR, Bulletin, Chat). |
| Read-time re-scrub of persisted strings | Browser/UI (regex over already-fetched strings) | — | Additive, zero new DB fetches; runs where the snapshot/Reader read path already has the strings in hand. |
| Chat-chip humanization (D-08/D-09) | Browser/UI (`topic-strip.tsx` render layer) | Worker (only if payload lacks labels) | Labels (`title`, employee name) are already in the chat payload — UI render fix, no worker change. |
| LEG-03 divergence trigger (regex over tldr_cache.body) | API/Worker (SR row) + Browser/UI (Reader) | DB (one batched `tldr_cache` read) | SR needs the cache read inside the rollup path; Reader already has `data.tldr.body` in hand. |
| LEG-03 affordance render + confirm | Browser/UI (TldrStrip + SR needs-you row) | — | Pure presentation; confirm-gated by construction (never auto-closes). |

## Standard Stack

No new libraries. TypeScript/TSX edits only. Stack locked by the plugin contract (React 19 externalized, TS ^5.7.3, esbuild, ESM, Node ≥20). `[CITED: CLAUDE.md Technology Stack]`

**No package installation → no Package Legitimacy Audit required** (zero external packages added). slopcheck N/A.

---

## 1. D-01 RESOLUTION — Open↗ → Clarity Reader tab deep-link feasibility

### The evidence (HIGH confidence — all codebase reads)

**A. The host preserves URL fragments; strips query and state.** `[VERIFIED: src/ui/surfaces/chat/deep-link.mjs:24-49]` The chat Reader→Chat deep-link went through three carriers before landing on one that survives the live host:
- `?query` (Plan 04.2-01) — **dropped** by the host before react-router.
- `{ state }` argument to `navigate()` (Plan 04.2-02) — **stripped** (`history.state.usr === null` on the live host).
- **URL fragment `#h=<base64-JSON>` (Plan 04.2-03) — SURVIVES end-to-end**, proven by `scripts/probes/carrier-survival.mjs` on COU-2215, 2026-05-23. RFC-3986 fragments are client-side-only and never pass through the host's path-routing / `resolveHref` step.

**B. The target surface reads its own URL signal on mount.** `[VERIFIED: src/ui/surfaces/chat/index.tsx:374-532]` The chat surface destructures `{ search, pathname, hash, state }` from `useHostLocation()` and dispatches `parseChatDeepLink({ search, state, hash })` **once** on mount (consume-once invariant; guards against re-fire on stale hash). `useHostLocation()` exposes `hash`. This is the exact "Clarity reads its own signal" mechanism CONTEXT D-02 describes.

**C. BUT the Reader is a host-rendered detailTab.** `[VERIFIED: src/manifest.ts:784-790]` The `clarity-reader` slot is `type: 'detailTab'`, `entityTypes: ['issue']`, `exportName: 'ReaderView'`. The host renders the issue-detail page's tab bar and mounts `ReaderView` (`src/ui/surfaces/reader/index.tsx`) **only when the Reader tab is the active tab**. `[VERIFIED: reader/index.tsx:1-14]` confirms the host invokes the slot with `{ slot, context }` per `PluginSlotComponentProps`. There is **no Clarity code path that runs while the classic tab is showing** — so a client-intent flag read inside `ReaderView` cannot select the Reader tab, because `ReaderView` is not mounted until that tab is already selected.

**D. No evidence the host honors a tab-select URL param.** `[VERIFIED: grep across src/ for searchParams/hash/tab — no host tab-selection read exists in Clarity; the host's own tab-selection logic is not in this repo]` Phase 17 D-12 already established only `/<companyPrefix>/issues/<id>` routes. Whether the host's issue-detail page inspects `?tab=` / `#tab=` to pre-select a plugin detailTab is **unverifiable from this repo** — it lives in Paperclip host code (`ui/src/plugins/slots.tsx` and the issue-detail page), not the plugin. `[ASSUMED — must be probed against the live host]` Default assumption: the host does NOT honor a tab param (no public contract documents it; PLUGIN_SPEC.md describes detailTab slots without a deep-link-to-tab feature).

### DEFAULT recommendation (what the planner should plan)

**Tier 1 — Host-honored URL deep-link (attempt first, gate behind a probe task).**
Make the first task of the phase a **live host probe** (mirror `scripts/probes/carrier-survival.mjs`): on BEAAA, navigate to `/<prefix>/issues/<id>?tab=clarity-reader` and separately `/<prefix>/issues/<id>#tab=clarity-reader`, and observe whether the host lands on the Reader tab. If EITHER works:
- Re-point all five Open↗ sites to emit that form (uniform helper, below). Bookmarkable/shareable to the Reader — the best outcome.
- The fragment form is preferred over query (the host strips query per finding A; but tab-selection may be read by the host's router BEFORE the strip — the probe settles it).

**Tier 2 — Locked SPEC fallback (ship this if the probe fails, which is the likely case).**
Per SPEC line 27 and CONTEXT D-02, the bar is "user sees the inline-resolved Reader, never the classic wall." Since Clarity cannot force-select a host-owned tab from inside its slot, the fallback has two viable shapes — the planner picks based on the probe and a short spike:

- **2a (preferred fallback): host auto-select via a Clarity-read fragment + the host's own tab state.** If the host renders ANY Clarity-controlled element on the issue-detail page *outside* the tab body (it does not today — Clarity only contributes the detailTab), this is unavailable. Likely **not viable** given the current slot model. Document as ruled-out unless the host probe reveals an outer mount.
- **2b (the honest, shippable fallback): navigate to the issue page and rely on a host tab-select if available; otherwise accept the issue-page landing as the terminal destination ONLY IF the host genuinely cannot select the tab.** Re-read SPEC line 27: "If the host genuinely cannot auto-select a tab, the fallback is to route to the issue page with the Reader tab auto-selected." This presupposes Clarity CAN auto-select. If the probe proves it cannot, **the planner must surface this as a phase-scoping decision to discuss-phase / Eric**: the acceptance criterion ("lands on the Clarity Reader, not the raw classic body") may be physically unsatisfiable without a host feature. The honest options are:
  1. **File a host feature ask** (host honors `?tab=`/`#tab=` for detailTab slots) and ship Tier-1 once available.
  2. **Make the Reader the host's default tab for issues** (if the host detailTab API supports a `defaultTab`/ordering hint — probe `PluginPluginManifestV1` detailTab fields; NOT currently set in the manifest). This would change the default landing for ALL issue opens, which may conflict with coexistence guarantee #2 ("Original UI never replaced; Reader view is an additional tab") — flag to Eric.
  3. **Deep-link to the Clarity Situation Room / a Clarity-owned page** that renders the inline-resolved Reader content inline (a Clarity `page` slot CAN be deep-linked with a fragment per finding A). This sidesteps the host tab entirely but changes the UX from "Reader tab on the issue page" to "Reader content on a Clarity page."

**Planner guidance:** Plan the probe as task 1. Plan the uniform Open↗ helper (below) as task 2 so the re-point is one edit regardless of which target string wins. Keep the target-URL construction in **one shared helper** so Tier-1 vs Tier-2b is a one-line change. Do NOT plan UI work that assumes Clarity can select a host tab from inside `ReaderView` — that path is closed by the mount model (finding C).

### The uniform Open↗ re-point (LEG-01 mechanics — applies regardless of target)

All five sites share the **identical** nav shape today: `[VERIFIED]`
```
// live-blocker-panel.tsx:171   nav.navigate(`/${companyPrefix}/issues/${issueId}`);
// employee-row.tsx:238         navigate(`/${companyPrefix}/issues/${issueId}`);
// blocked-backlog-expander.tsx:62  navigate(`/${companyPrefix}/issues/${identifier}`);
// lineage-footer.tsx:48        navigate(`/${companyPrefix}/issues/${identifier}`);
// reply-in-place.tsx:227       navigate(`/${companyPrefix}/issues/${leafIssueId}`);
```
Every site already derives `companyPrefix` via `extractCompanyPrefixFromPathname(useHostLocation().pathname)` (instance-agnostic — no literals). `[VERIFIED: each file imports extractCompanyPrefixFromPathname]`

**Recommended approach:** Add one shared helper, e.g. `buildReaderHref(companyPrefix, identifier)` (co-locate with the existing `extractCompanyPrefixFromPathname` in `src/ui/primitives/use-resolved-company-id.ts`, or a new `src/ui/primitives/reader-href.ts`). It returns the Tier-1-or-Tier-2 target string in ONE place. Re-point all five sites to call it. There is **no existing shared open-issue helper today** — each site inlines the template literal; this phase introduces the single source. A render-scan-friendly test can grep that no site inlines `/issues/` directly anymore.

**Note:** `employee-row.tsx` has THREE Open↗-ish call sites (the SPEC cites :238/453/508) plus `openChatWithOwner`/`assignWork` which use `buildChatDeepLink` (a DIFFERENT target — chat, not issue) — those are NOT LEG-01 sites. Verify the planner re-points only the issue-open calls, not the chat deep-links.

---

## 2. PER-REQUIREMENT IMPLEMENTATION GUIDANCE

### LEG-01 — Open↗ routes to the Clarity Reader

| Item | Finding |
|------|---------|
| Sites (verified) | `reader/live-blocker-panel.tsx:171`, `situation-room/employee-row.tsx:238` (+ :453/:508 per SPEC), `situation-room/blocked-backlog-expander.tsx:62`, `bulletin/lineage-footer.tsx:48`, `_shared/reply-in-place.tsx:227` |
| Current shape | identical `navigate(\`/${companyPrefix}/issues/${id}\`)`; `companyPrefix` from `extractCompanyPrefixFromPathname(pathname)` |
| Nav hook | `useHostNavigation()` (`.navigate`, `.resolveHref`) + `useHostLocation()` (`.pathname`, `.hash`) from `@paperclipai/plugin-sdk/ui/hooks` |
| Recommended | One shared `buildReaderHref()` helper → re-point all 5; gate Tier-1 vs Tier-2 target on the host probe |
| Reusable input | Chat deep-link carrier evidence (`deep-link.mjs`) proves fragment survival — reuse the `#`-fragment pattern if Tier-1 uses a hash |
| Risk | **Host may not honor any tab-select** (finding D). This is the phase's only true feasibility risk. Probe first. |

### LEG-02 — Zero raw/partial agent/UUID ids

| Item | Finding |
|------|---------|
| Scrub fallback (the leak) | `src/shared/scrub-human-action.ts` — `agent#${uuid.slice(0,8)}` at **lines 65, 66, 71, 78, 86** `[VERIFIED]`. Six emission sites across steps 2/3/4/5. |
| Real name resolution | Happens BEFORE the fallback via the `nameByUuid: Map<string,string|null>` passed into `scrubHumanAction`. The SR employee name-resolution path builds this map in each producer (`flatten-blocker-chain.ts`, `org-blocked-backlog.ts`, `build-employees-rollup.ts`) via `ctx.agents.get` → `nameByUuid`. `[CITED: 16-RESEARCH.md:179]` "an agent" is the last resort ONLY when `nameOf(uuid)` is null. |
| Recommended core fix | Replace `?? \`agent#${uuid.slice(0,8)}\`` with `?? 'an agent'` at all 6 sites. Step-2 UNCLASSIFIED double-scrub (lines 65-66) collapses to one `replace(UUID_RE_G, () => 'an agent')`. Step-5 belt-and-suspenders (line 86) → `'an agent'`. |
| Guard inversion (LEG-02c) | The currently-blessing tests are in **`test/shared/scrub-human-action.test.mjs`**: Test 4b line 94 `assert.match(stuck, /agent#eeeeeeee/)`, Test 5 line 123 `/agent#dddddddd/`, Test 6 line 144 `/agent#12345678/` `[VERIFIED]`. ALSO `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs:~121` (`includes('agent#')` per 16-RESEARCH). These INVERT: assert the output does NOT match `/agent#[0-9a-f]{6,}/i` and DOES contain "an agent" (or a resolved name). |
| Render-scan guards (extend, anchored) | Per-surface test files, each is **source-grep + behavioral string-render** (no jsdom): `test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs`, `pulse-header-no-uuid-leak.test.mjs`, `test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs` `[VERIFIED — read employee-row + pulse-header versions]`. Each defines `UUID_RE` locally. Extend each to ALSO assert no match of `PARTIAL_HEX_RE = /\bagent#[0-9a-f]{6,}\b/i` and a bare UUID. **Anchor to `agent#` — do NOT add a blanket `/[0-9a-f]{8,}/`** (false-positives on git SHAs — Pitfall 3). |
| Chat chips (LEG-02d) | `src/ui/surfaces/chat/topic-strip.tsx:78-83` — `chtLabel()` returns `id.slice(0,8).toUpperCase()` (line 82) when the topicId is not `CHT-\d+`-shaped `[VERIFIED]`. Per 16-RESEARCH also `chat/message-thread.tsx:~1121` (`run · <8>`) and `chat/index.tsx:~764` (`issueId.slice(0,8)`). D-08/D-09: resolve `CHT-<8>` → topic `title` (already on `ChatTopic.title`, line 41-43), `run·<8>` → agent name/role or "an agent". The payload already carries `title` and `employeeAgentId` — **UI-render fix, no worker change** (confirm message-thread payload carries the run's agent name; if not, that's the one place a worker addition may be needed). |
| Persisted re-scrub (LEG-02e) | Read-time regex over already-fetched strings. The snapshot/Reader read path already fetches `tldr_cache.body` / focus summaries / bulletin bodies as plain strings; run the same "an agent" replace over them at render. **ZERO new DB fetches** — regex only. `[CITED: 16-RESEARCH Runtime State Inventory caveat]` historical `tldr_cache.body` MAY contain a stored `agent#<8>` — confirm with one `SELECT ... WHERE body LIKE '%agent#%'` on BEAAA during the drill; the read-time scrub cleans it without a destructive migration. |
| Live anchor | BEAAA-972 Reader currently reads `"...CEO stuck on agent#04fcac7c is stuck"` → post-fix a human name or "an agent", no hash. |

### LEG-03 — "Looks done — close it?" honest-divergence affordance

| Item | Finding |
|------|---------|
| Trigger (D-05) | Deterministic anchored regex over `tldr_cache.body` for completion phrases ("is done / complete / shipped / merged / delivered / resolved"). NO schema change — `tldr_cache` is body + tags only `[VERIFIED: migrations/0002_tldrs_and_editor.sql:35-46]` (no structured done column). Tune for HIGH precision (D-06). |
| Engine side (D-07) | "blocked family" = the engine's `needsYou === true` verdict on `BlockerChainResult` (set for AWAITING_HUMAN / UNOWNED per D-13) `[VERIFIED: src/shared/types.ts:44-61]`. Phase-17 verdict kinds confirmed: `AWAITING_HUMAN`, `AWAITING_AGENT_WORKING/STUCK`, `SELF_RESOLVING`, `EXTERNAL`, `CYCLE`, `UNOWNED`, `UNCLASSIFIED`. The affordance gates on `needsYou` (a person must act) AND the TL;DR-done regex. |
| Degrade-safe | No TL;DR row OR no engine verdict → affordance absent (no false prompt). |
| **SR-row signal — THE perf-critical bit** | `build-employees-rollup.ts:384-390` computes `focusLine = polishTldr(focusIssue.title)` and reads **NO `tldr_cache`** today `[VERIFIED — read lines 384-390]`. LEG-03 introduces the first `tldr_cache` read into the snapshot hot path. It MUST be a SINGLE batched query scoped to the needs-you set. |
| Needs-you scoping (already exists) | `src/worker/situation/awaiting-you-selector.ts` → `selectAwaitingYouIssueIds(rows)` returns the needs-you issue UUIDs, PURE, de-duped `[VERIFIED — full read]`. Use this set as the batch key. |
| Batched read shape (NEW) | Add a `getTldrBodiesByScopeIds(ctx, surface, scopeIds[])` to `src/worker/db/tldr-cache.ts` using `WHERE surface = $1 AND scope_id = ANY($2)` — ONE query for the whole needs-you set (O(1) queries, not O(rows)). The existing `getTldrByScope` (line 97) is the single-row template; the batched variant mirrors it with `= ANY`. Wrap the call in try/catch → a throw/slow read drops the affordance (focusLine path unchanged), never blocks/slows the render. `[CITED: SPEC perf bound line 39/65]` |
| Reader side | The Reader ALREADY has the TL;DR body in hand — `reader/index.tsx:406` passes `data.tldr` to `<TldrStrip>`, and `data.tldr.body` is available at the index level `[VERIFIED]`. The blocked verdict comes from `<LiveBlockerPanel>`'s own `flatten-blocker-chain` fetch (index.tsx:416). **No new Reader DB read** — run the done-regex on `data.tldr.body` and read the panel's `needsYou`. Affordance placement: next to the TL;DR (TldrStrip area) per CONTEXT discretion. The cleanest wiring lifts the `needsYou` signal to the index level (or passes the done-flag down) so the affordance sits beside the TL;DR. |
| Confirm-gated | "Close as done" / "Keep blocked"; never auto-closes. The close mutation reuses the existing host issue-update action pattern (the SR already mutates issue state via `ctx.issues.update` in the assign-owner path — same privilege boundary). Carry the issue UUID as dispatch-only (NO_UUID_LEAK — never rendered). |
| Styling | Within the unchanged mockup contract. Check `Skill("sketch-findings-clarity-pack")` before adding any visible label/affordance styling; passes `check-css-scope.mjs` (scoped under `[data-clarity-surface]`) + bundle-size gate. |

---

## 3. SHARED WORDING HELPER DESIGN (CONTEXT Claude's Discretion — single-source intent)

CONTEXT defaults to **one shared module co-located with / extending `src/shared/scrub-human-action.ts`** owning the whole scrub vocabulary. Concrete shape:

```
src/shared/scrub-human-action.ts   (extend — the existing single source)
  ─ export const UUID_RE / UUID_RE_G            (exists)
  ─ export const PARTIAL_HEX_RE = /\bagent#[0-9a-f]{6,}\b/i   (NEW — guard anchor)
  ─ export const AGENT_FALLBACK = 'an agent'    (NEW — single literal; tests + scrub import it)
  ─ export function scrubHumanAction(...)        (exists — swap fallback to AGENT_FALLBACK)
  ─ export function rescrubPersisted(text): string   (NEW — read-time pass: replace UUID_RE_G + PARTIAL_HEX_RE → AGENT_FALLBACK)
  ─ export function humanizeChatChip(topic | runId, {title, agentName}): string  (NEW — D-08/D-09)
```

**Rationale for single-source:** the "an agent" literal, the partial-hex regex, the read-time re-scrub, and the chat-chip humanization all encode ONE vocabulary. One file = LEG-02 "lands in one place"; the guards and the runtime import the SAME `AGENT_FALLBACK` and `PARTIAL_HEX_RE` so they can never drift. `[CITED: CONTEXT Claude's Discretion]`

**Split-if-clean-boundary caveat:** `humanizeChatChip` is UI-shaped (takes payload labels, returns a display label) while `scrubHumanAction` is worker-shaped (takes a `Terminal`). If the import graph gets awkward (chat is UI-only; `scrub-human-action.ts` is imported by workers), the planner MAY split the chat-chip humanizer into a thin UI module that imports `AGENT_FALLBACK` from the shared file — keeping the *vocabulary* single-source while respecting the worker/UI boundary. `scrub-human-action.ts` is already pure (type-only imports, no I/O), so it is safe to import from UI. Default: keep it one module; split only the chat helper if the boundary bites.

**Render-scrub all 4 surfaces:** all four read-paths already have the strings as React text; the render-scrub is `rescrubPersisted(str)` applied where the surface renders a potentially-leaky string (verdict/awaited-party lines, focus lines, bulletin bodies, chat chips). It is idempotent (re-running over clean text is a no-op).

---

## 4. LANDMINES / PERF NOTES (false-positive verification killers)

1. **The batched O(1) read must be ONE query, not per-row.** `build-employees-rollup.ts` runs per-agent inside `Promise.all` `[CITED: 16-RESEARCH:147]`. Do NOT call `getTldrByScope` inside the per-row loop (that's O(rows) reads → snapshot-cliff risk). Build the needs-you set first (`selectAwaitingYouIssueIds`), then ONE `= ANY($scopeIds)` read, then attach the done-flag to the matching rows. Verify by query-count in a test/drill (SPEC acceptance line 82).

2. **Degrade-wrap the new read.** A throw/timeout on the `tldr_cache` batch read MUST drop the affordance and leave `focusLine` exactly as today — never block or slow the render. The snapshot path is SWR serve-last-good + bounded pool + deadline floor (Phase 16); a new un-wrapped await could re-introduce a stall. Warm recompute must stay < ~500ms (~492ms baseline); cold p95 < ~5s, never 502.

3. **LEG-02e re-scrub = regex only, ZERO new DB fetches.** The read-time re-scrub runs over strings ALREADY fetched (snapshot rows, Reader payload, bulletin bodies). Adding a DB read here would violate the perf constraint and the acceptance criterion (line 83). Verify the re-scrub touches only in-memory strings.

4. **The guard-test inversion is a first-class task, not a side-effect.** A green suite after only changing runtime code means you did NOT invert the guards. `test/shared/scrub-human-action.test.mjs` Tests 4b/5/6 currently ASSERT `agent#<hex>` is correct output — those MUST flip to assert failure (`[CITED: 16-RESEARCH Pitfall 1]`). Plus `flatten-blocker-chain-scrub.test.mjs` and the doc-comments in `scrub-human-action.ts:34,42,44` ("NEVER the raw UUID" → "NEVER a raw UUID *or partial hash*").

5. **Anchored guard regex only.** Use `/\bagent#[0-9a-f]{6,}\b/i` + the full `UUID_RE`. Do NOT add `/[0-9a-f]{8,}/` — it false-positives on git SHAs, hex colors, "deadbeef" in prose `[CITED: 16-RESEARCH Pitfall 3]`. Scope the render-scan to verdict/awaited-party/focus/chip strings, not arbitrary DOM text.

6. **Do NOT touch `src/shared/blocker-chain.ts`.** Pure deterministic engine: determinism test (100×) + AI-token grep guard (`test/shared/blocker-chain.test.mjs`, bans `openai|anthropic|claude_local|llm|gpt|completion`) `[CITED: 16-RESEARCH:268]`. LEG-03 READS the verdict (`needsYou`), never edits the engine. The done-regex is a UI/worker concern, not an engine concern — keep AI/LLM tokens out of the deterministic path.

7. **Additive-only migration rule.** No destructive migration to rewrite historical persisted strings (coexistence #3/#6). Persisted `agent#<8>` is cleaned at read-time, never by ALTER/UPDATE. If LEG-03 needed a schema column it would be additive — but D-05 (regex, no schema change) means **no migration at all** for Phase 18. Confirm no new migration file is introduced unless a clean additive need emerges.

8. **employee-row chat deep-links are NOT LEG-01 sites.** Re-point only the `/issues/` opens, not `openChatWithOwner`/`assignWork` (which target `/chat#h=...` via `buildChatDeepLink`). Mis-pointing those would break the chat engagement flow.

9. **Two-source version bump.** Bump BOTH `package.json` AND `src/manifest.ts` (host reads `dist/manifest.js`) `[CITED: plugin-version-bump-two-sources memory]`. A v_new bundle with a v_old label is a classic Clarity gotcha.

10. **The superseded 16-* plans use OLD requirement IDs.** 16-RESEARCH references LEG-01..LEG-05 which are the *old misscoped* numbering (no-raw-ids/enum-leak/parity/focusLine-enrich). Phase 18's LEG-01/02/03 are DIFFERENT (routing/scrub/divergence). The *technical findings* in 16-RESEARCH map cleanly, but do NOT copy the old requirement-ID mapping — re-map to 18-SPEC's IDs. Notably: 16-RESEARCH's "LEG-04 focusLine-from-tldr enrichment" is NOT in Phase 18 scope (Phase 18 keeps `focusLine = polishTldr(title)`; it only ADDS a separate batched done-flag read). Do not accidentally fold the focusLine-enrichment rewrite into LEG-03.

---

## 5. OPEN QUESTIONS / ASSUMPTIONS

| # | Item | Status | Planner action |
|---|------|--------|----------------|
| A1 | Host honors `?tab=`/`#tab=` to pre-select the `clarity-reader` detailTab | `[ASSUMED — likely NO]` Unverifiable from this repo (host code). | **Probe on BEAAA as phase task 1.** Determines Tier-1 vs Tier-2 LEG-01 branch. |
| A2 | If the host cannot select a tab, Clarity also cannot (detailTab mounts only when active) | `[VERIFIED by mount model — finding C]` | If A1 fails, LEG-01's "lands on Reader" acceptance may need a host feature ask OR a scope decision — surface to Eric/discuss-phase. |
| A3 | "an agent" (lowercase) is the desired fallback wording | `[CITED: SPEC line 32 + CONTEXT D — locked]` | Use verbatim. (16-RESEARCH A1 flagged this as a product call; SPEC has since locked it.) |
| A4 | Chat `message-thread.tsx` run-chip payload carries the agent name/role for `run·<8>` humanization | `[ASSUMED — not re-verified this session]` | Verify the chat message payload shape; if it lacks the agent name, D-08's "no worker change" assumption fails for the run-chip and a worker addition is needed (CONTEXT D-08 explicitly allows this). |
| A5 | Persisted `tldr_cache.body` / bulletin bodies may contain stored `agent#<8>` | `[ASSUMED — likely empty]` | One `SELECT ... WHERE body LIKE '%agent#%'` on BEAAA during the drill; read-time re-scrub cleans any hits without a migration. |
| A6 | The done-regex completion-phrase list (D-05) | `[Claude's Discretion — bias precision per D-06]` | Planner authors the anchored phrase list; tune for high precision (explicit "is done/complete/shipped/merged/delivered/resolved"); tolerate misses over false prompts. |
| A7 | LEG-03 close mutation reuses the host issue-update path | `[VERIFIED pattern exists — SR assign-owner uses ctx.issues.update]` | Confirm the close action carries the issue UUID dispatch-only; confirm-gated, never auto-close. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥20 + esbuild | TS/TSX build | ✓ | per CLAUDE.md pins | — |
| `node:test` runner | guard inversion + new tests | ✓ | built-in | — |
| BEAAA live instance (DO droplet) | host tab-deeplink probe (D-01), perf timing, persisted-string scan, live Open↗ drill | ✓ (autonomous deploy authorized) | v1.6.0 | local build verify if box unreachable; the D-01 probe REQUIRES the live host |

**Blocking:** the D-01 host-tab-deeplink probe needs the live BEAAA host — it cannot be answered from the codebase. No fallback for the probe; it is task 1.

## Validation Architecture

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + source-grep/string-render guard convention (no jsdom) |
| Quick run | `node --test test/shared/scrub-human-action.test.mjs` (after inversion) |
| Full suite | project test runner (44 suites green at v1.6.0) |

**Phase requirement → test map:**
| Req | Behavior | Test type | Anchor |
|-----|----------|-----------|--------|
| LEG-01 | Open↗ → Reader (live) | drill | live BEAAA, 4 surfaces |
| LEG-02a/b | fallback "an agent"; render-scrub | unit + render-scan | `scrub-human-action.test.mjs` (inverted), per-surface `*-no-uuid-leak.test.mjs` (extended) |
| LEG-02c | guard FAILS on `agent#<hex{6,}>`+UUID | unit (inversion) | `scrub-human-action.test.mjs:94/123/144`, `flatten-blocker-chain-scrub.test.mjs` |
| LEG-02d | chat chips humanized | unit (chtLabel) + render | `topic-strip.tsx` chtLabel test |
| LEG-02e | persisted row reads clean | unit (rescrubPersisted) + drill | new `rescrubPersisted` test + BEAAA next-read |
| LEG-03 | affordance on Reader+SR when done⊥blocked; absent otherwise; no auto-close | unit fixture (done+blocked, agree, missing-input) + drill | new affordance test |
| LEG-03 perf | O(1) batched needs-you read; warm <500ms | query-count test + BEAAA timing | new batched-read test |

**Wave 0 gaps:** new `getTldrBodiesByScopeIds` batched read + its test; `rescrubPersisted` + `humanizeChatChip` helpers + tests; the LEG-03 affordance component + fixture test; guard-inversion edits to 3+ existing test files; `buildReaderHref` helper + test.

## Security Domain

| ASVS | Applies | Control |
|------|---------|---------|
| V5 Input Validation | yes | all rendered strings are untrusted React text (no `dangerouslySetInnerHTML`); chat chip labels and TL;DR bodies already render via `SafeMarkdown`/React text. The close mutation validates the issue UUID server-side via the host issue-update API. |
| V6 Cryptography | no | none introduced |

Threat note: LEG-03's close action is a state mutation — confirm-gated by construction (never fires without explicit "Close as done"); the issue UUID is dispatch-only (NO_UUID_LEAK), validated by the host on `ctx.issues.update`.

## Sources

### Primary (HIGH — codebase reads this session)
- `src/shared/scrub-human-action.ts` (fallback lines 65/66/71/78/86) — full read
- `src/ui/surfaces/chat/deep-link.mjs` (carrier-survival evidence; fragment preserved, query/state stripped) — full read
- `src/ui/surfaces/chat/topic-strip.tsx` (chtLabel:78-83 hex slice) + chat/index.tsx hash dispatch — read
- `src/manifest.ts:784-790` (clarity-reader detailTab slot) — read
- `src/ui/surfaces/reader/index.tsx` (TldrStrip:406 + LiveBlockerPanel:416 placement; useHostLocation) — read
- `src/ui/surfaces/reader/tldr-strip.tsx` + `live-blocker-panel.tsx:147-172` (openIssue nav) — read
- `src/ui/surfaces/situation-room/{employee-row.tsx:235-241,blocked-backlog-expander.tsx:60-63}`, `bulletin/lineage-footer.tsx:46-49`, `_shared/reply-in-place.tsx:224-228` — read (uniform nav shape)
- `src/worker/situation/build-employees-rollup.ts:360-390` (focusLine, no tldr_cache read) — read
- `src/worker/situation/awaiting-you-selector.ts` (needs-you set selector) — full read
- `src/worker/db/tldr-cache.ts` (getTldrByScope shape; ANY-batch template) — full read
- `src/shared/types.ts:39-75` (Terminal 8 kinds, BlockerChainResult.needsYou/tier/verdict) — read
- `migrations/0002_tldrs_and_editor.sql` (tldr_cache body+tags, no done column) — full read
- `test/shared/scrub-human-action.test.mjs` (Tests 4b/5/6 bless agent#<hex>) — full read
- `test/ui/surfaces/situation-room/{employee-row,pulse-header}-no-uuid-leak.test.mjs` (render-scan convention) — full read

### Reusable superseded input (sound, NEVER-EXECUTED)
- `.planning/phases/_superseded-legibility-16-18-misscope/16-RESEARCH.md` — full read; technical findings reusable (re-map old IDs)

### Secondary
- 18-SPEC.md, 18-CONTEXT.md (locked WHAT/HOW); project memories (paperclip-issue-url-pattern, plugin-version-bump-two-sources, autonomous-deploy-authorization)

## Metadata

**Confidence breakdown:**
- LEG-01 nav sites + uniform re-point: HIGH (5 identical shapes verified)
- D-01 host-tab feasibility: HIGH that fragment survives / detailTab mount model closes client-side tab-select; LOW/ASSUMED on whether host honors a tab param → **probe required**
- LEG-02 scrub + guard inversion: HIGH (exact lines + blessing tests verified)
- LEG-03 trigger + perf scoping: HIGH (needs-you selector + tldr_cache shape + no-current-read all verified)
- Shared helper design: HIGH (existing pure module; single-source intent locked)

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (stable internal codebase; re-verify line numbers if intervening commits touch the named files; D-01 probe result supersedes the ASSUMED branch)

## RESEARCH COMPLETE
