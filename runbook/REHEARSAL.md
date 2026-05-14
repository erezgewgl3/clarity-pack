# Rehearsal Drill Log

Each entry below records a successful end-to-end snapshot → restore →
smoke → atomic-swap drill executed against a non-production Paperclip
clone. SAFE-02 ("rehearsed at least once") requires at least one
COMPLETED entry in the table below — the empty template alone does
NOT satisfy the acceptance condition.

The first dated row is added by the operator after running
[rehearsal-drill.md](rehearsal-drill.md) end-to-end. Subsequent
rehearsals (recommended quarterly, or whenever the safety CLI
changes) append additional rows.

This file is also the audit log for `--gate-bypass` invocations. Any
honored bypass appends a `[BYPASS]` line below the entries table.

---

## Format

| Column            | Meaning                                                                 |
|-------------------|-------------------------------------------------------------------------|
| Date              | The date the drill was completed, in `YYYY-MM-DD` form. Required.       |
| Paperclip Version | From `manifest.paperclipVersion` of the snapshot taken in the drill.    |
| DB Mode           | `pglite` or `postgres` — from `manifest.paperclipMode`.                 |
| Snapshot Size     | Sum of `manifest.artifacts.{db,fs}.sizeBytes`, in human-readable units. |
| Snapshot Duration | Wall-clock seconds for `pnpm clarity-safety snapshot` to complete.      |
| Restore Duration  | Wall-clock seconds for `pnpm clarity-safety restore <id>` to complete.  |
| Smoke Result      | `PASS` if the drill reached step 14; otherwise the drill failed.        |
| Anomalies         | Anything unexpected during the drill. `none` if clean.                  |
| Operator          | Who ran the drill.                                                      |

---

## Entries

| Date | Paperclip Version | DB Mode | Snapshot Size | Snapshot Duration | Restore Duration | Smoke Result | Anomalies | Operator |
|------|-------------------|---------|---------------|-------------------|------------------|--------------|-----------|----------|
| 2026-05-13 | unknown (pre-existing version-parse bug; see anomalies) | postgres | 691 KB (db 384 KB + fs 307 KB) | ~12s (observed) | ~8s (observed) | PASS | drill surfaced 5 additional issues fixed in-session before PASS — see anomalies block below | eric (driven by Claude as pair-on-keyboard) |

**Anomalies for the 2026-05-13 PASS row** — the drill against the live Countermoves Hostinger Paperclip surfaced and fixed five additional gaps in the safety CLI that the unit tests did not exercise. All fixed in the same session before this row was appended; the PASS reflects the post-fix state, not the as-shipped Plan 01-03 state:

1. **R5 Linux portability** (commit `bc89228`): an `assert.rejects(stat(...))` over `path.join(home, '..', '..', '..', '..', 'etc', 'passwd')` assumed /etc/passwd doesn't exist. True on Windows; false on Linux. Removed — the two prior assertions cover the security property.
2. **PGlite worker leak on failure** (commit `1e6021d`): `db.close()` was unreachable when `db.exec()` threw; latent bug, would have leaked a WASM worker on any failed restore. Wrapped in try/finally.
3. **R7 uses FakePGlite** (commit `0cf196e`): real PGlite WASM pins the event loop even after close(), causing `node --test` to report file-level exit=1 despite all sub-tests passing. Injected a stub PGlite for the R7 test path.
4. **Snapshot tolerates paperclip-cli auth failures** (commit `f2b7327`): `pnpm paperclipai plugin list` is now auth-gated; the safety CLI was throwing on 403. Errors now record into `manifest.paperclipCliWarnings` instead of halting the snapshot — the safety property is the sha256-verified DB+FS bytes, not the version metadata.
5. **Paperclip API drift — /api/issues → /api/companies/{id}/issues** (commit `0d026fa`): Paperclip moved the issues endpoint sometime between 2026-05-08 and 2026-05-13. `paperclip-api.mjs listIssues` now requires + uses companyId; smoke + tests + stub server updated.

