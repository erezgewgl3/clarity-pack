# Architecture Research

**Domain:** Paperclip plugin (multi-surface UI + heartbeat-driven Editor-Agent)
**Researched:** 2026-05-07
**Confidence:** HIGH (Paperclip docs read directly off `master` branch; canonical example plugin manifests inspected verbatim — `plugin-kitchen-sink-example`, `plugin-orchestration-smoke-example`, `plugin-file-browser-example`)

> **Source convention.** Section numbers below (e.g. "PLUGIN_SPEC §10.1") refer to `doc/plugins/PLUGIN_SPEC.md` on the `paperclipai/paperclip` master branch. File paths beginning `packages/plugins/examples/...` refer to the same repo.

---

## TL;DR for the Roadmap

1. **One TypeScript package, one UI bundle, three contribution modes** — the kitchen-sink example proves a single plugin can register a `page` (route), a `detailTab` (extra tab on issue pages), a `dashboardWidget`, a `sidebar` panel, jobs, webhooks, tools, an `instanceConfigSchema`, and a worker — all in one manifest. Clarity Pack maps onto exactly this shape; we do **not** ship four plugins.
2. **Reader View = `detailTab` slot, `entityTypes: ["issue"]`** — proven pattern in `plugin-kitchen-sink-example` (`SLOT_IDS.issueTab`) and `plugin-orchestration-smoke-example` (`taskDetailView` slot type, `entityTypes: ["issue"]`). The host renders the tab alongside Paperclip's classic tabs; we never replace the existing UI.
3. **Editor-Agent = `agents.managed` declaration, not a hand-rolled daemon** — declared in the manifest's top-level `agents[]` array, reconciled per-company by the worker via `ctx.agents.managed.reconcile()`. Inherits Paperclip heartbeat semantics, budget caps, pause/terminate, audit log automatically. Coexistence guarantee #4 is satisfied by *not* writing custom orchestration.
4. **Bulletin = `routine` with cron trigger; Situation Room recompute = UI poll on `usePluginData` + worker materializer routine** — routines produce visible board tasks (good, gives Eric a paper trail); jobs are for plugin-internal housekeeping. The 06:30 ET Bulletin is a routine; the 60s recompute is the cheapest available poll.
5. **Plugin-owned tables live in a host-derived namespace (`plugin_clarity_pack_<hash>`), not `public`** — proven by the orchestration-smoke migration. Foreign keys to `public.issues` are allowed; mutating `public.*` is not. This satisfies coexistence guarantee #3 (additive-only) at the schema-isolation level.
6. **The "per-user opt-in" requirement collides with PLUGIN_SPEC §8** — the spec explicitly states plugin install is global and there is no per-user prefs table yet. We implement opt-in ourselves in `plugin_state` keyed by user id, gated in the UI bundle via `useHostContext()`. This is a domain pitfall (see PITFALLS.md).

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER (same-origin, trusted)                        │
│                                                                                │
│   Paperclip core SPA                                                           │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  Issue Detail Page  │  /:co/situation-room  │  /:co/bulletin  │ Sidebar│ │
│   │  ┌─────────────┐    │  ┌─────────────────┐  │  ┌───────────┐  │  ┌───┐ │ │
│   │  │ classic tabs│    │  │  PAGE slot      │  │  │ PAGE slot │  │  │ ⚹ │ │ │
│   │  │ + clarity   │◀───┤  │  (Clarity own   │  │  │ (Clarity  │  │  │   │ │ │
│   │  │   READER◀───┼─── │  │   route)        │  │  │  own rt)  │  │  │   │ │ │
│   │  │   detailTab │    │  └─────────────────┘  │  └───────────┘  │  └───┘ │ │
│   │  └─────────────┘    │  Situation Room       │  Daily Bulletin │ Chat   │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│           │                    │                       │              │       │
│           │ usePluginData /    │                       │              │       │
│           │ usePluginAction /  │   (host bridge — capability-gated)   │       │
│           │ usePluginStream    │                       │              │       │
│           ▼                    ▼                       ▼              ▼       │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │                    HOST BRIDGE (provided by Paperclip)                  │ │
│   │  useHostContext  ·  useHostNavigation  ·  bridge → JSON-RPC over IPC    │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│   PLUS: Plugin UI may also call Paperclip HTTP /api/* directly (same-origin   │
│   trusted JS — manifest capabilities do NOT gate fetch). Use sparingly.       │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │ (JSON-RPC stdio)
┌──────────────────────────────────────────────────────────────────────────────┐
│                         HOST PROCESS (Paperclip server)                       │
│                                                                                │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  Plugin Worker (out-of-process Node, started by host)                   │ │
│   │  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │ │
│   │  │ definePlugin()   │  │ data handlers   │  │ action handlers      │   │ │
│   │  │ setup(ctx)       │  │ ctx.data.       │  │ ctx.actions.         │   │ │
│   │  │                  │  │  register       │  │  register            │   │ │
│   │  └──────────────────┘  └─────────────────┘  └──────────────────────┘   │ │
│   │  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │ │
│   │  │ apiRoutes        │  │ jobs (cron)     │  │ routines             │   │ │
│   │  │ onApiRequest     │  │ ctx.jobs        │  │ (manifest-declared)  │   │ │
│   │  └──────────────────┘  └─────────────────┘  └──────────────────────┘   │ │
│   │  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │ │
│   │  │ ctx.agents.      │  │ ctx.db.query()  │  │ ctx.entities,        │   │ │
│   │  │  managed.        │  │  (SELECT only)  │  │  ctx.issues,         │   │ │
│   │  │  reconcile()     │  │ ctx.db.execute  │  │  ctx.companies, ...  │   │ │
│   │  └──────────────────┘  └─────────────────┘  └──────────────────────┘   │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│         │                                              │                      │
│         │ heartbeat invoke                             │                      │
│         ▼                                              ▼                      │
│   ┌─────────────────┐                         ┌──────────────────────────┐   │
│   │  EDITOR-AGENT   │                         │  Postgres (single DB)    │   │
│   │  (Paperclip emp)│ ◀── reads issues, ──▶   │  ┌────────────────────┐  │   │
│   │  invoked by     │     comments,           │  │ public.* (Paperclip│  │   │
│   │  heartbeat;     │     work_products       │  │   core, READ-ONLY  │  │   │
│   │  emits comments,│     via host APIs       │  │   to plugin)       │  │   │
│   │  work products, │                         │  └────────────────────┘  │   │
│   │  plugin tables  │                         │  ┌────────────────────┐  │   │
│   └─────────────────┘                         │  │ plugin_clarity_    │  │   │
│                                               │  │   pack_<hash>.*    │  │   │
│                                               │  │   (Clarity-owned;  │  │   │
│                                               │  │    additive only)  │  │   │
│                                               │  └────────────────────┘  │   │
│                                               └──────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation Pattern |
|-----------|----------------|------------------------|
| **UI bundle (`src/ui/index.tsx`)** | Render the four Clarity surfaces. Pure presentation + bridge calls. | One ESM bundle exporting many React components by name; host mounts each into its declared slot. (PLUGIN_SPEC §19, kitchen-sink `EXPORT_NAMES`.) |
| **Host bridge** | Capability-gated RPC from UI → worker. | `usePluginData(key, params)`, `usePluginAction(key)`, `usePluginStream(key)`, `useHostContext()`, `useHostNavigation()` from `@paperclipai/plugin-sdk` (PLUGIN_AUTHORING_GUIDE). |
| **Worker (`src/worker.ts`)** | Server-side handlers: data fetches, mutations, scheduled jobs, agent tool execution, API routes. Out-of-process Node. | `definePlugin({ setup(ctx) { … } })` exporting a default. JSON-RPC over stdio. (PLUGIN_SPEC §12.1, §13.) |
| **Editor-Agent** | Compile TL;DRs, critical-path narratives, daily bulletin. Standard Paperclip employee. | Declared in manifest `agents[]` with `agents.managed` capability; reconciled per-company by worker. Receives heartbeat invocations; runs autonomously under standard governance. (PLUGIN_AUTHORING_GUIDE — agents section.) |
| **Routines** (managed, scheduled) | "Compile yesterday's bulletin" daily at 06:30 ET → produces a visible board task assigned to Editor-Agent. | Manifest `routines[]` with `triggers: [{ kind: "schedule", cronExpression, timezone }]`. (PLUGIN_AUTHORING_GUIDE — managed routines section.) |
| **Jobs** (plugin-internal, scheduled) | Background housekeeping (cache invalidation, prune ledger). Not user-visible. | Manifest `jobs[]` with `schedule` cron field. (PLUGIN_SPEC §17.) |
| **API Routes** | JSON endpoints the UI (or external systems) can hit, scoped under `/api/plugins/<id>/...`. | Manifest `apiRoutes[]` declarations + worker `onApiRequest` handler. (orchestration-smoke `manifest.ts`.) |
| **Plugin DB namespace** | Clarity-owned tables: TL;DR cache, blocker chains, situation snapshots, bulletin issues, opt-in prefs, chat-topic mapping. | One Postgres schema named `plugin_<id>_<hash>` derived by host; migrations under `migrations/` referenced from manifest `database.migrationsDir`. (orchestration-smoke `001_orchestration_smoke.sql`.) |

---

## Recommended Project Structure

```
clarity-pack/
├── package.json                     # paperclipPlugin field points to dist/
├── tsconfig.json
├── esbuild.config.mjs               # bundles worker.ts (CJS for Node)
├── rollup.config.mjs                # bundles src/ui/* (ESM for browser)
│
├── src/
│   ├── manifest.ts                  # one PaperclipPluginManifestV1 export
│   ├── constants.ts                 # SLOT_IDS, EXPORT_NAMES, ROUTINE_KEYS, etc
│   ├── worker.ts                    # definePlugin({ setup(ctx) { … } })
│   │
│   ├── shared/                      # used by BOTH worker and ui — no host imports
│   │   ├── reference-resolver.ts    # PHASE 1 — the killer primitive
│   │   ├── blocker-chain.ts         # PHASE 1 — transitive flatten
│   │   ├── tldr-types.ts            # type definitions for compiled artifacts
│   │   └── opt-in.ts                # user-id keyed prefs accessor
│   │
│   ├── worker/                      # WORKER-only modules (never imported by ui)
│   │   ├── editor-agent/            # the heartbeat-driven Paperclip employee
│   │   │   ├── reconcile.ts         # ctx.agents.managed.reconcile() per company
│   │   │   ├── compile-tldr.ts      # invoked when issue body changes
│   │   │   ├── compile-critical-path.ts
│   │   │   └── compile-bulletin.ts  # invoked by routine daily 06:30 ET
│   │   ├── data/                    # ctx.data.register handlers (UI reads)
│   │   │   ├── issue-tldr.ts
│   │   │   ├── situation-room.ts
│   │   │   ├── bulletin.ts
│   │   │   └── chat-thread.ts
│   │   ├── actions/                 # ctx.actions.register handlers (UI writes)
│   │   │   ├── set-opt-in.ts
│   │   │   └── chat-send.ts
│   │   ├── routines/                # logic for manifest-declared routines
│   │   │   └── morning-bulletin.ts
│   │   ├── jobs/                    # logic for manifest-declared jobs
│   │   │   └── prune-ledger.ts
│   │   └── db/                      # query helpers, all using ctx.db.namespace
│   │       └── tldr-cache.ts
│   │
│   └── ui/                          # UI-only modules (never imported by worker)
│       ├── index.tsx                # named exports for every slot
│       ├── reader-view/             # PHASE 1 — Surface 1 (detailTab)
│       │   ├── index.tsx            # export const IssueReaderTab
│       │   ├── tldr-strip.tsx
│       │   ├── inline-reference.tsx # the ref-resolver chip
│       │   └── deliverable-preview.tsx
│       ├── situation-room/          # PHASE 1 — Surface 2 (page slot)
│       │   ├── index.tsx            # export const SituationRoomPage
│       │   ├── critical-path.tsx
│       │   ├── agent-card.tsx
│       │   └── artifact-shelf.tsx
│       ├── bulletin/                # PHASE 2 — Surface 3 (page slot)
│       │   ├── index.tsx            # export const BulletinPage
│       │   ├── action-inbox.tsx
│       │   └── ops-section.tsx
│       ├── chat/                    # PHASE 3 — Surface 4 (page slot)
│       │   ├── index.tsx            # export const ChatPage
│       │   ├── roster.tsx
│       │   ├── thread.tsx
│       │   └── composer.tsx
│       ├── settings/                # opt-in toggle UI (settingsPage slot)
│       │   └── index.tsx            # export const SettingsPage
│       └── primitives/              # shared UI atoms used by all four surfaces
│           ├── ref-chip.tsx         # depends on shared/reference-resolver
│           ├── blocker-chain.tsx
│           ├── state-pill.tsx
│           └── theme.tsx            # warm-dark mockup palette + Geist/Instrument fonts
│
├── migrations/                      # additive-only SQL (PLUGIN_AUTHORING_GUIDE)
│   ├── 001_init.sql                 # opt_in_prefs, tldr_cache, chat_topics
│   ├── 002_situation_snapshots.sql
│   └── 003_bulletin_archive.sql
│
└── tests/
    ├── shared/                      # pure-logic tests (reference resolver, etc)
    ├── worker/                      # in-process worker tests
    └── ui/                          # component tests (Vitest + RTL)
```

### Structure Rationale

- **`shared/` is sacred.** No host imports. Both the worker (Node) and the UI (browser) consume it. The reference-resolver and blocker-chain primitives belong here because they are pure functions over data — and they are reused across all four surfaces. This is what makes Phase 1 unblock Phases 2/3.
- **`worker/` and `ui/` never cross-import.** Different bundlers, different runtimes, different capability surfaces. Crossing is enforced by tsconfig path restrictions and by the build configs (esbuild only sees worker; rollup only sees ui).
- **`worker/editor-agent/` is its own subtree** because the agent's responsibilities (compile-on-heartbeat) are different from synchronous UI data fetches. Keeps the heartbeat code path inspectable.
- **`migrations/` flat at the package root** because that's what `database.migrationsDir: "migrations"` in the manifest expects (PLUGIN_AUTHORING_GUIDE; orchestration-smoke layout).
- **One UI bundle, many components** matches the kitchen-sink pattern. Don't try to ship four bundles — the manifest's `entrypoints.ui` is a single directory.

---

## Architectural Patterns

### Pattern 1: Multi-Surface Single-Bundle Plugin

**What:** One `manifest.ts` declares many `ui.slots` entries; one rollup-built UI bundle exports a React component per slot by name.

**When to use:** When a plugin contributes more than one user-facing surface (Clarity Pack: four).

**Trade-offs:** Larger bundle, but deduplicates shared primitives (reference resolver, theme, ref chip). The kitchen-sink example does exactly this with **13 slots** in one bundle.

**Example (verbatim shape from `plugin-kitchen-sink-example/src/manifest.ts`):**

```ts
ui: {
  slots: [
    { type: "page",       id: "kitchen-sink",        exportName: "KitchenSinkPage",       routePath: "kitchen-sink" },
    { type: "settingsPage", id: "settings",          exportName: "SettingsPage" },
    { type: "dashboardWidget", id: "widget",         exportName: "DashboardWidget" },
    { type: "detailTab",  id: "issue-tab",           exportName: "IssueDetailTab",        entityTypes: ["issue"] },
    { type: "taskDetailView", id: "task-view",       exportName: "TaskDetailView",        entityTypes: ["issue"] },
    // …8 more slots, all in the same plugin
  ],
}
```

**Clarity Pack mapping:**

| Surface | Slot type | `entityTypes` | `routePath` | Phase |
|---------|-----------|---------------|-------------|-------|
| Reader view (extra tab on issue page) | `detailTab` | `["issue"]` | n/a | 1 |
| Situation Room (own route) | `page` | n/a | `situation-room` | 1 |
| Daily Bulletin (own route) | `page` | n/a | `bulletin` | 2 |
| Employee Chat (own route) | `page` | n/a | `chat` | 3 |
| Settings / opt-in toggle | `settingsPage` | n/a | n/a | 1 |
| Sidebar entry that links to Situation Room | `sidebar` | n/a | n/a | 1 (small, gates access) |

### Pattern 2: UI → Worker via `usePluginData` / `usePluginAction`

**What:** UI components subscribe to typed data feeds; the worker registers handlers; bridge marshals JSON-RPC.

**When to use:** Always for plugin-owned data. Use this in preference to UI calling `/api/*` directly, even though it is permitted (PROJECT.md trust model). Reasons: bridge is typed, capability-gated, and survives if Paperclip changes its REST surface.

**Example:**

```ts
// worker/data/issue-tldr.ts
ctx.data.register("issue.tldr", async ({ issueId }) => {
  // hit ctx.db.query() against plugin_clarity_pack_<hash>.tldr_cache
  // fall back to recompute on miss (delegates to editor-agent compile job)
  return { tldr, regeneratedAt, citations };
});

// ui/reader-view/tldr-strip.tsx
import { usePluginData } from "@paperclipai/plugin-sdk";
const { data, loading } = usePluginData("issue.tldr", { issueId });
```

**Trade-offs:** One extra hop vs direct fetch. Worth it for type safety + capability gating.

### Pattern 3: Editor-Agent as Managed Paperclip Employee, Not Custom Daemon

**What:** Declare the agent in the manifest; reconcile it per company in `setup()`; let Paperclip's heartbeat invoke it.

**When to use:** Always — no custom daemon. PROJECT.md coexistence guarantee #4 (governance parity) is automatically satisfied because the agent inherits standard Paperclip rules: budget caps, pause/terminate, audit log.

**Example (manifest):**

```ts
agents: [
  {
    agentKey: "editor-agent",
    displayName: "Editor-Agent",
    role: "editor",
    title: "Editorial Desk",
    capabilities: "Compiles TL;DRs, critical-path narratives, and the daily Bulletin.",
    adapterPreference: ["claude_local", "process"],
    instructions: { content: "/* see SPEC.md for canonical instructions */" },
  },
],
capabilities: [
  "agents.managed",
  "issues.read",
  "issue.comments.read",
  "issue.documents.read",
  "issue.documents.write",
  "database.namespace.migrate",
  "database.namespace.read",
  "database.namespace.write",
  // …
],
```

**Example (worker):**

```ts
// worker.ts
export default definePlugin({
  async setup(ctx) {
    ctx.events.on("company.created", async ({ companyId }) => {
      await ctx.agents.managed.reconcile("editor-agent", companyId);
    });
    // …data/action/route registrations
  },
});
```

**Trade-offs:** Less control over the heartbeat cadence (it's Paperclip's, not ours) — but PROJECT.md Decision #6 already accepted that.

### Pattern 4: Two-Track Scheduling (Routines for Visible Work, Jobs for Housekeeping)

**What:** Distinguish manifest `routines[]` (visible board tasks assigned to Editor-Agent) from manifest `jobs[]` (invisible plugin housekeeping).

**Example (Bulletin):**

```ts
routines: [
  {
    routineKey: "morning-bulletin",
    title: "Compile daily Bulletin",
    description: "Compile yesterday's operations and today's awaiting-you items.",
    assigneeRef: { resourceKind: "agent", resourceKey: "editor-agent" },
    projectRef:  { resourceKind: "project", resourceKey: "editorial" },
    priority: "medium",
    triggers: [
      { kind: "schedule", label: "Daily 06:30 ET", cronExpression: "30 6 * * *", timezone: "America/New_York", enabled: true },
    ],
  },
],
jobs: [
  { jobKey: "prune-tldr-cache", schedule: "0 4 * * *", displayName: "Prune stale TL;DR cache" },
],
```

**Trade-off:** Routines surface in Eric's task list (good — gives a paper trail and a single artifact named "Bulletin Issue 47"). Jobs don't. Pick by user-visibility.

### Pattern 5: Polling for Near-Live (Situation Room "every 60s")

**What:** Use `usePluginData` with React Query's `refetchInterval` (the SDK is built on TanStack Query — confirmed via SDK exports). Worker handler reads from a materialized snapshot table, not from `public.*` directly, so the recompute happens once per cycle inside the worker, not once per browser tab.

**Why this and not WebSockets / SSE:** PLUGIN_SPEC §19 mentions `usePluginStream` exists but the simpler poll path is well-trodden, requires no extra capability, and matches Paperclip's stated cadence model (PROJECT.md Decision #2). Streams are the right tool for chat (see Pattern 6).

**Example:**

```ts
// ui/situation-room/index.tsx
const { data } = usePluginData("situation.snapshot", undefined, { refetchInterval: 60_000 });

