---
phase: 05-distribution-polish
plan: 01
status: code-complete-pending-operator-publish
version_shipped: 1.0.0-rc.1
requirements_closed_at_code_tier: [DIST-01, DIST-02]
suite_before: 1329
suite_after: 1337
---

## What was built

**Plan 05-01 closes DIST-01 + DIST-02 at the code tier.** The npm publish blast-radius is pinned; the README documents install + opt-in + rollback + uninstall + runbook references; a `prepublishOnly` guard blocks `npm publish` from shipping a stale `dist/`.

Live `npm publish` requires Eric's npm credentials and is DEFERRED to the post-Phase-5 operator sweep alongside the Phase 4.2 drill.

## Tasks

- **Task 1 (RED)** `ba0b6a6` — `test(05-01): RED -- publish-readiness contract (DIST-01)`. Added `test/manifest/publish-readiness.test.mjs` (8 assertions: paperclipPlugin field shape, `files` restriction, engines.node ≥ 20, peerDependencies, prepublishOnly script, README existence, description non-empty, type ESM). Pre-fix RED on README + prepublishOnly assertions.
- **Task 2-3 (GREEN)** `351a67d` — `feat(05-01): README + prepublishOnly + version 1.0.0-rc.1 (DIST-01 + DIST-02)`. README.md at repo root (install, opt-in, rollback, uninstall, runbook, trust model, compatibility); `scripts.prepublishOnly: npm run build && npm run typecheck && npm test && node scripts/check-css-scope.mjs`; version 0.9.3 → 1.0.0-rc.1 in package.json + src/manifest.ts + chat-capabilities pin.

## Quality gates

- Suite 1329 → 1337 (+8 net publish-readiness; 0 fail; 2 pre-existing skip).
- `tsc --noEmit` clean.
- `check-css-scope.mjs` exit 0.
- `npm pack --dry-run`: 14 files (README.md + dist/{manifest,worker,ui/index}.js + migrations/0001-0009.sql + package.json) — exactly the host's needs.

## Tarball

- `clarity-pack-1.0.0-rc.1.tgz`
- 142,516 bytes
- sha256 `d7bbfa649bf838f7c3e1e4dd83ecad5357be4fc3a0a2710005c154212b894889`

## Operator action (DEFERRED to post-Phase-5 sweep)

`npm publish` runs from local workstation using Eric's npm credentials. The prepublishOnly guard fires automatically. After publish: `pnpm paperclipai plugin install clarity-pack@1.0.0-rc.1` from any Paperclip workspace.
