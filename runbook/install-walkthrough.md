# Install Walkthrough

The wrapped install — the daily command, broken into the smallest
sequence of named steps with the exact command and the expected
output. Use this the first few times. After that, the alias makes it
one line.

This walk assumes you have already done the rehearsal at least once
(see [rehearsal-drill.md](rehearsal-drill.md)) so you know the
sibling-Paperclip-on-alt-port pattern. If you have not, do that first.

---

## Pre-conditions

- Paperclip is running on a known URL (default `http://localhost:3100`).
- You have the Paperclip API key (the `PAPERCLIP_API_KEY` env var, or
  passed via `--api-key`).
- You have your company id (the `PAPERCLIP_COMPANY_ID` env var, or
  passed via `--company-id`).
- This repo is cloned and `pnpm -C scripts/safety install` has been
  run at least once.
- For Postgres mode: `pg_dump` is on PATH and its major version
  matches the Paperclip server's Postgres major version. See
  [PLATFORMS.md](PLATFORMS.md).

---

## Step 1 — Take the pre-install snapshot

```
pnpm clarity-safety snapshot
```

Expected output:

```
snapshot: 2026-MM-DDTHH-MM-SSZ
location: <abs-path>/.planning/snapshots/2026-MM-DDTHH-MM-SSZ
```

The directory contains:

- `manifest.json`
- `pglite-datadir.tar.gz` (PGlite mode) OR `postgres.dump` (Postgres mode)
- `instance-fs.tar.gz`

Record the snapshot id. You will use it in step 2.

---

## Step 2 — Verify the snapshot

This is where the operator-managed sibling Paperclip comes in. The v1
flow: start a sibling Paperclip on an alt port, then verify against
that URL. Verify will (a) restore the snapshot into a staging dir,
(b) smoke-test the staging via REST, (c) on PASS, write `verifiedAt`
back to the manifest atomically.

Start the sibling Paperclip (one-time setup; see
[rehearsal-drill.md](rehearsal-drill.md) Step 6 for the exact recipe
for your Paperclip mode). Suppose it's running on `http://localhost:3101`.

Then:

```
pnpm clarity-safety verify <snapshot-id> \
  --strategy=manual \
  --smoke-api-url=http://localhost:3101 \
  --company-id=<your-company-id>
```

Expected output on PASS:

```
verify PASSED
verifiedAt:           2026-MM-DDTHH:MM:SS.fffZ
verifiedSmokeChecks: health, issues, agents, plugins, heartbeat, plugin-list-cross-check, version-cross-check
```

If verify FAILS: stop. Do not proceed to step 3. The runbook in
[rollback-walkthrough.md](rollback-walkthrough.md) does not apply yet
(you have not installed anything). Investigate the smoke failure
first. Common causes:

- Wrong `--company-id` or wrong `--smoke-api-url`.
- The sibling Paperclip on the alt port is not actually running.
- The plugin list on the running Paperclip drifted from the snapshot
  (someone changed plugins between snapshot and verify — re-snapshot).

---

## Step 3 — Run the wrapped install

```
pnpm clarity-safety gate -- pnpm paperclipai plugin install clarity-pack
```

Expected output: the inner command's stdout streams through verbatim
(stdio is inherited). The gate is invisible on success. The exit code
of the inner command is propagated as the exit code of the gate.

If the gate refuses, it prints the refusal reason and the remediation
command. The most common refusal at this point is `snapshot-stale`
(more than 15 minutes elapsed between verify and install). Solution:
re-snapshot, re-verify, retry.

---

## Step 4 — Post-install smoke-test the LIVE Paperclip

Once the install completes, smoke the LIVE Paperclip (port 3100, NOT
the staging port from step 2):

```
pnpm clarity-safety smoke \
  --api-url=http://localhost:3100 \
  --company-id=<your-company-id>
```

Expected output: 5 PASS lines + `smoke PASSED`.

If you want a manifest cross-check (assert the LIVE install matches
the pre-install snapshot's plugin/version fingerprint plus the new
clarity-pack entry), pass `--snapshot-id <pre-install-id>`. The
plugin-list-cross-check will fail with the new clarity-pack entry as a
"rogue" — that's expected. To get a clean PASS post-install, take a
fresh snapshot AFTER the install:

```
pnpm clarity-safety snapshot
```

This becomes the bookend for the next install/upgrade/migration.

---

## Step 5 — Log to the rehearsal log (optional)

If this was a rehearsal install (not your daily flow), append an
entry to [REHEARSAL.md](REHEARSAL.md) using the documented format.
For routine production installs, the snapshot itself is the audit
trail.

---

## What if step 3 prints "gate REFUSED"?

The gate prints the exact remediation. Run the printed commands.
Re-attempt step 3. The gate's refusal is not a bug — it is the system
working.

The four refusal reasons and their remediations:

- `no-snapshot` → step 1 + step 2.
- `snapshot-not-verified` → step 2.
- `snapshot-stale` → step 1 + step 2 (a stale snapshot must be replaced, not re-verified).
- `manifest-unreadable` → step 1 + step 2.

---

## What if step 4 fails (live smoke FAILS post-install)?

The install ran but the system is broken. Go to
[rollback-walkthrough.md](rollback-walkthrough.md). The pre-install
snapshot from step 1 is your recovery target.

---

## What you have at the end of a clean install

- A pre-install snapshot at `.planning/snapshots/<pre-id>/` with
  `verifiedAt` set (proof that the pre-install state was healthy).
- A post-install smoke PASS (proof that the install worked).
- Optionally: a post-install snapshot. Take one if you intend to do
  another install/upgrade soon.

That's the whole loop.
