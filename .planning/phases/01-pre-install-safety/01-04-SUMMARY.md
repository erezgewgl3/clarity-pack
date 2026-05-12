---
phase: 01-pre-install-safety
plan: 04
subsystem: safety-cli-cleanup
tags: [safety, snapshot, restore, symlink, cve, rehearsal, defect-closure]
requires:
  - Plan 01-01 (snapshot.mjs filter callback; restore.mjs CVE-2026-31802 guard)
  - Plan 01-02 (smoke + verify; re-rehearsal exercises full surface)
  - Plan 01-03 (gate.mjs + runbook; REHEARSAL.md template ready for PASS row)
  - Node >= 20 (node:test, fs.lstat / readlink / symlinkSync)
  - tar ^7.5.15 (CVE-2026-31802 fix)
provides:
  - "snapshot.mjs cache-directory exclusion: REGENERABLE_CACHE_DIRS + pathHasCacheSegment() + includeCaches option. claude-prompt-cache/ segments excluded by default; opt-in re-enables."
  - "restore-tar-cve.test.mjs: R7 case asserts in-tree symlinks extract successfully; R5/R6 pin the new 'escapes staging' wording so a regression to blanket-reject would fail."
  - "First PASS row in runbook/REHEARSAL.md (lands during Task 3 — pending Hostinger re-rehearsal)."
affects:
  - "scripts/safety/lib/snapshot.mjs — adds 24 lines (constant + helper + option threading + 1-line filter rule)."
  - "scripts/safety/test/snapshot-pglite.test.mjs — adds seedCacheDirs() helper + 4 test cases (S1-cache-A/B/C/D)."
  - "scripts/safety/test/restore-tar-cve.test.mjs — adds buildInTreeSymlinkArchive(), buildBenignInTreeSnapshotDir(), canCreateSymlinks() helpers + R7 test case; tightens R5/R6 wording assertions."
tech-stack:
  added:
    - none (no new dependencies)
  patterns:
    - "segment-exact path predicate (split('/') + Set.has) — not substring; lookalikes like claude-prompt-caches-archive remain captured (S1-cache-D)."
    - "opt-in re-enable via boolean option (includeCaches: true); default-off matches the rest of the snapshot CLI's safety posture."
    - "hand-built ustar headers for fixture archives (existing pattern from Plan 01-01); extended with regular-file typeflag '0' + data block padding (makeRegularFileHeader)."
    - "graceful platform skip (canCreateSymlinks() probe) — Windows without admin/dev mode skips R7 with a clear message rather than failing."
key-files:
  created:
    - .planning/phases/01-pre-install-safety/01-04-PLAN.md
    - .planning/phases/01-pre-install-safety/01-04-SUMMARY.md
  modified:
    - scripts/safety/lib/snapshot.mjs
    - scripts/safety/test/snapshot-pglite.test.mjs
    - scripts/safety/test/restore-tar-cve.test.mjs
    - .planning/ROADMAP.md
    - .planning/STATE.md
