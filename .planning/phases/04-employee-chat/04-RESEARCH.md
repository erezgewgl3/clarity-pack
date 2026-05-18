# Phase 4: Employee Chat - Research

**Researched:** 2026-05-18
**Domain:** Hybrid real-time chat persisted as Paperclip issue comments — Paperclip plugin (`@paperclipai/plugin-sdk@2026.512.0`)
**Confidence:** HIGH for SDK API contracts (verified against installed `node_modules` types + the live `paperclipai/paperclip@master` spec); MEDIUM for the `issue_commented` heartbeat wake (implementation ahead of spec — trust code+tests per CONTEXT.md D-01)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md `04-CONTEXT.md` has already locked D-01..D-14. Research does **not** re-litigate these — it verifies the SDK shapes CONTEXT.md flagged and supplies concrete API contracts. The locked decisions in full:

### Locked Decisions (D-01..D-14)

- **D-01** — Employee-agent replies are NATIVE Paperclip behaviour. Phase 4 builds ZERO agent-delivery code. "Send a chat message" = create a comment on the topic issue; posting a comment on an agent-assigned issue natively enqueues an `issue_commented` heartbeat wakeup. First plan SHOULD live-verify this on Countermoves before building UI.
- **D-02** — The wake contract is ASSIGNMENT, not @-mention. Each topic issue is assigned to exactly one employee-agent. Chat is 1:1.
- **D-03** — Roster = all Paperclip employees for the company; Editor-Agent excluded. Group threads omitted (v2 `CHAT-G-01`).
- **D-04** — Pending UX = "{Employee} is working…" indicator + a quiet timeout notice. Heartbeat min interval 30s; replies take minutes. Timeout duration is Claude's discretion (suggest 3–5 min).
- **D-05** — Topics = child issues under a per-employee parent issue (e.g. `Chat — CFO`). Each `CHT-NN` is a child issue assigned to the employee-agent. Discover topics by walking the issue tree from the parent.
- **D-06** — Topic lifecycle = classic close (`done`) + auto-reopen on send (flip to `in_progress` with the `resume` flag so the agent wakes).
- **D-07** — CONSTRAINT CORRECTION: there is NO private-issue mechanism in Paperclip. Plugin-created issues carry only `plugin:clarity-pack` origin metadata. Topic issues + comments WILL appear in classic Paperclip. The word "private" should be dropped from PROJECT.md/REQUIREMENTS.
- **D-08** — Realtime = worker event-bridge + `usePluginStream`, stream-primary with poll fallback. Worker subscribes `ctx.events.on("issue.comment.created", …)`, re-emits via `ctx.streams.emit(channel, event)`, UI consumes `usePluginStream(channel)`. Fallback: low-frequency `usePoll`.
- **D-09** — `message_uuid` idempotency key → comment origin/metadata field — WITH A VERIFICATION GATE. **(This research RESOLVES the gate — see below: the metadata field does NOT exist; the side-table fallback is mandatory.)**
- **D-10** — Optimistic send: failed message stays in thread with Retry; retry re-sends with the same `message_uuid`.
- **D-11** — Edits = append-with-supersedes. No `issue.comment.updated` event at the host; an "edit" writes a NEW comment with a `supersedes` link.
- **D-12** — Attachments = any file type, ~10MB cap, generic chip — no inline preview. Graceful-degrade per CHAT-07 when the attachment service is unavailable. **(This research flags a landmine — see Open Question OQ-1: no plugin asset-upload API exists.)**
- **D-13** — Promote-to-task creates a real Paperclip issue linked to the topic issue; Pin is a chat-metadata flag (plugin namespace).
- **D-14** — Reasoning panel = issue-description convention + comment-body parse. The per-topic issue *description* asks the agent to end replies with a parseable reasoning block; the plugin parses + renders the collapsible panel.

### Claude's Discretion

- Pending-reply timeout duration (D-04) — suggest 3–5 min; expose via `instanceConfigSchema` if cheap.
- Realtime poll-fallback cadence (D-08) — reuse `usePoll`; 20–30s; visibility-pause mandatory.
- Reasoning-block delimiter convention (D-14) — must be unobtrusive as plain text in classic Paperclip.
- `chat_topics` table columns — minimum: `topic_id` (`CHT-NN`) PK, `issue_id` FK, `employee_user_id`/`agent_id`, `parent_issue_id`, title, `last_activity_at`, `archived`, `created_at`. Metadata only.
- Plugin-namespace partitioning — a dedicated `chat` sub-namespace conceptually; physically one schema (see Architecture below).
- `CHT-NN` numbering — sequential per company; planner picks the allocator.
- Global search implementation (CHAT-08) — worker handler doing `ILIKE` over `issue_comments` scoped to chat topic issues.
- New-topic creation flow — `+ New topic` → `usePluginAction` → worker handler creating the child issue + `chat_topics` row.
- Composer slash-commands / @-mention — Reference (ref-chip insert) reuses the resolver; slash-commands/@-mention are discretion / may degrade to plain text.

### Deferred Ideas (OUT OF SCOPE)

