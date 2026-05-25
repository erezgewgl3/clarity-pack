// test/ui/ref-chip-peek.test.mjs
//
// Plan 05-05 Task 2 (D-08 + D-09) — ref-chip hover peek card. Adds a
// glance-able preview (title + status + owner display name + first-line
// description excerpt) to BEAAA-NNN references. The CLICK navigation
// contract (anchor → /<companyPrefix>/issues/<identifier>) stays unchanged.
//
// Same source-grep idiom as other UI contract tests (Node 24's strip-types
// loads .ts but not .tsx). Runtime DOM behaviour is verified live during the
// Phase 5 closure drill (the <human-check> row of the plan).
//
// What this test PINS:
//   - The peek popover element exists with className 'clarity-ref-chip-peek'
//     and role='tooltip' and data-clarity-region='ref-chip-peek'.
//   - Hover open/close handlers wired (onMouseEnter / onMouseLeave) on the
//     wrap element.
//   - Touch long-press fallback wired (onTouchStart / onTouchEnd).
//   - Click navigation contract preserved — nav.linkProps still builds
//     /<prefix>/issues/<id> via useHostNavigation.
//   - Peek content references all three new fields: card.title, card.status,
//     card.ownerName, card.descriptionExcerpt.
//   - Owner null fallback is the LITERAL 'unassigned' — NEVER a UUID.
//   - No dangerouslySetInnerHTML (R3 invariant).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'ref-chip.tsx');

function read() {
  return readFileSync(FILE, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('ref-chip.tsx file exists', () => {
  assert.ok(existsSync(FILE), 'src/ui/primitives/ref-chip.tsx must exist');
});

test('D-08 — anchor navigation contract preserved (nav.linkProps to /<prefix>/issues/<id>)', () => {
  const src = read();
  assert.match(src, /nav\.linkProps\(`\/\$\{companyPrefix\}\/issues\/\$\{card\.id\}`\)/, 'click target unchanged');
});

test('D-08 — peek opens on mouseEnter and closes on mouseLeave', () => {
  const src = code(read());
  assert.match(src, /onMouseEnter/, 'wrap binds onMouseEnter');
  assert.match(src, /onMouseLeave/, 'wrap binds onMouseLeave');
});

test('D-08 — touch long-press fallback wired (onTouchStart + onTouchEnd)', () => {
  const src = code(read());
  assert.match(src, /onTouchStart/, 'long-press handler binds onTouchStart');
  assert.match(src, /onTouchEnd/, 'long-press handler binds onTouchEnd');
});

test('D-09 — peek popover renders with role="tooltip" and clarity-ref-chip-peek class', () => {
  const src = read();
  assert.match(src, /clarity-ref-chip-peek/, 'peek class is clarity-ref-chip-peek');
  assert.match(src, /role=["']tooltip["']/, 'peek has role="tooltip"');
  assert.match(src, /data-clarity-region=["']ref-chip-peek["']/, 'peek has data-clarity-region');
});

test('D-09 — peek content references card.title + card.status + card.ownerName + card.descriptionExcerpt', () => {
  const src = code(read());
  assert.match(src, /card\.title/, 'peek references card.title');
  assert.match(src, /card\.status/, 'peek references card.status');
  assert.match(src, /card\.ownerName/, 'peek references card.ownerName');
  assert.match(src, /card\.descriptionExcerpt/, 'peek references card.descriptionExcerpt');
});

test('D-09 — owner null fallback is the LITERAL "unassigned" string (NO UUID leak)', () => {
  const src = code(read());
  assert.match(src, /['"]unassigned['"]/, 'falls back to literal "unassigned" when ownerName is null');
  // The forbidden form: pre-fix would have been `card.ownerUserId ?? 'unassigned'`
  // which would have leaked the UUID. Make sure we read ownerName, not ownerUserId,
  // for the peek display.
  assert.doesNotMatch(
    src,
    /clarity-ref-chip-peek[\s\S]{0,600}ownerUserId/,
    'peek must NOT reference ownerUserId — that would leak the UUID',
  );
});

test('PRIM-02 — when descriptionExcerpt is null, peek excerpt section does NOT render', () => {
  const src = code(read());
  // The render guard: `card.descriptionExcerpt ? <…/> : null` or equivalent.
  assert.match(
    src,
    /descriptionExcerpt\s*[?&]/,
    'peek excerpt section is conditionally rendered on descriptionExcerpt presence',
  );
});

test('R3 — NO dangerouslySetInnerHTML in ref-chip.tsx', () => {
  // Comments are stripped before grepping so a comment mention doesn't trip us.
  const src = code(read());
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
});

test('ref-chip.tsx still uses useResolvedUserId (Plan 02-09 invariant preserved)', () => {
  const src = read();
  assert.match(
    src,
    /import\s*\{[^}]*\buseResolvedUserId\b[^}]*\}\s*from/,
    'useResolvedUserId import preserved',
  );
});

test('RefCardData extended with ownerName + descriptionExcerpt optional fields (src/shared/types.ts)', () => {
  const typesPath = path.resolve(HERE, '..', '..', 'src', 'shared', 'types.ts');
  const typesSrc = readFileSync(typesPath, 'utf8');
  assert.match(typesSrc, /ownerName\?:\s*string\s*\|\s*null/, 'ownerName?: string | null on RefCardData');
  assert.match(typesSrc, /descriptionExcerpt\?:\s*string\s*\|\s*null/, 'descriptionExcerpt?: string | null on RefCardData');
});
