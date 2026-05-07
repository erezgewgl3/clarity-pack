# Phase 1: Pre-Install Safety — Research

**Researched:** 2026-05-07
**Domain:** Operational safety scaffolding for a self-hosted Paperclip install — Postgres + filesystem snapshot, restore, smoke-test, runbook, and pre-flight gate; lives in this repo's `runbook/` and `scripts/` directories, NOT inside the plugin code.
**Confidence:** HIGH on Paperclip's data-dir layout and what an install mutates (fetched verbatim from PLUGIN_SPEC.md §8 and DATABASE.md on `master` branch). HIGH on cross-platform Node tooling (`tar@7.5.15`, `node:zlib`, manifest JSON). MEDIUM on the dev-vs-prod Postgres backend split (PGlite for `pnpm onboard`, hosted Postgres for production) — this is the largest operational forking point in the design and is called out as Conflict 1 below. MEDIUM on whether `pg_dump` will be on Eric's PATH on Windows tomorrow — flagged in Environment Availability and as an Open Question.

> **Source convention.** "PLUGIN_SPEC §8" = `doc/plugins/PLUGIN_SPEC.md` on the `paperclipai/paperclip` master branch. All Paperclip URLs use `/blob/master/...` per Locked Decision #9.

---

## Summary

Phase 1 ships **safety scaffolding for human use, not feature code.** Nothing in this phase imports `@paperclipai/plugin-sdk`. The deliverables are five things that live in this repo and survive a broken or uninstalled clarity-pack:

1. A one-command **snapshot** that captures everything a Paperclip install can lose: the Postgres database (or the PGlite datadir if dev mode), the filesystem `data/` and `secrets/` and `plugins/node_modules/` and `config.json` under `~/.paperclip/instances/<id>/`, the Paperclip version, and the installed-plugin list.
2. A one-command **restore** that reverses any snapshot byte-for-byte, with a staged-then-rename failure mode so a failed restore doesn't leave Paperclip in pieces.
3. A one-command **smoke-test** that verifies a restored snapshot is functionally equivalent to the pre-snapshot environment (Paperclip starts, REST `/health` answers, sample issue listable, agent heartbeat fetch succeeds, employee list renders).
4. A plain-English **runbook** (`runbook/README.md`) walking pre-install snapshot → install → post-install verify → rollback, written so Eric can execute it tomorrow on his fresh local Paperclip without any prior context.
5. A **pre-flight gate** that refuses to run any clarity-pack install/upgrade/migration/agent-registration step unless a fresh-and-verified snapshot exists. Implemented as a wrapper script the user runs *instead of* `pnpm paperclipai plugin install clarity-pack` directly.

**Primary recommendation:** Build a single Node CLI (`scripts/clarity-safety.mjs`) with subcommands `snapshot`, `restore`, `smoke`, `gate`, distributed via this repo (committed, not npm-published). The CLI runs on Node 20+ which is already a hard prerequisite for Paperclip itself (Stack Locked Decision: Node ≥20). Cross-platform behavior (Windows, macOS, Linux) comes for free because Node is the common substrate; platform-specific calls (`pg_dump`, `tar`, `pglite`) are dispatched through small adapter functions. Wrap with a thin PowerShell launcher `runbook/snapshot.ps1` and a Bash launcher `runbook/snapshot.sh` so Eric can invoke from his shell of choice without typing `node scripts/...`.

