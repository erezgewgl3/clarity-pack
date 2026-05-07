# clarity-pack Safety Runbook

This directory is the operator's source of truth for installing,
upgrading, migrating, and (when needed) rolling back the clarity-pack
plugin against a Paperclip install. Every procedure documented here
works even when clarity-pack itself is broken or uninstalled, because
the safety tooling lives in `scripts/safety/` of this repo, not inside
the plugin.

If the plugin is gone, the runbook still walks. If the plugin is
broken, the rollback walk restores the bookend snapshot. If the gate
refuses, this runbook tells you what command will clear the refusal.

---

## Why this exists — the bookended-by-snapshots discipline

From PROJECT.md, locked decision:

> Every clarity-pack install, upgrade, migration, or agent registration
> against BEAAA's Paperclip is bookended by a verified snapshot taken
> immediately before, with restore-and-smoke tested before the operation
> begins. No exceptions during Phase 1; no "I'll snapshot after, it's
> fine" shortcuts.

That rule, in plain English: the snapshot is not a backup you take
"just in case." The snapshot is the gate. You do not install. You do
not upgrade. You do not migrate. You do not register an agent. Until
you have a fresh, verified snapshot whose restore-and-smoke passed.

The pre-flight gate enforces the rule at the keyboard. The runbook
explains why the gate will refuse you, and how to clear the refusal in
the smallest number of commands. SAFE-04 verbatim says this directory
walks the operator end-to-end from pre-install snapshot through
post-install verification through rollback in plain editorial English,
and works in any text editor. SAFE-05 verbatim says the gate refuses
when the most recent snapshot is older than 15 minutes or its
restore-and-smoke-test has not passed.

---

## TL;DR — the daily command

The wrapped install:

```
pnpm clarity-safety gate -- pnpm paperclipai plugin install clarity-pack
```

The gate consults the latest snapshot in `.planning/snapshots/`. If the
snapshot is fresh (verifiedAt within the last 15 minutes) and verified
(restore-and-smoke passed), the gate forwards the inner command verbatim
and propagates its exit code. Otherwise the gate refuses, prints the
remediation commands, and exits non-zero.

Suggested shell alias so daily use becomes a single word:

```bash
alias safe='pnpm clarity-safety gate --'
```

Then every install, upgrade, or migration is just:

```
safe pnpm paperclipai plugin install clarity-pack
safe pnpm paperclipai plugin upgrade clarity-pack
safe pnpm paperclipai plugin migrate clarity-pack
safe pnpm paperclipai agent register clarity-pack-reader
```

If the gate refuses, the remediation command is one of two short
recipes (snapshot, or snapshot+verify). See "Pre-flight: take a
snapshot" below.

---

## The four verbs

The safety CLI surfaces seven subcommands. Four of them are the daily
verbs. The other three (list, prune, smoke) are operator utilities.

| Verb       | What it does                                                                 |
|------------|------------------------------------------------------------------------------|
| `snapshot` | Captures the live Paperclip install: DB dump + filesystem tar + manifest.    |
| `verify`   | Restores the snapshot to a sibling staging dir, smoke-tests it, sets verifiedAt. |
| `gate`     | Refuse-or-run wrapper. Refuses unless latest snapshot is fresh + verified.   |
| `restore`  | Restores a chosen snapshot into a sibling staging dir. The live dir is untouched. |

For step-by-step procedures see:

- The wrapped install: [install-walkthrough.md](install-walkthrough.md)
- A failed install or migration: [rollback-walkthrough.md](rollback-walkthrough.md)
- The first end-to-end drill against a fresh Paperclip clone: [rehearsal-drill.md](rehearsal-drill.md)
- Per-platform install of pg_dump / pnpm / Node: [PLATFORMS.md](PLATFORMS.md)
- The drill log itself: [REHEARSAL.md](REHEARSAL.md)

The safety CLI's full surface (printed by `pnpm clarity-safety --help`):

```
snapshot   Capture a Paperclip install (DB + filesystem + manifest).
restore    Restore a snapshot into a sibling staging dir (never live).
smoke      Smoke-test a restored env against its manifest.
verify     Restore-to-staging then smoke; sets verifiedAt.
gate       Refuse-or-run wrapper around an inner command.
list       Enumerate snapshots under .planning/snapshots/.
prune      Delete old snapshots; preserves <24h.
```

---

## Pre-flight: take a snapshot

Before any install/upgrade/migration/registration, take a snapshot.

### Environment variables to set first

The CLI reads these env vars and falls back to documented defaults
otherwise. Set them once per shell session.