**Two operator-side gaps surfaced during the drill** — these are NOT safety-CLI bugs but installation/usage gotchas worth recording so the runbook can be updated:

a) **`paperclip_restoring` Postgres database is not auto-created by restore.mjs**: when running against a Postgres-mode Paperclip, the operator must `CREATE DATABASE paperclip_restoring OWNER paperclip` via `sudo -u postgres psql` before invoking `clarity-safety restore`. The `paperclip` role lacks `CREATEDB` privilege. Either fix: (i) grant CREATEDB to paperclip, (ii) add a pre-flight step in restore.mjs that mints the staging DB, (iii) document the manual `psql` step in `runbook/rollback-walkthrough.md`. Decision: (iii) for v1, (ii) for v2.

b) **Paperclip rejects instance IDs containing `.`** (e.g. `default.restoring`): restore.mjs uses `<instanceId>.restoring` as the staging dir naming convention, but `paperclipai run` errors out with "Invalid instance id 'default.restoring'. Allowed characters: letters, numbers, '_' and '-'." Operator workaround in the drill: `mv default.restoring default-restoring` before starting the sibling. Fix: change restore.mjs's staging convention to use `-restoring` suffix instead of `.restoring`.

**Drill artifacts of record (Countermoves Hostinger, 2026-05-13):**

- Pre-drill commit (drill ready): `0d026fa` on master
- Snapshot id: `2026-05-12T21-27-26Z` (Postgres mode; lives in `~/clarity-pack/.planning/snapshots/` on the VPS)
- Test issue created post-snapshot for state-reversion proof: `COU-3 REHEARSAL-DRILL-DELETE-ME-2026-05-13`
- Staging DB contained only COU-1 + COU-2 (correctly reverted; test issue absent)
- Live DB contained COU-1 + COU-2 + COU-3 (correctly untouched)
- Sibling Paperclip on port 3101 booted successfully against the restored staging dir + staging DB
- Smoke against sibling: health ✓, issues ✓, agents ✓, plugins ✓, heartbeat skipped (no editor-agent in this DB)
- verifiedAt written: `2026-05-12T21:40:55.394Z`
- Gate (fresh): forwarded inner command verbatim
- Gate (--max-age=0): refused with `snapshot-stale` + exact remediation

**SAFE-02 grep:** `grep -qE '^\\| 20[0-9]{2}-' runbook/REHEARSAL.md` → MATCH (this row).

## Failed Drill Attempts

Failed drills are recorded here. They are not in the Entries table
because SAFE-02's acceptance grep `^\| 20[0-9]{2}-` only matches PASS
rows. Failures still belong in the audit log — they prove the
rehearsal protocol caught real defects that would otherwise have
reached production.

### 2026-05-12 — NOT APPROVED — drill exposed two real defects in safety CLI

- **Target:** Countermoves Hostinger Paperclip (82.29.197.74, `countermoves.gl3group.com`, authenticated/public mode, Postgres `paperclip_countermoves`)
- **Operator:** eric
- **Snapshot taken:** `2026-05-11T08-41-05Z` (size 690 KB, postgres mode, 0 plugins)
- **Reached:** Step 5 (restore). Failed during tar extraction.

**Defect 1 (FIXED in same session):** `restoreToStaging` in `scripts/safety/lib/restore.mjs` refused ALL `SymbolicLink` / `Link` tar entries with `Refusing to extract SymbolicLink: <path>`. The CVE-2026-31802 mitigation was too strict — it rejected in-tree links that don't escape the staging dir. Patched to allow links whose resolved target stays inside `allowedRootResolved` and reject only escapes. Phase 2 hardening: resolve symlinks transitively to catch chain-of-symlinks escape attempts (current patch is single-hop).