The discipline this delivers is: **before any clarity-pack action against BEAAA, run `clarity-safety gate -- pnpm paperclipai plugin install clarity-pack`**, which (a) verifies a fresh snapshot exists and its restore-and-smoke-test has passed within the last 15 minutes, (b) refuses to run if not, (c) executes the inner command if so. This is a **bookended-by-snapshots wrapper**, not a pre-commit hook (clarity-pack is not yet a repo whose commits we gate; the gating point is the install command itself).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Postgres dump (logical backup of clarity-pack-relevant data) | Local CLI on the Paperclip host | — | `pg_dump`/PGlite tools must run on a machine that can read the Paperclip DB; in single-tenant filesystem-persistent deployment that's the same machine as Paperclip. [VERIFIED: PLUGIN_SPEC §1 deployment notes] |
| Filesystem archive of `~/.paperclip/instances/<id>/` | Local CLI on the Paperclip host | — | Needs read access to the data dir Paperclip writes into. [VERIFIED: PLUGIN_SPEC §8.1] |
| Snapshot manifest assembly (version, plugin list, timestamps, sha256s) | Local CLI on the Paperclip host | Paperclip REST API | Read Paperclip version + plugin list from the running server's API; capture file checksums locally. [CITED: PLUGIN_SPEC §8.2 `paperclipai plugin list`] |
| Smoke-test (REST liveness + listIssues + heartbeat-context + employee list) | Local CLI on the Paperclip host | Paperclip REST API | Smoke-test runs HTTP requests against `localhost:3100` (or configured `PAPERCLIP_API_URL`). [VERIFIED: STACK.md §4 — `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY` env vars] |
| Pre-flight gate (refuse install if no fresh snapshot) | Local CLI shell wrapper | — | The gate is a wrapper around `pnpm paperclipai plugin install`; runs entirely on the operator's machine. [ASSUMED] |
| Runbook (plain-English doc) | This repo's `runbook/` | — | Markdown only; no runtime tier. |
| Restore-of-the-rollback (recovery if restore fails partway) | Local CLI on the Paperclip host | Filesystem (sibling-staging dir) | Stage restored data into a sibling dir; atomic rename only after smoke-test passes. [ASSUMED — pattern is industry-standard for atomic deploys] |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | ≥20 LTS | Runtime for the CLI | Already a Paperclip hard prerequisite (Stack Locked Decision); avoids a second runtime. [VERIFIED: PLUGIN_SPEC §1 `engines.node = ">=20"`] |
| `tar` (npm) | `^7.5.15` | Pure-JS tarball create/extract for filesystem archive | Latest stable; **must be ≥7.5.11 to fix CVE-2026-31802** (drive-relative path traversal on Windows). Pure JS, cross-platform, no native bindings. [VERIFIED: `npm view tar version` returned `7.5.15`; CVE fix per windowsforum.com / windowsnews.ai] |
| `node:zlib` | built-in | gzip/deflate streams used by `tar` and standalone | Built into Node, zero dep cost. [VERIFIED: Node 20+ docs] |
| `node:crypto` | built-in | sha256 manifest checksums for archive integrity verification | Built into Node, zero dep cost. [VERIFIED: Node 20+ docs] |
| `node:child_process` (`spawn`) | built-in | Invoking `pg_dump`, `pg_restore`, and `pnpm paperclipai` subprocesses | Built into Node, cross-platform; `spawn` with `shell: false` avoids quoting bugs. [VERIFIED: Node 20+ docs] |
| `pg_dump` / `pg_restore` (system binary) | PostgreSQL 17 client tools | Logical Postgres backup/restore | Paperclip pins Postgres 17; client tools must match server major version. [VERIFIED: DATABASE.md "PostgreSQL 17"] |
| `@electric-sql/pglite` | `^0.4.5` | PGlite `dumpDataDir()` and `loadDataDir` for dev-mode embedded DB | Required only when Paperclip is running in `pnpm onboard` / embedded mode (the user's tomorrow scenario). [VERIFIED: `npm view @electric-sql/pglite version` returned `0.4.5`; pglite.dev/docs/api §dumpDataDir] |
| `cross-spawn` (npm) | `^7.0.6` | Cross-platform child_process.spawn (handles Windows `.cmd`/`.exe` resolution) | Wraps `child_process.spawn` to fix Windows-specific binary resolution that breaks for `pnpm` and `pg_dump.exe`. [CITED: well-known Node ecosystem standard] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `commander` (npm) | `^12.x` | CLI argument parsing | When subcommand UX (`snapshot`, `restore`, `smoke`, `gate`) becomes large enough that hand-rolled `process.argv` parsing is brittle. Optional — for v1 a 50-line hand-rolled dispatcher is fine. [ASSUMED] |
| `picocolors` (npm) | `^1.1.x` | Terminal color output for the runbook | Cosmetic; the smoke-test output should distinguish PASS/FAIL clearly. Optional. [ASSUMED] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node CLI + Node `tar` package | Native `tar` + `pg_dump` shell script (`runbook/snapshot.sh`) | Bash-only; doesn't run on Windows out-of-box. Eric's machine is Windows 11 — disqualified. |
| Node CLI + Node `tar` package | PowerShell `Compress-Archive` | Windows-only by default; PowerShell Core (`pwsh`) is cross-platform but adds a runtime dep that Paperclip doesn't already require. |
| Node CLI + Node `tar` package | 7-Zip CLI (`7z`) | Adds a non-Node binary dep that's not present on a fresh Linux/macOS host. Rejected. |
| Logical Postgres dump (`pg_dump -Fc`) | Physical replica via `pg_basebackup` | `pg_basebackup` requires WAL streaming and superuser; overkill for a single-tenant dev DB and doesn't work for PGlite at all. Rejected. |
| Logical Postgres dump | ZFS / APFS / Btrfs filesystem snapshot of the data dir (cold, with Paperclip stopped) | Filesystem-level is fastest and atomic but requires a specific filesystem; not portable across the three target OSes. Rejected for v1; mention as a v2 optimization. |
| `pg_dump` custom format with zstd | `pg_dump` plain SQL with gzip | Plain SQL is largest and slowest to restore; custom format with zstd is the 2026 best practice for size+speed. [CITED: cyounkins.medium.com — "zstd offers the best balance"; kmoppel.github.io — "If you need the very smallest file, use the highest zstd level"]. **Caveat:** PostgreSQL 17 supports zstd in `pg_dump`; PG ≤14 does not — verify Paperclip's actual server version before locking the choice. |

**Installation (in this repo):**

```bash
pnpm add -D tar @electric-sql/pglite cross-spawn
# pg_dump / pg_restore are system binaries; install separately per platform:
#   Windows:   choco install postgresql17 / scoop install postgresql / winget install PostgreSQL.PostgreSQL.17
#   macOS:     brew install postgresql@17
#   Linux:     apt-get install postgresql-client-17 / dnf install postgresql17
```

**Version verification (as of 2026-05-07):**
- `tar@7.5.15` — published 2026-04-26 per npm registry. [VERIFIED: `npm view tar version`]
- `@electric-sql/pglite@0.4.5` — `latest` dist-tag; `0.3.0-next.1` is the next pre-release. [VERIFIED: `npm view @electric-sql/pglite dist-tags`]
- Node `v24.14.0` is on the harness; user's machine is unknown — runbook must require Node ≥20 explicitly.

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        User invokes (Windows 11 PowerShell)               │
│                                                                            │
│   pnpm clarity-safety snapshot                ◀── normal pre-install      │
│   pnpm clarity-safety restore <snapshot-id>   ◀── rollback drill          │
│   pnpm clarity-safety smoke <snapshot-id>     ◀── verify a restore        │
│   pnpm clarity-safety gate -- <inner-cmd>     ◀── refuse-or-run wrapper   │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              Node CLI (scripts/clarity-safety.mjs, Node ≥20)              │
│                                                                            │
│   ┌──────────────────────────┐  ┌──────────────────────────────────────┐ │
│   │ Detect Paperclip mode    │  │ Read PAPERCLIP_HOME, PAPERCLIP_*,    │ │
│   │ ── PGlite (embedded) vs  │  │ resolve instance dir, parse          │ │
│   │ ── Postgres (DSN)        │  │ config.json                          │ │
│   └─────────────┬────────────┘  └────────────┬─────────────────────────┘ │
│                 │                              │                            │
│                 ▼                              ▼                            │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                    snapshot subcommand                            │   │
│   │                                                                    │   │
│   │   1. Probe REST /health (200?), record Paperclip version          │   │
│   │   2. List installed plugins via                                    │   │
│   │      `pnpm paperclipai plugin list --json`                         │   │
│   │   3. DB dump:                                                      │   │
│   │      ── PGlite mode: import('@electric-sql/pglite')               │   │
│   │           .dumpDataDir('gzip') → .tar.gz                           │   │
│   │      ── Postgres mode: spawn pg_dump --format=custom               │   │
│   │           --compress=zstd:6 --no-owner --no-privileges             │   │
│   │   4. Filesystem archive of:                                        │   │
│   │           data/ (work-products), secrets/, config.json,            │   │
│   │           plugins/package.json, plugins/.cache/ (skip),            │   │
│   │           NOT plugins/node_modules/ (regenerable from package.json)│   │
│   │      via tar.c({ gzip: true, file: …, cwd: PAPERCLIP_HOME })       │   │
│   │   5. Write manifest.json (sha256 each artifact, paperclip          │   │
│   │      version, plugin list, mode, timestamp, hostname, gitSha)      │   │
│   │   6. Bundle into .planning/snapshots/<ISO-timestamp>/              │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                    restore subcommand                             │   │
│   │                                                                    │   │
│   │   1. Verify manifest.json sha256s match every artifact            │   │
│   │   2. Stop Paperclip server (or detect not-running)                 │   │
│   │   3. Stage filesystem: extract to                                  │   │
│   │      ~/.paperclip/instances/<id>.restoring/                        │   │
│   │   4. Restore DB:                                                   │   │
│   │      ── PGlite: write the gzipped datadir tarball; PGlite          │   │
│   │           re-init reads it via loadDataDir                         │   │
│   │      ── Postgres: pg_restore --clean --if-exists                   │   │
│   │           --single-transaction (rollback-on-any-error)             │   │
│   │   5. Smoke-test against the restored env (see smoke subcmd)        │   │
│   │   6. If smoke passes: atomic rename                                │   │
│   │      ~/.paperclip/instances/<id> → <id>.pre-restore-<ts>           │   │
│   │      ~/.paperclip/instances/<id>.restoring → <id>                  │   │
│   │      Restart Paperclip                                             │   │
│   │   7. If smoke fails: leave .restoring/ in place, do NOT touch      │   │
│   │      <id>; log failure with manifest path so the user can          │   │
│   │      retry or investigate                                          │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                    smoke subcommand                               │   │
│   │                                                                    │   │
│   │   Sequential checks against PAPERCLIP_API_URL (default localhost) │   │
│   │   each with a 5s timeout; all-or-nothing PASS:                     │   │
│   │     1. GET /health → 200                                           │   │
│   │     2. GET /api/issues?limit=1 → 200, returns array                │   │
│   │     3. POST /api/agents/<editor-agent-id>/heartbeat/invoke         │   │
│   │        with empty payload → 200 OR clean 4xx (server alive)        │   │
│   │     4. GET /api/companies/<id>/agents → 200, returns array         │   │
│   │     5. GET /api/plugins → returns array; cross-check with          │   │
│   │        manifest.plugins (set equality)                             │   │
│   │   Returns exit 0 on PASS, exit non-zero on any FAIL with the       │   │
│   │   specific check name in the failure message.                      │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                    gate subcommand (the pre-flight wrapper)       │   │
│   │                                                                    │   │
│   │   Usage: clarity-safety gate -- <inner command and args>          │   │
│   │                                                                    │   │
│   │   1. Find latest .planning/snapshots/<ts>/ (mtime descending)      │   │
│   │   2. Read its manifest.json:                                       │   │
│   │       ── Was this snapshot's restore-and-smoke verified?           │   │
│   │          (look for verifiedAt: ISO-string, set by `verify` cmd)    │   │
│   │       ── Is verifiedAt within --max-age (default 15 minutes)?      │   │
│   │   3. If yes: spawn the inner command, inherit stdio, exit with    │   │
│   │      its code                                                      │   │
│   │   4. If no: print exact command to run                             │   │
│   │      (`pnpm clarity-safety snapshot && pnpm clarity-safety verify  │   │
│   │      <ts>`) and exit 1                                             │   │
│   └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                Targets the snapshot/restore touches                       │
│                                                                            │
│   Postgres / PGlite                Filesystem under PAPERCLIP_HOME        │
│   ──────────────────────            ─────────────────────────────         │
│   public.* (issues, agents,         ~/.paperclip/instances/<id>/          │
│     comments, work_products,           ├── config.json                    │
│     companies, projects,                ├── db/         ◀ PGlite datadir  │
│     activity_log, …)                    ├── data/                          │
│   plugin_database_namespaces            │   ├── storage/  ◀ work-products │
│   plugin_migrations                     │   └── plugins/<plugin-id>/      │
│   plugin_state                          ├── secrets/                       │
│   plugin_jobs / job_runs                │   └── master.key                 │
│   plugin_webhook_deliveries             ├── plugins/                       │
│   plugin_<id>_<hash>.* (per             │   ├── package.json                │
│     plugin namespace)                   │   ├── node_modules/  ◀ skip      │
│                                         │   └── .cache/        ◀ skip      │
│                                         └── logs/             ◀ optional  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
clarity-pack/
├── runbook/                          ← Phase 1 deliverable; plain English
│   ├── README.md                     ← The runbook (pre-flight → install → verify → rollback)
│   ├── snapshot.ps1                  ← Windows PowerShell launcher (1-liner: node scripts/...)
│   ├── snapshot.sh                   ← macOS/Linux Bash launcher (1-liner)
│   ├── REHEARSAL.md                  ← Drill log; "Run on a non-prod Paperclip clone before BEAAA"
│   └── PLATFORMS.md                  ← Per-platform install of pg_dump
│
├── scripts/                          ← Phase 1 deliverable; the CLI
│   ├── clarity-safety.mjs            ← Node CLI entrypoint (subcommand dispatcher)
│   ├── lib/
│   │   ├── detect-mode.mjs           ← PGlite vs Postgres detection
│   │   ├── snapshot.mjs              ← snapshot subcommand impl
│   │   ├── restore.mjs               ← restore subcommand impl
│   │   ├── smoke.mjs                 ← smoke-test subcommand impl
│   │   ├── verify.mjs                ← restore-then-smoke; sets verifiedAt in manifest
│   │   ├── gate.mjs                  ← pre-flight refuse-or-run wrapper
│   │   ├── manifest.mjs              ← sha256 + JSON manifest emit/read/verify
│   │   ├── paperclip-api.mjs         ← thin REST client for /health, /api/issues, etc.
│   │   └── paths.mjs                 ← resolve PAPERCLIP_HOME / PAPERCLIP_INSTANCE_ID
│   └── package.json                  ← scoped to the CLI's deps (tar, pglite, cross-spawn)
│
├── tests/safety/                     ← Phase 1 unit tests
│   ├── manifest.test.mjs             ← sha256 emit/verify round-trip
│   ├── detect-mode.test.mjs          ← detect PGlite-vs-Postgres from config.json fixtures
│   ├── smoke-stub.test.mjs           ← smoke-test against a stubbed Paperclip REST shape
│   └── fixtures/
│       ├── paperclip-pglite-config.json
│       ├── paperclip-postgres-config.json
│       └── stub-server.mjs           ← a 100-line http server that mimics 5 endpoints
│
└── .planning/
    └── snapshots/                    ← gitignored; one dir per snapshot
        └── 2026-05-08T14-32-17Z/
            ├── manifest.json         ← sha256s, version, plugin list, verifiedAt
            ├── postgres.dump         ← pg_dump custom-format OR pglite-datadir.tar.gz
            ├── instance-fs.tar.gz    ← data/ + secrets/ + config.json + plugins/package.json
            └── stdout-stderr.log     ← capture from pg_dump and tar
```

### Pattern 1: Sibling-staging restore (atomic on success, leave-alone on failure)

**What:** Extract the snapshot into `~/.paperclip/instances/<id>.restoring/`. Run the smoke-test against this staged dir (with `PAPERCLIP_HOME` overridden if needed). Only on PASS do we atomically rename: current `<id>/` → `<id>.pre-restore-<ts>/`, then `<id>.restoring/` → `<id>/`. On FAIL, the `.restoring/` dir is left untouched for inspection and the live `<id>/` is never modified.

**When to use:** Every restore. Always. Eric should never end up with a half-restored instance dir.

**Why:** A naive restore that overwrites `<id>/` in place has two failure modes — pg_restore fails after the filesystem was already overwritten, or tar extract fails after pg_restore committed — both leave Paperclip in a state worse than the pre-restore state. Sibling-staging guarantees the live dir is never touched until everything is verified.

**Tradeoff:** Doubles disk during the restore window. For a single-tenant dev DB this is ~hundreds of MB at worst; not an issue.

**Source:** [ASSUMED — pattern is industry-standard for atomic deploys; e.g., Capistrano-style `current/` symlink, blue/green file deploys]

### Pattern 2: Manifest as source of truth, archive as artifact

**What:** Every snapshot dir contains a `manifest.json` that is the *contract* of what the snapshot is. The actual `.dump` and `.tar.gz` files are interchangeable artifacts. The manifest records:

```json
{
  "snapshotId": "2026-05-08T14-32-17Z",
  "createdAt": "2026-05-08T14:32:17.043Z",
  "createdBy": { "user": "eric", "host": "ERIC-WIN11" },
  "paperclipVersion": "0.41.2",
  "paperclipMode": "pglite",
  "paperclipHome": "/Users/eric/.paperclip",
  "paperclipInstanceId": "default",
  "installedPlugins": [
    { "id": "paperclip.kitchen-sink-example", "version": "0.1.0", "status": "ready" }
  ],
  "artifacts": {
    "db": { "path": "postgres.dump", "format": "pg_dump-custom-zstd6", "sha256": "ab12...", "sizeBytes": 4_823_551 },
    "fs": { "path": "instance-fs.tar.gz", "sha256": "cd34...", "sizeBytes": 12_881_042 }
  },
  "verifiedAt": null,
  "verifiedSmokeChecks": null,
  "gateMaxAgeMinutes": 15
}
```

The `verify` subcommand sets `verifiedAt` and `verifiedSmokeChecks` after a successful restore-and-smoke against a *clone* (sibling-staged or a separate test instance dir). The `gate` subcommand reads `verifiedAt` to decide refuse-or-run.

**Why:** The manifest is what the smoke-test diff depends on. A snapshot that says "v0.41.2, plugins: [foo, bar]" → restored env that reports "v0.41.2, plugins: [foo, bar]" → equivalent ✓. Without the manifest, equivalence is undefined.

**Source:** [ASSUMED — this is a standard backup-tooling pattern; Borg, restic, restic-compose-backup all use a manifest+artifacts split]

### Pattern 3: One Node CLI, three platforms

**What:** A single `scripts/clarity-safety.mjs` that runs unmodified on Windows, macOS, and Linux. Platform differences are confined to:
- Resolving the `pg_dump`/`pg_restore` binary (different default install paths per platform).
- Resolving `pnpm` (`.cmd` shim on Windows; needs `cross-spawn`).
- Path separators (Node's `path.join` handles this).
- Default `PAPERCLIP_HOME`: `%USERPROFILE%\.paperclip` on Windows, `$HOME/.paperclip` elsewhere.

**Why:** PowerShell + Bash dual scripts duplicate the logic; if `snapshot.ps1` and `snapshot.sh` drift, the rollback drill on tomorrow's fresh-install Mac/Linux clone doesn't validate the production-Windows version. One CLI = one logic path.

**Tradeoff:** Eric must run `node` (or `pnpm`) explicitly. Mitigated by thin launchers: `runbook/snapshot.ps1` is one line — `node $PSScriptRoot\..\scripts\clarity-safety.mjs snapshot $args`. Same for `snapshot.sh`.

**Source:** [ASSUMED — multi-platform Node CLI is the dominant pattern in 2026; e.g., `tsx`, `vite`, `prisma` all do this]

### Pattern 4: Refuse-or-run gate as a wrapper, not a hook

**What:** The pre-flight gate (SAFE-05) is a **command wrapper**, not a git pre-commit hook or a CI check.

```bash
# Instead of:  pnpm paperclipai plugin install clarity-pack
# User runs:   pnpm clarity-safety gate -- pnpm paperclipai plugin install clarity-pack
```

If a fresh-and-verified snapshot exists (within 15 minutes), the inner command runs, stdio inherited, exit code propagated. If not, the gate prints the exact two commands needed (`pnpm clarity-safety snapshot && pnpm clarity-safety verify <ts>`) and exits non-zero.

**Why:**
- A **pre-commit hook** is wrong because clarity-pack actions ARE NOT git commits. The risky operation is `pnpm paperclipai plugin install`, which is a runtime mutation, not a code change.
- A **CI check** is wrong because the install runs on Eric's machine, not in CI.
- A **single command "snapshot+install"** would conflate snapshot creation with snapshot verification. SAFE-05 specifically requires *verified* snapshots — meaning a restore drill has actually been rehearsed against this snapshot. Coupling snapshot + install would skip the verify step.
- **Wrapper** preserves the exact upstream command verbatim — anything `pnpm paperclipai plugin install` accepts (flags, package versions, etc.) passes through unchanged. No flag-parsing skew.

**Tradeoff:** Adds one verb to muscle memory (`gate --`). Mitigated by an alias in the runbook: `alias safe='pnpm clarity-safety gate --'` so `safe pnpm paperclipai plugin install clarity-pack` is the daily command.

**Source:** [ASSUMED — wrapper pattern is the cleanest for "X cannot run unless Y is true"; e.g., `sudo`, `rerun-if-changed`, `nice`]

### Anti-Patterns to Avoid

- **Anti-pattern: ship a single `.sh` snapshot script that "should also work in PowerShell."** Bash idioms (heredoc, brace expansion, `$()`) don't translate. The user runs PowerShell. Reject.
- **Anti-pattern: rely on filesystem snapshot only ("just tar the data dir"), skip the DB dump.** PostgreSQL is not crash-consistent over a casual `tar` of the data directory while the server is running — you'd need to stop Paperclip, tar, restart, which is operationally heavy *and* skips an opportunity for a faster logical dump. Always use `pg_dump` (or PGlite's `dumpDataDir`) for the DB component; tar only the non-DB filesystem.
- **Anti-pattern: snapshot `plugins/node_modules/`.** It's regenerable from `plugins/package.json` + `pnpm install`. Storing it bloats the snapshot 100x. Restore re-runs install. (We snapshot `package.json` and `pnpm-lock.yaml` if present; we restore by checking out + reinstalling.)
- **Anti-pattern: snapshot `plugins/.cache/`.** Cache by definition is regenerable. Skip.
- **Anti-pattern: write the snapshot dir under `~/.paperclip/instances/...`.** That's *inside* the thing being snapshotted. Snapshots live under the clarity-pack repo's `.planning/snapshots/` (gitignored) — outside the data dir.
- **Anti-pattern: assume `pg_dump` is always on `$PATH`.** It often isn't on a fresh Windows machine. The CLI must detect-and-error-clearly with a platform-specific install hint, not crash with `ENOENT`.
- **Anti-pattern: fire-and-forget restore.** Always: stage → smoke-test → atomic rename. Never overwrite live dir before verification.
- **Anti-pattern: snapshot the secrets/master.key without flagging it.** It's a real key. The runbook must call out that `.planning/snapshots/` MUST be in `.gitignore` (it is) AND that snapshots should not be uploaded to shared storage without encryption.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Postgres logical backup | A custom Node `SELECT * FROM …` dump-and-replay | `pg_dump --format=custom --compress=zstd` + `pg_restore --single-transaction --clean --if-exists` | `pg_dump` handles schema, sequences, FKs, triggers, custom types, large objects, schema-search-path correctly; a custom dumper will silently miss one of these. [VERIFIED: postgresql.org/docs/current/app-pgdump.html] |
| Postgres restore atomicity | A custom transaction wrapper around N `INSERT` statements | `pg_restore --single-transaction` (wraps emitted commands in BEGIN/COMMIT; rollback on any error) | Battle-tested and correct under partial-apply failures. **Caveat:** `--single-transaction` is incompatible with `--jobs` (parallel restore); pick correctness over speed for a single-tenant dev DB. [VERIFIED: postgresql.org/docs/current/app-pgrestore.html "Multiple jobs cannot be used together with the option --single-transaction"] |
| PGlite backup | A custom dump-via-SQL path | `import('@electric-sql/pglite')` and call `db.dumpDataDir('gzip')` | The PGlite team designed this exact API; it produces a tarball that's trivially round-tripped via `loadDataDir`. **Caveat:** the datadir dump is NOT compatible with stock Postgres — it's PGlite-format. If we ever need to migrate dev → prod across Postgres flavors, we'd use PGlite's WASM `pg_dump` tool, which produces standard SQL. [VERIFIED: pglite.dev/docs/api §dumpDataDir] |
| Cross-platform tar | A custom child-process invocation of `tar` (not on Windows!) | `tar` npm package (`^7.5.15`, pure JS, has Windows path-normalization built in) | Pure JS. Portable. Handles symlinks, permissions, Windows path quirks. **Required version ≥7.5.11** for CVE-2026-31802 fix. [VERIFIED: github.com/isaacs/node-tar — pure JS; CVE fix per windowsforum.com] |
| Atomic file/directory replace | A custom rename-with-rollback dance | `fs.rename` with the sibling-staging pattern (extract to `<dir>.restoring/`, then rename `<dir> → <dir>.pre-restore-<ts>` and `<dir>.restoring → <dir>`) | `fs.rename` is atomic on the same filesystem on POSIX; on Windows, it's effectively atomic for directories that are not open. The two-step rename is the standard pattern. [CITED: well-known atomic-deploy idiom] |
| Manifest checksums | A custom hashing wrapper | `node:crypto.createHash('sha256').update(stream)` | Built-in, fast, correct. [VERIFIED: Node 20+ docs] |
| CLI subcommand parsing | A 200-line `process.argv` mini-parser | `commander` or stay hand-rolled if subcommand count stays low | Optional. For 4 subcommands, hand-rolled is fine. [ASSUMED] |
| Process spawn on Windows | Direct `child_process.spawn('pnpm', …)` (fails on Windows because `pnpm` is `pnpm.cmd`) | `cross-spawn` | Standard Node ecosystem fix. [CITED: github.com/moxystudio/node-cross-spawn] |
| Health check polling | Hand-rolled `setInterval` retry loop | Sequential `fetch` calls with `AbortController` timeouts; fail-fast on each check | Smoke test should be deterministic and fast (< 30s total), not a polling loop. [ASSUMED] |

**Key insight:** The expensive work in this phase is correctness under failure (partial restore, missing pg_dump, Windows path traversal, PGlite-vs-Postgres mode confusion). Every single one of those has a battle-tested upstream solution. The lines of code Eric writes for this phase should be glue, not algorithms.

---

## Runtime State Inventory

Phase 1 is greenfield (new repo, no rename/refactor of existing code), but it operates ON the runtime state of an external system (Paperclip). The "state" being captured by the snapshot tool is documented here so the planner knows what the snapshot must capture and what the restore must restore.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (Postgres) | `public.*` (issues, comments, agents, agent_runs, work_products, companies, projects, goals, activity_log, memberships, …); `plugin_database_namespaces`; `plugin_migrations`; `plugin_state`; `plugin_entities`; `plugin_jobs`; `plugin_job_runs`; `plugin_webhook_deliveries`; `plugins`; `plugin_config`; `company_secrets`; `company_secret_versions`; per-plugin namespace schemas like `plugin_clarity_pack_<hash>.*` | `pg_dump --format=custom --compress=zstd:6 --no-owner --no-privileges` against the entire `paperclip` database. Single dump file captures everything. [CITED: DATABASE.md "dumps include non-system database schemas such as public, the Drizzle migration journal, and plugin-owned database schemas"] |
| Stored data (PGlite, dev mode) | The entire `~/.paperclip/instances/<id>/db/` directory tree, which is PGlite's WASM-emulated PG datadir | `import('@electric-sql/pglite').dumpDataDir('gzip')` produces a `.tar.gz`. [VERIFIED: pglite.dev/docs/api] **Cannot use stock `pg_dump` against PGlite's datadir.** |
| Live service config (Paperclip core) | `~/.paperclip/instances/<id>/config.json` (instance config: ports, deployment mode, secrets path, DSN if any) | Include in the filesystem tar archive. Editable JSON; no API to export. [VERIFIED: CLI.md "config: ~/.paperclip/instances/default/config.json"] |
| Live service config (installed plugins) | The `plugins` Postgres table records install state, version, manifest JSON. The on-disk `plugins/package.json` records the npm dependency entries; `plugins/node_modules/` is the resolved tree. | DB row captured by `pg_dump`. Plugin `package.json` (and `pnpm-lock.yaml` if it exists) MUST be in the filesystem tar; `node_modules/` is regenerable so we skip it (restore re-runs `pnpm install`). [VERIFIED: PLUGIN_SPEC §8.1 install layout] |
| OS-registered state | **None** — Paperclip does not register Windows Tasks, launchd plists, systemd units, or pm2 saved processes. The Paperclip server runs as a foreground process started manually or via `pnpm dev`/`pnpm start`. [ASSUMED — confirmed by absence in CLI.md / SPEC.md] |
| Secrets / env vars | `~/.paperclip/instances/<id>/secrets/master.key` — the encrypted-secrets master key. Env vars: `PAPERCLIP_HOME`, `PAPERCLIP_INSTANCE_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_DEPLOYMENT_MODE`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID`. | `master.key` MUST be in the filesystem tar (DATABASE.md explicitly notes "Database backups do not include … the local encrypted secrets master key"). Env vars are set per-shell and are NOT snapshotted by us — runbook tells the user to record them separately. [VERIFIED: DATABASE.md backup limitations note] |
| Build artifacts / installed packages | `plugins/.cache/` (regenerable); `plugins/node_modules/` (regenerable from package.json) | Both skipped from the snapshot. Restore re-runs `pnpm install --dir ~/.paperclip/instances/<id>/plugins`. [ASSUMED — standard practice; the cache is by definition regenerable] |
| Work-products / uploads | `~/.paperclip/instances/<id>/data/storage/` (file uploads, work-products) | Include in the filesystem tar archive. **DATABASE.md explicitly warns: "Database backups do not include non-database instance files such as local-disk uploads, workspace files."** This is exactly why the snapshot has TWO components — DB dump + filesystem tar. [VERIFIED: DATABASE.md] |
| Per-plugin filesystem state | `~/.paperclip/instances/<id>/data/plugins/<plugin-id>/` per-plugin data dir | Include in the filesystem tar. [VERIFIED: PLUGIN_SPEC §8.1] |
| Logs | `~/.paperclip/instances/<id>/logs/` | Optional in the snapshot — useful for forensic analysis after a failed install but not required for restoration. Include by default; expose `--no-logs` flag for size. [ASSUMED] |

**Nothing found in category:** OS-registered state — verified by reading CLI.md, SPEC.md, and PLUGIN_SPEC.md cover-to-cover for any mention of Task Scheduler / launchd / systemd / pm2 — none present. Paperclip is "run as a foreground process" deployment.

**The canonical question for Phase 1:** *After every clarity-pack action runs, what runtime systems still have state that a `~/.paperclip/instances/<id>/` filesystem tar plus a `pg_dump` of `paperclip` won't capture?*

Answer: **none on the local machine** (verified by reading PLUGIN_SPEC §8 and DATABASE.md). External systems (npm registry caches, the user's shell environment vars, IDE state) are explicitly out of scope for the bookended-by-snapshots rule.

---

## Common Pitfalls

### Pitfall 1: PGlite vs hosted Postgres mode confusion

**What goes wrong:** Eric runs `pnpm onboard` for tomorrow's fresh local Paperclip; that's PGlite mode. He then writes a snapshot script that calls `pg_dump`. `pg_dump` connects to nothing (no Postgres server on the machine), errors out cryptically, and the snapshot directory ends up empty except for the filesystem tar — half a snapshot. He doesn't notice because the script exited 0.

**Why it happens:** The two backends share zero tooling. PGlite's WASM Postgres has its own `dumpDataDir()` API; stock `pg_dump` cannot see it because there's no listening Postgres process. PLUGIN_SPEC.md doesn't make the dual-mode explicit; you only learn this from DATABASE.md ("PGlite embedded for dev, Docker or hosted Supabase for production").

**How to avoid:**
- The snapshot CLI's first action is **mode detection**: read `config.json`, look for a `database.driver: 'pglite' | 'postgres'` field (or a `database.connectionString`). Branch on it. If indeterminate, abort with a clear error: `Cannot determine Paperclip DB mode from config.json — set --mode=pglite|postgres explicitly.`
- The snapshot manifest records `paperclipMode`. The restore subcommand reads it and refuses to restore a PGlite snapshot into a Postgres environment (or vice versa).
- The smoke-test does a sanity check: hit `/api/_diagnostics/db-driver` (if Paperclip exposes one) or infer from `/health` payload.

**Warning signs:** Snapshot completes in <100ms; snapshot dir has no `postgres.dump` file (or has one with size 0); restore fails on `pg_restore: error: input file does not appear to be a valid archive`.

### Pitfall 2: `pg_dump` not on PATH

**What goes wrong:** Fresh Windows install. User runs `pnpm clarity-safety snapshot`. Node calls `spawn('pg_dump', ...)`. `ENOENT`. User panics.

**Why it happens:** `pg_dump.exe` is installed under `C:\Program Files\PostgreSQL\17\bin\` by the Postgres installer, but PATH isn't necessarily updated unless the user checked the right box. Same on macOS with `/Applications/Postgres.app/Contents/Versions/17/bin/`.

**How to avoid:**
- Detect: try `spawn('pg_dump', ['--version'])`; if `ENOENT`, fall back to known platform-specific install paths.
- If still not found: error with platform-specific install hint (`On Windows: winget install PostgreSQL.PostgreSQL.17` etc.).
- Document in `runbook/PLATFORMS.md` how to install.
- Consider bundling the WASM `pg_dump` from `@electric-sql/pglite-tools` as a fallback for "client tools not installed but we can still produce a SQL dump" — only useful for the PGlite case, but it's nice to have.

**Warning signs:** Snapshot fails with "spawn pg_dump ENOENT".

### Pitfall 3: `pg_dump` major-version mismatch with server

**What goes wrong:** User has PostgreSQL 14 client installed but Paperclip runs against PG 17. `pg_dump --version` prints 14.x; pg_dump connects, errors out: `aborting because of server version mismatch`.

**Why it happens:** `pg_dump` is *backward* compatible (newer client can dump older server) but NOT *forward* compatible (older client cannot dump newer server). [VERIFIED: digitalocean.com docs]

**How to avoid:**
- After detecting `pg_dump`, run `pg_dump --version` and compare its major version to Paperclip's reported server version. If client < server major: error with clear message ("Install PostgreSQL 17 client tools").
- The runbook's PLATFORMS.md pins PG 17 explicitly.

**Warning signs:** Error output contains "server version mismatch".

### Pitfall 4: Restore overwrites live data dir before smoke test

**What goes wrong:** Restore extracts the filesystem tar directly over `~/.paperclip/instances/<id>/`, runs `pg_restore`, the restore fails halfway, smoke-test fails, but now the live `<id>/` dir is mangled.

**Why it happens:** The naive sequence is "stop server → extract tar → restore DB → start server → smoke test." Any of those four steps can fail; only the first two are reversible.

**How to avoid:** **Sibling-staging pattern (Pattern 1 above).** Always extract to `<id>.restoring/`. Restore Postgres into a dedicated test database (`paperclip_restoring`), not the live one. Smoke-test against the staged env. Only on PASS do we atomic-rename and swap. On FAIL, leave `.restoring/` in place for inspection; live `<id>/` is never touched.

**Warning signs:** The runbook's "rollback failed" section is the longest section. If the runbook can't articulate a clear recovery from a failed restore, the design is wrong.

### Pitfall 5: Snapshot manifest checksums never verified at restore time

**What goes wrong:** Snapshot file is silently corrupted (disk fault, partial download, antivirus tamper). Restore fails midway with a confusing `tar` or `pg_restore` error. User can't tell if it's their fault or the snapshot's.

**Why it happens:** Manifests are write-only; nobody verifies them.

**How to avoid:** Restore subcommand's step 1 is `verifyManifest()`: re-hash every artifact and compare to the manifest's recorded sha256. Fail-fast with a clear "snapshot corruption detected, sha256 mismatch on `postgres.dump`" message before doing anything destructive.

**Warning signs:** Restore fails with `pg_restore: error: did not find magic string in file header` (truncated/corrupt dump) or `tar: Unexpected EOF in archive`.

### Pitfall 6: 15-minute "fresh snapshot" window is wall-clock-naive

**What goes wrong:** Eric takes a snapshot, walks away to lunch, comes back, runs the gate at 16:00. Manifest says `verifiedAt: 14:30`. 90 minutes ago. Gate refuses. Eric "fixes" it by manually editing `verifiedAt`. Now the gate is theater.

**Why it happens:** The 15-minute default is a reasonable balance, but humans hit it.

**How to avoid:**
- Make the gate's max-age configurable per-invocation: `--max-age=60m` or `--max-age=1h`. Default 15.
- Make "verify" cheap. The verify subcommand should run in <2 minutes (smoke test against a sibling-staged restore). If verify is fast, taking a fresh snapshot before each install is no big deal.
- Document the rationale in the runbook: "If you're rehearsing a drill the snapshot is for, take a fresh one. If you're about to install on BEAAA after a sandwich, take a fresh one."
- Do NOT support an `--ignore-age` flag. If the user is willing to skip the gate, they can run the inner command directly.

**Warning signs:** User asks "how do I bypass the gate?"

### Pitfall 7: Snapshot leaks `master.key` into a non-private location

**What goes wrong:** User commits `.planning/snapshots/` to git, or syncs it to OneDrive, or copies it to a shared drive. The `master.key` (encrypted-secrets master key) leaks.

**Why it happens:** Snapshots aren't intuitively secret-sensitive; the user thinks "it's a backup, it's safe to keep."

**How to avoid:**
- `.planning/snapshots/` MUST be in `.gitignore` from day 1 (verifiable in CI).
- The snapshot CLI prints, on every run, a one-line reminder: `Snapshot includes secrets/master.key — do not share`.
- Runbook section "Where to store snapshots safely" lists three options (local, encrypted external drive, encrypted cloud) and explicitly forbids public/shared cloud.
- Consider an `--exclude-secrets` flag that omits `secrets/`. Restore from such a snapshot rebuilds the master key from a separately-stored backup or by `paperclipai onboard --reset-secrets` (TBD by Paperclip).

**Warning signs:** User says "let me just sync the snapshots dir to Dropbox."

### Pitfall 8: Smoke-test passes against stale data

**What goes wrong:** Smoke-test pings `/health`, gets 200, says PASS. But the actual restored DB has zero issues, zero employees, an empty work-product dir — the restore silently produced an empty environment that happens to start.

**Why it happens:** A health check tests "the server is alive," not "the server has the right data."

**How to avoid:** Smoke-test cross-checks against the **manifest**:
- Manifest records issue count, employee count, plugin list, paperclip version at snapshot time.
- Smoke-test queries `/api/issues?limit=1`, `/api/companies/<id>/agents`, `/api/plugins`, `/health`.
- It then verifies: restored env's plugin list (set equality) matches manifest's plugin list; restored env's paperclip version matches manifest's; restored env reports nonzero issues if manifest had nonzero issues.
- This is the "snapshot diff" mechanism: snapshot says X, restored env reports X → equivalent ✓.

**Warning signs:** Smoke-test passes but Eric opens the UI and sees an empty Paperclip.

### Pitfall 9: Concurrent Paperclip activity during snapshot causes inconsistency

**What goes wrong:** User starts the snapshot while the Editor-Agent is mid-compile (writing comments, work-products). The DB dump captures a consistent point-in-time view (`pg_dump` is consistent — uses MVCC), but the filesystem tar captures whatever's on disk at the moment of read, which may not match the DB state. Result: a restore where DB rows reference work-products that don't exist on disk (or vice versa).

**Why it happens:** `pg_dump` uses a single MVCC snapshot for the whole dump. The filesystem isn't transactional with that snapshot.

**How to avoid:**
- **Recommended for v1:** the runbook tells the user to STOP Paperclip before snapshotting. This eliminates the race entirely. Two-line runbook step. For BEAAA-scale (single user, infrequent installs) the downtime is irrelevant.
- **Alternative for v2:** start the DB dump first, capture the SCN/LSN, then read the filesystem; reject any work-products with `created_at` after the SCN. Complex; defer.

**Warning signs:** Restored env shows "broken work-product link" errors in logs.

### Pitfall 10: Plugin install side-effects beyond DB and filesystem

**What goes wrong:** A clarity-pack install registers an Editor-Agent (creates a row in `agents`), schedules routines (creates rows in plugin_jobs), writes a `plugin_database_namespaces` entry, runs migrations creating `plugin_clarity_pack_<hash>.*` schemas. All of these are in Postgres — covered by `pg_dump`. But: are there any side-effects we miss?

**Why it happens:** The set of things-clarity-pack-mutates is the set of things-the-snapshot-must-capture.

**How to avoid:** Per PLUGIN_SPEC §8.3 + §21.3 + §25.4.1, an install mutates exactly:
1. Postgres: `plugins` row, `plugin_config` row (if config), `plugin_database_namespaces` rows, `plugin_migrations` rows, `plugin_clarity_pack_<hash>.*` schema (created by migrations).
2. Filesystem: `~/.paperclip/instances/<id>/plugins/node_modules/clarity-pack/` (the npm package), `~/.paperclip/instances/<id>/plugins/.cache/` updates, `~/.paperclip/instances/<id>/data/plugins/clarity-pack/` if the plugin writes there.
3. Live: a worker process is spawned (no persistent state).

**All three are covered** by `pg_dump` + `~/.paperclip/instances/<id>/` filesystem tar. **This is verified by reading PLUGIN_SPEC §8 and §25.4 cover-to-cover.** The plugin install does NOT mutate anything OS-level (no Task Scheduler, no service registration), it does NOT write outside `~/.paperclip/`, and the worker process is killed cleanly on uninstall. The snapshot is complete.

**Warning signs:** A restore that "works" but the restored Paperclip behaves differently — would indicate something outside the documented mutation set. Surface to Paperclip upstream as an issue.

[VERIFIED: PLUGIN_SPEC §8.1 install layout, §8.3 install side-effects, §21.3 plugin tables, §25.4.1 hot install, §25.4.2 hot uninstall — all read 2026-05-07]

---

## Code Examples

Verified patterns from official sources.

### Pattern: `pg_dump` custom format with zstd compression (PostgreSQL 17)

```bash
# Source: postgresql.org/docs/current/app-pgdump.html
pg_dump \
  --format=custom \
  --compress=zstd:6 \
  --no-owner \
  --no-privileges \
  --file="${SNAPSHOT_DIR}/postgres.dump" \
  --dbname="postgresql://${PAPERCLIP_DB_USER}:${PAPERCLIP_DB_PASSWORD}@${PAPERCLIP_DB_HOST}:${PAPERCLIP_DB_PORT}/paperclip"
```

`--format=custom` produces a binary archive readable only by `pg_restore`, allowing parallel restore and selective object restoration. `--compress=zstd:6` is the 2026 best-practice (zstd is ~3x faster than gzip at the same compression ratio; level 6 is the size/speed sweet spot). [CITED: kmoppel.github.io 2024 pg_dump compression benchmarks; cybertec-postgresql.com on PG16 zstd support]

### Pattern: `pg_restore` with single transaction and clean (rollback on any error)

```bash
# Source: postgresql.org/docs/current/app-pgrestore.html
pg_restore \
  --single-transaction \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="postgresql://${PAPERCLIP_DB_USER}:${PAPERCLIP_DB_PASSWORD}@${PAPERCLIP_DB_HOST}:${PAPERCLIP_DB_PORT}/paperclip_restoring" \
  "${SNAPSHOT_DIR}/postgres.dump"
```

`--single-transaction` wraps everything in BEGIN/COMMIT — any error rolls back the whole restore. `--clean --if-exists` drops existing objects before recreating them; `--if-exists` suppresses "does not exist" errors for the first restore. Note: `--single-transaction` is incompatible with `--jobs N` (parallel restore); we accept the speed penalty for atomicity. [VERIFIED: postgresql.org docs; pgsql-hackers thread on `--single-transaction` semantics]

### Pattern: PGlite `dumpDataDir` and `loadDataDir`

```js
// Source: pglite.dev/docs/api §dumpDataDir
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';

// SNAPSHOT
const db = new PGlite(`${PAPERCLIP_HOME}/instances/default/db`);
const file = await db.dumpDataDir('gzip'); // returns a File/Blob
await fs.writeFile(`${SNAPSHOT_DIR}/pglite-datadir.tar.gz`, Buffer.from(await file.arrayBuffer()));
await db.close();

// RESTORE
const tarball = await fs.readFile(`${SNAPSHOT_DIR}/pglite-datadir.tar.gz`);
const db = new PGlite({
  dataDir: `${PAPERCLIP_HOME}/instances/default.restoring/db`,
  loadDataDir: new Blob([tarball])
});
await db.exec('SELECT 1'); // forces init; loadDataDir is read at first use
await db.close();
```

[VERIFIED: pglite.dev/docs/api §dumpDataDir]

### Pattern: Cross-platform tar create with node-tar

```js
// Source: github.com/isaacs/node-tar README
import * as tar from 'tar'; // tar@^7.5.15

// CREATE (gzip)
await tar.c(
  {
    gzip: true,
    file: `${SNAPSHOT_DIR}/instance-fs.tar.gz`,
    cwd: PAPERCLIP_HOME,
    // Filter out regenerable / huge dirs
    filter: (path /* relative to cwd */) => {
      if (path.includes('/plugins/node_modules/')) return false;
      if (path.includes('/plugins/.cache/')) return false;
      // Optionally skip logs:
      // if (path.startsWith('instances/default/logs/')) return false;
      return true;
    },
    // Defense-in-depth: reject symlinks pointing outside cwd
    portable: true,
  },
  ['instances/default'],
);

// EXTRACT (gunzip)
await tar.x(
  {
    file: `${SNAPSHOT_DIR}/instance-fs.tar.gz`,
    cwd: STAGING_DIR, // ~/.paperclip/instances/default.restoring/.. 
    // Defense-in-depth: reject hardlinks/symlinks (CVE-2026-31802)
    onentry: (entry) => {
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        throw new Error(`Refusing to extract ${entry.type}: ${entry.path}`);
      }
    },
  },
);
```

[VERIFIED: github.com/isaacs/node-tar; CVE-2026-31802 mitigation per windowsforum.com]

### Pattern: SHA-256 manifest checksums

```js
// Source: nodejs.org/docs/latest-v20.x/api/crypto.html
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

async function sha256OfFile(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
```

[VERIFIED: Node 20+ crypto docs]

### Pattern: Smoke-test against running Paperclip

```js
// Source: this design + STACK.md §4 PAPERCLIP_API_URL/PAPERCLIP_API_KEY env contract
const apiUrl = process.env.PAPERCLIP_API_URL ?? 'http://localhost:3100';
const apiKey = process.env.PAPERCLIP_API_KEY;
const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

const checks = [
  { name: 'health',    fn: () => fetch(`${apiUrl}/health`,                                          { headers }) },
  { name: 'issues',    fn: () => fetch(`${apiUrl}/api/issues?limit=1`,                              { headers }) },
  { name: 'agents',    fn: () => fetch(`${apiUrl}/api/companies/${COMPANY_ID}/agents`,              { headers }) },
  { name: 'plugins',   fn: () => fetch(`${apiUrl}/api/plugins`,                                     { headers }) },
  // Heartbeat is more invasive; rely on the documented endpoint shape
  { name: 'heartbeat', fn: () => fetch(`${apiUrl}/api/agents/${EDITOR_AGENT_ID}/heartbeat/invoke`,
                                       { method: 'POST', headers, body: JSON.stringify({}) }) },
];

for (const { name, fn } of checks) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fn();
    if (!res.ok && res.status >= 500) throw new Error(`smoke[${name}] HTTP ${res.status}`);
    console.log(`✓ smoke.${name}`);
  } catch (e) {
    console.error(`✗ smoke.${name}: ${e.message}`);
    process.exit(1);
  } finally {
    clearTimeout(t);
  }
}
```

[CITED: STACK.md §4 environment variables; Paperclip exact REST routes are documented in `doc/SPEC-implementation.md` per ARCHITECTURE.md sources — the smoke test should be tolerant of 4xx responses (auth, not-found) since those still indicate "server is alive and serving"]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pg_dump --format=plain` + gzip | `pg_dump --format=custom --compress=zstd:6` | PG 16 added zstd (2023); PG 17 default-built with zstd support | 2-3x faster dumps at same size; selective restore via `pg_restore -L` |
| `pg_dump --format=directory --jobs=N` (parallel) for atomic restore | `pg_dump --format=custom` + `pg_restore --single-transaction` | Always — `--jobs` and `--single-transaction` are mutually exclusive | Single-transaction restore is the only reliably atomic option for our use case |
| Bash `tar` shell-out from Node | `tar` npm package (pure JS) | node-tar 6.x (~2022); 7.x (2024) | Cross-platform out-of-box; no spawn overhead; better error handling |
| Stock `pg_dump` against PGlite | `@electric-sql/pglite`'s `dumpDataDir()` | PGlite 0.2+ (2024) | Stock `pg_dump` cannot connect to PGlite; you MUST use the embedded API |
| Custom `setInterval` retry for liveness | Sequential `fetch` + `AbortController` timeout | Native `fetch` in Node 18+ (2022) | Simpler, deterministic, no unbounded retry |

