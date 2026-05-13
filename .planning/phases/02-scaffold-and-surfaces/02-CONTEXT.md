# Phase 2: Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In — Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Installable clarity-pack plugin where an opted-in user:

1. Opens any issue page and sees an additional **Reader view** tab (classic tabs unchanged) with TL;DR strip, inline `BEAAA-NNN` reference chips (one round-trip), goal-ancestry breadcrumb, manual acceptance-criteria checklist, activity timeline, and right-rail "Live blocker — on you" panel with single-step typed terminal (`HUMAN_ACTION_ON(user)` / `SELF_RESOLVING` / `EXTERNAL` / `CYCLE`).
2. Navigates to the **Situation Room** route and sees one card per Paperclip employee (state pill + age + plain-English "now-doing" + transitively-flattened blocker chain + latest-artifact preview + 7-day velocity sparkline), plus a Critical Path strip (up to three chains) and an "Artifacts shipped today" shelf — served from a worker-materialized 60s snapshot with visibility-pause and one-leader election.
3. Watches the **Editor-Agent** run as a standard Paperclip employee (declared in `agents[]`, reconciled per-company), inheriting Paperclip's heartbeat / budget caps / pause-terminate / audit log automatically.
4. Toggles **opt-in** via a profile setting (default OFF; `clarity_user_prefs` row absent = OFF; CTA on every Clarity surface when opted out).

All hardened against the same-origin trust model from day 1: bridge-only host RPC, ESLint banning raw `fetch` in UI bundle, CSS scoped to `[data-clarity-surface]`, pinned lockfile, zero postinstall scripts.

Scope anchor: Phase 2 ships the Reader view and Situation Room **only**. The Daily Bulletin (Phase 3) and Employee Chat (Phase 4) reuse these primitives but are out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Three SPEC conflicts (blocking — verified empirically by Plan 02-01 smoke spike)

- **D-01:** Reader view slot identity = `detailTab` + `entityTypes: ["issue"]`. Default per PLUGIN_SPEC §10.1 and validated by kitchen-sink example. Coexistence guarantee #2 (classic tabs unchanged) satisfied. **Verification gate:** Plan 02-01 must render the additional-tab UX against a fresh local Paperclip clone before this is locked. If smoke shows `detailTab` does not produce the additional-tab UX on issues, switch to `taskDetailView` and re-verify.
- **D-02:** Migrations approach = `database.migrationsDir` + plugin namespace. Plain SQL in `migrations/0001_*.sql`, scoped to `ctx.db.namespace`. Satisfies coexistence #3 (additive-only — cannot mutate `public.*`) and #6 (clean uninstall preserves data). PLUGIN_AUTHORING_GUIDE + working SDK code are authoritative over PLUGIN_SPEC §21.5's "out of scope" wording. **Verification gate:** Plan 02-01 ships a minimal `001_init.sql` (single `clarity_user_prefs` table) and confirms it applies cleanly via `paperclipai plugin install`.
- **D-03:** Situation Room refresh cadence = 60s default, configurable via `instanceConfigSchema`. Matches PROJECT.md Decision #6. Worker job runs only when "active viewers" > 0 (UI sets the flag in plugin state). Mockup's 30s deferred; Eric can tune via instance config without recompile if 60s feels stale during BEAAA dogfood.

### Editor-Agent skeleton boundaries

