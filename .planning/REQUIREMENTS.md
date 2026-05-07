# Requirements: Clarity Pack

**Defined:** 2026-05-07
**Core Value:** Zero rabbit-holes — every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

## v1 Requirements

Requirements for the Clarity Pack v1 milestone (the four surfaces + Editor-Agent + safe rollout against the live BEAAA Paperclip instance). Each maps to exactly one roadmap phase.

### Pre-Install Safety (SAFE)

The discipline that lets us touch a live Paperclip install without unbounded blast radius.

- [ ] **SAFE-01**: One-command snapshot script captures, before any clarity-pack action: a Postgres dump of the Paperclip database, a filesystem archive of Paperclip's data directory (work products, plugin install dir, runtime state), the current Paperclip version, and the list of currently installed plugins — all into a single timestamped archive.
- [ ] **SAFE-02**: One-command restore script reverses any snapshot byte-for-byte; restore must be rehearsed against a non-production Paperclip clone at least once before any clarity-pack feature code touches BEAAA.
- [ ] **SAFE-03**: Smoke-test script verifies a restored snapshot is functionally equivalent to the pre-snapshot environment: Paperclip starts, REST API answers, sample issue is listable, an agent heartbeat fetch succeeds, the employee list renders.
- [ ] **SAFE-04**: Runbook documents the pre-flight → install → post-install verification → rollback flow in plain English; lives in `runbook/` in this repo, not as plugin code, so it works even when clarity-pack is broken or uninstalled.
- [ ] **SAFE-05**: Pre-flight gate refuses to run any install/upgrade/migration/agent-registration step if no snapshot has been taken in the last N minutes (default 15) or if the most recent snapshot's restore-and-smoke-test has not passed.

### Plugin Scaffold + Trust-Model Hardening (SCAF)

The day-1 hardening that has to land before any feature surface ships, per the same-origin trust model.

- [ ] **SCAF-01**: Single npm package with one Paperclip plugin manifest declaring all four surfaces from one UI bundle (no per-surface plugins).
- [ ] **SCAF-02**: Build toolchain matches the forced stack — TypeScript ^5.7.3, esbuild ^0.27.3, ESM-only (`"type": "module"`), Node ≥20; React 19, react-dom, `react/jsx-runtime`, and `@paperclipai/plugin-sdk/ui` + `…/ui/hooks` are externalized (peer-only, never bundled).
- [ ] **SCAF-03**: `pnpm paperclipai plugin install clarity-pack` succeeds end-to-end against a local Paperclip clone; the smoke spike resolves the `detailTab` vs `taskDetailView` slot conflict and the plugin-owned-migrations conflict before any feature code is written.
- [ ] **SCAF-04**: `pnpm-lock.yaml` is committed and pinned; CI fails on any direct or transitive dependency that ships a `postinstall` script; monthly `pnpm audit` runs in CI.
- [ ] **SCAF-05**: ESLint rule fails CI on raw `fetch()` to any Paperclip host path from `src/ui/**`; all UI data access goes through `usePluginData` / `usePluginAction` bridge hooks.
- [ ] **SCAF-06**: All plugin CSS is scoped to `[data-clarity-surface]`; visual regression test catches CSS bleed-through into host UI.
- [ ] **SCAF-07**: Lifecycle-aware poll primitive (visibility guard via `document.visibilityState`, single-leader election via `BroadcastChannel`, content-hash dedupe, exponential backoff on `WORKER_UNAVAILABLE`) lives in `src/ui/primitives/usePoll.ts` and is the only sanctioned polling pattern.
- [ ] **SCAF-08**: Theme tokens, state pill component, and reference chip component live in `src/ui/primitives/`; match the four mockups (Geist + Geist Mono + Instrument Serif fonts; warm-dark palette; no neon).
- [ ] **SCAF-09**: SPA navigation in every surface uses `useHostNavigation().linkProps()` — raw `<a href>` is lint-banned to host paths.

### Per-User Opt-In (OPTIN)

Coexistence guarantee #1 — implemented inside the plugin since Paperclip has no host-level per-user toggle.

- [ ] **OPTIN-01**: `clarity_user_prefs` table created via the plugin's own namespace migration; primary key `(user_id)`; default behaviour = absence-of-row means opted-OUT.
- [ ] **OPTIN-02**: `useOptIn()` React hook reads opt-in state and gates every surface's render — when opted-out, surface renders an inline "Enable Clarity Pack" CTA, not the feature content.
- [ ] **OPTIN-03**: Settings page lets the current user toggle Clarity Pack on/off for themselves; never writes a default-ON row for any other user.
- [ ] **OPTIN-04**: Server-side opt-in check is enforced in every `ctx.data.register` (`getData`) handler and every `ctx.actions.register` (`performAction`) handler — UI gating alone is not sufficient under the same-origin trust model.
- [ ] **OPTIN-05**: Default landing is the Paperclip classic dashboard; Clarity Pack views are opt-in clicks, not redirects or overrides.

