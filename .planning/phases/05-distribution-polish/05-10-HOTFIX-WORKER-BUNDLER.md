---
phase: 05-distribution-polish
plan: 05-10
hotfix: worker-bundler-createRequire
version: 1.0.0
prior_version: 1.0.0
artifact: clarity-pack-1.0.0.tgz
artifact_bytes_before: 625394
artifact_sha256_before: 53567012d6f5cb6a724351972f2f9545dc208f439af2d7757bbc456722e033da
artifact_bytes_after: 625440
artifact_sha256_after: 393bc7224988a53adb8e49e7b87aaa4d9a0927a39da69c98e1b4f3c73f20821f
artifact_size_delta_bytes: 46
worker_bundle_bytes_after: 2200000
ui_bundle_bytes_after: 652913
suite_baseline: 1674
suite_final: 1676
suite_pass: 1672
suite_fail: 0
suite_skip: 4
committed: 2026-05-26
no_version_bump: true
no_runtime_dep_added: true
---

# Plan 05-10 HOTFIX — Worker Bundler `createRequire` Banner

**Status:** SHIPPED 2026-05-26. Binary repack only; version literal stays at `1.0.0`. No runtime deps added.

## The bug

During the Plan 05-10 v1.0.0 operator drill on Countermoves, the Paperclip host worker failed to activate (`status=error`) immediately on plugin install. The error:

```
file:///tmp/clarity-pack-build/clarity-pack-1.0.0/package/dist/worker.js:11
  throw Error('Dynamic require of "' + x + '" is not supported');
        ^
Error: Dynamic require of "stream" is not supported
    at make_xlsx_lib (file:///.../dist/worker.js:33237:22)
    at node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js (file:///.../dist/worker.js:33241:41)
    at __require2 (file:///.../dist/worker.js:14:50)
    at file:///.../dist/worker.js:40650:20
    at ModuleJob.run (node:internal/modules/esm/module_job:325:25)
```

## Root cause

Plan 05-04 introduced `xlsx@0.18.5` (a CommonJS UMD package) into the worker tier for the DIST-04 deliverable previewer. The worker is bundled with esbuild at `format: "esm"`, `platform: "node"`, `target: "node20"`.

When esbuild bundles a CJS package into an ESM output, it inserts a `__require` shim at the top of the bundle:

```js
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : ...)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
```

The IIFE captures whatever `require` is in scope at module-eval time. In a true ESM module loaded by Node (no parent CJS context), `require` is `undefined` → the shim falls back to the throwing function.

SheetJS's UMD factory (`make_xlsx_lib`) calls `__require("stream")` at module-eval time to bind Node's stream `Readable` for streaming reads. This throws on host worker boot, the worker dies, and the plugin never activates.

**Why it wasn't caught in local CI before drill:** `node -e "import('./dist/worker.js')"` runs in a context where Node provides a CommonJS-compatible `require` to `-e` scripts. The IIFE's `typeof require !== "undefined"` succeeded and the bundle loaded. The bug only manifests when the bundle is imported from a pure `.mjs` module — which is exactly what the Paperclip host worker harness does.

## The fix

Inject the canonical esbuild ESM-on-Node banner that brings Node's real `createRequire` into scope at the top of the bundle:

```js
// scripts/build-worker.mjs
await build({
  ...,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  }
});
```

After the banner, `dist/worker.js` line 1 reads:

```js
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
```

The `__require` shim's `typeof require !== "undefined"` check now succeeds (because the banner defines `require` lexically at the top of the bundle), and falls through to Node's native `require.apply(...)`. `require('stream')` resolves to the built-in stream module. SheetJS factory runs cleanly.

## Files changed

| File | Change |
|------|--------|
| `scripts/build-worker.mjs` | Added `banner: { js: "...createRequire..." }` to the esbuild config + comment explaining the why. No other config touched. |
| `test/build/worker-bundle-loads.test.mjs` (NEW) | Two regression tests: (1) ESM-import dist/worker.js via `pathToFileURL` and assert no throw; (2) source-grep `scripts/build-worker.mjs` for the `createRequire(import.meta.url)` literal so the banner can't silently disappear. Self-skips when `dist/worker.js` is absent. |
| `dist/worker.js` (REBUILT, not committed) | Now has `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` at line 1. |
| `clarity-pack-1.0.0.tgz` (REPACKED, not committed) | New tarball. |

## Reproduction of the original bug

Before the fix, in this repo:

```bash
cat > load-worker-esm.mjs <<'EOF'
import('./dist/worker.js').then(()=>console.log('LOADS OK')).catch(e=>{console.error('LOAD FAILED:',e.message);process.exit(1);});
EOF
node load-worker-esm.mjs
# → LOAD FAILED: Dynamic require of "stream" is not supported
```

After the fix:

```bash
node load-worker-esm.mjs
# → LOADS OK
```

## Tarball before/after

| Metric | Before fix | After fix | Delta |
|--------|-----------|-----------|-------|
| `clarity-pack-1.0.0.tgz` size | 625,394 bytes | 625,440 bytes | +46 bytes |
| `clarity-pack-1.0.0.tgz` sha256 | `53567012d6f5cb6a724351972f2f9545dc208f439af2d7757bbc456722e033da` | `393bc7224988a53adb8e49e7b87aaa4d9a0927a39da69c98e1b4f3c73f20821f` | (new) |
| `dist/worker.js` size | ~2.1 MB | ~2.1 MB | +~90 bytes (banner string) |
| Loads as ESM via `node <entry>.mjs` | **NO** (throws) | **YES** | (bug fixed) |

The 46-byte tarball delta is the gzipped banner plus tar block-padding rounding.

## Quality gates (post-fix)

All Phase 5 gates remain green:

