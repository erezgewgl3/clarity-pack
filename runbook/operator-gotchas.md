# Operator Gotchas — Clarity Pack Safety CLI + Paperclip

**Purpose:** Append-only catalog of operator gotchas surfaced across Phase 1 + Phase 2 drills and spikes. Each entry was discovered the hard way (drill failure or spike surprise); future operators should be able to recognize the symptom and recover via the documented resolution without re-discovering.

**Conventions:**
- Sections are anchored by `§<slug>` IDs that other code (error messages, runbook prose) can reference textually.
- Append-only. Never delete a section — older Paperclip versions or different deployment shapes may still hit them.
- Each section: **Symptom**, **Discovered** (date + plan/drill source), **Why it happens**, **Resolution** (copy-paste commands where possible).

---

## §paperclip-restoring-db-precreate

**Symptom:** `clarity-safety restore <id>` against a Postgres-mode Paperclip fails with a Postgres error like `permission denied to create database "paperclip_restoring"` or `role "paperclip" is not permitted to create new databases`.

**Discovered:** 2026-05-13 Hostinger Countermoves rehearsal drill (Plan 01-04 anomalies block a).

**Why it happens:** `scripts/safety/lib/restore.mjs` uses `<dbName>_restoring` as the sibling-staging database name. On most production Postgres installs, the runtime role (e.g. `paperclip`) lacks `CREATEDB` privilege — by design.

**Resolution:** Pre-create the staging DB once, manually, before the first restore. Owner is the same role Paperclip uses:

```bash
sudo -u postgres psql -c 'CREATE DATABASE paperclip_restoring OWNER paperclip;'
```

After that, restores reuse the staging DB and the privilege issue does not recur. Long-term remediation (v2): either grant `CREATEDB` to the runtime role or add a pre-flight step in `restore.mjs` that mints the staging DB via an elevated connection.

---

## §instance-id-dot-rename

**Symptom:** After a restore, starting Paperclip against the sibling staging dir errors with `Invalid instance id 'default.restoring'. Allowed characters: letters, numbers, '_' and '-'.`

**Discovered:** 2026-05-13 Hostinger Countermoves rehearsal drill (Plan 01-04 anomalies block b).

**Why it happens:** `restore.mjs` uses `<instanceId>.restoring` as the staging dir name. Paperclip's CLI rejects instance IDs containing `.` as a hardcoded validation.

**Resolution (workaround):** Rename the staging dir before launching the sibling instance:

```bash
mv ~/.paperclip/instances/default.restoring ~/.paperclip/instances/default-restoring
PAPERCLIP_INSTANCE_ID=default-restoring pnpm paperclipai run
```

Long-term remediation (v2): change `restore.mjs`'s staging convention to use `-restoring` suffix instead of `.restoring`.

---

## §pnpm-dev-no-config-json

**Symptom:** `clarity-safety snapshot` against a freshly-cloned Paperclip dev instance fails with `config.json not found at <home>/instances/default/config.json`, OR `Cannot determine Paperclip DB mode from config.json`. The Paperclip dev-runner's boot banner reports the config path, but the file is absent on disk.

**Discovered:** 2026-05-13 Plan 02-01 Task 2 smoke spike (against a fresh `paperclipai/paperclip` clone on Windows).

**Why it happens:** `pnpm dev` boots Paperclip's API + embedded-postgres + UI middleware, but does NOT materialize `config.json` / `.env` / `secrets/`. That is `paperclipai onboard`'s job — the interactive first-run setup wizard.

**Resolution:** After cloning Paperclip locally and BEFORE invoking the safety CLI, run the non-interactive quickstart onboard:

```bash
cd ~/paperclip-clone
pnpm install
pnpm dev                   # boots in background; CTRL-C to release if needed
# In another terminal:
pnpm paperclipai onboard -y    # creates config.json + .env + secrets/
# Now safety CLI operations work.
```

Sequence for a fresh dev clone: **clone → pnpm install → pnpm dev → paperclipai onboard -y → safety CLI**.

---

## §embedded-postgres-hardcoded-creds

**Symptom:** Connecting psql or pg_dump to a `pnpm dev`-launched Paperclip's embedded-postgres with the obvious-looking creds (`postgres:postgres` / `postgres:` / empty password / role from config) fails with `password authentication failed for user "postgres"`. Paperclip's own bot can connect; you cannot.

**Discovered:** 2026-05-13 Plan 02-01 Task 2 smoke spike.

**Why it happens:** Paperclip's `server/src/index.ts` hardcodes the embedded-postgres role + password as `paperclip:paperclip` (NOT config-driven). The data dir's `pg_hba.conf` is set to `password` auth (not `trust`), so the password literal IS required.

**Resolution:** Use the hardcoded credentials verbatim:

```bash
# Connection string for an embedded-postgres-mode Paperclip dev instance:
postgresql://paperclip:paperclip@127.0.0.1:<embeddedPostgresPort>/paperclip

# Where <embeddedPostgresPort> comes from config.json's database.embeddedPostgresPort.
# Default port is 54329; verify against your config.json.
```

Plan 01-05 Task 2 added `detectConnectionConfig()` to `scripts/safety/lib/mode-detect.mjs` which auto-derives this URL — operators normally do NOT need to type it themselves. Pass `--db-url` only when overriding (e.g., hosted Postgres against a non-standard port).

---

## §pg-dump-version-mismatch

