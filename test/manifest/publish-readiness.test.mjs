// test/manifest/publish-readiness.test.mjs
//
// Phase 5 Plan 05-01 (DIST-01) — publish-readiness contract.
// Smoke-tests that pin the `npm publish` blast-radius + the prepublish
// guard. Source-grep idiom (the same idiom as chat-url-params.test.mjs).
//
// Why pin these:
//  - paperclipPlugin.{manifest, worker, ui} is what the host reads to find
//    the plugin's bundled artifacts. Drift here = host can't install.
//  - `files` restricts what gets published; without it, dev artifacts +
//    .planning/ + the entire repo would ship. With the wrong entries, the
//    publish silently misses something the host needs.
//  - engines.node >= 20 — host requires it (per PLUGIN_SPEC.md §6 +
//    workspace pin). Older = installs fail.
//  - peerDependencies for @paperclipai/plugin-sdk + react + react-dom
//    are FORCED by the same-origin trust model (per CLAUDE.md). Bundling
//    React would double-mount hooks.
//  - prepublishOnly is the load-bearing guard that blocks `npm publish`
//    from shipping a stale dist/.
//  - README.md exists — declared in `files` so without it the published
//    tarball is missing one of its three top-level files.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

test('publish-readiness: paperclipPlugin field points at dist/ artifacts', () => {
  assert.ok(pkg.paperclipPlugin, 'paperclipPlugin field is present');
  assert.match(pkg.paperclipPlugin.manifest, /^\.\/dist\/manifest\.js$/, 'manifest points at dist/manifest.js');
  assert.match(pkg.paperclipPlugin.worker, /^\.\/dist\/worker\.js$/, 'worker points at dist/worker.js');
  assert.match(pkg.paperclipPlugin.ui, /^\.\/dist\/ui\/?$/, 'ui points at dist/ui/');
});

test('publish-readiness: files restricts publish to dist/ + migrations/ + README.md', () => {
  assert.ok(Array.isArray(pkg.files), 'files is an array');
  // Order-independent set check.
  const wanted = ['dist/', 'migrations/', 'README.md'];
  for (const w of wanted) {
    assert.ok(
      pkg.files.includes(w),
      `files includes "${w}" (got: ${JSON.stringify(pkg.files)})`,
    );
  }
});

test('publish-readiness: engines.node >= 20', () => {
  assert.ok(pkg.engines && pkg.engines.node, 'engines.node is set');
  // Accept ">=20", ">=20.0.0", "20", "^20" — anything that requires 20+.
  assert.match(
    pkg.engines.node,
    /^(>=?\s*)?20(\.|$)|^\^20|^~20/,
    `engines.node requires Node 20+ (got: ${pkg.engines.node})`,
  );
});

test('publish-readiness: peerDependencies declare @paperclipai/plugin-sdk + react + react-dom', () => {
  const peers = pkg.peerDependencies ?? {};
  for (const key of ['@paperclipai/plugin-sdk', 'react', 'react-dom']) {
    assert.ok(peers[key], `peerDependencies["${key}"] is declared`);
  }
});

test('publish-readiness: scripts.prepublishOnly is set (build/verify guard)', () => {
  assert.ok(pkg.scripts, 'scripts is present');
  assert.ok(
    pkg.scripts.prepublishOnly,
    'scripts.prepublishOnly is set so npm publish cannot ship a stale dist/',
  );
  // The guard must at minimum run the build (the published artifact must
  // be fresh) and the test suite (must not ship a red build).
  assert.match(
    pkg.scripts.prepublishOnly,
    /build/,
    'prepublishOnly runs the build',
  );
  assert.match(
    pkg.scripts.prepublishOnly,
    /test/,
    'prepublishOnly runs the tests',
  );
});

test('publish-readiness: README.md exists at the repo root', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'README.md')),
    'README.md exists at the repo root (declared in package.json files)',
  );
});

test('publish-readiness: description is non-empty', () => {
  assert.ok(pkg.description, 'description is set');
  assert.ok(pkg.description.length > 10, 'description is more than a placeholder');
});

test('publish-readiness: type is "module" (ESM-only per PLUGIN_SPEC.md)', () => {
  assert.equal(pkg.type, 'module');
});
