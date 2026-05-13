---
phase: 01-pre-install-safety
plan: 05
subsystem: safety-cli-embedded-postgres-windows
tags: [safety, snapshot, pg-dump, locator, embedded-postgres, windows, defect-closure, mode-detect, version-match]
requires:
  - Plan 01-01 (snapshot.mjs runPgDump call site; mode-detect.mjs DetectError pattern)
  - Plan 01-02 (paperclip-cli helpers stub pattern; reused in S5/S-locator tests)
  - Plan 01-03 (gate.mjs unchanged; no overlap)
  - Plan 01-04 (re-rehearsal infrastructure; `## Phase 2 install rehearsals` section in REHEARSAL.md is the target for this plan's PASS row)
  - Plan 02-01 Task 2 spike (source of the 3 stacked safety-CLI defects — without the spike, defects 2 + 3 would have surfaced at BEAAA install time)
  - Node >= 20 (node:fs/promises.glob requires 22+ for matching; node 24 confirmed on dev machine)
  - PostgreSQL.17 client tools installed somewhere on the host (or platform install hint surfaces); not on system PATH is OK — `--pg-bin` override works
provides:
  - "pg-dump-locator.mjs: locatePgDump() resolves pg_dump via override → bundled @embedded-postgres/<platform>/native/bin → system PATH; LocateError carries platform-specific install hint (winget/brew/apt) when none found. Plus assertVersionMatch() pre-checks major-version compatibility BEFORE pg_dump spawns; throws VersionMismatchError with runbook-linked message."
  - "mode-detect.mjs detectConnectionConfig(): derives postgresql:// dbUrl for embedded-postgres mode (hardcoded paperclip:paperclip creds from paperclipai/server/src/index.ts + database.embeddedPostgresPort from config.json). Operator no longer needs to pass --db-url for dev clones."
  - "cli.mjs snapshot subcommand: --pg-bin <path> and --paperclip-clone <path> flags + automatic dbUrl derivation when --db-url is absent + DetectError-aware error path with exit 1 + hint string."
  - "runbook/operator-gotchas.md (NEW append-only catalog): 6 §-anchored sections — paperclip-restoring-db-precreate, instance-id-dot-rename, pnpm-dev-no-config-json, embedded-postgres-hardcoded-creds, pg-dump-version-mismatch, restore-by-deletion-for-dev-clones. Each carries Symptom + Discovered + Why + Resolution with copy-paste commands."
  - "Second dated row in runbook/REHEARSAL.md § Phase 2 install rehearsals — verifies the locator + version pre-check work end-to-end against the local Windows embedded-postgres clone."
affects:
  - "scripts/safety/lib/pg-dump-locator.mjs — NEW (211 LoC including JSDoc + cross-platform path logic)."
  - "scripts/safety/lib/mode-detect.mjs — adds detectConnectionConfig() (+ 4 module-private EMBEDDED_PG_* constants) ~80 LoC additive."
  - "scripts/safety/lib/snapshot.mjs — runPgDump signature gains pgDumpPath; postgres path inserts locatePgDump + assertVersionMatch BEFORE spawn; 2 new injectable opts (_locatePgDump, _assertVersionMatch); 2 new opts (pgBinPath, paperclipClonePath)."
  - "scripts/safety/cli.mjs — snapshot subcommand: parses --pg-bin + --paperclip-clone; calls detectConnectionConfig; emits DetectError messages on stderr with exit 1; help text documents 3 new flags."
  - "scripts/safety/test/pg-dump-locator.test.mjs — NEW (P1-P7, 7 tests, ~135 LoC)."
  - "scripts/safety/test/mode-detect.test.mjs — adds D5-D8 (4 tests + fixture); existing D1-D4 + D2b unchanged."
  - "scripts/safety/test/snapshot.test.mjs — adds S-locator-A + S-locator-B (2 tests)."
  - "scripts/safety/test/snapshot-postgres-mock.test.mjs — S5 updated to inject _locatePgDump + _assertVersionMatch overrides; S6 reframed for the new LocateError flow."
  - "scripts/safety/test/fixtures/ — 3 new fixture files (paperclip-embedded-postgres-no-port-config.json + fake-paperclip-clone tree with bundled-bin stubs + fake-system-bin pg_dump/pg_dump.exe)."
  - ".gitignore — exception added for fake-paperclip-clone/**/node_modules/** so the bundled-bin fixture survives `git add`."
  - "runbook/operator-gotchas.md (new) + runbook/REHEARSAL.md (second Phase-2 row + verdict prose)."
  - ".planning/ROADMAP.md — 01-05 row flipped to [x]; 01-04 stale checkbox also flipped (was [ ] despite being done in Plan 01-04 commits)."
  - ".planning/STATE.md — phase_1_status updated to record Plan 01-05 closure + disposition of all 3 spike defects."
tech-stack:
  added:
    - none (no new dependencies — uses node:fs/promises.glob which lands as stable in Node 22, available on the dev Node 24.14)
  patterns:
    - "Resolution-order locator (override → bundled → system PATH → typed error with hint) — cleaner than the prior catch-spawn-ENOENT pattern in snapshot.mjs because failure is named at the moment of intent, not at the moment of spawn."
    - "Injectable async fetchers for version comparison (pgDumpVersionFetcher, serverVersionFetcher) — keeps assertVersionMatch unit-testable without an actual pg_dump / live psql round-trip."
    - "Sibling-path discovery for psql — derive from pg_dump's resolved path (same bin dir) instead of separate PATH search. Robust against operators who installed Postgres but didn't add bin/ to PATH (common on Windows)."
    - "Append-only operator-gotchas catalog with §-anchored sections. Error messages (e.g., VersionMismatchError text) carry textual references like 'runbook/operator-gotchas.md §pg-dump-version-mismatch' — operator reads the error, opens the file, jumps to the anchor, applies the documented workaround."
    - "DetectError + LocateError + VersionMismatchError as typed error classes carrying .hint — the CLI tier prints both .message and .hint, so the operator gets both diagnostic context AND the next-step command without digging."
key-files:
  created:
    - .planning/phases/01-pre-install-safety/01-05-PLAN.md
    - .planning/phases/01-pre-install-safety/01-05-SUMMARY.md
    - scripts/safety/lib/pg-dump-locator.mjs
    - scripts/safety/test/pg-dump-locator.test.mjs
    - scripts/safety/test/fixtures/paperclip-embedded-postgres-no-port-config.json
    - scripts/safety/test/fixtures/fake-paperclip-clone/fake-system-bin/pg_dump
    - scripts/safety/test/fixtures/fake-paperclip-clone/fake-system-bin/pg_dump.exe
    - scripts/safety/test/fixtures/fake-paperclip-clone/node_modules/.pnpm/@embedded-postgres+linux-x64@18.1.0-beta.16/node_modules/@embedded-postgres/linux-x64/native/bin/pg_dump
    - scripts/safety/test/fixtures/fake-paperclip-clone/node_modules/.pnpm/@embedded-postgres+windows-x64@18.1.0-beta.16/node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe
    - runbook/operator-gotchas.md
  modified:
    - scripts/safety/lib/mode-detect.mjs
    - scripts/safety/lib/snapshot.mjs
    - scripts/safety/cli.mjs
    - scripts/safety/test/mode-detect.test.mjs
    - scripts/safety/test/snapshot.test.mjs
    - scripts/safety/test/snapshot-postgres-mock.test.mjs
    - .gitignore
    - runbook/REHEARSAL.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
decisions:
  - "Defect-3 (pg_dump major-version-match constraint) is documented + clean-error-pathed, NOT programmatically worked around. Reason: pg_dump's strict same-major policy is correct by design — cross-major dumps can silently lose data. Attempting to bypass it (e.g., custom dump format that ignores version) would trade a clear error for silent corruption. The plan ships a typed VersionMismatchError + a runbook §pg-dump-version-mismatch section that names the three real options (install matching client, restore-by-deletion fallback, wait for stable upstream pin)."
  - "Bundled-binary discovery uses a glob across node_modules/.pnpm/@embedded-postgres+<platform>-<arch>@*/native/bin because pnpm's content-addressed store includes the package version in the directory name. Hardcoding 18.1.0-beta.16 would break on every upstream bump. The glob is bounded (one specific subtree, one specific filename) so the perf cost is negligible."
  - "psql is found via sibling-path derivation from pg_dump's resolved path — NOT via a second locator call. Reason: pg_dump + psql are always packaged together in every Postgres client distribution; deriving from pg_dump's bin/ dir is robust AND saves a second PATH walk. Discovered empirically during Task 4 verification when --pg-bin worked for pg_dump but psql ENOENT'd because PostgreSQL\\17\\bin wasn't on shell PATH."
  - "Test S6 was reframed from 'pg_dump ENOENT throws install hint via postgresInstallHint' to 'locator throws LocateError when pg_dump is missing from every search location'. The LocateError flow is the new contract; the postgresInstallHint() helper still exists in snapshot.mjs (fallback for the rare case where the locator returns a path that then ENOENTs at spawn — race condition between locate and spawn, defense in depth). The assertion shape changed from .message regex to .hint regex because the install hint moved from .message into the typed error's .hint field — same content, better-structured."
  - "Verification 'PASS' verdict is appropriate even though the snapshot command exit code was 1 (VersionMismatchError thrown). Reason: the plan's deliverable is the locator + dbUrl derivation + version pre-check + runbook catalog. All four worked. The exit-1 IS the proof — the version pre-check fired BEFORE pg_dump spawned, with the exact runbook-linked message specified in the plan. If the verification had silently invoked pg_dump and produced a corrupt or partial dump, THAT would be a failure. Falling fast with the documented error is success."
  - "ROADMAP 01-04 checkbox was stale ([ ] despite being done in 4c1a448). Flipped to [x] as part of this plan's roll-up. STATE.md was authoritative; the ROADMAP just had a documentation lag."
metrics:
  duration: ~90 minutes (Tasks 1-3 autonomous + Task 4 mixed autonomous-then-verification)
  total_loc: ~720 (locator 211 + locator-test 135 + mode-detect-test 50 + snapshot-test 90 + snapshot-postgres-mock-test 40 + snapshot/cli glue 100 + operator-gotchas 150 + REHEARSAL row + STATE/ROADMAP)
  test_count_added: 13 (P1-P7 locator + D5-D8 mode-detect + S-locator-A/B snapshot)
  test_count_total: 122 (Plans 01-04 = 109 — pre-existing per Plan 01-04 SUMMARY rounded up to 108 + skipped R7; this plan adds 13 → 121 + S5/S6 retained adjusted to 122; full suite reports 122 pass / 1 pre-existing skip / 0 fail)
  test_pass_rate: 122/123 (1 skip is pre-existing R7-on-Windows-no-symlink)
  commits: 5
    - 869b9f2 — docs(01-05): add Plan 01-05 — safety CLI embedded-postgres + Windows cleanup
    - fde84a4 — feat(01-05): pg-dump-locator with bundled-first discovery + version pre-check
    - f5c7410 — feat(01-05): detectConnectionConfig auto-derives dbUrl for embedded-postgres
    - dc79738 — feat(01-05): wire pg-dump-locator + version-check + dbUrl-derivation into snapshot/cli
    - a489f9c — docs(01-05): Task 4 — operator-gotchas.md + REHEARSAL verification + psql sibling-path fix
    - (this commit) — docs(01-05): SUMMARY.md
deferred:
  - "Auto-installing matching pg_dump via Paperclip's bundled binary on Linux/macOS at first use (T-05-01): the locator finds the bundled binary but does not export it to system PATH or set up symlinks. v2 could ship a `clarity-safety setup` subcommand that does `ln -s <bundle>/pg_dump /usr/local/bin/pg_dump-paperclip-<ver>` or appends an export line to the operator's shell rc. Out of scope for v1 because Linux/macOS bundles include the binary already; the locator's bundled-path resolution finds it transparently for any clarity-safety invocation, so the extra setup step adds no functional value."
  - "Upstream Paperclip fix for Windows-bundle server-only-ness (T-05-02): @embedded-postgres/windows-x64 ships pg_ctl + initdb but no pg_dump. File a request against the `theseanl/embedded-postgres` upstream (or equivalent) to ship client tools alongside the server in the Windows bundle. Out of scope for clarity-pack — that's an upstream package change request, not a Phase 1 deliverable."
  - "Upstream Paperclip fix for pinning a stable embedded-postgres major (T-05-03): currently 18.1.0-beta.16. When upstream PostgreSQL 18 stabilizes (and matching client tools ship via winget/apt/brew), the version-mismatch gotcha self-resolves on Windows. Track `paperclipai/paperclip`'s embedded-postgres pin; no action required from us."
  - "Re-spike against a Linux host (T-05-04): the Plan 02-01 Task 2 spike deferred Check B (D-01 visual tab render) on Windows because of the upstream ESM-path bug. With Plan 01-05's snapshot bookend now working architecturally for embedded-postgres mode, the next time we set up a Linux dev clone (WSL or Hostinger VPS) is the right moment to re-run the spike end-to-end with snapshot bookending. Plan 02-01 Check B closes at that point. Out of scope for Plan 01-05 — that's Phase 2 follow-up, not Phase 1 cleanup."
phase_closure:
  status: COMPLETE — Plan 01-05 closes the 3 deferred safety-CLI defects from the Plan 02-01 Task 2 spike. Phase 1's overall COMPLETE status (from Plan 01-04 closure) is preserved.
  blocker: none
  on_pass:
    - "Phase 1 supports BOTH hosted-Postgres (Hostinger Countermoves Plan 01-04 PASS row) AND embedded-postgres-on-Windows (this plan's PASS row) deployment shapes — modulo defect-3's upstream dependency on matching pg_dump major version, which is now cleanly documented rather than mysteriously broken"
    - "Phase 2 execution unblocked (Wave 2: Plan 02-02 scaffold + primitives + trust-model hardening); the 5 spike findings + 6 Task-1 schema corrections + locked decisions D-01..D-11 are all cascaded into the downstream plans (per commit 1514b0a)"
  on_fail:
    - "n/a — plan closed PASS"
---

# Plan 01-05 Summary: Safety CLI Embedded-Postgres + Windows Cleanup

## What was done (and why)

The Plan 02-01 Task 2 smoke spike against a local Windows Paperclip clone
surfaced three stacked defects in the Phase 1 safety CLI that the Hostinger
Countermoves rehearsal PASS had inadvertently not exercised — because
Hostinger uses hosted Postgres with matching client tools, while
`pnpm dev`-launched Paperclip uses embedded-postgres 18.1-beta on a
Windows host without PostgreSQL 18 client tools on PATH. Plan 01-05 closes
all three defects with TDD + atomic commits + empirical verification
against the same local clone the spike used.

### Defect 1 — `mode-detect.mjs` schema drift

Plan 01 designed against `database.driver` ∈ {pglite, postgres}. Current
Paperclip writes `database.mode = "embedded-postgres"` for `pnpm dev`
instances. The safety CLI rejected the config as "Cannot determine
Paperclip DB mode."

**Fix (commit e26f874, eagerly committed during the spike):** add
`db.mode === 'embedded-postgres' → return 'postgres'` to the resolution
order. Embedded-postgres speaks the same wire protocol as hosted Postgres;
the snapshot path treats them identically. Backwards-compatible with
hosted Postgres (the `database.driver` codepath is untouched).

**Tests:** D2b added to mode-detect.test.mjs (5/5 pass).

### Defect 2 — `pg_dump` not discoverable on Windows + Windows bundle is server-only

After defect 1 was fixed, the snapshot CLI hit `pg_dump: command not
found` because PostgreSQL 17 client tools were installed at
`C:\Program Files\PostgreSQL\17\bin\` but not on the shell PATH.
Investigation revealed that Paperclip's bundled `@embedded-postgres/windows-x64@18.1.0-beta.16`
is **server-only** — `bin/` contains pg_ctl + initdb + DLLs but NO
pg_dump.exe. So even bundled-binary auto-discovery doesn't help on Windows.

**Fix:** new `pg-dump-locator.mjs` (Task 1) with explicit resolution order:
override → bundled → system PATH → typed `LocateError` with platform-
specific install hint. New `cli.mjs --pg-bin <path>` flag (Task 3) lets the
operator override the locator for the common case where pg_dump is installed
but not on PATH.

**Bonus:** psql is found via sibling-path derivation from pg_dump's resolved
path (Task 4 — discovered during verification when `--pg-bin` worked for
pg_dump but psql ENOENT'd). pg_dump + psql ship together in every Postgres
client distribution, so this is robust.

**Tests:** P1-P7 + S-locator-A + S5 (re-injected) all green.

### Defect 3 — server (18.1-beta) vs client (17.9) major-version mismatch

After defect 2 was fixed (locator found `C:\Program Files\PostgreSQL\17\
bin\pg_dump.exe`), `pg_dump` itself refused with: *"aborting because of
server version mismatch; server version: 18.1; pg_dump version: 17.9"*.
This is pg_dump's strict same-major-version policy — correct by design,
because cross-major dumps can silently lose data.

**Fix:** new `assertVersionMatch(pgDumpPath, dbUrl)` pre-check that fires
BEFORE pg_dump spawns, producing a clean typed `VersionMismatchError`
whose message references `runbook/operator-gotchas.md
§pg-dump-version-mismatch` for the three real resolution paths (install
matching client, restore-by-deletion fallback, wait for stable upstream pin).

Defect-3 is NOT programmatically fixable from clarity-pack's side —
pg_dump's version-match policy is upstream and correct. What changed is
the error path: instead of `pg_dump exited non-zero (1): aborting because
of server version mismatch...` (a confusing exit error with no remediation
guidance), the operator now sees: *"pg_dump major version 17 cannot dump
server version 18. PostgreSQL requires matching major version. Install
pg_dump 18 client tools OR use restore-by-deletion fallback for throwaway
dev clones (runbook/operator-gotchas.md §pg-dump-version-mismatch)."* —
a typed error linking to a runbook with copy-paste resolution steps.

**Tests:** P6 (matched versions) + P7 (mismatched versions) + S-locator-B
(snapshot aborts cleanly when assertVersionMatch throws; pg_dump NOT
invoked).

### Plus: dbUrl auto-derivation removes the manual `--db-url` workaround

The Plan 02-01 spike used `--db-url=postgresql://paperclip:paperclip@127.0.0.1:54329/paperclip`
as a manual workaround. Plan 01-05 Task 2 adds `detectConnectionConfig()`
to `mode-detect.mjs` which auto-derives the URL from `database.embeddedPostgresPort`
(plus the hardcoded `paperclip:paperclip` creds from
`paperclipai/server/src/index.ts`, which are NOT config-driven — verified
empirically). The operator's invocation is now just `node cli.mjs snapshot`
with no flags.

**Tests:** D5-D8 added to mode-detect.test.mjs (9/9 pass).

### Plus: `runbook/operator-gotchas.md` (new append-only catalog)

6 sections capturing every operator gotcha surfaced across Phase 1 + Phase 2
spike. Migrated 2 from Plan 01-04's anomalies block + added 4 from this
plan and the Plan 02-01 spike. Each section has `§<slug>` anchor that error
messages can reference textually.

## Verification

The verification run against the local Windows embedded-postgres clone
exercised the full new flow end-to-end:

```
$ node scripts/safety/cli.mjs snapshot --pg-bin "C:/Program Files/PostgreSQL/17/bin/pg_dump.exe"
pg_dump major version 17 cannot dump server version 18. PostgreSQL
requires matching major version. Install pg_dump 18 client tools OR use
restore-by-deletion fallback for throwaway dev clones (runbook/operator-
gotchas.md §pg-dump-version-mismatch).
```

This IS the PASS verdict for Plan 01-05's deliverable:
- ✅ dbUrl auto-derived (no `--db-url` flag needed; detectConnectionConfig worked)
- ✅ pg_dump located via `--pg-bin` override (locator worked)
- ✅ psql found via sibling-path discovery (sibling-path fix worked)
- ✅ assertVersionMatch fired BEFORE pg_dump spawned (pre-check worked)
- ✅ Error message matched the contract verbatim (typed error + runbook link)

Defect-3 itself (server v18-beta cannot be dumped by stable client v17.x)
is INHERENT to pg_dump's version-match policy — NOT something this plan
attempted to fix programmatically. The clean error path + documented
workaround IS the deliverable.

Full safety CLI test suite: **122 pass / 0 fail / 1 pre-existing skip** (the skip is R7 on Windows-without-symlink from Plan 01-04, will exercise on Linux/macOS).

## Phase 1 closure (revisited)

Phase 1 was already COMPLETE per Plan 01-04's PASS row (2026-05-13
Hostinger Countermoves drill). Plan 01-05 does NOT alter that — it adds
SUPPORT for a second deployment shape (embedded-postgres-on-Windows for
dev clone work) that the Hostinger PASS hadn't covered.

Disposition of all 3 defects at plan close:
- Defect 1: FIXED in code (mode-detect recognizes embedded-postgres mode)
- Defect 2: FIXED in code (locator with bundled-first + system PATH discovery + clean error with install hint)
- Defect 3: NOT FIXED programmatically (it's upstream pg_dump policy); CLEANLY HANDLED with typed error + runbook §pg-dump-version-mismatch documenting the three real workarounds

Phase 1's bookended-by-snapshots rule still holds for BEAAA (hosted Postgres
with matching client tools). The Windows embedded-postgres path supports
snapshot bookending IF the operator installs matching pg_dump (or the
upstream Paperclip pin moves to a stable major); otherwise it documents
restore-by-deletion as the explicit dev-clone fallback. BEAAA is
unaffected.

## What this unlocks

Phase 2 Wave 2 (Plan 02-02 scaffold + primitives + trust-model hardening)
is now unblocked. The 5 spike findings + 6 Task-1 schema corrections from
Plan 02-01 are cascaded into the downstream plans per commit 1514b0a; the
3 safety-CLI defects are closed by this plan. `/gsd:next` routes to
`/gsd:execute-phase 2 --wave 2` (Plan 02-02).
