// test/build/worker-bundle-loads.test.mjs
//
// Plan 05-10 hotfix regression guard: dist/worker.js must load without
// throwing at module evaluation when imported as ESM (no implicit `require`
// in scope — which is what the Paperclip host worker runtime gives us).
//
// Bug history (the regression this test catches):
//   - Plan 05-04 bundled `xlsx@0.18.5` (CommonJS) into the ESM worker bundle.
//   - esbuild replaced internal `require()` calls with a throwing
//     `__require` stub for ESM output. SheetJS's UMD factory calls
//     `require("stream")` at module-eval time → the stub threw
//     `Error: Dynamic require of "stream" is not supported`.
//   - Host worker activation failed (`status=error`); the v1.0.0 tarball was
//     unloadable in production.
//   - Fix: scripts/build-worker.mjs now injects a `createRequire` banner so
//     bundled CJS `require()` calls reach Node's real require.
//
// The test dynamically imports dist/worker.js as ESM from a sibling .mjs
// module. If `require` is "undefined" at evaluation time (as it would be in
// the host) AND the bundle calls `require("stream")` anywhere during
// top-level evaluation, the import will reject and this test will fail.
//
// Pre-requisite: dist/worker.js must exist. The test self-skips with a clear
// message if absent, so it does not block ad-hoc `npm test` runs before a
// build. `prepublishOnly` and CI always run `pnpm build` before tests.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const WORKER_BUNDLE = path.join(REPO_ROOT, 'dist', 'worker.js');

test('dist/worker.js loads without throwing at module evaluation', { skip: !existsSync(WORKER_BUNDLE) && 'dist/worker.js not built — run `pnpm build` first' }, async () => {
  // file:// URL so dynamic import treats it as a real ESM specifier on Windows.
  const url = pathToFileURL(WORKER_BUNDLE).href;
  let err = null;
  try {
    await import(url);
  } catch (e) {
    err = e;
  }
  assert.equal(
    err,
    null,
    `Expected dist/worker.js to load cleanly as ESM, got: ${err && err.message}\n` +
      'This usually means a bundled CommonJS dependency invoked require() at ' +
      'module-eval time and the createRequire banner in scripts/build-worker.mjs ' +
      'is missing or got dropped. See Plan 05-10 HOTFIX note.',
  );
});

test('scripts/build-worker.mjs declares the createRequire banner (regression-proof source pin)', () => {
  const buildScriptPath = path.join(REPO_ROOT, 'scripts', 'build-worker.mjs');
  const src = readFileSync(buildScriptPath, 'utf8');
  // The two literals that together make `require()` reach Node's real require
  // from an ESM bundle. If either is removed, this test fails BEFORE the
  // bundle even gets a chance to break in production.
  assert.match(
    src,
    /createRequire\s*\(\s*import\.meta\.url\s*\)/,
    'expected scripts/build-worker.mjs to inject `createRequire(import.meta.url)` via esbuild banner',
  );
  assert.match(
    src,
    /banner\s*:\s*\{[\s\S]*?js\s*:[\s\S]*?createRequire/,
    'expected `banner: { js: "...createRequire..." }` in the esbuild config',
  );
});
