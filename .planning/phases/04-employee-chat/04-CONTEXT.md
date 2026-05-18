# Phase 4: Employee Chat - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Mode:** Interactive `/gsd:discuss-phase 4` — all 4 gray areas discussed. Includes a mid-discussion codebase investigation against `paperclipai/paperclip@master` (commit `242a2c2`) that resolved the central scope question with code+test citations.

> **Sequencing note:** Phase 4 depends on Phase 3 (Daily Bulletin), which was still EXECUTING at discussion time (Plan 03-10 planned, closure drill not yet passed). Do NOT run `/gsd:plan-phase 4` until Phase 3 closes APPROVED.

<domain>
## Phase Boundary

A hybrid real-time **Employee Chat** surface (page route `chat`, already declared in `src/manifest.ts`; replaces `src/ui/surfaces/chat-stub.tsx`) where an opted-in Eric talks to each Paperclip employee on per-topic threads:

1. **Left rail** — roster of every Paperclip employee for the company.
2. **Topic strip** — the open `CHT-NN` topics for the selected employee.
3. **Central thread** — chat-shaped messages (bubbles, avatars, day dividers), a composer with optimistic send, attachments, inline ref chips, reasoning panels, promote/pin affordances, and decision-recorded typeforms.
4. **Right context rail** — agent card, active tasks owned, "you owe", recent attachments, quick actions.

**Persistence model (THE chat decision — locked):** every chat message persists immediately as an ordinary `public.issue_comments` row (canonical). Message **content** never lives in a Clarity Pack table. Attachments persist as Paperclip work-products. Edits are append-with-supersedes. Disabling the plugin leaves every message visible as ordinary threaded comments in classic Paperclip.

**Scope anchor:** Phase 4 ships the Chat surface **only**. Group threads, distribution, and full-fidelity attachment previewers are out of scope.

**What stays from Phase 2/3 (do NOT rebuild):**
- Opt-in gate (`useOptIn` + `clarity_user_prefs` + server-side `opt-in-guard`) — chat page gated identically to Reader / Situation Room / Bulletin.
- Reference resolver (`src/shared/reference-resolver.ts`) — reused for inline `BEAAA-NNN` ref chips inside chat messages.
- `usePoll` (`src/ui/primitives/use-poll.ts`) — reused as the chat realtime **fallback** path (D-08).
- `useResolvedUserId` / `useResolvedCompanyId` resolver pattern — chat handlers are opt-in-gated the same way.
- Theme tokens, ref chip, state pill primitives. New chat-only styling lives in a scoped surface stylesheet under `[data-clarity-surface="chat"]` (Pitfall: CSS bleed-through).
- Same-origin trust model — chat UI uses `usePluginData` / `usePluginAction` / `usePluginStream` only; ESLint `no-raw-fetch-in-ui` still in force. Chat is a named XSS/exfiltration vector (PITFALLS.md §"capability bypass") — markdown rendering and attachment preview must be treated as untrusted-input surfaces.

**What is explicitly NOT reused:** the Phase 3 `src/worker/agents/agent-task-delivery.ts` machinery (`deliverAgentTask`, operation-issue handoff, document-readback polling). Chat does **not** need it — see D-01.

</domain>

<decisions>
## Implementation Decisions

### Agent reply path & scope

- **D-01: Employee-agent replies are NATIVE Paperclip behavior — Phase 4 builds ZERO agent-delivery code.** Posting a comment on an issue assigned to an agent natively enqueues an `issue_commented` heartbeat wakeup for that agent; the agent runs, receives the triggering comment IDs inline in its wake payload (`wakeCommentIds`, capped at 8), and replies by writing an ordinary `issue_comments` row. "Send a chat message" = create a comment on the topic issue. Paperclip does the rest.
  - **Why:** Proven by code + tests at `paperclipai/paperclip@242a2c2`: `server/src/__tests__/issue-update-comment-wakeup-routes.test.ts` ("wakes the assignee on comment-only issue updates"), `server/src/__tests__/heartbeat-comment-wake-batching.test.ts`, wake-payload assembly in `server/src/services/heartbeat.ts`. NOTE: `issue_commented` is NOT documented in `doc/execution-semantics.md` / `SPEC-implementation.md` §8 — the implementation is ahead of the spec; trust the code + tests.
  - **Consequence if wrong:** would reintroduce the entire Phase 3 agent-delivery saga. Phase 4's first plan SHOULD include a thin live-verification task on Countermoves (post a comment on an agent-assigned issue, observe the reply) before building UI on top — same falsify-first discipline as Plan 02-01.