decisions:
  - "Cache-exclusion tests added to snapshot-pglite.test.mjs (not snapshot.test.mjs as the plan stated). Reason: snapshot-pglite.test.mjs already has seedPGlite() and listTarEntries() scaffolding that the cache cases require. snapshot.test.mjs is orchestration-only and doesn't seed a real PGlite store. Moving the helpers would have duplicated infrastructure for no semantic gain."
  - "REGENERABLE_CACHE_DIRS is a Set of literal directory-name segments, not a regex. Reason: segment-exact match (split('/') + Set.has) is faster and harder to get wrong than regex (and S1-cache-D exists to catch substring regressions if someone tries to change it to `entryPath.includes('claude-prompt-cache')`)."
  - "Defect 1 fix was committed eagerly in 9506a91 during the failed-drill investigation — tests for it land in Plan 01-04 rather than Plan 01-01, because they verify the relaxed logic, not the original strict-reject contract Plan 01-01 was written against. Rationale: re-running Plan 01-01 RED/GREEN against the new logic would have been a fiction; the tests legitimately belong to the cleanup plan."
  - "R7 is platform-conditional via canCreateSymlinks() probe (catches Windows EPERM). The test SKIPS rather than FAILS on hosts that cannot create symlinks. Reason: the assertion is about a runtime behavior that the host OS may refuse to support; making the suite red on Windows-without-admin would obscure real regressions. CI runs on Linux/macOS where R7 always exercises; the Hostinger re-rehearsal (Linux VPS) is the production-shape exercise."
  - "snapshot.mjs's filter is shared between mode='pglite' and mode='postgres' — the cache exclusion is mode-agnostic. The pglite test fixture exercises both default-exclude and opt-in-include paths; postgres mode inherits the same filter without separate coverage. Reason: the filter is a pure function over POSIX paths; mode doesn't change its behavior."
  - "R5/R6 now require BOTH /Refusing to extract/ AND /escapes staging/ matches. Reason: the load-bearing assertion is now the wording, not just the rejection. A regression to blanket reject would still emit 'Refusing to extract' for in-tree symlinks but would NOT emit 'escapes staging' — so the new wording assertion catches the regression while preserving the original assertion's intent."
metrics:
  duration: ~25 minutes (Task 1 + Task 2; Task 3 pending operator at Hostinger)
  total_loc: 357 (snapshot.mjs +24, snapshot-pglite.test.mjs +162, restore-tar-cve.test.mjs +168, planning docs +536)
  test_count_added: 5 (S1-cache-A/B/C/D + R7)
  test_count_total: 108 (Plan 01: 48 + Plan 02: 33 + Plan 03: 22 + Plan 04: 5)
  test_pass_rate: 107/108 (1 skip — R7 on Windows-no-symlink; will exercise on Linux/macOS and during Hostinger drill)
  commits: 5
    - c61dbaf — docs(01-04): add Plan 01-04 PLAN.md + ROADMAP/STATE updates
    - 489edf2 — test(01-04): RED 4 S1-cache cases
    - 1cde60e — feat(01-04): GREEN cache exclusion in snapshot.mjs
    - 2a62d75 — test(01-04): R7 + R5/R6 message tightening
    - (this commit) — docs(01-04): SUMMARY.md
deferred:
  - "Phase 2 hardening (T-04-01): resolve symlinks transitively in restore.mjs to catch chain-of-symlinks escape attempts (link → link → escape). Current single-hop withinAllowed check is correct for non-malicious snapshots but a sophisticated attacker could construct a chain. Deferred because (a) the snapshot would have to be taken against a controlled instance, (b) Phase 1 acceptance is bounded blast radius, not impenetrable security."
  - "Auto-append PASS row to REHEARSAL.md from verify.mjs (T-04-05): v1 leaves the row hand-written by the operator. v2 could append a verifiedAt + smoke output hash automatically on verify PASS, closing the falsification window."
  - "Extending REGENERABLE_CACHE_DIRS as new adapter cache patterns surface. Currently single-entry (claude-prompt-cache); adding e.g. .cache-langchain/, .openai-cache/, etc. should be a one-line change + test addition pattern (S1-cache-A clones cleanly)."
phase_closure:
  status: PENDING — Task 3 (re-rehearsal against Hostinger) is the SAFE-02 acceptance bar
  blocker: "runbook/REHEARSAL.md needs a dated PASS row under ## Entries (not just under ## Failed Drill Attempts). The acceptance grep `^\\| 20[0-9]{2}-` flips green the moment Eric drives the drill end-to-end with the patched CLI."
  on_pass:
    - "Phase 1 closes: SAFE-01 ✓, SAFE-02 ✓ (Part A + Part B), SAFE-03 ✓, SAFE-04 ✓, SAFE-05 ✓"
    - "Phase 2 (scaffold + primitives + Reader + Room + Editor + opt-in) unblocks; /gsd:next routes there"
  on_fail:
    - "Append a new row to runbook/REHEARSAL.md § Failed Drill Attempts describing the new defect"
    - "Route to /gsd:plan-phase 1 --gaps or insert Plan 01-05 as needed"
