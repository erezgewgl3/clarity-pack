# Rehearsal Drill — End-to-End Against a Fresh Local Paperclip

This is the drill that satisfies SAFE-02's "rehearsed at least once"
acceptance condition. SAFE-02 verbatim says restore must be rehearsed
against a non-production Paperclip clone at least once before any
clarity-pack feature code touches BEAAA. That is what this walk does.

The drill exercises every code path in the safety CLI end-to-end:
snapshot, restore (sibling-staging), smoke against staging, atomic
swap, smoke against live. It also exercises the gate's refuse-or-run
behavior. Run it once on a fresh local Paperclip clone before doing
any clarity-pack work against BEAAA. Subsequent rehearsals are
recommended quarterly or whenever the safety CLI changes.

---

## Step Overview

The drill is 15 steps. The numbered list below is a one-line summary
of each step; full instructions for each step are in the matching
section below.

1. Sanity check the CLI (`clarity-safety --help`).
2. Take the first snapshot.
3. Modify Paperclip state (create a uniquely-named issue).
4. Stop the live Paperclip.
5. Restore the snapshot to a sibling staging directory.
6. Start a sibling Paperclip pointing at staging on an alt port.
7. Smoke against staging.
8. Confirm restore reverted state (the issue from step 3 is absent in staging).
9. Verify the snapshot (writes verifiedAt back to manifest).
10. Tear down the sibling Paperclip.
11. Restart the live Paperclip.
12. Smoke vs. live.
13. Test the gate (forward + refuse-on-stale).
14. Append the rehearsal entry to REHEARSAL.md.
15. Reply with the verdict.

---

## Pre-conditions

- A fresh local Paperclip clone, set up via `pnpm onboard` (PGlite
  mode is the documented dev path) or via a hosted Postgres. The
  drill works identically for both modes; the snapshot CLI auto-detects.
- Paperclip is running on `http://localhost:3100`.
- Node >= 20 and pnpm >= 9 are on PATH. See [PLATFORMS.md](PLATFORMS.md).
- This repo cloned at the same place as `scripts/safety/`.
- `pnpm -C scripts/safety install` has been run.
- For Postgres mode: `pg_dump` is on PATH and matches the server's
  major version.

---

## Step 1 — Sanity check the CLI

```
pnpm -C scripts/safety clarity-safety --help
```

Expected: a Usage line followed by the 7 subcommands listed
(snapshot, restore, smoke, verify, gate, list, prune). Exit code 0.

If this fails: see [PLATFORMS.md](PLATFORMS.md). Most failures here
are missing pnpm or pnpm pointing at the wrong project.

---

## Step 2 — Take the first snapshot

```
pnpm -C scripts/safety clarity-safety snapshot
```

Expected:

- A snapshot id printed in the form `2026-MM-DDTHH-MM-SSZ`.
- A directory created at `.planning/snapshots/<id>/` containing
  `manifest.json` plus the DB artifact (`pglite-datadir.tar.gz` or
  `postgres.dump`) plus `instance-fs.tar.gz`.
- A summary line printing the snapshot location.

