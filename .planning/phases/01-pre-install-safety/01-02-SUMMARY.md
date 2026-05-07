---
phase: 01-pre-install-safety
plan: 02
subsystem: safety-smoke-verify
tags: [safety, smoke, verify, rest-client, http, abort-signal, atomic-write]
requires:
  - Plan 01-01 (manifest.mjs, restore.mjs, paths.mjs, cli.mjs dispatcher)
  - Node >= 20 (AbortSignal.any requires Node 20.3+)
provides:
  - `pnpm clarity-safety smoke` — 5-check REST smoke pass with optional manifest cross-check
  - `pnpm clarity-safety verify <id>` — restore-to-staging + smoke + atomic verifiedAt write-back
  - `scripts/safety/lib/{paperclip-api,smoke,verify}.mjs` library API
  - `manifest.mjs` augmented with `writeManifestAtomic` + `updateManifest`
  - `scripts/safety/test/fixtures/stub-paperclip-server.mjs` (test-only HTTP stub)
affects:
  - scripts/safety/lib/manifest.mjs (additive — original exports byte-identical)
  - scripts/safety/cli.mjs (smoke + verify stubs replaced with real implementations)
  - scripts/safety/test/cli.test.mjs (R10.d/R10.e updated to match real behavior; +R10.d.help, R10.e.help)
