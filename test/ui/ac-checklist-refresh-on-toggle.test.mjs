// test/ui/ac-checklist-refresh-on-toggle.test.mjs
//
// Quick fix 260524-s2y (rc.6) — source-grep contract test pinning the AC
// toggle → Reader-data refresh wiring. The SDK
// @paperclipai/plugin-sdk@2026.512.0 has NO manifest-side
// `actions[].invalidates` field — `PaperclipPluginManifestV1` has no
// `actions:` key, and the SDK type tree contains zero `invalidat*`
// occurrences (verified by reading dist/types.d.ts + grepping the SDK
// directory). Data invalidation is a UI-side concern via
// `PluginDataResult.refresh()` returned from `usePluginData`. This test
// pins the wiring at the UI tier so a future refactor cannot silently
// regress to the pre-rc.6 stale-cache state.
//
// Same source-grep idiom as ac-checklist-autostatus.test.mjs — Node's
// node:test runner does not load .tsx, so behavioral tests on tsx files
// are source-grep contracts, not runtime DOM tests.
//
// 6 contracts (A-F):
//   A. PROP DECLARATION — onMutated?: () => void on AcChecklist
//   B. CONDITIONAL INVOCATION — .then(...) on toggleAc gated on res.ok === true
//   C. NO UNCONDITIONAL CALL — no bare onMutated() outside a .then(...) block
//   D. READER WIRING (index.tsx) — refresh destructured from BOTH
//      usePluginData calls
//   E. READER WIRING — onMutated= JSX prop on <AcChecklist passes a callback
//      that calls BOTH refresh() and refreshAcAuto()
//   F. SDK GAP RATIONALE COMMENT — both files name the SDK gap in a comment

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AC_CHECKLIST = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'ac-checklist.tsx',
);
const READER_INDEX = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'index.tsx',
);

function stripped(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function raw(file) {
  return readFileSync(file, 'utf8');
}

test('260524-s2y A — ac-checklist.tsx declares optional onMutated?: () => void prop', () => {
  const src = stripped(AC_CHECKLIST);
  assert.match(
    src,
    /onMutated\?:\s*\(\s*\)\s*=>\s*void/,
    'expected `onMutated?: () => void` on the AcChecklist props so existing call sites keep compiling',
  );
});

test('260524-s2y B — toggleAc .then(...) gates onMutated on ok === true', () => {
  const src = stripped(AC_CHECKLIST);
  // The toggle must do `void toggleAc(...).then((res) => { ... ok ... onMutated?.() ... })`.
  // We match the structural elements with a slack-tolerant pattern.
  assert.match(
    src,
    /toggleAc\([^)]*\)\.then\s*\(/,
    'expected a `.then(` continuation on the toggleAc promise',
  );
  // The ok-check + onMutated call must both appear inside the same .then(...).
  // Match the full continuation body and assert both literals are present.
  const thenBody = src.match(/toggleAc\([^)]*\)\.then\s*\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(thenBody, 'expected a .then((res) => { ... }) block on toggleAc');
  assert.match(
    thenBody[0],
    /\.ok\s*===\s*true/,
    'the .then body must runtime-check `.ok === true`',
  );
  assert.match(
    thenBody[0],
    /onMutated\?\.\(\)/,
    'the .then body must call `onMutated?.()`',
  );
});

test('260524-s2y C — no unconditional onMutated() outside the .then(...) block', () => {
  const src = stripped(AC_CHECKLIST);
  // Split source at the .then( marker; the BEFORE half is what we audit.
  // Anything calling onMutated() outside a .then(...) continuation is a
  // regression that would refresh on every click, including {ok:false}.
  const thenIdx = src.indexOf('toggleAc(');
  assert.ok(thenIdx >= 0, 'expected to find the toggleAc call site');
  const beforeToggle = src.slice(0, thenIdx);
  assert.doesNotMatch(
    beforeToggle,
    /onMutated\s*\?\.\s*\(\s*\)|onMutated\s*\(\s*\)/,
    'onMutated MUST NOT be called before / outside the toggleAc.then(...) block (regression: would fire on {ok:false})',
  );
});

test('260524-s2y D — index.tsx destructures refresh from BOTH usePluginData calls', () => {
  const src = stripped(READER_INDEX);
  // `loading` was intentionally DROPPED from this destructure by the 2026-05-29
  // scroll-stability fix: gating the render on `loading` unmounted the populated
  // Reader on every TL;DR poll (refresh() sets loading=true + data=null per the
  // SDK contract), collapsing the page and resetting scroll. `refresh` is still
  // destructured (the poll + the AC-toggle refresh both need it); `data` is
  // aliased to `rawData` and run through resolveReaderData().
  assert.match(
    src,
    /\{\s*data\s*:\s*rawData\s*,\s*refresh\s*\}\s*=\s*usePluginData[^(]*\(\s*['"]issue\.reader['"]/,
    'expected `const { data: rawData, refresh } = usePluginData<...>(\'issue.reader\', ...)`',
  );
  assert.match(
    src,
    /refresh\s*:\s*refreshAcAuto[\s\S]{0,200}usePluginData[^(]*\(\s*['"]reader\.ac\.autostatus['"]/,
    'expected `refresh: refreshAcAuto` destructure on the usePluginData(\'reader.ac.autostatus\', ...) call',
  );
});

test('260524-s2y E — index.tsx passes onMutated to <AcChecklist that calls BOTH refresh() and refreshAcAuto()', () => {
  const src = stripped(READER_INDEX);
  // Find the <AcChecklist ... /> JSX element and capture its full prop block.
  const acJsx = src.match(/<AcChecklist\b[\s\S]*?\/>/);
  assert.ok(acJsx, 'expected to find a <AcChecklist .../> JSX element');
  assert.match(
    acJsx[0],
    /onMutated\s*=\s*\{/,
    'expected an onMutated={...} JSX prop on <AcChecklist>',
  );
  // The onMutated callback body must call BOTH refresh() AND refreshAcAuto().
  assert.match(
    acJsx[0],
    /refresh\s*\(\s*\)/,
    'the onMutated callback must call refresh()',
  );
  assert.match(
    acJsx[0],
    /refreshAcAuto\s*\(\s*\)/,
    'the onMutated callback must call refreshAcAuto()',
  );
});

test('260524-s2y F — both files name the SDK gap in a comment (rationale survives future edits)', () => {
  // Read RAW (no comment-strip) so the rationale comment regex hits.
  const acRaw = raw(AC_CHECKLIST);
  const idxRaw = raw(READER_INDEX);
  // The rationale must name "no manifest-side ... invalidates" (or equivalent
  // phrasing) so a future reader of the diff understands why the manifest
  // was NOT touched. The regex is permissive on hyphen/space and matches
  // across newlines to survive line-wrapping in the comment prose.
  const RATIONALE = /no manifest-?side[\s\S]{0,400}invalidat/i;
  assert.match(
    acRaw,
    RATIONALE,
    'ac-checklist.tsx must name the SDK gap in a comment (no manifest-side ... invalidates)',
  );
  assert.match(
    idxRaw,
    RATIONALE,
    'index.tsx must name the SDK gap in a comment (no manifest-side ... invalidates)',
  );
});