- Group threads (Pricing/GTM huddle) — v2 `CHAT-G-01`. The sketch's "Group threads" rail section is OMITTED.
- Full-fidelity attachment previewers (xlsx grid, pdf embed, png inline, md rendered) — Phase 5 `DIST-03`. Phase 4 ships the generic chip only, including for images.
- @-mention routing to non-assignee agents — v1 chat is 1:1 via assignment.
- Composer slash-commands — discretion; may degrade to plain text.
- "Private" topic issues — not achievable; a correction, not a deferral.
- Editor-Agent in the chat roster.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-01 | Per-employee × per-topic chat surface — left rail / topic strip / central thread / right context rail | `page` slot already declared (`src/manifest.ts:199-205`, `routePath:'chat'`, `exportName:'ChatPage'`). 3-col shell `264px 1fr 340px` per sketch. Data handlers follow the Phase 3 `bulletin-by-cycle` pattern. |
| CHAT-02 | Every message persists to `public.issue_comments`; content never in a Clarity Pack table | `ctx.issues.createComment(issueId, body, companyId, options?)` — verified `types.d.ts:1076`. Side table stores only the `message_uuid → comment_id` map (D-09 fallback), never `body`. |
| CHAT-03 | `chat_topics` table maps `CHT-NN` → one issue ID; metadata only | New migration `0006_chat.sql` in the plugin namespace. Mirror `bulletins-repo.ts` shape. |
| CHAT-04 | Real-time via `usePluginStream` on `issue.comment.created` filtered by chat-issue ID | Worker-bridge pattern (D-08): `ctx.events.on('issue.comment.created')` → `ctx.streams.emit(channel,…)` → `usePluginStream(channel)`. `issue.comment.created` is a confirmed core event (PLUGIN_SPEC §16). |
| CHAT-05 | Edits = new comment with `supersedes`-link | No `issue.comment.updated` event (PLUGIN_SPEC §16) and no `supersedes` column on `issue_comments`. The supersedes link lives in the plugin side table; classic UI sees both comments. |
| CHAT-06 | Optimistic render + rollback; client `message_uuid` idempotency key | `message_uuid` stored in the plugin `chat_messages` side table (D-09 fallback — the comment-create API has NO metadata blob). Dedup-on-send checks the side table. |
| CHAT-07 | Attachments as Paperclip work-products; graceful-degrade when service unavailable | **LANDMINE — see OQ-1.** No plugin asset-upload API exists in SDK 2026.512.0. Phase 4 must spike the attachment path or descope to the always-degraded state. |
| CHAT-08 | Per-employee linear timeline + global search across visible threads | `ctx.db.query` with `ILIKE` over the `issue_comments` core-read table (already in `coreReadTables`, `manifest.ts:167-174`), JOINed to the plugin `chat_topics` table for chat-scoping. |
| CHAT-09 | Promote-to-task + Pin affordances; decision-recorded typeform | Promote = `ctx.issues.create` with `parentId` link (D-13). Pin = a flag column in the plugin side table. Decision typeform = plugin-generated. |
| CHAT-10 | Reasoning panel (collapsed `<details>`) | Parse a delimited block from the comment body (D-14). No host dependency — degrades to a plain bubble. |
| CHAT-11 | Coexistence test: plugin disable leaves chat messages as ordinary threaded comments | Satisfied for free by D-02 (content lives in `issue_comments`). Add `scripts/coexistence-checks/08-chat-disable.mjs` extending the Phase 2/3 checklist. |
</phase_requirements>

## Summary

Phase 4 builds the Employee Chat surface as a thin UI over Paperclip's native `issue_comments`. The hard architectural decisions are already locked in CONTEXT.md (D-01..D-14). This research's job was to verify the unverified SDK shapes — and it resolves the central unknowns decisively:

1. **D-09 is RESOLVED — the fallback is mandatory.** `ctx.issues.createComment` (`types.d.ts:1076`) is `createComment(issueId, body, companyId, options?)` where `options` accepts **only** `{ authorAgentId?: string }`. There is **no per-comment metadata/origin blob**. The `public.issue_comments` table schema (PLUGIN_SPEC-implementation §7.7) is `id, company_id, issue_id, author_agent_id, author_user_id, body` + `created_at/updated_at` — **no jsonb, no metadata, no supersedes column.** The `message_uuid` idempotency key (CHAT-06) and the `supersedes` link (CHAT-05) therefore **must** live in a plugin-namespace `chat_messages` side table that maps `message_uuid → comment_id`. This is CHAT-02-compliant: the side table maps, it never stores `body`.

2. **D-12 / CHAT-07 has a LANDMINE.** There is **no plugin asset-upload / work-product write API** in SDK 2026.512.0 — no `ctx.assets`, no upload method on any client. PLUGIN_SPEC §8.1 explicitly states "does not support plugin asset uploads/reads yet … Treat plugin asset APIs as future-scope ideas." The host *does* have `assets` + `issue_attachments` tables (SPEC-impl §7.14), but the plugin SDK exposes no writer for them. **The CHAT-07 graceful-degrade path ("Attachments are temporarily unavailable") is therefore the v1 STEADY STATE, not an error fallback** — unless a Phase 4 spike finds an undocumented path. See OQ-1 — this needs a user/planner decision.

3. **D-08 realtime is fully CONFIRMED.** `ctx.streams` exists (`types.d.ts:1246` — `open/emit/close`), `ctx.events.on('issue.comment.created', …)` is a confirmed core event (PLUGIN_SPEC §16), and `usePluginStream<T>(channel, {companyId?})` returns `{events, lastEvent, connecting, connected, error, close()}` (`ui/types.d.ts:355`). The worker-bridge pattern in D-08 is sound and buildable today.

4. **Everything else (D-01, D-03, D-05, D-06, D-13) is buildable with confirmed SDK shapes** — `ctx.issues.create` accepts `parentId` + `assigneeAgentId` + `surfaceVisibility` + `originKind`/`originId`; `ctx.agents.list({companyId})` returns the roster; `ctx.issues.update` accepts `{status}`; `ctx.issues.getSubtree` walks the topic tree. The one residual MEDIUM-confidence item is D-01's `issue_commented` heartbeat wake — the implementation is ahead of the spec; the falsify-first first plan must prove it live.

**Primary recommendation:** Plan 04-01 is a FALSIFY-FIRST spike that, on live Countermoves, (a) creates a child topic issue assigned to an employee-agent, posts a comment, and observes a native agent reply (D-01); and (b) attempts ONE attachment-upload path to settle OQ-1. Do not build any chat UI until both are answered. Then build the side-table + worker handlers, then the UI. The `chat_messages` side table is non-negotiable from day one — design `0006_chat.sql` with it in.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Message persistence (canonical) | API / Host DB (`public.issue_comments`) | — | D-02/CHAT-02 — content is host-owned; the plugin never stores `body`. |
| Idempotency map + supersedes link + Pin flags | Plugin DB namespace (`chat_messages`, `chat_topics`) | — | D-09 fallback — host has no metadata column; the plugin side table is the only home. |
| Topic = child issue under per-employee parent | API / Host (`ctx.issues.create` + issue tree) | Plugin DB (`chat_topics` mirror row) | D-05 — the issue tree is the durable structure; `chat_topics` is a fast-lookup cache + `CHT-NN` allocator. |
| Agent reply (heartbeat wake + LLM run) | API / Host (native `issue_commented` wake) | — | D-01 — Phase 4 builds ZERO agent-delivery code. |
| Realtime fan-out | Worker (event subscribe + stream emit) | UI (`usePluginStream` consume) | D-08 — `ctx.events` is worker-only; `ctx.streams` bridges to the UI SSE. |
| Optimistic send + rollback + Retry | Browser / Client (UI state) | Worker (`createComment` action handler) | D-10 — optimism is a UI concern; the worker is the durable write. |
| Reasoning-panel parse | Browser / Client (parse comment body) | — | D-14 — pure client-side string parse; no host dependency. |
| Global search | Worker (`ctx.db.query` ILIKE) | UI (search box) | CHAT-08 — `issue_comments` is a worker-readable core table; the UI cannot SQL. |
| Opt-in gate | Worker (`opt-in-guard` wrap) | UI (`useOptIn` render gate) | OPTIN-04 — server-side enforcement mandatory under same-origin trust. |