| Var                       | Required           | Default / behavior                               |
|---------------------------|--------------------|--------------------------------------------------|
| `PAPERCLIP_HOME`          | optional           | `$HOME/.paperclip` (POSIX) / `%USERPROFILE%\.paperclip` (Windows) |
| `PAPERCLIP_INSTANCE_ID`   | optional           | `default`                                        |
| `PAPERCLIP_API_URL`       | for verify/smoke   | the URL of the running Paperclip; e.g. `http://localhost:3100` |
| `PAPERCLIP_API_KEY`       | for verify/smoke   | the Bearer token for Paperclip's REST API        |
| `PAPERCLIP_COMPANY_ID`    | for verify/smoke   | the company id used by `/agents` endpoint        |
| `PAPERCLIP_AGENT_ID`      | optional           | enables the heartbeat smoke check                |

### Take the snapshot

```
pnpm clarity-safety snapshot
```

What you should see:

- A snapshot id printed in the form `2026-MM-DDTHH-MM-SSZ`.
- A directory created at `.planning/snapshots/<id>/` containing:
  - `manifest.json` — the snapshot contract (version, plugins, sha256, verifiedAt:null).
  - `pglite-datadir.tar.gz` (PGlite mode) OR `postgres.dump` (Postgres mode).
  - `instance-fs.tar.gz` — the Paperclip filesystem tree.
- A summary line printing the size + the snapshot id.

If `pg_dump` is missing in Postgres mode, the CLI prints a
platform-specific install hint. See [PLATFORMS.md](PLATFORMS.md).

PGlite mode does NOT need pg_dump. The snapshot uses
`@electric-sql/pglite`'s built-in `.dumpDataDir('gzip')`.

---

## Verify the snapshot

```
pnpm clarity-safety verify <snapshot-id> --strategy=manual --smoke-api-url=http://localhost:3101 --company-id=<your-company-id>
```

What `verify` does:

1. Restores the snapshot into a sibling staging directory (the live
   instance dir is byte-identical before and after — the staging is
   strictly additive at `<paperclip-home>/instances/<id>.restoring/`).
2. Smoke-tests the staging instance via REST. The 5 base checks are:
   `/health`, `/api/issues?limit=1`, `/api/companies/<id>/agents`,
   `/api/plugins`, and a heartbeat POST. Plus two cross-checks against
   the manifest: plugin set equality (always required) and
   paperclip-version equality (skipped if the server doesn't advertise
   its version).
3. On smoke PASS, atomically writes `verifiedAt` and
   `verifiedSmokeChecks` back into the manifest. The pre-flight gate
   reads `verifiedAt` and considers the snapshot "fresh" if that value
   is within 15 minutes of now.
4. On smoke FAIL, the manifest is unchanged (verifiedAt remains null).
   The staging dir is preserved for inspection. The gate will refuse
   to forward against this snapshot.

In v1, the operator manually starts the sibling Paperclip on an alt
port (the runbook walks through the steps). v2 will spawn the sibling
automatically. See [rehearsal-drill.md](rehearsal-drill.md) for the
exact procedure.

---

## Install (or upgrade or migrate or register an agent)

Once the latest snapshot is verified, wrap the install with `gate`:

```
pnpm clarity-safety gate -- pnpm paperclipai plugin install clarity-pack
```

What gate refusal looks like:

```
gate REFUSED (no-snapshot):
No fresh + verified snapshot found. Run:
  pnpm clarity-safety snapshot
  pnpm clarity-safety verify <new-snapshot-id>
```

The four refusal reasons:

| Refusal reason             | What it means                                       | How to clear it                                          |
|----------------------------|-----------------------------------------------------|----------------------------------------------------------|
| `no-snapshot`              | No snapshot exists under `.planning/snapshots/`.    | `snapshot` then `verify`.                                |
| `snapshot-not-verified`    | Latest snapshot has `verifiedAt: null`.             | `verify <snapshot-id>` against a sibling Paperclip.      |
| `snapshot-stale`           | Latest snapshot's `verifiedAt` is older than 15 min.| Take a new snapshot, then verify it.                     |
| `manifest-unreadable`      | The manifest.json is missing or malformed.          | Take a new snapshot.                                     |

To use a different freshness window:

```
pnpm clarity-safety gate --max-age=30 -- <inner-command>
```

The default is 15 minutes per SAFE-05 verbatim. Increasing the window
for a slow rehearsal is fine; setting it to hours defeats the purpose.

---

## Post-install verify

Once the install/upgrade/migration completes, smoke-test the LIVE
Paperclip (not the staging) to confirm it still works:

```
pnpm clarity-safety smoke --api-url=http://localhost:3100 --company-id=<your-company-id>
```

This is the same 5-check pass run by `verify`, but against the live URL
without restoring anything. If it passes, the install was a success.
If it fails, see [rollback-walkthrough.md](rollback-walkthrough.md).

If you want a manifest cross-check (plugin set + version), pass
`--snapshot-id <pre-install-id>` so the smoke pass also asserts the
running install matches the pre-install snapshot's plugin/version
fingerprint plus the new clarity-pack entry.

---

## Rollback