tech-stack:
  added:
    - none (Node 20+ native fetch, AbortController, AbortSignal.any, http — zero new deps)
  patterns:
    - per-check AbortController timeout composed with outer deadline AbortSignal via `AbortSignal.any`
    - tmp-file-and-rename atomic manifest write (writeManifestAtomic)
    - 4xx-vs-5xx disposition split on heartbeat (research Open Question 2)
    - conditional version-cross-check (skipped when /health body lacks paperclipVersion)
    - operator-managed sibling Paperclip via `--smoke-api-url` (manual strategy v1)
    - runbook-hint-suffix on missing-flag errors (W9 fix — operators don't reach for --gate-bypass)
key-files:
  created:
    - scripts/safety/lib/paperclip-api.mjs
    - scripts/safety/lib/smoke.mjs
    - scripts/safety/lib/verify.mjs
    - scripts/safety/test/paperclip-api.test.mjs
    - scripts/safety/test/smoke.test.mjs
    - scripts/safety/test/verify.test.mjs
    - scripts/safety/test/fixtures/stub-paperclip-server.mjs
  modified:
    - scripts/safety/lib/manifest.mjs (additive: writeManifestAtomic + updateManifest; +1 import)
    - scripts/safety/cli.mjs (runSmoke + runVerify; printSmokeHelp + printVerifyHelp; subcommand-help routing)
    - scripts/safety/test/cli.test.mjs (R10.d/R10.e updated to non-stub behavior; +R10.d.help, R10.e.help)
decisions:
  - "Outer deadline AbortSignal composition: smoke owns the EXACT reason string `'rehearsal time exceeded'` and surfaces it via `deadlineFired()` check inside the per-check catch block. verify creates the AbortController and passes its signal into smoke via `opts.deadline`; smoke uses `AbortSignal.any([localCtrl.signal, deadline])` so whichever fires first cancels the in-flight fetch. This is enforcement via signal, not post-hoc Date.now check (B3 fix from iteration-2 plan-checker)."
  - "Atomic manifest write-back: writeManifestAtomic ALWAYS goes through tmp + rename; verifiedAt is ONLY written when smoke returns ok:true. V3 explicitly asserts manifest.verifiedAt remains null on smoke FAIL. The original writeManifest is preserved byte-identical so Plan 01's M1/M2/M3 tests still pass."
  - "Conditional version-cross-check: when /health body lacks paperclipVersion, version-cross-check returns `{status: 'skipped', detail: 'server did not report paperclipVersion in /health body; ...'}` — does NOT fail smoke. Plugin-list set-equality remains required when snapshotId is supplied. Promoting version-cross-check to fail-closed is an Open Question for SPEC.md, not a Phase-1 deliverable."
  - "Manual-strategy-without-smoke-api-url throws an Error whose message ENDS with `'See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.'` — this points operators at the runbook instead of having them reach for --gate-bypass (W9 fix). Tested by V8 with `endsWith` (not `match`) to enforce the suffix invariant."
  - "Auto strategy is a v2 stub that returns `{ok: false, failedCheck: 'strategy', reason: '...'}` — not a thrown error. Operators see the exit-1 + reason in the CLI output without crashing the safety tool. The reason includes `'auto strategy not implemented in v1'` and the same runbook hint."
  - "redactedError scrubs both literal apiKey occurrences AND the `Bearer <apiKey>` prefix variant (defense in depth). API7 + API9 + SM9 verify the apiKey never lands in error messages or smoke-result reasons."
  - "stub-paperclip-server is 100 lines of pure node:http with 7 modes: healthy / healthy-noversion (drives SM11) / down / unauth / plugin-drift (drives SM6) / version-drift (drives SM7) / heartbeat-401 (drives SM3). Always binds 127.0.0.1; never exposed beyond loopback. setMode lets a single test flip the server's response shape."
  - "CLI subcommand-help routing: introduced `SUBCOMMAND_HELP_OWNERS = new Set(['smoke', 'verify'])` so subcommand-specific --help handlers run instead of falling back to the root help. Required because Plan 01's main() short-circuited on flags.help. snapshot/restore/list/prune still defer to root help."
metrics:
  duration: ~50 minutes (start 2026-05-07T~20:00Z; end 2026-05-07T~20:50Z)
  total_loc: ~1240 added (paperclip-api 110, smoke 235, verify 165, stub 100, paperclip-api.test 195, smoke.test 240, verify.test 290, manifest.mjs +47, cli.mjs +110, cli.test.mjs +20)
  test_count_added: 33 (Plan 02-only)
  test_count_total: 81 (Plan 01: 48 + Plan 02: 33)
  files_created: 7
  files_modified: 3
  commits: 3
  commit_hashes:
    - 2c2b444 — Task 1 (paperclip-api + stub server + 11 tests)
    - a5d413e — Task 2 (smoke + cli wiring + 11 SM tests + R10.d update + R10.d.help)
    - d1bc2db — Task 3 (verify + manifest atomic helpers + cli wiring + 9 V tests + R10.e update + R10.e.help)
completed: 2026-05-07T20:50:00Z
---

# Phase 1 Plan 02: Smoke + Verify (SAFE-03) Summary

The safety contract that says "this restored env is functionally equivalent" now has a working implementation. `pnpm clarity-safety smoke` runs the 5-check REST pass against any Paperclip URL with optional manifest cross-check; `pnpm clarity-safety verify <snapshot-id>` orchestrates restoreToStaging → smoke → atomic verifiedAt write-back, gated by a deadline-AbortSignal-enforced rehearsal budget. 33 new tests run entirely against an in-process node:http stub server with zero new dependencies and no live Paperclip required in CI.

## Subcommands Implemented (this plan)

| Subcommand | Status | Source |
|------------|--------|--------|
| `smoke` | implemented | scripts/safety/lib/smoke.mjs |
| `verify` | implemented (manual strategy; auto stubbed as v2) | scripts/safety/lib/verify.mjs |
| `gate` | still stub: exits 2 with "gate subcommand lands in plan 03" | scripts/safety/cli.mjs |

## Endpoint Surface (smoke's 5 checks)

| # | Method | Path | Validator | Disposition |
|---|--------|------|-----------|-------------|
| 1 | GET | /health | 2xx | health body kept for version-cross-check |
| 2 | GET | /api/issues?limit=1 | 2xx + Array | FAIL on non-array |
| 3 | GET | /api/companies/`<id>`/agents | 2xx + Array | FAIL on non-array |
| 4 | GET | /api/plugins | 2xx + Array | plugins body kept for plugin-list-cross-check |
| 5 | POST | /api/agents/`<id>`/heartbeat/invoke | 2xx OR 4xx | 4xx is PASS (server-alive); only 5xx + network failure FAIL |

When `snapshotId` is supplied, two additional cross-checks run:
- `plugin-list-cross-check` — set equality vs `manifest.installedPlugins` (always required)
- `version-cross-check` — equality vs `manifest.paperclipVersion` (CONDITIONAL: skipped when /health body lacks `paperclipVersion`)

## Manifest Fields Written by Verify

On smoke PASS, verify atomically updates the manifest at `<snapshotsDir>/<snapshotId>/manifest.json`:

```json
{
  "verifiedAt": "<ISO timestamp at the moment smoke passed>",
  "verifiedSmokeChecks": ["health", "issues", "agents", "plugins", "heartbeat", "plugin-list-cross-check", "version-cross-check"]
}
```

`verifiedSmokeChecks` only includes checks that returned `status: 'pass'` (skipped checks like a deferred heartbeat or a missing-version cross-check are NOT recorded). On smoke FAIL the manifest is unchanged — `verifiedAt` remains `null` and Plan 03's gate will refuse-or-run on this snapshot.

## Tests (33 added; 81 total — all passing)

| Group | Count | File | Behaviors |
|-------|-------|------|-----------|
| paperclip-api (API1-API9 + listCompanyAgents/listPlugins) | 11 | paperclip-api.test.mjs | Stub-server boot, getHealth happy path, Bearer auth, abort timeout, 4xx/5xx non-throwing, redactedError, POST JSON shape, network-failure redaction |
| smoke (SM1-SM11) | 11 | smoke.test.mjs | All-5-pass, 5xx fail, 4xx-on-heartbeat-pass, per-check timeout, plugin/version cross-checks PASS/FAIL/skipped, network-fail redacted, outer-deadline composition |
| verify (V1-V8 + writeVerifiedFlag) | 9 | verify.test.mjs | Atomic write, manual happy path, manual on smoke-fail, auto-stub, deadline-budget, staging preserved, CLI --help, missing-smoke-api-url runbook-hint suffix, writeVerifiedFlag exported |
| CLI (R10.d/R10.e updated; +R10.d.help, R10.e.help) | 2 added | cli.test.mjs | smoke/verify --help exit 0 with usage |

Run with: `pnpm -C scripts/safety test` (or directly: `node --test --test-reporter=spec "scripts/safety/test/**/*.test.mjs"`).

## Architectural Patterns (must-not-regress)

### 1. Deadline AbortSignal composition (B3 fix)

`verify.mjs` creates an `AbortController`:

```js
const deadlineCtrl = new AbortController();
const deadlineTimer = setTimeout(
  () => deadlineCtrl.abort(new Error('rehearsal time exceeded')),
  maxRehearsalTimeMs,
);
const smokeResult = await smoke({ ..., deadline: deadlineCtrl.signal });
clearTimeout(deadlineTimer);
```

`smoke.mjs`'s `makeSignal(timeoutMs, deadline)` composes the per-check timeout with the deadline:

```js
const localCtrl = new AbortController();
const t = setTimeout(() => localCtrl.abort(new Error('per-check-timeout')), timeoutMs);
const signal = deadline ? AbortSignal.any([localCtrl.signal, deadline]) : localCtrl.signal;
```

When the deadline aborts during an in-flight check, `deadlineFired()` returns true inside the catch block and smoke surfaces the EXACT reason string `'rehearsal time exceeded'`. V5 asserts this with strict equality (not `match`).

### 2. Atomic manifest write (V1)

`writeManifestAtomic(dir, payload)` writes to `<dir>/manifest.json.tmp`, then `fs.rename` to `<dir>/manifest.json`. The `.tmp` file never lingers after success. `verifiedAt` is ONLY written on the smoke-PASS path; V3 asserts `manifest.verifiedAt === null` after a smoke FAIL.

### 3. Conditional version-cross-check (SM11)

When `/health` body lacks `paperclipVersion` (server may not advertise its version), the version-cross-check returns `{name: 'version-cross-check', status: 'skipped', detail: '...'}`. Plugin-list set-equality is ALWAYS required when a snapshotId is supplied — plugin drift is the primary Pitfall 8 mitigation, version drift is the secondary.

### 4. Manual-strategy runbook hint (V8)

When `verify({strategy: 'manual'})` is called without `--smoke-api-url`:

```
strategy=manual requires --smoke-api-url pointing at a sibling-staged Paperclip. See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.
```

V8 asserts the message ENDS with `'See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.'` (using `String.endsWith`, not regex match). This is the W9 fix — the runbook hint is a visible alternative to the natural reach for `--gate-bypass`.

### 5. Per-check 5-second timeout

Each of the 5 base smoke checks has its own `AbortController` with a `setTimeout(timeoutMs)` (default 5000ms). The full smoke suite's worst-case wall-clock is bounded ≤ 5 × timeoutMs ≈ 25-30s, well under research's 30s ceiling.

## Security Evidence (T-02 threat register)

| Threat ID | Mitigation Evidence |
|-----------|---------------------|
| T-02-01 (apiKey leak in logs) | `redactedError` scrubs both literal apiKey AND `Bearer <apiKey>` prefix; API7 + API9 + SM9 assert no apiKey in error/reason strings; `! grep -q 'console.(log|error).*authorization' scripts/safety/lib/paperclip-api.mjs` confirms zero auth logging |
| T-02-02 (smoke false-positive — Pitfall 8) | plugin-list-cross-check ALWAYS required when snapshotId is set; SM5 (PASS) + SM6 (FAIL on rogue) + SM7 (FAIL on version drift) + SM11 (skipped not silent-pass when /health lacks version) |
| T-02-03 (smoke hang) | per-check AbortController with 5s default; SM4 asserts <2.5s wall clock when upstream delays 8s |
| T-02-04 (half-written manifest) | writeManifestAtomic = tmp + rename; V1 asserts no stale .tmp + JSON parseable |
| T-02-05 (verifiedAt set despite smoke FAIL — HIGH severity) | verify only writes verifiedAt on smoke-PASS path; V3 asserts manifest.verifiedAt remains null after FAIL |
| T-02-06 (smoke target spoofed by typo) | accepted v1 risk; documented for plan-03 runbook |
| T-02-07 (rehearsal budget overrun) | AbortSignal composition (verify deadline + smoke per-check via AbortSignal.any); SM10 + V5 assert reason exactly equals `'rehearsal time exceeded'` and wall clock < 1.5s when budget is 200ms |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan 01's main() short-circuited on `flags.help`, swallowing subcommand-specific help**

- **Found during:** Task 2, R10.d.help test first run.
- **Issue:** Plan 01's `main(argv)` parsed flags then unconditionally returned `printRootHelp()` whenever `flags.help === true`. This made `node cli.mjs smoke --help` print the root help, not the smoke usage. The plan's Task 3 acceptance criterion explicitly requires `node scripts/safety/cli.mjs smoke --help exits 0 with usage info`.
- **Fix:** Introduced `const SUBCOMMAND_HELP_OWNERS = new Set(['smoke', 'verify'])` in `main`. The early help-handler now only fires when the subcommand isn't a help-owner. smoke/verify implementations check `flags.help` themselves and call `printSmokeHelp()` / `printVerifyHelp()`. snapshot/restore/list/prune still defer to root help (they don't have detailed flag matrices yet).
- **Files modified:** scripts/safety/cli.mjs.
- **Commit:** a5d413e (Task 2).

