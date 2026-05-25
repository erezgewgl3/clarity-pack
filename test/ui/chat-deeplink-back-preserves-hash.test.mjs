// test/ui/chat-deeplink-back-preserves-hash.test.mjs
//
// Plan 05-07 Task 2 — D-13 closure.
//
// The Reader → Chat deep-link consume effect at
// src/ui/surfaces/chat/index.tsx used to call
// `nav.navigate(pathname, { replace: true })` AFTER consuming the URL
// fragment payload — which dropped the `#h=<base64-JSON>` from the
// address bar. The 1.0.0-rc.7 drill captured the operator gotcha:
// after clicking Reader→Chat, hitting Browser-Back returned the operator
// to a chat surface with no hash, then forward landed on a hash-less
// chat URL — the deep-link state was destroyed. The fix removes the
// replace-nav and leans on the existing `consumedDeepLinkRef` guard
// (keyed on JSON.stringify(link)) for the consume-once invariant; the
// hash sits in the URL untouched, Back/Forward preserve it, and a
// page-refresh re-renders the same destination.
//
// Source-grep idiom (Node's test runner does not load .tsx).

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
  'chat',
  'index.tsx',
);

function rawSrc() {
  return readFileSync(FILE, 'utf8');
}

// ---- D-13 T1 — the replace-nav has been removed --------------------------

test('D-13 T1 — chat/index.tsx no longer calls nav.navigate(pathname, { replace: true })', () => {
  const src = rawSrc();
  const matches =
    src.match(/nav\.navigate\(\s*pathname\s*,\s*\{\s*replace\s*:\s*true\s*\}\s*\)/g) ?? [];
  assert.equal(
    matches.length,
    0,
    'expected zero `nav.navigate(pathname, { replace: true })` calls (D-13: Back must preserve hash)',
  );
});

// ---- D-13 T2 — consumedDeepLinkRef guard remains ------------------------

test('D-13 T2 — consumedDeepLinkRef remains as the consume-once invariant', () => {
  const src = rawSrc();
  const matches = src.match(/consumedDeepLinkRef/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `expected at least 2 references to consumedDeepLinkRef (declaration + use); found ${matches.length}`,
  );
});

// ---- D-13 T3 — explanatory comment cites Plan 05-07 + D-13 --------------

test('D-13 T3 — deep-link consume effect cites Plan 05-07 / D-13 in source comments', () => {
  const src = rawSrc();
  // Both anchors should appear near the deep-link consume effect (the file
  // is long; presence is sufficient — locality is confirmed by manual code
  // review at PR time, since a stray "D-13" elsewhere would still indicate
  // documentation of the closure).
  assert.match(src, /05-07/, 'expected Plan 05-07 reference in source');
  assert.match(src, /D-13/, 'expected D-13 reference in source comments');
});

// ---- D-13 T4 — URL_HASH carrier contract files are NOT touched ----------

test('D-13 T4 — deep-link.mjs + deep-link.d.mts files exist (Plan 04.2-03 carrier lock)', () => {
  const deepLinkMjs = path.resolve(
    HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'deep-link.mjs',
  );
  const deepLinkDts = path.resolve(
    HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'deep-link.d.mts',
  );
  // We only check existence here — the contract test at
  // continue-in-chat-deeplink-contract.test.mjs pins the carrier shape.
  // This assertion catches the case where Plan 05-07 accidentally
  // touches / deletes the carrier file.
  assert.ok(readFileSync(deepLinkMjs, 'utf8').includes('buildChatDeepLink'));
  assert.ok(readFileSync(deepLinkDts, 'utf8').includes('parseChatDeepLink'));
});