**Symptom:** `clarity-safety snapshot` against an embedded-postgres-mode Paperclip fails with `VersionMismatchError: pg_dump major version <X> cannot dump server version <Y>. PostgreSQL requires matching major version. ...`

**Discovered:** 2026-05-13 Plan 02-01 Task 2 smoke spike (Windows host).

**Why it happens:** Paperclip pins `@embedded-postgres/<platform>` to a major version (currently `18.1.0-beta.16`). pg_dump enforces a strict same-major-version policy because cross-major dumps can silently lose data. When the host's installed client tools are a different major than Paperclip's embedded server, pg_dump refuses to run.

This is most acute on Windows where:
- The `@embedded-postgres/windows-x64` package is **server-only** (no `pg_dump.exe` in its `native/bin/`)
- The latest stable PostgreSQL client distribution from `winget install PostgreSQL.PostgreSQL.17` is **17.x**, while Paperclip's embedded server is **18.1-beta**

Linux/macOS bundles of `@embedded-postgres/<platform>` generally DO ship matching client tools alongside the server. The locator (Plan 01-05 Task 1) tries the bundled path first, so on Linux/macOS the gotcha typically self-resolves.

**Resolution paths (pick one):**

1. **Match the client version (preferred when feasible).** Install pg_dump matching the embedded server's major version:
   - Linux: `apt install postgresql-client-18` (if your distro has 18; otherwise the apt 17 + paperclip's pin won't agree — same problem).
   - macOS: `brew install postgresql@18` if the formula exists, otherwise pin Paperclip's bundled version.
   - Windows: there is no winget package for 18 yet (beta-track only). Either install the 18-beta installer from postgresql.org/download, OR use resolution path 2 or 3 below.
2. **Restore-by-deletion for throwaway dev clones.** See `§restore-by-deletion-for-dev-clones` below. Bookended snapshot isn't possible against this clone, but the clone itself is disposable.
3. **Wait for Paperclip to pin a stable embedded-postgres major.** Track `paperclipai/paperclip` upstream; when they move off the 18-beta to a stable client-matched version, the gotcha disappears.

**Pass-the-explicit-binary workaround:** if you have pg_dump (any major) installed at a known path, you can force the safety CLI to use it via `--pg-bin <path>`. This bypasses the locator's PATH search but the version pre-check still runs — if the client major doesn't match the server, you'll still get `VersionMismatchError`. The flag is useful when the right pg_dump exists but isn't on PATH.

---

## §restore-by-deletion-for-dev-clones

**Symptom:** Snapshot bookending is unavailable (see §pg-dump-version-mismatch above) but you still need a clean rollback story for spikes / dev experiments against a Paperclip clone.

**Discovered:** 2026-05-13 Plan 02-01 Task 2 smoke spike (Windows host).

**Why it happens:** A throwaway Paperclip dev clone is rebuildable in minutes — `git clone + pnpm install + paperclipai onboard -y`. The state worth protecting is in your editor and git, not in the clone's database.

**Resolution:** When working against a throwaway dev clone (NOT BEAAA, NOT Hostinger Countermoves, NOT any production-shaped instance), the rollback path is filesystem deletion + re-onboard:

```bash
# Stop the dev server first if running:
cd ~/paperclip-clone
pnpm dev:stop

# Wipe Paperclip's per-instance state (data dir + config + secrets + db):
rm -rf ~/.paperclip/instances/default

# Re-onboard for the next experiment:
pnpm dev          # in one terminal
pnpm paperclipai onboard -y    # in another
```

Time: ~70 seconds. The git-tracked clone source is untouched.

**Do NOT use this against:**
- BEAAA — the data is irreplaceable; snapshot bookend is mandatory.
- Hostinger Countermoves — single dev/staging Paperclip; snapshot bookend works for it (hosted Postgres, matching client). Use safety CLI's snapshot/restore.
- Any Paperclip you'd be unhappy to lose. If unsure, snapshot first; restore-by-deletion is the FALLBACK for clones where loss is acceptable.

---

## §ac-autostatus-drill-proof

**Symptom:** the next drill's Step 9 (AC-toggle → Reader-refetch contract) finishes without recoverable evidence that the contract fired — the test issue's cached TL;DR was already current, AC sources were decoupled from the auto-status derivation, or AC markers were frozen.

**Discovered:** 2026-05-25 rc.6 drill `260524-sm8` (Plan 04.2-07 / Phase 4.2 addendum D-5).

**Why it happens:** the visible UI signals the drill expects to see change (TL;DR refresh + AC checklist state shift) can ALL be decoupled from the underlying contract for a given test issue. Concretely: a cache-warm TL;DR will not refresh visually because there is nothing new to render; AC markers whose toggle does not affect the auto-status derivation can flip without any downstream caption change; and an audit comment that froze AC state via canonical markers can mask the live re-derivation path. The drill closed PASS on the rc.6 run only because the operator observed the refetch via DevTools Network — not a documented step.

**Resolution:** Step 9 of every subsequent rc.X drill MUST capture either (a) a DevTools Network HAR or screenshot showing the `issue.reader` + `reader.ac.autostatus` refetch firing in response to a manual AC toggle, OR (b) a test issue with a cached TL;DR + ≥2 AC sources whose manual toggle materially changes the auto-status derivation (i.e. the visible auto-status caption text changes between the pre-toggle and post-toggle screenshots). Either proof is acceptable; one of the two MUST be recorded in the drill SUMMARY before the path is marked PASS.