// worker/data/situation-room.ts
ctx.data.register("situation.snapshot", async () => {
  // read from plugin_clarity_pack_<hash>.situation_snapshots (materialized by worker)
  return await ctx.db.query("SELECT * FROM situation_snapshots ORDER BY computed_at DESC LIMIT 1");
});

// worker/jobs/recompute-situation.ts
jobs: [{ jobKey: "recompute-situation", schedule: "* * * * *" }]
// host runs this every minute; writes one row to situation_snapshots
```

**Trade-off:** Up to 60s lag between an underlying issue change and the Situation Room reflecting it. Acceptable per Decision #2.

### Pattern 6: Chat = Real-Time UI Atop Issue Comments

**What:** Per-employee chat surfaces live as private issues; messages are ordinary issue comments; attachments are work-products (PROJECT.md Decision #1). The UI gets near-real-time via `usePluginStream` subscribed to the host event `issue.comment.created` filtered to the current chat-issue id. Send path: `usePluginAction("chat.send")` → worker → `ctx.issues.comments.create(...)` → host emits the event → all subscribers refresh.

**Why streams here, not polls:** Chat needs sub-second updates; poll would be wrong. Streams are explicitly supported via `usePluginStream` (PLUGIN_AUTHORING_GUIDE).

**Trade-off:** Stream wiring is more code. Phase 3 has time for it.

---

## Data Flow

### Read Flow (UI requests data)

```
User opens Reader view tab
       │
       ▼
