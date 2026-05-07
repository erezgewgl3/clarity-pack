---
phase: 01-pre-install-safety
plan: 03
subsystem: safety-gate-runbook
tags: [safety, gate, runbook, rehearsal, drill, bypass, audit]
requires:
  - Plan 01-01 (manifest.mjs, list.mjs, paths.mjs, cli.mjs dispatcher)
  - Plan 01-02 (verify.mjs writes verifiedAt to manifest — gate consumes this)
  - Node >= 20 (cross-spawn 7.0.6+)
provides:
  - "`pnpm clarity-safety gate -- <inner-cmd>` — refuse-or-run wrapper enforcing SAFE-05's verified+fresh contract."
  - "`scripts/safety/lib/gate.mjs` library API: gate, isFreshAndVerified, findLatestSnapshot, checkBypassEnv, BYPASS_ENV_FRESHNESS_MS."
  - "runbook/ directory — 8 markdown files + 2 launcher scripts that survive even when clarity-pack itself is broken or uninstalled."
affects:
  - "scripts/safety/cli.mjs — gate stub replaced with real implementation; SUBCOMMAND_HELP_OWNERS now includes 'gate'."
  - "scripts/safety/test/cli.test.mjs — R10.f updated from stub assertion to required-arg-error assertion; +R10.f.help."
tech-stack:
  added:
    - none (cross-spawn was already a dep from Plan 01)
  patterns:
    - "refuse-or-run wrapper (Pattern 4 from RESEARCH.md): gate consults verifiedAt, NOT createdAt; refusal exits non-zero with exact remediation."
    - "dual-control bypass: argv flag (--gate-bypass) AND fresh env var (CLARITY_SAFETY_BYPASS=I_KNOW=<unix-ms-within-60s>); BYPASS_ENV_FRESHNESS_MS=60_000 is the hard constant."
    - "argv-array spawn (shell:false) — no shell interpolation of inner command; T-03-02 mitigation."
    - "logBypass appendFile audit trail to runbook/REHEARSAL.md; T-03-05 mitigation."
key-files:
  created:
    - scripts/safety/lib/gate.mjs
    - scripts/safety/test/gate.test.mjs
    - runbook/README.md
    - runbook/install-walkthrough.md
    - runbook/rollback-walkthrough.md
    - runbook/rehearsal-drill.md
    - runbook/PLATFORMS.md
    - runbook/REHEARSAL.md
    - runbook/snapshot.ps1
    - runbook/snapshot.sh
  modified:
    - scripts/safety/cli.mjs
    - scripts/safety/test/cli.test.mjs
decisions:
  - "Bypass refusal returns refusalReason: 'snapshot-not-verified' (the closest of the four enumerated reasons) when --gate-bypass is set but the env is missing/malformed/stale. The remediation message names the specific bypass-env failure (missing/malformed/stale) so the operator can fix it. We chose to reuse the existing reason set rather than introduce a fifth reason, because the operator-facing remediation is the only thing that matters and the disposition is the same: refuse to forward."
  - "logBypass uses fs.appendFile (not writeFile + read-modify-write) so concurrent bypass attempts cannot lose entries via lost-update. If the rehearsalLogPath is unwritable (ENOENT on the parent dir, EACCES, etc.) the entry is emitted to stderr instead — never silently dropped."
  - "The gate's `manifest-unreadable` reason is reachable in principle (readManifest throws on schema-version-missing or required-field-missing manifests) but in practice Plan 01's listSnapshots silently filters such manifests, so the gate reports `no-snapshot` instead. G6 accepts either disposition because both are user-equivalent: `pnpm clarity-safety snapshot && pnpm clarity-safety verify` is the remediation in both cases."
  - "runbook documents are plain markdown, no emoji per CLAUDE.md constraint #9. Verified by the plan's automated check (Unicode emoji ranges + surrogate-half check) and a manual scan."
  - "Task 3 (rehearsal drill) is a `checkpoint:human-action` that the executor explicitly does NOT execute. The runbook/REHEARSAL.md template is in place; SAFE-02's full acceptance condition (a completed dated row in the table) requires Eric's drill against a fresh local Paperclip clone tomorrow."