**Deprecated/outdated:**
- `pg_dump --format=plain | gzip` — works but 2x slower than custom-format-zstd at same compression. Don't use unless restore-target Postgres is older than the dump-source Postgres major version.
- Directly tarring the running Postgres data dir (without `pg_basebackup`) — never crash-consistent. Don't.
- Building a snapshot tool that assumes Bash. Windows is a real platform.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The pre-flight gate is a wrapper around the install command (not a pre-commit hook) | Pattern 4 / Architecture | Wrong UX: user might prefer a single `clarity-safety install` verb that does snapshot+verify+install in one step. **Resolve in discuss-phase.** |
| A2 | 15 minutes is the right default for snapshot freshness | SAFE-05 / Pitfall 6 | Too tight or too loose; the requirement language says "default 15" so the default is locked, but the rationale should be explicit (matches typical "I just made this and want to install" workflow). |
| A3 | The smoke-test endpoints listed (`/health`, `/api/issues`, `/api/companies/<id>/agents`, `/api/plugins`, `/api/agents/<id>/heartbeat/invoke`) match Paperclip's actual REST surface | Code Examples / smoke subcommand | If exact paths differ, smoke-test fails on first invocation. **Mitigation:** the rehearsal drill will discover this empirically tomorrow on the fresh local Paperclip install; smoke-test path can be configured per-env. |
| A4 | Skipping `plugins/node_modules/` and `plugins/.cache/` from the snapshot is safe (regenerable from `package.json` + `pnpm install`) | Anti-Patterns / Runtime State Inventory | If a plugin has a `postinstall` script that mutates state outside of `node_modules`, restore would miss it. **Mitigation:** SCAF-04 already bans `postinstall` scripts in clarity-pack's deps (per REQUIREMENTS.md); for the snapshot to be safe, this must hold for ALL installed plugins. The runbook should warn. |
| A5 | The user runs the snapshot on the same machine as Paperclip is installed | Architectural Responsibility Map | True for v1 (single-tenant filesystem-persistent). False for any future hosted-Postgres multi-machine deploy. Document as a v1 assumption. |
| A6 | Stopping Paperclip before snapshotting is acceptable | Pitfall 9 | True for BEAAA / single-user; false for any future multi-user / live ops. v1-only. |
| A7 | The `data/storage/` work-products are file-only (no DB-only references that would diverge from the FS) | Runtime State Inventory | If work-products are FK'd to DB rows but the row-to-file mapping uses generated IDs, a partial snapshot could orphan files OR rows. **Mitigation:** snapshot is single-pass over a stopped server (Pitfall 9 mitigation). |
| A8 | `manifest.json` `verifiedAt` set by the user's local clock is acceptable for the gate's max-age check | Pitfall 6 / Pattern 2 | User can clock-skew. **Mitigation:** gate compares `now - verifiedAt`; if user's clock is wrong, both `now` and `verifiedAt` are wrong by the same amount, so the check still works. |
| A9 | A snapshot taken on Windows can be restored on Linux/macOS (and vice versa) | Pattern 3 | Filesystem permissions and case-sensitivity differ; PGlite's datadir tarball MAY be platform-specific. **Mitigation:** v1 only requires same-platform restore (Eric's Windows machine to Eric's Windows machine). Cross-platform is out-of-scope — document. |
| A10 | The smoke-test cross-checks (manifest plugin list = restored env plugin list) are sufficient evidence of "functionally equivalent" | Pitfall 8 | Could miss subtle data drift. **Mitigation:** acceptable v1 bar; full equivalence (every issue, every comment) would require a logical diff which is out-of-scope. |
| A11 | The `gate` subcommand's max-age default of 15 minutes maps directly to SAFE-05's "fresh-and-verified" requirement | Pattern 4 / SAFE-05 | If SAFE-05 actually means "any verified snapshot ever, just verified at SOME point", the gate is too restrictive. **Resolve in discuss-phase.** Reading SAFE-05 verbatim: "no snapshot has been taken in the last N minutes (default 15)" — confirms 15-min wall-clock window. Confidence raised to high. |
| A12 | Unit-testable parts of Phase 1 are: manifest sha256 round-trip, mode-detection from config.json fixtures, smoke-test against a stub HTTP server | Plans + tests/safety | If true, those tests can run in CI without a live Paperclip; rest of Phase 1 needs the Tomorrow-rehearsal. |
| A13 | The runbook is markdown only and does not need to be a generated-from-code doc | runbook/ structure | A regeneration-from-code approach would prevent doc drift from the CLI's actual behavior. **Acceptable simplification for v1.** |
| A14 | "Functionally equivalent" in SAFE-03 is satisfied by the 5-check smoke-test (health + issues + heartbeat + employees + plugin list) | smoke subcommand | Could be too narrow. The phrase "functionally equivalent to the pre-snapshot environment" might require deeper semantic checks (e.g., "this specific issue's body is unchanged"). **Resolve in discuss-phase if more depth is wanted.** |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

