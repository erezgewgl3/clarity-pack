---
phase: 05-distribution-polish
plan: 09
subsystem: infra
tags:
  - clarity-pack
  - phase-5
  - tooling
  - infra-cleanup
  - operator-runbook
  - windows-max-path
  - documentation
  - test-fixtures
  - gitattributes

# Dependency graph
requires:
  - phase: 04.2-reader-chat-bridge
    provides: "STATE.md Plan 04.2-07 closure entry documenting Windows max-path worktree-spawn failure inside scripts/safety/test/fixtures/fake-paperclip-clone/node_modules/.pnpm/@embedded-postgres+linux-x64@.../...  — the load-bearing source-of-evidence for D-22's relocation"
  - phase: 01-pre-install-safety
    provides: "scripts/safety/test/pg-dump-locator.test.mjs P1-P7 test contract (Plan 01-05 Task 1) — the test that exercises the relocated fixture and proves it still functions byte-identically at the new path"

provides:
  - "CLAUDE.md plugin-route documentation correction (item a) — Surface 2 Slot-types row now reflects the canonical `/<companyPrefix>/<routePath>` pattern with `/COU/situation-room` example"
  - "runbook/operator-gotchas.md §vps-clarity-pack-scripts-sync (D-21, item b) — pre-drill `cd ~/clarity-pack && git pull` step documented; rejected silent-auto-sync alternative explicitly out of scope"
  - "runbook/operator-gotchas.md §paperclipai-plugin-install-upgrade-path (item c) — host's `400 \"already installed\"` rejection + `install-helper.sh` uninstall→install dance documented; closes 3+ drill rediscovery loop"
  - "test/fixtures/external/fake-paperclip-clone/ (D-22, item d) — relocated test fixture (byte-identical tree); shorter prefix fits inside Windows MAX_PATH for `git worktree add`"
  - ".gitattributes export-ignore for test/fixtures/external/ — Plan 05-10's `npm pack` step consumes this to exclude the fixture from the v1.0.0 tarball"
  - "scripts/safety/test/pg-dump-locator.test.mjs FAKE_CLONE constant rewritten to relocated path; obsolete FIXTURES constant removed (footgun mitigation per checker WARNING #13)"

affects:
  - 05-10-PLAN.md (consumer of .gitattributes export-ignore for npm pack v1.0.0 tarball hygiene)
  - "future Windows worktree spawns against this repo (D-22 root-cause fix)"
  - "future operator drills on Countermoves (§vps-clarity-pack-scripts-sync + §paperclipai-plugin-install-upgrade-path documented)"
  - "future test authors adding fixtures to pg-dump-locator.test.mjs (FIXTURES footgun mitigated)"

# Tech tracking
tech-stack:
  added: []  # No new runtime deps, no new devDeps, no new tools
  patterns:
    - "Operator-gotcha runbook entries follow canonical 4-field shape (Symptom / Discovered / Why it happens / Resolution) — anchored by `§<slug>` IDs for textual cross-reference; append-only convention"
    - "Test fixtures with deep node_modules trees live OUTSIDE worktreed source directories (under `test/fixtures/external/`) to keep path lengths inside Windows MAX_PATH for `git worktree add`"
    - "`.gitattributes export-ignore` for test-only fixtures provides belt-and-braces hygiene alongside `package.json files[]` allowlist — `export-ignore` is honored by `npm pack` + `git archive` but NOT by `git clone` / `actions/checkout@v4`, so CI continues to see the fixture"

key-files:
  created:
    - "test/fixtures/external/fake-paperclip-clone/ — relocated test fixture (byte-identical to prior contents at scripts/safety/test/fixtures/fake-paperclip-clone/)"
  modified:
    - "CLAUDE.md — §2 Plugin Manifest Shape Slot-types table; Surface 2 row URL corrected"
    - "runbook/operator-gotchas.md — appended two new sections (§vps-clarity-pack-scripts-sync + §paperclipai-plugin-install-upgrade-path)"
    - "scripts/safety/test/pg-dump-locator.test.mjs — FAKE_CLONE constant rewritten to relocated path; FIXTURES constant removed (5 lines → 5 lines, semantically smaller surface)"
    - ".gitattributes — appended Plan 05-09 Task 2 block (3 patterns: directory + glob-recursive for `test/fixtures/external/`)"

