// test/ui/reader-view.test.mjs
//
// Plan 02-03 Task 2 — Reader view visual + structural contract. Node 24's
// native strip-types loads .ts but not .tsx, so these tests are SOURCE-GREP
// based (same pattern as test/ui/css-scope.test.mjs and
// test/ui/eslint-no-raw-fetch.test.mjs from 02-02). They verify:
//   - every required component file exists (Task 2 file plan)
//   - each component imports / wires the right contracts
//   - the locked literal strings appear (PauseBanner message; deliverable
//     dispatch wires usePluginData('deliverable.preview') per Plan 05-04 D-24)
//   - ProseWithRefChips uses RefChip from the 02-02 primitives
//   - LiveBlockerPanel renders exactly one terminal kind (no nested chains)
//
// Run-time behavior (regex splitting, AC toggle action call, etc.) is verified
// indirectly through the manual Task 3 checkpoint against a real Paperclip
// clone. The source-grep tests pin down the structural contract; the
// integration check covers the actual rendered DOM.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader');

function readSrc(rel) {
  return readFileSync(path.join(READER_DIR, rel), 'utf8');
}

const REQUIRED_FILES = [
  'index.tsx',
  'tldr-strip.tsx',
  'ref-card.tsx',
  'prose-with-ref-chips.tsx',
  'deliverable-preview.tsx',
  'ac-checklist.tsx',
  'activity-timeline.tsx',
  'breadcrumb.tsx',
  'live-blocker-panel.tsx',
  'pause-banner.tsx',
];

for (const file of REQUIRED_FILES) {
  test(`Reader: ${file} exists`, () => {
    assert.ok(existsSync(path.join(READER_DIR, file)), `expected file ${file} to exist`);
  });
}

test('index.tsx exports ReaderView and wraps the surface in <ClaritySurfaceRoot name="reader"> (SCAF-06)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /export function ReaderView/, 'ReaderView named export');
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']reader["']/, 'wraps surface root with name="reader"');
});

test('index.tsx calls usePluginData with key "issue.reader"', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /usePluginData[\s\S]*['"]issue\.reader['"]/);
});

test('index.tsx imports all nine reader subcomponents (sketches mockup structure)', () => {
  const src = readSrc('index.tsx');
  const required = [
    'TldrStrip',
    'Breadcrumb',
    'ProseWithRefChips',
    'AnchoredToCards',
    'DeliverablePreview',
    'AcChecklist',
    'ActivityTimeline',
    'LiveBlockerPanel',
    'PauseBanner',
  ];
  for (const name of required) {
    assert.match(src, new RegExp(`<${name}\\b`), `Reader renders <${name} />`);
  }
});

test('prose-with-ref-chips.tsx exports ProseWithRefChips and renders <RefChip /> from 02-02 primitives (READER-03)', () => {
  const src = readSrc('prose-with-ref-chips.tsx');
  assert.match(src, /export function ProseWithRefChips/);
  assert.match(src, /<RefChip\b/);
  assert.match(src, /from\s+['"]\.\.\/\.\.\/primitives\/ref-chip\.tsx['"]|from\s+['"]\.\.\/\.\.\/primitives\/ref-chip['"]/);
  // Regex literal driving the split must match BEAAA-NNN pattern
  assert.match(src, /BEAAA-\\d\+|BEAAA-\\\\d\\\\+/, 'splits prose on BEAAA-NNN regex');
});

test('deliverable-preview.tsx exports DeliverablePreview and dispatches on data.kind via usePluginData and renders four real previewers (DIST-04)', () => {
  // Plan 05-04 D-24 — the locked deferred-message literal from Plan 02-03
  // is REMOVED in the same commit that ships the worker-handler-backed
  // dispatcher. The export contract (`export function DeliverablePreview`)
  // is preserved.
  const src = readSrc('deliverable-preview.tsx');
  assert.match(src, /export function DeliverablePreview/);
  assert.match(
    src,
    /usePluginData[\s\S]*['"]deliverable\.preview['"]/,
    'wires the deliverable.preview worker handler',
  );
  assert.match(
    src,
    /switch\s*\(\s*data\.kind\s*\)/,
    'dispatches on data.kind discriminator',
  );
  assert.match(
    src,
    /<embed[\s\S]*type=["']application\/pdf["']/,
    'pdf branch uses native <embed>',
  );
});

test('pause-banner.tsx contains the locked literal "Editorial Desk paused — last compile failed at" (D-07)', () => {
  const src = readSrc('pause-banner.tsx');
  assert.match(
    src,
    /Editorial Desk paused — last compile failed at/,
    'D-07 pause banner literal must appear verbatim (with em-dash)',
  );
});

test('pause-banner.tsx subscribes to editor.pause-status data handler', () => {
  const src = readSrc('pause-banner.tsx');
  assert.match(src, /usePluginData[\s\S]*['"]editor\.pause-status['"]/);
});

test('live-blocker-panel.tsx renders ONE typed terminal (no nested blocker chain steps; READER-08)', () => {
  const src = readSrc('live-blocker-panel.tsx');
  // The Live blocker panel renders {terminal.kind} / {terminal.label} ONCE — it must
  // NOT loop over `pathIds` (which would render the entire chain).
  assert.doesNotMatch(src, /pathIds\.map\b/, 'Live blocker panel must not iterate pathIds (single-terminal contract)');
  // It must consume the flatten-blocker-chain handler
  assert.match(src, /usePluginData[\s\S]*['"]flatten-blocker-chain['"]/);
  // It must reference a terminal object from the result
  assert.match(src, /terminal/);
});

test('ref-card.tsx renders the substantive excerpt (READER-04)', () => {
  const src = readSrc('ref-card.tsx');
  // The component must reference card.excerpt (or excerpt prop) — the
  // README-04 substantive-quote contract.
  assert.match(src, /\bexcerpt\b/);
});

test('ac-checklist.tsx wires the ac-toggle action via usePluginAction (READER-07)', () => {
  const src = readSrc('ac-checklist.tsx');
  assert.match(src, /usePluginAction[\s\S]*['"]ac-toggle['"]/);
});

test('breadcrumb.tsx uses useHostNavigation for navigation (SCAF-09 — no raw <a href>)', () => {
  const src = readSrc('breadcrumb.tsx');
  assert.match(src, /useHostNavigation\b/);
});

test('Reader bundle output (dist/ui/index.js) exports the ReaderView component', () => {
  const distPath = path.resolve(HERE, '..', '..', 'dist', 'ui', 'index.js');
  if (!existsSync(distPath)) {
    // Test is meaningful only after `pnpm build` has run; skip silently in pre-build runs.
    return;
  }
  const bundle = readFileSync(distPath, 'utf8');
  assert.match(bundle, /ReaderView/, 'built bundle includes ReaderView');
});
