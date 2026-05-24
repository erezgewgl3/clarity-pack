// test/ui/chat-inline-task-card-issue-link.test.mjs
//
// Plan 04.2-05 D3 — source-grep regression for the inline TASK CREATED card
// click target. The 2026-05-24 drill captured Path 2's operator typing issue
// URLs by hand because the inline card was not clickable. The fix wraps the
// card's title in a host-routed anchor to `/<companyPrefix>/issues/<identifier>`
// (MemPalace runbook `paperclip-issue-url-pattern`). The RefChip primitive on
// the meta row also became a clickable anchor under D3; that's pinned by
// chat-ref-chip-issue-link.test.mjs.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_PATH = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'chat',
  'true-task',
  'inline-task-card.tsx',
);

function readCard() {
  return readFileSync(CARD_PATH, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('inline-task-card.tsx exists', () => {
  assert.ok(existsSync(CARD_PATH));
});

test('D3 — inline-task-card.tsx imports useHostNavigation', () => {
  const c = code(readCard());
  assert.match(
    c,
    /useHostNavigation/,
    'imports useHostNavigation (SCAF-09 — never raw <a href>)',
  );
});

test('D3 — inline-task-card.tsx derives companyPrefix from the current pathname', () => {
  const c = code(readCard());
  assert.match(
    c,
    /extractCompanyPrefixFromPathname/,
    'derives companyPrefix the same way as RefChip + Reader',
  );
});

test('D3 — inline-task-card.tsx wraps the title in /<prefix>/issues/<identifier>', () => {
  const c = code(readCard());
  assert.match(
    c,
    /linkProps\(\s*`\/\$\{companyPrefix\}\/issues\/\$\{identifier\}`\s*\)/,
    'the title anchor targets /<companyPrefix>/issues/<identifier>',
  );
});

test('D3 — inline-task-card.tsx falls back to plain text on loading title OR missing companyPrefix', () => {
  const c = code(readCard());
  // hasTitleLink predicate gates on all three:
  //   companyPrefix non-empty AND identifier non-null AND title resolved.
  assert.match(
    c,
    /hasTitleLink\s*=\s*companyPrefix\s*&&\s*identifier\s*&&\s*title\s*!==\s*null/,
    'anchor renders only when companyPrefix + identifier + resolved title are all available',
  );
});