| Gate | Result | Notes |
|------|--------|-------|
| `node scripts/build-worker.mjs` | **PASS** | dist/worker.js 2.1mb, banner at line 1 |
| `node scripts/build-ui.mjs` | **PASS** | dist/ui/index.js 637.6kB |
| `tsc --project tsconfig.manifest.json` | **PASS** | manifest emitted |
| `tsc --noEmit` | **PASS** | 0 type errors |
| `node scripts/check-css-scope.mjs` | **PASS** | 121 top-level selectors, all scoped |
| `node scripts/check-a11y.mjs` | **PASS** | 69 files / 0 violations |
| `node scripts/check-ui-bundle-size.mjs` | **PASS** | 652,913 / 665,600 bytes; 0 SheetJS sentinels (UI tier still xlsx-free) |
| `node scripts/coexistence-checks/run-all.mjs` | **PASS** | 10/10 (COEXIST-01..10) |
| `npm test` (full suite) | **PASS** | **1676** tests / 1672 pass / 0 fail / 4 skip (was 1674 pre-hotfix; +2 from `worker-bundle-loads.test.mjs`) |
| ESM import smoke (`node load-worker-esm.mjs`) | **PASS** | `LOADS OK` |
| `node --test test/build/worker-bundle-loads.test.mjs` | **PASS** | both tests pass in 1.1s |

## Invariants preserved

- **Version literal stays at `1.0.0`.** No bump in `package.json` or `src/manifest.ts`. The atomic version-bump consolidation invariant (Plan 05-10 Task 1) holds.
- **No new runtime deps.** `createRequire` is a Node built-in (`node:module`).
- **Worker externals unchanged.** `@paperclipai/plugin-sdk`, `react`, `react-dom` still externalized; `xlsx` still bundled.
- **CTT-07 invariant.** Worker source code path didn't change — only the bundler config. The worker's runtime behavior is identical except that `require()` calls now resolve instead of throw.
- **UI tier remains xlsx-free.** UI bundle-size guardrail's `XLSX` / `SheetJS` / `!ref` sentinel scan still reports 0 matches.
- **No `--no-verify`.** Both commits run pre-commit hooks normally.
- **Plan 05-10 Task 1-3 commits preserved.** Commits `e1e0d44` (atomic version bump) and `d152792` (Tasks 1-3 partial SUMMARY) remain on master untouched. This hotfix layers on top.

## Deviations from execute-plan brief

**1. [Rule 3 - Test reproduction] `node -e "import(...)"` did not reproduce the bug; needed a true `.mjs` entry**
- **Found during:** Task 3 verification
- **Issue:** The brief's `node -e "import('./dist/worker.js')"` command printed `LOADS OK` even on the buggy bundle, because `-e` mode provides a CommonJS `require` to the script, which the `__require` shim's `typeof require !== "undefined"` check happily found.
- **Fix:** Wrote a tiny `load-worker-esm.mjs` (in repo root, removed after use) that imports the worker bundle via a real ESM module. With no `require` in scope, the original bug reproduces (`LOAD FAILED: Dynamic require of "stream" is not supported`). This is also the exact context the Paperclip host worker harness uses.
- **Files touched:** none in the commit (the `.mjs` was scratch; removed). The smoke test `test/build/worker-bundle-loads.test.mjs` uses the same `pathToFileURL` + dynamic `import()` pattern that reliably reproduces the host's load context.

**2. [Rule 2 - Defense in depth] Smoke test pins the banner literal in the build script, not just the runtime behavior**
- **Found during:** Task 2 test authoring
- **Rationale:** A runtime `import('./dist/worker.js')` test only catches the regression if the bundle has been built. If a future change removes the banner AND nothing rebuilds the worker before tests, the regression could slip through. Added a second test that source-greps `scripts/build-worker.mjs` for `createRequire(import.meta.url)` + the `banner:` config. This is the build-tier counterpart of the runtime check.
- **Files touched:** `test/build/worker-bundle-loads.test.mjs` (the same file).

**3. [Rule 1 - Tooling] `pnpm` not on PATH locally; used `npm run` for build/test**
- **Found during:** Task 3 verification
- **Issue:** The repo's scripts assume `pnpm` (the `build` script chains `pnpm build:worker && pnpm build:ui && pnpm build:manifest`). Locally, `pnpm` was not on PATH.
- **Fix:** Ran each leaf script (`npm run build:worker`, `npm run build:ui`, `npm run build:manifest`) sequentially. This is equivalent to `npm run build` modulo the orchestrator. CI / `prepublishOnly` still runs the pnpm-chained script — no script change required.
- **Files touched:** none.

## Commits

1. `fix(05-04-hotfix): worker esbuild banner createRequire for xlsx CJS load`
   - `scripts/build-worker.mjs`: + banner config + explanatory comment
   - `test/build/worker-bundle-loads.test.mjs`: NEW (2 tests)

2. `chore(05-10): repack clarity-pack-1.0.0.tgz with worker bundler fix`
   - `.planning/phases/05-distribution-polish/05-10-HOTFIX-WORKER-BUNDLER.md`: NEW (this file)
   - `.planning/STATE.md`: last_updated + Current Position bumped

## Operator action

The new `clarity-pack-1.0.0.tgz` at the repo root SUPERSEDES the prior tarball published in commit `d152792`. Operator-drill on Countermoves should be re-run from scratch with this rebuild:

```bash
# On VPS, with canonical env block exported first (see runbook):
scp clarity-pack-1.0.0.tgz eric@countermoves-vps:~/
# then on the box, `paperclipai plugin install ~/clarity-pack-1.0.0.tgz` from ~/paperclip
# Worker should now activate cleanly (status=active, not status=error).
```

Recorded new sha256 in MemPalace `clarity_pack/runbook` for traceability.