key-decisions:
  - "Used `git mv` for the fixture relocation so the diff renders as a rename rather than delete+add (preserves history line for git log --follow / git blame)"
  - "Removed the obsolete FIXTURES constant entirely (per checker WARNING #13) rather than leaving it pointing at a removed path — single-consumer audit confirmed no other reference in the file; leaving it would have been a latent footgun for future test authors"
  - "Inlined the new FAKE_CLONE definition with explicit `'..', '..', '..'` path-segment chain (NOT a single forward-slash string) — works byte-identically on Windows + Linux + macOS via path.join semantics"
  - "Reused existing .gitattributes (already had a Plan 05-04 block for visual-regression PNGs) rather than rewriting the file — additive Plan 05-09 Task 2 block appended below the existing content"
  - "Reworded the CLAUDE.md correction's anti-example phrasing from `NOT /plugins/clarity-pack/...` to `NOT under a /plugins/<plugin-id>/... namespace` so the literal broken string `grep -c '/plugins/clarity-pack/' CLAUDE.md` returns 0 (per Task 1 verify spec)"

patterns-established:
  - "Pattern A: Worktreed-tree path-length hygiene — fixtures with deep node_modules trees relocate to `test/fixtures/external/` (shorter prefix) and are export-ignored via .gitattributes for npm-pack hygiene"
  - "Pattern B: Single-consumer constant audit — when removing a fixture/path, audit all consumers of any path-constructor constants and either inline-rewrite or remove the constant entirely (avoid leaving constants pointing at moved/removed paths)"
  - "Pattern C: Operator-gotcha runbook addition — 4-field shape (Symptom / Discovered / Why it happens / Resolution) with `§<slug>` anchor; cross-reference other sections by anchor; document long-term remediation explicitly even if the chosen fix is documentation-only"

requirements-completed: []  # By plan design — `requirements: []` in plan frontmatter. No new REQ flips.

# Metrics
duration: 12min
completed: 2026-05-25
---

# Phase 05-distribution-polish Plan 09: Tooling + infra cleanup Summary

**Four operator-papercut fixes shipped: corrected CLAUDE.md plugin-route doc (was 404-producing `/plugins/clarity-pack/...` example), two new runbook sections (§vps-clarity-pack-scripts-sync + §paperclipai-plugin-install-upgrade-path), and relocated fake-paperclip-clone test fixture out of the worktreed source tree to `test/fixtures/external/` with `.gitattributes export-ignore` for npm-pack hygiene.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-25T19:00:00Z (approx)
- **Completed:** 2026-05-25T19:12:00Z (approx)
- **Tasks:** 3 (all auto)
- **Files modified:** 4 distinct files + 4 fixture files renamed via `git mv`
- **Commits:** 3 atomic commits (Task 1 + Task 2 + closure)

## Accomplishments

