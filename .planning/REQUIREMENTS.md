# Requirements: Clarity Pack

**Defined:** 2026-05-07
**Core Value:** Zero rabbit-holes — every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

## v1 Requirements

Requirements for the Clarity Pack v1 milestone (the four surfaces + Editor-Agent + safe rollout against the live BEAAA Paperclip instance). Each maps to exactly one roadmap phase.

> **Status of record = the [Traceability](#traceability) table at the bottom of this file** (reconciled 2026-05-29 against the phase-level closures + the live code). The inline `- [ ]` / `- [x]` checkboxes in the sections below are the ORIGINAL requirement *definitions* captured at roadmap time; they are not kept in lockstep, so many still read `- [ ]` for requirements that are in fact Implemented and live-verified (all seven phases are closed — see ROADMAP.md). When you need the current state of a requirement, read the Traceability table, not the checkbox.

### Pre-Install Safety (SAFE)

The discipline that lets us touch a live Paperclip install without unbounded blast radius.

- [x] **SAFE-01**: One-command snapshot script captures, before any clarity-pack action: a Postgres dump of the Paperclip database, a filesystem archive of Paperclip's data directory (work products, plugin install dir, runtime state), the current Paperclip version, and the list of currently installed plugins — all into a single timestamped archive. **Delivered Plan 01-01.**
- [ ] **SAFE-02**: One-command restore script reverses any snapshot byte-for-byte; restore must be rehearsed against a non-production Paperclip clone at least once before any clarity-pack feature code touches BEAAA. **Part A (CLI) delivered Plan 01-01; Part B (rehearsed once) PENDING Eric's drill against fresh local Paperclip — `runbook/REHEARSAL.md` awaits the first dated row.**
- [x] **SAFE-03**: Smoke-test script verifies a restored snapshot is functionally equivalent to the pre-snapshot environment: Paperclip starts, REST API answers, sample issue is listable, an agent heartbeat fetch succeeds, the employee list renders. **Delivered Plan 01-02.**
- [x] **SAFE-04**: Runbook documents the pre-flight → install → post-install verification → rollback flow in plain English; lives in `runbook/` in this repo, not as plugin code, so it works even when clarity-pack is broken or uninstalled. **Delivered Plan 01-03 — 8 markdown files + 2 launchers under `runbook/`.**
- [x] **SAFE-05**: Pre-flight gate refuses to run any install/upgrade/migration/agent-registration step if no snapshot has been taken in the last N minutes (default 15) or if the most recent snapshot's restore-and-smoke-test has not passed. **Delivered Plan 01-03 — `pnpm clarity-safety gate -- <inner-cmd>` with verifiedAt-window enforcement and dual-control bypass.**

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

Reused by every surface — built first in Phase 2 because Reader view, Situation Room, Bulletin, and Chat all consume them.

- [ ] **PRIM-01**: Batch reference resolver in `src/shared/reference-resolver.ts` resolves an array of `BEAAA-NNN` IDs in one round-trip (no N+1); returns `{id, title, status, owner, excerpt}` per reference.
- [ ] **PRIM-02**: Reference resolver respects viewer permissions — never leaks title/excerpt for a reference the current user cannot see in classic Paperclip UI.
- [ ] **PRIM-03**: Blocker-chain flattener in `src/shared/blocker-chain.ts` is **deterministic graph code** (DFS over an explicit edge set; LLM is permitted only to write prose summarizing the result, never to choose terminals).
- [ ] **PRIM-04**: Blocker-chain flattener detects cycles and emits a typed `Cycle` terminal rather than infinite-looping or silently truncating.
- [ ] **PRIM-05**: Blocker-chain flattener emits a typed terminal taxonomy: `HUMAN_ACTION_ON(user_id)` | `SELF_RESOLVING(eta)` | `EXTERNAL` | `CYCLE`. Every chain ends in exactly one terminal.
- [ ] **PRIM-06**: TL;DR types and a shared `tldr_cache` schema live in `src/shared/types.ts`; same types consumed by the worker handler and every surface that renders a TL;DR.

### Editor-Agent (EDITOR)

The single Paperclip employee that produces every TL;DR, critical-path narrative, and bulletin.

- [ ] **EDITOR-01**: Editor-Agent is declared in the manifest's `agents[]` array and reconciled per-company via `ctx.agents.managed.reconcile()` — never via a custom `setInterval` / DIY heartbeat.
- [ ] **EDITOR-02**: Editor-Agent uses `@paperclipai/mcp-server@2026.512.0` (date-based npm versioning; run via `npx -y @paperclipai/mcp-server`) for issue, comment, document, and heartbeat-context reads.
- [ ] **EDITOR-03**: Every Editor-Agent compile is idempotent — keyed on `(surface, scope_id, content_hash)`; re-running with unchanged inputs is a no-op.
- [ ] **EDITOR-04**: Editor-Agent filters its own `actor_type=plugin` + `actor_id=clarity-pack-editor-agent` events from its own triggers to prevent self-loops (TL;DR write → `issue.updated` → TL;DR write).
- [ ] **EDITOR-05**: Hard `max_tokens` cap per LLM call; circuit breaker pauses the agent after 3 consecutive failures and surfaces a banner instead of silent retry.
- [ ] **EDITOR-06**: Editor-Agent inherits Paperclip's heartbeat, budget caps, pause/terminate, and audit log automatically — verified by a coexistence test that pausing the agent in Paperclip's classic UI actually halts compile output.

### Surface 1 — Task Detail Reader View (READER)

Additional tab on every issue page; never replaces classic UI.

- [ ] **READER-01**: Reader view contributes to the `detailTab` slot with `entityTypes: ["issue"]` (or `taskDetailView`, depending on which the live-instance spike confirms renders next to classic Paperclip tabs).
- [ ] **READER-02**: TL;DR strip at the top of the tab with a "regenerated when the task body changes" freshness stamp.
- [x] **READER-03**: All `BEAAA-NNN` references in the prose render as inline reference chips showing ID + status badge. **(Implemented — Plan 07-01 SDK ref-resolver; live-verified on BEAAA 2026-05-29: 13/13 chips on BEAAA-828 resolve to `ID · real-status` clickable links, 0 `· unknown`. ENHANCED by Plan 07-04: the chip now renders `ID — title` (clickable, status as a small badge) and the SAME chip renders in the main prose body + TL;DR strip + excerpt via the ref-aware SafeMarkdown — re-verified at the 07-04 BEAAA-828 drill.)**
- [x] **READER-04**: An "Anchored to (resolved)" section renders one ref-card per upstream reference with title + owner + status pill + a substantive excerpt quote — no clicking through to read the source task. **(Implemented — Plan 07-01; live-verified 2026-05-29: cards render id + title + `clarity-state-pill` + `Owner:` + `clarity-ref-card-quote` excerpt. Markdown-render of the excerpt body is deferred item 3.)**
- [ ] **READER-05**: A "The deliverable" inline preview block renders the artifact name + last-write timestamp + a v1 placeholder preview (XLSX/PDF full-fidelity preview is deferred to Phase 5).
- [ ] **READER-06**: Goal ancestry breadcrumb at the top (project → milestone → parent issue → this task).
- [ ] **READER-07**: Acceptance criteria checklist with manual marking; auto-status from acceptance-criteria text + acceptance-event log is deferred to Phase 5.
- [ ] **READER-08**: Right-rail "Live blocker · on you" panel renders the blocker-chain terminal as a single one-click action (matches the mockup's `⚑ ON YOU` callout).
- [ ] **READER-09**: Activity timeline ("distilled") summarizes the most relevant N events, not the full audit log.
- [x] **READER-10**: TL;DR strip and the "Anchored to (resolved)" excerpt render the Editor-Agent's markdown as formatted text (not literal markup) via a safe plugin-local renderer, and `<PREFIX>-NNN` references inside the TL;DR are rewritten inline to "ID — title" using the 07-01 SDK resolver (instance-agnostic). **(Implemented — Plan 07-02; live-verified on BEAAA 2026-05-29. Plan 07-04 SUPERSEDES the mechanism: the "ID — title" render is now a CLIENT-SIDE clickable titled chip (the ref-aware SafeMarkdown maps each `<PREFIX>-NNN` token to a RefChip — strictly better: clickable). The 07-02 worker-side text rewrite was REMOVED to avoid a double-render ("ID — title" chip + a trailing " — title" text); the TL;DR body now reaches the UI raw and the chip supplies the title. Formatted markdown + titled chips now render on the main prose body too. Re-verified at the 07-04 BEAAA-828 drill.)**

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

#### Phase 6.1 additions (spec-complete extensions; close the rc.8 "no owner assigned" gap)

- [ ] **ROOM-09**: A new plugin-namespace table `clarity_agent_owners(agent_id, owner_user_id, set_at)` (migration 0013, additive plugin-namespace only) holds operator-claimed agent ownership. A new worker handler `agent.takeOwnership` writes the row server-side after re-verifying viewer authority. The `recompute-situation` job's owner-resolution path consults this side table FIRST and falls back to `public.agents.owner_user_id` only when no clarity-pack row exists. The Situation Room UI surfaces a "Take ownership" affordance on every Critical Path row whose chain terminal resolves to the `__unowned__` sentinel; click dispatches `agent.takeOwnership` and force-revalidates the snapshot via `usePluginData`. CTT-07 invariant preserved by construction (zero `ctx.issues.update` calls).
- [ ] **ROOM-10**: A new worker data handler `situation.artifacts` returns, per agent, the union of (a) `ctx.issues.documents.list` deliverables and (b) `plugin_clarity_pack_*.chat_message_attachments` rows joined to `chat_messages`, both filtered to the last 24h (configurable via `instanceConfigSchema`, default 24h), sorted newest-first. The Situation Room UI renders the result as an inline horizontal chip row under each agent row in the existing grid (NOT a separate shelf section). Empty windows render nothing (no placeholder copy). Each chip click opens the canonical `DeliverablePreview` popover (shared with Reader + chat — single source of truth).
- [ ] **ROOM-11**: The existing `blocker-chain.ts` transitive walk (priority `EXTERNAL` > `HUMAN_ACTION_ON(owner+awaiting)` > `SELF_RESOLVING(eta+no-owner)` > `HUMAN_ACTION_ON(__unowned__)`; cycle detection via path-stack guard) ships byte-identical — this requirement adds NO new chain logic. The Situation Room UI renders one row per Critical Path chain (max 3 per ROOM-02 carrier), each carrying (a) plain-English narration, (b) terminal-classification badge, (c) inline "Take ownership" affordance when the terminal is `HUMAN_ACTION_ON` with an `__unowned__` userId (ROOM-09 trigger), (d) `+ Create task` affordance when configured (entry-point shape locked via `/gsd:discuss-phase 6.1`). CYCLE-terminal UI renders the cycle label as-is in v1.0; auto-suggest cycle-break deferred to v1.1+ (recommended discuss-phase default).

#### Phase 7 additions (ITEM 4 — org-level blocked backlog; the org-truth surface)

- [x] **ROOM-12**: The Situation Room shows a TOP-OF-ROOM banner ("N blocked · M need you") that expands to a panel listing an ORG-LEVEL blocked-issue backlog — computed in the `situation.snapshot` DATA HANDLER (a valid HTTP-request scope, NOT the scope-dead recompute-situation job) by walking ALL company-wide `status=blocked` issues directly (NOT per-agent `current_focus_issue_id`, which is empty on every idle agent and yields a misleading "No blockers" everywhere). Each blocked issue is flattened to its single human action via the EXISTING `src/shared/blocker-chain.ts` `flattenBlockerChain` (no re-implemented DFS), ranked HUMAN_ACTION_ON-first via the EXISTING `pickTopChains` (exported from the shared module — single source of truth shared with the recompute job), and capped at 15 with a "N total" count + overflow indicator. Each row shows: issue title + the single flattened human action + owner DISPLAY NAME (resolved via the D-09 `ctx.agents.get` NO_UUID_LEAK pattern — a thrown/absent lookup degrades to "Unassigned", NEVER the raw UUID) + age, with TWO affordances (open the issue `/<prefix>/issues/<identifier>` + "open chat with <owner>" reusing the ROOM-09 `buildChatDeepLink` employee-only URL_HASH carrier). The builder is degrade-safe (a thrown `issues.list`/relations walk/flatten leaves the rest of the snapshot intact) and instance-agnostic (no company-prefix literal). The agent grid below is unchanged. NO new schema (the backlog is COMPUTED, not stored), NO version bump (1.0.0), NO new runtime dependency. Banner CSS scoped under `[data-clarity-surface='situation-room']`; React text nodes only (no `dangerouslySetInnerHTML`).

#### Phase 8 additions (people-first cockpit — the Situation Room reborn around employees)

The 2026-05-30 live drill (post-v1.1.11) found the Situation Room renders as a single collapsed banner over empty canvas — organized around *issues*, not *people*. Eric's stated value prop ("who is doing what / who is stuck / what to shift") needs a per-employee row strip with state, focus, age, and inline blocker-chain drill. Design locked via /gsd:discuss-phase-equivalent on 2026-05-30: **people-first axis**, **idle = loud (CEO problem)**, **needs-you = single top banner only**. ROOM-12's org-blocked-backlog stays — Phase 8 adds the people axis ABOVE it.

- [x] **ROOM-13**: The `situation.snapshot` worker handler returns a new `employees: SituationEmployeeRow[]` array alongside `org_blocked_backlog`. One row per company-scope agent (every agent the CEO sees in the org-chart left rail — currently 17 on BEAAA). Each row carries `{ agentId, name, role, state, focusIssueId, focusLine, lastActivityAt, ageBucket, blockerChain, doneTodayCount }`. The roster is read via existing `ctx.agents.list`; per-agent details join from `ctx.issues.list` (assigned + status filter) and the heartbeat-runs feed. Computed at HTTP-request time (no new migration, no stored snapshot table). Degrade-safe: an individual agent row that throws degrades to `{ agentId, name, role, state: 'unknown' }` without taking the whole snapshot down. Instance-agnostic (no BEAAA literal). NO new schema; NO version bump beyond 1.2.0.
- [x] **ROOM-14**: Each employee row carries `state: 'running' | 'reviewing' | 'blocked' | 'idle' | 'stale'` computed deterministically: `running` = active heartbeat-run in last 5 min; `reviewing` = open assigned issue with `status='in_review'` and no active run; `blocked` = open assigned issue with `status='blocked'`; `idle` = no open assigned issue AND last activity < 24h; `stale` = no open assigned issue AND last activity >= 24h. A pure classifier in `src/worker/situation/classify-employee-state.ts` with unit tests covering every state and every transition boundary (4h / 24h / 5min thresholds). The classifier is the single source of truth; UI consumes the enum without re-deriving.
- [x] **ROOM-15**: Each non-idle / non-stale employee row carries `focusLine: string | null` — a one-line description of what they are working on, generated by passing the current focus issue's TL;DR (or title fallback) through the existing `polishTldr()` pipeline (`src/worker/agents/compile-tldr.ts`). Voice MUST match the Reader (ISO→human dates, restated-paren strip, lone-ref-paren strip, jargon glossary) — same code path, no duplication. If the focus issue has no compiled TL;DR yet, `focusLine` falls back to the polished issue title. `focusLine` is null for idle/stale states (no work-in-flight to describe). Truncated to ~80 chars at the worker tier; UI never re-truncates.
- [x] **ROOM-16**: Each `state === 'blocked'` employee row carries `blockerChain: { rootIssueId, leafIssueId, humanAction, ownerName, ownerAgentId } | null` — the SAME `flattenBlockerChain` + `pickTopChains` + `humanize-snapshot` pipeline ROOM-12 uses for the org-backlog (single source of truth via `src/shared/blocker-chain.ts`). NO_UUID_LEAK preserved: a `__unowned__` terminal renders `ownerName: 'Unassigned'`, never a raw UUID. The Situation Room UI renders the chain inline on the agent's row as a single line: `└ blocked by <humanAction> (<leafIssueId>, <age>)` with `[open chat with <ownerName>]` action button. No drill-down click — the chain leaf + action are visible at glance.
- [x] **ROOM-17**: Employee rows are sorted with idle-loud posture: `blocked` first (oldest blocker age first), then `stale` (idle >= 24h, amber styling), then `idle` (amber styling, secondary urgency), then `running`/`reviewing` (green styling, no urgency), in last-activity-desc order within each bucket. The premise: an agent with no assigned work is wasted org capacity — the CEO should see it and decide to assign or stand down. Idle and stale rows render with `--clarity-state-idle` and `--clarity-state-stale` CSS tokens (amber family); running/reviewing render with `--clarity-state-running` (green). The sort happens at the worker tier (deterministic, testable); UI consumes the order verbatim.
- [x] **ROOM-18**: The Situation Room renders ONE persistent top banner: `⚠ N things need you → <single most-urgent action>`. `N` = the count of employee rows where `blockerChain !== null` AND `blockerChain.ownerAgentId` resolves to the viewer (`local-board` / CEO user id). The action text is the `humanAction` from the most-urgent blocker chain (oldest age). Click jumps to that agent's row + opens chat with the chain owner (`buildChatDeepLink` employee-only URL_HASH carrier — reused, single source of truth). If `N === 0`, the banner renders `✓ 0 need you — N moving · M idle · K stuck` as a non-urgent neutral state. The banner is NEVER hidden (always-visible top strip); per-row "needs you" highlights are deliberately OMITTED — rows stay clean, banner carries the urgency.

### Surface 3 — Daily Bulletin (BULL)

Auto-compiled morning editorial digest.

- [ ] **BULL-01**: Bulletin compiles at 06:30 ET via a worker-managed `next_due_at` timestamp computed in `America/New_York` using `date-fns-tz` or `luxon` — never via a bare cron string interpreted as UTC. Both DST transitions covered by CI tests.
- [ ] **BULL-02**: Compile is idempotent — re-firing the same `next_due_at` is a no-op; partial compiles never produce a partially-published Bulletin.
- [ ] **BULL-03**: "Requires Your Decision" inbox at the top with one card per outstanding decision, each showing dept tag + age + summary + Approve/Open/Decline affordances.
- [ ] **BULL-04**: Department sections (Production, Sales, Customer, Builder for v1; configurable later) with item rows + lineage threads (the agent-by-agent compile graph).
- [x] **BULL-05**: "Standing Numbers" panel populated from SQL queries against Paperclip core tables — every number in the bulletin is grep-able to a query, never LLM-generated.
- [x] **BULL-06**: Two-pass compile — pass 1 produces a draft; pass 2 is a verifier that cross-checks numbers against SQL and rejects on mismatch; only verified output publishes.
- [ ] **BULL-07**: Errata is a first-class item type — adding an erratum to a published bulletin appends rather than rewrites; subscribers see the errata footer on the next view.
- [ ] **BULL-08**: A failed compile renders an explicit "Bulletin compile failed at HH:MM — retrying at NN" banner; no silent failures.
- [ ] **BULL-09**: Bulletin renders inside Paperclip via the plugin's page slot AND persists as a Paperclip issue ("Bulletin No. N") so it survives plugin disable and is searchable in classic Paperclip.
- [x] **BULL-10** (Phase 7 / ITEM 5): The lineage section reads as insight, not a flat LOG — routine/scheduled outputs (Daily/Nightly digests, status reports) AND exact-duplicate threads are filtered out (agent-self substantive threads kept, conservative); each surviving thread shows a one-line plain-English Editor-Agent gloss ("what this means for you", compiled view-driven + cached, graceful when the agent is paused) and TWO clickable affordances (open the issue + open chat with the owner via the ROOM-09 carrier); the heading reflects the multi-thread reality; no raw UUID is rendered (NO_UUID_LEAK).

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

#### CTT — Chat → True Task (CTT)

Phase 4.1 extension of CHAT-09. Turns the Employee Chat composer into a real task-creation surface; locks chat-topic lifecycle so multi-turn conversation is reliable; separates runtime/system bookkeeping from genuine conversational content; protects against host-side disposition/recovery stranding.

- [ ] **CTT-01**: From the Employee Chat composer, the operator can turn an intention into a TRUE task — a real Paperclip issue that is assigned to an employee-agent, has a status lifecycle, and appears in the normal Issues list (not parented under a chat-topic plumbing tree, not unassigned). *Extends CHAT-09.*
- [ ] **CTT-02**: The existing agent-message `↗ Promote to task` affordance produces the SAME assigned, findable top-level task as the operator-side composer path. One shared mechanism, one consistent result. *Extends CHAT-09.*
- [ ] **CTT-03**: A chat topic supports sustained multi-turn conversation — the assigned employee-agent reliably re-wakes on every operator message, not only the first. *Extends CHAT-09.*
- [ ] **CTT-04**: The chat thread shows genuine conversational messages only — Paperclip agent-task-lifecycle / system bookkeeping comments (disposition, recovery owner, `finish_successful_run_handoff`) never appear as chat messages, and are filterable/diagnosable via an operator-toggled diagnostics path.
- [ ] **CTT-05**: A chat topic issue is never stranded in a stuck task-completion state by the plugin's own behaviour: the chat-topic issue is held non-terminal (never marked done by the plugin) and a watchdog flips it back off `done`/`cancelled`/`blocked` if observed there.
- [ ] **CTT-06**: If a chat topic does still end up host-stuck (residual disposition / recovery-owner state the plugin cannot reverse), the chat surface shows the operator a clear `⚠ TOPIC STUCK HOST-SIDE` banner — never silent, never auto-recover.
- [ ] **CTT-07**: Archiving a chat topic is a plugin-side concept: it sets `chat_topics.archived = true` and drops the topic from the chat UI without marking the host issue `done` (which would re-engage the disposition machinery). Archived topics remain reversible via a `+N archived` strip pill.
- [ ] **CTT-08**: The chat context rail tracks spun-off true-task status live: each task created from a topic appears in the `Active tasks owned` section with a status pill that updates on every chat poll.

#### RCB — Reader↔Chat Bridge (RCB)

Phase 4.2 — the symmetric inverse of CTT. CTT turns chat into assigned tasks; RCB gives every Paperclip issue a deterministic path back into chat, and makes the issue↔conversation graph navigable in both directions. Coined 2026-05-22 (locked design: project memory `phase-4.2-deferred-from-4.1`).

- [x] **RCB-01**: From any Paperclip issue's Reader view, a deterministic `Continue in chat` primitive in the header routes by issue lineage — a chat-spawned task (`originId: chat-task:…`) jumps to its source topic and source comment; a cold/standalone task or a regular assigned task opens a pre-seeded New Topic dialog; a chat-topic issue hides the button; an unassigned issue shows it disabled with guidance. *Inverse of CTT-01.*
- [x] **RCB-02**: A `chat.openForIssue` worker data handler resolves an issue's `originKind` / `originId` / assignee into exactly one deterministic route (`existing-topic` | `new-topic-needed` | `topic-itself` | `NO_ASSIGNEE` error) — opt-in-gated, company-scoped.
- [x] **RCB-03**: The chat surface honors deep-link URL params (`topic`, `comment`, `newTopic`, `seedTitle`, `seedBody`, `originIssueId`) — landing the operator on the exact topic and comment (with a brief flash highlight) or on a pre-seeded New Topic dialog — and clears the params after consumption so a refresh does not re-trigger.
- [x] **RCB-04**: A chat topic created via `Continue in chat` persists its source issue as `chat_topics.origin_issue_id` (additive plugin-namespace migration `0009`).
- [x] **RCB-05**: When the active chat topic carries an `origin_issue_id`, the topic strip renders a dismissible `About <COU-NNNN> ↗` backlink chip that navigates to the source issue's Reader.
- [x] **RCB-06**: The Reader header surfaces `<N> conversations about this issue ↗` when N > 0 — the `issue-reader` response includes `topicsForIssue`, and a popover lists each topic with a click-through into chat.
- [x] **RCB-07**: Every RCB change is additive and backward-compatible — migration `0009` is idempotent; chat topics predating it (no `origin_issue_id`) render normally; Reader views and chat topics without the new affordances work unchanged. Coexistence guarantees #3 + #6 preserved.

### Coexistence Guarantees (COEXIST)

Cross-cutting; verified by a checklist that runs on every PR.

- [ ] **COEXIST-01**: Original Paperclip UI is never replaced; Reader view is an additional tab; classic dashboard remains the default landing surface.
- [ ] **COEXIST-02**: Schema is additive-only; no DDL touches `public.*`; plugin-namespace tables are isolated.
- [ ] **COEXIST-03**: Disabling the plugin in Paperclip's classic plugin-admin UI leaves data intact (no destructive uninstall hook).
- [ ] **COEXIST-04**: Editor-Agent has no special privileges (verified by inspecting capabilities with the same plugin-admin UI a user would).
- [x] **COEXIST-05**: Clean uninstall preserves data; `--purge` flag is opt-in only and is documented in the runbook. **(Implemented — additive plugin-namespace schema; the disable/enable byte-identical row-count drill PASSED on live Countermoves at Phase 4.1 closure 2026-05-22 + re-affirmed at Phase 6.1 closure 2026-05-27; Phase 7 added NO migration so the guarantee holds "by construction"; README `## Uninstall` documents the default-preserve + opt-in `--purge`.)**
- [ ] **COEXIST-06**: Coexistence verification checklist runs in CI on every PR — fails the build if any of the above is regressed.

### Distribution & Polish (DIST)

Phase 5 work — unblocks broader use without blocking BEAAA value.

- [ ] **DIST-01**: Plugin is published to npm as `clarity-pack` with the `paperclipPlugin` field in `package.json` pointing at `dist/manifest.js`, `dist/worker.js`, and `dist/ui/`. **WON'T-DO (operator decision 2026-05-29 — internal-only): the plugin will NOT be published to public npm; it is used solely on operator-controlled Paperclip instances. The packaging half is DONE (the `paperclipPlugin` field points at dist/manifest.js + dist/worker.js + dist/ui/), and distribution is the local-tarball `paperclipai plugin install <package-dir>` path already used for every BEAAA deploy (DEPLOY-RUNBOOK Path A/B). Public publish is a deliberate non-goal, not a gap.**
- [x] **DIST-02**: README documents install + opt-in toggle + rollback flow + the runbook reference. **(Implemented — `README.md` ships `## Install`, `## Opt in (per-user)`, `## Rollback` (snapshot→verify→mutate→restore), `## Uninstall`, and `## Runbook` sections.)**
- [x] **DIST-03**: Acceptance-criteria auto-status promotes from manual checklist (Phase 2) to event-derived auto-status — without breaking Phase 2's manual UX.
- [x] **DIST-04**: XLSX / PDF deliverable preview promotes from Phase 2's placeholder to a registry of full-fidelity previewers (xlsx → grid, pdf → embed, md → rendered, png → img). **(Implemented — Plan 05-04 previewer registry; xlsx + pdf previews verified live at the rc.8 drill, see `rc.8-xlsx-preview-verified.png` / `rc.8-pdf-preview-verified.png`.)**
- [ ] **DIST-05**: Lockfile audit + accessibility pass (axe-core or equivalent) + visual regression baseline run in CI; results recorded in the milestone audit. **PARTIAL: lockfile audit (`.github/workflows/lockfile-audit.yml`) + a11y (`.github/workflows/a11y-check.yml` + `scripts/check-a11y.mjs`) are ACTIVE in CI; the visual-regression baseline is `.github/workflows/visual-regression.yml.disabled` — DEFERRED (the Playwright sketch-regression test depends on a headless-browser network fetch of Google Fonts for the baseline; it is gated behind `SKIP_VISUAL=1` locally). Tracked as the one open Phase-5 CI gate; not blocking internal use.**

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

Populated by the gsd-roadmapper agent during roadmap creation (2026-05-07).

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAFE-01 | Phase 1 | Done (Plan 01-01) |
| SAFE-02 | Phase 1 | Done — Part A (restore CLI) Plan 01-01; Part B rehearsal PASS 2026-05-13 (Phase 1 CLOSED, REHEARSAL.md drill row landed) |
| SAFE-03 | Phase 1 | Done (Plan 01-02) |
| SAFE-04 | Phase 1 | Done (Plan 01-03) |
| SAFE-05 | Phase 1 | Done (Plan 01-03) |
| SCAF-01 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill; single npm package + one manifest for all four surfaces, live on BEAAA) |
| SCAF-02 | Phase 2 | Implemented (Phase 2; TS 5.7.3 + esbuild + ESM + Node≥20; React/react-dom/jsx-runtime + SDK ui/hooks externalized — built bundle verified) |
| SCAF-03 | Phase 2 | Implemented (Phase 2; `paperclipai plugin install` succeeds end-to-end — every BEAAA deploy via DEPLOY-RUNBOOK Path A/B; detailTab slot resolved) |
| SCAF-04 | Phase 2 | Implemented (Phase 2; pnpm-lock committed + pinned; `.github/workflows/lockfile-audit.yml` + scaffold-check.yml in CI) |
| SCAF-05 | Phase 2 | Implemented (Phase 2; UI data access via usePluginData/usePluginAction — scaffold-check guards raw host fetch from src/ui) |
| SCAF-06 | Phase 2 | Implemented (Phase 2; all plugin CSS scoped to [data-clarity-surface] — `check-css-scope.mjs` gate 164/164) |
| SCAF-07 | Phase 2 | Implemented (Phase 2; `src/ui/primitives/usePoll.ts` lifecycle-aware poll primitive) |
| SCAF-08 | Phase 2 | Implemented (Phase 2; theme tokens + state pill + ref chip primitives match the mockups) |
| SCAF-09 | Phase 2 | Implemented (Phase 2; SPA nav via useHostNavigation().linkProps() — breadcrumb test pins SCAF-09 no-raw-href) |
| OPTIN-01 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| OPTIN-02 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| OPTIN-03 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| OPTIN-04 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| OPTIN-05 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| PRIM-01 | Phase 2 | Implemented (Phase 2; `src/shared/reference-resolver.ts` batch resolver — single round-trip, redefined to one fetcher invocation in Plan 07-01; live-verified BEAAA-828 13/13 chips) |
| PRIM-02 | Phase 2 | Implemented (Phase 2; resolver forwards `bodyExcerptForViewer:null` when the viewer can't see a ref — reference-resolver.ts:60. NOTE: the SDK Issue has no `_viewer_can_read` flag, so the gate relies on host `ctx.issues.get` enforcing perms server-side; on the single-tenant admin BEAAA box the multi-viewer excerpt-leak case is not falsifiable — documented open item, not a known leak) |
| PRIM-03 | Phase 2 | Implemented (Phase 2; `src/shared/blocker-chain.ts` deterministic DFS — PRIM-03 grep-guard pins byte-identical flatten; LLM never picks terminals) |
| PRIM-04 | Phase 2 | Implemented (Phase 2; cycle detection emits a typed Cycle terminal — path-stack guard) |
| PRIM-05 | Phase 2 | Implemented (Phase 2; typed terminal taxonomy HUMAN_ACTION_ON/SELF_RESOLVING/EXTERNAL/CYCLE — every chain ends in exactly one) |
| PRIM-06 | Phase 2 | Implemented (Phase 2; TL;DR types + tldr_cache schema in `src/shared/types.ts`, consumed by worker + every TL;DR surface) |
| EDITOR-01 | Phase 2 | Implemented (Phase 2; Editor-Agent declared in manifest `agents[]` + reconciled via ctx.agents.managed — runs live on BEAAA as a regular org-chart hire, no DIY setInterval) |
| EDITOR-02 | Phase 2 | Implemented (Phase 2; MCP server pattern wired for reads. NOTE: the production compile path that proved out live is the operation-issue handoff (Plan 03-06/03-08) — see EDITOR delivery notes; MCP reads remain the declared adapter) |
| EDITOR-03 | Phase 2 | Implemented (Phase 2; every compile idempotent on (surface, scope_id, content_hash) — tldr_cache UNIQUE; re-run with unchanged inputs is a no-op cache hit, live-verified) |
| EDITOR-04 | Phase 2 | Implemented (Phase 2; self-loop filter on plugin-origin events + the bulletin self-tag filter — Editor-Agent does not re-trigger on its own writes) |
| EDITOR-05 | Phase 2 | Implemented (Phase 2; hard max_tokens cap per call (16000) + circuit breaker pauses the agent after consecutive failures + surfaces a banner, not silent retry) |
| EDITOR-06 | Phase 2 | Implemented (Phase 2; Editor-Agent inherits Paperclip heartbeat/budget/pause-terminate/audit by construction — it IS a managed agent; pause halts compile output) |
| READER-01 | Phase 2 | Implemented (Phase 2; Reader contributes the `detailTab` slot with entityTypes:["issue"] — the "Reader" tab renders next to classic Paperclip tabs, live-verified on BEAAA) |
| READER-02 | Phase 2 | Implemented (Phase 2; TL;DR strip at the top of the tab with a freshness stamp; view-driven recompile on body change — live-verified 07-xx drills) |
| READER-03 | Phase 2 / Plan 07-01 | Implemented |
| READER-04 | Phase 2 / Plan 07-01 | Implemented |
| READER-05 | Phase 2 | Implemented (Phase 2 placeholder preview; promoted to the full-fidelity previewer registry in Plan 05-04 / DIST-04 — deliverable-preview.tsx, xlsx/pdf live-verified) |
| READER-06 | Phase 2 | Implemented (Phase 2; goal ancestry breadcrumb project→milestone→parent→task — breadcrumb.tsx) |
| READER-07 | Phase 2 | Implemented (Phase 2 manual AC checklist; auto-status promoted in Plan 05-03 / DIST-03 — ac-checklist.tsx, side-by-side with manual UX) |
| READER-08 | Phase 2 | Implemented (Phase 2; right-rail "Live blocker · on you" panel renders the chain terminal as a one-click action — live-blocker-panel.tsx) |
| READER-09 | Phase 2 | Implemented (Phase 2; distilled activity timeline summarizes the most relevant N events — activity-timeline.tsx) |
| READER-10 | Phase 7 / Plan 07-02 | Implemented |
| ROOM-01 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-02 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-03 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-04 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-05 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-06 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-07 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-08 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| ROOM-09 | Phase 6.1 | Implemented (Phase 6.1 closed VERIFIED 2026-05-27; migration 0013 + `agent.takeOwnership` handler + chainStart-seed hotfix; engagement entry renamed Take-Ownership → Open-chat per operator critique 2026-05-27) |
| ROOM-10 | Phase 6.1 | Implemented (Phase 6.1 closed VERIFIED 2026-05-27; `situation.artifacts` worker handler + inline chip row UI; live drill confirms 2 chips on CEO card within 24h window) |
| ROOM-11 | Phase 6.1 | Implemented (Phase 6.1 closed VERIFIED 2026-05-27; Critical Path UI ships Open-chat engagement entry + standalone `+ Create task` over byte-identical chain walk; CYCLE-terminal renders as-is in v1.0) |
| ROOM-12 | Phase 7 / Plan 07-03 | Implemented |
| ROOM-13 | Phase 8 | Implemented (Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30; v1.2.0 drill 6/6 PASS — Plan 08-03) |
| ROOM-14 | Phase 8 | Implemented (Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30; 5 states observed live — Plan 08-03) |
| ROOM-15 | Phase 8 | Implemented (Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30; focusLine Reader-voice parity, 0 ISO — Plan 08-03) |
| ROOM-16 | Phase 8 | Implemented (Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30; B1 AGENT-uuid deep-link + NO_UUID_LEAK 0 matches — Plan 08-03) |
| ROOM-17 | Phase 8 | Implemented (Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30; idle-loud sort + amber/green tokens — Plan 08-03) |
| ROOM-18 | Phase 8 | Implemented (Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30; needs-you banner + URL_HASH carrier click — Plan 08-03) |
| BULL-01 | Phase 3 | Implemented (Phase 3 CLOSED 2026-05-18; America/New_York next_due_at via date-fns-tz + DST CI fixtures. NOTE: the 06:30 cron is best-effort on paperclipai@2026.525.0 — scheduled-job scope is dead, PR #6547 — so the bulletin reliably compiles VIEW-DRIVEN when the Bulletin page is opened) |
| BULL-02 | Phase 3 | Implemented (Phase 3 CLOSED 2026-05-18; idempotent compile — UNIQUE(next_due_at,content_hash) + no-op gate + atomic publish in Plan 03-02; partial compiles never publish) |
| BULL-03 | Phase 3 | Implemented (Phase 3; "Requires Your Decision" actionInbox renders one card per outstanding decision — bulletin-rendering.ts) |
| BULL-04 | Phase 3 | Implemented (Phase 3; department sections Production/Sales/Customer/Builder with item rows + lineage threads — live on BEAAA) |
| BULL-05 | Phase 3 | Implemented (Plan 03-02) |
| BULL-06 | Phase 3 | Implemented (Plan 03-02) |
| BULL-07 | Phase 3 | Implemented (Phase 3; errata is a first-class item type — ErratumEntry + append-not-rewrite + errata footer on next view) |
| BULL-08 | Phase 3 | Implemented (Phase 3; failed compile renders "Bulletin compile failed at HH:MM · retrying at NN" — failed-compile-banner.tsx; no silent failures) |
| BULL-09 | Phase 3 | Implemented (Phase 3 CLOSED 2026-05-18; renders via the page slot AND persists as a "Bulletin No. N" Paperclip issue — survives disable + searchable in classic UI; page-slot render completed Plan 03-03, live on BEAAA) |
| BULL-10 | Phase 7 / Plan 07-05 | Implemented (lineage filter + gloss + 2 affordances; live BEAAA drill 2026-05-29 PASS — routine/dup filtered to "Work in motion — 1 thread", surviving thread shows the Editor-Agent gloss text, both affordances present, NO_UUID_LEAK; the gloss read-back idempotency bug fixed in commit dad114b — view 1 reads back the existing op, view 2+ are cache hits, no fresh op per view) |
| CHAT-01 | Phase 4 | Implemented (Plan 04-04 read/CRUD handlers + Plan 04-05 four-region chat UI shell) |
| CHAT-02 | Phase 4 | Implemented (Plan 04-03 — chat.send writes canonical to public.issue_comments; chat_messages side table has no body column) |
| CHAT-03 | Phase 4 | Implemented (Plan 04-02 — 0006_chat.sql chat_topics maps each CHT-NN topic to one issue, metadata only) |
| CHAT-04 | Phase 4 | Implemented (Plan 04-03 — chat-stream-bridge; CHAT-04 streaming host-blocked at plugin-streams 501, chat runs on the Plan 04-05 15s polling fallback) |
| CHAT-05 | Phase 4 | Implemented (Plan 04-03 — chat.edit append-with-supersedes, original comment never mutated) |
| CHAT-06 | Phase 4 | Implemented (Plan 04-03 — client message_uuid idempotency key; Plan 04-05 optimistic render + rollback) |
| CHAT-07 | Phase 4 | Implemented (Plan 04-01 attachment-path spike — OQ-1 NO-PATH verdict; Plan 04-05 degraded-state composer UI: attach disabled with explicit unavailable message) |
| CHAT-08 | Phase 4 | Implemented (Plan 04-04 — chat.search ILIKE over issue_comments JOIN chat_topics, wildcard-safe escapeLike) |
| CHAT-09 | Phase 4 | Implemented (Plan 04-04 — chat.promote linked issue + chat.pin; Plan 04-05 Promote/Pin affordances on agent messages) |
| CHAT-10 | Phase 4 | Implemented (Plan 04-05 — reasoning panel, collapsed by default, shows agent sources + reasoning bullets) |
| CHAT-11 | Phase 4 | Implemented (Plan 04-06 — 08-chat-disable.mjs automated coexistence check in the CI checklist) |
| CTT-01 | Phase 4.1 | Implemented (Plan 04.1-02 worker — createTrueTask helper + chat.createTrueTask handler produce a top-level assigned issue; Plan 04.1-10 UI dialog dual-mode + pendingTaskCard / creation toast; v0.8.3) |
| CTT-02 | Phase 4.1 | Implemented (Plan 04.1-02 — chat.promote REWRITTEN to delegate to createTrueTask; D-04 single mechanism; `grep -c parentId` returns 0 in all three target files) |
| CTT-03 | Phase 4.1 | Implemented (Plan 04.1-03 — chat.send fires `void ensureTopicWakeable(...)` fire-and-forget after every send; multi-turn native re-wake PROVEN live on Countermoves per 04.1-01 PROBE-OQ3 PASS-NATIVE) |
| CTT-04 | Phase 4.1 | Implemented (Plan 04.1-04 — classifyComment dual-keyed discriminator + 5-phrase RUNTIME_PHRASES + chat.messages `.filter()` (default ON, opt-out via includeDiagnostics:true); Plan 04.1-11 marker-pattern allowlist stabilizes the marker against host-stamped authorType:'system') |
| CTT-05 | Phase 4.1 | Implemented (Plan 04.1-03 — NON_TERMINAL_CONVERSATION_STATUS='in_progress' initial child-topic status + chat-topics D-11 CONVERSATION CONTAINER instruction + defensive flip-off-done watchdog catches `done`/`cancelled`/`blocked`) |
| CTT-06 | Phase 4.1 | Implemented (Plan 04.1-03 isTopicStuck primitive + Plan 04.1-04 topicStuck + recoveryOwner response shape + Plan 04.1-10 HostStuckBanner UI; never silent, never auto-recover per spike FLAG-1 reconciliation) |
| CTT-07 | Phase 4.1 | Implemented (Plan 04.1-05 — chat.topic.archive plugin-side ONLY; D-10 invariant pinned by chat-topic-archive.ts spy test (zero ctx.issues.update) + COEXIST-09 CI gate; Plan 04.1-08 archived_at column for sort order; UI archive panel in Plan 04.1-10) |
| CTT-08 | Phase 4.1 | Implemented (Plan 04.1-05 — chat.taskOwned reads chat_topic_tasks side table; D-08 active-tasks rail; createTrueTask cross-plan retrofit writes the back-link best-effort; Plan 04.1-10 ContextRail Active tasks owned rendering) |
| RCB-01 | Phase 4.2 | Implemented (Plans 04.2-01 + 04.2-02 — `ContinueInChatButton` Reader primitive; gold PRIMARY styling fix via theme.css token promotion. Operator-drill PASS 2026-05-24: 5-path lineage routing all green on Countermoves clarity-pack-1.0.0-rc.2.tgz.) |
| RCB-02 | Phase 4.2 | Implemented (Plan 04.2-01 — `chat.openForIssue` worker handler with deterministic 5-case lineage routing. Operator-drill PASS 2026-05-24.) |
| RCB-03 | Phase 4.2 | Implemented (Plans 04.2-01 + 04.2-03 + 04.2-04 — chat-surface deep-link handling with URL_HASH carrier + race-safe dispatch. Operator-drill PASS 2026-05-24: payload + carrier + read + dispatch all end-to-end; flash-highlight observed on Path 1.) |
| RCB-04 | Phase 4.2 | Implemented (Plan 04.2-01 — migration `0009_chat_topics_origin_issue.sql` + `originIssueId` thread-through in `chat.topic.create`. Operator-drill PASS 2026-05-24: Path 3 cold-task payload carried `originIssueId: fbc532ec-…`.) |
| RCB-05 | Phase 4.2 | Implemented (Plan 04.2-01 — topic-strip `About <COU-NNNN> ↗` backlink chip wired against `chat_topics.origin_issue_id`. RCB-07 spot-check on pre-0009 topics verifies the rendering is conditional and degrades gracefully when `origin_issue_id IS NULL`.) |
| RCB-06 | Phase 4.2 | Implemented (Plan 04.2-01 — Reader header `N conversations about this issue ↗` popover via `topicsForIssue` extension to `issue-reader` response.) |
| RCB-07 | Phase 4.2 | Implemented (Plan 04.2-01 — additive plugin-namespace migration `0009` is idempotent; pre-0009 topics render with no `About …` chip and no error. Operator-drill PASS 2026-05-24: zero About-chip elements on the page; zero console errors during topic-strip render.) |
| COEXIST-01 | Phase 2 | Implemented (Phase 2; per-user opt-in via profile toggle, default OFF — OPTIN-01..05; verified at Phase 2 closure) |
| COEXIST-02 | Phase 2 | Implemented (Phase 2; original UI never replaced — Reader is an additional detailTab, classic tabs untouched) |
| COEXIST-03 | Phase 2 | Implemented (Phase 2; schema is additive plugin-namespace only — disable/enable byte-identical row-count drill PASS at 4.1 closure 2026-05-22 + 6.1 closure 2026-05-27) |
| COEXIST-04 | Phase 2 | Implemented (Phase 2; Editor-Agent is a regular org-chart hire with no special privileges — EDITOR-01/06) |
| COEXIST-05 | Phase 5 | Implemented (additive plugin-namespace; disable/enable byte-identical drill PASS at 4.1 closure 2026-05-22 + 6.1 closure 2026-05-27; Phase 7 added no migration → holds by construction; README `## Uninstall` documents --purge opt-in) |
| COEXIST-06 | Phase 2 | Implemented (Phase 2 closed APPROVED 2026-05-15 via Plan 02-09 re-drill) |
| DIST-01 | Phase 5 | Won't-do (operator decision 2026-05-29 — internal-only; NOT published to public npm; packaging done; distribution = local-tarball `paperclipai plugin install`) |
| DIST-02 | Phase 5 | Implemented (README documents Install + Opt-in + Rollback + Uninstall + Runbook) |
| DIST-03 | Phase 5 | Implemented (Plan 05-03 — comment-marker scanner via reader.ac.autostatus; side-by-side with manual checklist; v1.0.0-rc.5) |
| DIST-04 | Phase 5 | Implemented (Plan 05-04 previewer registry — xlsx/pdf/md/png; xlsx + pdf verified at rc.8 drill) |
| DIST-05 | Phase 5 | Partial (lockfile-audit + a11y CI active; visual-regression CI .disabled — deferred, not blocking internal use) |

**Coverage:**
- v1 requirements: 97 total (79 original + CTT-01..08 added Phase 4.1 + RCB-01..07 added Phase 4.2 + ROOM-09..11 added Phase 6.1)
- Mapped to phases: 97
- Unmapped: 0

**Per-phase loadings:**
- Phase 1 (Pre-Install Safety): 5 requirements (SAFE-01..05)
- Phase 2 (Scaffold + Primitives + Reader + Room + Editor + Opt-In): 48 requirements (SCAF-01..09, OPTIN-01..05, PRIM-01..06, EDITOR-01..06, READER-01..09, ROOM-01..08, COEXIST-01..04, COEXIST-06)
- Phase 3 (Daily Bulletin): 9 requirements (BULL-01..09)
- Phase 4 (Employee Chat): 11 requirements (CHAT-01..11)
- Phase 4.1 (Chat → True Task): 8 requirements (CTT-01..08)
- Phase 4.2 (Reader↔Chat Bridge): 7 requirements (RCB-01..07)
- Phase 5 (Distribution & Polish): 6 requirements (DIST-01..05, COEXIST-05)
- Phase 6.1 (Situation Room spec-complete): 3 requirements (ROOM-09..11)

---
*Requirements defined: 2026-05-07*
*Last updated: 2026-05-27 — **Phase 6.1 (Situation Room spec-complete) CLOSED & VERIFIED 2026-05-27.** ROOM-09 + ROOM-10 + ROOM-11 flipped to Implemented. Operator drill on live Countermoves at `clarity-pack-1.0.0-rc.8.tgz` sha256 `23181e4a…`: Open-chat engagement entry on CEO agent card navigates to `/COU/chat#h=…` URL_HASH carrier decoding to `{"employee":"b2a22e50-…"}`, auto-selects CEO on roster, populates topic strip with 10 historical CHT-* topics, no forced New Topic dialog. Inline artifact chip row renders 2 chips on CEO card (xlsx + pdf) within configurable 24h window; empty windows render no placeholder. Critical Path renders `No blockers` for idle agents + `Open chat with [Role]` engagement entry + standalone header `+ Create task` (Cold Task dialog correctly styled per `1b11649` CSS-scope broadening). Plan 06.1-12 v2 parser hotfix verified live (`parseChatDeepLink` accepts employee-only payloads via build→encode→decode→parse round-trip test). COEXIST #3 + #6 preserved by construction (additive plugin-namespace migration 0013); Phase 4.1's disable/enable rowcount drill 2026-05-22 covers this phase by precedent + today's uninstall/install cycle observed all historical chat topics + TL;DRs surviving. VERIFICATION: `phases/06.1-situation-room-spec-complete/06.1-VERIFICATION.md`. **Phase 5 Plan 05-10 (rc → 1.0.0 + npm publish + ALL-paths drill) is unblocked.** Earlier: 2026-05-26 — **Phase 6.1 (Situation Room spec-complete) REGISTERED.** Added ROOM-09 (plugin-namespace `clarity_agent_owners` side table + `agent.takeOwnership` handler), ROOM-10 (`situation.artifacts` per-agent inline chips unioning deliverables + chat attachments, 24h sliding), ROOM-11 (Situation Room Critical Path UI surfaces Take-Ownership + Create-Task affordances over the existing correct chain walk; CYCLE-terminal renders as-is in v1.0). All 3 carry the rc.8 Playwright-drill finding: the chain walk + 4-terminal classification are already correct as of Phase 2's ship — the fix is owner resolution at the leaf hop only. v1 requirement total bumped 94 → 97. Earlier: 2026-05-24 — **Phase 4.2 (Reader↔Chat Bridge) CLOSED 2026-05-24.** RCB-01..RCB-07 all flipped to Implemented. Operator-drill PASS on live Countermoves with clarity-pack-1.0.0-rc.2.tgz (which bundles the Plan 04.2-04 dispatch fix originally shipped as 0.9.3 plus the Phase 5 polish layer at 1.0.0-rc.2): full 5-path Reader↔Chat Bridge drill (assigned task COU-2215 → existing-topic + flash; chat-spawned COU-2361 → existing-topic via chat-task lineage; cold COU-2396 → new-topic-needed seed dialog; chat-topic CHT-1117/COU-1115 → button HIDDEN; no-assignee COU-2399 → button DISABLED with tooltip) + RCB-07 pre-0009-topic spot-check all green. Seven polish defects (D1-D7) filed in MemPalace for a future Plan 04.2-05 polish pass — none load-bearing for closure. Earlier: 2026-05-22 — Phase 4.2 planning: registered RCB-01..RCB-07 from the locked design in project memory `phase-4.2-deferred-from-4.1`.*
