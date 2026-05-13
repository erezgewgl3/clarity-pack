# Stack Research — Clarity Pack (Paperclip Plugin)

**Domain:** Paperclip plugin (TypeScript) — UI tabs/routes (React + shadcn) + heartbeat-driven agent worker + additive Postgres (Drizzle) migrations
**Researched:** 2026-05-07
**Confidence:** HIGH for items pulled from `paperclipai/paperclip@master` source tree (manifest shape, package layout, version pins, MCP package, Drizzle pin). MEDIUM for the heartbeat-driven managed-agent contract (the authoring guide and the kitchen-sink example show it in working code, but the formal `PLUGIN_SPEC.md` document under-describes it — the implementation is ahead of the spec). MEDIUM for plugin-owned migration rules (formal spec marks them out of scope, but the authoring guide and SDK already implement `database.namespace.migrate`/`read`/`write` capabilities and a `database.migrationsDir` manifest field).

> **Method note.** Paperclip's default branch is `master`, not `main`. Earlier doc fetches against `main` returned 404. All raw URLs in this document use `master` and were fetched on 2026-05-07. Paperclip was last pushed to on 2026-05-07 17:25 UTC, so the source tree is current as of this research.

---

## TL;DR — Locked Choices

| What | Choice | FORCED / RECOMMENDED / OPTIONAL | Why (one-liner) |
|---|---|---|---|
| Plugin SDK | `@paperclipai/plugin-sdk@2026.512.0` | **FORCED** | Sole supported public API for Paperclip plugins. Provides `definePlugin`, `runWorker`, `usePluginData`, `usePluginAction`, etc. **Date-based versioning** on npm (workspace `package.json` says `1.0.0` but the publish pipeline overrides with `YYYY.MMDD.X`). Pin EXACTLY; Renovate auto-bumps via PR. **Update history:** `^1.0.0` (research 2026-05-07, never published) → `2026.512.0` (corrected 2026-05-13 per npm reality). |
| Plugin API version | `apiVersion: 1` in manifest | **FORCED** | Only currently supported value (`PaperclipPluginManifestV1`). |
| Manifest type | `PaperclipPluginManifestV1` from SDK | **FORCED** | Host validates against this schema at install time. |
| Language | TypeScript `^5.7.3` | **FORCED** | Matches host; SDK ships only `.d.ts` files at this tier. |
| Module system | ESM (`"type": "module"`) | **FORCED** | SDK is ESM-only; worker uses `import.meta.url`. |
| React | `^19.0.0` (peer `>=18`) | **FORCED** | Host loads plugin UI as same-origin ESM and externalizes `react` / `react-dom` / `react/jsx-runtime`. Plugin must NOT bundle React. |
| Tailwind CSS | v4 via `@tailwindcss/vite` (`^4.0.7`) — match host | **FORCED** | Plugin UI runs same-origin in the host page; you inherit host CSS / design tokens, do not ship a second Tailwind. |
| shadcn/ui | "new-york" style, `cssVariables: true`, `baseColor: "neutral"`, `iconLibrary: "lucide"` | **FORCED** | Host's `ui/components.json` config; matching it keeps tokens consistent. |
| UI bundle target | `es2022`, `format: esm`, `platform: browser` | **FORCED** | Per `@paperclipai/plugin-sdk/bundlers` preset. Externalize `react`, `react-dom`, `react/jsx-runtime`, `@paperclipai/plugin-sdk/ui`, `@paperclipai/plugin-sdk/ui/hooks`. |
| Worker bundle target | `node20`, `format: esm`, `platform: node` | **FORCED** | Worker runs in a Node child process spawned by host. Externalize `react`/`react-dom` (worker should never import them). |
| Bundler | esbuild `^0.27.3` | **RECOMMENDED** | What every first-party Paperclip example uses; `createPluginBundlerPresets` ships configs for both esbuild and rollup. |
| Worker entrypoint | `runWorker(plugin, import.meta.url)` at end of `worker.ts` | **FORCED** | Boots the JSON-RPC-over-stdio loop the host expects. |
| Database / ORM | Drizzle ORM `^0.38.4` + `postgres@^3.4.5` (host-pinned) | **FORCED-IF-USING-DB** | Host's `@paperclipai/db` pins these. Plugin migrations run inside host's Drizzle pipeline. |
| Migration tool | Plain SQL files in `migrations/` (declared via `database.migrationsDir`) | **FORCED-IF-USING-DB** | Host runs them in filename order before worker startup, scoped to `ctx.db.namespace`. Drizzle Kit is the host's authoring tool, not the plugin's. |
| MCP server (for Editor-Agent) | `@paperclipai/mcp-server@2026.512.0` | **FORCED** | The official MCP wrapper around Paperclip's REST API. Includes `paperclipGetHeartbeatContext`, `paperclipListIssues`, `paperclipListComments`, `paperclipListDocuments` — exactly what the Editor-Agent reads. Built on `@modelcontextprotocol/sdk@^1.29.0`. **Date-based versioning** (same scheme as plugin-sdk). Pin EXACTLY; Renovate auto-bumps. |
| Agent execution model | Managed agent (`agents[]` manifest entry + `ctx.agents.managed.reconcile`) with `adapterPreference: ["codex_local", "claude_local", "process"]` | **FORCED** | Single supported mechanism for a plugin to ship a heartbeat-driven org-chart hire. |
| Install command | `pnpm paperclipai plugin install <package[@version]>` | **FORCED** | Per `PLUGIN_SPEC.md` §8.2. |
| Distribution | npm public package | **FORCED** | Host install path requires reachable npm registry (PLUGIN_SPEC.md §1 deployment notes). |
| Trust posture | Plugin UI = same-origin trusted JS (NOT iframed, NOT sandboxed) | **FORCED** | Explicit in PLUGIN_SPEC.md §19 caveats. Capabilities gate worker RPC, not UI HTTP. |

