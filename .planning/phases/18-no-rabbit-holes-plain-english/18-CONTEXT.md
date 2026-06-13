# Phase 18: No rabbit-holes & plain-English - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<spec_lock>
## Requirements Locked by SPEC.md

`18-SPEC.md` locks **3 requirements** (ambiguity 0.14, gate ≤ 0.20). Downstream agents MUST read it before planning — the WHAT/why/acceptance is fixed there, this CONTEXT.md only captures the HOW.

- **LEG-01** — Open↗ routes to the Clarity Reader (inline-resolved), never the raw classic issue page, across all 4 sites.
- **LEG-02** — Zero raw OR partial agent/UUID ids in any human-facing text (scrub fallback → "an agent"; render-scrub all 4 surfaces; guard inversion; chat chips humanized; persisted strings re-scrubbed at read-time, additive).
- **LEG-03** — Non-destructive "Looks done — close it?" affordance on Reader AND SR needs-you row when AI TL;DR reads done but the engine still says blocked. Never auto-closes.

Do not re-decide WHAT/why/acceptance — read SPEC.md.
</spec_lock>

<domain>
## Phase Boundary

Consume Phase 17's now-shipped truthful cross-surface verdicts to deliver the plain-English / no-rabbit-hole guarantees. Three landing zones, all at identified architectural boundaries (not a redesign): (1) re-point every Open↗ to the Clarity Reader, (2) eliminate every raw/partial agent-id leak from human-facing text on all four surfaces (incl. persisted strings, read-time), (3) add one new non-destructive divergence affordance. The visual mockup contract is unchanged. The deterministic `blocker-chain.ts` engine is NOT edited — LEG-03 reads the verdict, never changes it.
</domain>

<decisions>
## Implementation Decisions

### LEG-01 — Reader tab deep-link mechanism
- **D-01:** Open↗ targets the `clarity-reader` detailTab (slot id confirmed in `src/manifest.ts:785`). Preferred path: research a **host-honored URL deep-link** first (e.g. `/<companyPrefix>/issues/<id>?tab=clarity-reader` or `#clarity-reader`). If the host honors it → use it (bookmarkable/shareable to the Reader). **This is the one flagged research item** — feasibility is unverified.
- **D-02:** Locked fallback (per SPEC, if the host cannot honor a URL tab-select): navigate to `/<companyPrefix>/issues/<id>` and have Clarity **auto-select the Reader tab on mount** (client-side intent). The bar is "user sees the inline-resolved Reader, never the classic wall" — never leave the user on the classic tab as the terminal destination.
- **D-03:** Auto-select the Reader tab **once, on the Open↗ landing only**. If the user manually switches back to the classic tab afterward, leave them there — do not fight the user, no sticky/global Reader preference.
- **D-04:** Applies to all four Open↗ sites identically: Reader cross-refs (`live-blocker-panel.tsx`), Situation Room rows (`employee-row.tsx`), the blocked-backlog expander (`blocked-backlog-expander.tsx`), and the Bulletin footer (`lineage-footer.tsx`). (`reply-in-place.tsx` is the 5th site noted in SPEC.) Routing uses `companyPrefix` from host context — no instance literals.

### LEG-03 — Divergence trigger definition
- **D-05:** "TL;DR reads done" = a **deterministic anchored regex over the existing `tldr_cache.body`** text (completion phrases like "is done / complete / shipped / merged / delivered / resolved"). NO schema change, NO new AI dependency — fits LEG-03's "reads the verdict, deterministic" constraint. (`tldr_cache` has only free-text `body` + `tags` text[]; no structured done field exists — migration `0002_tldrs_and_editor.sql`.)
- **D-06:** Tune for **high precision** — fire only on explicit completion phrases; tolerate missing some genuine done-but-blocked cases rather than cry wolf. A false prompt is low-harm (user clicks "Keep blocked") but frequent false prompts erode trust, so precision wins.
- **D-07:** Divergence = TL;DR-done signal (D-05) AND the engine's verdict is in the blocked family (per Phase 17's verdict classes — AWAITING_HUMAN / blocked). Degrade-safe: no TL;DR or no engine verdict → affordance simply absent (no false prompt).