### Shared Primitives (PRIM)

Reused by every surface — built first in Phase 1 because Reader view, Situation Room, Bulletin, and Chat all consume them.

- [ ] **PRIM-01**: Batch reference resolver in `src/shared/reference-resolver.ts` resolves an array of `BEAAA-NNN` IDs in one round-trip (no N+1); returns `{id, title, status, owner, excerpt}` per reference.
- [ ] **PRIM-02**: Reference resolver respects viewer permissions — never leaks title/excerpt for a reference the current user cannot see in classic Paperclip UI.
- [ ] **PRIM-03**: Blocker-chain flattener in `src/shared/blocker-chain.ts` is **deterministic graph code** (DFS over an explicit edge set; LLM is permitted only to write prose summarizing the result, never to choose terminals).
- [ ] **PRIM-04**: Blocker-chain flattener detects cycles and emits a typed `Cycle` terminal rather than infinite-looping or silently truncating.
- [ ] **PRIM-05**: Blocker-chain flattener emits a typed terminal taxonomy: `HUMAN_ACTION_ON(user_id)` | `SELF_RESOLVING(eta)` | `EXTERNAL` | `CYCLE`. Every chain ends in exactly one terminal.
- [ ] **PRIM-06**: TL;DR types and a shared `tldr_cache` schema live in `src/shared/types.ts`; same types consumed by the worker handler and every surface that renders a TL;DR.

### Editor-Agent (EDITOR)

The single Paperclip employee that produces every TL;DR, critical-path narrative, and bulletin.

- [ ] **EDITOR-01**: Editor-Agent is declared in the manifest's `agents[]` array and reconciled per-company via `ctx.agents.managed.reconcile()` — never via a custom `setInterval` / DIY heartbeat.
- [ ] **EDITOR-02**: Editor-Agent uses `@paperclipai/mcp-server@^0.1.0` (run via `npx -y @paperclipai/mcp-server`) for issue, comment, document, and heartbeat-context reads.
- [ ] **EDITOR-03**: Every Editor-Agent compile is idempotent — keyed on `(surface, scope_id, content_hash)`; re-running with unchanged inputs is a no-op.
- [ ] **EDITOR-04**: Editor-Agent filters its own `actor_type=plugin` + `actor_id=clarity-pack-editor-agent` events from its own triggers to prevent self-loops (TL;DR write → `issue.updated` → TL;DR write).
- [ ] **EDITOR-05**: Hard `max_tokens` cap per LLM call; circuit breaker pauses the agent after 3 consecutive failures and surfaces a banner instead of silent retry.
- [ ] **EDITOR-06**: Editor-Agent inherits Paperclip's heartbeat, budget caps, pause/terminate, and audit log automatically — verified by a coexistence test that pausing the agent in Paperclip's classic UI actually halts compile output.

### Surface 1 — Task Detail Reader View (READER)

Additional tab on every issue page; never replaces classic UI.