---

## 1. Versions Paperclip's Plugin Runtime Expects

Verified against `master` source tree on 2026-05-07.

### From `ui/package.json` (host UI)

| Dep | Pinned by host | Notes |
|---|---|---|
| `react` | `^19.0.0` | Plugin UI runs in this React; never bundle your own. |
| `react-dom` | `^19.0.0` | Same. |
| `tailwindcss` | `^4.0.7` (devDep) | v4 with `@tailwindcss/vite`. CSS-first config (no `tailwind.config.js`). |
| `@tailwindcss/vite` | `^4.0.7` | Host's Tailwind plugin. |
| `radix-ui` | `^1.4.3` | shadcn primitives. |
| `@radix-ui/react-slot` | `^1.2.4` | Used by `class-variance-authority` patterns. |
| `class-variance-authority` | `^0.7.1` | Standard with shadcn. |
| `tailwind-merge` | `^3.4.1` | shadcn `cn()` helper. |
| `lucide-react` | `^0.574.0` | Icon library declared in `components.json`. |
| `react-router-dom` | `^7.1.5` | Host router; plugin pages are mounted into host routes. |
| `typescript` | `^5.7.3` (devDep) | All workspaces use this. |
| `vite` | `^6.1.0` | Host UI bundler (NOT what your plugin uses; see below). |

### From `ui/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

### From `ui/components.json` (the shadcn config you must match)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

**Implication for Clarity Pack:** copy these settings into our own `components.json` so any `npx shadcn add` we run produces components that look identical to host shadcn. Use the same path aliases inside our plugin's `src/ui` so cross-references stay consistent. Don't change `style`, `baseColor`, or `iconLibrary`.

### Root repo

- `package.json` engines: `"node": ">=20"` — your plugin must build/test on Node 20+.
- Package manager: `pnpm@9.15.4` (workspace).
- esbuild root: `^0.27.3`.

---

## 2. Plugin Manifest Shape

The canonical type is `PaperclipPluginManifestV1` from `@paperclipai/plugin-sdk`. The formally documented top-level fields (PLUGIN_SPEC.md §10.1) are:

```ts
export interface PaperclipPluginManifestV1 {
  id: string;
  apiVersion: 1;
  version: string;
  displayName: string;
  description: string;
  categories: Array<"connector" | "workspace" | "automation" | "ui">;
  minimumPaperclipVersion?: string;
  capabilities: string[];
  entrypoints: { worker: string; ui?: string };
  instanceConfigSchema?: JsonSchema;
  jobs?: PluginJobDeclaration[];
  webhooks?: PluginWebhookDeclaration[];
  tools?: Array<{ name; displayName; description; parametersSchema: JsonSchema }>;
  ui?: { slots: Array<UiSlot> };
}
```

**But the working code in the kitchen-sink example and the `PLUGIN_AUTHORING_GUIDE.md` extends this with three additional first-party-plugin fields that are required for what Clarity Pack does:**

```ts
// Additionally supported (per PLUGIN_AUTHORING_GUIDE.md and kitchen-sink):
agents?:   Array<ManagedAgentDeclaration>;     // heartbeat-driven org-chart hire (Editor-Agent)
projects?: Array<ManagedProjectDeclaration>;   // optional: a Paperclip project the plugin owns
routines?: Array<ManagedRoutineDeclaration>;   // scheduled cron-style routines (e.g. 06:30 ET bulletin)
database?: { migrationsDir: string; coreReadTables?: string[] };
```

### Slot types (UI contribution points)

The minimal documented set (PLUGIN_SPEC.md §10.1):

```
"page" | "detailTab" | "dashboardWidget" | "sidebar" | "settingsPage"
```

The expanded set actually shipped (PLUGIN_AUTHORING_GUIDE.md):

```
page, settingsPage, dashboardWidget, sidebar, sidebarPanel,
detailTab, taskDetailView, projectSidebarItem,
globalToolbarButton, toolbarButton, contextMenuItem,
commentAnnotation, commentContextMenuItem
```

For Clarity Pack's four surfaces, the slot type mapping is:

| Surface | Slot type | Notes |
|---|---|---|
| **Surface 1 — Task Detail Reader view** | `taskDetailView` (or `detailTab` with `entityTypes: ["issue"]`) | Adds an additional tab on issue pages without replacing classic UI. Coexistence guarantee #2 satisfied. |
| **Surface 2 — Situation Room** | `page` with `routePath: "situation-room"` | Lives at `/:companyPrefix/plugins/clarity-pack/situation-room`. |
| **Surface 3 — Daily Bulletin** | `page` with `routePath: "bulletin"` | Same routing namespace. |
| **Surface 4 — Employee Chat** | `page` with `routePath: "chat"` | Same. |
| Per-user opt-in toggle | `settingsPage` | Profile/settings page hosting the per-user toggle. |

Each slot needs `id` (unique within plugin), `displayName`, `exportName` (the React component exported from `dist/ui/index.js`).

### Capabilities declared

Verified against `kitchen-sink` manifest. For Clarity Pack v1, the minimum set is:

