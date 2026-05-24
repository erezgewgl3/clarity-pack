// test/ui/chat-ref-chip-issue-link.test.mjs
//
// Plan 04.2-05 D3 — source-grep regression for the RefChip primitive's
// click target. The chip is rendered inside the Reader's anchored-to ref
// cards, the right-rail Active Tasks Owned rows, and the inline TASK
// CREATED card. Once resolved AND companyPrefix is available, the chip is
// an anchor to /<companyPrefix>/issues/<identifier> (MemPalace runbook
// `paperclip-issue-url-pattern`). Pre-resolve, the chip stays a span so
// no broken `/undefined/issues/...` link can render.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHIP_PATH = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'primitives',
  'ref-chip.tsx',
);

function readChip() {
  return readFileSync(CHIP_PATH, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('D3 — ref-chip.tsx imports useHostNavigation + extractCompanyPrefixFromPathname', () => {
  const c = code(readChip());
  assert.match(c, /useHostNavigation/, 'imports useHostNavigation');
  assert.match(
    c,
    /extractCompanyPrefixFromPathname/,
    'imports the canonical companyPrefix extractor',
  );
});

test('D3 — ref-chip.tsx renders an anchor to /<companyPrefix>/issues/<id> when resolved', () => {
  const c = code(readChip());
  assert.match(
    c,
    /linkProps\(\s*`\/\$\{companyPrefix\}\/issues\/\$\{card\.id\}`\s*\)/,
    'anchor target is /<companyPrefix>/issues/<card.id>',
  );
});

test('D3 — ref-chip.tsx falls back to a span when companyPrefix is unavailable', () => {
  const c = code(readChip());
  // The `if (!companyPrefix) { return <span ...>` branch guards against a
  // broken anchor target.
  assert.match(
    c,
    /if\s*\(\s*!companyPrefix\s*\)\s*\{[\s\S]{0,400}<span\s+className="clarity-ref-chip"/,
    'pre-prefix branch falls back to a span',
  );
});

test('D3 — ref-chip.tsx keeps the loading state as a span (never a broken anchor)', () => {
  const c = code(readChip());
  // The early-return loading branch must NOT be an <a> — it has no resolved
  // card.id yet.
  assert.match(
    c,
    /loading\s*\|\|\s*userIdLoading\s*\|\|\s*!card[\s\S]{0,200}<span\s+className="clarity-ref-chip clarity-ref-chip--loading"/,
    'loading branch renders a span, not an anchor',
  );
});