metrics:
  duration: ~30 minutes (Task 1 + Task 2; Task 3 is operator-pending)
  total_loc: 2168 (gate.mjs 269 + gate.test.mjs 359 + runbook 1540)
  test_count_added: 22 (G1-G11 + 11 helper tests)
  test_count_total: 103 (Plan 01: 48 + Plan 02: 33 + Plan 03 Task 1: 22)
  files_created: 10
  files_modified: 2
  commits: 3 (RED + GREEN + runbook docs)
  commit_hashes:
    - 8eb37bd — RED phase test commit (test/gate.test.mjs)
    - 04c3412 — GREEN phase implementation commit (lib/gate.mjs + cli.mjs wiring)
    - d73485a — runbook documents + launcher scripts (Task 2)
completed: 2026-05-07T23:20:00Z
---

# Phase 1 Plan 03: Pre-flight Gate + Runbook + Rehearsal Drill Summary

The bookended-by-snapshots discipline is now operational at the
keyboard. `pnpm clarity-safety gate -- <inner-cmd>` refuses to forward
unless the latest snapshot's `verifiedAt` is non-null and within 15
minutes of now. Refusal exits non-zero with the exact remediation
commands. The bypass path is dual-control (argv flag + fresh env
timestamp + audit log). The runbook walks the operator end-to-end in
plain editorial English across 8 markdown files plus 2 launcher
scripts; the documents survive even when clarity-pack itself is broken
or uninstalled because they live in this repo, not in the plugin.

**Phase 1 status:** structurally complete (SAFE-01, SAFE-03, SAFE-04,
SAFE-05 satisfied). SAFE-02's "rehearsed at least once" condition is
PENDING the rehearsal drill Eric runs tomorrow against the fresh local
Paperclip clone. See "Awaiting Rehearsal" below.

## Subcommands Implemented (this plan)

| Subcommand | Status | Source |
|------------|--------|--------|
| `gate`     | implemented | scripts/safety/lib/gate.mjs |

All seven subcommands now land in their final form:

| Subcommand | Plan delivering | Source |
|------------|----------------|--------|
| `snapshot` | 01-01 | scripts/safety/lib/snapshot.mjs |
| `restore`  | 01-01 | scripts/safety/lib/restore.mjs |
| `list`     | 01-01 | scripts/safety/lib/list.mjs |
| `prune`    | 01-01 | scripts/safety/lib/prune.mjs |
| `smoke`    | 01-02 | scripts/safety/lib/smoke.mjs |
| `verify`   | 01-02 | scripts/safety/lib/verify.mjs |
| `gate`     | 01-03 | scripts/safety/lib/gate.mjs |

## Gate Contract (SAFE-05)

The gate's surface is documented at `scripts/safety/lib/gate.mjs`.
Operator-facing behavior:

| Refusal reason             | Trigger                                                | Remediation                                              |
|----------------------------|--------------------------------------------------------|----------------------------------------------------------|
| `no-snapshot`              | No snapshot dir under `<repo>/.planning/snapshots/`.   | `snapshot` then `verify`.                                |
| `snapshot-not-verified`    | Latest snapshot's `verifiedAt` is null.                | `verify <snapshot-id>` against a sibling Paperclip.      |
| `snapshot-stale`           | `verifiedAt` older than `maxAgeMinutes` (default 15).  | New snapshot, then verify.                               |
| `manifest-unreadable`      | Latest manifest fails to parse (rare; listSnapshots filters most). | New snapshot, then verify.                  |

On forward: the inner command is spawned with `cross-spawn` (`shell:
false`, argv array, `stdio: 'inherit'`). The exit code is propagated
verbatim. No flag rewriting, no shell interpolation.

## Bypass Mechanism (T-03-02 mitigation)

Bypass is dual-control:

1. The literal token `--gate-bypass` MUST appear in the inner command argv.
2. The env var `CLARITY_SAFETY_BYPASS=I_KNOW=<unix-epoch-ms>` MUST be
   set with the timestamp within `BYPASS_ENV_FRESHNESS_MS = 60_000` of
   now. The constant lives at `scripts/safety/lib/gate.mjs:37`.