This table is **not empty.** Items A1, A11, A14 in particular benefit from explicit user confirmation in the discuss-phase before the planner locks them in. Items A4–A10 are sane v1 simplifications that should be acknowledged in SPEC.md.

---

## Open Questions

1. **Does Paperclip expose a `/api/_diagnostics/db-driver` endpoint that reveals PGlite vs Postgres mode?**
   - What we know: PLUGIN_SPEC.md does not document one; `config.json` has the mode field per CLI.md.
   - What's unclear: whether reading `config.json` is the canonical detection path or whether a runtime probe is preferred.
   - Recommendation: read `config.json` first; if absent, probe `/health` payload for a `mode` or `driver` field; if also absent, require user to pass `--mode=pglite|postgres` explicitly. Tomorrow's rehearsal will reveal which path Paperclip itself uses.

2. **What is the exact Paperclip REST path for the heartbeat invoke?**
   - What we know: STACK.md §4 says `paperclipGetHeartbeatContext` is an MCP tool (read-only); the smoke-test would prefer a low-cost read endpoint that proves "agent runtime is reachable". `doc/SPEC.md` says "Single unified REST API" but doesn't document paths.
   - What's unclear: whether `POST /api/agents/<id>/heartbeat/invoke` is the right shape, or whether a `GET /api/agents/<id>/heartbeat/context` exists.
   - Recommendation: the smoke-test should treat any 2xx OR clean 4xx (server alive and rejecting auth/etc.) on this endpoint as PASS; only 5xx or network failure is FAIL. The exact path is configurable via env var `CLARITY_SMOKE_HEARTBEAT_URL` so tomorrow's rehearsal can pin it.