```ts
capabilities: [
  // Reads
  "companies.read",
  "projects.read",
  "issues.read",
  "issue.comments.read",
  "issue.documents.read",
  "issue.relations.read",
  "issue.subtree.read",
  "agents.read",
  "goals.read",
  "activity.read",
  "issues.orchestration.read",   // for blocker chain transitive resolution

  // Writes (Surface 4 chat, Editor-Agent outputs)
  "issue.comments.create",
  "issue.documents.write",       // bulletin / TL;DR artifacts
  "activity.log.write",
  "metrics.write",

  // Plugin state (per-user opt-in, on-view recompute caches)
  "plugin.state.read",
  "plugin.state.write",

  // Editor-Agent runtime
  "agents.managed",
  "agents.invoke",
  "agent.sessions.create",
  "agent.sessions.send",
  "events.subscribe",            // 60s on-view recompute trigger
  "events.emit",
  "jobs.schedule",               // 06:30 ET bulletin compile
  "agent.tools.register",        // Editor-Agent's internal tools

  // UI
  "instance.settings.register",  // per-user opt-in toggle
  "ui.page.register",
  "ui.detailTab.register",
  "ui.sidebar.register",

  // Database (additive-only schema)
  "database.namespace.migrate",
  "database.namespace.read",
  "database.namespace.write",

  // Optional (only if Editor-Agent calls outbound MCP / LLM endpoints directly,
  // rather than via standard adapter):
  // "http.outbound",
  // "secrets.read-ref",
]
```

**Explicitly NOT to be requested** (PLUGIN_SPEC.md §15.2 forbids these for any plugin): approval decisions, budget override, auth bypass, issue checkout-lock override, direct DB access. These are core-only.

### Real example (kitchen-sink, abbreviated)

```ts
const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip.kitchen-sink-example",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Kitchen Sink (Example)",
  description: "Reference plugin that demonstrates the current Paperclip plugin API surface...",
  author: "Paperclip",
  categories: ["ui", "automation", "workspace", "connector"],
  capabilities: [/* see list above */],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: { type: "object", properties: { /* JSON Schema */ } },
  jobs: [{ jobKey: "demo-heartbeat", displayName: "Demo Heartbeat", schedule: "*/15 * * * *" }],
  webhooks: [{ endpointKey: "demo", displayName: "Demo Ingest" }],
  tools: [{ name: "echo", displayName: "Kitchen Sink Echo", parametersSchema: {/*...*/} }],
  ui: {
    slots: [
      { type: "page",            id: "page",            displayName: "Kitchen Sink",          exportName: "Page",            routePath: "kitchen-sink" },
      { type: "settingsPage",    id: "settings",        displayName: "Kitchen Sink Settings", exportName: "SettingsPage" },
      { type: "dashboardWidget", id: "dashboardWidget", displayName: "Kitchen Sink",          exportName: "DashboardWidget" },
      // …more slots
    ]
  },
};
```

---

## 3. Worker Packaging & Registration

**Process model (PLUGIN_SPEC.md §12.1):**

> "Third-party plugins run out-of-process by default. Default runtime: Paperclip server starts one worker process per installed plugin; the worker process is a Node process; host and worker communicate over JSON-RPC on stdio."

So Clarity Pack's worker is **a Node child process** spawned by the host. There is one worker per installed plugin (not per company). It must:

1. Export a `definePlugin({...})` plugin object as default.
2. Call `runWorker(plugin, import.meta.url)` at the bottom of `worker.ts` — this opens the JSON-RPC stdio channel.
3. Implement worker-side handlers for: `setup`, `onHealth`, `onConfigChanged`, `onValidateConfig`, `onWebhook`, `onShutdown` (all optional except `setup`).

**Hello-world worker (verbatim, 17 lines):**

```ts
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("hello-world-example plugin setup complete");
  },
  async onHealth() {
    return { status: "ok", message: "Hello World example plugin ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
```

### Heartbeat / managed agent (Editor-Agent)

**This is the only sanctioned mechanism for a plugin-shipped agent.** From `PLUGIN_AUTHORING_GUIDE.md`:

```ts
// In manifest.ts:
agents: [
  {
    agentKey: "editor-agent",
    displayName: "Editor-Agent",
    role: "editor",
    title: "Editorial Desk",
    capabilities: "Compiles TL;DRs, critical-path narratives, and the daily bulletin.",
    adapterPreference: ["codex_local", "claude_local", "process"],
    instructions: { content: "Follow the Paperclip heartbeat …" },
  },
],

// In worker.ts:
ctx.actions.register("setup-company", async ({ companyId }) => {
  const agent   = await ctx.agents.managed.reconcile("editor-agent",  String(companyId));
  const project = await ctx.projects.managed.reconcile("editorial",   String(companyId));
  const routine = await ctx.routines.managed.reconcile("daily-bulletin", String(companyId));
  return { agent, project, routine };
});
```

