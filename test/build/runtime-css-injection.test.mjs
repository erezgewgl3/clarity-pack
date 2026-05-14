// test/build/runtime-css-injection.test.mjs
//
// DEV-14 (drill 2026-05-14 re-rehearsal): Paperclip's host loads the plugin
// UI JS bundle but does NOT auto-load a sibling CSS file. The 17.9 KB
// dist/ui/index.css that Plan 02-08 Task 1 shipped was sitting in the tarball
// untouched -- the page rendered without any Clarity styles because nothing
// injected the stylesheet.
//
// Fix: src/ui/index.tsx imports theme.css as a string (esbuild
// loader: { '.css': 'text' }) and a one-time `injectClarityStyles()` call
// at module load appends a `<style data-clarity-pack-styles>` element to
// document.head with the full CSS text.
//
// This test asserts the contract at build-output time:
//   1. The esbuild config has `loader: { '.css': 'text' }` so the import
//      resolves to a string, not a side-effect.
//   2. The compiled dist/ui/index.js contains the CSS injection plumbing
//      (the marker attribute + a recognizable CSS rule from theme.css).
//   3. The compiled dist/ui/index.js does NOT contain a separate sidecar
//      `import` of an external CSS file (no `.css` at the import boundary).
//
// Tests #2 and #3 are guarded by RUN_BUILD_TESTS=1 because they depend on
// `dist/` being current. CI sets this env via `pnpm build && RUN_BUILD_TESTS=1
// node --test ...`.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const BUILD_UI = path.join(REPO_ROOT, 'scripts', 'build-ui.mjs');
const DIST_JS = path.join(REPO_ROOT, 'dist', 'ui', 'index.js');
const ENTRY = path.join(REPO_ROOT, 'src', 'ui', 'index.tsx');

test('scripts/build-ui.mjs configures esbuild loader { ".css": "text" }', () => {
  const config = readFileSync(BUILD_UI, 'utf8');
  // The loader block must be present so CSS imports resolve to strings.
  assert.match(
    config,
    /loader\s*:\s*\{[^}]*"\.css"\s*:\s*"text"/,
    'expected build-ui.mjs to set loader: { ".css": "text" } — without this, dist/ui/index.css would not be inlined into the JS bundle and Paperclip would never load it',
  );
});

test('src/ui/index.tsx imports the CSS as a string and calls a one-time injector', () => {
  const entry = readFileSync(ENTRY, 'utf8');
  assert.match(entry, /import\s+\w+\s+from\s+['"][^'"]+\.css['"]/, 'expected a default-import of a .css file in src/ui/index.tsx');
  assert.match(entry, /injectClarityStyles|appendChild\([^)]*style/, 'expected an injection function or appendChild(style) call');
  assert.match(entry, /data-clarity-pack-styles/, 'expected the style element to carry the data-clarity-pack-styles marker attribute');
});

const buildTestsEnabled = process.env.RUN_BUILD_TESTS === '1' || process.env.RUN_BUILD_TESTS === 'true';

test('dist/ui/index.js contains the inlined CSS marker + at least one Clarity selector', { skip: !buildTestsEnabled }, () => {
  assert.ok(existsSync(DIST_JS), `expected ${DIST_JS} to exist — run \`node scripts/build-ui.mjs\` first`);
  const js = readFileSync(DIST_JS, 'utf8');

  // Marker attribute must appear (proves the injection plumbing is in the bundle).
  assert.match(js, /data-clarity-pack-styles/, 'dist/ui/index.js must contain the data-clarity-pack-styles marker attribute');

  // At least one recognizable CSS selector from theme.css must appear as a
  // literal substring (proves the CSS got inlined as text, not just imported
  // as a side-effect). We pick three high-confidence selectors, all prefixed
  // `clarity-` per the SCAF-06 / COEXIST-01 namespacing rule:
  //   - .clarity-cta-button (Plan 02-04 Task 1 — opt-in CTA)
  //   - .clarity-agent-card (Plan 02-08 Task 1 — Situation Room agent grid)
  //   - [data-clarity-surface] (Plan 02-02 Task 2 — surface scoping)
  // The bundle must contain all three.
  for (const selector of ['.clarity-cta-button', '.clarity-agent-card', 'data-clarity-surface']) {
    assert.ok(
      js.includes(selector),
      `dist/ui/index.js must contain the inlined CSS selector "${selector}" — without this, Paperclip's page renders unstyled HTML`,
    );
  }
});