- [ ] **READER-01**: Reader view contributes to the `detailTab` slot with `entityTypes: ["issue"]` (or `taskDetailView`, depending on which the live-instance spike confirms renders next to classic Paperclip tabs).
- [ ] **READER-02**: TL;DR strip at the top of the tab with a "regenerated when the task body changes" freshness stamp.
- [ ] **READER-03**: All `BEAAA-NNN` references in the prose render as inline reference chips showing ID + status badge.
- [ ] **READER-04**: An "Anchored to (resolved)" section renders one ref-card per upstream reference with title + owner + status pill + a substantive excerpt quote — no clicking through to read the source task.
- [ ] **READER-05**: A "The deliverable" inline preview block renders the artifact name + last-write timestamp + a v1 placeholder preview (XLSX/PDF full-fidelity preview is deferred to Phase 4).
- [ ] **READER-06**: Goal ancestry breadcrumb at the top (project → milestone → parent issue → this task).
- [ ] **READER-07**: Acceptance criteria checklist with manual marking; auto-status from acceptance-criteria text + acceptance-event log is deferred to Phase 4.
- [ ] **READER-08**: Right-rail "Live blocker · on you" panel renders the blocker-chain terminal as a single one-click action (matches the mockup's `⚑ ON YOU` callout).
- [ ] **READER-09**: Activity timeline ("distilled") summarizes the most relevant N events, not the full audit log.

### Surface 2 — Situation Room (ROOM)

Live ops cockpit at a dedicated route.

- [ ] **ROOM-01**: Situation Room contributes to the `page` slot at a top-level route; renders one card per Paperclip employee in a single grid.
- [ ] **ROOM-02**: Top "Critical Path" strip resolves three chains (max) ending in `HUMAN_ACTION_ON(eric)`, `SELF_RESOLVING`, or both — with one-line plain-English narration each.
- [ ] **ROOM-03**: Each agent card shows: role + state pill (Working / Stuck / Awaiting You / Standby / Awaiting peer) + age + "now doing" line + blocker chain + latest artifact + 7-day velocity sparkline.
- [ ] **ROOM-04**: "Artifacts shipped today" shelf at the bottom with inline preview snippets — no rabbit-holing into the work-product detail page for first-look reading.
- [ ] **ROOM-05**: A worker-side `recompute-situation` job materializes a snapshot row every 60s; UI uses `usePluginData` with `refetchInterval: 60_000`. The 60s figure is the v1 default; cadence is exposed as `instanceConfigSchema` so the 30s mockup figure can be enabled without a code change.
- [ ] **ROOM-06**: UI polling pauses when `document.visibilityState !== "visible"`; resumes (with a fresh content-hash check) on visibility return.
- [ ] **ROOM-07**: Multiple open Situation Room tabs in one browser elect one leader via `BroadcastChannel`; followers consume the leader's last result rather than fanning out N parallel polls.
- [ ] **ROOM-08**: "Awaiting You" inbox pill shows the count + the age of the oldest item — the pill itself is a deep-link to the relevant task.

### Surface 3 — Daily Bulletin (BULL)

Auto-compiled morning editorial digest.

- [ ] **BULL-01**: Bulletin compiles at 06:30 ET via a worker-managed `next_due_at` timestamp computed in `America/New_York` using `date-fns-tz` or `luxon` — never via a bare cron string interpreted as UTC. Both DST transitions covered by CI tests.
- [ ] **BULL-02**: Compile is idempotent — re-firing the same `next_due_at` is a no-op; partial compiles never produce a partially-published Bulletin.
- [ ] **BULL-03**: "Requires Your Decision" inbox at the top with one card per outstanding decision, each showing dept tag + age + summary + Approve/Open/Decline affordances.
- [ ] **BULL-04**: Department sections (Production, Sales, Customer, Builder for v1; configurable later) with item rows + lineage threads (the agent-by-agent compile graph).
- [ ] **BULL-05**: "Standing Numbers" panel populated from SQL queries against Paperclip core tables — every number in the bulletin is grep-able to a query, never LLM-generated.
- [ ] **BULL-06**: Two-pass compile — pass 1 produces a draft; pass 2 is a verifier that cross-checks numbers against SQL and rejects on mismatch; only verified output publishes.
- [ ] **BULL-07**: Errata is a first-class item type — adding an erratum to a published bulletin appends rather than rewrites; subscribers see the errata footer on the next view.
- [ ] **BULL-08**: A failed compile renders an explicit "Bulletin compile failed at HH:MM — retrying at NN" banner; no silent failures.
- [ ] **BULL-09**: Bulletin renders inside Paperclip via the plugin's page slot AND persists as a Paperclip issue ("Bulletin No. N") so it survives plugin disable and is searchable in classic Paperclip.

### Surface 4 — Employee Chat (CHAT)

Hybrid real-time UI durable as ordinary issue comments.

- [ ] **CHAT-01**: Per-employee × per-topic chat surface — left rail of employees, top topic strip, central message thread, right context rail.
- [ ] **CHAT-02**: Every chat message persists to `public.issue_comments` (canonical) — message **content** is never stored in a Clarity Pack table.
- [ ] **CHAT-03**: A `chat_topics` table maps each `CHT-NN` topic to exactly one Paperclip issue ID — that table holds metadata only, not message content.
- [ ] **CHAT-04**: Real-time updates use `usePluginStream` subscribed to `issue.comment.created` filtered by the current chat-issue ID; no polling for chat.
- [ ] **CHAT-05**: Edits are modeled as new comments with a `supersedes`-link to the prior comment (since `issue.comment.updated` is not in PLUGIN_SPEC §16's documented event minimum set).
- [ ] **CHAT-06**: Optimistic render on send with rollback on failure; client-generated `message_uuid` per message provides the idempotency key for replays.
- [ ] **CHAT-07**: Attachments are stored as Paperclip work-products; if the work-product service is unavailable the attach button is disabled with an explicit "Attachments are temporarily unavailable" message — never silently lost.
- [ ] **CHAT-08**: Per-employee linear timeline + global search across every chat thread the current user can see.
- [ ] **CHAT-09**: Each agent message shows `↗ Promote to task` and `⚑ Pin` affordances; "decision recorded" messages render as a distinct typeform.
- [ ] **CHAT-10**: Reasoning panel (`<details>`-style) shows the agent's sources + reasoning bullets when expanded; collapsed by default.
- [ ] **CHAT-11**: Coexistence test: disabling the plugin leaves every chat message intact and visible as ordinary threaded comments in classic Paperclip UI.

### Coexistence Guarantees (COEXIST)

Cross-cutting; verified by a checklist that runs on every PR.

- [ ] **COEXIST-01**: Original Paperclip UI is never replaced; Reader view is an additional tab; classic dashboard remains the default landing surface.
- [ ] **COEXIST-02**: Schema is additive-only; no DDL touches `public.*`; plugin-namespace tables are isolated.
- [ ] **COEXIST-03**: Disabling the plugin in Paperclip's classic plugin-admin UI leaves data intact (no destructive uninstall hook).
- [ ] **COEXIST-04**: Editor-Agent has no special privileges (verified by inspecting capabilities with the same plugin-admin UI a user would).
- [ ] **COEXIST-05**: Clean uninstall preserves data; `--purge` flag is opt-in only and is documented in the runbook.
- [ ] **COEXIST-06**: Coexistence verification checklist runs in CI on every PR — fails the build if any of the above is regressed.

### Distribution & Polish (DIST)

Phase 4 work — unblocks broader use without blocking BEAAA value.

- [ ] **DIST-01**: Plugin is published to npm as `clarity-pack` with the `paperclipPlugin` field in `package.json` pointing at `dist/manifest.js`, `dist/worker.js`, and `dist/ui/`.
- [ ] **DIST-02**: README documents install + opt-in toggle + rollback flow + the runbook reference.
- [ ] **DIST-03**: Acceptance-criteria auto-status promotes from manual checklist (Phase 1) to event-derived auto-status — without breaking Phase 1's manual UX.
- [ ] **DIST-04**: XLSX / PDF deliverable preview promotes from Phase 1's placeholder to a registry of full-fidelity previewers (xlsx → grid, pdf → embed, md → rendered, png → img).
- [ ] **DIST-05**: Lockfile audit + accessibility pass (axe-core or equivalent) + visual regression baseline run in CI; results recorded in the milestone audit.

## v2 Requirements

Tracked but not in the current roadmap.

### Group threads (CHAT-G)

- **CHAT-G-01**: Pricing huddle / GTM huddle group threads with multi-agent coordination, distinct from per-employee 1:1 threads. *Why deferred:* multi-agent coordination is a separate problem; mockup shows it but solo-Eric on BEAAA does not need it for v1.

### Multi-recipient bulletin

- **BULL-V2-01**: Send the daily bulletin to additional recipients (board, advisors) as a published email or PDF. *Why deferred:* v1 audience is Eric only; expansion is a Clipmart-readiness milestone concern.

### Clipmart submission

- **DIST-V2-01**: Pass Clipmart submission criteria (multi-tenant safety, theming portability, public support story, full a11y audit). *Why deferred:* user explicitly chose "Just me on BEAAA" as the v1 audience.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Replacing the original Paperclip UI | Coexistence guarantee — Eric's daily flow on BEAAA must not break. |
| Forking Paperclip core | Enables clean uninstall and Clipmart shipping later without merge debt. |
| Multi-tenant isolation work for v1 | PLUGIN_SPEC.md describes Paperclip as single-tenant self-hosted single-node; broadening it is a separate project. |
| Default-on for existing users | Coexistence guarantee #1; opt-in toggle is mandatory. |
| Special privileges for Editor-Agent | Coexistence guarantee #4; governance parity is a v1 hard requirement. |
| Custom heartbeat / `setInterval` daemon for Editor-Agent | Bypasses Paperclip's budget caps, pause/terminate, and audit log — violates governance parity. |
| Real-time chat protocol that does NOT persist to `public.issue_comments` | Decision #1; would not survive plugin disable, breaking coexistence #5. |
| Plugin-shipped Tailwind | Stack pin — same-origin trust model means we inherit host CSS; bundling Tailwind bloats the bundle and risks specificity wars with host styles. |
| Plugin-shipped React | Forced peer-only; bundling React breaks hook singletons and the bridge. |
| LLM-driven blocker-chain terminal selection | Pitfall #13 — non-determinism here would destroy Situation Room trust. LLM may write prose around the result, never pick the terminal. |
| Auto-rollback after failed install | Always opt-in via the runbook — auto-rollback during a partial install can race with in-flight host operations and make recovery harder, not easier. |

## Traceability

Populated by the gsd-roadmapper agent during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (filled by roadmapper) | | |

**Coverage:**
- v1 requirements: 67 total
- Mapped to phases: (filled by roadmapper)
- Unmapped: (filled by roadmapper)

---
*Requirements defined: 2026-05-07*
*Last updated: 2026-05-07 after initial definition*