---

# Plan 01-04 Summary: Safety CLI Cleanup

## What was done (and why)

The 2026-05-12 rehearsal drill against the Hostinger Countermoves Paperclip
ran end-to-end through Step 4 (state modification) before failing at Step 5
(restore). The failed-drill row in `runbook/REHEARSAL.md` § Failed Drill
Attempts documented two real defects in the safety CLI — both legitimate
production-shape bugs that would have surfaced at the worst possible time
(mid-install against BEAAA) if we'd skipped the rehearsal discipline.

Plan 01-04 closes both defects with TDD discipline and re-runs the drill.

### Defect 1 — restore.mjs blanket-rejected ALL symlinks

The CVE-2026-31802 mitigation in `restoreToStaging` refused ANY tar entry
of type `SymbolicLink` or `Link`, regardless of where its target resolved.
That's too strict — in-tree symlinks (linkpath stays inside the staging
tree) are legitimate Paperclip artifacts and should extract normally.

**Fix (committed eagerly in 9506a91 during the failed-drill investigation):**
`restoreToStaging` now resolves the linkpath against the entry's parent
dir, compares the result to `allowedRootResolved`, and rejects ONLY
escapes. The error message changed from
`Refusing to extract SymbolicLink: <path>`
to
`Refusing to extract SymbolicLink whose target escapes staging: <path> → <linkpath>`.

**Tests (this plan):**
- **R5/R6 updated** — message assertions now also require `/escapes staging/`,
  so a regression that drops the `withinAllowed` check (returning to
  blanket reject) would still match `/Refusing to extract/` but FAIL
  `/escapes staging/`. The wording is now load-bearing.
- **R7 (new)** — builds a 2-entry benign tar.gz (regular file + in-tree
  SymbolicLink) and asserts restore extracts the link, readlink returns
  the correct target, and the link functions as a real symlink. Skipped
  on Windows without admin/dev mode (via `canCreateSymlinks()` probe).

### Defect 2 — snapshot.mjs captured Claude Code's claude-prompt-cache/

Claude Code's skill caches live at `<paperclip-instance>/claude-prompt-cache/`
and contain symlinks pointing to `/home/<user>/paperclip/skills/<skill-name>`
— outside the instance tree. The snapshot captured them; the restore (now
correctly) refused them. The right answer is to never capture them in the
first place: they are regenerable cache content, not source-of-truth state.

**Fix:** `snapshot.mjs` gains a `REGENERABLE_CACHE_DIRS` set + a
`pathHasCacheSegment()` helper + an `includeCaches` opt-in. The existing
tar filter rejects any path whose POSIX segments include
`claude-prompt-cache`. Off by default; `includeCaches: true` re-enables.

**Tests:**
- **S1-cache-A** — cache dir at instance root excluded by default
- **S1-cache-B** — `includeCaches: true` re-enables capture
- **S1-cache-C** — nested cache dirs (e.g., `plugins/.../claude-prompt-cache/`)
  excluded at any depth
- **S1-cache-D** — segment-exact predicate does not over-exclude
  lookalike names (`claude-prompt-caches-archive/`, `claude-prompt-cache.md`)

## Verification

Full safety suite: **107 pass / 1 skip / 0 fail** (108 total).

The 1 skip is R7 on Windows without symlink privilege; the test exercises
on Linux/macOS CI and during the Hostinger re-rehearsal.

Net new tests this plan: **+5** (S1-cache-A/B/C/D + R7).

## Phase 1 closure

Not yet — Task 3 (re-rehearsal against the live Hostinger Countermoves
Paperclip) is pending. The procedure is in `01-04-PLAN.md` § Task 3. On
`approved — drill clean` and a dated PASS row under `runbook/REHEARSAL.md`
`## Entries`, SAFE-02 flips green and Phase 1 closes — unblocking Phase 2.
