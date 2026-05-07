# Clarity Pack — Decisions Locked Before /gsd:new-project

These were established in the planning conversation that preceded this project. Paste relevant items into `/gsd:new-project` when it asks for project context.

## What it is

A **Paperclip plugin** named `clarity-pack` that adds four user-facing surfaces and one Compiler-Agent on top of an unmodified Paperclip install:

1. **Task Detail "Reader view"** — inline reference resolution, plain-English TL;DR, deliverable preview inline, goal ancestry breadcrumb, acceptance criteria auto-status.
2. **Situation Room** — live cockpit showing every agent's current state, plain-English blockers, transitively-resolved blocker chains ending in a single human action, artifact shelf.
3. **Daily Bulletin** — auto-compiled morning editorial digest of yesterday's operations + today's awaiting-you items.
4. **Employee Chat** — hybrid real-time UI where messages persist as comments on per-topic private issues; attachments stored as work-products.

Plus: **Compiler-Agent** — a heartbeat-driven Paperclip employee that compiles the TL;DRs, critical-path narratives, and bulletins.

## Why it exists

Paperclip's roadmap explicitly lists these as ⚪ unbuilt: **Artifacts & Work Products**, **Enforced Outcomes**, **Deep Planning**, **CEO Chat**, **Memory / Knowledge**. Eric uses Paperclip on the BEAAA insurance project today and finds the existing UI causes a "rabbit hole" of clicking through unresolved task references; deliverable storage is unclear; per-employee "where are they / what are they stuck on" is missing. Clarity Pack closes those gaps without forking Paperclip.

## Decisions locked in conversation (before /gsd:new-project)

| # | Decision | Source |
|---|---|---|
| 1 | Chat model = **hybrid** (real-time UI, durable as issue comments + work-product attachments) | AskUserQuestion |
| 2 | Compile cadence = **scheduled (06:30 daily Bulletin) + on-view recompute every 60s in Situation Room** | AskUserQuestion |
| 3 | MVP / Phase 1 scope = **Task Detail Reader view + Situation Room + Compiler-Agent skeleton**; Bulletin = Phase 2; Chat = Phase 3 | AskUserQuestion |
| 4 | Chat history UX = **per-employee linear timeline + global search** | AskUserQuestion |
| 5 | Default landing = **Paperclip classic dashboard** (clarity views are opt-in clicks, not overrides) | AskUserQuestion |
| 6 | Compiler-Agent governance = **standard agent rules** (same budget caps, pause/terminate, audit log as any employee) | AskUserQuestion |

## Coexistence guarantees (non-functional, all testable)

These are hard requirements and must appear in SPEC.md for Phase 1:

1. **Per-user opt-in** via profile toggle; default OFF for existing users.
2. **Original UI never replaced**; Reader view is an additional tab on issue pages, not a replacement.
3. **Schema is additive-only**; plugin disable leaves data intact.
4. **Compiler-Agent is a regular org-chart hire** (no special privileges).
5. **Chat messages render as ordinary threaded comments** in the classic Paperclip UI.
6. **Clean uninstall preserves data**; `--purge` flag is opt-in only.

## Stack assumptions (need verification against PLUGIN_SPEC.md)

- TypeScript plugin, React + shadcn UI contributions (matches `ui/components.json` in paperclipai/paperclip)
- Distribution: npm package + `paperclipai plugin install clarity-pack` (or via Clipmart when shipped)
- MCP server package used by Compiler-Agent for issue/activity reads
- Postgres migrations are additive

## Plugin spec confirmed (partial read of doc/plugins/PLUGIN_SPEC.md)

- Plugin runtime + admin UI exist today in Paperclip (early implementation)
- Today's deployment model: single-tenant, self-hosted, single-node, filesystem-persistent
- **Plugin UI bundles run as same-origin JavaScript inside the main Paperclip app — treated as trusted code, not sandboxed.** Manifest capabilities gate worker-side host RPC calls but do NOT prevent plugin UI code from calling Paperclip HTTP APIs directly.
- Runtime installs assume writable local filesystem + npm available + reachable package registry
- Published npm packages are the intended install artifact
- Example plugins live under `packages/plugins/examples/`

**Action item:** Re-read full PLUGIN_SPEC.md (was 64KB, persisted) before SPEC.md is finalized for Phase 1, to surface any constraints we missed.

## Reference repo and docs

- Source repo: https://github.com/paperclipai/paperclip
- Plugin spec: https://github.com/paperclipai/paperclip/blob/main/doc/plugins/PLUGIN_SPEC.md
- Related: `doc/SPEC.md`, `doc/SPEC-implementation.md`, `doc/PRODUCT.md`, `doc/CLI.md`, `doc/DATABASE.md`, `doc/CLIPHUB.md`, `doc/execution-semantics.md`, `doc/memory-landscape.md`

## Existing artifacts in this project

The four mockups in `sketches/` are non-throwaway. They define the visual contract and information architecture for each surface:

- `paperclip-fix-task-detail.html` — Reader view of a task (Phase 1)
- `paperclip-fix-situation-room.html` — Live ops cockpit (Phase 1)
- `paperclip-fix-bulletin.html` — Editorial daily bulletin (Phase 2)
- `paperclip-fix-employee-chat.html` — Hybrid chat surface (Phase 3)

## Suggested initial roadmap (rough)

| Phase | Name | Goal | Surfaces |
|---|---|---|---|
| 1 | Plugin scaffold + Reader view + Situation Room | Plugin installs cleanly; Reader-view tab on issue pages; Situation Room route renders live agent state | Task Detail, Situation Room, Compiler-Agent skeleton |
| 2 | Daily Bulletin | 06:30 ET morning compile produces editorial digest | Bulletin |
| 3 | Employee Chat | Hybrid real-time UI persisting as issue comments | Chat |
| 4 | Polish + Clipmart distribution | Per-user opt-in toggle, settings, npm publish, Clipmart submission | Cross-cutting |

These are starting points for `/gsd:new-project` to refine.