## Standard Stack

No new third-party libraries. Phase 4 is built entirely on the forced stack (CLAUDE.md) + Phase 2/3 in-repo assets.

### Core (all already present — verify versions, do not add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@paperclipai/plugin-sdk` | `2026.512.0` | All host RPC: `ctx.issues`, `ctx.events`, `ctx.streams`, `ctx.agents`, `ctx.db` | FORCED — sole supported plugin API. `[VERIFIED: node_modules/@paperclipai/plugin-sdk/dist/types.d.ts]` |
| React | `^19.0.0` (peer, externalized) | Chat UI components | FORCED — host runtime; never bundle. |
| TypeScript | `^5.7.3` | Worker + manifest + UI | FORCED — matches host. |
| esbuild | `^0.27.3` | UI + worker bundles | FORCED — `scripts/build-ui.mjs` pattern. |

### Supporting (in-repo, reuse — do NOT rebuild)

| Asset | Path | Purpose | When to Use |
|-------|------|---------|-------------|
| Reference resolver | `src/shared/reference-resolver.ts` | Inline `BEAAA-NNN` ref chips in messages (CHAT-09 implied) | Every agent/Eric message body that contains a ref. |
| `usePoll` | `src/ui/primitives/use-poll.ts` | Realtime FALLBACK path when the stream errors (D-08) | Wire as the degraded path; `createPollLoop` already has visibility-pause + `PLUGIN_DISABLED` terminal stop + content-hash dedupe. |
| `opt-in-guard` | `src/worker/opt-in-guard.ts` | `wrapDataHandler` / `wrapActionHandler` — OPTIN-04 server-side gate | Wrap EVERY chat `getData`/`performAction` handler. NOT the EXEMPT keys. |
| `useOptIn` + resolvers | `src/ui/primitives/use-opt-in.ts`, `use-resolved-user-id.ts`, `use-resolved-company-id.ts` | UI opt-in gate + thread `userId`/`companyId` into handler params | Chat page gated identically to Reader/Room/Bulletin. |
| `ClaritySurfaceRoot` + ref-chip + state-pill | `src/ui/primitives/` | `[data-clarity-surface="chat"]` scoped root + shared chips | Chat thread reuses ref-chip; new chat CSS scoped under the root. |
| Bulletin repo + handler pattern | `src/worker/db/bulletins-repo.ts`, `src/worker/handlers/bulletin-*.ts` | Pattern template for `chat-topics-repo.ts` + `chat-*` handlers | Copy the shape: typed repo, fully-qualified SQL, `wrap*Handler`, params validation. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `chat_messages` side table for `message_uuid` | Comment-create metadata blob | **Not available** — `createComment` options is `{authorAgentId?}` only. Side table is forced. |
| `usePluginStream` worker-bridge | Direct `usePoll` only (no stream) | CHAT-04 literally names `usePluginStream`; the bridge satisfies it and gives sub-second latency. Poll-only would be a requirement miss. Keep `usePoll` only as the fallback. |
| Walking the issue tree (`getSubtree`) for topic discovery | `chat_topics` table query only | Use the `chat_topics` table as the primary fast path; `getSubtree` is the reconcile/repair path if the table drifts from the host tree. |

**Installation:** None. No new dependencies.

**Version verification:** `@paperclipai/plugin-sdk@2026.512.0` is pinned and installed; the types read in this research are from the installed package. Renovate watches for SDK bumps.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────── BROWSER (same-origin, trusted) ───────────────────────┐
  Eric types a message    │  ChatPage (React)                                                            │
        │                 │   ├─ roster rail  ── usePluginData('chat.roster')                            │
        ▼                 │   ├─ topic strip  ── usePluginData('chat.topics', {employeeId})              │
  optimistic bubble ──────►│   ├─ thread       ── usePluginData('chat.messages', {topicIssueId})          │
  (client message_uuid)   │   │                  + usePluginStream('chat:<companyId>')  ◄──┐ realtime    │
        │                 │   │                  + usePoll(...)  ◄── FALLBACK on stream error│           │
        │                 │   └─ composer / attach / promote / pin                          │           │
        └── usePluginAction('chat.send', {topicIssueId, body, message_uuid, userId}) ─┐      │           │
                          └──────────────────────────────────────────────────────────┼──────┼───────────┘
                                                                                     │      │
        ┌──── WORKER (Node child process, capability-gated) ──────────────────────────▼──────┼───────────┐
        │  chat.send handler (opt-in-guard wrapped)                                          │           │
        │    1. dedup: SELECT chat_messages WHERE message_uuid = $1   (idempotency, D-09)     │           │
        │    2. ctx.issues.createComment(topicIssueId, body, companyId)  ──► public.issue_comments       │
        │    3. INSERT chat_messages (message_uuid, comment_id, topic, sender, sent_at)       │           │
        │    4. (if topic is `done`) ctx.issues.update(issueId,{status:'in_progress'})  re-wakes agent    │
        │                                                                                    │           │
        │  ctx.events.on('issue.comment.created')  ──── re-emit ──► ctx.streams.emit('chat:<companyId>') ─┘
        │                                                                                                │
        │  chat.search handler ── ctx.db.query ILIKE over public.issue_comments ⋈ chat_topics             │
        └────────────────────────────────────────────────────────────────────────────────────────────────┘
                          │                                            ▲
                          │ comment on agent-assigned issue             │ agent writes reply comment
                          ▼                                            │
        ┌──── PAPERCLIP HOST ────────────────────────────────────────────────────────────────┐
        │  issue_commented heartbeat wake (NATIVE — D-01, zero plugin code)                   │
        │  employee-agent runs → writes an ordinary issue_comments row → fires                │
        │  issue.comment.created  ───────────────────────────────────────────────────────────┘