- **(item a) CLAUDE.md plugin-route doc correction.** §2 Plugin Manifest Shape Slot-types table Surface 2 row now documents `/<companyPrefix>/situation-room` (e.g. `/COU/situation-room`) with explicit cross-reference to project memory `clarity-pack-plugin-page-routes`. `grep -c "/plugins/clarity-pack/" CLAUDE.md` returns 0 (was 1). Eliminates the recurring "operator visits `/COU/plugins/clarity-pack/...` and gets 404" footgun.
- **(item b — D-21) `§vps-clarity-pack-scripts-sync` runbook entry.** Documents pre-drill `cd ~/clarity-pack && git pull` step. Canonical 4-field shape. Rejected alternative (silent auto-sync via install-helper.sh hook) explicitly filed as out of scope per CONTEXT.md `<deferred>` — would mutate VPS state without operator review.
- **(item c) `§paperclipai-plugin-install-upgrade-path` runbook entry.** Documents host's `400 "already installed"` rejection on in-place upgrade attempts; the operator-side resolution is `~/clarity-pack/scripts/install-helper.sh <tgz>` (uninstall → install dance the host CLI does not chain automatically). Closes the rediscovery loop after 3+ drills (Plan 04.2-01/02/03/04/07) hit the same wall.
- **(item d — D-22) Windows max-path worktree fix.** Fixture relocation `scripts/safety/test/fixtures/fake-paperclip-clone/` → `test/fixtures/external/fake-paperclip-clone/` (git rename; byte-identical tree). Shorter prefix (~8 chars saved off every entry in the deep `node_modules/.pnpm/@embedded-postgres+linux-x64@18.1.0-beta.16/...` chain) keeps `git worktree add` inside Windows MAX_PATH. `.gitattributes` adds export-ignore for `test/fixtures/external/{,**}` so Plan 05-10's `npm pack` excludes the test-only fixture from the v1.0.0 tarball (verified empirically: `npm pack --dry-run | grep -c fake-paperclip-clone` returns 0 against the current build).

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix CLAUDE.md plugin-route doc + add two new runbook sections** — `7269442` (docs)
2. **Task 2: Relocate fake-paperclip-clone fixture + update .gitattributes + rewrite FAKE_CLONE constant** — `35c479d` (chore — git rename + test refactor + .gitattributes additive)
3. **Task 3: Verification + SUMMARY/STATE/ROADMAP closure** — this commit (docs: plan closure)

## Files Created/Modified

