# Rollback Walkthrough

The install went wrong. The post-install smoke failed, or you saw
broken behavior in the UI, or the migration aborted halfway. This walk
restores the pre-install snapshot byte-for-byte to the live Paperclip.

The whole procedure is non-destructive until the very last step (the
atomic-swap). At any point before the swap, you can abort and the
live Paperclip remains untouched. That is the entire point of the
sibling-staging design.

This walk assumes you have a pre-install snapshot from
[install-walkthrough.md](install-walkthrough.md) Step 1, and that you
captured its snapshot id.

---

## Step 1 — Identify the recovery target

```
pnpm clarity-safety list
```

Expected output: a table of snapshots, newest first, with verified /
unverified status and age in minutes.

```
id                          size       verified  age (min)
2026-MM-DDTHH-MM-SSZ          12345678  yes       5.2
2026-MM-DDTHH-MM-SSZ          11223344  yes       182.7
```

The recovery target is the most recent VERIFIED snapshot whose
`verifiedAt` was set BEFORE the failed install. If you are not sure
which one, inspect the manifests:

```
cat .planning/snapshots/<id>/manifest.json
```

The fields `paperclipVersion`, `installedPlugins`, `verifiedAt` tell
you what state that snapshot represents.

---

## Step 2 — Stop the live Paperclip

Ctrl+C the running Paperclip process. If it is running as a service,
stop the service. If the install left Paperclip in a half-running
state, kill it with extreme prejudice (it will not corrupt anything
important — the live instance dir is not being modified by anything
other than Paperclip itself).

Why this matters: the atomic-swap step (step 6) renames the live
instance dir. If Paperclip has open file handles into that dir,
Windows will block the rename and the swap will fail.

---

## Step 3 — Restore the snapshot to a sibling staging directory

```
pnpm clarity-safety restore <snapshot-id>
```

Expected output:

```
restore staged at: <home>/instances/default.restoring
staging db:        paperclip_restoring
next: pnpm clarity-safety verify <snapshot-id>  (plan 02)
```

What happens under the hood:

- The snapshot's tar.gz is extracted into a tmp dir under
  `<paperclip-home>/.clarity-safety-restore-<snapshot-id>/`.
- The instance subtree is renamed into
  `<paperclip-home>/instances/<id>.restoring/`.
- For Postgres mode: a sibling DB named `paperclip_restoring` is
  created and populated via `pg_restore` (the live DB is untouched).
- For PGlite mode: the staging dir's `db/` subtree is loaded from the
  snapshot's tarball.

The live `<paperclip-home>/instances/default/` is byte-identical to
what it was before this command. You can verify this with `git
status` if `.paperclip` is a git repo, or by comparing a few file
sha256 sums.

---

## Step 4 — Start a sibling Paperclip on the staging directory

This is the v1 manual step. v2 will automate it.

For PGlite mode:

1. Copy `<home>/instances/default.restoring/config.json` and edit any
   port references from 3100 to 3101 (or whatever alt port you prefer).
2. Set environment for this shell:
   ```
   export PAPERCLIP_HOME=<home>
   export PAPERCLIP_INSTANCE_ID=default.restoring
   export PAPERCLIP_API_URL=http://localhost:3101
   ```
3. `pnpm paperclipai start`

For Postgres mode: the same as PGlite, plus point the DSN at
`paperclip_restoring` (the staging DB):

```
export DATABASE_URL=postgresql://user:pass@host:5432/paperclip_restoring
```

Wait until Paperclip prints "ready on port 3101" (or its equivalent).

---

## Step 5 — Smoke the staging Paperclip

```
pnpm clarity-safety smoke <snapshot-id> \
  --api-url=http://localhost:3101 \
  --company-id=<your-company-id>
```

Expected on PASS: 5 PASS lines + plugin-list-cross-check PASS +
version-cross-check PASS (or `skipped` if Paperclip doesn't advertise
its version) + `smoke PASSED`.

On FAIL: do NOT proceed to step 6. The staging is not safe to swap
in. Investigate the smoke failure. Common causes:

- The sibling Paperclip on 3101 didn't actually start (check its
  logs).
- Wrong `--company-id`.
- The snapshot itself was corrupt (sha256 mismatch — but `restore`
  would have refused before extraction in that case).

If staging is unrecoverable, the safe move is to leave staging in
place, restart the live Paperclip, and call this a cold-restore
incident. The live system is still in its post-failed-install state;
you will need to roll back by hand or wait for a v2 strategy.

---