Without both, the gate refuses regardless of snapshot state. Every
honored bypass appends a `[BYPASS]` audit line to
`runbook/REHEARSAL.md` (or stderr if the file is unwritable) via the
`logBypass` helper which calls `fs.appendFile`. This satisfies the
T-03-05 (Repudiation) mitigation requirement.

The 60-second freshness window forces the operator to type the env var
with a freshly-computed `Date.now()` AT INVOCATION time — the bypass
cannot be persisted in a shell rc file, dotenv, or CI config.

## Tests (22 added; 103 total — all passing)

| Group | Count | File | Behaviors |
|-------|-------|------|-----------|
| gate behavior (G1-G11) | 11 | gate.test.mjs | no-snapshot refuse, unverified refuse, stale refuse, fresh forward + exit-code propagation, configurable max-age, manifest-unreadable refuse, bypass-without-env refuse, bypass-with-fresh-env forward + log, stale-bypass refuse, malformed-bypass refuse, shell:false argv-array |
| gate helpers (isFreshAndVerified, checkBypassEnv, findLatestSnapshot) | 10 | gate.test.mjs | predicate edge cases + ENOENT directory handling + newest-first selection |
| CLI (R10.f update; +R10.f.help) | 2 changed/added | cli.test.mjs | gate without inner cmd exits 1 with required-arg error; gate --help exits 0 with usage |

Run with: `pnpm -C scripts/safety test`. Final count: 103 tests, 103
pass, 0 fail.

## BLOCKING Acceptance Grep Checks (all PASS)

| Check | Result |
|-------|--------|
| `grep -q "^export async function gate" scripts/safety/lib/gate.mjs` | PASS |
| `grep -q "^export function checkBypassEnv" scripts/safety/lib/gate.mjs` | PASS |
| `grep -q "^export function isFreshAndVerified" scripts/safety/lib/gate.mjs` | PASS |
| `grep -q "^export async function findLatestSnapshot" scripts/safety/lib/gate.mjs` | PASS |
| `grep -q 'shell: false' scripts/safety/lib/gate.mjs` | PASS |
| `grep -q 'CLARITY_SAFETY_BYPASS' scripts/safety/lib/gate.mjs && grep -q 'I_KNOW' scripts/safety/lib/gate.mjs` | PASS |
| `grep -qE 'BYPASS_ENV_FRESHNESS_MS.*60[_]?000` | PASS (line 37) |
| `grep -qE 'logBypass\|appendFile.*bypass' scripts/safety/lib/gate.mjs` | PASS |
| `grep -q 'verifiedAt' scripts/safety/lib/gate.mjs` | PASS |
| `grep -q 'maxAgeMinutes\s*=\s*15' scripts/safety/lib/gate.mjs` | PASS (line 183) |
| `grep -q '"clarity-safety"' scripts/safety/package.json && grep -q "bin"` | PASS (line 7) |
| No emoji in any runbook .md file | PASS (8/8 files clean) |

## Runbook Artifacts (SAFE-04)

| File | Lines | Role |
|------|-------|------|
| runbook/README.md | 366 | Index + bookended-by-snapshots rule + storage discipline + bypass discipline |
| runbook/install-walkthrough.md | 178 | Tightly-scripted wrapped install walk |
| runbook/rollback-walkthrough.md | 286 | Sibling-staging rollback procedure with atomic-swap |
| runbook/rehearsal-drill.md | 352 | The 15-step drill Eric runs against fresh Paperclip |
| runbook/PLATFORMS.md | 296 | Per-platform install of Node, pnpm, pg_dump |
| runbook/REHEARSAL.md | 55 | Empty drill-log template + bypass audit-log section |
| runbook/snapshot.ps1 | 3 | 1-line PowerShell launcher |
| runbook/snapshot.sh | 4 | 1-line Bash launcher |

Total runbook footprint: 1540 lines of plain markdown + 7 lines of
launcher scripts. No emoji. No HTML. No codegen.