- **D-02: The wake contract is ASSIGNMENT, not @-mention.** Each topic issue is assigned to exactly one employee-agent; every comment Eric posts wakes that agent. The @-mention wake path exists in Paperclip but its parsing/routing internals are undocumented and unverified — it is NOT a v1 dependency. Chat is 1:1 (one topic ↔ one employee), so assignment is sufficient.

- **D-03: Roster = all Paperclip employees for the company; Editor-Agent excluded.** The roster is fetched from the host employee-list API. The Editor-Agent (the TL;DR / bulletin compiler) does not appear — it is infrastructure, not a chattable colleague. The sketch's "Group threads" rail section (Pricing huddle, GTM huddle) is **omitted** — group threads are v2 (`CHAT-G-01`).

- **D-04: Pending UX = "working…" indicator + timeout notice.** After Eric sends, the thread shows a `{Employee} is working…` pending row; if no reply arrives within a planner-chosen timeout (heartbeat min interval is 30s, replies realistically take minutes — NOT the sketch's "14s"), show a quiet "no reply yet — agent may be paused or busy" notice. No silent dead-ends.

### Topic issue model

- **D-05: Topics = child issues under a per-employee parent issue.** One parent issue per employee (e.g. titled `Chat — CFO`); each `CHT-NN` topic is a **child issue** of that parent, assigned to the employee-agent. Paperclip has a real issue tree (`server/src/services/issue-tree-control.ts`), so topics stay grouped and collapsible in classic UI instead of scattered flat. The plugin discovers topics by walking the tree from the per-employee parent.

- **D-06: Topic lifecycle = classic close + auto-reopen on send.** Closing a topic sets its child issue to `done`. Because Paperclip agents do NOT wake on comments to terminal issues, sending a message to an already-closed topic **auto-reopens it** — the worker flips the issue back to `in_progress` (with the `resume` flag) so the agent wakes and replies. A "closed" topic therefore silently un-closes when messaged again; this is the accepted, frictionless behavior.

- **D-07: CONSTRAINT CORRECTION — there is no private-issue mechanism in Paperclip.** PROJECT.md and REQUIREMENTS describe "per-topic **private** issues." The investigation found NO `surfaceVisibility` field, NO `plugin_operation` visibility value, and no issue-hiding mechanism. Plugin-created issues are ordinary issues carrying only `plugin:clarity-pack` **origin metadata** (provenance tag, per `PLUGIN_SPEC.md` §14.1). Topic issues + their comments WILL appear in classic Paperclip issue lists and the classic issue UI. This cannot be made private — but it **satisfies CHAT-11 cleanly** (messages survive plugin disable as ordinary threaded comments, for free). The word "private" in PROJECT.md / REQUIREMENTS is not achievable and should be dropped/reworded at the next phase transition.

### Real-time delivery & idempotency

- **D-08: Realtime = worker event-bridge + `usePluginStream`, stream-primary with poll fallback.** `usePluginStream` is real (`packages/plugins/sdk/src/ui/hooks.ts`) but is a *plugin-defined* SSE channel — NOT a native event feed. Wiring: the worker subscribes `ctx.events.on("issue.comment.created", …)` (a documented core event, `PLUGIN_SPEC.md` §16), re-emits onto a plugin stream channel via `ctx.streams.emit(channel, event)`, and the UI consumes it via `usePluginStream(channel)`. **Fallback:** on stream error/close, fall back to a low-frequency `usePoll` refresh (reusing the Phase 2 primitive) so messages never silently stop; show a small "reconnecting" indicator while degraded. (CHAT-04's literal "usePluginStream subscribed to issue.comment.created" is satisfied by this bridge — the worker subscribes to the native event; the UI subscribes to the relayed channel.)

- **D-09: `message_uuid` idempotency key → comment origin/metadata field — WITH A VERIFICATION GATE.** The client-generated `message_uuid` (CHAT-06 idempotency key for optimistic-send replays) is stored in the comment's origin/metadata blob on the comment-create call. **UNVERIFIED:** the investigation did NOT confirm the comment-create API accepts a metadata/origin field. **Verification gate (must be a Phase 4 plan task / spike):** confirm the comment-create endpoint accepts a per-comment metadata/origin blob. **If it does not:** fall back to a plugin-namespace `chat_messages` side table mapping `message_uuid → comment_id` (+ topic, sender, sent_at) — CHAT-02-compliant (it maps, never stores content). Dedup on send checks whichever store is chosen.

- **D-10: Optimistic send — failed message stays in thread with Retry.** On send failure (worker error, capability denied, network) the optimistic bubble stays, marked "Failed to send", with a Retry affordance. Retry re-sends with the **same `message_uuid`**, so a half-succeeded send (comment landed but the round-trip ack was lost) dedupes instead of double-posting. Never silent loss; Eric keeps his typed text. (PITFALLS.md §11.3.)

- **D-11: Edits = append-with-supersedes (locked by CHAT-05, reinforced by Pitfall 11).** Paperclip exposes `issue.comment.created` but no `issue.comment.updated` event (`PLUGIN_SPEC.md` §16) — comments are effectively append-only at the host. An "edit" writes a NEW comment carrying a `supersedes` link to the prior comment. The chat UI renders the superseding comment; classic Paperclip shows both (the original + the edit) as ordinary threaded comments — acceptable divergence, not a defect.

### Rich messages & attachments

- **D-12: Attachments = any file type, ~10MB cap, generic chip — no inline preview.** Attachments persist as Paperclip work-products; the message renders a filename / size / Open chip. Full-fidelity previewers (xlsx grid, pdf embed, png inline) are explicitly **Phase 5** (`DIST-03`) — Phase 4 does NOT render inline previews, including for images. Graceful-degrade per CHAT-07: when the work-product service is unavailable, the attach button is disabled with an explicit "Attachments are temporarily unavailable" message — never silent loss.

- **D-13: Promote-to-task creates a real issue; Pin is a chat-metadata flag.** "Promote to task" creates a real Paperclip issue, pre-filled from the message content and linked back to the topic issue. "Pin" sets a flag in the plugin's chat metadata (plugin-namespace); pinned messages surface in the right context rail. Both fully functional in v1 (CHAT-09).

- **D-14: Reasoning panel = issue-description convention + comment-body parse.** The per-topic issue **description** (which DOES propagate to the assigned agent — confirmed by the investigation, unlike manifest `instructions` which Phase 3 found do NOT propagate) asks the agent to end replies with a parseable reasoning block. The plugin parses that block from the comment body and renders the collapsible "Show reasoning" panel (CHAT-10, collapsed by default). If a reply lacks the block, the message renders as a plain bubble — no hard dependency, and it survives plugin disable as plain text. The "decision recorded" typeform (CHAT-09) is plugin-generated when Eric uses a decision/approve affordance (the plugin controls that path); agent-side outcome pills ("Created BEAAA-202") are parsed from the same body convention.

### Claude's Discretion

The planner / executor may choose pragmatic values within these constraints:

- **Pending-reply timeout duration (D-04)** — pick a sensible value (suggest 3–5 min); expose via `instanceConfigSchema` if cheap.
- **Realtime poll-fallback cadence (D-08)** — reuse `usePoll`; pick a low frequency (suggest 20–30s) consistent with the thundering-herd budget (PITFALLS.md §"3rd subscription per tab"). Visibility-pause on hidden tabs is mandatory (Phase 2 primitive already does this).
- **Reasoning-block delimiter convention (D-14)** — exact marker/format the issue description asks for and the parser recognizes. Constraint: must be unobtrusive when rendered as plain text in classic Paperclip.
- **`chat_topics` table columns** — minimum: `topic_id` (`CHT-NN`) PK, `issue_id` FK, `employee_user_id`/`agent_id`, `parent_issue_id`, title, `last_activity_at`, `archived` flag, `created_at`. Metadata only — never message content (CHAT-02).
- **Plugin-namespace partitioning** — define a dedicated chat namespace (e.g. `chat`) distinct from `bulletin` / `tldr-cache` / `agent-state-snapshot`; no surface writes another surface's namespace (PITFALLS.md §"namespace divergence").
- **`CHT-NN` numbering scheme** — sequential per company; planner picks the allocator.
- **Global search implementation (CHAT-08)** — per-employee linear timeline + global search across visible threads. Likely a worker handler doing `ILIKE` over `issue_comments` scoped to the company's chat topic issues; planner refines against what the host SQL surface exposes.
- **New-topic creation flow** — `+ New topic` UI affordance → `usePluginAction` → worker handler that creates the child issue (assigned to the employee) + `chat_topics` row.
- **Composer slash-commands / @-mention / Reference affordances** (sketch composer) — Reference (ref-chip insert) reuses the resolver; slash-commands and @-mention are Claude's discretion / can degrade to plain text for v1.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Project-level (locked decisions + requirements)

- `.planning/PROJECT.md` — Core value, Decision #1 (hybrid chat), #4 (per-employee timeline + global search), #5 (default landing), coexistence guarantees #3/#5/#6
- `.planning/REQUIREMENTS.md` §"Surface 4 — Employee Chat (CHAT)" — CHAT-01..11 (11 requirements). Every CHAT-NN must be addressed by exactly one plan's `requirements` field. §"v2 Requirements / Group threads" — `CHAT-G-01` is OUT of Phase 4.
- `.planning/ROADMAP.md` §"Phase 4: Employee Chat" — Goal + 5 success criteria + depends-on (Phase 2, Phase 3)
- `.planning/STATE.md` — Accumulated locked decisions

### Research synthesis (Phase-4-relevant sections)

- `.planning/research/FEATURES.md` §"Surface D — Employee Chat" (line 168 onward) — table-stakes (real-time message UI, per-employee threads, hybrid persistence = THE chat decision, topic strip, inline ref resolution, reasoning panel, promote-to-task, one-click decision message) with sketch line citations
- `.planning/research/PITFALLS.md` §"Pitfall 11" (hybrid chat dual-write divergence — edit-as-append-with-supersedes, optimistic-update failure, comment ordering); §"capability bypass / XSS" (chat is a named exfiltration vector); §"namespace divergence" (per-surface plugin namespaces); §"thundering herd" (chat is the 3rd subscription per tab); §"opt-in client-side-only" (server-side gate every handler)
- `.planning/research/ARCHITECTURE.md` — build order, shared-primitive reuse, contribution-point mechanics
- `.planning/research/STACK.md` — forced stack pins (React 19 peer-only, esbuild, Node ≥20, Tailwind inherited, shadcn new-york/neutral/lucide); `usePluginStream` / `usePluginData` / `usePluginAction` bridge
- `.planning/research/SUMMARY.md` — phase boundaries, build order

### Visual contract (non-throwaway design ground truth)

- **`sketches/paperclip-fix-employee-chat.html`** — Layout truth-of-record. Plans MUST match: 3-column shell `264px 1fr 340px` (roster / thread / context rail); roster with status dots + unread badges; topic strip; `.messages` scroller with day dividers; `.msg`/`.bubble` (Eric right-aligned `eric-bubble`, agent left `agent-bubble`); `.reasoning` `<details>` panel (ll. 547–557); `.attach` chip + `.attach.image` (image variant — but per D-12 v1 ships the generic chip only); `.resolved` outcome pill; `.promote` hover affordances; `.decision-msg` centered typeform; composer with tools row. Warm-dark editorial palette (Geist + Geist Mono + Instrument Serif). Surface stylesheet scoped to `[data-clarity-surface="chat"]`.

### Phase 2 / Phase 3 carryover (what already exists — reuse, do not rebuild)

- `src/manifest.ts` — already declares the `clarity-chat` page (`routePath: 'chat'`, `exportName: 'ChatPage'`). Phase 4 extends the manifest with chat capabilities (`issue.comments.create`, work-product write, issue create/assign, events subscribe, streams) — verify exact capability strings against `PLUGIN_SPEC.md` §15.
- `src/ui/surfaces/chat-stub.tsx` — the placeholder `ChatPage` to replace.
- `src/shared/reference-resolver.ts` — reused for inline ref chips
- `src/ui/primitives/use-poll.ts` — reused as realtime fallback (D-08)
- `src/ui/primitives/use-opt-in.ts`, `src/worker/opt-in-guard.ts`, `src/ui/primitives/use-resolved-user-id.ts` — opt-in gating pattern for every chat handler
- `migrations/` — append-only; Phase 4 adds the next-numbered `0006_*.sql` (`chat_topics` + chat metadata + Pin flags), NEVER touching prior migration files
- `src/worker/agents/agent-task-delivery.ts` — **reference for what NOT to do**: chat does not need wake/deliver machinery (D-01)
- `.planning/phases/02-scaffold-and-surfaces/02-CONTEXT.md`, `.planning/phases/03-daily-bulletin/03-CONTEXT.md` — prior locked decisions
- `runbook/` + `scripts/safety/` — Phase 1 snapshot/restore/smoke discipline still applies for any Phase 4 install/migration against BEAAA (Countermoves). Bookend with `clarity-safety snapshot` + `gate`.

### Paperclip host docs + source (external — `paperclipai/paperclip` `master` branch, investigated @ commit `242a2c2`)

- `doc/plugins/PLUGIN_SPEC.md` §10 (`page` slot), §14.1 (plugin issue **origin metadata** `plugin:<key>` — provenance only, NOT a privacy mechanism — D-07), §15 (capabilities), §16 (core events — `issue.comment.created` is subscribable; NO `issue.comment.updated` — D-11), §19 (same-origin trust model)
- `doc/plugins/PLUGIN_AUTHORING_GUIDE.md` — `ctx.events.on`, `ctx.streams.emit`, `ctx.issues.create` / `.comments.create`, issue assignment, work-product APIs, `instanceConfigSchema`, `ctx.db` namespace mechanics
- `packages/plugins/sdk/src/ui/hooks.ts` — `usePluginStream` signature: `usePluginStream<T>(channel: string, options?: {companyId?}) → {events, lastEvent, status, close()}` (plugin-defined SSE channel — D-08)
- `server/src/services/heartbeat.ts` — wake-payload assembly; `wakeCommentIds` / `WAKE_COMMENT_IDS_KEY` / `MAX_INLINE_WAKE_COMMENTS = 8` (D-01)
- `server/src/__tests__/issue-update-comment-wakeup-routes.test.ts` + `server/src/__tests__/heartbeat-comment-wake-batching.test.ts` — proof that comments wake the assignee (D-01)
- `server/src/services/issue-tree-control.ts` — issue tree (parent/child topic issues — D-05); interaction-wake gating
- `doc/SPEC-implementation.md` §7.7 (`issue_comments` schema — `author_agent_id` vs `author_user_id`, no `authorType` discriminator — D-01/D-11), §11.5 (heartbeat scheduler — `intervalSec` min 30s — D-04), §13.3 (budget consumed by run token work, not idle ticks)
- `packages/mcp-server/README.md` — `paperclipGetHeartbeatContext`, `paperclipListComments`, `paperclipListDocuments`
- **Branch note:** Paperclip default branch is `master`, not `main`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/shared/reference-resolver.ts` — batched ref resolution; powers inline `BEAAA-NNN` chips in chat messages.
- `src/ui/primitives/use-poll.ts` — lifecycle-aware poll primitive (visibility-pause, `WORKER_UNAVAILABLE` handling); the realtime fallback for D-08.
- `src/ui/primitives/use-opt-in.ts` + `src/worker/opt-in-guard.ts` + `src/ui/primitives/use-resolved-user-id.ts` / `use-resolved-company-id.ts` — opt-in gating; every chat `getData`/`performAction` handler must enforce the opt-in check server-side (PITFALLS.md §"opt-in client-side-only").
- `src/ui/primitives/ref-chip.tsx`, `state-pill.tsx`, `clarity-surface-root.tsx` — shared UI primitives; chat thread reuses ref-chip and the `[data-clarity-surface]` root wrapper.
- The Phase 3 `src/worker/handlers/*` + `src/worker/db/*-repo.ts` files are the pattern template for new `chat-*` handlers and a `chat-topics-repo.ts`.

### Established Patterns

- **Plugin entrypoints:** `src/manifest.ts` (PaperclipPluginManifestV1), `src/worker.ts` (`definePlugin` + `runWorker`), `src/ui/surfaces/<surface>/` React components externalizing `react`/`react-dom`/`react/jsx-runtime`/`@paperclipai/plugin-sdk/ui`/`…/ui/hooks`.
- **Test framework:** `node --test` (native runner). Suite is ~690 tests at Phase 3 mid-execution; Phase 4 continues TDD RED→GREEN→docs atomic commits.
- **Bridge-only host RPC:** UI calls Paperclip only via `usePluginData` / `usePluginAction` / `usePluginStream`; ESLint `no-raw-fetch-in-ui` enforced.
- **Migrations:** plain SQL in `migrations/`, applied in filename order, scoped to `ctx.db.namespace`; additive-only; never touch `public.*` DDL.

### Integration Points

- **Comment create / read** — `ctx.issues.comments.create` (Eric's outgoing message) + `ctx.events.on("issue.comment.created")` (incoming agent reply) → re-emit via `ctx.streams.emit`.
- **Issue create + assign** — per-employee parent issues + per-topic child issues, each assigned to the employee-agent (D-02, D-05). Verify the `ctx.issues.create` + assignment + parent-link SDK shape during Phase 4 research.
- **Work-products** — attachment storage; verify the work-product create/list SDK shape and the "service unavailable" error signal for the graceful-degrade path (D-12).
- **Employee list** — host API for the roster (D-03); verify the SDK/MCP shape.
- **CI** — extend the Phase 2 coexistence checklist with a chat-disable check (the `chat-comment coexistence` assertion was stubbed in Plan 02-04; CHAT-11 fills it in — an automated test that disables the plugin and asserts chat comments remain visible as ordinary threaded comments).

</code_context>

<specifics>
## Specific Ideas

- **Falsify-first plan.** Phase 4's first plan should live-verify D-01 on Countermoves (post a comment on an agent-assigned issue, observe the native reply) BEFORE building chat UI — the same discipline as Plan 02-01's smoke spike. Phase 3's five gap-closure plans are the cost of NOT doing this.
- **D-09 is the one genuine unknown** — the comment metadata/origin field is unverified. Treat it as a spike with a known fallback (`chat_messages` side table). Do not let the planner assume the field exists.
- **Mockup is the visual contract** — plans must cite `sketches/paperclip-fix-employee-chat.html` line numbers when specifying layout, matching the Phase 2/3 pattern.
- **Chat is an XSS/exfiltration surface** — user-typed messages + agent markdown + attachment chips. Render message content as untrusted input; no raw HTML injection; sanitize. (PITFALLS.md §"capability bypass".)
- **"Editorial Desk" voice does NOT apply here** — chat is Eric ↔ employee agents directly. The Editor-Agent persona is absent from this surface.
- **Comment ordering** — order the thread by server-side comment timestamp, not client send time, to avoid reorder-on-roundtrip across tabs (PITFALLS.md §11.4). The optimistic bubble reconciles to its server position when the `issue.comment.created` event lands.

</specifics>

<deferred>
## Deferred Ideas

- **Group threads** (Pricing huddle / GTM huddle) — v2, `CHAT-G-01` in REQUIREMENTS.md. The sketch's "Group threads" rail section is omitted from Phase 4.
- **Full-fidelity attachment previewers** (xlsx grid, pdf embed, png inline, md rendered) — Phase 5, `DIST-03`. Phase 4 ships the generic attachment chip only.
- **Inline image preview** — folded into the above; Phase 4 uses the generic chip even for images (D-12).
- **@-mention routing to non-assignee agents** — the mention wake path exists but its internals are undocumented; v1 chat is 1:1 via assignment (D-02). A future multi-agent capability could pilot it.
- **Composer slash-commands** — Claude's discretion; may degrade to plain text for v1.
- **"Private" topic issues** — not achievable; no host privacy mechanism exists (D-07). The word should be removed from PROJECT.md / REQUIREMENTS at the next phase transition. Not a deferral so much as a correction.
- **Editor-Agent in the chat roster** — considered and rejected for v1 (D-03); a "chat with the compiler" debugging surface could be a future idea.

</deferred>

---

*Phase: 04-employee-chat*
*Context gathered: 2026-05-18 (interactive discuss-phase + mid-discussion codebase investigation against paperclipai/paperclip@242a2c2)*
