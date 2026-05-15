// test/ui/bulletin-page.test.mjs
//
// Plan 03-03 Task 1 RED — Bulletin UI source contract. SOURCE-GREP test
// (Node 24 doesn't load .tsx through the test runtime). Verifies the 6
// bulletin surface components exist and carry the required wiring:
//   - index.tsx: exports BulletinPage, wraps <ClaritySurfaceRoot name="bulletin">,
//     uses useOptIn + useResolvedCompanyId + useResolvedUserId, calls
//     usePluginData('bulletin.byCycle'), renders all 6 children.
//   - masthead.tsx: literal masthead strings per sketch ll. 237-247.
//   - action-inbox.tsx: usePluginAction approve/decline + useHostNavigation.
//   - department-section.tsx: dropcap className.
//   - lineage-footer.tsx: 8-column thread grid class.
//   - no raw fetch( in any bulletin surface file (SCAF-05 defense-in-depth).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BULLETIN_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'bulletin');

function readSrc(rel) {
  return readFileSync(path.join(BULLETIN_DIR, rel), 'utf8');
}

const REQUIRED_FILES = [
  'index.tsx',
  'masthead.tsx',
  'action-inbox.tsx',
  'department-section.tsx',
  'standing-numbers-panel.tsx',
  'lineage-footer.tsx',
];

for (const f of REQUIRED_FILES) {
  test(`Bulletin UI: ${f} exists`, () => {
    assert.ok(existsSync(path.join(BULLETIN_DIR, f)), `expected ${f}`);
  });
}

test('Bulletin UI: index.tsx exports BulletinPage + wraps <ClaritySurfaceRoot name="bulletin">', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /export function BulletinPage/);
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']bulletin["']/);
});

test('Bulletin UI: index.tsx imports useOptIn + useResolvedCompanyId + useResolvedUserId', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /useOptIn\b/);
  assert.match(src, /useResolvedCompanyId\b/);
  assert.match(src, /useResolvedUserId\b/);
});

test('Bulletin UI: index.tsx calls usePluginData for bulletin.byCycle', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /usePluginData[\s\S]*['"]bulletin\.byCycle['"]/);
});

test('Bulletin UI: index.tsx renders all 6 child components', () => {
  const src = readSrc('index.tsx');
  for (const tag of ['<Masthead', '<ActionInbox', '<DepartmentSection', '<StandingNumbersPanel', '<LineageFooter']) {
    assert.ok(src.includes(tag), `index.tsx missing ${tag}`);
  }
});

test('Bulletin UI: masthead.tsx contains literal "The Bulletin"', () => {
  assert.ok(readSrc('masthead.tsx').includes('The Bulletin') || /The\s*<span/.test(readSrc('masthead.tsx')));
});

test('Bulletin UI: masthead.tsx contains Vol. I / 06:30 ET / Editor-in-Chief / Operations Cycle', () => {
  const src = readSrc('masthead.tsx');
  assert.ok(/Vol\./.test(src), 'missing Vol.');
  assert.ok(src.includes('06:30 ET'), 'missing 06:30 ET');
  assert.ok(src.includes('Editor-in-Chief'), 'missing Editor-in-Chief');
  assert.ok(src.includes('Operations Cycle'), 'missing Operations Cycle');
});

test('Bulletin UI: masthead.tsx contains "Auto-compiled"', () => {
  assert.ok(readSrc('masthead.tsx').includes('Auto-compiled'));
});

test('Bulletin UI: action-inbox.tsx uses usePluginAction bulletin.action.approve', () => {
  assert.match(readSrc('action-inbox.tsx'), /usePluginAction[\s\S]*['"]bulletin\.action\.approve['"]/);
});

test('Bulletin UI: action-inbox.tsx uses usePluginAction bulletin.action.decline', () => {
  assert.match(readSrc('action-inbox.tsx'), /usePluginAction[\s\S]*['"]bulletin\.action\.decline['"]/);
});

test('Bulletin UI: action-inbox.tsx uses useHostNavigation().linkProps — no raw <a href', () => {
  const src = readSrc('action-inbox.tsx');
  assert.match(src, /useHostNavigation\(\)\.linkProps/);
  assert.ok(!/<a\s+href=/.test(src), 'action-inbox.tsx must not use raw <a href=');
});

test('Bulletin UI: department-section.tsx uses a dropcap className (sketch ll. 159-163)', () => {
  assert.match(readSrc('department-section.tsx'), /dropcap/);
});

test('Bulletin UI: lineage-footer.tsx uses the 8-column thread grid class', () => {
  const src = readSrc('lineage-footer.tsx');
  assert.match(src, /clarity-bulletin-(thread|lineage)/);
});

test('Bulletin UI: no source file in src/ui/surfaces/bulletin/ uses raw fetch(', () => {
  for (const f of REQUIRED_FILES) {
    const src = readSrc(f);
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not use raw fetch() — use usePluginData / usePluginAction`);
  }
});
