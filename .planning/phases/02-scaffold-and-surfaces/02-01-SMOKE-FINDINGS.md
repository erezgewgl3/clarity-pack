# Plan 02-01 Smoke Findings

**Date:** 2026-05-13 (Checks A/E/F complete; Checks B/C/D + snapshot bookend in progress against local Windows clone)
**Paperclip clone commit:** `b947a7d76c331b3ce4069d3be0ade25cc89b1b90` ("[codex] Improve local plugin development workflow (#5821)")
**Paperclip clone path:** `C:\Users\erezg\Documents\paperclip-smoke-clone` (Windows 11 local dev box; NOT BEAAA, NOT Hostinger Countermoves)
**Operator:** Eric

## Install Command Form

- **Result: CONFIRMED** — install command is `paperclipai plugin install <package>` (per Paperclip CLI help text against b947a7d7).
- **Help text from `pnpm paperclipai plugin --help` (verbatim):**
  ```
  Usage: paperclipai plugin [options] [command]
  Plugin lifecycle management

  Commands:
    init [options] <packageName>     Scaffold a local Paperclip plugin project
    list [options]                   List installed plugins
    install [options] <package>      Install a plugin from a local path or npm package.
      Examples:
        paperclipai plugin install ./my-plugin              # local path
        paperclipai plugin install @acme/plugin-linear      # npm package
        paperclipai plugin install @acme/plugin-linear@1.2  # pinned version
    uninstall [options] <pluginKey>  Uninstall a plugin by its plugin key or database ID.
      Use --force to hard-purge all state and config.
    enable [options] <pluginKey>     Enable a disabled or errored plugin
    disable [options] <pluginKey>    Disable a running plugin without uninstalling it
    inspect [options] <pluginKey>    Show full details for an installed plugin
    examples [options]               List bundled example plugins available for local install
  ```
- **Local-tarball/path install support: YES** (directory install is an officially-documented mode — `paperclipai plugin install ./my-plugin`). Whether a `.tgz` file path also resolves is a follow-up empirical check at install time; the directory form is the canonical path and what this spike will use.
- **Exact install command used:** `pnpm paperclipai plugin install "C:/Users/erezg/Documents/Claude/Projects/Clarity Pack"` (pending — Step 5 of spike).
- **Bonus findings from help text:**
  - `paperclipai plugin disable <pluginKey>` is a CLI command — Check D can use this directly instead of relying on a classic admin UI gesture.
  - `paperclipai plugin uninstall --force` is the hard-purge path; supports `coexistence guarantee #6` (`--purge` flag is opt-in).
  - `paperclipai plugin init` and `examples` ship with the host CLI; recently improved in PR #5821 (latest commit on `master` at clone time).

## D-01 Slot Identity