### LEG-02(d) — Chat-chip render layer
- **D-08:** Humanize chat id-fragment chips at the **UI shared-helper render layer** — the same shared wording helper used for the other surfaces' render-scrub. Consistent with SPEC's "render-scrub all 4 surfaces" pattern; no worker/snapshot change (labels come from data already in the chat payload). Switch to worker-side resolution ONLY if research shows the payload lacks the needed labels.
- **D-09:** Resolve `CHT-<8>` → the topic's human **title/subject**; `run·<8>` → the agent's **name/role** (or "an agent" last resort). Keep a `CHT-NN` ordinal only when it is a real ordinal — **never** render the raw `id.slice(0,8)` hex slice (the current leak at `topic-strip.tsx:82`).

### Claude's Discretion
- **Shared wording helper home (LEG-02 4th HOW item):** default to a **single shared module** (co-located with / extending `src/shared/scrub-human-action.ts`) that owns: the "an agent" last-resort fallback (D wired behind real name/role resolution via the SR employee name-resolution path), the 4-surface render-scrub, the read-time persisted re-scrub, and the chat-chip humanization (D-08/D-09). One scrub vocabulary, reused everywhere. Planner may split if a clean boundary emerges, but the single-source intent is the decision.
- Exact completion-phrase list / regex anchoring for D-05/D-06 (biased to precision).
- The anchored extension of the NO_UUID_LEAK render-scan guard (`agent#<hex{6,}>` + bare UUID, NOT a blanket short-hex rule — must not false-positive on git SHAs) — mechanics are Claude's; the inversion of the currently-blessing tests is a locked SPEC acceptance item.
- "Looks done — close it?" affordance visual placement/styling (next to the TL;DR on Reader; on the SR needs-you row) within the unchanged mockup contract.
</decisions>

<specifics>
## Specific Ideas

- Live anchor for LEG-02 verification: Reader **BEAAA-972** currently reads "AWAITING AGENT STUCK — CEO stuck on agent#04fcac7c is stuck" — post-fix it must read a human name or "an agent" with no hash.
- The A1 "render literal 'an agent'" decision was specced in the superseded Phase-16 misscope but **never executed** — those plans are reusable input, not shipped code.
- LEG-03 affordance must be confirm-gated by construction ("Close as done" / "Keep blocked") — it never mutates issue state without an explicit confirm selection.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements (read FIRST)
- `.planning/phases/18-no-rabbit-holes-plain-english/18-SPEC.md` — the 3 locked requirements, boundaries, constraints, acceptance criteria, perf bound. Authoritative for WHAT.

### Reusable legibility input (mine, don't restart — per ROADMAP)
- `.planning/phases/_superseded-legibility-16-18-misscope/16-RESEARCH.md` — verdict-wording shared helper, focusLine-from-tldr enrichment, chat-chip humanization research.
- `.planning/phases/_superseded-legibility-16-18-misscope/16-PATTERNS.md` — pattern mapping for the same.
- `.planning/phases/_superseded-legibility-16-18-misscope/16-01-PLAN.md` … `16-04-PLAN.md` + `16-CONTEXT.md` — the never-executed A1 "an agent" / scrub plans (sound input).

### LEG-01 — Open↗ nav sites (re-point all)
- `src/ui/surfaces/reader/live-blocker-panel.tsx` (~:171) — Reader cross-ref Open↗
- `src/ui/surfaces/situation-room/employee-row.tsx` (~:238/453/508) — SR row Open↗
- `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx` (~:62)
- `src/ui/surfaces/bulletin/lineage-footer.tsx` (~:48)
- `src/ui/surfaces/_shared/reply-in-place.tsx` (~:227)
- `src/manifest.ts:785` — `clarity-reader` detailTab slot definition

