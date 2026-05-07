---
phase: 01-pre-install-safety
plan: 01
subsystem: safety-cli
tags: [safety, cli, snapshot, restore, postgres, pglite, tar, cve-2026-31802]
requires:
  - Node >= 20
  - pnpm 9+ (for `pnpm clarity-safety` invocation; tests run via `pnpm -C scripts/safety test`)
provides:
  - `pnpm clarity-safety snapshot`  — capture Paperclip install (manifest + db + fs tar)
  - `pnpm clarity-safety restore <id>`  — sibling-staging restore (live untouched)
  - `pnpm clarity-safety list`  — enumerate snapshots
  - `pnpm clarity-safety prune`  — delete old, never <24h
  - `pnpm clarity-safety smoke|verify|gate`  — stubs (plan-02 / plan-03)
  - `scripts/safety/lib/{manifest,paths,mode-detect,snapshot,restore,paperclip-cli,list,prune}.mjs` library API
affects:
  - .planning/snapshots/ (gitignored runtime artifact dir)
  - .gitignore (adds .planning/snapshots/ + node_modules/ exception for fake-instance fixture)
tech-stack:
  added:
    - tar@^7.5.15 (CVE-2026-31802 mitigation)
    - "@electric-sql/pglite@^0.4.5"
    - cross-spawn@^7.0.6
  patterns:
    - sibling-staging restore (extract to <home>/.clarity-safety-restore-<id>/, then rename to <home>/instances/<id>.restoring/)
    - manifest-as-contract (sha256 streaming integrity check before any destructive step)
    - argv-locked subprocess invocation (pg_dump / pg_restore argv shape immutable; PGPASSWORD via env never argv)
    - hand-rolled CLI dispatcher (research §Don't Hand-Roll table threshold; 7 subcommands, ~80 lines of routing)
key-files:
  created:
    - scripts/safety/package.json
    - scripts/safety/cli.mjs
    - scripts/safety/lib/manifest.mjs
    - scripts/safety/lib/paths.mjs
    - scripts/safety/lib/mode-detect.mjs
    - scripts/safety/lib/list.mjs
    - scripts/safety/lib/prune.mjs
    - scripts/safety/lib/paperclip-cli.mjs
    - scripts/safety/lib/snapshot.mjs
    - scripts/safety/lib/restore.mjs
    - scripts/safety/test/manifest.test.mjs
    - scripts/safety/test/paths.test.mjs
    - scripts/safety/test/mode-detect.test.mjs
    - scripts/safety/test/list-prune.test.mjs
    - scripts/safety/test/snapshot.test.mjs
    - scripts/safety/test/snapshot-pglite.test.mjs
    - scripts/safety/test/snapshot-postgres-mock.test.mjs
    - scripts/safety/test/restore.test.mjs
    - scripts/safety/test/restore-tar-cve.test.mjs
    - scripts/safety/test/cli.test.mjs
    - scripts/safety/test/fixtures/paperclip-pglite-config.json
    - scripts/safety/test/fixtures/paperclip-postgres-config.json
    - scripts/safety/test/fixtures/paperclip-malformed-config.json
    - scripts/safety/test/fixtures/fake-instance/instances/default/config.json
    - scripts/safety/test/fixtures/fake-instance/instances/default/data/storage/sample.txt
    - scripts/safety/test/fixtures/fake-instance/instances/default/secrets/master.key
    - scripts/safety/test/fixtures/fake-instance/instances/default/plugins/package.json
    - scripts/safety/test/fixtures/fake-instance/instances/default/plugins/pnpm-lock.yaml
    - scripts/safety/test/fixtures/fake-instance/instances/default/plugins/node_modules/some-pkg/index.js
    - scripts/safety/test/fixtures/fake-instance/instances/default/plugins/.cache/cache.bin
    - scripts/safety/pnpm-lock.yaml
  modified:
    - .gitignore (created in this plan; adds .planning/snapshots/ + node_modules/ + fixture exception)
decisions:
  - Stripping the password from the DSN before it lands in pg_dump/pg_restore argv; routing via PGPASSWORD env. PGUSER mirrors the URL's username so libpq still authenticates as the correct role. (Discovered as a real Rule-1 bug during S5 — original code passed dbUrl verbatim; test caught the literal `s3cr3t` in argv.)
  - Sibling-staging restore extracts into `<home>/.clarity-safety-restore-<snapshotId>/` (a true tmp dir under home) and only afterwards renames `instances/<originalInstanceId>` to `<home>/instances/<targetInstanceId>`. The live `<home>/instances/<originalInstanceId>/` dir is BYTE-IDENTICAL pre and post restore (verified by sha256 canaries in R3). This is stronger than the plan's "extract to <home>/instances/<id>.restoring/" wording, which would have wiped the live dir during the rename setup.
  - CVE-2026-31802 onentry guard records the violation + calls `entry.ignore()` rather than throwing inside the callback. Reason: node-tar 7.5.15 swallows synchronous throws inside onentry (they emit on the stream, not the awaitable). Re-throwing after `tar.x` resolves preserves the rejection contract while ensuring the malicious entry never lands on disk.
  - tar.x extracts into a sibling tmp dir under `<home>/` (not under `<home>/instances/`) so even a path-traversal entry cannot reach the live `instances/` dir without our resolved-path check catching it first. Defense in depth with the onentry symlink/hardlink rejection.
metrics:
  duration: ~30 minutes (start 2026-05-07T19:10Z; end 2026-05-07T19:40Z)
  total_loc: 2954
  test_count: 48
  files_created: 31
  artifacts_per_snapshot: 3 (manifest.json + db artifact + fs tar)
completed: 2026-05-07T19:40:39Z
---

# Phase 1 Plan 01: Safety CLI core (snapshot/restore/list/prune) Summary

The bookended-by-snapshots discipline now has a working substrate. `pnpm clarity-safety snapshot` produces a verified manifest + DB artifact + filesystem tar; `pnpm clarity-safety restore <id>` reverses any snapshot byte-for-byte via a sibling-staging pattern that NEVER touches the live instance dir; CVE-2026-31802 (tar path-traversal) is mitigated by tar@^7.5.15 plus an onentry guard that refuses SymbolicLink and Link entries; Postgres credentials never reach argv (PGPASSWORD/PGUSER via env). 48 unit tests cover all five SAFE-relevant code paths under `pnpm -C scripts/safety test`.

## Subcommands Implemented

| Subcommand | Status | Source |
|------------|--------|--------|
| `snapshot` | implemented | scripts/safety/lib/snapshot.mjs |
| `restore`  | implemented (staging only; atomic-swap exposed but only Plan 02's verify will call it) | scripts/safety/lib/restore.mjs |
| `list`     | implemented | scripts/safety/lib/list.mjs |
| `prune`    | implemented | scripts/safety/lib/prune.mjs |
| `smoke`    | stub: exits 2 with "smoke subcommand lands in plan 02" | scripts/safety/cli.mjs |
| `verify`   | stub: exits 2 with "verify subcommand lands in plan 02" | scripts/safety/cli.mjs |
| `gate`     | stub: exits 2 with "gate subcommand lands in plan 03"  | scripts/safety/cli.mjs |

## Tests (48 total — all passing)

| Group | Count | File | Behaviors |
|-------|-------|------|-----------|
| Manifest (M1-M3) | 3 | manifest.test.mjs | Round-trip, mutation detection, streaming sha256 vs in-memory digest |
| Paths (P1-P2) | 12 | paths.test.mjs | Env override, posix/win defaults, snapshot-id regex (acceptance + injection rejection) |
| Mode detect (D1-D4) | 4 | mode-detect.test.mjs | pglite/postgres fixtures, malformed → hint, ENOENT → ENOENT-aware hint |
| List + prune (L1, PR1, PR2) | 3 | list-prune.test.mjs | Newest-first ordering, keep/keepVerified semantics, <24h preservation |
| Snapshot orchestration (S4, S7, S8) | 3 | snapshot.test.mjs | lockfileSha256 capture, version + plugin list, snapshot-id format |
| Snapshot PGlite e2e (S1-S3) | 3 | snapshot-pglite.test.mjs | Real PGlite snapshot+sha256 round-trip, tar exclusions, --exclude-secrets |
| Snapshot Postgres mocked (S5, S6) | 2 | snapshot-postgres-mock.test.mjs | argv lock + PGPASSWORD/PGUSER routing, ENOENT install hint |
| Restore (R1-R4, R7-R9) | 7 | restore.test.mjs | sha256 gate, snapshot-id injection rejection, sibling-staging integrity, PGlite restore, atomic swap, live-target refusal, pg_restore argv lock |
| Restore CVE (R5, R6, TAR-PIN) | 3 | restore-tar-cve.test.mjs | SymbolicLink rejection, hardlink rejection, runtime tar version >= 7.5.11 |
| CLI (R10.a-h) | 8 | cli.test.mjs | Help, no-args, unknown subcommand, three stubs (smoke/verify/gate), invalid id, shebang |

Run with: `pnpm -C scripts/safety test` (Node 20+; the package's only test framework is the built-in `node:test` runner — no jest/mocha/vitest dependency added).

## CVE-2026-31802 Mitigation Evidence

Three layers of mitigation, three tests that prove each layer works:

1. **Pin** — `scripts/safety/package.json` declares `"tar": "^7.5.15"`. The `TAR-PIN` test resolves the runtime tar package's `version` field and asserts `>= 7.5.11`.
2. **Onentry guard** — `scripts/safety/lib/restore.mjs` ~line 230 records every `SymbolicLink`/`Link` entry and calls `entry.ignore()`; after `tar.x` resolves, it throws the recorded violation. The `R5` and `R6` tests hand-build a malicious tar.gz (raw 512-byte ustar header blocks gzipped via `node:zlib` — works on Windows where symlink creation needs admin), invoke `restoreToStaging`, and assert (a) the rejection error contains "Refusing to extract" and "SymbolicLink"/"Link", (b) the malicious entry does NOT exist on disk after the rejection, (c) no escape file appears at `../../../../etc/passwd`.
3. **Path canonicalization** — same callback rejects any entry whose resolved path leaves the staging dir, even if the type is "File". (No standalone test — the `evil` filename in R5/R6 is also outside staging, so the test exercises both paths simultaneously.)

## Postgres Credential Safety Evidence

| Mitigation | Where | Test |
|------------|-------|------|
| `pg_dump` argv shape locked | snapshot.mjs:84-91 | S5 (snapshot-postgres-mock.test.mjs) |
| `pg_restore` argv shape locked | restore.mjs:78-87 | R9 (restore.test.mjs) |
| Password stripped from DSN before argv | snapshot.mjs:60-79; restore.mjs:54-67 | S5 + R9 (assert literal `s3cr3t` absent from argv) |
| `PGPASSWORD` via env | snapshot.mjs:80-82; restore.mjs:74-77 | S5 + R9 (assert `captured.env.PGPASSWORD === 's3cr3t'`) |
| `PGUSER` mirrors URL username | snapshot.mjs:80-82; restore.mjs:74-77 | S5 (assert `captured.env.PGUSER === 'paperclip'`) |
| `--no-owner --no-privileges` on pg_dump | snapshot.mjs:84-91 | grep + S5 argv assertion |
| `--no-owner --no-privileges` on pg_restore | restore.mjs:80-87 | grep + R9 argv assertion |

## Files Created

- 1 `package.json` + 1 `pnpm-lock.yaml`
- 1 `cli.mjs` (227 LOC dispatcher)
- 8 `lib/*.mjs` files (1456 LOC of library)
- 10 `test/*.test.mjs` files (1271 LOC, 48 cases)
- 11 fixture files (3 config-mode fixtures + 7 fake-instance tree files + 1 `.gitignore` exception)
- 1 `.gitignore` (top-level)

**Total LOC:** ~2954 (within research budget of ~700 unit-testable + dispatcher; the over-target comes from comprehensive test coverage including PGlite e2e tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Postgres credential leaked via DSN in argv (snapshot.mjs)**

- **Found during:** Task 2, test S5 first run.
- **Issue:** Original `runPgDump` passed the operator-provided `dbUrl` verbatim into the `--dbname=...` argv slot. URLs of the form `postgresql://user:s3cr3t@host:5432/db` carry the password in cleartext, which is visible to anyone with `ps` privileges on the host. This is exactly Security Domain T2 (Information Disclosure → DB credentials in argv) — the plan's BLOCKING criterion explicitly forbids this.
- **Fix:** Parse the DSN, strip the password (and capture the username), pass `--dbname=<sanitized DSN>` in argv, route the password via `PGPASSWORD` env and the username via `PGUSER` env. Same pattern applied symmetrically to `pg_restore` in restore.mjs.
- **Files modified:** scripts/safety/lib/snapshot.mjs, scripts/safety/lib/restore.mjs, scripts/safety/test/snapshot-postgres-mock.test.mjs (test now asserts both that the password is absent from argv AND that PGPASSWORD/PGUSER are present in env).
- **Commit:** e93169e (Task 2) for snapshot.mjs; bac5b84 (Task 3) for restore.mjs.

**2. [Rule 1 — Bug] Sibling-staging design wiped the live instance dir before restore (restore.mjs)**

- **Found during:** Task 3, test R3 first run.
- **Issue:** First implementation extracted the tar with `cwd: <home>` directly into `<home>/instances/<originalInstanceId>/`, then renamed that path to `<home>/instances/<targetInstanceId>`. To make the rename safe, the implementation called `rm -r <home>/instances/<originalInstanceId>` BEFORE extraction. With the canonical case `originalInstanceId = 'default'` and `targetInstanceId = 'default.restoring'`, this `rm` destroyed the live dir BEFORE tar.x ran — defeating the entire sibling-staging guarantee. R3 caught this by asserting the live `config.json` sha256 was unchanged across the restore call; the assertion fired ENOENT because the file had been deleted.
- **Fix:** Extract into a sibling tmp dir under `<home>` itself (`<home>/.clarity-safety-restore-<snapshotId>/`), then `rename` the inner `instances/<originalInstanceId>/` subtree to `<home>/instances/<targetInstanceId>/`. The live dir is never touched.
- **Files modified:** scripts/safety/lib/restore.mjs (the central extract+rename block, ~80 lines).
- **Commit:** bac5b84 (Task 3).

**3. [Rule 3 — Blocking] node-tar's onentry callback swallows synchronous throws (restore.mjs)**

- **Found during:** Task 3, tests R5 and R6.
- **Issue:** First implementation threw an Error inside the onentry callback when a SymbolicLink/Link entry was seen. The throw correctly aborted the entry's write to disk, but the throw did not propagate to the awaitable `tar.x` promise (node-tar emits the throw on its internal stream, not via the promise rejection path). Tests caught this — `assert.rejects(...)` failed because no rejection ever arrived.
- **Fix:** Refactored the guard to (a) record the first violation in a closure-scope variable, (b) call `entry.ignore()` so node-tar skips writing the entry, and (c) after `tar.x` resolves, re-throw the recorded violation. The malicious entry never lands on disk; the caller still gets a clear rejection.
- **Files modified:** scripts/safety/lib/restore.mjs (~25 lines around the `tar.x` call).
- **Commit:** bac5b84 (Task 3).

### Acceptance-criteria interpretation note (NOT a behavior deviation)

The plan's acceptance criteria use grep checks of the form `grep -q "^export function writeManifest"`. The implementation declares all I/O-bound exports as `export async function writeManifest(...)` (idiomatic; the plan's `<interfaces>` block specifies `Promise<void>` return types, so `async` is correct). The literal grep regex `^export function` does not match `^export async function`. Re-grepping with the broader pattern `^export (async )?function` confirms every required export is present:

```
$ grep -E '^export (function|async function)' scripts/safety/lib/*.mjs scripts/safety/cli.mjs
scripts/safety/lib/list.mjs:export async function listSnapshots(...)
scripts/safety/lib/manifest.mjs:export async function sha256OfFile(...)
scripts/safety/lib/manifest.mjs:export async function writeManifest(...)
scripts/safety/lib/manifest.mjs:export async function readManifest(...)
scripts/safety/lib/manifest.mjs:export async function verifyManifest(...)
scripts/safety/lib/mode-detect.mjs:export async function detectMode(...)
scripts/safety/lib/paperclip-cli.mjs:export async function getPaperclipVersion(...)
scripts/safety/lib/paperclip-cli.mjs:export async function listInstalledPlugins(...)
scripts/safety/lib/paths.mjs:export function resolvePaperclipHome(...)
scripts/safety/lib/paths.mjs:export function resolveInstanceDir(...)
scripts/safety/lib/paths.mjs:export function resolveSnapshotsDir(...)
scripts/safety/lib/paths.mjs:export function isValidSnapshotId(...)
scripts/safety/lib/prune.mjs:export async function pruneSnapshots(...)
scripts/safety/lib/restore.mjs:export function rejectIfLiveTargetWithoutOverride(...)
scripts/safety/lib/restore.mjs:export async function restoreToStaging(...)
scripts/safety/lib/restore.mjs:export async function atomicSwap(...)
scripts/safety/lib/snapshot.mjs:export async function snapshot(...)
```

All required exports exist with the documented contracts; the only difference from the plan's literal grep is the `async` keyword on functions that return Promises.

### Test runner invocation

The plan's `<action>` Step 1 declared `"test": "node --test --test-reporter=spec test/"`. On Node 24, `node --test test/` interprets `test/` as a single module to load (causing a `MODULE_NOT_FOUND` error) rather than a directory to discover. The package.json now uses `"test": "node --test --test-reporter=spec \"test/**/*.test.mjs\""`, which works on both Node 20 and Node 24. Same behavior, more portable invocation.

## Authentication Gates

None encountered. The plan was executed entirely autonomously — no live Paperclip server was needed (Postgres-mode tests used mocked spawn; PGlite-mode tests used the in-process WASM PGlite). Plan 03's rehearsal will exercise the live install paths.

## Threat Surface Scan

No new attack surface beyond what the plan's `<threat_model>` already enumerates (T-01-01 through T-01-08). The pg_dump password-leak fix (deviation #1 above) is a refinement of T-01-02's mitigation, not a new threat.

## Outstanding (deferred to next plans)

- **Plan 02** wires `smoke` (5-check REST sequence against the staged Paperclip) and `verify` (restore-to-staging → smoke → set `verifiedAt` in manifest → invoke `atomicSwap`).
- **Plan 03** wires `gate` (refuse-or-run wrapper around `pnpm paperclipai plugin install`), the runbook (`runbook/README.md`, `runbook/REHEARSAL.md`, `runbook/PLATFORMS.md`, `runbook/snapshot.{ps1,sh}` launchers), and Eric's first end-to-end rehearsal against tomorrow's fresh local Paperclip install.
- **Phase 2+** is plugin code (clarity-pack itself); Phase 1 produces NO plugin code by design (PROJECT.md requirement: tooling lives in this repo's `runbook/` and `scripts/`, NOT inside the plugin, so it works even when clarity-pack is broken or uninstalled).

## Self-Check: PASSED

All claims verified:
- `scripts/safety/package.json` exists with tar@^7.5.15, engines.node>=20, type:module — confirmed.
- All 8 lib modules + cli.mjs exist with the documented exports — confirmed via grep.
- All 10 test files + 11 fixtures exist — confirmed.
- `pnpm -C scripts/safety test` exits 0 with 48/48 passing — confirmed (final run 2026-05-07T19:40Z).
- Three commits exist on the working branch:
  - 620ec0b — Task 1 (foundation)
  - e93169e — Task 2 (snapshot)
  - bac5b84 — Task 3 (restore + cli)
- `.gitignore` contains `.planning/snapshots/` — confirmed.
- CVE-2026-31802 tests R5, R6, TAR-PIN all green; argv credential-safety tests S5, R9 all green.