- **CLAUDE.md** (modified) — Surface 2 row in §2 Plugin Manifest Shape Slot-types table now reflects the canonical `/<companyPrefix>/<routePath>` pattern with `/COU/situation-room` example and cross-reference to project memory `clarity-pack-plugin-page-routes`.
- **runbook/operator-gotchas.md** (modified) — appended two new sections at end of file: `§vps-clarity-pack-scripts-sync` and `§paperclipai-plugin-install-upgrade-path`. Both follow the canonical 4-field shape (Symptom / Discovered / Why it happens / Resolution). Append-only convention preserved.
- **test/fixtures/external/fake-paperclip-clone/** (created — git rename from `scripts/safety/test/fixtures/fake-paperclip-clone/`) — relocated test fixture tree; contents byte-identical (fake-system-bin/pg_dump + pg_dump.exe + node_modules/.pnpm/@embedded-postgres+linux-x64@18.1.0-beta.16/.../pg_dump + node_modules/.pnpm/@embedded-postgres+windows-x64@18.1.0-beta.16/native/ without pg_dump.exe).
- **scripts/safety/test/pg-dump-locator.test.mjs** (modified) — FAKE_CLONE constant rewritten to inline new path with explicit `'..', '..', '..'` segments (resolves to `test/fixtures/external/fake-paperclip-clone/` from the test file's location); obsolete FIXTURES constant removed (single-consumer audit confirmed no other reference; leaving it pointing at a removed path would be a footgun per checker WARNING #13).
- **.gitattributes** (modified) — appended Plan 05-09 Task 2 block with `export-ignore` directives for `test/fixtures/external/` (directory pattern) and `test/fixtures/external/**` (glob-recursive). Existing Plan 05-04 block for visual-regression PNGs preserved untouched.

## Decisions Made

- **Mechanism choice (relocation vs symlink).** Per PATTERNS.md preference, chose direct relocation over the symlink-at-test-setup alternative. Rationale: `.gitattributes export-ignore` alone does NOT prevent `actions/checkout@v4` from materializing the deep path (export-ignore is npm-pack / git-archive only), so the symlink alternative would still need the relocation as backup. Direct relocation gives one source of truth; on Windows the new path saves ~8 chars off every entry in the deep node_modules chain.
- **FIXTURES constant: remove vs retain.** Per checker WARNING #13 and pre-flight full-file read confirming `FIXTURES` had exactly one consumer in the file (the `FAKE_CLONE` definition itself), removed the constant entirely. Inlined the path construction into the new FAKE_CLONE definition. Leaving FIXTURES in place pointing at a removed/empty `scripts/safety/test/fixtures/` would be a latent footgun for future test authors composing additional fixtures.
- **No version bump in this plan.** Per checker BLOCKER-1, the single phase-wide `1.0.0-rc.7 → 1.0.0` version bump lives EXCLUSIVELY in Plan 05-10 (v1.0.0 final closure). Multiple plans declaring the same bump would cause grep-gate collisions. Plan 05-09 ships as code-only commits — package.json + src/manifest.ts both remain at `1.0.0-rc.7`.
- **CLAUDE.md anti-example phrasing.** Initial draft of the corrected Surface 2 row included `NOT /plugins/clarity-pack/...` as a contrast example. This caused `grep -c "/plugins/clarity-pack/" CLAUDE.md` to return 1 instead of 0 (Task 1 verify spec required 0). Reworded to `NOT under a /plugins/<plugin-id>/... namespace` — same warning conveyed without containing the literal broken string.

## Deviations from Plan

None — plan executed exactly as written, modulo one inline anti-example rephrasing during Task 1 (caught by the Task 1 verify gate at first run; corrected via a follow-up Edit; not a deviation in the deviation-rule sense since the underlying intent didn't change).

## Issues Encountered

- **Build script chains via `pnpm` which is not on the Bash tool's PATH.** Resolution: invoked the three build sub-scripts directly (`node scripts/build-worker.mjs`, `node scripts/build-ui.mjs`, `npx tsc --project tsconfig.manifest.json`). All three exit 0 cleanly. Not a project defect — `pnpm` is on Eric's PowerShell PATH; the Bash tool inherits a different environment. Worth flagging for future executors running through the same harness.

## Quality Gates

- **`node --test scripts/safety/test/pg-dump-locator.test.mjs`** — exit 0; P1-P7 all PASS against the relocated fixture path (Linux bundled-binary discovery, Windows-falls-through-to-PATH, version-mismatch errors all green).
- **`npm test`** (full suite) — exit 0; **1444 tests / 1442 pass / 0 fail / 2 pre-existing skip** — unchanged from Plan 05-04's closure baseline.
- **`npx tsc --noEmit`** — exit 0; no type errors.
- **`node scripts/check-css-scope.mjs`** — exit 0; 108 top-level selectors, all scoped.
- **`node scripts/check-a11y.mjs`** — exit 0; 65 files scanned, 0 violations.
- **`node scripts/check-ui-bundle-size.mjs`** — exit 0; 606487 bytes / 665600 byte ceiling; no SheetJS sentinels.
- **`node scripts/coexistence-checks/run-all.mjs`** — exit 0; 10/10 PASS (COEXIST-01..10).
- **Worker + UI + manifest builds** — all exit 0 (`dist/worker.js` 2.1mb; `dist/ui/index.js` 592.3kb; `dist/manifest.js` rebuilt).
- **`npm pack --dry-run | grep -c fake-paperclip-clone`** — returns 0 (14 files total in the tarball-to-be — dist/ + migrations/ + README + package.json — fixture excluded by both `package.json files[]` allowlist and the new `.gitattributes export-ignore` belt-and-braces).
- **Version literals UNCHANGED:** `grep -c "1.0.0-rc.7" package.json` = 1; `grep -c "1.0.0-rc.7" src/manifest.ts` = 1.

## Threat Model

Per the plan's `<threat_model>` block: this plan is documentation + a test-fixture relocation + a `.gitattributes` directive — zero runtime/worker/UI code change, zero new dependency, zero new external service, zero new schema. Trust boundaries inherited from prior phases UNCHANGED. Two mitigations were applied per the STRIDE register:

- **T-05-09-04 (DoS — Windows worktree spawn failure on long fixture paths)** — root-cause fix via Task 2 fixture relocation. Validated by Step 1 of Task 3 (P1-P7 tests PASS against the new path).
- **T-05-09-05 (Tampering — npm-pack tarball surface)** — `.gitattributes export-ignore` for `test/fixtures/external/` excludes the fixture from Plan 05-10's `npm pack` output. Verified empirically at execution time: `npm pack --dry-run | grep -c fake-paperclip-clone` returns 0 against the current rc.7-staged build.
- **T-05-09-06 (Tampering — FIXTURES footgun)** — removing the obsolete `FIXTURES` constant eliminates a latent footgun for future test authors. Verified by `grep -c "FIXTURES" scripts/safety/test/pg-dump-locator.test.mjs` returning 0.

Other threat-register rows (T-05-09-01/02/03 — append-only markdown documentation edits) accept-dispositioned. No package installs (T-05-09-SC n/a).

## Revision Iteration Outcomes

Plan 05-09 went through 1 revision iteration before execution per the checker's findings:

- **BLOCKER-1 outcome:** Version bump (rc.7 → 1.0.0) and tarball production REMOVED from this plan entirely. Consolidated into Plan 05-10's single phase-wide bump. Plan 05-09 ships as code-only commits with NO version literal changes. Verified at closure: `grep -c "1.0.0-rc.7" package.json` = 1, `grep -c "1.0.0-rc.7" src/manifest.ts` = 1, no new `clarity-pack-*.tgz` files added.
- **WARNING #13 outcome:** FIXTURES constant fully removed (not retained pointing at empty path) per full-file pre-flight read confirming single consumer. Verified at closure: `grep -c "FIXTURES" scripts/safety/test/pg-dump-locator.test.mjs` = 0.

## Next Phase Readiness

- **Plan 05-09 is wave-1 independent.** Zero file overlap with the chat-surface plans (05-05/06/07/08) or the visual-previewer plan (05-04). Wave-2 plans and the closure plan (05-10) are not gated on 05-09's outputs except for the `.gitattributes` consumption in 05-10's `npm pack` step.
- **Phase 5 progress:** 5/10 plans CODE-COMPLETE (05-01, 05-02, 05-03, 05-04, 05-09). 4 plans remaining in wave-2 (05-05, 05-06, 05-07, 05-08) + 1 closure (05-10).
- **Plan 05-10 (v1.0.0 final closure) is the consumer** of this plan's `.gitattributes export-ignore` directive — in its `npm pack` step the relocated fixture MUST be excluded from the v1.0.0 tarball (Plan 05-10 verifies via `tar -tzf clarity-pack-1.0.0.tgz | grep -c fake-paperclip-clone == 0`).

## Self-Check

Verified at closure:

- **CLAUDE.md edit:** `grep -c "/plugins/clarity-pack/" CLAUDE.md` = 0 ✓
- **runbook §vps-clarity-pack-scripts-sync:** `grep -c "## §vps-clarity-pack-scripts-sync" runbook/operator-gotchas.md` = 1 ✓
- **runbook §paperclipai-plugin-install-upgrade-path:** `grep -c "## §paperclipai-plugin-install-upgrade-path" runbook/operator-gotchas.md` = 1 ✓
- **Fixture moved:** `test ! -d "scripts/safety/test/fixtures/fake-paperclip-clone"` = true (OLD GONE); 4 byte-identical files at NEW path ✓
- **FAKE_CLONE constant rewritten:** `grep -c "test/fixtures/external/fake-paperclip-clone" scripts/safety/test/pg-dump-locator.test.mjs` = 1 ✓; `grep -c "FIXTURES" scripts/safety/test/pg-dump-locator.test.mjs` = 0 ✓; `grep -c "FAKE_CLONE" scripts/safety/test/pg-dump-locator.test.mjs` = 4 ✓
- **.gitattributes:** `grep -c "test/fixtures/external/" .gitattributes` = 3 ✓; `grep -c "export-ignore" .gitattributes` = 3 ✓
- **No version bump:** `grep -c "1.0.0-rc.7" package.json` = 1 ✓; `grep -c "1.0.0-rc.7" src/manifest.ts` = 1 ✓
- **No new tarball:** `ls clarity-pack-*.tgz` count unchanged at 5 (rc.1 through rc.7 from prior plans) ✓
- **Quality gates:** typecheck / css-scope / a11y / bundle-size / coexistence / pg-dump-locator-tests / full suite all GREEN ✓
- **npm pack hygiene:** `npm pack --dry-run | grep -c fake-paperclip-clone` = 0 ✓
- **Commits exist:** `git log --oneline | grep 7269442` and `git log --oneline | grep 35c479d` both return matches ✓

## Self-Check: PASSED

---

*Phase: 05-distribution-polish*
*Plan: 09*
*Completed: 2026-05-25*
