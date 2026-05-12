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

## Bypass Audit Log

Every honored `--gate-bypass` invocation appends a `[BYPASS]` line
below this header (the gate's `logBypass` helper does this
automatically; see `scripts/safety/lib/gate.mjs`). Operator review of
this section quarterly is recommended — repeated bypasses are a
signal that the design needs revision, not that the gate needs to be
weakened.

(no bypass invocations yet)