```

Trace the primary use case (Eric sends a message, agent replies): optimistic bubble → `chat.send` → `createComment` → host stores the row → host wakes the assigned agent → agent replies with a comment → host fires `issue.comment.created` → worker re-emits on the stream channel → UI receives it and reconciles the optimistic bubble to its server position.

### Component Responsibilities

| File (new in Phase 4) | Tier | Responsibility |
|------------------------|------|----------------|
| `migrations/0006_chat.sql` | Host DB (plugin namespace) | `chat_topics` + `chat_messages` + Pin flags. Additive-only. |
| `src/worker/db/chat-topics-repo.ts` | Worker | Typed CRUD for `chat_topics` + `chat_messages` (mirror `bulletins-repo.ts`). `CHT-NN` allocator. |
| `src/worker/handlers/chat-roster.ts` | Worker | `ctx.agents.list({companyId})` → employee roster, Editor-Agent filtered out (D-03). |
| `src/worker/handlers/chat-topics.ts` | Worker | List topics for an employee (`chat_topics` query); `+ New topic` action → `ctx.issues.create` child issue + row. |
| `src/worker/handlers/chat-messages.ts` | Worker | List messages for a topic (`ctx.issues.listComments` ⋈ `chat_messages` for supersedes/pin). |
| `src/worker/handlers/chat-send.ts` | Worker | `chat.send` action — dedup, `createComment`, side-table insert, auto-reopen (D-06, D-10). |
| `src/worker/handlers/chat-edit.ts` | Worker | `chat.edit` — append-with-supersedes (D-11): new comment + `supersedes` row. |
| `src/worker/handlers/chat-search.ts` | Worker | `chat.search` — ILIKE over `issue_comments` ⋈ `chat_topics` (CHAT-08). |
| `src/worker/handlers/chat-promote.ts` + `chat-pin.ts` | Worker | Promote-to-task (`ctx.issues.create` w/ `parentId`); Pin flag toggle (D-13). |
| `src/worker/streams/chat-stream-bridge.ts` | Worker | `ctx.events.on('issue.comment.created')` → `ctx.streams.emit('chat:<companyId>', …)` (D-08). |
| `src/ui/surfaces/chat/` | Browser | Replaces `chat-stub.tsx`. Roster / topic strip / thread / composer / context rail. |
| `src/ui/surfaces/chat/chat.css` | Browser | Scoped `[data-clarity-surface="chat"]` stylesheet. Sketch fidelity. |

### Recommended Project Structure

```
migrations/
└── 0006_chat.sql                  # next-numbered; chat_topics + chat_messages

src/worker/
├── db/chat-topics-repo.ts          # typed repo (mirror bulletins-repo.ts)
├── handlers/chat-*.ts              # roster, topics, messages, send, edit, search, promote, pin
└── streams/chat-stream-bridge.ts   # issue.comment.created → ctx.streams.emit

