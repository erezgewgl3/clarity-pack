// test/ui/deliverable-preview.test.mjs
//
// Plan 05-04 Task 2 (DIST-04) -- source-grep pins for the rewritten
// DeliverablePreview UI dispatcher. Mirrors the reader-view.test.mjs style
// (Node native --test cannot load .tsx, so contract checks are source-grep
// based; runtime DOM checks live in the visual-regression + manual drill).
//
// Pins:
//   U1 — export contract preserved (`export function DeliverablePreview`)
//   U2 — wires usePluginData('deliverable.preview', ...)
//   U3 — imports from 'react-markdown'
//   U4 — NO dangerouslySetInnerHTML (T-05-04-05 + check-a11y R3)
//   U5 — <img> carries alt= (check-a11y R1)
//   U6 — pdf branch uses literal <embed type="application/pdf">
//   U7 — switch on data.kind covers all five worker-side kinds
//   U8 — error fallback renders the load-bearing visible string

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'deliverable-preview.tsx',
);

function read() {
  return readFileSync(FILE, 'utf8');
}

test('U1: deliverable-preview.tsx still exports DeliverablePreview', () => {
  assert.match(read(), /export function DeliverablePreview/);
});

test('U2: file wires usePluginData with key "deliverable.preview"', () => {
  assert.match(read(), /usePluginData[\s\S]*['"]deliverable\.preview['"]/);
});

test('U3: file imports react-markdown', () => {
  assert.match(read(), /from\s+['"]react-markdown['"]/);
});

test('U4: file does NOT actually USE dangerouslySetInnerHTML (R3 invariant)', () => {
  // R3 invariant pins the actual prop USAGE, not documentary comments
  // (which are stripped by scripts/check-a11y.mjs before the static
  // check). We match the JSX attribute form `dangerouslySetInnerHTML=`
  // -- a literal usage would always have an `=` after the prop name.
  const src = read();
  assert.doesNotMatch(
    src,
    /dangerouslySetInnerHTML\s*=/,
    'dangerouslySetInnerHTML prop must not be used in DeliverablePreview',
  );
});

test('U5: <img> branch carries alt= (R1 invariant)', () => {
  const src = read();
  // The img tag must have an alt attribute. We grep the whole opening tag.
  assert.match(src, /<img[\s\S]*?\balt=/, '<img> must carry alt=');
});

test('U6: pdf branch uses literal <embed type="application/pdf">', () => {
  assert.match(read(), /<embed[\s\S]*?type=["']application\/pdf["']/);
});

test('U7: switch on data.kind covers all five kinds + placeholder', () => {
  const src = read();
  assert.match(src, /switch\s*\(\s*data\.kind\s*\)/);
  for (const kind of [
    "'xlsx-grid'",
    "'pdf-embed'",
    "'md'",
    "'img'",
    "'placeholder'",
  ]) {
    assert.ok(
      src.includes(`case ${kind}`),
      `expected case ${kind} in the dispatch switch`,
    );
  }
});

test('U8: error fallback renders the load-bearing visible string', () => {
  // "Preview unavailable — open in classic Paperclip." is the contract
  // string the operator sees on any { error } envelope or unknown kind.
  // Em-dash is the literal character used in src; assertion uses the same.
  assert.match(
    read(),
    /Preview unavailable — open in classic Paperclip\./,
  );
});