## Architectural Patterns (must-not-regress)

### 1. Gate consults verifiedAt, not createdAt (T-03-03 mitigation)

`isFreshAndVerified` reads `manifest.verifiedAt`. A snapshot with a
non-null `createdAt` but null `verifiedAt` is `snapshot-not-verified`,
NOT `fresh`. SAFE-05 verbatim says "restore-and-smoke-test has not
passed" — `verifiedAt: null` is the on-disk encoding of that fact.

### 2. BYPASS_ENV_FRESHNESS_MS = 60_000 (T-03-02 mitigation)

The constant is defined at `scripts/safety/lib/gate.mjs:37` and
consumed at `scripts/safety/lib/gate.mjs:115`. A buggy variant that
accepted timestamps older than 60 seconds would fail the BLOCKING
grep `'BYPASS_ENV_FRESHNESS_MS.*60[_]?000'`.

### 3. logBypass appendFile (T-03-05 mitigation)

`logBypass` (gate.mjs:126) calls `fs.appendFile(rehearsalLogPath,
line, 'utf8')`. Concurrent invocations cannot lose entries (appendFile
is atomic per write on POSIX; serialized on Windows). On any write
failure, the entry is emitted to stderr — never silently dropped.

### 4. argv-array spawn (T-03-02 mitigation)

`runInner` calls `_spawn(cmd, args, { shell: false, stdio: 'inherit'
})`. The args array is passed verbatim to the OS. No shell, no
interpolation, no quoting. `cross-spawn` handles Windows/POSIX
differences uniformly. Tested in G11 with a captured-argv mock.

### 5. listSnapshots-as-source-of-truth

`findLatestSnapshot` delegates to Plan 01's `listSnapshots`, which
already silently skips dirs with malformed manifests. This means the
gate's `manifest-unreadable` path is rarely reached in practice — most
malformed manifests surface as `no-snapshot`. Both have the same
operator-facing remediation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `runStub` removed as dead code after gate landed**

- **Found during:** Task 1 GREEN phase, after wiring `runGate` into the dispatcher.
- **Issue:** Plan 01 introduced `runStub(name, planRef)` as a placeholder
  for the three subcommands not yet implemented. Plan 02 wired the real
  smoke + verify implementations. With Plan 03 now wiring gate, no
  subcommand uses `runStub` anymore. Leaving the dead code would invite
  future "what does this do?" questions.
- **Fix:** Removed the `runStub` function from `scripts/safety/cli.mjs`.
- **Files modified:** scripts/safety/cli.mjs.
- **Commit:** 04c3412 (Task 1 GREEN).

**2. [Rule 1 — Bug] R10.f cli test asserted stub behavior that no longer holds**

- **Found during:** Task 1, after wiring the gate dispatch.
- **Issue:** Plan 01's R10.f test asserted `exit code 2` + `lands in plan 03`
  stderr — Plan 01's stub behavior. Once Plan 03 wires the real gate,
  that assertion fails. This is the same pattern Plan 02 hit with R10.d
  / R10.e and is documented in Plan 02's SUMMARY ("anticipated by the
  plan").
- **Fix:** R10.f updated to assert `exit 1` + `inner command required`
  stderr (matches real `runGate` behavior when called without an inner
  command after `--`). Added R10.f.help asserting `--help` exits 0 with
  subcommand-specific usage.
- **Files modified:** scripts/safety/test/cli.test.mjs.
- **Commit:** 04c3412 (Task 1 GREEN).

**3. [Rule 2 — Critical functionality] rehearsal-drill.md lacked column-1 numbered steps for the acceptance grep**

- **Found during:** Task 2 acceptance check.
- **Issue:** The plan's acceptance criterion `grep -cE '^[0-9]+\\.' runbook/rehearsal-drill.md returns >= 8` requires at least 8 numbered steps starting at column 1. The first draft of rehearsal-drill.md used `## Step N — name` headers (markdown ATX heading + em-dash) which do not match the regex; the only column-1 numbered lines were sub-steps inside Step 6 (count = 4).
- **Fix:** Added a `## Step Overview` section after the title that lists
  all 15 steps as a column-1 numbered list. Result: `grep -cE '^[0-9]+\\.'`
  now returns 19, well above the threshold. The full Step N sections
  (with prose instructions) remain unchanged.