src/ui/surfaces/chat/
├── index.tsx                       # ChatPage (exportName must stay 'ChatPage')
├── roster-rail.tsx
├── topic-strip.tsx
├── message-thread.tsx              # bubbles, day dividers, optimistic state
├── composer.tsx
├── context-rail.tsx
├── reasoning-panel.tsx             # <details> parse of D-14 block
└── chat.css                        # [data-clarity-surface="chat"]-scoped
```

### Pattern 1: `chat_messages` side table — the D-09 fallback (MANDATORY)

**What:** A plugin-namespace table mapping the client `message_uuid` to the host `comment_id`, plus the `supersedes` chain and Pin flags. **It never stores message `body`** — that keeps CHAT-02 honest.
**When to use:** Always. The comment-create API has no metadata field; this is the only place idempotency/supersedes/pin state can live.
**Example (proposed `0006_chat.sql` shape — planner refines columns):**

```sql
-- 0006_chat.sql — all DDL fully-qualified to plugin_clarity_pack_cdd6bda4bd
-- (validator requires it; NO template substitution; NO standalone CREATE INDEX;
--  NO procedural DO $$ blocks; NO trailing comments; keep comments apostrophe-free).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_topics (
  topic_id          text PRIMARY KEY,          -- CHT-NN, per-company sequential
  company_id        text NOT NULL,
  issue_id          text NOT NULL,             -- the child topic issue
  parent_issue_id   text NOT NULL,             -- the per-employee Chat -- X parent
  employee_agent_id text NOT NULL,             -- assignee employee-agent
  title             text NOT NULL,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  archived          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, issue_id)
);

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.chat_messages (
  message_uuid      text PRIMARY KEY,          -- client-generated idempotency key
  company_id        text NOT NULL,
  topic_issue_id    text NOT NULL,
  comment_id        text,                      -- host issue_comments.id; NULL until confirmed
  sender_kind       text NOT NULL CHECK (sender_kind IN ('user','agent')),
  supersedes_uuid   text,                      -- D-11 edit chain; NULL = original
  pinned            boolean NOT NULL DEFAULT false,
  sent_at           timestamptz NOT NULL DEFAULT now()
);
```

Dedup on send: `SELECT comment_id FROM chat_messages WHERE message_uuid = $1` — if a row exists, the send already landed (or half-landed); return that `comment_id`, do not re-`createComment`.

### Pattern 2: Worker stream bridge (D-08)

**What:** The worker subscribes once to the native `issue.comment.created` event and re-emits onto a plugin SSE channel.
**When to use:** Register in `worker.ts:setup()` alongside the existing event handlers.
**Example:**

```typescript
// Source: ctx.streams docs — types.d.ts:1224-1264; ctx.events.on — types.d.ts:305
// Channel name is plugin-defined; scope it per company.
ctx.events.on('issue.comment.created', async (event) => {
  if (!event.companyId || !event.entityId) return;
  // entityId is the issue id; only relay comments on chat topic issues.
  const topic = await isChatTopicIssue(ctx, event.companyId, event.entityId);
  if (!topic) return;
  ctx.streams.emit(`chat:${event.companyId}`, {
    type: 'comment.created',
    issueId: event.entityId,
    commentId: event.payload, // shape: payload is unknown — see Open Question OQ-2
    occurredAt: event.occurredAt,
  });
});
```

UI side: `usePluginStream<ChatStreamEvent>(\`chat:${companyId}\`)` returns `{events, lastEvent, connecting, connected, error, close}`. On `error` non-null → fall back to `usePoll`.

### Pattern 3: Optimistic send with `message_uuid` reconciliation (D-10, CHAT-06)

**What:** UI generates `crypto.randomUUID()` before send, renders the bubble immediately, calls `chat.send`. On the `issue.comment.created` stream event the optimistic bubble reconciles to its server position. On send failure the bubble stays with a Retry affordance; Retry re-sends the **same** `message_uuid` so a half-succeeded send dedupes (D-10).
**When to use:** The composer send path.
**Anti-pattern avoided:** Never order the thread by client send time — order by server `created_at` (PITFALLS §11.4). The optimistic bubble is a transient overlay keyed by `message_uuid` until the server row arrives.

### Anti-Patterns to Avoid

- **Storing message `body` in a Clarity Pack table.** Breaks CHAT-02. The side table maps IDs only.
- **Optimistic UI that survives failure.** PITFALLS §11.3 — a failed `chat.send` must leave the bubble marked "Failed to send" with Retry, never silently "delivered".
- **Ordering the thread by client clock.** PITFALLS §11.4 — clock skew across tabs reorders messages. Server `created_at` only.
- **Rendering agent markdown / Eric's text as raw HTML.** PITFALLS §"capability bypass" — chat is a named XSS/exfiltration vector. Render as untrusted input; sanitize. See Security Domain.
- **A continuous worker loop or `setInterval` for chat.** Not needed — D-01 makes replies native; the stream bridge is event-driven.
- **Writing into another surface's namespace.** PITFALLS §"namespace divergence" — chat tables are conceptually the `chat` sub-namespace. (Physically all plugin tables share the one `plugin_clarity_pack_cdd6bda4bd` schema; the discipline is logical — no chat handler touches `bulletins`/`situation_snapshots`/`tldrs`, and vice versa.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lifecycle-aware polling (fallback path) | A bare `setInterval` refetch | `usePoll` / `createPollLoop` (`src/ui/primitives/use-poll.ts`) | Already handles visibility-pause, exponential backoff, `PLUGIN_DISABLED` terminal stop, content-hash dedupe. |
| Server-side opt-in enforcement | Per-handler inline prefs check | `wrapDataHandler` / `wrapActionHandler` (`src/worker/opt-in-guard.ts`) | Centralized; pins the EXEMPT set; already covers the `userId`/`viewerUserId` param drift. |
| Inline `BEAAA-NNN` resolution | A new per-chip fetch | `resolveRefs` (`src/shared/reference-resolver.ts`) | Single round-trip, dedupes, viewer-permission-aware excerpt. PITFALLS §12 (N+1 fan-out). |
| Agent reply delivery | Wake/deliver/poll machinery (the Phase 3 `agent-task-delivery.ts` saga) | Nothing — native `issue_commented` wake (D-01) | Phase 3's five gap-closure plans are the cost of NOT trusting native behaviour. Chat replies are native. |
| Realtime fan-out transport | A custom WebSocket / SSE server | `ctx.streams` + `usePluginStream` | The SDK ships the SSE channel; rolling your own breaks the same-origin bridge. |
| Typed DB repo | Ad-hoc inline SQL in handlers | `chat-topics-repo.ts` mirroring `bulletins-repo.ts` | Consistent fully-qualified-SQL discipline; testable in isolation. |

**Key insight:** Phase 4's value is that almost everything is *already built or native*. The only genuinely new code is the `chat_messages` side table, eight thin worker handlers, the stream bridge, and the React surface. Resist the urge to build an agent-delivery layer or a chat datastore — both are anti-features explicitly rejected in FEATURES.md §D.3.

## Runtime State Inventory

Phase 4 is **additive greenfield within the plugin** — it adds a migration, handlers, and UI; it renames/migrates nothing. The relevant categories:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `chat_topics` + `chat_messages` tables only. No existing data is renamed or migrated. | New migration `0006_chat.sql`. |
| Live service config | Manifest gains chat capabilities (see Environment Availability). Installed onto live Countermoves = a plugin upgrade. | Bookend the Countermoves install/upgrade with `clarity-safety snapshot` + `gate` (CLAUDE.md bookended-by-snapshots rule). |
| OS-registered state | None — no cron/jobs/tasks added (chat is event-driven, not scheduled). | None. |
| Secrets/env vars | None — chat uses no new secrets; MCP/LLM env unchanged. | None. |
| Build artifacts | UI bundle gains the chat surface; `dist/ui` rebuilt. `manifest.ts` version bump (0.6.6 → 0.7.0 suggested). | Standard `pnpm` rebuild + `pnpm pack`. |

**The `chat_topics` ↔ host issue tree drift risk** is the one "runtime state" subtlety: the plugin's `chat_topics` table caches what the host issue tree already knows (D-05). If a topic issue is deleted/moved in classic Paperclip, the table drifts. Mitigation: treat `ctx.issues.getSubtree` from the per-employee parent as the source of truth for a reconcile/repair path; `chat_topics` is a fast-lookup cache + the `CHT-NN` allocator.

## Common Pitfalls

### Pitfall 1: Assuming the comment-create API carries a metadata blob (D-09)

**What goes wrong:** A plan assumes `createComment` can stash the `message_uuid` on the comment, so it skips the side table. Then idempotency (CHAT-06) and the supersedes chain (CHAT-05) have nowhere to live.
**Why it happens:** It's the natural design; CONTEXT.md D-09 itself flagged it as the genuine unknown.
**How to avoid:** This research RESOLVED it — `createComment(issueId, body, companyId, options?)`, `options = {authorAgentId?}` only (`types.d.ts:1076`); `issue_comments` has no jsonb column (SPEC-impl §7.7). Build the `chat_messages` side table from `0006_chat.sql` onward. **No spike needed for this — it is settled.**

### Pitfall 2: Treating CHAT-07 attachments as a normal feature

**What goes wrong:** A plan budgets a task for "upload attachment as work-product" and the executor finds no SDK method to do it — late-phase blocker.
**Why it happens:** CONTEXT.md D-12 says "attachments persist as Paperclip work-products" and the sketch shows attachment chips, implying the capability exists.
**How to avoid:** There is **no plugin asset-upload API** (PLUGIN_SPEC §8.1; no `ctx.assets` in `types.d.ts`). See OQ-1. The first plan must spike this; the planner must NOT assume an upload path exists. Most likely v1 outcome: CHAT-07 ships as the *always-degraded* state (attach button disabled, explicit message) — which is itself a valid, requirement-satisfying implementation of CHAT-07's graceful-degrade clause.

### Pitfall 3: Hybrid chat dual-write divergence (PITFALLS §11)

**What goes wrong:** Optimistic bubble survives a failed write; edit shows in chat but not classic UI; thread reorders on round-trip; attachment references a dead work-product ID.
**How to avoid:** `issue_comments` is the single source of truth; the UI is a view. Roll back on failure with a Retry affordance (D-10). Edits = append-with-supersedes (D-11). Order by server `created_at`, never client clock. `message_uuid` idempotency key dedupes replays.
**Warning signs:** Thread shows N bubbles, `issue_comments` has N-1 rows; an edit visible in chat but not classic UI; "I sent that but the agent never saw it".

### Pitfall 4: Thundering herd — chat is the 3rd subscription per tab (PITFALLS §7)

**What goes wrong:** Reader + Situation Room + Chat all open in multiple tabs → N parallel poll/stream connections hammering the worker.
**How to avoid:** The stream bridge is one SSE connection per tab — cheap. The `usePoll` *fallback* must keep the Phase 2 visibility-pause (mandatory) and a low cadence (20–30s, D-08 discretion). Single-leader `BroadcastChannel` election (Phase 2 primitive) should wrap the fallback poll if multiple chat tabs are realistic.

### Pitfall 5: `issue_commented` wake is ahead of the spec (D-01)

**What goes wrong:** A plan trusts D-01 without live proof; if the host version on Countermoves doesn't wake agents on comments, the entire chat reply loop is dead.
**Why it happens:** `issue_commented` heartbeat wake is NOT in `doc/execution-semantics.md` / SPEC-impl §8 — it's proven only by code+tests at `paperclipai/paperclip@242a2c2`.
**How to avoid:** The falsify-first first plan (Plan 04-01) live-verifies it on Countermoves before any UI is built. Same discipline as Plan 02-01.

### Pitfall 6: CSS bleed-through into host UI

**What goes wrong:** New chat styles leak into classic Paperclip (SCAF-06 regression).
**How to avoid:** Scope every chat rule under `[data-clarity-surface="chat"]` via `ClaritySurfaceRoot name="chat"` (the stub already does this). Inherit host tokens; ship no Tailwind.

## Code Examples

### Create a topic child issue assigned to an employee-agent (D-05)

```typescript
// Source: PluginIssuesClient.create — types.d.ts:1023-1048
const topicIssue = await ctx.issues.create({
  companyId,
  parentId: perEmployeeParentIssueId,   // the "Chat -- CFO" parent
  title: 'Broker comm % decision',
  description: REASONING_BLOCK_INSTRUCTION,  // D-14 — asks the agent for a parseable block
  status: 'todo',
  assigneeAgentId: employeeAgentId,     // D-02 — assignment is the wake contract
  originKind: 'plugin:clarity-pack',    // D-07 — provenance tag only, not privacy
  originId: `chat-topic-${chtNumber}`,
});
```

### Post Eric's message as a comment (CHAT-02)

```typescript
// Source: PluginIssuesClient.createComment — types.d.ts:1076
// NOTE: options accepts ONLY { authorAgentId? } — there is NO metadata field.
const comment = await ctx.issues.createComment(topicIssueId, body, companyId);
// message_uuid -> comment.id mapping goes in the chat_messages side table:
await insertChatMessage(ctx, { messageUuid, companyId, topicIssueId,
  commentId: comment.id, senderKind: 'user' });
```

### Auto-reopen a closed topic on send (D-06)

```typescript
// Source: PluginIssuesClient.update — types.d.ts:1049
// A 'done' topic does not wake its agent; flip it back so the reply happens.
if (topic.status === 'done') {
  await ctx.issues.update(topicIssueId, { status: 'in_progress' }, companyId);
}
// NOTE: the 'resume' flag CONTEXT.md D-06 mentions is not a typed field on the
// update patch — verify the live host behaviour: setting status to 'in_progress'
// may be sufficient to re-wake. See Open Question OQ-3.
```

### Roster of employee-agents, Editor-Agent excluded (D-03)

```typescript
// Source: PluginAgentsClient.list — types.d.ts:1111
const agents = await ctx.agents.list({ companyId });
const roster = agents.filter((a) => a.id !== editorAgentId);  // exclude infra agent
```

### Global search over chat comments (CHAT-08)

```typescript
// Source: PluginDatabaseClient.query — types.d.ts:373 (SELECT-only, core-read tables)
// issue_comments is already in coreReadTables (manifest.ts:168).
const rows = await ctx.db.query(
  `SELECT c.id, c.issue_id, c.body, c.created_at
   FROM public.issue_comments c
   JOIN plugin_clarity_pack_cdd6bda4bd.chat_topics t
     ON t.issue_id = c.issue_id AND t.company_id = $1
   WHERE c.body ILIKE $2
   ORDER BY c.created_at DESC
   LIMIT 50`,
  [companyId, `%${escapeLike(searchTerm)}%`],
);
// escapeLike must escape % and _ in the user term — see Security Domain V5.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Per-topic **private** issues" (PROJECT.md / REQUIREMENTS) | Ordinary issues with `plugin:clarity-pack` origin metadata; visible in classic UI | Resolved in CONTEXT.md D-07 | "Private" is not achievable; the word should be dropped at the next phase transition. Topic issues + comments appear in classic Paperclip — and that is what satisfies CHAT-11 for free. |
| "Attachments persist as Paperclip work-products" (assumed buildable) | No plugin asset-upload API exists in SDK 2026.512.0 (PLUGIN_SPEC §8.1) | Confirmed by this research | CHAT-07 likely ships as the always-degraded state. See OQ-1. |
| Edits update the comment in place | Append-with-supersedes (no `issue.comment.updated` event) | Locked in D-11; confirmed §16 | Classic UI shows both the original and the edit; chat UI collapses the chain. |

**Deprecated/outdated:**
- The sketch's "auto-replied 14s" latency figure — D-04 corrects this; heartbeat min interval is 30s and real replies take minutes. The pending UX shows "{Employee} is working…" not a 14s promise.
- The sketch's "Group threads" rail section — omitted from Phase 4 (v2 `CHAT-G-01`).
- The sketch's `.attach.image` inline-image variant — D-12 ships the generic chip even for images.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `event.payload` on `issue.comment.created` contains (or lets the worker derive) the new comment's `id`/`body` | Pattern 2, OQ-2 | If the payload is opaque, the stream bridge must re-`listComments` to get the new comment — an extra round-trip, not a blocker. |
| A2 | Setting a topic issue's status to `in_progress` re-wakes the assigned agent (D-06's `resume` flag is not a typed SDK field) | Code Examples, OQ-3 | If a plain status flip does not re-wake, the auto-reopen-on-send path (D-06) needs `ctx.issues.requestWakeup` as well — already a declared capability (`issues.wakeup`). |
| A3 | `Agent` objects from `ctx.agents.list` carry a distinguishable role/title so the roster can render employee cards and exclude the Editor-Agent by id | D-03 roster | Low risk — `editorAgentId` is resolvable via `ctx.agents.managed.get('editor-agent', companyId)`; exclusion by id is reliable regardless of the role field. |
| A4 | The `issue_commented` native heartbeat wake works on the host version installed on Countermoves | D-01, Pitfall 5 | HIGH impact — the entire reply loop depends on it. Mitigated by the falsify-first Plan 04-01 live spike. |
| A5 | An employee-agent, woken by a comment, will actually reply with a comment (not a document, not silence) — the Phase 3 Editor-Agent surprised the team by filing documents instead of comments | D-01, OQ-4 | MEDIUM — Phase 3's 03-06..03-10 saga was exactly this class of surprise. The Plan 04-01 spike must observe the *form* of the reply, not just that the agent woke. |

## Open Questions (OQ-3/OQ-4 gate Plan 04-01)

1. **OQ-1 — CHAT-07 attachments: is there ANY plugin-accessible upload path?** — **RESOLVED (research body): no plugin asset-upload API exists in SDK 2026.512.0** (Summary point 2, Pitfall 2 — PLUGIN_SPEC §8.1, no `ctx.assets` in `types.d.ts`). CHAT-07 ships as the steady-state degraded path. Plan 04-01 only spikes for an *undocumented* path as a long-shot; the degraded outcome is the planned-for default.
   - What we know: SDK 2026.512.0 has no `ctx.assets` and no upload method on any client; PLUGIN_SPEC §8.1 says plugin asset APIs are "future-scope, not current implementation". The host DB has `assets` + `issue_attachments` tables (SPEC-impl §7.14) but no plugin writer.
   - What's unclear: whether issue *documents* (`ctx.issues.documents.upsert`, which DOES exist — `types.d.ts:830`) could carry a small file as a base64/markdown body as a degraded attachment path; or whether the host exposes an undocumented multipart route.
   - Recommendation: Plan 04-01 spends ONE task probing this. If nothing works, **CHAT-07 ships as the steady-state degraded path** — attach button disabled with the explicit "Attachments are temporarily unavailable" message. That literally satisfies CHAT-07's graceful-degrade clause; flag it to the user at the next phase transition as a scope correction (like D-07's "private" correction). Do NOT let a plan promise working uploads.

2. **OQ-2 — `issue.comment.created` payload shape.** — **RESOLVED (research body): the design is settled either way** — the stream bridge in Plan 04-03 derives `commentId` from a `ctx.issues.listComments` re-fetch keyed on `event.entityId` (safe default, Assumption A1); if the Plan 04-01 spike logs a payload that already carries the comment id, that is an optimization, not a redesign. `PluginEvent.payload` is typed `unknown` (`types.d.ts:76`). Does it carry the new comment's `id` and `body`, or just the issue id in `entityId`? If opaque, the stream bridge re-fetches via `listComments`. The Plan 04-01 spike should log a real event payload. Not a blocker either way.

3. **OQ-3 — D-06 `resume` flag.** — **PENDING — resolved by Plan 04-01 spike.** CONTEXT.md D-06 says re-wake a closed topic "with the `resume` flag". The SDK `update` patch has no `resume` field. Either a plain `status:'in_progress'` flip re-wakes the agent, or the worker must also call `ctx.issues.requestWakeup` (capability `issues.wakeup` is already declared). Verify in the Plan 04-01 spike.

4. **OQ-4 — reply form.** — **PENDING — resolved by Plan 04-01 spike.** Phase 3 discovered the Editor-Agent files *documents* rather than posting *comments* unless instructed via the issue description. A plain employee-agent woken by a chat comment — does it reply with a comment by default? D-14 already plans to put a reasoning-block instruction in the topic-issue *description*; that same description should explicitly instruct "reply by posting a comment on this issue". The Plan 04-01 spike must confirm the reply lands as an `issue_comments` row.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@paperclipai/plugin-sdk` | All chat handlers | ✓ | `2026.512.0` (installed, pinned) | — |
| `ctx.issues.createComment` | CHAT-02 send | ✓ | `types.d.ts:1076` | — |
| `ctx.issues.create` (parentId, assigneeAgentId) | D-05 topics, D-13 promote | ✓ | `types.d.ts:1023` | — |
| `ctx.issues.update` (status) | D-06 auto-reopen | ✓ | `types.d.ts:1049` | + `requestWakeup` if status flip insufficient (OQ-3) |
| `ctx.events.on('issue.comment.created')` | CHAT-04 realtime | ✓ | core event, PLUGIN_SPEC §16 | — |
| `ctx.streams` (open/emit/close) | CHAT-04 bridge | ✓ | `types.d.ts:1246` | `usePoll` (D-08 fallback) |
| `usePluginStream` | CHAT-04 UI | ✓ | `ui/hooks.d.ts:145` | `usePoll` |
| `ctx.agents.list` | D-03 roster | ✓ | `types.d.ts:1111` | — |
| `ctx.db.query` ILIKE over `issue_comments` | CHAT-08 search | ✓ | `types.d.ts:373`; `issue_comments` in `coreReadTables` | — |
| Plugin asset / work-product upload API | CHAT-07 attachments | ✗ | — | **No fallback — see OQ-1.** CHAT-07 likely ships always-degraded. |
| `issue_commented` native heartbeat wake | D-01 agent reply | ⚠ unverified on live host | — | None — falsify-first Plan 04-01 must prove it. |

**Missing dependencies with no fallback:**
- Plugin asset-upload API (CHAT-07) — see OQ-1. The graceful-degrade state is the v1 implementation unless the spike finds a path.

**Missing dependencies with fallback:**
- Realtime stream — `usePoll` is the D-08 fallback, already built.

**Manifest capability additions needed for Phase 4** (verify exact strings against `PluginCapability` union at install; the manifest already declares most): `issues.create` ✓, `issue.comments.create` ✓, `issue.comments.read` ✓, `issues.update` (verify — currently the manifest has create but the update path for D-06 may need it explicitly), `issues.wakeup` ✓, `events.subscribe` ✓, `agents.read` ✓, `database.namespace.*` ✓. **`ctx.streams` capability** — confirm whether emitting on a stream needs a distinct capability string; `ctx.streams` is not gated in the same way as `events`, but verify at install (Plan 04-01).

## Security Domain

Chat is a **named XSS / data-exfiltration vector** (PITFALLS §"capability bypass / same-origin trust footgun" §3). Plugin UI runs as same-origin trusted JS; a bad markdown renderer or attachment preview can exfiltrate Eric's session or hit forbidden host APIs. `security_enforcement` is not set in config — but the same-origin trust model in CLAUDE.md makes this section mandatory for the chat surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Host-managed; the plugin never authenticates. |
| V3 Session Management | no | Host session; plugin must not touch it. |
| V4 Access Control | yes | Every chat `getData`/`performAction` handler wrapped with `opt-in-guard` (OPTIN-04). Promote/Pin/edit actions re-verify the caller's `userId` server-side (the `bulletin-action-approve.ts` `NOT_OWNED` pattern). |
| V5 Input Validation | yes | Message body + search term + topic title are untrusted. Render message content as text, never `dangerToggleInnerHTML`. The CHAT-08 ILIKE term must escape `%` and `_`; the parameterized `ctx.db.query` handles SQL injection but the LIKE wildcards still need escaping. |
| V6 Cryptography | no | `crypto.randomUUID()` for `message_uuid` is identity, not security — no crypto primitives hand-rolled. |
| V7 Error Handling / Logging | yes | Failed sends surface explicit user-facing state (D-10); never a silent swallow. |
| V12 / V14 (File handling) | conditional | Only if OQ-1 yields an upload path — then file-type/size validation (~10MB cap, D-12) and never trusting the client-supplied content-type. |

### Known Threat Patterns for the chat stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored XSS via agent markdown or Eric's typed message | Tampering / Elevation | Render message bodies as untrusted text; if markdown is rendered, use a sanitizing renderer with an allowlist — no raw HTML, no inline event handlers, no `javascript:` URLs. Reasoning-block parse (D-14) operates on text, never `eval`. |
| SQL injection in CHAT-08 search | Tampering | Parameterized `ctx.db.query` only (the SDK enforces SELECT-only on core tables); escape `%`/`_` in the LIKE term. |
| Capability bypass — UI calls a Paperclip HTTP API directly | Elevation of Privilege | ESLint `no-raw-fetch-in-ui` stays in force; all host RPC via `usePluginData`/`usePluginAction`/`usePluginStream`. |
| Opt-in bypass — opted-out user calls a chat handler via the bridge | Elevation of Privilege | `opt-in-guard` server-side wrap on every non-exempt handler (OPTIN-04). |
| Cross-company data leak in search / roster | Information Disclosure | Every query scoped by `companyId` from the resolved host context; the CHAT-08 JOIN through `chat_topics` enforces company scoping (mirror `bulletins-repo.ts` `listErrataByCycle` join pattern). |
| Promote/Pin/edit on someone else's message | Tampering | Re-verify `userId` ownership server-side before mutating (the `bulletin-action-approve.ts` `NOT_OWNED` guard). |

## Recommended Build Order

1. **Plan 04-01 — FALSIFY-FIRST SPIKE (autonomous build + Eric Countermoves drill).** On live Countermoves: create a `Chat — <employee>` parent issue + a child topic issue assigned to an employee-agent, post a comment, observe (a) the agent wakes and (b) the *form* of its reply (comment vs document — OQ-4); log a real `issue.comment.created` payload (OQ-2); test whether a `status:'in_progress'` flip re-wakes a `done` topic (OQ-3); probe ONE attachment-upload path (OQ-1). **No chat UI is built until this passes.** Bookend with `clarity-safety snapshot` + `gate`.
2. **Plan 04-02 — data layer.** `0006_chat.sql` (`chat_topics` + `chat_messages`), `chat-topics-repo.ts`, the `CHT-NN` allocator, manifest capability additions + version bump. TDD.
3. **Plan 04-03 — worker handlers.** `chat-roster`, `chat-topics` (+ new-topic action), `chat-messages`, `chat-send` (dedup + createComment + side-table + auto-reopen), `chat-edit` (supersedes), `chat-search`, `chat-promote`, `chat-pin`, `chat-stream-bridge`. All `opt-in-guard` wrapped. TDD.
4. **Plan 04-04 — UI surface.** Replace `chat-stub.tsx`: roster rail / topic strip / message thread (optimistic + day dividers) / composer / context rail / reasoning panel. `usePluginStream` primary + `usePoll` fallback. `chat.css` scoped, sketch-line-cited. Eric Countermoves visual-fidelity drill.
5. **Plan 04-05 — coexistence + closure.** `scripts/coexistence-checks/08-chat-disable.mjs` (CHAT-11 — disable plugin, assert chat comments still visible as ordinary threaded comments); extend the CI checklist. Closure drill on Countermoves.

(Plan count is the planner's call — this is the natural wave shape.)

## Sources

### Primary (HIGH confidence)
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — `PluginIssuesClient` (`createComment` :1076, `create` :1023, `update` :1049, `getSubtree` :1064, `requestWakeup` :1065), `PluginIssueDocumentsClient` (:798), `PluginStreamsClient` (:1246), `PluginEventsClient` (:298), `PluginEvent` (:58), `PluginAgentsClient` (:1110), `PluginDatabaseClient` (:369), `PluginContext` (:1292).
- `node_modules/@paperclipai/plugin-sdk/dist/ui/hooks.d.ts` — `usePluginStream` (:145), `usePluginData`/`usePluginAction`/`useHostContext`.
- `node_modules/@paperclipai/plugin-sdk/dist/ui/types.d.ts` — `PluginStreamResult` (:355), `PluginHostContext` (:55, `userId` :72).
- `paperclipai/paperclip@master` `doc/plugins/PLUGIN_SPEC.md` §16 (core events — `issue.comment.created` present, no `issue.comment.updated`), §8.1 (no plugin asset uploads).
- `paperclipai/paperclip@master` `doc/SPEC-implementation.md` §7.7 (`issue_comments` schema — no metadata/supersedes column), §7.14 (`assets` + `issue_attachments`), §7.15 (`documents`/`issue_documents`).
- In-repo: `src/manifest.ts`, `src/worker.ts`, `src/worker/opt-in-guard.ts`, `src/worker/db/bulletins-repo.ts`, `src/worker/agents/agent-task-delivery.ts`, `src/worker/handlers/bulletin-action-approve.ts`, `src/ui/primitives/use-poll.ts`, `src/shared/reference-resolver.ts`, `migrations/0004_bulletin.sql`.
- `.planning/phases/04-employee-chat/04-CONTEXT.md` (D-01..D-14), `.planning/REQUIREMENTS.md` (CHAT-01..11), `.planning/ROADMAP.md` (Phase 4), `.planning/research/FEATURES.md` §D, `.planning/research/PITFALLS.md` §11 / §7 / §3 / §2.

### Secondary (MEDIUM confidence)
- CONTEXT.md D-01 citations of `paperclipai/paperclip@242a2c2` test files (`issue-update-comment-wakeup-routes.test.ts`, `heartbeat-comment-wake-batching.test.ts`) — the `issue_commented` wake is proven by code+tests but absent from the formal spec; the Plan 04-01 live spike must reconfirm.

### Tertiary (LOW confidence)
- None — every Phase-4 SDK shape was verified against installed types or the live spec.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all SDK shapes read from installed `types.d.ts`.
- Architecture: HIGH — D-08 stream bridge, D-09 side table, D-05 issue tree all verified against the SDK; the design is buildable today.
- Pitfalls: HIGH — drawn from PITFALLS.md §11/§7/§3 and the Phase 3 agent-delivery saga (a directly comparable real failure).
- D-01 native wake: MEDIUM — implementation ahead of spec; falsify-first Plan 04-01 closes it.
- CHAT-07 attachments: HIGH that no upload API exists; the resolution (degrade vs spike) is an Open Question for the planner/user.

**Research date:** 2026-05-18
**Valid until:** 2026-06-17 (30 days — SDK is date-pinned and stable; Renovate flags any bump). Re-verify D-01 and OQ-1 against the host version actually installed on Countermoves at plan time.