If the install went wrong, see [rollback-walkthrough.md](rollback-walkthrough.md)
for the full procedure. One-paragraph summary: identify the most
recent verified snapshot via `pnpm clarity-safety list`, stop the live
Paperclip, run `pnpm clarity-safety restore <snapshot-id>` (this stages
into a sibling dir; the live dir is untouched), start a sibling
Paperclip on an alt port, smoke against staging, and on PASS perform
the atomic-swap (rename live aside, rename staging into place, restart
live). On FAIL leave staging for inspection; do NOT touch live.

---

## Where to store snapshots safely

`.planning/snapshots/` is gitignored. Every snapshot includes
`secrets/master.key` (unless `--exclude-secrets` is set, which the
runbook does NOT recommend in normal operation — the secrets are
needed for a successful restore).

DO NOT sync `.planning/snapshots/` to OneDrive, Dropbox, Google Drive,
or any unencrypted shared cloud storage. Anyone with read access to
the synced folder gets the master.key.

Acceptable storage targets:

- An encrypted external drive (BitLocker-encrypted USB; LUKS-encrypted; APFS-encrypted DMG).
- An age-encrypted or gpg-encrypted archive uploaded to cloud (encrypt before upload).
- A separate machine in your physical possession that does not auto-sync.

If you find yourself wanting to sync snapshots to a shared drive,
that is a signal to take a fresh snapshot on the new machine instead
of moving the existing one.

---

## Pruning old snapshots

```
pnpm clarity-safety prune --keep 10 --keep-verified 3
```

Defaults: keep the 10 newest snapshots, of which at least 3 must be
verified. Snapshots younger than 24 hours are NEVER deleted by prune
(this is a safety floor — recent snapshots are the most likely
recovery target). Pass `--dry-run` to see what would be deleted
without actually deleting.

---

## Bypass discipline

The gate exposes a `--gate-bypass` escape hatch. It IS NOT FOR DAILY
USE. Bypass exists for the rare case where the safety CLI itself is
broken or where you need to run an inner command that the gate cannot
reasonably check (e.g. an emergency rollback when no snapshot exists
yet).

Bypass requires both:

1. The literal token `--gate-bypass` in the inner command argv. (The
   flag passes through to your inner command; if your inner command
   rejects unknown flags, you can put it after a `--` separator the
   inner command treats as end-of-options.)
2. The env var `CLARITY_SAFETY_BYPASS=I_KNOW=$(node -e "console.log(Date.now())")`
   set in the SAME shell invocation. The unix-millisecond timestamp must
   be within 60 seconds of when the gate runs. The constant is
   `BYPASS_ENV_FRESHNESS_MS = 60_000` in `scripts/safety/lib/gate.mjs`.

Every honored bypass is logged to `runbook/REHEARSAL.md` (or stderr if
the file is unwritable) with the timestamp, the inner command, and the
reason. The audit trail is permanent.

Reasoning: if you find yourself bypassing more than once a quarter,
the design is wrong, not the gate. The gate's refusal reasons are
short and the remediation commands are two lines. If the friction is
genuine (snapshot too slow on your hardware, sibling-Paperclip setup
too painful), revise the design — adjust `--max-age`, prune
aggressively, automate the sibling start. Don't normalize bypass.

Example bypass invocation (one shell line, on Linux/macOS):

```
CLARITY_SAFETY_BYPASS=I_KNOW=$(node -e 'console.log(Date.now())') \
  pnpm clarity-safety gate -- some-emergency-command --gate-bypass
```

On Windows PowerShell:

```powershell
$env:CLARITY_SAFETY_BYPASS = "I_KNOW=$(node -e 'console.log(Date.now())')"
pnpm clarity-safety gate -- some-emergency-command --gate-bypass
```

After running, inspect `runbook/REHEARSAL.md` for the bypass audit
entry. If it's not there, the gate did NOT honor the bypass — likely
the env timestamp was too stale or malformed.

---

## When this is broken — no Node, no pnpm, no pg_dump

If the safety CLI cannot run because of a missing dependency, see
[PLATFORMS.md](PLATFORMS.md) for per-platform install steps. The
runbook is plain markdown viewable in any editor — even with no
toolchain, you can read the procedures and execute them by hand
(`pg_dump`, `tar`, `mv` are all standard utilities).

If clarity-pack itself is broken or uninstalled, the safety CLI still
runs from this repo. The pre-install snapshot and the rollback
procedure do not depend on clarity-pack being functional. SAFE-04
verbatim: the runbook works even when clarity-pack itself is broken
or uninstalled.

---

## Reading order, first time

1. This README (you are here).
2. [PLATFORMS.md](PLATFORMS.md) — make sure your toolchain is installed.
3. [rehearsal-drill.md](rehearsal-drill.md) — run the drill once against a non-production Paperclip.
4. [install-walkthrough.md](install-walkthrough.md) — your first wrapped install.
5. [rollback-walkthrough.md](rollback-walkthrough.md) — keep this open the first few real installs.

Subsequent reading: the README is the index; you'll usually jump
straight to one of the walkthroughs.
