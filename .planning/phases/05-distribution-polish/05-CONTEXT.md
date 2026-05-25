# Phase 5: Distribution & Polish — Context

**Gathered:** 2026-05-25 (power mode — file-based discussion via `05-QUESTIONS.html`)
**Status:** Ready for planning (`/gsd:plan-phase 5 --chunked`)

> **Context-mode note.** Phase 5 was expanded 4 → 10 plans on 2026-05-25 to absorb ALL deferred polish + 4 rc.7 forward defects into v1.0.0 final (rather than defer to v1.1). Plans 05-01 / 05-02 / 05-03 are already CODE-COMPLETE at rc.1 / rc.2 / rc.5; this CONTEXT.md covers the **7 remaining plans (05-04 .. 05-10)**. 23 design questions answered across 7 sections via the power-mode HTML companion. Four operator deviations from recommended defaults are flagged inline. Two backlog items DROPPED ON PRINCIPLE — task templates / smart-prefill — per memory `feedback_trust-the-clarification-loop` (the agent+chat+comment clarification loop IS the feature; pre-loading operator guesses works against it).

<domain>
## Phase Boundary

**Goal (verbatim from ROADMAP.md):** clarity-pack ships as a public npm package installable via `pnpm paperclipai plugin install clarity-pack` with a documented runbook, AC auto-status promoted from Phase 2's manual checklist to event-derived without breaking the manual UX, full-fidelity previewers replacing Phase 2's placeholder (xlsx → grid, pdf → embed, md → rendered, png → img), and lockfile audit + a11y pass + visual-regression baseline locked into CI.

**This CONTEXT covers 7 remaining plans:**
- **05-04** — Full-fidelity previewers + Visual-regression baseline (DIST-04 + Plan 05-02 deferred)
- **05-05** — Zero-rabbit-holes finishers (paused-agent banner + peek cards + picker-row dispatch)
- **05-06** — Phase 4.1 surface polish bundle (7 drill-deferred small fixes)
- **05-07** — Phase 4.2 polish bundle (4 rc.7 forward defects + D8 Back-after-deep-link + React-key warnings + D-03 fixture)
- **05-08** — Phase 4.1 power features (5 items; 2 dropped on principle)
- **05-09** — Tooling + infra cleanup (4 items)
- **05-10** — v1.0.0 final closure (version bump, npm publish, canonical ALL-paths drill)

**Out of scope (NOT in any Phase 5 plan):**
- Task templates and smart-prefill (DROPPED on principle — see `feedback_trust-the-clarification-loop` memory). The agent+chat+comment clarification loop is the feature; pre-loading operator guesses works against it.
- pdf.js advanced features (search, annotations, text-layer) — deferred to a future "Pro preview" mode if ever needed.
- Live-host visual regression in CI (Postgres + Paperclip dev-server bootstrap) — overkill for v1 audience of 1.
- Multi-tenant isolation, Clipmart submission, default-on for existing users — all explicitly out-of-scope per PROJECT.md.
</domain>

<decisions>
## Implementation Decisions

### Plan 05-04 — Full-fidelity previewers + Visual-regression baseline

- **D-01 (Q-01) xlsx → server-side conversion via worker handler.** NEW worker handler `deliverable.preview` returns the parsed grid; UI bundle stays at ~288 kB (does NOT inflate to ~800 kB by bundling SheetJS). UI receives `{kind: 'xlsx-grid', sheets: [{name, rows: string[][]}]}`. Worker enforces file-size guard centrally (single chokepoint). SheetJS lives in the worker only.
- **D-02 (Q-02) pdf → native `<embed type="application/pdf">`.** Zero JS deps; smallest blast radius. No search / no scroll-sync with comments (acknowledged trade-off). If pdf.js features are ever needed, scope to a "Pro preview" mode in a future milestone — NOT v1.
- **D-03 (Q-03) md → react-markdown.** Keeps the no-`dangerouslySetInnerHTML` invariant (check-a11y R3 stays untouched). ~50 kB UI bundle delta. Add as runtime dep.
- **D-04 (Q-04) Visual-regression infra = Playwright + static-sketch image snapshots.** Playwright as devDep; loops over `sketches/*.html`; diffs against `test/visual/baselines/<sketch>.png`. Catches design-system / token / theme drift. 4 sketches → 4 baselines. New script `pnpm visual:update` to regenerate. NEW CI workflow `.github/workflows/visual-regression.yml` uploads diff image as artifact on failure.
- **D-05 (Q-05) Visual-regression CI cadence = every PR.** Same lane as existing lockfile + a11y checks. ~40s overhead per PR. Failure is hard; uploaded diff is the review artifact.