- **Result: DEFERRED — Windows-host plugin loader bug (finding #5) blocks worker boot, which blocks visual tab render verification on this clone.** Plugin installed to `status=error` (not `ready`), so the host never mounted the React component into a real issue page. To close this empirically, re-run install from a Linux host (WSL, Linux VPS, or BEAAA itself with snapshot bookend).
- **Architectural confidence: HIGH** that `detailTab + entityTypes: ['issue']` is canonical. Evidence:
  - [`plugin-kitchen-sink-example/src/manifest.ts:230-234`](../../../../paperclip-smoke-clone/packages/plugins/examples/plugin-kitchen-sink-example/src/manifest.ts) registers exactly this shape: `type: "detailTab"` + `entityTypes: ["issue"]` + `ui.detailTab.register` capability.
  - Same example also registers `taskDetailView` for issue (lines 237-241) — both slot types are valid for `entityTypes: ["issue"]`; they differ in visual placement and lifecycle, NOT in compatibility. The original concern from the plan ("if detailTab doesn't render → switch to taskDetailView") is now structurally less likely because the kitchen-sink itself uses `detailTab`.
- **Action for Plan 02-02 manifest (cascade):** PROCEED with `detailTab + entityTypes: ['issue']` per Task 1's existing manifest. If a future Linux re-spike falsifies it, the cascade is a single-field edit; the migration namespace and other contracts hold regardless.
- **Classic tabs still present:** Not visually verified (worker boot blocked). Architecturally, slots are additive — host never replaces classic tabs (per `PLUGIN_SPEC.md` §19). Coexistence #2 contract held by spec, not yet by observation.

## D-02 Migrations Approach

- **Result: CONFIRMED — but with a critical authoring-pattern correction (see below).**
- **Observed schema name: `plugin_clarity_pack_cdd6bda4bd`** (computed deterministically from manifest `id="clarity-pack"` per [`paperclip/server/src/services/plugin-database.ts:28-41`](https://github.com/paperclipai/paperclip/blob/b947a7d7/server/src/services/plugin-database.ts#L28-L41): `slug = "clarity_pack"`, `hash10 = sha256("clarity-pack").slice(0,10) = "cdd6bda4bd"`, `namespace = "plugin_clarity_pack_cdd6bda4bd"`).
- **public.* diff before vs after install: 0 changes** (86 tables before, 86 tables after, `diff` exit 0). Empirical evidence:
  ```
  $ psql "postgresql://paperclip@127.0.0.1:54329/paperclip" -c "..."
  ----
   plugin_clarity_pack_cdd6bda4bd | clarity_user_prefs
  (1 row)
  ```
- **CRITICAL AUTHORING-PATTERN CORRECTION (cascade target for Plans 02-02/02-03/02-04):**
  - The plan's original design ("Write plain SQL migrations with unqualified table names; host scopes them to plugin namespace") **was FALSIFIED empirically**. Host installer rejected the unqualified migration with HTTP 400: `Plugin migration objects must use fully qualified schema names`.
  - The validator at [`plugin-database.ts:187-203`](https://github.com/paperclipai/paperclip/blob/b947a7d7/server/src/services/plugin-database.ts#L187-L203) requires every DDL statement to use `schema.table` form with the exact pre-computed namespace name. There is NO host-side template substitution.
  - **Required pattern for ALL plugin migrations:** plugin author computes the deterministic namespace at SQL-authoring time and bakes it into the SQL literal. For clarity-pack that is `plugin_clarity_pack_cdd6bda4bd`. If the manifest `id` ever changes, the namespace changes and every migration must be regenerated.
  - **Exception: `COMMENT ON ...` statements may remain unqualified** per validator logic (`!normalized.startsWith("comment ")`).
  - Plan 02-02 must include a build-time check (script or test) that the migration SQL's schema name matches `derivePluginDatabaseNamespace(manifest.id)`. Otherwise a manifest rename silently breaks installs.
- **Bonus finding (install state on Windows after worker-boot failure):** the host applies plugin migrations BEFORE attempting to boot the worker process. So even though our worker boot failed (finding #5), the migration ran cleanly and is recorded in `pluginMigrations` (host table). This means Check C is empirically valid evidence — the migration genuinely passed validation and executed.

## COEXIST-03 Plugin Disable Preserves Data

- **Result: CONFIRMED architecturally + partial empirical.** Full empirical disable-flow run deferred to Linux re-spike.
- **Empirical partial:** fixture row `(user_id='smoke-test-user', opted_in_at=now())` inserted into `plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs` and round-trip read succeeds (1 row returned). Data ownership by plugin namespace is real.
- **Empirical blocker:** `pnpm paperclipai plugin disable clarity-pack` returned HTTP 400: `Cannot disable plugin in status 'error'. Plugin must be in 'ready' status to be disabled.` The Windows ESM bug (finding #5) traps the plugin in `error` state, so we cannot run the disable transition. Re-attempt requires `ready` status, which requires a working worker, which requires a Linux host.
- **Architectural confirmation (from reading [`paperclip/server/src/services/plugin-lifecycle.ts`](https://github.com/paperclipai/paperclip/blob/b947a7d7/server/src/services/plugin-lifecycle.ts) and grep across `server/src/`):**
  - State machine documents: `ready → disabled` (operator disables), `disabled → ready` (operator re-enables), `disabled → uninstalled` (uninstall while disabled). Disable is reversible.
  - **No `DROP SCHEMA`, `DROP TABLE`, or `TRUNCATE` is invoked on plugin namespaces during disable/uninstall.** Only references to `DROP SCHEMA` in the entire `server/src/` tree are in `__tests__/plugin-database.test.ts:100` (test cleanup helper) — production code does NOT drop plugin namespaces on disable.
  - Only `--force` purge (per Check A help text: `paperclipai plugin uninstall --force … to hard-purge all state and config`) is positioned as the destructive path. Default uninstall semantics preserve data.
- **Action for Linux re-spike:** after worker boots cleanly, transition plugin to `ready`, run `paperclipai plugin disable clarity-pack`, re-query the fixture row, re-enable, re-query. Expected: row persists across both transitions. Architectural review strongly supports this expectation.

## D-08(f) Postinstall Audit

- **Result: CONFIRMED — no postinstall scripts fire under default pnpm 9.x policy.**
- `--ignore-scripts` vs default install tree diff: **empty** (44 lines, byte-identical).
- Lifecycle-script audit across full transitive tree (10 packages installed): **1 of 10** packages declares a `postinstall` script — `esbuild@0.27.7` (`node install.js`).
- esbuild's `install.js` is a legacy fallback that no longer executes under modern pnpm: pnpm 9.x default-deny policy requires `pnpm.onlyBuiltDependencies` allowlisting; our `package.json` declares no such allowlist, no global `~/.npmrc` overrides, and `pnpm install` output emits no "Running script" log line.
- Platform binary (`esbuild.exe`) is delivered via the **optional dependency** `@esbuild/win32-x64@0.27.7` (pure package extraction, no scripts) — confirmed present at `node_modules/.pnpm/@esbuild+win32-x64@0.27.7/node_modules/@esbuild/win32-x64/esbuild.exe`. The `bin`/`lib` dirs inside the main `esbuild` package were created by pnpm extraction, not by `install.js` execution.
- **Evidence:** `/tmp/postinstall-audit/` (fresh-checkout reproduction); `tree-noscripts.txt` and `tree-withscripts.txt` (44 lines each, `diff` exit 0); grep for `"(postinstall|preinstall)":` across all package.json files in the transitive tree returned exactly 1 match (esbuild).

## useInstanceConfig SDK Import Path

- **Result: FALLBACK REQUIRED — implement local wrapper in Plan 02-04.**
- **Evidence:** Read `node_modules/@paperclipai/plugin-sdk/dist/ui/hooks.d.ts` verbatim against pinned SDK version `2026.512.0`. Exported hooks are exactly: `usePluginData`, `usePluginAction`, `useHostContext`, `useHostNavigation`, `useHostLocation`, `usePluginStream`, `usePluginToast`. **No `useInstanceConfig` export at any subpath** (verified `@paperclipai/plugin-sdk/ui/hooks`, `@paperclipai/plugin-sdk/ui`, `@paperclipai/plugin-sdk` index — also grepped the entire installed `dist/` directory: zero references to `useInstanceConfig` in any UI-side artifact).
- The SDK exposes `PluginConfigClient.get(): Promise<Record<string, unknown>>` ([types.d.ts:219-226](../../../node_modules/@paperclipai/plugin-sdk/dist/types.d.ts)) — but only on the **worker context** as `ctx.config.get()`. UI code cannot reach it directly; it must round-trip through the bridge.
- **Action for 02-04:** Implement the local wrapper as described in Plan 02-04 Task 2 step 7 fallback path:
  1. Worker registers `ctx.data.register('clarity-pack/get-instance-config', async () => ctx.config.get())` (or an equivalent typed handler).
  2. UI primitive `src/ui/primitives/use-instance-config.ts` exports `useInstanceConfig()` as a thin wrapper around `usePluginData<{situationRefreshIntervalMs: number}>('clarity-pack/get-instance-config')`.
  3. Add the wrapper to Plan 02-02's primitives set (or note as 02-04-local if cleaner) — there is no reason to defer it to its consumer; it belongs with the other primitives.
- Decision lock: 02-04 SituationRoom MUST use the local wrapper. Do NOT add a direct `import { useInstanceConfig } from '@paperclipai/plugin-sdk/ui/hooks'` — it will fail at build time (esbuild externalization) and runtime (host bridge does not expose it).

## Pitfalls / Surprises

Autonomous-phase surprises:
- The plan's research notes ([STACK.md] cheatsheet line "useInstanceConfig from `@paperclipai/plugin-sdk/ui/hooks`") was speculative — the hook does not exist in the published SDK at `2026.512.0`. Documenting here so the same speculation does not migrate into 02-04.
- esbuild's vestigial `install.js` postinstall could be a false positive in naive supply-chain audits ("dependency declares postinstall = bad"). The real protection is pnpm 9.x default-deny + the platform-binary-via-optionalDeps mechanism. Worth noting in the Phase 2 trust-model writeup (02-02 hardening task).

Local-dev surprises (Paperclip clone `b947a7d7` on Windows 11):
- `pnpm install` against the Paperclip workspace emits 8 `Failed to create bin at … paperclip-plugin-dev-server. ENOENT: …\dev-cli.js.EXE` warnings on Windows. Root cause: pnpm tries to create `.EXE` shims for example plugins' `paperclip-plugin-dev-server` bin, but the SDK's `dist/dev-cli.js` doesn't exist until `pnpm -F @paperclipai/plugin-sdk build` (or root `pnpm build`) has run. Warnings resolve themselves after `pnpm dev` builds the SDK as part of its boot. Non-blocking for our spike (we don't depend on the dev-server bin), but worth flagging — first-time Windows operators may be alarmed.
- `pnpm dev` boots successfully on Windows but **does not create `config.json`**. The dev-runner reports the config path (line 62 of boot banner) but leaves the file absent. `paperclipai onboard -y` is required to materialize it. **NEW operator gotcha — add to runbook before BEAAA.** Sequence: clone → `pnpm install` → `pnpm dev` (boot) → `pnpm paperclipai onboard -y` (creates config.json + .env + secrets/) → THEN safety CLI operations.

**HIGH-VALUE FINDINGS — Phase 1 safety CLI defects exposed by `embedded-postgres` dev mode:**

1. **Schema drift: `mode-detect.mjs` doesn't recognize `database.mode: 'embedded-postgres'`.** Current Paperclip (b947a7d7) writes `config.json` with `database.mode` (values include `"embedded-postgres"`) — but the Phase 1 safety CLI inspects `database.driver` (values `pglite` | `postgres`) per [`scripts/safety/lib/mode-detect.mjs`](../../../scripts/safety/lib/mode-detect.mjs#L33-L72). Result: `node scripts/safety/cli.mjs snapshot` fails with `Cannot determine Paperclip DB mode from config.json`. Phase 1 rehearsal PASS against Hostinger Countermoves on 2026-05-13 did not surface this because Hostinger uses external/hosted Postgres (the `driver: 'postgres'` shape). **FIXED INLINE during this spike:** `mode-detect.mjs` extended with `db.mode === 'embedded-postgres' → 'postgres'` recognition + fixture `paperclip-embedded-postgres-config.json` + test D2b. All 5 mode-detect tests pass. Fix is local to this Phase 2 spike commit; consider whether to backport into a Phase 1 cleanup commit.
2. **Missing client tools: `pg_dump` not on PATH on Windows.** With `--db-url=postgresql://...@127.0.0.1:54329/paperclip` override (mode-detect now succeeds), snapshot fails with `pg_dump (PostgreSQL 17 client tools) is not on PATH`. **Investigated bundled-binary auto-discovery and confirmed NOT VIABLE on Windows:** Paperclip's `@embedded-postgres/windows-x64@18.1.0-beta.16` package ships a SERVER-ONLY bundle — `bin/` contains `pg_ctl.exe`, `initdb.exe`, and DLLs, but **NO `pg_dump.exe`** (verified via `ls .../native/bin/` ≠ any `pg_dump*` binary). The Linux/macOS bundles may or may not include client tools; this is a per-platform concern. **REMEDIATION SCOPE for Phase 1 cleanup:** must be option (b) — runbook adds an explicit prerequisite step ("Windows operators: install PostgreSQL client tools — and note constraint #3 below"). System pg_dump was already installed at `C:\Program Files\PostgreSQL\17\bin\` on the smoke box (pre-existing); PATH prepend made it visible to the snapshot CLI, but defect #3 below means the system pg_dump 17.x cannot dump the embedded-postgres 18.x server.

3. **Server/client major-version mismatch: embedded-postgres 18.1-beta cannot be dumped by stable client 17.9.** With pg_dump on PATH + correct credentials (user `paperclip`, password `paperclip`, db `paperclip` — hardcoded in [`paperclip/server/src/index.ts`](https://github.com/paperclipai/paperclip/blob/b947a7d7/server/src/index.ts)), snapshot fails with: `pg_dump exited non-zero (1): pg_dump: error: aborting because of server version mismatch; server version: 18.1; pg_dump version: 17.9`. **Root cause:** `@embedded-postgres/windows-x64@18.1.0-beta.16` pulls PostgreSQL 18.1 (still in beta upstream as of 2026-05). Stable client distributions (`winget install PostgreSQL.PostgreSQL.17` is the latest non-beta) ship 17.x. pg_dump enforces strict same-major version policy by design, since cross-major dumps can silently lose data. **REMEDIATION SCOPE for Phase 1 cleanup:** safety CLI must either (a) ship its own pg_dump matched to whichever embedded-postgres version Paperclip pins, (b) require the runbook to track Paperclip's embedded-postgres major-version and install matching client tools (brittle), or (c) implement a server-side snapshot path (file-level copy of data dir while server is stopped via `paperclipai stop` → `pnpm dev` again later — but the running-instance constraint is what makes snapshot useful in the first place). **None of these is trivial; this is a Phase 1 hardening gap that must be planned, not patched.**

**Aggregate impact:** The combination of defects 1+2+3 means **no automated snapshot bookend is possible for an `embedded-postgres`-mode Paperclip on Windows today.** The Hostinger Countermoves Phase 1 PASS works because Hostinger uses hosted Postgres (matching client version on the Hostinger box, well-known auth, standard port). Phase 1 was inadvertently scoped to "hosted Postgres only" without that constraint being visible. The smoke spike has surfaced this in time to harden Phase 1 before BEAAA's deployment mode is locked.

**Snapshot bookend disposition for THIS spike: SKIPPED.** Rationale: (a) the throwaway clone has no irreplaceable state (re-cloneable in ~70s); (b) restore-by-deletion (`rm -rf C:\Users\erezg\.paperclip\instances\default` + re-onboard) is sufficient rollback for this disposable instance; (c) the three Phase 1 defects above are themselves the spike's empirical contribution to project safety. Phase 1 cleanup plan (new follow-up plan, NOT a hotfix to this spike) must close defects 2 and 3 before any Phase 2 install against BEAAA can be bookended.

**HIGH-VALUE FINDING #4 — Plugin migration authoring pattern is different from plan's design:**

The original plan (and the Phase 1 / 02-CONTEXT.md research artifact) treated PLUGIN_AUTHORING_GUIDE.md's "host scopes it to plugin namespace" language as **template substitution**. Empirically it is **literal-baked-namespace**: plugin author computes `plugin_<slug>_<hash10>` from the manifest `id` and writes it into every DDL statement. The host's validator (`extractQualifiedRefs` + namespace comparison) is strict — there is no `${SCHEMA}` or `{{namespace}}` interpolation step. See "## D-02 Migrations Approach" above for the correction in detail. **Cascade is non-optional for Plans 02-02/02-03/02-04.**

**HIGH-VALUE FINDING #5 — Paperclip plugin loader has a Node-ESM-on-Windows path bug:**

When the host attempts to import a plugin's `dist/worker.js`, it appears to pass the absolute path directly to a Node ESM call. On Windows that path looks like `c:\Users\...\dist\worker.js`. Node 24's strict ESM loader rejects this with:

```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader.
On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'
```

**Root cause:** somewhere in the host's plugin-worker loader, the absolute path is not being converted to a `file://` URL via `pathToFileURL()` before being passed to `import()` or `child_process.spawn(..., {execArgv: ['--import', url]})`. Linux/macOS absolute paths happen to be unambiguous because they start with `/`; Windows's `c:` confuses Node's URL parser.

**Impact: Plugin install workflow is UNUSABLE on Windows hosts** running master@b947a7d7. The plugin gets installed (registered in DB + migration applied), but the worker never reaches `ready` status, so the slot never mounts in the UI.

**Mitigation:** None on the plugin side. **Action:** file an upstream issue against `paperclipai/paperclip`. Workaround: develop and test plugins from Linux (WSL on Windows, Linux VPS, or directly on Hostinger Countermoves with snapshot bookends — but the bookend itself is gated on Phase 1 cleanup of defects 1-3 above).

**Forward path for plugins target BEAAA:** BEAAA is on Hostinger Linux. The worker-loader bug does NOT affect BEAAA. The Linux execution path uses standard POSIX absolute paths which Node ESM imports without issue. So this finding **does not gate BEAAA install** — it gates plugin DEVELOPMENT on Windows dev boxes only.

Operator-phase pitfalls to watch for (carry-forward from Phase 1):
- `paperclip_restoring` DB pre-create gotcha (from Phase 1 rehearsal) only applies on restore, not install — should not block this spike.
- `pnpm paperclipai plugin install` vs `pnpm paperclipai install` ambiguity — Check A resolves it; don't assume the form.

**Note:** This paragraph is superseded by the "Aggregate impact" + "Snapshot bookend disposition" section above (now THREE stacked defects, not two).

## Decisions for Downstream Plans

- **Plan 02-02 manifest:** LOCKED to `detailTab + entityTypes: ['issue']` (matches kitchen-sink canonical pattern). Required capability: `ui.detailTab.register` (verified in Task 1 manifest).
- **Plans 02-02..02-04 migrations:** MUST use the fully qualified namespace `plugin_clarity_pack_cdd6bda4bd.<table>` literally in DDL statements (NOT unqualified; NOT templated). Plan 02-02 must add a build-time check that the migration SQL's schema name matches `derivePluginDatabaseNamespace(manifest.id)` — see [`paperclip/server/src/services/plugin-database.ts:28-41`](https://github.com/paperclipai/paperclip/blob/b947a7d7/server/src/services/plugin-database.ts#L28-L41) for the derivation. If we ever rename the plugin, ALL migrations regenerate.
- **Plan 02-04 SituationRoom Task 2 step 7:** LOCKED to FALLBACK pattern (worker handler `clarity-pack/get-instance-config` returning `ctx.config.get()` + UI primitive `useInstanceConfig` wrapping `usePluginData`). Plan 02-02 should own the primitive (`src/ui/primitives/use-instance-config.ts`) since it belongs with the other shared primitives. Worker handler registration goes in Plan 02-04 alongside the other SituationRoom worker handlers.
- **Plan 02-02 trust-model writeup:** cite the postinstall-audit evidence in this doc (Check E, "## D-08(f) Postinstall Audit") as the empirical baseline for the "no postinstall scripts in supply chain" claim.
- **Plan 02-01 Task 1 schema corrections (cascade, from commit bef083e):** all 6 corrections in the section below MUST be reflected in 02-02/02-03/02-04 manifest reconciliations. The Plan-02-02 manifest must use: `id`, `description`, `author`, `categories`, `entrypoints.ui` (directory), `entrypoints.worker`, `capabilities[ui.detailTab.register, instance.settings.register]`, and `paperclipPlugin.ui` (directory) in package.json.
- **Phase 1 cleanup plan (NEW — needs to be added to ROADMAP if not already):** must close safety CLI defects #1 (mode-detect; FIXED inline this spike, awaiting roll-forward into Phase 1 history), #2 (pg_dump on Windows PATH; runbook prerequisite), and #3 (pg_dump server-version-match policy with embedded-postgres beta). Phase 2 against BEAAA cannot be snapshot-bookended until 2+3 are resolved (or BEAAA's deployment is confirmed to use hosted-Postgres-with-matching-client, which Hostinger Countermoves already does).
- **Paperclip upstream issue (NEW — file in `paperclipai/paperclip` repo):** Node-ESM-on-Windows path bug in plugin-worker loader. File with: minimal reproduction (this clone's clarity-pack install attempt), the verbatim error trace from finding #5 above, and the proposed fix (`pathToFileURL()` wrapper before `import()` calls in the plugin loader). Non-blocking for BEAAA; blocking for Windows-side plugin development.

## Task 1 Schema Corrections (cascade target for 02-02/02-03/02-04)

Captured by commit [bef083e](.) (Task 1 close-out); restated here so downstream plans inherit:

1. Manifest field is `id` (not `name`) and is REQUIRED.
2. `description`, `author`, `categories` are REQUIRED top-level manifest fields.
3. UI bundle path is `entrypoints.ui` (directory), NOT `ui.bundleEntry` (file).
4. `entrypoints.worker` is REQUIRED in the manifest.
5. Capabilities `ui.detailTab.register` and `instance.settings.register` are REQUIRED to register those slot types — capability strings, declared at top-level `capabilities[]`.
6. `paperclipPlugin` field in `package.json` uses key `ui` (directory), not `uiBundle` (file).

Verification: All six caught at `pnpm build:manifest` (TS 2353 on the stale field names from research/STACK.md sketch). Cascade required before Plans 02-02/02-03/02-04 execute their manifest reconciliations.