The **heartbeat itself is owned by Paperclip core** — it's the same scheduling surface that drives every other agent. You don't run a sidecar loop; you publish the agent declaration, reconcile it once per company, and then the host invokes it on its own cadence (and via routine triggers like the 06:30 ET bulletin cron). This is exactly what governance parity (Decision #6, coexistence guarantee #4) requires: same caps, same pause/terminate, same audit log.

**Decision (Clarity Pack):**
- Surface 2's "60-second on-view recompute" is implemented as a `jobs.schedule` cron with `*/1 * * * *` plus a UI-driven debounced `ctx.actions` invocation — the worker job runs once a minute *only when the Situation Room view is open*, observed via plugin state ("active viewers") set by the UI. Don't run a continuous tight-loop in the worker process.
- Surface 3's 06:30 ET bulletin is a `routines[]` entry (cron `0 6 30 * * *` America/New_York) assigned to the Editor-Agent.

### Routines (cron) declaration

```ts
routines: [
  {
    routineKey: "daily-bulletin",
    title: "Daily Bulletin (06:30 ET)",
    description: "Compile yesterday's operations + today's awaiting-you items.",
    assigneeRef: { resourceKind: "agent",   resourceKey: "editor-agent" },
    projectRef:  { resourceKind: "project", resourceKey: "editorial"   },
    priority: "medium",
    triggers: [{
      kind: "schedule",
      label: "Daily 06:30 ET",
      cronExpression: "30 6 * * *",
      timezone: "America/New_York",
      enabled: true,
    }],
  },
],
```

---

## 4. MCP Server Pattern

**Package:** `@paperclipai/mcp-server@2026.512.0` — already first-party, lives at `packages/mcp-server` in the Paperclip repo. (Date-based npm versioning; workspace `package.json` says `0.1.0` but publish pipeline overrides.) It is **a thin MCP wrapper over Paperclip's existing REST API**, not a database client and not a fork of business logic (per its README, verbatim):

> "This package is a thin MCP wrapper over the existing Paperclip REST API. It does not talk to the database directly and it does not reimplement business logic."

### Built on
- `@modelcontextprotocol/sdk@^1.29.0`
- `zod@^3.24.2`
- `@paperclipai/shared` (workspace internal)

### How the Editor-Agent will use it

The MCP server exposes exactly the read tools the Editor-Agent's compile loop needs:

```
paperclipGetHeartbeatContext      ← drives the heartbeat-aware compile
paperclipListIssues               ← Surface 2 employee state
paperclipGetIssue                 ← Surface 1 reader-view backing data
paperclipListComments             ← Surface 4 chat history
paperclipGetComment
paperclipListDocuments            ← deliverable preview / artifact shelf
paperclipGetDocument
paperclipListDocumentRevisions
paperclipGetIssueWorkspaceRuntime ← workspace location for deliverables
paperclipListProjects
paperclipGetProject
paperclipListGoals
paperclipListAgents
paperclipGetAgent
paperclipListApprovals            ← "Requires Your Decision" inbox for the bulletin
paperclipListIssueApprovals
paperclipApiRequest               ← escape hatch for any /api endpoint not yet wrapped
```

Plus write tools (`paperclipCreateIssue`, `paperclipAddComment`, `paperclipUpsertIssueDocument`, `paperclipAddApprovalComment`, etc.) — these are what the Editor-Agent uses to publish the TL;DR document, the daily bulletin doc, and chat-thread comments.

### Auth env (per the MCP server's README)
- `PAPERCLIP_API_URL` — e.g. `http://localhost:3100`
- `PAPERCLIP_API_KEY` — bearer token
- `PAPERCLIP_COMPANY_ID` (optional default)
- `PAPERCLIP_AGENT_ID` (optional default; set this to the Editor-Agent's id)
- `PAPERCLIP_RUN_ID` (optional, forwarded on mutating requests)

### Invocation
- CLI: `npx -y @paperclipai/mcp-server` (stdio MCP server)
- Or local: `node packages/mcp-server/dist/stdio.js`

For Clarity Pack, the **Editor-Agent will not import `@paperclipai/mcp-server` as a library**. Instead, the agent runs under one of `claude_local` / `codex_local` / `process` adapters, and the adapter is configured to launch the MCP server as a child stdio process. We do not need to vendor or wrap the MCP server; we just declare the agent and let the existing adapter machinery hand it to the MCP server. (Confidence: HIGH on the MCP package and tool list; MEDIUM on the exact wiring between the managed-agent adapter config and an MCP server child process — Phase 1 should re-verify by spawning kitchen-sink in dev mode and tracing the adapter handshake.)

---

## 5. Migrations & Schema Tooling

**There is a real, documented contradiction here**, and Phase 1 should resolve it before authoring the first migration:

### What `PLUGIN_SPEC.md` says (formal spec, §21.5)
> "Arbitrary third-party schema migrations are out of scope for the first plugin system. The first plugin system does not allow arbitrary third-party migrations."

It directs plugins to use generic extension tables (`plugin_state`, `plugin_entities`).

### What `PLUGIN_AUTHORING_GUIDE.md` and the running SDK code say
The guide explicitly documents a `database` manifest field for "first-party or otherwise trusted orchestration plugins":

```ts
database: {
  migrationsDir: "migrations",
  coreReadTables: ["issues"],   // optional whitelist for FK references / read-only views
}
```

with capabilities `database.namespace.migrate`, `database.namespace.read`, and (optionally) `database.namespace.write`.

Plain SQL files in `migrations/` run **in filename order before worker startup**. Migration SQL may only create/alter objects inside `ctx.db.namespace`. Runtime calls are restricted: `ctx.db.query()` to `SELECT` only, `ctx.db.execute()` to namespace-local `INSERT`/`UPDATE`/`DELETE`. Migration SQL "may reference whitelisted `public` core tables for foreign keys or read-only views, but may not mutate/alter/drop/truncate public tables."

### Resolution for Clarity Pack
- **Use the `database` manifest field + plugin namespace.** This satisfies both the additive-only requirement (you literally cannot mutate `public`) and the "clean uninstall preserves data" requirement (the namespace is plugin-owned and survives a disable).
- **Write plain SQL migrations** in `migrations/0001_*.sql`, `0002_*.sql`, etc. — not Drizzle Kit metadata.
- **Drizzle is a host concern, not yours.** The plugin runtime applies SQL files; you do not run `drizzle-kit migrate` from your plugin. (Drizzle Kit is helpful for *authoring* the SQL by introspecting a Drizzle schema you write in TS, but the artifact you ship is the raw `.sql`.)
- Read core tables (e.g. `issues`, `comments`) via `ctx.db.query()` (SELECT-only), not by direct DB connection.
- Phase 1 SPEC.md must explicitly cite the authoring guide as authoritative for this, because the formal spec under-documents it. Flag for the Pitfalls research doc.

### Tables Clarity Pack will need (sketch — for Architecture doc to refine)
- `tldrs` (issue_id, summary, generated_at, source_revisions[], compiled_by_agent_id) — Surface 1 cache
- `situation_snapshots` (taken_at, payload jsonb, viewer_user_id) — Surface 2 60s recompute cache
- `bulletins` (compiled_at, body_md, awaiting_you jsonb) — Surface 3 daily output
- `chat_topics` (issue_id, employee_user_id, scope, last_activity_at) — Surface 4 metadata over the comment stream
- `clarity_user_prefs` (user_id, opt_in boolean, default_landing) — coexistence guarantee #1

All live in the plugin namespace; none modify `public`.

---

## 6. Build & Distribution Toolchain

### Recommended package layout (matches `plugin-kitchen-sink-example`)

```
clarity-pack/
├── package.json              # see below
├── tsconfig.json             # extends Paperclip-style: lib ES2023+DOM, jsx react-jsx
├── migrations/
│   ├── 0001_clarity_init.sql
│   └── …
├── scripts/
│   └── build-ui.mjs          # esbuild config for UI bundle
└── src/
    ├── constants.ts          # PLUGIN_ID, capability strings, slot ids, route paths
    ├── manifest.ts           # default-export PaperclipPluginManifestV1
    ├── worker.ts             # default-export definePlugin(...) + runWorker(...)
    ├── index.ts              # re-exports manifest + worker
    └── ui/
        ├── index.tsx         # named exports for each slot's exportName
        ├── reader-view.tsx   # Surface 1 component
        ├── situation-room.tsx
        ├── bulletin.tsx
        ├── chat.tsx
        ├── settings.tsx
        ├── components/       # local shadcn primitives we add
        └── lib/utils.ts      # cn() helper, copied from host
```

### `package.json` keys (verified against kitchen-sink)

```jsonc
{
  "name": "clarity-pack",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker":   "./dist/worker.js",
    "ui":       "./dist/ui/"
  },
  "scripts": {
    "build":     "tsc && node ./scripts/build-ui.mjs",
    "clean":     "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "2026.512.0"
    // Date-based versioning. Pin EXACTLY (no caret). Renovate auto-bumps via PR.
    // do NOT add @paperclipai/shared as a runtime dep unless we end up using its types in worker/ui
  },
  "devDependencies": {
    "esbuild":          "^0.27.3",
    "@types/node":      "^24.6.0",
    "@types/react":     "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "react":            "^19.0.0",
    "react-dom":        "^19.0.0",
    "typescript":       "^5.7.3"
  },
  "peerDependencies": { "react": ">=18" },
  "files": ["dist", "migrations", "README.md", "LICENSE"]
}
```

The **`paperclipPlugin` field is the host's discovery mechanism** at install time. Without it, `paperclipai plugin install` won't find your manifest/worker/ui artifacts. Verified in both example plugins.

### `tsconfig.json` for Clarity Pack

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2023", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/ui/*"] }
  },
  "include": ["src"]
}
```

Mirrors the host `ui/tsconfig.json` plus the kitchen-sink plugin tsconfig. Use `noEmit: false` (omit it — kitchen-sink uses `tsc` for the worker/manifest emit, then esbuild for the UI bundle).

### UI bundle script (`scripts/build-ui.mjs`)

Verbatim from kitchen-sink (works as-is, just change the entry point):

```js
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [path.join(packageRoot, "src/ui/index.tsx")],
  outfile:     path.join(packageRoot, "dist/ui/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@paperclipai/plugin-sdk/ui",
    "@paperclipai/plugin-sdk/ui/hooks"
  ],
  logLevel: "info",
});
```

(Or use the SDK preset: `import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers"` and feed its `presets.esbuild.ui` directly to `esbuild.build`. Same result.)