**Defect 2 (UNFIXED, blocks Phase 1 closure):** `snapshot.mjs` captures Claude Code's `claude-prompt-cache/` directories which include symlinks pointing to `/home/eric/paperclip/skills/<skill-name>` — outside the instance tree. The restore correctly refuses these (CVE protection working as designed) but the snapshot shouldn't have captured them in the first place. They are regenerable cache content, not source-of-truth state. **Fix:** add a cache-directory exclusion list to `snapshot.mjs` (`**/claude-prompt-cache/**`, plus any adapter-specific caches that emerge). Tracked as Plan 01-04 (or Plan 02-01) before any clarity-pack work touches BEAAA.

**Verdict:** `not approved — drill exposed defects in safety CLI; re-rehearse after Plan 01-04 fixes`.

**Value extracted from the failed drill:** The rehearsal protocol caught two real production-shape bugs in the safety CLI before clarity-pack shipped to BEAAA. This is exactly its purpose. Both defects would have surfaced at the worst possible time (mid-install against BEAAA) if we'd skipped the drill.

---

## Phase 2 install rehearsals

This section records the Plan 02-01 Task 2 install spike — the rehearsal of `pnpm paperclipai plugin install` against a virgin Paperclip clone, separate from Phase 1's snapshot/restore rehearsals (which appear in the `## Entries` table above).

**Columns:** Date | Paperclip clone version | DB Mode | Install Command Form | Slot Confirmed | Migration Schema Name | COEXIST-03 verdict | Operator

| Date       | Paperclip clone version | DB Mode           | Install Command Form                      | Slot Confirmed   | Migration Schema Name             | COEXIST-03 verdict     | Operator |
|------------|-------------------------|-------------------|-------------------------------------------|------------------|-----------------------------------|------------------------|----------|
| 2026-05-13 | b947a7d7 (master)       | embedded-postgres | `paperclipai plugin install <local-path>` | DEFERRED (Linux) | plugin_clarity_pack_cdd6bda4bd ✓ | CONFIRMED architecturally + partial empirical | eric (driven by Claude as pair-on-keyboard) |
| 2026-05-13 | b947a7d7 (master)       | embedded-postgres | (snapshot verification — no plugin install in this row) | n/a (Plan 01-05 verification) | plugin_clarity_pack_cdd6bda4bd ✓ (carried) | n/a (carried) | eric (driven by Claude as pair-on-keyboard) |

**Verdict for the 2026-05-13 row (first row):** `PARTIAL — install workflow blocked on Windows by upstream Paperclip ESM-path bug; Checks A/C/D/E/F all CONFIRMED or banked architecturally; D-01 visual confirmation deferred to first Linux Paperclip (WSL, fresh Linux VPS, or BEAAA itself).`

**Verdict for the 2026-05-13 row (second row — Plan 01-05 verification):** `PASS — locator + version pre-check work end-to-end against the local embedded-postgres dev clone. Snapshot CLI invoked WITHOUT --db-url (auto-derived from config); pg_dump located via --pg-bin override (C:/Program Files/PostgreSQL/17/bin/pg_dump.exe); psql round-trip via sibling-path discovery; VersionMismatchError fired BEFORE pg_dump spawned with verbatim message "pg_dump major version 17 cannot dump server version 18. PostgreSQL requires matching major version. Install pg_dump 18 client tools OR use restore-by-deletion fallback for throwaway dev clones (runbook/operator-gotchas.md §pg-dump-version-mismatch)." Defect-3 itself (PG18-beta server vs PG17-stable client incompatibility) is INHERENT to pg_dump's strict version policy — NOT something this plan attempted to fix programmatically; the plan ships a clean error path + documented workaround per the §pg-dump-version-mismatch runbook entry. Snapshot bookend remains unviable on this exact Windows + embedded-pg-18-beta combination until either Paperclip pins a stable embedded-pg major OR Windows operator installs pg_dump 18-beta from postgresql.org/download. Hostinger Countermoves (hosted Postgres with matching client tools) is UNAFFECTED — Plan 01-04 PASS row above remains valid.`

**Empirical anchors (5 high-value findings):**