- **D-04:** Self-loop filter = belt-and-suspenders. Editor-Agent reads heartbeat context, drops any activity row where (a) `author_id == editor_agent_id` AND/OR (b) the row carries the `clarity:editor-write` tag. Both checks; either match excludes the row from the LLM input. Verified by integration test: agent writes TL;DR, next heartbeat does not re-trigger compile.
- **D-05:** `max_tokens` hard cap per LLM call = **4000 placeholder for v1** (Claude's discretion). Instrument actual usage during Phase 2 dogfood (P50/P95 token counts logged per compile). Lock the final value before Phase 3 (Bulletin compile may need higher; surfaces in Phase 2 should not). Cap is enforced before every LLM call, not just on output.
- **D-06:** Circuit breaker = `ctx.agents.pause()` after **3 consecutive failures**. No auto-resume, no exponential backoff — human must explicitly click Resume in the classic agent panel. Uses Paperclip's standard pause primitive (governance parity per Decision #3 / coexistence #4 — no special privileges). "Failure" defined as: LLM call threw, OR token cap exceeded, OR output failed schema validation.
- **D-07:** Pause-banner UX = footer on **every Clarity surface** ("Editorial Desk paused — last compile failed at HH:MM. Resume in agent panel.") + standard pause pill on Paperclip's classic agent panel. Editorial Desk naming per Decision #8 (PROJECT.md). Footer is dismissible-per-session but reappears on next page load while paused.

### Plan decomposition (4 plans inside-out)

- **D-08:** **Plan 02-01 — Smoke spike (NO feature code).** Minimal `manifest.ts` + `worker.ts` + `migrations/001_init.sql` (one table: `clarity_user_prefs`) + hello-world `detailTab` contribution. Installed against fresh local Paperclip clone via `pnpm paperclipai plugin install`. Outputs: empirical answers to D-01, D-02, install-command exact form. Wave 1, autonomous. Acceptance bar = (a) plugin installs cleanly, (b) tab renders on an issue page, (c) migration creates table in plugin namespace, (d) plugin disable preserves the table data. Bookended by snapshot/restore per Phase 1 protocol.
- **D-09:** **Plan 02-02 — Scaffold + trust-model hardening + shared primitives.** Trust-model day-1 mitigations (ESLint rule banning raw `fetch`/`XMLHttpRequest` in `src/ui/`, CSS scope convention `[data-clarity-surface]`, lifecycle-aware poll primitive that stops on `WORKER_UNAVAILABLE`) + theme tokens + state pill + ref chip shell + reference resolver (batched via worker handler, no N+1) + blocker chain flattener (deterministic DFS + cycle detection + terminal taxonomy). Wave 2, autonomous. Acceptance bar = primitives ship with unit tests; ESLint catches a deliberate `fetch()` in `src/ui/` test fixture; CSS scope test confirms no bleed-through into host UI.
- **D-10:** **Plan 02-03 — Editor-Agent skeleton + Reader view tab.** Editor-Agent: `agents[]` declaration, reconcile per-company via `ctx.agents.managed.reconcile()`, TL;DR compile with idempotency (deterministic input hash → cached output) + self-loop filter (D-04) + token cap (D-05) + circuit breaker (D-06) + pause banner (D-07). Reader view: TL;DR strip + inline ref chips (using D-09 resolver) + ref-card with quote excerpt + AC manual checklist + activity timeline + breadcrumb + right-rail blocker panel (using D-09 flattener). Wave 3, autonomous. Acceptance bar = TL;DR compiles for a sample issue; Reader tab renders all six elements; pausing Editor-Agent in classic UI halts compile output.
- **D-11:** **Plan 02-04 — Situation Room + opt-in gate + coexistence CI.** Situation Room page: 60s worker-materialized snapshot job + visibility-guard polling + BroadcastChannel leader election (one leader across multiple open tabs) + agent grid + state pills + critical-path strip + artifact shelf. Opt-in gate: `clarity_user_prefs` table extension + `set-opt-in` action + `useOptIn` hook + Enable-Clarity CTA on opted-out surfaces. Coexistence verification CI checklist (COEXIST-06) — six assertions running on every PR: (i) original UI unchanged, (ii) no DDL touches `public.*`, (iii) plugin disable preserves data, (iv) Editor-Agent no special privileges, (v) chat-comment coexistence stub (full check lands Phase 4), (vi) visual-regression detects CSS bleed-through. Wave 4, autonomous. Acceptance bar = all six CI assertions green; one-leader election verified across two browser tabs; opted-out user sees only classic dashboard + CTA.

### Claude's Discretion

- **Day-1 trust-model hardening details** (user did not select for discussion — research recommendations apply):
  - Bridge-only host RPC: all Paperclip API calls go through `ctx.http.fetch` in the worker, never direct from UI bundle.
  - ESLint rule: custom rule `no-raw-fetch-in-ui` bans `fetch`, `XMLHttpRequest`, and `axios` imports in `src/ui/`. UI calls Paperclip only via `usePluginData` / `usePluginAction` bridge.
  - CSS scope: every Clarity-rendered root element gets `data-clarity-surface="<surface-name>"`. All clarity-pack CSS selectors start with `[data-clarity-surface]` — enforced by Stylelint or CI grep.
  - Lockfile discipline: `pnpm-lock.yaml` committed; CI runs `pnpm install --frozen-lockfile`; `pnpm audit` runs on every PR.
  - Postinstall script policy: zero postinstall scripts in our package or transitive deps that execute on install. CI runs `pnpm install --ignore-scripts` and asserts identical install tree.
- **`max_tokens` final value** — instrument during dogfood, lock before Phase 3 (D-05).
- **Loading skeletons, exact spacing, typography choices** within the visual-contract mockup tolerance.
- **TL;DR compile cadence** beyond the self-loop filter — e.g., debounce on rapid issue edits, max compiles per issue per hour.
- **Reader view "Anchored to" quote extraction algorithm** (length cap, ellipsis placement, multi-ref ordering).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Project-level (locked decisions + requirements)

- `.planning/PROJECT.md` — Core value, 10 locked decisions, constraints, coexistence guarantees
- `.planning/REQUIREMENTS.md` — 79 v1 requirements; Phase 2 covers SCAF-01..09, OPTIN-01..05, PRIM-01..06, EDITOR-01..06, READER-01..09, ROOM-01..08, COEXIST-01..04 + COEXIST-06 (48 reqs)
- `.planning/ROADMAP.md` §"Phase 2: Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In" — Goal, success criteria (6), depends-on, requirements list. §"Conflicts to Resolve in Phase 2 SPEC.md" — the three SPEC conflicts (now resolved as D-01..D-03)
- `.planning/STATE.md` — Current progress, locked-decisions log

### Research synthesis

- `.planning/research/SUMMARY.md` — Phase boundaries, build order (10 strict steps), 12-of-18 pitfalls in Phase 2, three Phase-2 conflicts (matches D-01..D-03)
- `.planning/research/ARCHITECTURE.md` — Build order, shared primitives, contribution-point mechanics
- `.planning/research/FEATURES.md` — Table-stakes per surface; MVP definition
- `.planning/research/STACK.md` — Forced stack pins (React 19 peer-only, TS ^5.7.3, esbuild ^0.27.3, Node ≥20, Tailwind v4 inherited from host, shadcn new-york/neutral/lucide)
- `.planning/research/PITFALLS.md` — 18 pitfalls; 12 land in Phase 2 (CSS bleed-through, N+1 ref resolution, blocker chain terminal, polling thundering herd, SPA navigation, idempotent events, plugin lifecycle, postinstall scripts, host React conflict, raw fetch, etc.)

### Phase 1 closure context (drill findings that constrain Phase 2 install behavior)

- `runbook/REHEARSAL.md` — Drill PASS row 2026-05-13 + anomalies block (5 in-session fixes). Operator gotchas relevant to Phase 2 installs:
  - **`paperclip_restoring` Postgres DB pre-create** — operator must `CREATE DATABASE paperclip_restoring OWNER paperclip` manually before `clarity-safety restore` on Postgres-mode Paperclip
  - **Paperclip API drift** — `/api/issues` moved to `/api/companies/{id}/issues` between 2026-05-08 and 2026-05-13; verify endpoints empirically during Plan 02-01 smoke
- `.planning/phases/01-pre-install-safety/01-04-SUMMARY.md` — Plan 01-04 deferreds that affect Phase 2 install testing
- `scripts/safety/` — Safety CLI (`clarity-safety snapshot|restore|smoke|verify|gate`) MUST bookend every Phase 2 install/migration against BEAAA (Phase 1 protocol still in force)

### Visual contract (non-throwaway design ground truth)

- `sketches/paperclip-fix-task-detail.html` — Reader view layout (TL;DR strip, ref chips, breadcrumb, AC checklist, activity timeline, right-rail blocker panel). Plan 02-03 must match.
- `sketches/paperclip-fix-situation-room.html` — Situation Room layout (agent grid, state pills, critical-path strip, artifact shelf, Editorial Desk footer). Plan 02-04 must match.
- `sketches/paperclip-fix-bulletin.html` — Bulletin layout (Phase 3 scope, but Editor-Agent persona attribution carries through from Phase 2)
- `sketches/paperclip-fix-employee-chat.html` — Chat layout (Phase 4 scope, but per-issue persistence pattern informs `clarity_user_prefs` design)

### Paperclip host docs (external — fetch from `paperclipai/paperclip` `master` branch)

- `doc/plugins/PLUGIN_SPEC.md` §10 — Manifest slot types (`detailTab`, `page`, `settingsPage`); §11 — capabilities; §12 — process model (worker as Node child over JSON-RPC stdio); §15.2 — forbidden capabilities (no direct DB access); §16 — host events (`issue.created`, `issue.updated`, `issue.comment.created`); §17 — cron/routines; §19 — trust model caveats (UI = same-origin trusted JS); §21.5 — migrations clause (CONFLICTING — see PLUGIN_AUTHORING_GUIDE.md; D-02 resolved in favor of guide)
- `doc/plugins/PLUGIN_AUTHORING_GUIDE.md` — `agents[]` declaration, `ctx.agents.managed.reconcile()`, `database.migrationsDir` + plugin namespace mechanics, `ctx.db.query()` / `ctx.db.execute()`, `instanceConfigSchema`
- `doc/DATABASE.md` — Postgres 17, Drizzle 0.38.4, plugin namespace tracking tables
- `packages/plugins/examples/plugin-kitchen-sink-example/` — Verbatim manifest + worker + `build-ui.mjs` + `tsconfig.json` reference patterns
- `packages/mcp-server/` — `@paperclipai/mcp-server@^0.1.0` for Editor-Agent reads (not used in Plan 02-01 smoke; lands in Plan 02-03)
- **Branch note:** Paperclip default branch is `master`, not `main`. All `/blob/master/...` URLs (PROJECT.md Decision #9).

### Hostinger pre-flight (operator state — re-verify start of each session)

- Hostinger KVM4 at 82.29.197.74, `countermoves.gl3group.com`. Paperclip running. Caddy `header_up Host 127.0.0.1` fix was reverted 2026-05-11 — **re-verify Caddyfile state at start of every Hostinger session** before any Phase 2 install attempt.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Safety CLI (`scripts/safety/`)** — `clarity-safety` ships from Phase 1: snapshot, restore, smoke, verify, gate, list, prune. Every Phase 2 install/migration against BEAAA MUST be bookended by `clarity-safety snapshot` + verify. Gate refuses any action if most recent snapshot is older than 15 minutes or its restore-and-smoke has not passed. No code changes to safety CLI in Phase 2; new feature code coexists alongside.
- **Stub Paperclip server (`scripts/safety/test/fixtures/stub-paperclip-server.mjs`)** — Used by Phase 1 smoke tests; can be reused by Plan 02-01 smoke spike's local install test if Paperclip clone isn't on hand.
- **Rehearsal drill walkthrough (`runbook/rehearsal-drill.md`)** — 15-step procedure; Plan 02-01 install spike should add a "Phase 2 install rehearsal" parallel to this (snapshot → install → smoke → uninstall preserves data).

### Established Patterns

- **Plain ESM, Node ≥20, no bundling for `scripts/safety/`** — direct `.mjs` modules. Plan 02-01..02-04 will introduce TypeScript + esbuild bundling for the plugin proper (`src/manifest.ts`, `src/worker.ts`, `src/ui/`), but `scripts/safety/` stays untyped ESM.
- **Test framework: `node --test`** — Phase 1 used native node test runner with 103 passing tests across 3 plans. Phase 2 should continue this pattern; no Jest/Vitest unless a specific need arises.
- **Atomic commits per task** — every Phase 1 plan committed in RED → GREEN → docs cycles (e.g., `8eb37bd RED`, `04c3412 GREEN`, `d73485a runbook`). Phase 2 plans should follow the same discipline.
- **`.planning/` is the source of truth** — PROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md / per-phase artifacts. PR branches strip `.planning/` commits via `/gsd:pr-branch`.

### Integration Points

- **Paperclip host** — Phase 2 code first touches Paperclip during Plan 02-01 (`paperclipai plugin install` against local clone). No code touches BEAAA until coexistence checklist green + safety drill rehearsed for Phase-2 install path specifically.
- **Plugin entrypoints (NEW for Phase 2)** — `src/manifest.ts` (PaperclipPluginManifestV1), `src/worker.ts` (`definePlugin` + `runWorker(plugin, import.meta.url)`), `src/ui/` (React components externalizing `react`/`react-dom`/`react/jsx-runtime`/`@paperclipai/plugin-sdk/ui`/`@paperclipai/plugin-sdk/ui/hooks`).
- **Database integration point** — `ctx.db.query()` (SELECT-only against `public.*` read-whitelist) + `ctx.db.execute()` (DML inside plugin namespace). NO direct `pg` / `postgres` driver usage (forbidden per PLUGIN_SPEC §15.2).
- **Editor-Agent integration point** — `agents[]` manifest entry + `ctx.agents.managed.reconcile()` per company. Reads via `@paperclipai/mcp-server` MCP tools (`paperclipGetHeartbeatContext`, `paperclipListIssues`, `paperclipListComments`, `paperclipListDocuments`).
- **CI integration point** — coexistence checklist (Plan 02-04) runs via GitHub Actions on every PR. Pre-existing `.github/` directory state should be checked in Plan 02-04 spike before adding workflows.

</code_context>

<specifics>
## Specific Ideas

- **"Editorial Desk" voice throughout.** Editor-Agent has a named persona ("Editor-Agent" / Editorial Desk) per Decision #8 (PROJECT.md). All TL;DRs, critical-path narratives, and bulletins attribute to "Editorial Desk" in the footer. Surface 2 footer's prior "Compiled by Compiler-Agent" is already renamed to match in the mockups.
- **Belt-and-suspenders self-loop filter (D-04).** Author-id check is sufficient for v1 (single agent), but adding the tag now means Phase 4's chat-agent (and any future agent) inherits the pattern. ~10 LOC, no real downside.
- **Smoke spike is a code-light contract test.** Plan 02-01 is intentionally tiny — its job is to falsify (or confirm) the three SPEC conflict recommendations against a real Paperclip clone before scaffold + primitives + features are written on top.
- **Pause banner = footer everywhere, not modal.** "Editorial Desk paused" should feel like an editorial sidebar note, not a system error. The mockups already have surface footers; reuse that affordance.
- **Coexistence CI runs from Plan 02-04 forward** — not from day 1. Earlier checks would be NO-OP stubs. Single setup cost, then Phase 3/4/5 extend the checklist as new surfaces ship.

</specifics>

<deferred>
## Deferred Ideas

- **Day-1 trust-model hardening — interactive discussion of details.** User opted not to discuss; Claude's Discretion applies with research-recommended defaults (ESLint rule, CSS scope, pinned lockfile, no postinstall). If actual implementation surfaces ambiguity, surface to user in Plan 02-02 execution.
- **Reader view UX details beyond the mockups** — e.g., TL;DR cadence per issue, AC checklist drag-to-reorder, blocker terminal click-to-resolve. Phase 2 ships the mockup-matching UX; refinements land in Phase 5 polish or v1.x.
- **Situation Room leader-election failure modes** — what happens when BroadcastChannel is unavailable (older Safari, some embedded contexts). Plan 02-04 should detect and fall back to per-tab polling with a warning; deeper UX deferred.
- **Opt-in CTA placement variants** — single CTA per surface, or top-bar global, or first-time-user onboarding banner. Mockups imply per-surface inline CTA; user can refine after Phase 2 dogfood.
- **`paperclip_restoring` DB auto-create in `restore.mjs`** — Phase 1 deferred; documented manual `psql` step lives in runbook. v2 work, not Phase 2.
- **Smoke spike → REHEARSAL.md cross-link** — Plan 02-01 should add a "Phase 2 install rehearsal" entry to `runbook/REHEARSAL.md` to maintain the same operator audit trail Phase 1 established. Note for Plan 02-01 author.
- **AC auto-status promotion** — Phase 5 work per ROADMAP.md. v1 ships manual checklist per D-10/Plan 02-03.
- **Full-fidelity previewers (xlsx/pdf/md/png)** — Phase 5 work per ROADMAP.md. Phase 2 Reader view's "The deliverable" section ships a placeholder per the mockup.

</deferred>

---

*Phase: 02-scaffold-and-surfaces*
*Context gathered: 2026-05-13*