React mounts <IssueDetailTab issueId={X} />          (host invokes via slot)
       │
       ▼
usePluginData("issue.tldr", { issueId: X })          (bridge hook)
       │
       ▼
Bridge → JSON-RPC → worker.getData                   (capability check)
       │
       ▼
ctx.data handler "issue.tldr"                        (registered in setup)
       │
       ├─→ ctx.db.query SELECT * FROM tldr_cache     (plugin namespace)
       │     hit: return cached
       │     miss: ↓
       │
       ├─→ ctx.issues.get(X), ctx.issue.documents.read(X), ctx.issue.relations.read(X)
       │     (all capability-gated; reads public.issues etc.)
       │
       ├─→ shared/reference-resolver.ts              (pure fn; both surfaces use this)
       │
       └─→ Editor-Agent already wrote the TL;DR? Use it.
           Otherwise: enqueue compile via wakeup, return placeholder
       │
       ▼
JSON serialized back through bridge → React state → render
```

### Write Flow (UI submits a decision; e.g. "12% broker comm" from chat composer)

```
Eric clicks "12%"
       │
       ▼
usePluginAction("chat.decision")                     (bridge hook)
       │
       ▼
worker.performAction("chat.decision")
       │
       ├─→ ctx.issue.comments.create(chatIssueId, "Eric chose 12%")
       │     ↑ this is the durable record (Decision #1: persist as issue comment)
       │
       ├─→ ctx.activity.log.write(...)               (audit trail)
       │
       └─→ host emits issue.comment.created event
              │
              ▼
       Editor-Agent heartbeat may pick this up next cycle
       and compile a fresh TL;DR for the affected task.
```

### Editor-Agent Heartbeat Flow

```
Host scheduler ticks (Paperclip's heartbeat — cadence is host-side, not plugin-side)
       │
       ▼
Host invokes Editor-Agent (it's a regular employee; standard rules apply)
       │
       ▼
Editor-Agent's adapter: claude_local | process | …   (declared in manifest agents[])
       │
       ▼
Agent reads its task queue:
  ├─ "compile TL;DR for BEAAA-148"   (routine spawned by issue-changed event)
  ├─ "compile critical path"          (routine, every 5 min while view active)
  └─ "compile Bulletin No. 48"        (routine, scheduled 06:30 ET daily)
       │
       ▼
Agent executes — same governance as any employee:
  · budget caps enforced by host
  · pause/terminate honored
  · audit log written automatically
  · spend deducted from agent's per-month allowance
       │
       ▼
Agent writes back via standard host APIs:
  · ctx.issue.documents.write (TL;DR materialized as a document attached to the issue)
  · ctx.db.execute INSERT INTO tldr_cache (plugin namespace)
  · ctx.issue.comments.create (when agent has something to say in chat)
  · ctx.issues.create (when promoting a chat decision to a real task — see Surface 4)
       │
       ▼
Host emits domain events. UI (subscribed via usePluginStream) refreshes.
```

### State Storage Decisions

| Data | Where | Why |
|------|-------|-----|
| TL;DR text + citations + regenerated-at | `plugin_clarity_pack_<hash>.tldr_cache` (FK to `public.issues.id`) | Plugin-owned. Re-derivable. Survives uninstall by intent (additive table). |
| Critical-path snapshot (Situation Room) | `plugin_clarity_pack_<hash>.situation_snapshots` | Materialized once per minute by job; cheap reads from many tabs. |
| Bulletin issue archive | `plugin_clarity_pack_<hash>.bulletin_issues` (one row per day) | Editorial digests are durable products; keep them queryable. |
| Chat topic ↔ private issue mapping | `plugin_clarity_pack_<hash>.chat_topics` | Maps "CHT-44" → underlying issue id. |
| Chat messages | `public.issue_comments` (Paperclip core) | **Not plugin-owned.** Decision #1: durable as ordinary issue comments. Plugin reads via `ctx.issue.comments.read`. |
| Attachments | Paperclip work-products | **Not plugin-owned.** Decision #1: stored under the issue's work-product folder. |
| Per-user opt-in toggle | `plugin_state` row, `scope_kind = "user"` (or `instance`-scoped state keyed by user id if `user` scope unavailable) | PLUGIN_SPEC §8 says plugin install is global — there is no per-user prefs table provided by the host. We implement opt-in ourselves. See PITFALLS.md. |
| Editor-Agent run logs | Paperclip's standard agent activity ledger | **Not plugin-owned.** Coexistence guarantee #4 — governance parity. |

---

## Reader View Contribution Mechanism (Phase 1 Surgical Detail)

This is the highest-risk integration point. Documented in detail because it must coexist with Paperclip's classic UI without replacing it.

### The slot declaration

```ts
// src/manifest.ts
ui: {
  slots: [
    {
      type: "detailTab",
      id: "clarity-reader",
      displayName: "Reader",         // appears in the issue-page tab bar
      exportName: "IssueReaderTab",  // matches an export in src/ui/index.tsx
      entityTypes: ["issue"],        // host scopes this tab to issue pages
    },
    // … other slots
  ],
}
```

**Citations:**
- `plugin-kitchen-sink-example/src/manifest.ts` declares `{ type: "detailTab", id: SLOT_IDS.issueTab, displayName: "Kitchen Sink", exportName: EXPORT_NAMES.issueTab, entityTypes: ["issue"] }` — exact same shape.
- `plugin-orchestration-smoke-example/src/manifest.ts` declares `{ type: "taskDetailView", id: "issue-panel", displayName: "Orchestration Smoke", exportName: "IssuePanel", entityTypes: ["issue"] }` — alternative slot type, similar pattern.
- PLUGIN_SPEC §10.1 normative manifest type: `slots: Array<{ type: "page" | "detailTab" | "dashboardWidget" | "sidebar" | "settingsPage"; id: string; displayName: string; exportName: string; entityTypes?: Array<"project" | "issue" | "agent" | "goal" | "run">; }>`.

### What the host does at runtime

PLUGIN_SPEC §19.3 specifies: tabs render alongside Paperclip's classic tab set; they do not replace it. The host mounts the exported component into the tab bar of any page where the entity type matches. Recommended host route pattern: `/:companyPrefix/<entity>/:id?tab=clarity-reader`. The classic content remains accessible by switching back to a Paperclip-native tab.

### The component contract

```ts
// src/ui/index.tsx — single barrel export
export { IssueReaderTab } from "./reader-view";
export { SituationRoomPage } from "./situation-room";
export { BulletinPage } from "./bulletin";
export { ChatPage } from "./chat";
export { SettingsPage } from "./settings";
```

```tsx
// src/ui/reader-view/index.tsx
import type { PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { useHostContext, usePluginData } from "@paperclipai/plugin-sdk";
import { useOptIn } from "../primitives/opt-in";

export function IssueReaderTab(props: PluginDetailTabProps) {
  const ctx = useHostContext();           // companyId, projectId, currentUserId
  const optedIn = useOptIn(ctx.currentUserId);
  if (!optedIn) {
    return <OptInPromo />;                // tab still shows; content is the promo
  }
  const { data, loading } = usePluginData("issue.reader", { issueId: props.entityId });
  if (loading) return <ReaderSkeleton />;
  return <ReaderLayout data={data} />;    // TL;DR strip + body + right rail
}
```

The component receives entity context from the host (the issue id, the current user, the company); it does not need to scrape the URL or read window state. This is the pattern shown in PLUGIN_AUTHORING_GUIDE under "Issue Detail Tabs" and confirmed in `plugin-file-browser-example` and `plugin-kitchen-sink-example`.

### Coexistence-by-construction

- Classic tabs are unchanged. Paperclip mounts them itself; our manifest cannot remove them.
- Our tab is **additive**. PLUGIN_SPEC `ui.slots` is purely additive — there is no slot type that overrides or hides core UI. Coexistence guarantee #2 is satisfied by the platform shape, not by discipline.
- If our component throws, PLUGIN_SPEC §19.7 guarantees host catches it and renders the bridge error envelope; the rest of the issue page (classic tabs included) keeps working.

---

## Build Order and Shared Primitives

Phase ordering is dictated by which primitives each surface needs.

### The shared primitives (build first, in Phase 1)

| Primitive | Purpose | Lives at | Used by |
|-----------|---------|----------|---------|
| **Reference resolver** | Given an issue ref like "BEAAA-141", return the resolved title + state + one-line summary | `src/shared/reference-resolver.ts` | Reader view (inline chips, anchored-to cards), Situation Room (ref chips on agent cards, downstream-impact panel), Bulletin (lineage threads), Chat (ref chips in messages) — **all four surfaces** |
| **Blocker chain flattener** | Given a starting issue, walk the blocker graph transitively, collapse to a single human-actionable terminal step | `src/shared/blocker-chain.ts` | Reader view (right-rail chain panel), Situation Room (agent-card chain, critical-path strip) — **Phases 1+** |
| **TL;DR types + cache schema** | Types for compiled TL;DR, critical-path narrative, bulletin doc; schema for `tldr_cache` | `src/shared/tldr-types.ts` + `migrations/001_init.sql` | Reader view, Situation Room, Bulletin |
| **State pill + ref chip + theme tokens** | Visual primitives matching the mockups; warm-dark palette + Geist/Instrument fonts | `src/ui/primitives/` | All four surfaces |
| **Opt-in accessor** | Read/write per-user opt-in, gate UI rendering | `src/shared/opt-in.ts` | All four surfaces (each gates rendering) |

### Surface dependencies on primitives

```
Phase 1
├── Reference resolver  ──┐
├── Blocker chain       ──┼──▶ Reader view (Surface 1)         ──┐
├── TL;DR types/schema  ──┤                                       │
├── State pill / chip   ──┤                                       ├── Editor-Agent
├── Theme               ──┤                                       │   skeleton
├── Opt-in              ──┤                                       │
│                          └──▶ Situation Room (Surface 2)      ──┘
│                                  │
└── (Settings page + sidebar entry, small)

Phase 2
├── Bulletin doc compiler (worker, in Editor-Agent)
└── Bulletin layout primitives (paper aesthetic; new theme)
        │
        └──▶ Daily Bulletin (Surface 3)

Phase 3
├── usePluginStream wiring
├── Chat-topic↔issue mapping
└── Composer / promote-to-task
        │
        └──▶ Employee Chat (Surface 4)
```

### Phase build order, with rationale

| Phase | Build | Why this order |
|-------|-------|----------------|
| **1.0 — Plugin scaffold** | manifest.ts, worker.ts skeleton, build configs, install pipeline (`paperclipai plugin install clarity-pack` works locally, even with empty UI) | Nothing else can be tested without an installable plugin. |
| **1.1 — Theme + primitives** | warm-dark theme, fonts, state pill, ref chip skeleton (without resolver), opt-in stub | All four surfaces depend on these. Cheap to land. |
| **1.2 — Reference resolver** | `shared/reference-resolver.ts` + worker data handler `issue.ref-resolve` | Killer feature primitive. Reader view + Situation Room both block on this. |
| **1.3 — Blocker chain** | `shared/blocker-chain.ts` | Reader view's right-rail panel + Situation Room's chain panel + critical-path strip all depend on it. |
| **1.4 — Editor-Agent skeleton** | manifest `agents[]` declaration, `setup()` reconciliation, one TL;DR compile routine | Required for Reader view's TL;DR to be non-stub. Skeleton only — no Bulletin yet. |
| **1.5 — Reader view tab** | `ui/reader-view/*`, `issue.reader` data handler, `tldr_cache` table | First user-visible surface. Validates the detailTab integration on a real issue page. |
| **1.6 — Situation Room** | `ui/situation-room/*`, `situation.snapshot` data handler, `recompute-situation` job, `situation_snapshots` table, sidebar entry, `page` slot route | Second user-visible surface. Validates polling cadence + agent-card layout. Reuses the resolver and chain primitives. |
| **1.7 — Settings + opt-in** | `ui/settings/*`, `set-opt-in` action handler, `opt_in_prefs` table | Coexistence guarantee #1 (default OFF; opt-in) is enforced everywhere. Lock this before broad rollout. |
| **2 — Daily Bulletin** | `compile-bulletin` routine in Editor-Agent, `bulletin_issues` table, `ui/bulletin/*` (paper aesthetic), Bulletin route | Adds a routine to existing Editor-Agent. Depends on Phase 1's TL;DR + critical-path primitives. |
| **3 — Employee Chat** | `usePluginStream` subscription, chat-topic↔issue mapping, `ui/chat/*`, composer, promote-to-task action | Stream wiring is new; everything else is reuse of Phases 1/2 primitives. |
| **4 — Polish + Clipmart** | A11y audit, theming portability, npm publish workflow, Clipmart manifest fields | Cross-cutting; no new primitives. |

### Phase-1 ordering check (most important)

Reader view (1.5) cannot be done before resolver (1.2) and chain (1.3) because the mockup's right rail is dominated by chain output and the body is dominated by inline ref chips. Situation Room (1.6) cannot be done before Reader view validates the resolver because the Situation Room's agent cards reuse the same chip atom. The Editor-Agent skeleton (1.4) sits between the primitives and the surfaces because it's what populates `tldr_cache`. The settings/opt-in (1.7) can technically land anywhere in Phase 1 — but **gating rendering on opt-in must be in place before the surfaces are merged to main**, or the coexistence guarantee #1 is violated.

---

## Trust Model in Components

PROJECT.md states plugin UI bundles run as same-origin trusted JavaScript and may call `/api/*` directly without going through the worker bridge. This is true at the platform level. **Discipline:** treat that escape hatch as a bug-fix lever, not a primary path.

| Path | Use for | Avoid for |
|------|---------|-----------|
| `usePluginData` / `usePluginAction` (bridge → worker) | All plugin-owned data. All mutations of plugin tables. | n/a — primary path |
| Worker → `ctx.issues`, `ctx.issue.comments`, `ctx.issue.documents`, etc. | All Paperclip core writes that the plugin needs. | n/a — primary path; capability-gated |
| Direct UI fetch to `/api/companies/:id/issues` etc. | Read-only fallback when a needed query has no worker handler yet. | Mutations. Anything we could route through the worker. |

The worker bridge is the canonical surface because it gives us: (a) typed contracts, (b) capability gating that survives Paperclip API changes, (c) a single audit-log write site for sensitive actions, (d) testability without a browser.

---

## Scaling Considerations

PROJECT.md is explicit: v1 audience is "Eric on BEAAA only," single-tenant, single-node, single-org. Most scaling concerns are out of scope for v1. The ones that matter:

| Concern | At v1 scale (Eric, BEAAA) | Mitigation if scope grows |
|---------|---------------------------|---------------------------|
| TL;DR recompute cost | ~9 employees × tens of issues; full recompute per heartbeat is fine | Move to per-issue change events; only recompute affected TL;DRs |
| Situation Room query | <100 rows; one materialized snapshot per minute is generous | Snapshot per-company and read by company, not globally |
| Bulletin compile time | Mockup: "Compiled in 38s from 14 agent ledgers" — well within timeout | Pre-aggregate per-section; avoid full ledger scan |
| Editor-Agent budget | Standard Paperclip budget cap applies (PROJECT.md guarantee #4) | Already capped by host |
| Chat stream fan-out | One human user (Eric); 9 employees each opening one tab is the realistic ceiling | Pure non-issue at v1 |

Don't optimize Phase 1 for scale. PROJECT.md is unambiguous: scope discipline > scaling.

---

## Anti-Patterns

### Anti-Pattern 1: One Plugin Per Surface

**What people do:** Ship `clarity-reader`, `clarity-situation-room`, `clarity-bulletin`, `clarity-chat` as four plugins.
**Why it's wrong:** Quadruples install ceremony; the four surfaces share a reference resolver, a blocker chain primitive, a TL;DR cache, an Editor-Agent, and a theme — splitting the package re-implements those four times. PLUGIN_SPEC explicitly supports many slots in one manifest (kitchen-sink: 13 slots).
**Do this instead:** One plugin (`clarity-pack`), one manifest, many `ui.slots` entries, one UI bundle, one worker.

### Anti-Pattern 2: Replacing the Issue Detail Page

**What people do:** Try to register a `page` slot at `routePath: "issue/:id"` to take over the issue route.
**Why it's wrong:** Violates coexistence guarantee #2 ("Original UI never replaced; Reader view is an additional tab"). Also: PLUGIN_SPEC `ui.slots` is purely additive; there's no host-supported way to *replace* a core route, and trying to fight that is wasted effort.
**Do this instead:** `detailTab` with `entityTypes: ["issue"]`. The host puts our tab next to the classic tabs; classic remains the default landing tab (Decision #5).

### Anti-Pattern 3: Custom Daemon for the Editor-Agent

**What people do:** Run a Node setInterval inside the worker, hammer Paperclip APIs to compile TL;DRs, ignore the heartbeat system.
**Why it's wrong:** Bypasses budget caps, pause/terminate, audit log. Violates coexistence guarantee #4 explicitly. Eric can't pause the agent from the standard agent UI. Cost runs unbounded.
**Do this instead:** Declare `agents[]` in manifest with `agents.managed`; reconcile per-company; let the host invoke. Compile work happens during heartbeat, attributed to the agent's budget envelope, audited by the host.

### Anti-Pattern 4: Storing Chat Messages in a Plugin Table

**What people do:** Create `plugin_clarity_pack_<hash>.chat_messages`, store everything there.
**Why it's wrong:** Violates Decision #1 (chat must persist as ordinary issue comments) and coexistence guarantee #5 (messages render in classic Paperclip UI). Plugin-disable-leaves-data-intact (#3) is technically met but classic UI sees nothing.
**Do this instead:** Each chat topic is a private issue. Each message is an `issue_comment` row in the **public** schema, written via `ctx.issue.comments.create`. The plugin table holds only the chat-topic→issue-id index, not the content.

### Anti-Pattern 5: Per-User Plugin Install (looking for it)

**What people do:** Look for a "per-user enable plugin" config and build the opt-in toggle on top of it.
**Why it's wrong:** PLUGIN_SPEC §8 explicitly says: "Plugin installation is global and operator-driven … there is no per-company install table and no per-company enable/disable switch." The same applies to per-user. The toggle must be implemented inside the plugin.
**Do this instead:** A `plugin_state` row keyed by `user_id` (using the `agent` or `instance` scope_kind with the user id stored in `state_key`, since PLUGIN_SPEC §21.3 lists `instance | company | project | project_workspace | agent | issue | goal | run` as available scope kinds — no `user` scope, see PITFALLS.md). Or our own `opt_in_prefs(user_id, opted_in_at)` table in our migrations. Gate every UI surface render on the toggle (`useOptIn` hook).

### Anti-Pattern 6: Free-Form DB Migrations Against `public.*`

**What people do:** Add a column to `public.issues`, add a foreign key to a Paperclip table, alter a host enum.
**Why it's wrong:** PLUGIN_SPEC §21 forbids it: "Migration SQL may create or alter objects only inside `ctx.db.namespace` … may not mutate/alter/drop/truncate public tables." Even attempting it is rejected at install time.
**Do this instead:** Reference public tables with FKs only; declare them in `database.coreReadTables`; mirror needed columns into our namespace where reads need to be denormalized for speed.

---

## Integration Points

### External Services

None at v1. Editor-Agent's adapter (likely `claude_local` or `process`) calls an LLM provider, but that is mediated by Paperclip's standard agent runtime — not the plugin's responsibility.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| UI bundle ↔ host (Paperclip core SPA) | Slot mounting (host renders our exports) + bridge hooks | Same-origin trusted JS; host provides bridge. PLUGIN_SPEC §19. |
| UI bundle → worker | `usePluginData` / `usePluginAction` / `usePluginStream` | Bridge marshals JSON-RPC. Capability-gated. |
| Worker ↔ host (Paperclip server) | JSON-RPC over stdio (out-of-process) | Worker started as child process. PLUGIN_SPEC §12.1. |
| Worker → Paperclip core data | `ctx.issues`, `ctx.issue.comments`, `ctx.issue.documents`, `ctx.companies`, `ctx.projects`, `ctx.agents`, etc. | All capability-gated. |
| Worker → plugin DB namespace | `ctx.db.query` (SELECT only) / `ctx.db.execute` (INSERT/UPDATE/DELETE in namespace only) | Confirmed in PLUGIN_AUTHORING_GUIDE: "Runtime `ctx.db.query()` is restricted to `SELECT`; runtime `ctx.db.execute()` is restricted to namespace-local `INSERT`, `UPDATE`, and `DELETE`." |
| Worker ↔ Editor-Agent | `ctx.agents.managed.reconcile()` to define; agent invocation is via host heartbeat (we don't drive it) | Heartbeat cadence is host-side. |
| Editor-Agent → plugin DB | Through worker handlers exposed as agent tools (`ctx.tools.register`) | Agent calls our tool; tool runs in worker; worker writes to namespace. |
| Editor-Agent → Paperclip core | Standard agent APIs (write comments, write documents, create issues) | Same as any Paperclip employee. |

---

## Open Questions Surfaced for Phase-Specific Research

These are not blockers for the roadmap. They are flagged for the phase that will hit them:

1. **Heartbeat cadence specifics.** `doc/execution-semantics.md` references "the heartbeat scheduler" and "queued wake paths" but doesn't quantify frequency. Phase 1.4 (Editor-Agent skeleton) needs to verify cadence empirically — either it's fast enough that "TL;DR regenerates each time the task body changes" (mockup tagline) feels live, or we need to add a wakeup trigger from the issue-changed event.
2. **Whether `plugin_state` supports a `user` scope.** PLUGIN_SPEC §21.3 lists scope kinds `instance | company | project | project_workspace | agent | issue | goal | run`. **No `user` scope.** Phase 1.7 must decide between (a) using `instance` scope with user_id encoded in `state_key`, or (b) adding our own `opt_in_prefs` table. (b) is cleaner.
3. **Cron expression dialect.** PLUGIN_AUTHORING_GUIDE example uses `"0 9 * * 1"` (5-field standard cron). Confirm that `"30 6 * * *"` (Bulletin trigger) is interpreted in the timezone field's offset, not UTC. Phase 2 must verify before relying on 06:30 ET.
4. **Whether `taskDetailView` and `detailTab` differ for issues.** Both appear in the kitchen-sink manifest with `entityTypes: ["issue"]`. Phase 1.5 should pick one based on whichever the host renders in the position the mockup expects (next to classic tabs). Default to `detailTab` based on PLUGIN_SPEC §10.1 which lists it as the canonical type; fall back to `taskDetailView` if the host renders it in a more prominent slot.
5. **Whether the SDK's `usePluginStream` can subscribe to host-emitted `issue.comment.created` events directly, or whether we must publish a plugin-defined stream that the worker re-emits to.** Phase 3 question; not a Phase 1 risk.

---

## Sources

All confirmed by direct file fetch on `paperclipai/paperclip` `master` branch, 2026-05-07:

- **PLUGIN_SPEC.md** — `doc/plugins/PLUGIN_SPEC.md` (63KB). §10 package contract, §10.1 manifest TS interface, §11 plugin tools, §12.1 out-of-process worker, §13 host-worker protocol, §15 capabilities, §17 jobs, §19 UI bundle and bridge, §19.3 detail-tab route pattern, §19.7 error envelope, §21.3 plugin tables, §25.4 hot lifecycle. HIGH confidence.
- **PLUGIN_AUTHORING_GUIDE.md** — `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`. Project scaffold; manifest; route slots; detail-tab pattern; `definePlugin` + `ctx`; `agents.managed.reconcile`; database migrations and `ctx.db` SELECT/execute restrictions; managed routines vs jobs; `apiRoutes`; UI bridge hooks; shared UI components from `@paperclipai/plugin-sdk/ui`. HIGH confidence.
- **doc/SPEC.md** — core entities (companies, agents, tasks, comments, work-products, activity log), heartbeat protocol, governance (pause/resume, budget caps), single-unified REST API, single-tenant deployment. HIGH confidence.
- **doc/SPEC-implementation.md** — REST endpoints (`/api/companies/...`, `/api/issues/...`, `/api/agents/.../heartbeat/invoke`), shadcn/ui integration, `plugin_database_namespaces`, `plugin_database_migrations`, plugin schema isolation. HIGH confidence on routes; MEDIUM on UI runtime specifics (paraphrased).
- **doc/execution-semantics.md** — references heartbeat scheduler, queued wakes, runs (`checkoutRunId`, `executionRunId`), issue lifecycle states. LOW confidence on cadence specifics — flagged as open question.
- **doc/DATABASE.md** — `plugin_database_namespaces`, `plugin_migrations`, `company_secrets`, additive migrations via `pnpm db:migrate`. MEDIUM confidence (excerpt was thin).
- **`packages/plugins/examples/plugin-kitchen-sink-example/src/manifest.ts`** — fetched verbatim. Canonical multi-surface plugin: 13 ui.slots in one manifest, including `page` (with `routePath`), `settingsPage`, `detailTab` for issue, `taskDetailView` for issue, `instanceConfigSchema` with boolean toggles, jobs, webhooks, tools. HIGH confidence — this is the model for Clarity Pack.
- **`packages/plugins/examples/plugin-orchestration-smoke-example/src/manifest.ts`** — fetched verbatim. Database namespace pattern, `apiRoutes` declarations, `database.namespaceSlug` + `database.migrationsDir` + `database.coreReadTables`. HIGH confidence.
- **`packages/plugins/examples/plugin-orchestration-smoke-example/migrations/001_orchestration_smoke.sql`** — fetched verbatim. Confirms `plugin_<name>_<hash>` schema naming, FK to `public.issues(id) ON DELETE CASCADE`, no public-table mutation. HIGH confidence.
- **`packages/plugins/examples/plugin-file-browser-example/src/manifest.ts`** + **README.md** — confirms `projectSidebarItem` slot, `detailTab` slot, settings-controlled visibility, instance-level config (no per-user prefs). HIGH confidence.

---

*Architecture research for: Paperclip plugin (multi-surface UI + managed agent)*
*Researched: 2026-05-07*