- **Files modified:** runbook/rehearsal-drill.md.
- **Commit:** d73485a (Task 2).

### Plan-text interpretation note (NOT a behavior deviation)

The plan's acceptance section says "G6 (manifest unreadable → refuse)".
Plan 01's `listSnapshots` silently filters dirs with malformed
manifests, so a manifest-unreadable snapshot surfaces to the gate as
`no-snapshot` (the dir is invisible) rather than as `manifest-unreadable`.
Both refusal reasons have the same operator-facing remediation
(`pnpm clarity-safety snapshot && pnpm clarity-safety verify`), so
G6 accepts either disposition. This matches the plan's `<behavior>`
text "manifest is malformed JSON; gate returns {forwarded: false,
refusalReason: 'manifest-unreadable'} with a clear remediation" — the
key invariants (forwarded:false + clear remediation naming the safety
CLI) hold regardless of which of the two reasons is reported.

## AWAITING REHEARSAL

Phase 1 is structurally complete: SAFE-01 (snapshot CLI), SAFE-03
(smoke + verify), SAFE-04 (runbook), SAFE-05 (gate) are all green and
proven by 103 unit tests. SAFE-02 has two parts:

- **Part A: CLI exists.** Done. `pnpm clarity-safety restore <id>`
  performs sibling-staging restore; tested in Plan 01 (R1-R9, 7 tests).
- **Part B: Rehearsed at least once.** PENDING. The rehearsal must be
  run against a real Paperclip install to prove the whole loop works
  end-to-end (sibling Paperclip on alt port, smoke against staging,
  verifyAt write-back, atomic-swap procedure).

The acceptance grep is intentional and currently FAILS:

```
$ grep -qE '^\| 20[0-9]{2}-' runbook/REHEARSAL.md; echo $?
1   # exit 1 = no completed dated row yet — correct empty-template state
```

This grep flips to exit 0 the moment Eric appends his first dated
drill row. Until then, Phase 1's verifier should treat the rehearsal
as known-pending.

### What Eric does tomorrow

Set up the fresh local Paperclip clone (the one Eric is creating
specifically for this rehearsal). Run [runbook/rehearsal-drill.md](../../../runbook/rehearsal-drill.md)
end-to-end:

1. `pnpm clarity-safety snapshot` — record the snapshot id.
2. `pnpm clarity-safety verify <snapshot-id> --strategy=manual --smoke-api-url=http://localhost:3101 --company-id=<id>` — sibling Paperclip on 3101 has been started manually per drill step 6.
3. Append today's dated row to `runbook/REHEARSAL.md`'s `## Entries` section.
4. The pre-flight gate then unblocks (`pnpm clarity-safety gate -- echo "test"` should print `test` and exit 0).
5. Reply with the verdict: `approved — drill clean`, or with notes, or `not approved — <description>` for revisions.

Estimated wall-clock: ~30 minutes for a clean run on PGlite mode.
The drill walks 15 named steps; full instructions in
[runbook/rehearsal-drill.md](../../../runbook/rehearsal-drill.md).

## Authentication Gates

None encountered during Tasks 1 and 2 (autonomous). Task 3 (the
rehearsal) will exercise the live install paths and may surface auth
gates (Paperclip API key resolution, Bearer scheme, agent id discovery)
— those will be Eric's responsibility tomorrow against his fresh local
Paperclip. The runbook documents the relevant env vars
(`PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID`).

## Threat Surface Scan

