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

(no completed PASS drills yet — first PASS row is added by the operator
after running rehearsal-drill.md end-to-end against a clean Paperclip
target)

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