### Plan 05-05 — Zero-rabbit-holes finishers

- **D-06 (Q-06) Paused-agent banner appears on BOTH chat header AND Reader top-of-tab.** Same component, two mount sites. Reuses Plan 04.1-10's inline `▶ Resume heartbeat` row pattern (NOT the editor-only `pause-banner.tsx` with "Resume in agent panel" copy). The existing editor-agent-only [src/ui/surfaces/reader/pause-banner.tsx](src/ui/surfaces/reader/pause-banner.tsx) stays; new generic banner is a new file (e.g., `src/ui/primitives/agent-pause-banner.tsx`) consumed by both surfaces. Reader's continue-in-chat button pairs with the banner (disabled state when paused).
- **D-07 (Q-07) Three distinct copies per pause cause** **[DEVIATION FROM RECOMMENDED]**. Operator wants precise reason per cause:
  - heartbeat-pause (operator clicked Pause): `<name> paused by operator — ▶ Resume heartbeat`
  - budget exhausted: `<name> stopped — budget exhausted; check budget caps — ▶ Resume heartbeat`
  - codex adapter failure: `<name> stopped — codex adapter error <HH:MM>; ▶ Retry heartbeat`
  Worker handler must return the pause reason as a discriminated union (`{cause: 'operator' | 'budget' | 'adapter', detail?}`). UI dispatches copy on `cause`.
- **D-08 (Q-08) Ref-chip peek card = HOVER-only.** Click still navigates to `/<companyPrefix>/issues/<identifier>` (the existing [ref-chip.tsx](src/ui/primitives/ref-chip.tsx) anchor contract is preserved). Peek appears on hover. Mobile fallback: long-press. Two-input model: "glance vs commit".
- **D-09 (Q-09) Ref-chip peek card content = title + status + owner + first line of description (≤120 chars)** **[DEVIATION FROM RECOMMENDED]**. Operator wants a peek useful enough to ACTUALLY avoid the navigation, not just a teaser. `resolve-refs` worker handler must extend payload to return `description_excerpt: string | null` (first line, truncated to 120 chars). Owner is the assignee display name (NEVER a UUID — D-08 from 04.2-07 hygiene pattern).
- **D-10 (Q-10) GAP-PICKER-ROW-DISPATCH fix = extend `buildTopicDeepLink` to carry employee.** Add optional `employeeUserId` param to `buildTopicDeepLink` (in `src/ui/surfaces/chat/deep-link.mjs` / `.d.mts`); picker passes it; chat-surface dispatch (Plan 04.2-04) unchanged. **Plan MUST include a full audit of every `buildTopicDeepLink` caller** (per Plan 05-05 stub) — fix any other paths that hit the same gap. Matches D-07 (04.2-07) contract spirit: server-resolved identity, never UUID, never partial deep-link.

### Plan 05-06 — Phase 4.1 surface polish bundle

- **D-11 (Q-11) Pin/Unpin = silent toggle + clarity-pack toast.** Mirror `chat.topic.archive` toggle shape from Plan 04.1-05. Toasts: "Message pinned" / "Message unpinned". No modal. Reversible action = no confirmation.
- **D-12 (Q-12) Pinned-chip flash-highlight = 1.5s.** Matches Plan 04.2-04's deep-link scroll-and-flash. Reuse `.flash-highlight` CSS class (do not duplicate). Apply on right-rail pinned-chip click → scroll to source comment + flash.

### Plan 05-07 — Phase 4.2 polish bundle

- **D-13 (Q-13) D8 Browser-Back = preserve hash on consume; chat-state survives Back.** Do NOT call `nav.replace` to strip the URL_HASH on consume. Let the hash sit; Back navigates to the previous Paperclip page; Forward returns to chat with hash intact. URL is honest about app state. Removes the existing `nav.replace` side-effect that drops chat-state. Affects the deep-link consume code path in `src/ui/surfaces/chat/index.tsx` (around the `parseChatDeepLink` consume site).
- **D-14 (Q-14) React-key warnings = fix ALL 5 components in this plan.** ContextRail / PersistedMessage / TrueTaskDialog / AnchoredToCards / ChatPageBody. One commit per component (5 commits). Closes the rc.3-era console noise in v1.0.