3. **Should the snapshot include a copy of the npm-installed clarity-pack package itself (in the case where snapshot is taken AFTER install)?**
   - What we know: PLUGIN_SPEC §8.1 puts the installed plugin under `~/.paperclip/instances/<id>/plugins/node_modules/clarity-pack/`. We've decided to skip `node_modules/` from the snapshot to save space, regenerating from `package.json` on restore.
   - What's unclear: if Eric does `pnpm paperclipai plugin install clarity-pack@0.1.5`, then later wants to restore to that exact version, the `package.json` may not pin patch versions. Skipping `node_modules` could lose precise version provenance.
   - Recommendation: snapshot includes `plugins/package.json` AND `plugins/pnpm-lock.yaml` (if present). The lockfile pins exact resolved versions. On restore, `pnpm install --frozen-lockfile` reproduces the exact tree. This is the standard solved problem.

4. **Is there a documented Paperclip "stop the server cleanly" command, or is it always SIGTERM?**
   - What we know: CLI.md doesn't document a `stop` subcommand. The server presumably runs as `pnpm start` or `pnpm dev`.
   - What's unclear: whether SIGTERM is graceful (flushes pending writes, closes DB connections) or whether there's a `paperclipai stop` we should call.
   - Recommendation: runbook says "Ctrl+C the running Paperclip process" for v1 (manual). v2 could probe for a PID file or graceful-shutdown endpoint. Tomorrow's rehearsal will confirm SIGTERM is graceful.

