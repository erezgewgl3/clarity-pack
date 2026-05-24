// test/ui/chat-active-tasks-issue-link.test.mjs
//
// Plan 04.2-05 D3 — source-grep regression for the right-rail "Active Tasks
// Owned" row click target. The 2026-05-24 drill captured Path 2's operator
// typing issue URLs by hand because the rail rows were not clickable. The
// fix wraps the row title in a host-routed anchor to
// `/<companyPrefix>/issues/<identifier>` (MemPalace runbook
// `paperclip-issue-url-pattern`). The RefChip primitive also became a
// clickable anchor for the same URL; that's pinned separately by
// chat-ref-chip-issue-link.test.mjs.
//
// Same source-grep idiom as chat-url-params.test.mjs (Node's runner does not
// load .tsx; we read the source file as text and assert.match against the
// stripped code).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');

function readChat(rel) {
  return readFileSync(path.join(CHAT_DIR, rel), 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('active-tasks-owned.tsx exists', () => {
  assert.ok(existsSync(path.join(CHAT_DIR, 'active-tasks-owned.tsx')));
});

test('D3 — active-tasks-owned.tsx imports useHostNavigation for SPA anchor wiring', () => {
  const c = code(readChat('active-tasks-owned.tsx'));
  assert.match(
    c,
    /useHostNavigation/,
    'imports useHostNavigation (SCAF-09 — never raw <a href>)',
  );
});

test('D3 — active-tasks-owned.tsx derives companyPrefix from the current pathname', () => {
  const c = code(readChat('active-tasks-owned.tsx'));
  assert.match(
    c,
    /extractCompanyPrefixFromPathname/,
    'derives companyPrefix via the canonical extractor (matches Reader/Chat surfaces)',
  );
});

test('D3 — active-tasks-owned.tsx wraps the row title in /<prefix>/issues/<identifier>', () => {
  const c = code(readChat('active-tasks-owned.tsx'));
  // The link target uses the canonical pattern; the identifier is
  // interpolated into the URL.
  assert.match(
    c,
    /linkProps\(\s*`\/\$\{companyPrefix\}\/issues\/\$\{[^}]+\}`\s*\)/,
    'the row title anchor targets /<companyPrefix>/issues/<identifier>',
  );
});

test('D3 — active-tasks-owned.tsx falls back to plain text when companyPrefix is unavailable', () => {
  const c = code(readChat('active-tasks-owned.tsx'));
  // Guard against rendering a broken `/undefined/issues/...` link — a
  // ternary on `companyPrefix && t.identifier` selects between the anchor
  // and a plain <span>.
  assert.match(
    c,
    /companyPrefix\s*&&\s*t\.identifier/,
    'anchor is rendered only when companyPrefix AND identifier are both available',
  );
});