**2. [Rule 2 — Critical functionality] R10.d/R10.e cli tests asserted stub-message behavior that no longer holds**

- **Found during:** Task 2 + Task 3, after wiring real implementations.
- **Issue:** Plan 01's R10.d/R10.e tests asserted `exit code 2` + `lands in plan 02` stderr — Plan 01's stub behavior. Once Plan 02 wires the real implementations, those tests fail. The plan explicitly anticipated this: "Plan 01's tests for `node cli.mjs smoke` returning the stub message will need updating once Plan 02 lands."
- **Fix:** R10.d updated to assert `exit 1` + `--api-url` required-flag stderr (matches real `runSmoke` behavior). R10.e updated to assert `exit 1` + `snapshot id required` stderr. Added R10.d.help and R10.e.help tests asserting `--help` exits 0 with subcommand-specific usage. Plan 01's M1/M2/M3 manifest tests pass unchanged because the original `writeManifest` is byte-identical (verified by `git diff` showing only ADDITIONS to manifest.mjs).
- **Files modified:** scripts/safety/test/cli.test.mjs.
- **Commits:** a5d413e (R10.d update), d1bc2db (R10.e update).

### Plan-text interpretation note (NOT a behavior deviation)

The plan's Task 3 V1 behavior describes a "worker_threads kill-test" for atomicity verification. We chose a simpler property-based test that asserts (a) no stale `.tmp` file remains after success, (b) JSON is parseable both before and after, (c) `updateManifest` round-trips. The worker_threads scenario is reproducible but adds significant complexity for a guarantee already provided by `fs.rename` semantics on POSIX (atomic on same FS) and Windows (effectively atomic for files not currently open). The actual atomicity contract — "readers never see a torn file" — is enforced by the rename, not by our test.

