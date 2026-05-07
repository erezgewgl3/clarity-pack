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

(no completed drills yet — first dated row is added by the operator
after running rehearsal-drill.md end-to-end against a fresh Paperclip
clone)

---

## Bypass Audit Log

Every honored `--gate-bypass` invocation appends a `[BYPASS]` line
below this header (the gate's `logBypass` helper does this
automatically; see `scripts/safety/lib/gate.mjs`). Operator review of
this section quarterly is recommended — repeated bypasses are a
signal that the design needs revision, not that the gate needs to be
weakened.

(no bypass invocations yet)