## Step 6 — Atomic swap (THE destructive step)

This is the only point in the rollback procedure that touches the
live instance dir. After this step, the live install is the restored
snapshot.

Stop the sibling Paperclip on port 3101 (Ctrl+C).

Then perform the atomic-swap. v1 does this manually with two `mv`
operations:

```bash
# POSIX
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
mv <home>/instances/default <home>/instances/default.pre-restore-$TS
mv <home>/instances/default.restoring <home>/instances/default
```

```powershell
# Windows PowerShell
$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ssZ"
Move-Item "$env:USERPROFILE\.paperclip\instances\default" "$env:USERPROFILE\.paperclip\instances\default.pre-restore-$ts"
Move-Item "$env:USERPROFILE\.paperclip\instances\default.restoring" "$env:USERPROFILE\.paperclip\instances\default"
```

For Postgres mode, also swap the database:

```sql
-- in psql, connected as a superuser
ALTER DATABASE paperclip RENAME TO paperclip_pre_restore_<ts>;
ALTER DATABASE paperclip_restoring RENAME TO paperclip;
```

If the platform's atomic rename refuses (e.g. Windows blocks because
some file is held open), kill any process that might be holding a
handle (file explorer, an editor with the config.json open) and retry.

---

## Step 7 — Restart the live Paperclip

`pnpm paperclipai start` (or your normal Paperclip start command).
Wait for it to come up on port 3100.

---

## Step 8 — Smoke vs. live to confirm the restore

```
pnpm clarity-safety smoke \
  --api-url=http://localhost:3100 \
  --company-id=<your-company-id>
```

Expected: 5 PASS lines + `smoke PASSED`. The live Paperclip is now
running the snapshot's state.

Optionally cross-check vs. the snapshot manifest:

```
pnpm clarity-safety smoke <snapshot-id> \
  --api-url=http://localhost:3100 \
  --company-id=<your-company-id>
```

Plugin-list and version cross-checks should match exactly — you are
running the snapshotted plugin set on the snapshotted Paperclip
version.

---

## Step 9 — Log the rollback

Append an entry to [REHEARSAL.md](REHEARSAL.md). Even though this
was a real rollback (not a drill), the log is the place to capture
what happened. Include the snapshot id, the failure mode that
triggered the rollback, and any anomalies you noticed.

---

## What if step 5 (staging smoke) FAILED?

Do NOT swap. Investigate. The live Paperclip is still in its
post-failed-install state — you have not made anything worse.

Options in increasing order of severity:

1. The sibling Paperclip didn't start cleanly. Check its logs, fix
   config, repeat step 4 + step 5.
2. The snapshot was created during a quiescent window but smoke
   requires data that never settled. Try an OLDER verified snapshot
   (`pnpm clarity-safety list` — pick one with an older verifiedAt).
3. All snapshots fail to smoke against the staging Paperclip. The
   issue is in the smoke pass itself or in your test data. At this
   point the rollback is beyond the scope of the safety CLI; restart
   the live Paperclip and address the failed install differently
   (manual SQL, plugin uninstall, etc.).

In all three cases, the live Paperclip is unmodified — that is the
guarantee of sibling-staging.

---

## What if step 6 (the rename) fails?

POSIX: `mv` should succeed on the same filesystem. If it fails with
`EXDEV` (cross-device link), you've put `.paperclip` on a different
mount from the snapshot extract. Move the staging dir into the same
filesystem as the live dir first, then rename.

Windows: a rename can fail if any process has a file open under the
live dir. Common culprits:

- The Paperclip process you thought you stopped is still running.
  `taskkill /F /IM paperclipai.exe` (or whatever the binary name is).
- An editor or file explorer has a file open. Close it.
- An antivirus is scanning. Wait, retry.

Until the rename succeeds, the live install is unchanged.

---

## What if step 8 (post-restore live smoke) FAILS?

You have just restored a snapshot that fails its own smoke pass.
This is bad but recoverable. The pre-restore live state is still
preserved at `default.pre-restore-<ts>` and (for Postgres)
`paperclip_pre_restore_<ts>`. Reverse the swap:

```bash
mv <home>/instances/default <home>/instances/default.failed-restore-<ts>
mv <home>/instances/default.pre-restore-<previous-ts> <home>/instances/default
```

(And the equivalent for the Postgres DB.)

Then restart Paperclip. You are back to the post-failed-install state
where you started this walk. From there, the failed install needs to
be addressed via a different mechanism (manual fix, support ticket,
older snapshot).