1. **Check A (Install Command Form) — CONFIRMED:** `paperclipai plugin install <local-path|@npm/pkg|@npm/pkg@version>` per verbatim `pnpm paperclipai plugin --help` output. Lifecycle subcommands `install/list/uninstall/enable/disable/inspect/init/examples` all available. See [`02-01-SMOKE-FINDINGS.md`](../.planning/phases/02-scaffold-and-surfaces/02-01-SMOKE-FINDINGS.md) §"Install Command Form" for the full text.
2. **Check C (D-02 Migrations) — CONFIRMED with critical correction:** schema name is **deterministic, not templated**. `derivePluginDatabaseNamespace(manifest.id)` → `plugin_clarity_pack_cdd6bda4bd`. Migration SQL must bake this literal into every DDL statement; `COMMENT ON` is the only exception. `public.*` diff before vs after install: 0 changes. The plan's original "host substitutes" assumption was FALSIFIED — cascade is non-optional for Plans 02-02/02-03/02-04 manifest reconciliation.
3. **Check D (COEXIST-03) — CONFIRMED architecturally + partial empirical:** fixture row inserted into `plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs` survives across psql queries; plugin-lifecycle.ts state machine documents `disabled → ready → uninstalled` with NO `DROP SCHEMA` in production code paths. Full CLI-driven disable test deferred (plugin stuck in `status=error` from finding #5).
4. **Check E (D-08(f) Postinstall Audit) — CONFIRMED:** clarity-pack transitive tree (10 packages) has only one vestigial `postinstall` declaration (esbuild's deprecated `install.js`), which pnpm 9.x default-deny blocks; platform binary is delivered via `@esbuild/<platform>` optional dep. Tree diff `--ignore-scripts` vs default: empty.
5. **Check F (useInstanceConfig SDK path) — FALLBACK REQUIRED:** SDK 2026.512.0 does NOT export `useInstanceConfig` from any subpath. UI must use `usePluginData('clarity-pack/get-instance-config')` wrapped in a local primitive; worker handler returns `ctx.config.get()`. Plan 02-04 LOCKED to this pattern.

**Concurrent defect discoveries (impact records, not failures of this spike):**

- **Phase 1 safety CLI defect cluster (3 stacked):** [1] `mode-detect.mjs` schema drift (looks for `database.driver`, current Paperclip writes `database.mode`) — **FIXED INLINE this spike, 5/5 tests pass**. [2] `pg_dump` not on Windows PATH by default + embedded-postgres Windows bundle ships server-only (no client tools). [3] embedded-postgres 18.1-beta requires same-major-version pg_dump; stable winget client only goes to 17.x. Combined, no automated snapshot bookend is possible for an embedded-postgres-mode Paperclip on Windows. New Phase 1 cleanup plan required before BEAAA install can be bookended (unless BEAAA's deployment is confirmed to use hosted Postgres with matching client tools, which Hostinger Countermoves already does).
- **Paperclip plugin loader Node-ESM-on-Windows path bug:** plugin install registers correctly + migrates correctly, but worker boot fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because the host imports the worker via raw `c:\...\worker.js` instead of `file:///C:/.../worker.js`. Linux-immune; Hostinger Paperclip is unaffected. File upstream issue against `paperclipai/paperclip`.

**Two new operator gotchas to fold into the BEAAA runbook (separate from the Phase 1 gotchas already recorded above):**

c) **`pnpm dev` does not create `config.json`** — the dev-runner reports the path in its boot banner but leaves the file absent. `paperclipai onboard -y` (non-interactive quickstart) is required to materialize `config.json` + `.env` + `secrets/`. Sequence on first install of any fresh Paperclip clone: `git clone → pnpm install → pnpm dev (boot) → paperclipai onboard -y → THEN safety CLI operations`.

d) **Paperclip embedded-postgres credentials are hardcoded `paperclip:paperclip@127.0.0.1:54329/paperclip`** (per [`paperclip/server/src/index.ts`](https://github.com/paperclipai/paperclip/blob/b947a7d7/server/src/index.ts), not stored in config.json or .env). Any psql-driven inspection of an `embedded-postgres`-mode Paperclip uses these credentials. (Hosted-Postgres deployments use whatever Paperclip's onboard sets; that path is unaffected.)

**Drill artifacts of record (local Windows clone, 2026-05-13):**

- Clarity-pack pre-spike state: commit `bef083e` (Task 1 smoke scaffold)
- Paperclip clone path: `C:\Users\erezg\Documents\paperclip-smoke-clone`, SHA `b947a7d76c331b3ce4069d3be0ade25cc89b1b90`, branch `master`
- Tarball produced: `clarity-pack-0.1.0-smoke.tgz` (2152 bytes; contents: `dist/manifest.js`, `dist/ui/index.js`, `dist/worker.js`, `migrations/0001_init.sql`, `package.json`)
- Plugin installed to Paperclip DB as `clarity-pack`, pluginId `2f55c8f8-7776-496a-b404-5f7248bcf907`, status `error` (worker boot blocked by Windows ESM path bug)
- Schema created: `plugin_clarity_pack_cdd6bda4bd` containing 1 table (`clarity_user_prefs`)
- Test row inserted: `(user_id='smoke-test-user', opted_in_at='2026-05-13 19:50:32+03')` — confirmed round-trip read OK
- `public.*` baseline: 86 tables before install, 86 tables after (diff empty)
- safety CLI mode-detect fix: new fixture + test D2b (5/5 mode-detect tests pass)
- See `.planning/phases/02-scaffold-and-surfaces/02-01-SMOKE-FINDINGS.md` for the comprehensive record.

**SAFE-02 grep:** `grep -qE '^\\| 20[0-9]{2}-' runbook/REHEARSAL.md` → MATCH (existing PASS row above + this PARTIAL row both satisfy the regex).

---

## Phase 2 Reader-tab visual rehearsals

This sub-section records the Plan 02-03 Task 3 / 02-03b Task 3 manual checkpoint drills — the visual-fidelity test of the Reader detail-tab against a live Paperclip with a real test issue. Separate from the install rehearsals above because the acceptance bar is "renders all 7 mockup elements + console clean", not "install succeeds".

**Columns:** Date | Plugin version (manifest) | Plugin uuid | Issue | Pre-snapshot id | Components rendered | Console clean | Verdict | Operator

| Date       | Plugin version | Plugin uuid                                | Issue | Pre-snapshot id            | Components rendered                                                                                                  | Console clean | Verdict   | Operator |
|------------|----------------|--------------------------------------------|-------|----------------------------|-----------------------------------------------------------------------------------------------------------------------|---------------|-----------|----------|
| 2026-05-14 | 0.2.0 (manifest) / 0.1.0-smoke (npm) | `0d4fc40a-0541-4b67-8979-9d346cb9c07b` | COU-4 | `2026-05-14T06-02-00Z`     | 4/8 (TldrStrip placeholder, AnchoredToCards empty, AcChecklist empty, ActivityTimeline empty); 1/8 error (LiveBlockerPanel showing typed EXTERNAL terminal); 3/8 missing (Breadcrumb, ProseWithRefChips, DeliverablePreview) | ❌ | NOT APPROVED | eric (driven by Claude as pair-on-keyboard) |

**Verdict for the 2026-05-14 row:** `not approved — sub-check A partial fail. 3 of 8 Reader components missing; 1 in error state. Root cause: useHostContext().companyId returns null in detail-tab slots on this Paperclip version, causing both issue.reader and flatten-blocker-chain handlers to bail per their fail-loud companyId guards. Plan 02-03b Task 2 fixed the SDK shape drift but left a UI-side gap because unit tests mock useHostContext() and never see real null values.`

**Empirical anchors (this drill):**

1. **Install pathway validated** — `scripts/install-helper.sh` works end-to-end against Hostinger Countermoves after one mid-drill fix (commit `27c1ef8`): original draft invoked `paperclipai plugin install` as a bare command, but `paperclipai` is a pnpm workspace script that only resolves from inside `~/paperclip`. Patched helper does `pushd $PAPERCLIP_HOME; pnpm paperclipai plugin install …; popd`.
2. **`pnpm paperclipai plugin install` rejects re-install** — error 400 "Plugin already installed: clarity-pack". No `--force` or replace flag on `install`. Documented surface (per `--help`): `list/install/uninstall/enable/disable/inspect/examples`. No `upgrade` despite PLUGIN_SPEC.md §8.2 listing it.
3. **`pnpm paperclipai plugin uninstall <key>` is non-destructive** — keeps namespace tables. Plugin UUID `0d4fc40a-…` was preserved across uninstall+reinstall. This confirms **COEXIST-#6 is wired correctly** ("Clean uninstall preserves data; --purge flag is opt-in only"). `--force` is the destructive path.
4. **Snapshot safety-CLI warnings on this VPS** — `getPaperclipVersion: pnpm paperclipai --version failed (exit 254)` + `listInstalledPlugins: pnpm paperclipai plugin list failed (exit 254)`. Cause: safety CLI spawns `pnpm paperclipai` from `~/clarity-pack/scripts/safety/`, where the workspace script doesn't resolve. Bytes-level safety property is unaffected (sha256-verified); only the cli-sidecar metadata is missing. Fix is the same shape as the install-helper fix — wrap with `cd $PAPERCLIP_HOME` in the safety CLI's `paperclip-cli.mjs` invocation. Not in scope for 02-03b.
5. **404s on `/api/issues/BEAAA-{141,203,417}` are Paperclip-internal**, not from our plugin. Sourced from `client.ts:22` (host's API client). Cause: Paperclip's Grabbit auto-linkifier scans rendered issue bodies for issue keys and validates them; BEAAA-* refs live on a different Paperclip instance. Cosmetic console noise. Not actionable for us.

**React key warnings (secondary):** Console showed `Each child in a list should have a unique 'key' prop` warnings on `ClaritySurfaceRoot` (from ReaderView) and `AnchoredToCards`. Bundled `dist/ui/index.js` has correct keys at every `.map()` call (`c.id` on AnchoredToCards line 177; fragment keys on prose-with-ref-chips). Defect-#3 from 02-03 drill is NOT fully closed despite commit `f89f44b`'s claim — root cause requires deeper investigation, possibly a host-side wrapper re-rendering our children through a path that loses key tracking. Parked behind the companyId blocker.

**Resolution path:** New plan **02-03c** to (a) diagnose why `useHostContext().companyId` returns null for detail-tab slots — likely needs `companyPrefix` → companyId resolution via a worker handler that calls `ctx.companies.get`, or a different SDK hook for detail-tab context, or a manifest scope declaration; (b) re-investigate React key warnings post-companyId fix. Plan 02-03 remains OPEN.

**Drill artifacts of record (Countermoves Hostinger, 2026-05-14):**

- Pre-drill commits in plugin repo: `27c1ef8` (install-helper fix) on top of `7a2c221` (pause at 02-03b task 3)
- Tarball shipped: `clarity-pack-0.1.0-smoke.tgz`, shasum `1274176c38f892c2bd8f5ea1d49b500093347342`
- Pre-drill Paperclip snapshot: `2026-05-14T06-02-00Z` (411 KB pgdump + 3.07 MB fs tar; sha256-verified)
- Test issue used: COU-4 "test issue", body contains `BEAAA-141`, `BEAAA-203`, `BEAAA-417`
- Plugin status post-install: `ready` (uuid preserved across uninstall+reinstall: `0d4fc40a-0541-4b67-8979-9d346cb9c07b`)
- No post-snapshot taken (drill ended at sub-check A; no destructive action against live state)

**SAFE-02 grep:** still MATCH via the prior PASS row.

---

## Bypass Audit Log

Every honored `--gate-bypass` invocation appends a `[BYPASS]` line
below this header (the gate's `logBypass` helper does this
automatically; see `scripts/safety/lib/gate.mjs`). Operator review of
this section quarterly is recommended — repeated bypasses are a
signal that the design needs revision, not that the gate needs to be
weakened.

(no bypass invocations yet)
