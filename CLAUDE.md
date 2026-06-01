<!-- GSD:project-start source:PROJECT.md -->
## Project

**Clarity Pack**

A **Paperclip plugin** named `clarity-pack` that adds four user-facing surfaces and one Editor-Agent on top of an unmodified Paperclip install. It is built for a solo founder running Paperclip's agent-driven org chart who needs plain-English clarity on what every employee is doing, what's blocking, and where artifacts live — without forking Paperclip.

The four surfaces are:

1. **Task Detail "Reader view"** — inline reference resolution, plain-English TL;DR, deliverable preview inline, goal ancestry breadcrumb, acceptance criteria auto-status.
2. **Situation Room** — live cockpit showing every agent's current state, plain-English blockers, transitively-resolved blocker chains ending in a single human action, artifact shelf.
3. **Daily Bulletin** — auto-compiled morning editorial digest of yesterday's operations + today's awaiting-you items.
4. **Employee Chat** — hybrid real-time UI where messages persist as comments on per-topic private issues; attachments stored as work-products.

The fifth piece is the **Editor-Agent** — a heartbeat-driven Paperclip employee (regular org-chart hire) that compiles the TL;DRs, critical-path narratives, and bulletins. The mockups already use the "Editor" / "Editorial Desk" voice; the Situation Room footer's prior `Compiled by Compiler-Agent` is renamed to match.

**Core Value:** **Zero rabbit-holes.** Every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place. If anything else fails, this must hold: Eric should never have to click through three levels of unresolved task references to find out what one of his agents is stuck on.

### Constraints

- **Tech stack**: TypeScript plugin, React + shadcn UI contributions (matches `ui/components.json` in paperclipai/paperclip). — **Why:** integrate into Paperclip's existing UI runtime without introducing a second framework.
- **Distribution**: npm package + `paperclipai plugin install clarity-pack`. Clipmart submission deferred. — **Why:** matches PLUGIN_SPEC.md install model and v1 audience scope.
- **Trust model**: Plugin UI bundles run as **same-origin JavaScript inside the main Paperclip app — treated as trusted code, not sandboxed**. Manifest capabilities gate worker-side host RPC calls but do NOT prevent plugin UI code from calling Paperclip HTTP APIs directly. — **Why:** stated in PLUGIN_SPEC.md; tightening it is out of scope.
- **Deployment model inherited from Paperclip**: single-tenant, self-hosted, single-node, filesystem-persistent. Runtime installs assume writable local filesystem + npm available + reachable package registry. — **Why:** PLUGIN_SPEC.md describes this as today's model; v1 will not broaden it.
- **Database**: Postgres migrations must be additive-only; plugin disable leaves data intact. — **Why:** coexistence guarantee #3 + #6.
- **Coexistence guarantees** (hard, all testable, must appear in Phase 1 SPEC.md):
  1. Per-user opt-in via profile toggle; default OFF for existing users.
  2. Original UI never replaced; Reader view is an additional tab.
  3. Schema is additive-only; plugin disable leaves data intact.
  4. Editor-Agent is a regular org-chart hire (no special privileges).
  5. Chat messages render as ordinary threaded comments in classic Paperclip UI.
  6. Clean uninstall preserves data; `--purge` flag is opt-in only.