5. **What does Paperclip's plugin list endpoint actually return?**
   - What we know: PLUGIN_SPEC §8.2 has the CLI command `pnpm paperclipai plugin list`. STACK.md and SUMMARY.md don't document the JSON shape.
   - What's unclear: whether `pnpm paperclipai plugin list --json` is supported (vs human-readable table only), and whether it includes status/version per-plugin.
   - Recommendation: the snapshot CLI tries `pnpm paperclipai plugin list --json` first; if that fails (no --json flag), falls back to parsing the table output. Tomorrow's rehearsal will pin which works.

6. **Can the smoke-test run against a different `PAPERCLIP_API_URL` than the live install (e.g., a sibling-staged restore on a different port)?**
   - What we know: Paperclip's port is configurable in `config.json`; `PAPERCLIP_API_URL` env var overrides.
   - What's unclear: whether two Paperclip instances can run on the same machine simultaneously without DB collision.
   - Recommendation: for the rehearsal restore-then-smoke flow, restore to a sibling instance dir AND a sibling DB (`paperclip_restoring`), start Paperclip pointing at it on a different port (e.g., 3101), smoke-test against `localhost:3101`, then tear down. This is a non-trivial dance — the runbook should be explicit. v2 simplification: rehearsal can be "stop live, restore, smoke, restart" against the live port — simpler, but requires downtime.

7. **What is the size of a realistic BEAAA snapshot?**
   - Unknown until measured tomorrow. Affects: how long snapshot/restore takes, whether 15-minute freshness window is feasible, whether GitHub LFS is needed for any rehearsal artifacts (probably not — snapshots are gitignored).
   - Recommendation: rehearsal records actual sizes and times, codified in the runbook's "what to expect" section.

---

## Environment Availability

| Dependency | Required By | Available (this sandbox) | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All snapshot/restore/smoke logic | ✓ | v24.14.0 (sandbox); user must have ≥20 | None — Paperclip itself requires Node ≥20, so this is a non-issue in practice |
| pnpm | Listing installed plugins via `pnpm paperclipai plugin list` | ✗ (in sandbox) | — | Mandatory — Paperclip requires pnpm. Document in PLATFORMS.md. |
| `pg_dump` / `pg_restore` (PostgreSQL 17 client) | Postgres-mode snapshot/restore | ✗ (in sandbox) | — | If Paperclip is in PGlite mode, use `@electric-sql/pglite` instead. If user is on Postgres mode and lacks `pg_dump`, error with platform-specific install hint. |
| `tar` npm package | Filesystem archive | ✓ (will be installed via `pnpm add -D tar`) | `^7.5.15` | None needed |
| `@electric-sql/pglite` | PGlite-mode snapshot/restore | ✓ (will be installed via `pnpm add -D`) | `^0.4.5` | None needed |
| `cross-spawn` | Cross-platform spawn (Windows `pnpm.cmd` resolution) | ✓ (will be installed) | `^7.0.6` | Hand-rolled `if (process.platform === 'win32') ...` — uglier |
| Running Paperclip server | smoke-test, plugin list | ✗ at this sandbox | — | Smoke-test gracefully reports "Paperclip not running" rather than crashing |

