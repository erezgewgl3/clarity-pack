// test/build/no-vite-hmr-in-production.test.mjs
//
// Plan 02-08 Task 3 RED — DEV-08 closure. Two contracts:
//
// 1. scripts/build-ui.mjs sets NODE_ENV=production via esbuild `define`. This
//    is defense-in-depth: any library that branches on process.env.NODE_ENV
//    sees 'production' at build time, so dev-mode shims (React DevTools hooks,
//    HMR clients, etc.) are dead-code-eliminated.
//
// 2. dist/ui/index.js does NOT contain literal references to the Vite HMR
//    client (`/@vite/client`, `import.meta.hot`, etc.) — these would only
//    appear if the bundle accidentally pulled in dev-mode Vite shims.
//
// The drill observed WebSocket errors to wss://127.0.0.1:13100/ in the
// console. Investigation showed those originated from the HOST page's
// dev-mode Vite client (Paperclip's own UI in dev mode), NOT from the
// plugin bundle. The Plan 02-08 fix is still required: setting NODE_ENV via
// `define` keeps the plugin bundle from ever drifting into the same trap.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const BUILD_UI = path.join(REPO_ROOT, 'scripts', 'build-ui.mjs');
const DIST_JS = path.join(REPO_ROOT, 'dist', 'ui', 'index.js');

test('scripts/build-ui.mjs sets process.env.NODE_ENV to production via esbuild define (DEV-08)', () => {
  const src = readFileSync(BUILD_UI, 'utf8');
  // Accept either the JSON.stringify form or the literal '"production"' form.
  const re = /define\s*:[\s\S]*?process\.env\.NODE_ENV[\s\S]*?(?:JSON\.stringify\(['"]production['"]\)|'"production"'|`"production"`|"\\"production\\"")/;
  assert.match(
    src,
    re,
    'expected scripts/build-ui.mjs to contain `define: { ..., "process.env.NODE_ENV": JSON.stringify("production"), ... }`',
  );
});

test('scripts/build-ui.mjs sets import.meta.env.MODE/PROD/DEV via define (defense in depth)', () => {
  const src = readFileSync(BUILD_UI, 'utf8');
  // These are the keys Vite-mode bundles branch on. Setting them at build
  // time means any accidentally-imported Vite shim sees PROD=true.
  assert.match(src, /import\.meta\.env\.PROD/, 'expected import.meta.env.PROD in define');
  assert.match(src, /import\.meta\.env\.DEV/, 'expected import.meta.env.DEV in define');
  assert.match(src, /import\.meta\.env\.MODE/, 'expected import.meta.env.MODE in define');
});

test('dist/ui/index.js does NOT contain "/@vite/client" (DEV-08 BLANKET ASSERTION)', { skip: process.env.RUN_BUILD_TESTS !== '1' && !existsSync(DIST_JS) }, () => {
  if (!existsSync(DIST_JS)) {
    assert.fail(`expected ${DIST_JS} to exist (run node scripts/build-ui.mjs first); set RUN_BUILD_TESTS=1 to run this in CI`);
  }
  const js = readFileSync(DIST_JS, 'utf8');
  assert.ok(
    !js.includes('/@vite/client'),
    'dist/ui/index.js must not contain "/@vite/client" — production bundle should never pull the Vite HMR client',
  );
});

test('dist/ui/index.js does NOT contain wss://127.0.0.1:13100 (DEV-08)', { skip: process.env.RUN_BUILD_TESTS !== '1' && !existsSync(DIST_JS) }, () => {
  if (!existsSync(DIST_JS)) {
    assert.fail(`expected ${DIST_JS} to exist`);
  }
  const js = readFileSync(DIST_JS, 'utf8');
  assert.ok(
    !js.includes('wss://127.0.0.1:13100'),
    'dist/ui/index.js must not contain literal Vite HMR WebSocket URL',
  );
});

test('dist/ui/index.js does NOT contain import.meta.hot (DEV-08)', { skip: process.env.RUN_BUILD_TESTS !== '1' && !existsSync(DIST_JS) }, () => {
  if (!existsSync(DIST_JS)) {
    assert.fail(`expected ${DIST_JS} to exist`);
  }
  const js = readFileSync(DIST_JS, 'utf8');
  assert.ok(
    !js.includes('import.meta.hot'),
    'dist/ui/index.js must not contain "import.meta.hot" — HMR shouldn\'t reach production',
  );
});
