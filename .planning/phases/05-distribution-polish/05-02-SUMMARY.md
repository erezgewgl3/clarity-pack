---
phase: 05-distribution-polish
plan: 02
status: code-complete-visual-regression-deferred
version_shipped: 1.0.0-rc.2
requirements_closed_at_code_tier: [DIST-05 (partial: lockfile + a11y; visual regression deferred), COEXIST-05]
suite_before: 1337
suite_after: 1339
---

## What was built

**Plan 05-02 closes the lockfile-audit + static a11y halves of DIST-05 + closes COEXIST-05 at the code tier.** Visual-regression baseline (DIST-05's third sub-requirement) is deferred to Plan 05-04 because picking the right infrastructure (static-sketch vs live-host vs Storybook+Chromatic) needs operator alignment — captured in Plan 05-04 §"Visual-regression baseline (Plan 05-02 deferred)".

COEXIST-05's data-preservation half was already proven by the Phase 4-closure drill (CHAT-11: `issue_comments` count unchanged through `disable` cycles, see `scripts/coexistence-checks/08-chat-disable.mjs`). The runbook half lands via the new `10-uninstall-runbook.mjs` coexistence CI gate + the README's Uninstall + --purge section (Plan 05-01).

## Commits

- **`872f705`** — `feat(05-02): static a11y check + COEXIST-10 uninstall-runbook (DIST-05 + COEXIST-05)`.
  - `scripts/check-a11y.mjs` — JSX-aware brace-tracking parser (the naive `[^>]*?` regex truncates on `onChange={(e) => …}`). Three rules: R1 `<img>` needs alt, R2 form controls need id/name/aria-label/aria-labelledby, R3 no dangerouslySetInnerHTML outside the (empty) allowlist.
  - `scripts/coexistence-checks/10-uninstall-runbook.mjs` — asserts README documents data-preserving default uninstall + `--purge` opt-in + safety-CLI rollback reference + install-helper.sh presence. Registered as COEXIST-10 in `run-all.mjs`. 10/10 PASS.
  - `test/ci/check-a11y.test.mjs` + `test/ci/uninstall-runbook.test.mjs` — pin both checks locally for TDD.
- **`74d6ff6`** — `ci(05-02): lockfile-audit + a11y-check GitHub workflows (DIST-05)`.
  - `.github/workflows/lockfile-audit.yml` — `npm ci --omit=dev` + `npm audit --audit-level=high --omit=dev` on PR + push. Production-only audit (devDeps may have known unfixable advisories that do NOT ship in the npm tarball).
  - `.github/workflows/a11y-check.yml` — `node scripts/check-a11y.mjs` + `node --test test/ci/check-a11y.test.mjs`.
- **`fe66b41`** — `fix(05-02): add aria-label to 5 form controls flagged by check-a11y (DIST-05)`. Five JSX form controls failed R2 (chat seed-dialog title + body inputs; settings opt-in checkbox + bulletin cycle input + erratum body textarea). All had `<label>` wraps which is semantically valid HTML, but Chrome DevTools still emits the warning Eric observed on Countermoves 2026-05-24 ("A form field element should have an id or name attribute"). `aria-label` silences the warning and adds defense-in-depth.
- **`928e61e`** — `chore(05-02): version 1.0.0-rc.2 -- DIST-05 + COEXIST-05 closed at the code tier`. Version 1.0.0-rc.1 → 1.0.0-rc.2 in package.json + src/manifest.ts + chat-capabilities pin.

## Quality gates

- Suite 1337 → 1339 (+2 net: check-a11y + uninstall-runbook test pins; 0 fail; 2 pre-existing skip).
- `tsc --noEmit` clean.
- `check-css-scope.mjs` exit 0.
- `check-a11y.mjs` exit 0 — 64 src/ui/**/*.{ts,tsx,jsx} files scanned, 0 violations.
- `coexistence-checks/run-all.mjs`: 10/10 PASS (including the new COEXIST-10).

## Tarball

- `clarity-pack-1.0.0-rc.2.tgz`
- 142,544 bytes
- sha256 `ac2f4df2c3d5de8f86d271dc9b4f77cf8cc14f413fb63a095127ac2797c4cc0a`

## Lessons (filed to MemPalace `clarity_pack/decisions`)

1. **JSX-aware static parsers must track brace depth.** A naive `[^>]*?\/?>` regex truncates on `onChange={(e) => …}` because `>` appears in `=>` arrow functions. The fixed parser walks chars from `<tag` tracking `{`/`}` depth + string/template literal boundaries.

2. **`<label>` wrap is semantically valid HTML but does NOT silence the Chrome DevTools form-field warning.** Adding `aria-label` is defense-in-depth that satisfies both the static check + the browser DevTools issue panel.

## Operator action (NONE for this plan)

This plan ships code-only. The GitHub Actions workflows will fire on the next PR/push to main. No live Countermoves drill needed because:
- The CI infrastructure runs on GitHub Actions runners, not Countermoves.
- The COEXIST-05 data-preservation half was operator-proven by the Phase 4-closure drill 2026-05-19 (CHAT-11 evidence).
- The runbook half is documentation (Plan 05-01's README + this plan's coexistence gate).