### LEG-02 — scrub + chat chips
- `src/shared/scrub-human-action.ts` (fallback lines 65/66/71/78/86) — `agent#<8>` → "an agent"
- `src/ui/surfaces/chat/topic-strip.tsx:80-82` — `CHT-<8>` raw-hex slice leak
- migration `migrations/0002_tldrs_and_editor.sql` — `tldr_cache` schema (body + tags; no done field)

### LEG-03 — divergence affordance + perf
- `src/worker/situation/build-employees-rollup.ts` (~:384-390) — SR rollup; `focusLine = polishTldr(focusIssue.title)`, reads NO `tldr_cache` today. The batched O(1) needs-you TL;DR-done read lands here; perf-critical (Phase 16 hardened path).

### Deploy / governance
- `.planning/DEPLOY-RUNBOOK.md` — bookend (automated DO backup) + two-source version bump (BOTH `package.json` AND `src/manifest.ts`).

### Project memories (operator constraints)
- `paperclip-issue-url-pattern` — issue page is `/<prefix>/issues/<id>` (NOT `/<prefix>/<id>`).
- `clarity-pack-plugin-page-routes` — plugin pages mount at `/<companyPrefix>/<routePath>`.
- `plugin-version-bump-two-sources` — host reads `dist/manifest.js`; bump both sources.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/shared/scrub-human-action.ts` — existing single-scrub module; the natural home for the shared wording helper (D-08/D-09, "an agent" fallback, read-time re-scrub). One scrub vocabulary reused across surfaces.
- SR employee **name-resolution path** (used by Situation Room rows) — resolve real human name/role BEFORE the "an agent" last resort.
- `clarity-reader` detailTab slot already registered (`src/manifest.ts:785`) — LEG-01 targets an existing slot, no new contribution point.
- Phase 17 verdict pipeline ("one engine → one scrub → one verdict") — LEG-03 reads its blocked-family verdict; no engine edit.

### Established Patterns
- **Render-scrub / read-time re-scrub** pattern (SPEC LEG-02 a–e): regex over already-fetched strings, additive, no destructive migration. Chat chips (D-08) follow the same render-layer pattern.
- **Degrade-safe deterministic floor**: every new affordance/scrub renders correctly when the Editor-Agent/TL;DR cache is absent; no AI token in `blocker-chain.ts` (determinism + AI-token grep guards stay green).
- **NO_UUID_LEAK render-scan guard** already exists — extend (anchored), don't replace; invert the tests that currently bless `agent#<8>`.

### Integration Points
- LEG-03 SR-row signal introduces a `tldr_cache` read into `build-employees-rollup.ts` that does NOT exist today → MUST be a SINGLE batched read scoped to the needs-you set only (O(1) queries, not O(rows)/per-employee), degrade-wrapped (missing/slow read → drop affordance, never block/slow render). Phase 16 perf floor: cold p95 < ~5s (never 502), warm recompute < ~500ms (~492ms baseline).
- LEG-02(e) read-time re-scrub must add ZERO new DB fetches on the snapshot path — regex over already-fetched strings only.
- LEG-01 Open↗ uses `companyPrefix` from host context (no instance literals).
</code_context>

<deferred>
## Deferred Ideas

- Structured Editor-emitted "done" tag in `tldr_cache.tags` (more precise LEG-03 trigger than regex) — explicitly NOT chosen now (softer AI dependency, dormant on quiet queues). The deterministic regex (D-05) ships first; a tag could supersede it later without re-architecture.
- Action-cards async re-architecture / `ACTION_CARDS_ENABLED` — **Phase 19** (flag-gated, LOCKED last).
- Snapshot performance re-architecture — owned by Phase 16 (shipped); not re-opened.
- Non-additive/destructive migrations to rewrite historical persisted strings — out of scope; re-scrub on read instead.
- New visual design beyond text/label substitution + the one new affordance — mockup contract unchanged.

### Reviewed Todos (not folded)
None — no todos matched phase 18.
</deferred>

---

*Phase: 18-no-rabbit-holes-plain-english*
*Context gathered: 2026-06-13*