### Plan 05-08 — Phase 4.1 power features

- **D-15 (Q-15) Archive full-view = NEW route `/<companyPrefix>/clarity-pack/archive`.** Full-screen list; bulk-select checkboxes; search + filter by employee. Bookmarkable. Matches existing clarity-pack route pattern (`/COU/bulletin`, `/COU/situation-room`). NEW page-slot entry in `manifest.ts` with `routePath: "archive"`.
- **D-16 (Q-16) Bulk-unarchive = silent + count toast.** "N topics unarchived" toast. Reversible (CTT-07 invariant — host issue untouched), no confirmation needed regardless of N. Matches single-row unarchive UX.
- **D-17 (Q-17) Cold-task-from-global = top-right header bar on all four clarity-pack surfaces.** Reader / Situation Room / Bulletin / Chat — standardized affordance. Reuses Plan 04.1-02's `+ Create task` button surface logic. Lives in a shared header component (likely `clarity-surface-root.tsx` or a new `clarity-surface-header.tsx`).
- **D-18 (Q-18) Diagnostics toggle scope = per-topic (persisted in localStorage keyed by topic id).** Topic A ON, Topic B OFF. Survives page reload. Use case: investigating one buggy topic while staying clean elsewhere. Storage key shape: `clarity:diagnostics:<topic-id>` (single boolean per topic).
- **D-19 (Q-19) Composer shortcuts overlay = `?` key in COMPOSER ONLY → inline popover** **[DEVIATION FROM RECOMMENDED]**. Operator wants tighter, composer-scoped surface rather than a global modal. Popover anchors to composer; `?` press inside the composer triggers it (must not interfere with literal `?` typing — only opens on bare `?` keypress when textarea is otherwise neutral, OR on a specific shortcut like Shift-? / `?` on its own line). Lists all chat shortcuts (⌘T true task, ⌘K paste etc.). NOT a global `?` listener on clarity-pack surfaces.
- **D-20 (Q-20) Storage-pin semantics = topic exempt from archive.** Pinned topics SKIP automatic and manual archive. Wires the existing static right-rail "Storage Pin" card to a real `chat.topic.pin` toggle handler (mirror `chat.topic.archive` from Plan 04.1-05). Does NOT change sort order (NOT "pin to top"). NEW migration `migrations/0010_chat_topics_pinned.sql` adding additive boolean `pinned_at timestamptz NULL` to `chat_topics` (or equivalent — planner picks exact shape).

### Plan 05-09 — Tooling + infra cleanup

- **D-21 (Q-21) VPS scripts sync = documented `git pull` step in operator-gotchas runbook.** Operator runs `cd ~/clarity-pack && git pull` before each drill. Add entry to `runbook/operator-gotchas.md`. Zero new tooling. Matches existing operator-discipline patterns.
- **D-22 (Q-22) Windows max-path fix = relocate `fake-paperclip-clone` fixture out of worktreed tree.** Move from `scripts/safety/test/fixtures/fake-paperclip-clone/` to a new location excluded from worktree spawn (e.g., `test/fixtures/external/` with `.gitattributes export-ignore`, or a symlink emitted at test setup time). Planner picks exact mechanism. Root-cause fix; eliminates the recurring worktree spawn failure on Windows.

### Plan 05-10 — v1.0.0 final closure

- **D-23 (Q-23) Rollback rehearsal SKIPPED for v1.0.0** **[STRONG DEVIATION FROM RECOMMENDED — see Specific Ideas + canonical_refs]**. Phase 5 closure drill will NOT include a `1.0.0 → rc.7 → 1.0.0` round-trip. Operator's call: trust the Phase 1 bookend snapshot/restore loop as the SOLE recovery path for the v1.0.0 ship. Rationale: dozens of drills have validated the bookend loop already; the rollback rehearsal is incremental safety on top of an already-PASSED safety net; v1 audience is just Eric; speed > redundant verification. Plan 05-10 closure drill scope reduces to: install 1.0.0 → COEXIST #6 byte-identical check → VERIFICATION.md write → ROADMAP/REQUIREMENTS final flip. The `1.0.0-rc.7 → 1.0.0` forward install IS still part of the drill; only the reverse rehearsal is dropped.