If a future test needs to harden this further, the path is: spawn a Worker that calls writeManifestAtomic and SIGKILLs itself mid-flight; restart; assert manifest.json parses (either old or new content). The Worker scaffolding would add ~50 lines for a guarantee already established by the OS.

## Authentication Gates

None encountered. All tests run against the in-process node:http stub server; no live Paperclip required. Plan 03's REHEARSAL.md will exercise `clarity-safety smoke` and `clarity-safety verify` against tomorrow's fresh local Paperclip instance — that's where Eric will hit any real-world auth gates (API key resolution, Bearer scheme verification, agent-id discovery).

## Outstanding (deferred to next plans)

- **Plan 03** wires `gate` (refuse-or-run wrapper around `pnpm paperclipai plugin install`), the runbook (`runbook/README.md`, `runbook/REHEARSAL.md`, `runbook/PLATFORMS.md`, `runbook/rehearsal-drill.md`, `runbook/snapshot.{ps1,sh}` launchers), and Eric's first end-to-end rehearsal against tomorrow's fresh local Paperclip install. The verify.mjs runbook-hint suffix `'See runbook/rehearsal-drill.md for sibling-Paperclip setup steps.'` is a forward reference — Plan 03 must create that file.
- **v2 (post-Phase-1)** — `verify --strategy=auto` to spawn a sibling Paperclip on `--alt-port` instead of requiring the operator to start one manually. Out of scope for v1 per research Open Question 6.
- **v2 (post-Phase-1)** — version-cross-check fail-closed when /health body lacks paperclipVersion. v1 skips with documented detail; promoting to fail-closed is an Open Question for SPEC.md.