Record from the run: the snapshot id, the total size (sum the two
artifact sizes from `manifest.json`'s `artifacts` field), the
Paperclip version (from the `paperclipVersion` field), the plugin
count (length of `installedPlugins`), and the mode
(`paperclipMode`).

---

## Step 3 — Modify Paperclip state

This step is what proves the restore actually reverses state. Use
the Paperclip UI or its REST API to create at least one new resource
that is uniquely identifiable. Recommended: create an issue with the
title `REHEARSAL-DRILL-DELETE-ME-<today's-date>`.

Confirm via the UI or `GET /api/issues?limit=10` that the issue
exists.

---

## Step 4 — Stop the live Paperclip

Ctrl+C the running Paperclip process.

---

## Step 5 — Restore the snapshot to a sibling staging directory

```
pnpm -C scripts/safety clarity-safety restore <snapshot-id>
```

Expected output:

```
restore staged at: <home>/instances/default.restoring
staging db:        paperclip_restoring
next: pnpm clarity-safety verify <snapshot-id>  (plan 02)
```

Confirm:

- The directory `<home>/instances/default/` is byte-identical to what
  it was before this command. Spot-check by comparing
  `<home>/instances/default/config.json`'s mtime and size against
  what you saw before step 4.
- The directory `<home>/instances/default.restoring/` exists and
  contains the snapshotted instance tree.
- For Postgres mode: `paperclip_restoring` exists as a database in
  your Postgres server (`psql -l`).

---

## Step 6 — Start a sibling Paperclip pointing at staging

This is the v1 manual step.

For PGlite mode:

1. Copy `<home>/instances/default.restoring/config.json` to a
   temporary file. Edit the `ports.http` value (or whatever the
   field is called in the current Paperclip config schema) from
   3100 to 3101.
2. Move the edited config back into the staging dir.
3. Set environment for this shell:
   ```
   PAPERCLIP_HOME=<home>
   PAPERCLIP_INSTANCE_ID=default.restoring
   PAPERCLIP_API_URL=http://localhost:3101
   ```
   (Use `set` on Windows cmd, `$env:VAR=...` on Windows PowerShell,
   `export VAR=...` on POSIX.)
4. `pnpm paperclipai start` in this shell.

For Postgres mode, also export the DSN pointing at the staging DB:

```
DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/paperclip_restoring
```

Wait until Paperclip prints "ready" or its equivalent on port 3101.

---

## Step 7 — Smoke against staging

```
pnpm -C scripts/safety clarity-safety smoke <snapshot-id> \
  --api-url=http://localhost:3101 \
  --company-id=<your-company-id>
```

Expected: 5 PASS lines + plugin-list-cross-check PASS +
version-cross-check PASS (or `skipped` if Paperclip's `/health` body
does not include `paperclipVersion`) + `smoke PASSED`. Exit code 0.

If smoke FAILS at this step, the rehearsal is a real failure. Stop
and investigate (the rest of the drill assumes a successful staging
smoke).

---

## Step 8 — Confirm restore reverted state

Open `http://localhost:3101` in a browser, or query its REST API.
Confirm the issue you created in step 3
(`REHEARSAL-DRILL-DELETE-ME-...`) does NOT appear. The staging is
the snapshot's state, which was taken before step 3.

If the issue DOES appear, something is wrong: either the snapshot
captured post-step-3 state (you accidentally took the snapshot after
modifying), or the restore did not actually reverse state. Investigate
before proceeding.

---

## Step 9 — Verify the snapshot (writes verifiedAt back to the manifest)

This step is the verify-CLI version of what step 7 just did
manually. The difference: `verify` writes `verifiedAt` and
`verifiedSmokeChecks` back into the manifest atomically, which is
what the gate later checks.

```
pnpm -C scripts/safety clarity-safety verify <snapshot-id> \
  --strategy=manual \
  --smoke-api-url=http://localhost:3101 \
  --company-id=<your-company-id>
```

Expected on PASS:

```
verify PASSED
verifiedAt:           2026-MM-DDTHH:MM:SS.fffZ
verifiedSmokeChecks: health, issues, agents, plugins, heartbeat, plugin-list-cross-check, version-cross-check
```

Confirm the manifest now has `verifiedAt` set:

```
cat .planning/snapshots/<snapshot-id>/manifest.json | grep verifiedAt
```

Expected: `"verifiedAt": "2026-..."` (a non-null ISO timestamp).

---

## Step 10 — Tear down the sibling Paperclip

Ctrl+C the sibling Paperclip running on 3101. You can leave the
staging dir in place for inspection (`<home>/instances/default.restoring/`),
or remove it — your choice. The rehearsal is what we care about.

---

## Step 11 — Restart the live Paperclip on 3100

In a fresh shell (without the alt-port env vars), start Paperclip
the way you normally do:

```
pnpm paperclipai start
```

Wait for it to come up on port 3100.

---

## Step 12 — Smoke vs. live (using the verified snapshot)

```
pnpm -C scripts/safety clarity-safety smoke <snapshot-id> \
  --api-url=http://localhost:3100 \
  --company-id=<your-company-id>
```

Expected: 5 PASS lines + `smoke PASSED`.

The plugin-list-cross-check should pass (same plugins as snapshot).
The version-cross-check should pass (or skip).

Note: since you did NOT roll the live state back, the issue from
step 3 (`REHEARSAL-DRILL-DELETE-ME-...`) is still present in the
LIVE Paperclip. This is expected — the drill tested staging-restore,
not live-rollback. The live Paperclip is still post-step-3.

(For a destructive drill that actually swaps the staged state into
live, see [rollback-walkthrough.md](rollback-walkthrough.md). That
walk is a separate procedure and not part of this drill.)

---

## Step 13 — Test the gate

The gate is now in a "fresh + verified" state because step 9 just
wrote `verifiedAt`. Confirm the gate forwards:

```
pnpm -C scripts/safety clarity-safety gate -- echo "this should print"
```

Expected: `this should print` is printed; gate exits 0.

Now confirm the gate refuses on a stale snapshot. Override the
freshness window to 0 minutes (everything is stale):

```
pnpm -C scripts/safety clarity-safety gate --max-age=0 -- echo "this should NOT print"
```

Expected: `gate REFUSED (snapshot-stale): ...` printed to stderr;
gate exits 1; the inner `echo` is NEVER spawned.

The gate's refusal message names the snapshot id and the remediation
command (`pnpm clarity-safety snapshot` + verify).

---

## Step 14 — Append the rehearsal entry to REHEARSAL.md

Open [REHEARSAL.md](REHEARSAL.md). Append a row to the `## Entries`
section using the documented format:

```markdown
| 2026-MM-DD | <Paperclip version> | <pglite|postgres> | <size> | <snapshot-duration> | <restore-duration> | PASS | <anomalies-or-none> | eric |
```

The first column MUST be today's date in `YYYY-MM-DD` form so the
SAFE-02 acceptance grep `^\| 20[0-9]{2}-` matches.

Fill in:

- **Date** — today, in `YYYY-MM-DD` form.
- **Paperclip Version** — from step 2's manifest's
  `paperclipVersion`.
- **DB Mode** — `pglite` or `postgres` (from `paperclipMode`).
- **Snapshot Size** — sum of artifact `sizeBytes` in the manifest, in
  human-readable units (e.g. `42 MB`).
- **Snapshot Duration** — eyeball from step 2 (you can re-run with a
  stopwatch or just guess to within ~5s).
- **Restore Duration** — eyeball from step 5.
- **Smoke Result** — `PASS` (this drill failed if you didn't reach
  step 14).
- **Anomalies** — anything unexpected. `none` if clean.
- **Operator** — your name.

---

## Step 15 — Reply with the verdict

Choose one:

- `approved — drill clean` — every step matched expected output, no
  anomalies. Phase 1 is complete; the safety discipline is operational.
- `approved — drill clean with notes: <text>` — minor deviations you
  want logged but not blocking. Add the notes; phase 1 still
  completes.
- `not approved — <description>` — a step failed in a way that
  indicates the safety CLI itself needs revision. Phase 1 does NOT
  complete; the orchestrator routes back to the planning step to
  revise plan 01-01 / 01-02 / 01-03 against the failure mode.

---

## Frequency

After the first drill: rerun whenever the safety CLI's lib code
changes, or quarterly, whichever comes first. Each rehearsal appends
a new row to [REHEARSAL.md](REHEARSAL.md) — the log is permanent.