### Install command (FORCED string)

```sh
pnpm paperclipai plugin install clarity-pack
```

Per `PLUGIN_SPEC.md` §8.2, the full operator surface is:

```
pnpm paperclipai plugin list
pnpm paperclipai plugin install <package[@version]>
pnpm paperclipai plugin uninstall <plugin-id>
pnpm paperclipai plugin upgrade <plugin-id> [version]
pnpm paperclipai plugin doctor <plugin-id>
```

Note the docs/CLI.md document does **not** mention these (its WebFetch in our research returned no plugin commands at all). Source of truth is `PLUGIN_SPEC.md` §8 and the runtime CLI implementation.

### Distribution path

- Publish to npm as a **public** package (PLUGIN_SPEC.md §1 says "Runtime installs assume … reachable package registry"; ClipHub/Cliphub is for company templates, not plugins, per `doc/CLIPHUB.md`).
- v1 audience is Eric on BEAAA only — single private install; no Clipmart submission needed (per Decision #7 / PROJECT.md "Out of Scope").
- A `.npmignore` is unnecessary; the `files` field above covers it.

---

## Recommended Stack — Compact Table

### Core Technologies

| Technology | Version | Status | Why |
|---|---|---|---|
| `@paperclipai/plugin-sdk` | `2026.512.0` | FORCED | Single supported public API. Date-based versioning. |
| TypeScript | `^5.7.3` | FORCED | Matches host pin. |
| React | `^19.0.0` (peer `>=18`) | FORCED | Host UI runtime. Externalize, do not bundle. |
| React DOM | `^19.0.0` | FORCED | Same. |
| Tailwind CSS | v4 series; inherit from host (`^4.0.7` baseline) | FORCED | Same-origin bundle uses host CSS. We do not ship a parallel Tailwind. |
| shadcn/ui | "new-york" style, neutral baseColor, lucide icons | FORCED | Match host `components.json`. |
| Drizzle ORM (host-side) | `^0.38.4` | FORCED-IF-USING-DB | Host runs migrations. We ship raw SQL. |
| `postgres` driver (host-side) | `^3.4.5` | INDIRECT | Used by host's Drizzle pipeline; not a plugin dep. |
| MCP server | `@paperclipai/mcp-server@2026.512.0` | FORCED | Editor-Agent reads. Date-based versioning. |
| MCP SDK (transitive) | `@modelcontextprotocol/sdk@^1.29.0` | INDIRECT | Inside the MCP server. |
| Node | `>=20` | FORCED | Worker target. |
| pnpm | `9.x` | RECOMMENDED | Matches host workspace tooling (`9.15.4`). |

### Build Tools

| Tool | Version | Why |
|---|---|---|
| esbuild | `^0.27.3` | What every first-party plugin uses; SDK ships presets. |
| `tsc` | `5.7.3` | Compiles worker.ts + manifest.ts (native ESM `--module ESNext`). |

### Plugin SDK subpath imports cheatsheet

```ts
// Worker side
import {
  definePlugin,
  runWorker,
  type PaperclipPluginManifestV1,
  type PluginContext,
  type PluginEvent,
  type PluginJobContext,
  type PluginWebhookInput,
  type ToolResult,
  type ToolRunContext,
  PLUGIN_STATE_SCOPE_KINDS,
} from "@paperclipai/plugin-sdk";

// UI side (React component code)
import {
  AssigneePicker, ProjectPicker, FileTree, IssuesList,
  MarkdownBlock, MarkdownEditor, ManagedRoutinesList,
} from "@paperclipai/plugin-sdk/ui";
import {
  usePluginData, usePluginAction, usePluginStream,
  usePluginToast, useHostContext,
} from "@paperclipai/plugin-sdk/ui/hooks";

// Bundler config
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

// Dev server (for `pnpm dev`-style iteration without re-installing into host)
// CLI: paperclip-plugin-dev-server
```

---

## Installation

```bash
# Plugin runtime SDK (the only dep we need to take from Paperclip)
pnpm add @paperclipai/plugin-sdk

# Build and type tooling
pnpm add -D \
  typescript@^5.7.3 \
  esbuild@^0.27.3 \
  @types/node@^24.6.0 \
  @types/react@^19.0.8 \
  @types/react-dom@^19.0.3 \
  react@^19.0.0 \
  react-dom@^19.0.0

# (Optional) shadcn — to author plugin-local components matching host style
pnpm dlx shadcn@latest init
# then `pnpm dlx shadcn@latest add button card …` etc.

# (Phase 1+) host-side install onto a running Paperclip instance, after `npm publish`
pnpm paperclipai plugin install clarity-pack
```

---

## Alternatives Considered

| Recommended | Alternative | When Alternative Makes Sense |
|---|---|---|
| esbuild for both worker and UI bundles | rollup (also supported by SDK presets) | Only if we end up with a code-splitting requirement esbuild can't satisfy. We don't. |
| Plain SQL files for migrations | Drizzle Kit migrations / migrations as JS | Would let us share a single Drizzle schema with the host — but the plugin runtime runs raw SQL, so the JS pathway is moot, and Drizzle Kit's metadata would be ignored. The right pattern is: author SQL by hand or use Drizzle Kit only as a *generator* feeding raw `.sql` into `migrations/`. |
| Managed agent (`agents[]` + `routines[]`) | Long-running worker loop using `setInterval` in `setup()` | Would violate governance parity (coexistence guarantee #4): no audit trail, no pause/terminate, no budget cap visibility. Use cases for the alternative are nil for Clarity Pack. |
| MCP server as an out-of-process child of the agent adapter | Direct REST calls from worker via `ctx.http.fetch` | We can do this for *our own* worker bookkeeping (e.g. computing the situation snapshot), but the Editor-Agent itself should consume MCP — that's the cleanest path to swap LLM adapters later. |
| `paperclipai plugin install` | Vendored installation (drop folder into a host plugins dir) | Only viable while `paperclipai plugin install` does not yet support local-tarball install paths — quick verification needed in Phase 1. If `pack && install ./tgz` works, prefer it for our local dev loop. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| Vite as the **plugin** bundler | Vite is the host UI's bundler, but plugin UI must ship as pre-built ESM with React externalized — that's an esbuild/rollup library-bundle job, not Vite's day job. | esbuild via `@paperclipai/plugin-sdk/bundlers` presets, or `scripts/build-ui.mjs` per kitchen-sink. |
| Bundling React/`react-dom`/`react/jsx-runtime` into the UI bundle | Will conflict with host's React, double-mount hooks, and waste bytes. Host explicitly externalizes them. | Externalize. |
| Bundling `@paperclipai/plugin-sdk/ui` or `…/ui/hooks` | Same — host loads these as singletons; bundling them breaks bridge/RPC singletons. | Externalize. |
| A second UI framework (Vue, Svelte, Solid) inside the plugin | PLUGIN_SPEC.md §19 makes plugins ship as React modules loaded into host React tree. | React only. |
| A second Tailwind config / parallel design tokens | Same-origin trust model means we share the host's CSS variables and `:root` tokens. A second Tailwind would either conflict or be ignored. | Inherit host tokens; add only new utility classes via local CSS layers if absolutely needed. |
| Writing migrations against `public.*` tables | PLUGIN_AUTHORING_GUIDE.md: "may not mutate/alter/drop/truncate public tables." Host will reject the migration. | All DDL inside `ctx.db.namespace`; reference public tables only for read-only views or FK declarations whitelisted via `coreReadTables`. |
| Direct `pg` / `postgres` library usage from worker | Forbidden capability per PLUGIN_SPEC.md §15.2 ("direct DB access"). | `ctx.db.query()` (SELECT) and `ctx.db.execute()` (namespace-local DML). |
| A custom heartbeat loop in the worker (`setInterval` in `setup`) | Bypasses governance parity (coexistence guarantee #4); no audit log, no pause/terminate, no budget caps. | `agents[]` declaration + `routines[]` cron + `jobs[]` schedule. |
| `iframe` sandboxing on our side | Host explicitly does NOT iframe plugin UI. Adding one would break the bridge (`usePluginData`, `usePluginAction`). | Trust the host's same-origin loader. The trust model is a host concern, not ours. |
| Bundling `@paperclipai/shared` | It's a workspace package with no public npm publish guarantee for this version. | Don't import from it unless the SDK re-exports the type you need (it does, for `Goal`, `Issue`, etc.). |
| Older Node (<20) | Host's `engines.node = ">=20"`. | Node 20 LTS for dev and CI. |

---

## Stack Patterns by Variant

**If the Editor-Agent needs a private LLM endpoint (BYO key):**
- Configure via `instanceConfigSchema` with a `secretRefExample`-style string field.
- Add `secrets.read-ref` capability.
- Resolve via `ctx.secrets.resolve(secretRef)` in the worker; pass the resolved value to the adapter config or to MCP server env.

**If we need to react to Paperclip events (e.g. `issue.created` to invalidate Surface 2 caches):**
- Add `events.subscribe` capability.
- `ctx.events.on("issue.created", handler)` inside `setup`.

**If we ship a UI-only iteration during dev (no host install round-trip):**
- Use `paperclip-plugin-dev-server` (the bin in `@paperclipai/plugin-sdk`).
- Confidence MEDIUM that this works against an external plugin — Phase 1 should pilot it. The kitchen-sink targets workspace-internal dev.

**If Phase 1 finds the install command is `paperclipai install` (not `paperclipai plugin install`):**
- The PLUGIN_SPEC.md §8.2 strings are the contract. CLIPHUB.md uses `paperclipai install cliphub:<…>` for company templates — different surface. Verify by running `pnpm paperclipai plugin --help` against a fresh clone in Phase 1.

---

## Version Compatibility — Known-Good Set

| Package | Version | Compatible With | Notes |
|---|---|---|---|
| `@paperclipai/plugin-sdk` | `1.0.0` | apiVersion 1 | One major SDK ↔ one apiVersion (PLUGIN_SPEC.md §29.2). |
| `react` | `^19.0.0` (peer `>=18`) | host React 19 | Externalize. |
| `tailwindcss` | `^4.0.7` (host) | host CSS | Don't ship our own; same-origin = same stylesheet. |
| TypeScript | `^5.7.3` | tsconfig with `moduleResolution: "bundler"`, `module: "ESNext"`, `target: ES2023` | Matches host. |
| esbuild | `^0.27.3` | UI target `es2022`, worker target `node20`, format `esm` | Per SDK presets. |
| Node | `>=20` | All | Worker process target. |
| Drizzle ORM (host) | `^0.38.4` | host-only; plugin ships raw SQL | Do not pin Drizzle in our `package.json`. |
| `@paperclipai/mcp-server` | `2026.512.0` | `@modelcontextprotocol/sdk@^1.29.0` | Editor-Agent's read surface. Date-based versioning. |

**Watchpoints:**
- Upstream Drizzle is at `0.45.x` and a `1.0.0-beta` is in flight. Paperclip pins `0.38.x`. **We must not chase upstream; track host.** When host bumps Drizzle, retest our migrations.
- Tailwind v4 stable is `4.2.x` upstream; host pins `4.0.7`. We inherit the host's pin transparently because we don't ship Tailwind ourselves.
- React 19 + radix-ui 1.4 + shadcn "new-york" is the current host triad. shadcn primitives we install for plugin-local components must come from a `shadcn` CLI version that emits radix-ui 1.4-compatible code (any current shadcn does).

---

## Sources

| Source | URL | Confidence Use |
|---|---|---|
| Paperclip repo (default branch `master`) | https://github.com/paperclipai/paperclip | HIGH — fetched 2026-05-07 17:25 UTC |
| `doc/plugins/PLUGIN_SPEC.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/plugins/PLUGIN_SPEC.md | HIGH — manifest, capabilities, install command, trust model, process model |
| `doc/plugins/PLUGIN_AUTHORING_GUIDE.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/plugins/PLUGIN_AUTHORING_GUIDE.md | HIGH — slot type expansion, agents/routines/database manifest fields, ctx.* APIs |
| `doc/SPEC.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/SPEC.md | HIGH — TS+Express, React+Vite, Postgres, Better Auth |
| `doc/SPEC-implementation.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/SPEC-implementation.md | HIGH — Node 20+, Drizzle source-of-truth, pnpm |
| `doc/DATABASE.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/DATABASE.md | HIGH — Postgres 17, Drizzle, plugin namespace tracking tables |
| `doc/CLIPHUB.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/CLIPHUB.md | HIGH — confirms ClipHub is for company templates, not plugins |
| `doc/CLI.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/CLI.md | LOW for plugin commands (omitted) — defer to PLUGIN_SPEC.md §8.2 |
| `doc/TASKS-mcp.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/TASKS-mcp.md | HIGH — MCP interface contract |
| `ui/components.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/ui/components.json | HIGH — fetched verbatim |
| `ui/package.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/ui/package.json | HIGH — exact version pins |
| `ui/tsconfig.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/ui/tsconfig.json | HIGH |
| `ui/vite.config.ts` | https://raw.githubusercontent.com/paperclipai/paperclip/master/ui/vite.config.ts | HIGH |
| Root `package.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/package.json | HIGH — Node engines, pnpm version, esbuild version |
| Root `tsconfig.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/tsconfig.json | HIGH |
| `packages/plugins/sdk/package.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/sdk/package.json | HIGH — SDK exports, peer deps, bin |
| `packages/plugins/sdk/src/bundlers.ts` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/sdk/src/bundlers.ts | HIGH — verbatim build presets |
| `packages/plugins/examples/plugin-kitchen-sink-example/package.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/examples/plugin-kitchen-sink-example/package.json | HIGH — verbatim |
| `…/plugin-kitchen-sink-example/src/manifest.ts` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/examples/plugin-kitchen-sink-example/src/manifest.ts | HIGH — full real manifest |
| `…/plugin-kitchen-sink-example/src/worker.ts` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/examples/plugin-kitchen-sink-example/src/worker.ts | HIGH — definePlugin/runWorker pattern |
| `…/plugin-kitchen-sink-example/scripts/build-ui.mjs` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/examples/plugin-kitchen-sink-example/scripts/build-ui.mjs | HIGH — verbatim esbuild config |
| `…/plugin-kitchen-sink-example/tsconfig.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/examples/plugin-kitchen-sink-example/tsconfig.json | HIGH |
| `packages/plugins/examples/plugin-hello-world-example/{manifest,worker}.ts` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/plugins/examples/plugin-hello-world-example/src/ | HIGH — minimal-shape reference |
| `packages/db/package.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/db/package.json | HIGH — Drizzle/postgres pins |
| `packages/mcp-server/package.json` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/mcp-server/package.json | HIGH — `@modelcontextprotocol/sdk@^1.29.0` |
| `packages/mcp-server/README.md` | https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/mcp-server/README.md | HIGH — auth env, full tool list, invocation |
| Drizzle ORM upstream releases | https://github.com/drizzle-team/drizzle-orm/releases | MEDIUM — only used to confirm host pin (0.38.4) is older than upstream (0.45.2); we still match host. |
| Tailwind CSS upstream | https://github.com/tailwindlabs/tailwindcss/releases | MEDIUM — same; host pins 4.0.7, upstream stable 4.2.x. |

---

## Confidence Summary by Claim

| Claim | Confidence | Why |
|---|---|---|
| React 19, TS 5.7.3, esbuild 0.27.3, Tailwind 4 are the host's pins | HIGH | Read directly from `ui/package.json`, root `package.json`, kitchen-sink `package.json`. |
| shadcn config: new-york / neutral / cssVariables / lucide | HIGH | Read directly from `ui/components.json`. |
| Plugin manifest shape (`PaperclipPluginManifestV1`) and capability strings | HIGH | Spec + verbatim kitchen-sink manifest. |
| Worker is an out-of-process Node child over JSON-RPC stdio | HIGH | PLUGIN_SPEC.md §12.1 verbatim. |
| Plugin UI is same-origin trusted JS, not iframed | HIGH | PLUGIN_SPEC.md §19 explicit caveat. |
| Heartbeat-driven agent = `agents[]` manifest + `ctx.agents.managed.reconcile` | MEDIUM | Documented in PLUGIN_AUTHORING_GUIDE.md and shipped in kitchen-sink, but PLUGIN_SPEC.md does not yet codify the field. The implementation is ahead of the formal spec. Phase 1 should re-verify by running kitchen-sink end-to-end and inspecting the agents-table side-effects. |
| Plugin migrations via `database.migrationsDir` + plain SQL in plugin namespace | MEDIUM | Same gap as above — guide and SDK code support it; formal spec text says "out of scope." We treat the guide + working code as authoritative. Phase 1 must cite both, and should write `0001_clarity_init.sql` and verify it applies via `pnpm paperclipai plugin install` against a fresh local instance. |
| `@paperclipai/mcp-server` is the MCP server pattern (npm pinned exactly to `2026.512.0`) | HIGH | Verbatim from `packages/mcp-server/{package.json,README.md}`. Workspace `package.json` says `0.1.0` but npm publish overrides with date version. |
| Install command is `pnpm paperclipai plugin install <name>` | HIGH for the spec; MEDIUM for whether the CLI binary actually wires it up exactly as written — `doc/CLI.md` doesn't echo it. Phase 1 should sanity-check by running `pnpm paperclipai plugin --help` once. |
| Drizzle ORM 0.38.4 is the host's pin | HIGH | `packages/db/package.json`. |

---

*Stack research for: Paperclip plugin (TypeScript) — Clarity Pack v1*
*Researched: 2026-05-07*