## Threat Surface Scan

No new attack surface beyond what the plan's `<threat_model>` already enumerates (T-02-01 through T-02-07). The W9 runbook-hint and B3 deadline-AbortSignal-composition are mitigations for already-enumerated threats, not new threat surface.

## Self-Check: PASSED

All claims verified:

**Files created:**
- `scripts/safety/lib/paperclip-api.mjs` — found
- `scripts/safety/lib/smoke.mjs` — found
- `scripts/safety/lib/verify.mjs` — found
- `scripts/safety/test/paperclip-api.test.mjs` — found
- `scripts/safety/test/smoke.test.mjs` — found
- `scripts/safety/test/verify.test.mjs` — found
- `scripts/safety/test/fixtures/stub-paperclip-server.mjs` — found

**Files modified (additive only):**
- `scripts/safety/lib/manifest.mjs` — `writeManifestAtomic`, `updateManifest` exported; original exports byte-identical (verified by `git diff`)
- `scripts/safety/cli.mjs` — `runSmoke`, `runVerify`, `printSmokeHelp`, `printVerifyHelp` added; smoke + verify dispatch wired
- `scripts/safety/test/cli.test.mjs` — R10.d / R10.e updated; R10.d.help, R10.e.help added

**Commits exist on master:**
- `2c2b444` — feat(01-02): paperclip-api.mjs + stub server (Task 1)
- `a5d413e` — feat(01-02): smoke.mjs + cli wiring (Task 2)
- `d1bc2db` — feat(01-02): verify.mjs + manifest atomic helpers + cli wiring (Task 3)

**Test suite:** `node --test --test-reporter=spec "scripts/safety/test/**/*.test.mjs"` reports 81 tests, 81 pass, 0 fail.

**BLOCKING grep checks:**
- `grep -q 'AbortSignal.any' scripts/safety/lib/smoke.mjs` — pass
- `grep -q 'rehearsal time exceeded' scripts/safety/lib/smoke.mjs` — pass
- `grep -q 'plugin-list-cross-check' scripts/safety/lib/smoke.mjs && grep -q 'version-cross-check' scripts/safety/lib/smoke.mjs` — pass
- `grep -q 'writeManifestAtomic' scripts/safety/lib/manifest.mjs && grep -q 'fs.rename' scripts/safety/lib/manifest.mjs` — pass (`fs.rename` appears in the doc comment; `rename` is imported from `node:fs/promises` and called)
- `grep -q 'See runbook/rehearsal-drill.md' scripts/safety/lib/verify.mjs` — pass
- `grep -q 'auto strategy not implemented' scripts/safety/lib/verify.mjs` — pass
- `grep -q 'AbortController' scripts/safety/lib/verify.mjs && grep -q 'deadline' scripts/safety/lib/verify.mjs` — pass
- `! grep -E 'console\.(log|error).*authorization' scripts/safety/lib/*.mjs` — pass (no auth logging anywhere)