### Implicit decisions (no work, just keep)

- **D-24 Reader's deferred-message text "Phase 5 (DIST-04)" remains valid until Plan 05-04 ships.** reader-view.test.mjs locks the substring; Plan 05-04 must update both the placeholder AND the test in the same commit.
- **D-25 sketches/*.html stay frozen during v1.0.0.** Visual-regression baselines are taken from them; updating a sketch mid-cycle without re-baselining will hard-fail every PR.
- **D-26 Plans 05-01 / 05-02 / 05-03 stay closed.** This CONTEXT does not re-open them. Their decisions are locked in their existing SUMMARY.md files.
- **D-27 npm publish gating.** `npm publish` requires Eric's npm credentials. Plan 05-10 must gate the publish step on operator login; the rest of the plan (version bump, drill, VERIFICATION.md) runs in the same session and the publish is a final manual step.

### Claude's Discretion (planner picks)

- Exact name / location of the generic paused-agent banner component (`src/ui/primitives/agent-pause-banner.tsx` vs `src/ui/surfaces/shared/agent-pause-banner.tsx`).
- Exact peek-card popover implementation (Radix `<HoverCard>` vs custom div with mouseenter/leave). Whatever pattern Plan 04.2-04 already uses for `reverse-topics-link.tsx` is preferred for consistency.
- Whether D-09's `description_excerpt` truncation happens worker-side (preferred — central budget) or UI-side.
- Exact migration shape for D-20 storage-pin (`pinned_at timestamptz NULL` vs `pinned boolean DEFAULT false` — pick the one matching existing `archived_at` shape from Plan 04.1-05).
- Exact `?` keypress detection logic for D-19 (composer-scoped) — must not fire when the operator literally types `?` in message body. Likely solution: detect `?` only when composer is empty OR with a modifier; planner experiments.
- Whether D-22 Windows fix uses `.gitattributes` export-ignore or a setup-time symlink — pick the one that doesn't break CI Linux runs.
- Order of plan execution. Suggested order based on dependencies: 05-09 (tooling — independent), 05-04 (previewers — independent), 05-05 (zero-rabbit-holes — touches deep-link.mjs), 05-06 (Phase 4.1 polish — touches chat surface), 05-07 (Phase 4.2 polish — touches chat + Reader), 05-08 (power features — depends on 05-05/05-06 settling shared surfaces), 05-10 (closure — gates on all above).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner) MUST read these before planning or implementing each sub-plan.**

### Phase 5 ROADMAP entry + prior closures
- `.planning/ROADMAP.md` §"Phase 5: Distribution & Polish" (lines 163-188) — Goal, success criteria, all 10 plan stubs with locked scope and dropped items.
- `.planning/phases/05-distribution-polish/05-01-SUMMARY.md` — DIST-01 + DIST-02 closed at rc.1.
- `.planning/phases/05-distribution-polish/05-02-SUMMARY.md` — DIST-05 (lockfile + a11y) + COEXIST-05 closed at rc.2; visual-regression deferred to 05-04 (now resumed in D-04).
- `.planning/phases/05-distribution-polish/05-03-SUMMARY.md` — DIST-03 AC auto-status closed at rc.5.
- `.planning/phases/05-distribution-polish/05-04-PLAN.md` — Pre-existing plan stub with Q1-Q5 (now answered as D-01..D-05).

### Forward-defect sources (Plans 05-05 + 05-07 must read)
- `.planning/phases/04.2-reader-chat-bridge/04.2-07-SUMMARY.md` — rc.7 drill outcome; 4 forward defects routed here (GAP-D8-LINEAGE-TOOLTIP, GAP-D8-REVERSE-TOOLTIP-FALLBACK, GAP-PICKER-ROW-DISPATCH, GAP-RCB-05-CHIP-STYLING).
- `.planning/phases/04.2-reader-chat-bridge/04.2-CONTEXT.md` — Phase 4.2 addendum context; D-7 routing + D-8 hygiene pattern lockdown that Plan 05-07 builds on.
- `.planning/phases/04.2-reader-chat-bridge/04.2-06-SUMMARY.md` — D9/D10 UUID-leak hygiene pattern (`ctx.agents.get` + `ctx.issues.get` server-side display-name resolution) — D-07 + D-09 of THIS plan must follow it.
- `.planning/phases/04.2-reader-chat-bridge/04.2-VERIFICATION.md` — RCB-01..RCB-07 closure baseline; do NOT regress.

### Deferred-from-4.1 + power feature sources (Plans 05-06 + 05-08)
- Project memory `phase-4.2-deferred-from-4.1` §"Deferred from Plan 04.1-10/04.1-11 drill (2026-05-21)" — Plan 05-06's seven small fixes.
- Project memory `phase-4.2-deferred-from-4.1` §"Workflow" + §"Chat surface" — Plan 05-08's power features (less the dropped task templates / smart-prefill).
- Project memory `feedback_trust-the-clarification-loop` — WHY task templates + smart-prefill were dropped. Plan 05-08 MUST NOT re-introduce them.

### Existing primitives being modified
- `src/ui/surfaces/chat/deep-link.mjs` + `deep-link.d.mts` — `buildTopicDeepLink` (D-10 extension target). URL_HASH carrier contract (Plan 04.2-03) preserved.
- `src/ui/primitives/ref-chip.tsx` — anchor pattern (D-08 hover-peek addition). Plan 02-09's `useResolvedUserId` bootstrap pattern preserved.
- `src/ui/surfaces/reader/pause-banner.tsx` — editor-only, KEEP unchanged (D-06's new generic banner is a NEW file).
- `src/ui/surfaces/reader/deliverable-preview.tsx` — Phase 5 placeholder (D-01..D-04 replace). reader-view.test.mjs literal "Phase 5" lock — update test in same commit.
- `src/worker/handlers/resolve-refs.ts` — D-09 must extend payload to include `description_excerpt`.
- `src/ui/surfaces/chat/archive-panel.tsx` — D-15 archive full-view extends pattern; D-20 storage-pin uses parallel toggle shape.

### Phase 1 safety + runbook (Plan 05-10 + Plan 05-09)
- `runbook/operator-gotchas.md` — D-21 VPS scripts sync entry goes here; D-09 (04.2-07) §ac-autostatus-drill-proof already there.
- `.planning/phases/01-pre-install-safety/01-VERIFICATION.md` — bookend snapshot/restore loop verified; D-23 relies on this as SOLE v1.0.0 recovery path.
- Project memory `countermoves-safety-cli-invocation` — VPS clarity-pack scripts partial state that D-21 is fixing.
- Project memory `paperclip-issue-url-pattern` — `/COU/issues/<identifier>` canonical pattern that D-08 ref-chip click navigation honors.

### Trust model + invariants (every plan)
- `CLAUDE.md` "Stack pins are forced by the plugin contract" — React 19 peer-only, no bundled React, no second Tailwind, esbuild presets.
- `CLAUDE.md` "Coexistence guarantees" #3 (additive-only schema) + #6 (clean uninstall preserves data) — D-20 storage-pin migration MUST be additive; D-23 rollback-skip relies on snapshot, but additive migration still required.
- `CLAUDE.md` "Bookended-by-snapshots rule" — D-23 EXPLICITLY narrows v1.0.0 closure to one snapshot bookend; the rule itself stays unchanged for future milestones.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Inline-resume-row pattern (Plan 04.1-10)** — REUSED for D-06/D-07 generic paused-agent banner's `▶ Resume heartbeat` affordance. Same JSX shape, same `chat.topic.resume`-style handler shape.
- **Archive toggle shape (Plan 04.1-05 `chat.topic.archive`)** — REUSED for D-11 Pin/Unpin AND D-20 storage-pin. Same toggle semantics, same toast pattern.
- **Deep-link scroll-and-flash (Plan 04.2-04, `.flash-highlight` class)** — REUSED for D-12 pinned-chip click. Do NOT duplicate the CSS class.
- **`useResolvedUserId` resolver (Plan 02-09)** — REUSED in any new UI consuming `editor.pause-status`-like handlers (D-06 generic banner). Detail-tab `userId === null` race avoidance.
- **`reverse-topics-link.tsx` popover (Plan 04.2-04 / 04.2-07 D-02)** — Implementation pattern reference for D-08 hover-peek on `ref-chip.tsx` (whatever popover pattern is used there should be the same here for consistency).
- **`useHostNavigation` + `nav.linkProps`** — already used by `ref-chip.tsx`; D-15 archive route must use it (NO raw `<a href>` — SCAF-09 + ESLint `no-raw-anchor`).
- **Worker handler `resolve-refs.ts`** — already returns id + status; D-09 extension adds `description_excerpt` field. Single-round-trip contract (PRIM-01) preserved.
- **Manifest `routePath:` slot type** — D-15 archive route extends existing pattern (`bulletin`, `situation-room`).
- **`migrations/0009_chat_topics_origin_issue.sql`** — Pattern reference for D-20 storage-pin additive column.

### Established Patterns
- **`paperclipPlugin` package.json shape** — Plans 05-04/05-05/05-08 all add dependencies or migrations. `peerDependencies` stays React-19-peer-only; `dependencies` is fair game for `react-markdown` (D-03) and any new server-side xlsx lib (D-01 worker-side only).
- **Bundle size discipline** — UI bundle currently 288 kB. D-01 server-side conversion preserves this. D-03 `react-markdown` adds ~50 kB. D-09 `description_excerpt` is bytes-per-render trivial.
- **Server-side display-name resolution (D-07, D-09 + 04.2-06 D9/D10 pattern)** — `ctx.agents.get` for assignee names, `ctx.issues.get` for BEAAA-NNN identifiers, NEVER fall back to UUID in operator-visible text.
- **CTT-07 invariant (Plan 04.1-07 closure)** — Plugin actions never modify `public.issues.updated_at`. D-15/D-16/D-20 archive + pin operations must all stay plugin-side.
- **`check-css-scope` + `check-a11y` gates** — Every plan must pass both. D-15 archive route MUST have axe-clean a11y; D-19 composer popover MUST not violate R3 dangerouslySetInnerHTML rule.

### Integration Points
- **Reader's `deliverable` section** — Plan 05-04 swaps placeholder for real previewer dispatch. Single integration point in `src/ui/surfaces/reader/index.tsx` line ~330.
- **`buildTopicDeepLink` callers** — Plan 05-05 D-10 must audit all of them. Known callers: continue-in-chat-button.tsx, reverse-topics-link.tsx, picker row dispatch. The audit IS the load-bearing work.
- **Chat surface header** — Plans 05-05 (banner), 05-06 (LIVE sticky), 05-08 (cold-task button) all touch this. Coordinate to avoid merge conflicts; consider a shared `chat-surface-header.tsx` extraction if friction emerges.
- **Right-rail of chat surface** — Plans 05-06 (pinned-chip click), 05-08 (storage-pin live wiring) both touch this. Same coordination concern.
- **Migrations sequence** — D-20 storage-pin is `migrations/0010_*.sql`. Sequential after current `0009`. Plan 05-08 introduces.
- **CI workflows** — D-05 visual-regression adds `.github/workflows/visual-regression.yml`. Coexists with lockfile + a11y workflows from Plan 05-02.

### Constraints
- Windows max-path discipline (D-22) — applies to all new test fixtures.
- esbuild presets stay unchanged. D-01 server-side xlsx loads SheetJS in the WORKER bundle (Node target); UI bundle target preserved.
- `react-markdown` (D-03) goes in `dependencies` (not `peerDependencies`) — host has no opinion on it.
</code_context>

<specifics>
## Specific Ideas

### Operator deviations from recommended defaults (4)

1. **D-07 (three distinct pause-cause copies, not single).** Eric values precise diagnostic information at the surface where the action lands. Single-copy was easier to ship but loses signal. Implementation cost is ~3 strings + a discriminated union in the worker handler — acceptable trade for the operator clarity.

2. **D-09 (ref-chip peek includes description first line, not just title+status+owner).** Eric explicitly wants the peek to be useful enough to ACTUALLY avoid the navigation, not just tease it. Adds `description_excerpt` field to `resolve-refs` payload. ~120 bytes per ref. Worker truncates to keep budget bounded.

3. **D-19 (composer-scoped `?` popover, not global `?` modal).** Eric wants the discoverability surface co-located with the action context. Global modals interrupt; inline popovers stay in flow. Trade-off: less discoverable for a brand-new operator. Acceptable because v1 audience = Eric.

4. **D-23 (skip rollback rehearsal entirely).** Eric's strongest deviation. Trusts the Phase 1 bookend snapshot/restore loop as the SOLE recovery path for v1.0.0 ship. Speed > redundant verification given the loop has PASSED multiple drills. Plan 05-10 closure drill is correspondingly shorter — ~10 min saved. **This is a memorable operator call worth filing in MemPalace `clarity_pack/decisions` so future v1.1+ ships don't accidentally re-introduce the rehearsal as default.**

### Hard scope guardrails

- **DROPPED on principle: task templates + smart-prefill.** Per memory `feedback_trust-the-clarification-loop`. Any planner suggesting "scaffolding for the operator to fill in" violates this. If a clarification surface is needed, the operator types it into chat — that IS the loop.
- **5 power features in Plan 05-08, NOT 7.** Two items dropped: task templates, smart-prefill. The other 5 (storage-pin, archive full-view, cold-task-from-global, diagnostics memory, composer shortcuts overlay) ARE in scope.
- **No new pause copy in editor-only `pause-banner.tsx`.** That file is locked by reader-view.test.mjs's "Editorial Desk paused — last compile failed at" string assertion. D-06's generic banner is a NEW file; editor-agent continues to use the existing one with its own copy.

### Verbatim from CLAUDE.md (relevant constraints)

- *"v1 audience is Eric on BEAAA only — single private install"* — drives D-23 (skip rollback rehearsal), D-04 (static-sketch regression not live-host), D-19 (composer-scoped, not global discoverability).
- *"Coexistence guarantee #3 — Schema is additive-only; plugin disable leaves data intact"* — D-20 storage-pin migration MUST be additive (`ALTER TABLE ... ADD COLUMN ... NULL`).
- *"Same-origin trust model"* — D-01 server-side xlsx (worker bundle) doesn't change this; UI bundle stays trusted-JS at current weight.

### Operator-driven prioritization signal

Eric chose the recommended option 19/23 times (83%). Deviations cluster around (a) ergonomic surface decisions (D-07, D-09, D-19) where he wants more signal per surface, and (b) the closure-cost decision (D-23) where he wants less ceremony given existing safety nets. This is consistent with the `feedback_gsd-velocity-recalibration` memory profile — fast cadence, deep trust in established mechanisms.
</specifics>

<deferred>
## Deferred Ideas

### Permanently dropped (do not re-suggest)
- **Task templates** for `+ Create task` — dropped on principle per `feedback_trust-the-clarification-loop` memory. The clarification loop IS the feature.
- **Smart-prefill** for new chat topics — same principle, same reason.

### Punted to v1.1+ (not v1.0)
- **pdf.js advanced features** (search, annotations, text-layer) — would be a "Pro preview" mode in a future milestone. D-02 native `<embed>` is the v1 ship.
- **Live-host visual regression in CI** — overkill for v1 audience of 1. D-04 static-sketch is the v1 ship; live-host re-evaluated if multi-user audience emerges.
- **Storybook + Chromatic** for visual regression — same reasoning as live-host; SaaS dependency we don't need yet.
- **Global `?` modal cheatsheet** (D-19 alternative) — if a brand-new operator ever lands, revisit. v1 = composer-scoped popover only.
- **Three-pane archive layout** (D-15 alternative) — not v1; route is bookmarkable and works for one operator. Multi-pane reconsidered when archive volume justifies it.
- **Confirmation prompts on bulk operations** (D-16 alternative) — not v1; reversible operations don't earn confirmations.
- **Auto-sync VPS scripts via install-helper.sh hook** (D-21 alternative) — silently mutating VPS state is a footgun. Stays documented operator step.
- **Rollback rehearsal for v1.0.0** (D-23 alternative) — explicitly skipped for v1.0.0. Re-add as default for v1.1+ if operator team grows beyond Eric OR if any v1.0.0 install/uninstall drill exposes a recovery gap.

### Reviewed but not folded
- None — all 23 questions answered without "chat-more" override; all matched a sub-plan within Phase 5.

### Captured in MemPalace `clarity_pack/decisions` (to be filed after CONTEXT.md commit)
- `phase-5-discuss-power-mode-2026-05-25` drawer — 4 operator deviations + the dropped-on-principle items + Q-23 rationale (rehearsal skip).
</deferred>

---

*Phase: 05-distribution-polish*
*Context gathered: 2026-05-25 (power mode — 23 questions, 7 plans, 4 deviations)*
*Next: `/gsd:plan-phase 5 --chunked`*