- **Editor-Agent integration**: a Paperclip employee whose worker uses an MCP server package for issue/activity reads. Subject to standard agent budget caps and pause/terminate. — **Why:** governance parity (Decision #6).
- **Visual contract**: must match the four mockups in `sketches/`. — **Why:** non-throwaway design ground truth; consistency across surfaces is a value driver.
- **Bookended-by-snapshots rule**: every clarity-pack install, upgrade, schema migration, or agent registration that runs against the live BEAAA Paperclip instance MUST be bookended by a verified Postgres + filesystem snapshot taken immediately before, and a working rollback path verified at least once before any feature work ships. — **Why:** Paperclip is single-tenant filesystem-persistent (PLUGIN_SPEC.md's stated deployment model); the same-origin trust model means a misbehaving plugin can hit Paperclip APIs directly; uninstall semantics for additive Postgres migrations are not yet host-enforced (PLUGIN_SPEC §21 vs PR #5205 contradict each other per Pitfalls research). The cost of "I'll restore from backup" with no rehearsed restore path is unbounded; with a rehearsed path, it is bounded at minutes.
- **Stack pins are forced by the plugin contract** (per Stack research): React 19 (peer-only — do NOT bundle), TypeScript ^5.7.3, esbuild ^0.27.3, ESM-only, Node ≥20, shadcn `new-york`/neutral/lucide. Tailwind is inherited from host CSS — Clarity Pack does NOT ship its own Tailwind. — **Why:** PLUGIN_SPEC + ui/components.json + plugin-kitchen-sink-example dictate this; deviating breaks the same-origin trust model and bloats the bundle.
- **PLUGIN_SPEC.md re-read completed** during project research (full 1720-line spec read against `master` branch). Findings live in `.planning/research/` and must be reflected in Phase 1 SPEC.md.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## TL;DR — Locked Choices
| What | Choice | FORCED / RECOMMENDED / OPTIONAL | Why (one-liner) |
|---|---|---|---|
| Plugin SDK | `@paperclipai/plugin-sdk@2026.512.0` | **FORCED** | Sole supported public API for Paperclip plugins. Provides `definePlugin`, `runWorker`, `usePluginData`, `usePluginAction`, etc. **Date-based versioning** (npm publish overrides workspace `1.0.0`). Pin EXACTLY; Renovate watches for bumps and posts to Telegram. |
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
| MCP server (for Editor-Agent) | `@paperclipai/mcp-server@2026.512.0` | **FORCED** | The official MCP wrapper around Paperclip's REST API. Includes `paperclipGetHeartbeatContext`, `paperclipListIssues`, `paperclipListComments`, `paperclipListDocuments` — exactly what the Editor-Agent reads. Built on `@modelcontextprotocol/sdk@^1.29.0`. **Date-based versioning** (same scheme as plugin-sdk). Pin EXACTLY; Renovate watches. |
| Agent execution model | Managed agent (`agents[]` manifest entry + `ctx.agents.managed.reconcile`) with `adapterPreference: ["codex_local", "claude_local", "process"]` | **FORCED** | Single supported mechanism for a plugin to ship a heartbeat-driven org-chart hire. |
| Install command | `pnpm paperclipai plugin install <package[@version]>` | **FORCED** | Per `PLUGIN_SPEC.md` §8.2. |
| Distribution | npm public package | **FORCED** | Host install path requires reachable npm registry (PLUGIN_SPEC.md §1 deployment notes). |
| Trust posture | Plugin UI = same-origin trusted JS (NOT iframed, NOT sandboxed) | **FORCED** | Explicit in PLUGIN_SPEC.md §19 caveats. Capabilities gate worker RPC, not UI HTTP. |
## 1. Versions Paperclip's Plugin Runtime Expects
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
### From `ui/components.json` (the shadcn config you must match)
### Root repo
- `package.json` engines: `"node": ">=20"` — your plugin must build/test on Node 20+.
- Package manager: `pnpm@9.15.4` (workspace).
- esbuild root: `^0.27.3`.
## 2. Plugin Manifest Shape
### Slot types (UI contribution points)
| Surface | Slot type | Notes |
|---|---|---|
| **Surface 1 — Task Detail Reader view** | `taskDetailView` (or `detailTab` with `entityTypes: ["issue"]`) | Adds an additional tab on issue pages without replacing classic UI. Coexistence guarantee #2 satisfied. |
| **Surface 2 — Situation Room** | `page` with `routePath: "situation-room"` | Lives at `/<companyPrefix>/situation-room` (e.g. `/COU/situation-room`). Plugin pages mount at `/<companyPrefix>/<routePath>` — NOT under a `/plugins/<plugin-id>/...` namespace — per project memory `clarity-pack-plugin-page-routes`. |
| **Surface 3 — Daily Bulletin** | `page` with `routePath: "bulletin"` | Same routing namespace. |
| **Surface 4 — Employee Chat** | `page` with `routePath: "chat"` | Same. |
| Per-user opt-in toggle | `settingsPage` | Profile/settings page hosting the per-user toggle. |
### Capabilities declared
### Real example (kitchen-sink, abbreviated)
## 3. Worker Packaging & Registration
### Heartbeat / managed agent (Editor-Agent)
- Surface 2's "60-second on-view recompute" is implemented as a `jobs.schedule` cron with `*/1 * * * *` plus a UI-driven debounced `ctx.actions` invocation — the worker job runs once a minute *only when the Situation Room view is open*, observed via plugin state ("active viewers") set by the UI. Don't run a continuous tight-loop in the worker process.
- Surface 3's 06:30 ET bulletin is a `routines[]` entry (cron `0 6 30 * * *` America/New_York) assigned to the Editor-Agent.
### Routines (cron) declaration
## 4. MCP Server Pattern
### Built on
- `@modelcontextprotocol/sdk@^1.29.0`
- `zod@^3.24.2`
- `@paperclipai/shared` (workspace internal)
### How the Editor-Agent will use it
### Auth env (per the MCP server's README)
- `PAPERCLIP_API_URL` — e.g. `http://localhost:3100`
- `PAPERCLIP_API_KEY` — bearer token
- `PAPERCLIP_COMPANY_ID` (optional default)
- `PAPERCLIP_AGENT_ID` (optional default; set this to the Editor-Agent's id)
- `PAPERCLIP_RUN_ID` (optional, forwarded on mutating requests)
### Invocation
- CLI: `npx -y @paperclipai/mcp-server` (stdio MCP server)
- Or local: `node packages/mcp-server/dist/stdio.js`
## 5. Migrations & Schema Tooling
### What `PLUGIN_SPEC.md` says (formal spec, §21.5)
### What `PLUGIN_AUTHORING_GUIDE.md` and the running SDK code say
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
## 6. Build & Distribution Toolchain
### Recommended package layout (matches `plugin-kitchen-sink-example`)
### `package.json` keys (verified against kitchen-sink)
### `tsconfig.json` for Clarity Pack
### UI bundle script (`scripts/build-ui.mjs`)
### Install command (FORCED string)
### Distribution path
- Publish to npm as a **public** package (PLUGIN_SPEC.md §1 says "Runtime installs assume … reachable package registry"; ClipHub/Cliphub is for company templates, not plugins, per `doc/CLIPHUB.md`).
- v1 audience is Eric on BEAAA only — single private install; no Clipmart submission needed (per Decision #7 / PROJECT.md "Out of Scope").
- A `.npmignore` is unnecessary; the `files` field above covers it.
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
## Installation
# Plugin runtime SDK (the only dep we need to take from Paperclip)
# Build and type tooling
# (Optional) shadcn — to author plugin-local components matching host style
# then `pnpm dlx shadcn@latest add button card …` etc.
# (Phase 1+) host-side install onto a running Paperclip instance, after `npm publish`
## Alternatives Considered
| Recommended | Alternative | When Alternative Makes Sense |
|---|---|---|
| esbuild for both worker and UI bundles | rollup (also supported by SDK presets) | Only if we end up with a code-splitting requirement esbuild can't satisfy. We don't. |
| Plain SQL files for migrations | Drizzle Kit migrations / migrations as JS | Would let us share a single Drizzle schema with the host — but the plugin runtime runs raw SQL, so the JS pathway is moot, and Drizzle Kit's metadata would be ignored. The right pattern is: author SQL by hand or use Drizzle Kit only as a *generator* feeding raw `.sql` into `migrations/`. |
| Managed agent (`agents[]` + `routines[]`) | Long-running worker loop using `setInterval` in `setup()` | Would violate governance parity (coexistence guarantee #4): no audit trail, no pause/terminate, no budget cap visibility. Use cases for the alternative are nil for Clarity Pack. |
| MCP server as an out-of-process child of the agent adapter | Direct REST calls from worker via `ctx.http.fetch` | We can do this for *our own* worker bookkeeping (e.g. computing the situation snapshot), but the Editor-Agent itself should consume MCP — that's the cleanest path to swap LLM adapters later. |
| `paperclipai plugin install` | Vendored installation (drop folder into a host plugins dir) | Only viable while `paperclipai plugin install` does not yet support local-tarball install paths — quick verification needed in Phase 1. If `pack && install ./tgz` works, prefer it for our local dev loop. |
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
## Stack Patterns by Variant
- Configure via `instanceConfigSchema` with a `secretRefExample`-style string field.
- Add `secrets.read-ref` capability.
- Resolve via `ctx.secrets.resolve(secretRef)` in the worker; pass the resolved value to the adapter config or to MCP server env.
- Add `events.subscribe` capability.
- `ctx.events.on("issue.created", handler)` inside `setup`.
- Use `paperclip-plugin-dev-server` (the bin in `@paperclipai/plugin-sdk`).
- Confidence MEDIUM that this works against an external plugin — Phase 1 should pilot it. The kitchen-sink targets workspace-internal dev.
- The PLUGIN_SPEC.md §8.2 strings are the contract. CLIPHUB.md uses `paperclipai install cliphub:<…>` for company templates — different surface. Verify by running `pnpm paperclipai plugin --help` against a fresh clone in Phase 1.
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
- Upstream Drizzle is at `0.45.x` and a `1.0.0-beta` is in flight. Paperclip pins `0.38.x`. **We must not chase upstream; track host.** When host bumps Drizzle, retest our migrations.
- Tailwind v4 stable is `4.2.x` upstream; host pins `4.0.7`. We inherit the host's pin transparently because we don't ship Tailwind ourselves.
- React 19 + radix-ui 1.4 + shadcn "new-york" is the current host triad. shadcn primitives we install for plugin-local components must come from a `shadcn` CLI version that emits radix-ui 1.4-compatible code (any current shadcn does).
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

- **Sketch findings for clarity-pack** (design decisions, CSS patterns, visual direction from sketch experiments) → `Skill("sketch-findings-clarity-pack")`
<!-- GSD:skills-end -->

<!-- GSD:session-continuity-start source:GSD defaults -->
## Session Continuity

If `.planning/HANDOFF.json` exists at the start of a session, a previous session was interrupted (for example by `/compact` or `/gsd:pause-work`) and its state is captured there.

Run `/gsd:resume-work` immediately — before anything else, without waiting for user input. The resume skill will restore context, show project status, and clean up the handoff file.

This instruction is a backup path. When the SessionStart hook fires it emits the same directive via systemMessage; either trigger is sufficient.
<!-- GSD:session-continuity-end -->

## MemPalace Memory Protocol

This project has memories in MemPalace under the `clarity_pack` wing (rooms: `runbook`, `decisions`, `research`, `scripts`, `sketches`, `general`, `diary`). Source-of-truth project documents (PLAN.md / SUMMARY.md / REHEARSAL.md / ROADMAP.md / STATE.md / HANDOFF.json) are auto-mined into MemPalace by `/mempalace:onboard`.

**Before responding about past project events, decisions, defects, drill outcomes, or operator gotchas, query MemPalace first** — `mempalace_search` (wing=`clarity_pack`) or `mempalace_kg_query`. Never guess from training context. Wrong is worse than slow.

**At end of substantive work** (decisions made, defects surfaced, lessons learned, drills run), file new drawers via `mempalace_add_drawer` with `wing=clarity_pack` and the appropriate room. Hook setting `silent_save=true` means saves don't clutter conversation output.

Useful queries:
- Past drill outcomes → `mempalace_search query="rehearsal drill PASS verdict" wing="clarity_pack" room="decisions"`
- Operator gotchas → `mempalace_search query="safety CLI gotcha runbook" wing="clarity_pack" room="runbook"`
- Phase decisions → `mempalace_search query="phase 1 closure" wing="clarity_pack"`
<!-- MemPalace:protocol-end -->

## MemPalace — Operational Rules

> Full usage guide: [docs/MEMPALACE-USAGE.md](docs/MEMPALACE-USAGE.md). Repair/operator runbook: `~/.mempalace/MEMPALACE-RUNBOOK.md`.

- **Filing hygiene:** `mempalace_check_duplicate` before every `add_drawer`; file verbatim into the right wing/room; **never store secret values** — only facts about them (where it lives, how to rotate).
- **KG hygiene:** when a fact changes, `mempalace_kg_invalidate` the old one then `mempalace_kg_add` the new — supersede, don't just file a contradiction; keep KG objects short (< ~128 chars).
- **Multi-window safety:** safe on MemPalace **≥ 3.3.6** (automatic cross-process write lock). Keep every window/agent on 3.3.6 (`mempalace --version`) and on the `minilm` (384-dim) embedding model; **only ever write through MemPalace** — never a raw `chromadb`/SQLite client (bypasses the lock).
- **If MemPalace looks broken** (`vector_disabled`, scoped search `Error finding id`, "malformed inverted index"): run `mempalace repair-status` (read-only) + `mempalace_reconnect`, fall back to unscoped/BM25 search, and **escalate to Eric — do NOT self-repair.** Rebuilds have segfault + quarantine traps; the rehearsed procedure lives in the runbook.

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