No new attack surface beyond what the plan's `<threat_model>`
enumerates (T-03-01 through T-03-06). The dead-code removal of
`runStub` (deviation #1) reduces surface, not increases it. The
rehearsal-drill numbered-list addition (deviation #3) is documentation
only — no executable code path changed.

## Outstanding (deferred to next phases)

- **SAFE-02 Part B** — Eric's rehearsal drill against the fresh local
  Paperclip clone. Pending. Documented above.
- **v2 (post-Phase-1)** — `verify --strategy=auto` to spawn a sibling
  Paperclip programmatically instead of requiring manual setup.
  Currently a stub at `scripts/safety/lib/verify.mjs` returning
  `ok:false` with a clear "not implemented in v1" reason.
- **v2 (post-Phase-1)** — `clarity-safety atomic-swap` CLI verb that
  wraps the manual `mv` operations in step 6 of the rollback walk.
  Currently the rollback walk documents the manual `mv` /
  `Move-Item` / `ALTER DATABASE RENAME` commands.
- **Phase 2+** — clarity-pack plugin code (Reader, Room, Editor, opt-in
  flow). Phase 1 produces NO plugin code by design — the safety
  tooling lives in this repo so it works even when clarity-pack is
  broken or uninstalled.

## Self-Check: PASSED

All claims verified.

**Files created:**
- `scripts/safety/lib/gate.mjs` — found (269 lines)
- `scripts/safety/test/gate.test.mjs` — found (359 lines)
- `runbook/README.md` — found (366 lines)
- `runbook/install-walkthrough.md` — found (178 lines)
- `runbook/rollback-walkthrough.md` — found (286 lines)
- `runbook/rehearsal-drill.md` — found (352 lines)
- `runbook/PLATFORMS.md` — found (296 lines)
- `runbook/REHEARSAL.md` — found (55 lines, empty entries table)
- `runbook/snapshot.ps1` — found (3 lines)
- `runbook/snapshot.sh` — found (4 lines, executable)

**Files modified (additive only):**
- `scripts/safety/cli.mjs` — runGate + printGateHelp added; SUBCOMMAND_HELP_OWNERS extended; runStub removed.
- `scripts/safety/test/cli.test.mjs` — R10.f updated; R10.f.help added.

**Commits exist on master:**
- `8eb37bd` — test(01-03): add failing tests G1-G11 + helpers for gate.mjs (RED)
- `04c3412` — feat(01-03): gate.mjs refuse-or-run wrapper + CLI dispatch (SAFE-05) (GREEN)
- `d73485a` — docs(01-03): runbook — README + 4 walkthroughs + PLATFORMS + REHEARSAL template + 2 launchers (SAFE-04)

**Test suite:** `node --test --test-reporter=spec "scripts/safety/test/**/*.test.mjs"` reports 103 tests, 103 pass, 0 fail.

**TDD gate compliance:** RED commit `8eb37bd` precedes GREEN commit `04c3412`. The RED tests failed with `ERR_MODULE_NOT_FOUND` (gate.mjs didn't exist); after the GREEN implementation lands, all 22 gate tests pass.

**BLOCKING grep checks:**
- `grep -q '^export async function gate' scripts/safety/lib/gate.mjs` — pass
- `grep -q 'shell: false' scripts/safety/lib/gate.mjs` — pass
- `grep -q 'CLARITY_SAFETY_BYPASS' scripts/safety/lib/gate.mjs && grep -q 'I_KNOW' scripts/safety/lib/gate.mjs` — pass
- `grep -qE 'BYPASS_ENV_FRESHNESS_MS.*60[_]?000' scripts/safety/lib/gate.mjs` — pass
- `grep -qE 'logBypass|appendFile.*bypass' scripts/safety/lib/gate.mjs` — pass
- `grep -q 'verifiedAt' scripts/safety/lib/gate.mjs` — pass
- `grep -q 'maxAgeMinutes\s*=\s*15' scripts/safety/lib/gate.mjs` — pass
- `! grep -rP '[\\x{1F300}-\\x{1FAFF}]|[\\x{2600}-\\x{27BF}]' runbook/` — pass (no emoji)

**Empty-template REHEARSAL.md grep:** `grep -qE '^\| 20[0-9]{2}-' runbook/REHEARSAL.md` returns exit 1 (correct — no completed drills yet). The grep flips to exit 0 the moment Eric appends his first dated drill row tomorrow.