**Missing dependencies with no fallback:**
- `pg_dump`/`pg_restore` (when user is on Postgres mode AND doesn't have client tools installed). The CLI MUST detect this and produce a clear install hint instead of an opaque crash.
- `pnpm` — but Paperclip itself depends on pnpm, so if the user can run Paperclip, they have pnpm.

**Missing dependencies with fallback:**
- A specific Paperclip server endpoint (`/api/...`) — fallback is configurable via env var; rehearsal pins the exact path.

**Action for the planner:** Phase 1 must include a "preflight environment audit" task that, on first run of `clarity-safety snapshot`, verifies all required tools are available and prints a clear error with platform-specific install commands if not. Eric should never see `ENOENT: spawn pg_dump`.

---

## Security Domain

`security_enforcement` is not explicitly disabled in `.planning/config.json` — treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Snapshots may contain secrets — document storage location requirements (encrypted disk only); explicit reminder on every CLI run |
| V2 Authentication | partial | Smoke-test uses `PAPERCLIP_API_KEY` — read from env, never logged |
| V3 Session Management | no | No sessions; CLI is one-shot |
| V4 Access Control | partial | The CLI runs with the user's local privileges; Postgres dump uses the user's DB credentials. No privilege escalation. |
| V5 Input Validation | yes | Snapshot manifest reads JSON — must guard against prototype pollution and path traversal in any user-provided snapshot id |
| V6 Cryptography | yes | sha256 for integrity (not authentication — manifest itself should be HMAC'd if we add a "verified by trusted signer" flow; v2) |
| V12 Files & Resources | yes | tar extraction must reject symlinks/hardlinks per CVE-2026-31802; path-traversal guard on snapshot id (no `../` in `<snapshot-id>`) |
| V13 API & Web Service | partial | Smoke-test calls Paperclip REST — uses standard `Authorization: Bearer` |
| V14 Configuration | yes | `.planning/snapshots/` MUST be in `.gitignore`; verifiable in CI |

### Known Threat Patterns for {Node CLI + filesystem + DB dumps}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tar path-traversal extraction (CVE-2026-31802) | Tampering | Use `tar@^7.5.11`; reject symlinks/hardlinks via `onentry`; canonicalize paths |
| `master.key` leakage via shared snapshot dir | Information Disclosure | Gitignore enforcement; runbook warning; `--exclude-secrets` flag |
| Snapshot-id command injection (e.g., `clarity-safety restore "; rm -rf ~"`)  | Tampering | Validate snapshot id with regex `^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$`; never spawn shell with snapshot id interpolated |
| Postgres credential leakage via process env / argv | Information Disclosure | Pass DB password via `PGPASSFILE` or `PGPASSWORD` env, never as argv (visible in `ps`) |
| Restore against the wrong DB (e.g., production by mistake) | Tampering | Restore CLI requires `--target=<dbname>` explicitly; refuses if target name matches the current paperclip-live db unless `--i-know-what-im-doing` is passed |
| Modified snapshot file | Tampering | sha256 manifest verification before any restore action |
| Race condition during snapshot (Paperclip writing during read) | Tampering / data-integrity | Runbook: stop Paperclip before snapshotting (Pitfall 9 mitigation) |

---

## Project Constraints (from CLAUDE.md / PROJECT.md)

The directives below are extracted from `./CLAUDE.md` and `.planning/PROJECT.md`. They constrain Phase 1 design.

1. **Bookended-by-snapshots rule** — every clarity-pack install/upgrade/migration/agent-registration that runs against the live BEAAA Paperclip MUST be bookended by a verified snapshot taken immediately before, and a working rollback path verified at least once before any feature work ships. **Phase 1 IS this rule's implementation.**
2. **Pre-install snapshot tooling lives in this repo's `runbook/` and `scripts/`, NOT inside the plugin code.** Required so the tooling works when clarity-pack is broken or uninstalled. (PROJECT.md "Active req"; SAFE-04 verbatim.)
3. **Default branch is `master`, not `main`** — all doc URLs and CI references must use `/blob/master/...`. Phase 1's runbook and any docs must follow.
4. **Paperclip default deployment** — single-tenant, self-hosted, single-node, filesystem-persistent. v1 inherits this; multi-tenant is out of scope. Snapshot scope is therefore "everything one user's instance dir contains plus that user's Postgres database."
5. **Operational realism** — user is on Windows 11 PowerShell; production-like rehearsal target is a fresh local Paperclip clone (set up tomorrow). Cross-platform from day 1.
6. **Stack pins (forced):** Node ≥20 — the snapshot CLI inherits this. Snapshot CLI MUST work on Node 20 LTS.
7. **GSD workflow enforcement (CLAUDE.md):** "Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it." Phase 1 plans must be created via `/gsd:plan-phase 1`; snapshot/restore implementation tasks must run through `/gsd:execute-phase`.
8. **pnpm is mandatory** — `pnpm paperclipai plugin install` is the command line. Snapshot CLI's plugin-list step uses `pnpm paperclipai plugin list`. CI uses pnpm.
9. **No new emoji in any deliverables** unless the user asks for them. The runbook is plain-text editorial English, not decorated with emoji.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | One-command snapshot script captures Postgres dump + filesystem archive of Paperclip's data dir + current Paperclip version + installed-plugin list into a single timestamped archive. | `snapshot` subcommand (Architecture diagram); `pg_dump --format=custom` for Postgres + `dumpDataDir` for PGlite; `tar` for filesystem under `PAPERCLIP_HOME/instances/<id>/`; manifest.json captures version + plugin list (read via `pnpm paperclipai plugin list --json` or `/api/plugins`). [VERIFIED: PLUGIN_SPEC §8.1, DATABASE.md] |
| SAFE-02 | One-command restore script reverses any snapshot byte-for-byte; rehearsed against a non-prod Paperclip clone at least once before any clarity-pack feature code touches BEAAA. | `restore` subcommand with sibling-staging pattern (Pattern 1); `pg_restore --single-transaction --clean --if-exists` for Postgres; `loadDataDir` for PGlite; `tar.x` for filesystem. **Rehearsal task** is non-autonomous — requires Eric to run on his fresh local Paperclip clone tomorrow. [VERIFIED: PostgreSQL pg_restore docs; pglite.dev/docs/api] |
| SAFE-03 | Smoke-test verifies a restored snapshot is functionally equivalent — Paperclip starts, REST API answers, sample issue listable, agent heartbeat fetch succeeds, employee list renders. | `smoke` subcommand (Code Examples §Smoke-test); 5 sequential `fetch` calls with 5s timeouts; cross-check restored env's plugin list / version against manifest. **Unit-testable** part: smoke-test logic against a stub HTTP server. **Non-autonomous part:** running against actual restored Paperclip. |
| SAFE-04 | Runbook documents pre-flight → install → post-install verify → rollback in plain English; lives in `runbook/` in this repo. | `runbook/README.md` + `runbook/REHEARSAL.md` + `runbook/PLATFORMS.md` + `runbook/snapshot.ps1` + `runbook/snapshot.sh`. Markdown only; no codegen. **Validated by Eric reading it tomorrow and being able to execute end-to-end without asking questions.** |
| SAFE-05 | Pre-flight gate refuses install/upgrade/migration/agent-registration if no snapshot in last N minutes (default 15) or most-recent snapshot's restore-and-smoke has not passed. | `gate` subcommand (Pattern 4); reads latest manifest.json's `verifiedAt`; checks `now - verifiedAt < maxAgeMinutes`. Wrapper UX: `pnpm clarity-safety gate -- pnpm paperclipai plugin install clarity-pack`. **Unit-testable.** |

---

## Recommended CLI Surface

Concrete signatures for the planner. Subcommand-style; one entrypoint `scripts/clarity-safety.mjs`.

```bash
# Phase 1 deliverables:

pnpm clarity-safety snapshot \
    [--paperclip-home <path>]    # default: $PAPERCLIP_HOME or platform default
    [--instance-id <id>]         # default: $PAPERCLIP_INSTANCE_ID or "default"
    [--mode pglite|postgres]     # default: detect from config.json
    [--out <dir>]                # default: .planning/snapshots/<ISO-timestamp>/
    [--db-url <url>]             # default: read from config.json (postgres mode)
    [--exclude-secrets]          # opt-in
    [--include-logs]             # default: true
# Exit 0 on success; non-zero with diagnostic message on failure.
# Writes <out>/manifest.json + <out>/postgres.dump (or pglite-datadir.tar.gz) + <out>/instance-fs.tar.gz

pnpm clarity-safety restore <snapshot-id-or-path> \
    [--paperclip-home <path>]    # default: same defaults as snapshot
    [--instance-id <id>]
    [--target-instance-id <id>]  # default: same as --instance-id; lets you restore into a sibling for rehearsal
    [--target-db <dbname>]       # default: paperclip_restoring (NEVER the live db unless explicit)
    [--i-know-what-im-doing]     # required to restore over the live instance
# Exit 0 on success (sibling-staged + smoke-passed + atomic-rename done); non-zero on any failure.
# On failure: leaves <instance-id>.restoring/ in place for inspection; live <instance-id>/ untouched.

pnpm clarity-safety smoke [<snapshot-id-or-path>] \
    [--api-url <url>]            # default: $PAPERCLIP_API_URL or http://localhost:3100
    [--api-key <key>]            # default: $PAPERCLIP_API_KEY
    [--company-id <id>]          # default: $PAPERCLIP_COMPANY_ID
    [--editor-agent-id <id>]     # default: from manifest if snapshot id given
    [--timeout-ms <n>]           # default: 5000 per check
# Exit 0 if all 5 checks pass; non-zero with check-name on first failure.
# If <snapshot-id> given: cross-checks restored env against snapshot manifest (plugin list, version).

pnpm clarity-safety verify <snapshot-id> \
    [--max-rehearsal-time <duration>]  # safety budget; default 5 minutes
# Sequence: spin up sibling-staged restore → run smoke against it → tear down sibling → set verifiedAt in manifest.
# Exit 0 on success (manifest updated); non-zero on any failure.

pnpm clarity-safety gate [--max-age <duration>] -- <inner-command...>
# Default --max-age=15m. Reads latest snapshot manifest; checks verifiedAt within window.
# If yes: spawn inner command, inherit stdio, propagate exit code.
# If no: print exact remediation steps and exit 1.

pnpm clarity-safety list \
    [--max-age <duration>]
# Lists snapshots under .planning/snapshots/, with id + size + verified-status + age.

pnpm clarity-safety prune \
    [--keep <n>]                 # default: 10 most recent
    [--keep-verified <n>]        # default: 3 most recent verified
    [--dry-run]
# Cleanup; never touches a snapshot less than 24h old.
```

---

## Files Phase 1 Should Produce

| File | Purpose | Lines (est) | Unit-testable? |
|------|---------|-------------|----------------|
| `runbook/README.md` | Plain-English pre-flight → install → verify → rollback runbook | 200-400 | Manually validated by rehearsal |
| `runbook/REHEARSAL.md` | Drill log template + completed v1 entry | 100 | No |
| `runbook/PLATFORMS.md` | Platform-specific install of `pg_dump`, pnpm, Node | 100 | No |
| `runbook/snapshot.ps1` | Windows PowerShell launcher (1-line wrapper) | 5 | No |
| `runbook/snapshot.sh` | macOS/Linux Bash launcher (1-line wrapper) | 5 | No |
| `scripts/clarity-safety.mjs` | Node CLI subcommand dispatcher | 80 | Yes (subcommand routing) |
| `scripts/lib/detect-mode.mjs` | PGlite vs Postgres detection from config.json | 60 | Yes (with fixtures) |
| `scripts/lib/snapshot.mjs` | Snapshot subcommand impl | 250 | Partial (manifest emit unit-testable; pg_dump/tar non-autonomous) |
| `scripts/lib/restore.mjs` | Restore subcommand impl | 250 | Partial (sha256 verify + path computation unit-testable; pg_restore non-autonomous) |
| `scripts/lib/smoke.mjs` | Smoke-test subcommand impl | 200 | Yes (against stub server) |
| `scripts/lib/verify.mjs` | Restore-then-smoke + manifest update | 100 | Partial |
| `scripts/lib/gate.mjs` | Pre-flight wrapper | 80 | Yes |
| `scripts/lib/manifest.mjs` | Manifest emit/read/sha256 verify | 120 | Yes |
| `scripts/lib/paperclip-api.mjs` | Thin REST client for /health, /api/issues, etc. | 100 | Yes (with stub) |
| `scripts/lib/paths.mjs` | Resolve PAPERCLIP_HOME / PAPERCLIP_INSTANCE_ID per platform | 60 | Yes |
| `scripts/package.json` | CLI's own deps (tar, pglite, cross-spawn) | 30 | No |
| `tests/safety/manifest.test.mjs` | sha256 emit/verify round-trip | 80 | — |
| `tests/safety/detect-mode.test.mjs` | Mode detection from JSON fixtures | 60 | — |
| `tests/safety/smoke-stub.test.mjs` | Smoke-test against a 100-line stub HTTP server mimicking Paperclip's 5 endpoints | 150 | — |
| `tests/safety/gate.test.mjs` | Gate wrapper logic against fake snapshot dirs | 100 | — |
| `tests/safety/fixtures/paperclip-pglite-config.json` | Mode-detection fixture | 30 | — |
| `tests/safety/fixtures/paperclip-postgres-config.json` | Mode-detection fixture | 30 | — |
| `tests/safety/fixtures/stub-server.mjs` | Mock Paperclip REST server for smoke-stub tests | 100 | — |
| `.gitignore` (update) | Add `.planning/snapshots/` | 1 line | Yes (CI check) |
| CI workflow (`.github/workflows/safety.yml`) | Run `tests/safety/**` on every PR | 30 | — |

**Total unit-testable code:** ~700 lines (manifest, mode-detect, smoke-stub, gate, paths, paperclip-api).
**Total non-autonomous (rehearsal-only) code:** ~500 lines (snapshot, restore, verify — these need a live Paperclip).
**Total docs:** ~400 lines.

---

## Unit-Testable vs Rehearsal-Only

The planner should mark tasks `autonomous: true` if they are unit-testable in CI (no live Paperclip required), and `autonomous: false` if they require Eric's manual rehearsal against a fresh local Paperclip clone.

### Unit-testable (autonomous: true)

| Task | Test |
|------|------|
| Manifest sha256 emit / read / verify round-trip | `tests/safety/manifest.test.mjs` — write file, hash, read manifest, verify, mutate file, expect verify to fail |
| Mode detection from `config.json` | `tests/safety/detect-mode.test.mjs` — fixtures for pglite-mode, postgres-mode, malformed, missing |
| Snapshot id validation regex | inline test — accept `2026-05-08T14-32-17Z`; reject `../etc/passwd`, `; rm -rf ~`, empty |
| Path computation (PAPERCLIP_HOME defaults, instance dir resolution) | `tests/safety/paths.test.mjs` — Windows vs POSIX home dir, env override |
| Smoke-test against stub HTTP server | `tests/safety/smoke-stub.test.mjs` — start `tests/safety/fixtures/stub-server.mjs`, run smoke, assert PASS; mutate stub to return 500, assert FAIL with correct check-name |
| Gate logic (fresh-vs-stale, refuse-or-run) | `tests/safety/gate.test.mjs` — write fake manifest with verifiedAt={now,now-30m,never}, assert gate behavior; verify exit code propagation |
| Manifest plugin-list cross-check | tests/safety/diff.test.mjs — manifest-vs-stub-server set equality |
| Tar archive symlink rejection (CVE mitigation) | tests/safety/tar.test.mjs — create archive with symlink, attempt extract, expect error |
| `cross-spawn` integration — `pnpm` resolution on Windows | tests/safety/spawn.test.mjs — mock pnpm.cmd / pnpm shim, verify spawn args |

### Rehearsal-only (autonomous: false; require live Paperclip)

| Task | Why |
|------|-----|
| `clarity-safety snapshot` end-to-end against running PGlite-mode Paperclip | Needs `pnpm onboard`'d Paperclip; needs PGlite to be runnable in-context |
| `clarity-safety snapshot` end-to-end against running Postgres-mode Paperclip | Needs Postgres 17 server with paperclip schema |
| `clarity-safety restore` against a snapshot of a live install | Needs a Paperclip instance to overwrite |
| `clarity-safety verify` (the full snapshot → restore → smoke → tear down loop) | Composite of the above |
| `clarity-safety gate -- pnpm paperclipai plugin install clarity-pack` | Needs a publishable clarity-pack package — Phase 2 deliverable |
| Smoke-test against actual Paperclip REST endpoints | Confirms the assumed paths from STACK.md §4 |
| pg_dump major-version detection on Eric's actual Windows install | Requires the install |
| Cross-platform path-handling on Eric's actual Windows machine | Windows is a real platform |
| Runbook "Eric reads this and can execute end-to-end" validation | Human review |

The planner should expect Phase 1 has TWO kinds of work: (a) unit-testable Node CLI code that lands in CI on every PR, and (b) one or two manual rehearsal sessions where Eric runs the runbook end-to-end against tomorrow's fresh local Paperclip install. The completion of (b) is the verification of SAFE-02 ("rehearsed at least once").

---

## Open Questions for Phase 1 SPEC.md and plan-checker

1. **Should the snapshot/restore tooling be a separate npm package (`@clarity-pack/safety`) or live as `scripts/` in this repo only?**
   Recommendation: stay in `scripts/` for v1. Reasons: (a) it's <2000 lines of code, (b) it's not reusable by other Paperclip plugins yet — that's a v2 concern, (c) keeping it in-repo means it's always exactly in sync with the runbook. Revisit if a second plugin needs it.

2. **Does Phase 1 include CI for the unit-testable parts, or does CI come in Phase 2 (per SCAF-04: "monthly `pnpm audit` runs in CI")?**
   Recommendation: Phase 1 ships its own minimal CI workflow (`.github/workflows/safety.yml`) running just `tests/safety/**`. Phase 2's broader CI (lint, typecheck, build) extends it. Doing both at once is more efficient than a separate Phase 2 setup.

3. **Should `clarity-safety verify` be its own subcommand, or is it implicit in `restore`?**
   Recommendation: keep `verify` separate. `restore` is destructive (overwrites live env after smoke); `verify` is non-destructive (sibling-staged restore, smoke, tear down sibling). The pre-flight gate reads `verifiedAt` set by `verify`, so it must be runnable independently.

4. **What is the exact granularity of Eric's rehearsal log (`runbook/REHEARSAL.md`)?**
   Recommendation: per-rehearsal entry: date, Paperclip version, mode, snapshot size, snapshot duration, restore duration, smoke result, anomalies. Three columns: Tomorrow's first rehearsal, before-each-major-Paperclip-upgrade, before-each-clarity-pack-release.

5. **Should the snapshot CLI also produce a "snapshot summary" stdout report for human consumption?**
   Recommendation: yes. After every snapshot, print: snapshot-id, size, paperclip version, plugin list, location, "to verify run: ..." — so Eric immediately knows what was captured.

6. **What's the Phase 1 stance on snapshot encryption-at-rest?**
   Recommendation: out-of-scope for v1. Document in runbook that snapshots contain `master.key` and must be stored on the same encrypted disk Paperclip itself runs from. v2 could add `--encrypt --recipient=<pubkey>` (age / GPG).

7. **Does the `gate` subcommand need to know about specific clarity-pack versions, or does it just gate ANY install?**
   Recommendation: gate is version-agnostic. It wraps any inner command. The user is free to gate `pnpm paperclipai plugin install clarity-pack@0.2.0` or `pnpm paperclipai plugin upgrade clarity-pack` — the gate doesn't care. The snapshot's manifest records what was installed at snapshot time; the post-install state is a separate concern.

8. **Should the runbook be an executable doc (e.g., `pnpm clarity-safety runbook` opens it in $BROWSER)?**
   Recommendation: no. Plain markdown, viewable in any text editor. v2 could add a TUI wizard.

9. **Is "agent-registration" in SAFE-05 a real distinct event, or is it always a side-effect of plugin install?**
   Per ARCHITECTURE.md, Editor-Agent is reconciled per-company via `ctx.agents.managed.reconcile()` inside `setup()`. Reading PLUGIN_SPEC §25.4.1, this happens during plugin install (or hot upgrade). So "agent-registration" is a synonym for "first install" or "upgrade that adds an agent" — not a separate event. The gate captures all of these uniformly because they're all wrapped in the install/upgrade command.

---

## Sources

### Primary (HIGH confidence)

- **PLUGIN_SPEC.md** — `doc/plugins/PLUGIN_SPEC.md` master branch (2026-05-07): §1 deployment notes, §8.1 install layout, §8.2 install commands, §8.3 install side-effects, §12.1 process model, §12.5 graceful shutdown, §21.3 plugin tables, §25.1 retention, §25.4.1 hot install, §25.4.2 hot uninstall.
- **DATABASE.md** — master branch (2026-05-07): "PostgreSQL 17", "Paperclip supports automatic and manual logical database backups", "Database backups do not include non-database instance files such as local-disk uploads, workspace files, or the local encrypted secrets master key", `plugin_database_namespaces`, `plugin_migrations`.
- **CLI.md** — master branch (2026-05-07): instance dir layout (`~/.paperclip/instances/default/{config.json, db, logs, data/storage, secrets/master.key}`), env vars (`PAPERCLIP_HOME`, `PAPERCLIP_INSTANCE_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`).
- **Project files in this repo:** PROJECT.md, REQUIREMENTS.md (SAFE-01..05 verbatim), ROADMAP.md (Phase 1 success criteria), STATE.md (locked decisions), .planning/research/* (synthesis confirming snapshot scope).
- **PostgreSQL official docs:** [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).
- **PGlite docs:** [API §dumpDataDir](https://pglite.dev/docs/api).
- **node-tar GitHub:** [github.com/isaacs/node-tar](https://github.com/isaacs/node-tar) — confirmed pure JS, cross-platform; `npm view tar version` returned `7.5.15`.

### Secondary (MEDIUM confidence)

- [pg_dump Compression Methods and Levels (Younkins)](https://cyounkins.medium.com/pg-dump-compression-methods-and-levels-41de44840688) — zstd:6 sweet spot.
- [Best pg_dump compression settings for Postgres in 2024 (Möppel)](https://kmoppel.github.io/2024-01-05-best-pgdump-compression-settings-in-2024/) — empirical benchmarks.
- [Microsoft Learn: pg_dump and pg_restore best practices](https://learn.microsoft.com/en-us/azure/postgresql/troubleshoot/how-to-pgdump-restore).
- [oneuptime.com pg_dump 2026 tutorial](https://oneuptime.com/blog/post/2026-01-25-use-pg-dump-database-backups/view).
- [DigitalOcean: pg_dump server version mismatch](https://docs.digitalocean.com/support/how-do-i-fix-the-pg_dump-aborting-because-of-server-version-mismatch-error/) — backward-only compatibility.

### Tertiary (LOW confidence — needs Phase 1 rehearsal verification)

- The exact REST paths used by the smoke-test (`/health`, `/api/issues`, `/api/companies/<id>/agents`, `/api/plugins`, `/api/agents/<id>/heartbeat/invoke`) — paraphrased from STACK.md §4 + ARCHITECTURE.md sources; not confirmed against a running Paperclip. Tomorrow's rehearsal will pin exact paths.
- `pnpm paperclipai plugin list --json` flag existence — assumed; not confirmed.
- `config.json` exact shape (does it have `database.driver: 'pglite' | 'postgres'`?) — paraphrased from CLI.md; not confirmed.
- Whether `--single-transaction` works for restoring a fresh DB schema (creating db `paperclip_restoring`, then restoring into it) — believed yes per docs; rehearsal will confirm.
- CVE-2026-31802 fix in `tar@7.5.11` — per windowsforum.com / windowsnews.ai (date 2026, before knowledge cutoff); assumed correct.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm registry; pg_dump pinned to PG 17 (DATABASE.md verbatim).
- Architecture: HIGH for the snapshot/restore/smoke/gate decomposition; MEDIUM for the PGlite-vs-Postgres dispatch — depends on whether config.json detection works as assumed.
- Pitfalls: HIGH on Postgres/tar/path-traversal pitfalls (industry-documented); HIGH on PGlite-mode confusion (docs explicit).
- Phase requirements coverage: HIGH — all five SAFE-* requirements have a concrete CLI subcommand and at least one verifiable test/rehearsal.

**Research date:** 2026-05-07
**Valid until:** 2026-06-07 (30 days for stable items: PostgreSQL semantics, node-tar, PGlite API). Re-verify the smoke-test endpoints and `pnpm paperclipai plugin list --json` flag immediately after tomorrow's rehearsal.
