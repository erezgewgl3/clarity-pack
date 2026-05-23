// test/ui/reverse-topics-link.test.mjs
//
// Plan 04.2-01 Task 6 — source-grep contract tests for the Reader-header
// reverse-topics list (RCB-06). Same source-grep idiom as
// reader-view.test.mjs (Node's runner does not load .tsx). When an issue has
// N chat topics started from it (issue.reader's topicsForIssue field), the
// Reader header surfaces `<N> conversations about this issue ↗`; a click
// opens a popover; a popover row click navigates into chat. The live DOM is
// covered by the Task 8 operator drill.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader');
const FILE = path.join(READER_DIR, 'reverse-topics-link.tsx');
function readSrc() {
  return readFileSync(FILE, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('reverse-topics-link.tsx: file exists and exports ReverseTopicsLink', () => {
  assert.ok(existsSync(FILE), 'src/ui/surfaces/reader/reverse-topics-link.tsx must exist');
  assert.match(readSrc(), /export function ReverseTopicsLink/, 'ReverseTopicsLink named export');
});

test('Test 1 — renders nothing when topicsForIssue is empty', () => {
  const c = code(readSrc());
  // A length-0 list renders null — the header shows nothing.
  assert.match(
    c,
    /length\s*===?\s*0|length\s*<\s*1|!\s*[a-zA-Z]*[Tt]opics|return null/,
    'an empty topicsForIssue list renders nothing',
  );
});

test('Test 2 — renders "<N> conversations about this issue" for a non-empty list', () => {
  assert.match(
    readSrc(),
    /conversations about this issue/,
    'the locked reverse-list label copy appears',
  );
});

test('Test 2b — the count is derived from topicsForIssue.length (not hardcoded)', () => {
  const c = code(readSrc());
  assert.match(c, /topicsForIssue/, 'reads the topicsForIssue prop');
  assert.match(c, /\.length/, 'the N count is derived from .length');
});

test('Test 3 — a popover row click navigates via the shared deep-link contract (URL_HASH carrier)', () => {
  // Plan 04.2-03 GAP-RCB-03-CARRIER fix: ReverseTopicsLink uses the SAME
  // carrier as the Continue button — the URL fragment (`#h=<encoded>`).
  // The Task 1 probe on Countermoves 2026-05-23 proved this is the only
  // channel the host preserves end-to-end. navigate() takes ONE argument
  // (deepLink.to) — no `state:` option.
  const c = code(readSrc());
  assert.match(c, /buildTopicDeepLink|buildChatDeepLink/, 'delegates to the shared deep-link helper');
  assert.match(c, /useHostNavigation|navigate|linkProps/, 'navigates via the host navigation hook');
  // The navigate call must NOT pass a `state:` option (carrier swap).
  assert.doesNotMatch(
    c,
    /navigate\([\s\S]{0,160}state\s*:/,
    'navigate() must NOT carry a state argument (Plan 04.2-03 URL_HASH carrier)',
  );
  // navigate(deepLink.to) — the fragment-bearing URL is the carrier.
  assert.match(
    c,
    /navigate\(\s*deepLink\.to\s*\)/,
    'navigate(deepLink.to) — fragment-bearing URL carries the payload',
  );
});

test('reverse-topics-link.tsx: takes companyPrefix + topicsForIssue props', () => {
  const c = code(readSrc());
  assert.match(c, /companyPrefix/, 'receives the companyPrefix prop');
  assert.match(c, /topicsForIssue/, 'receives the topicsForIssue prop');
});

test('reverse-topics-link.tsx: renders untrusted text only (no dangerouslySetInnerHTML)', () => {
  assert.doesNotMatch(code(readSrc()), /dangerouslySetInnerHTML/);
});

test('Reader index.tsx mounts <ReverseTopicsLink> next to <ContinueInChatButton>', () => {
  const readerSrc = readFileSync(path.join(READER_DIR, 'index.tsx'), 'utf8');
  assert.match(readerSrc, /<ReverseTopicsLink\b/, 'Reader renders <ReverseTopicsLink />');
  // The import may pull a type alias alongside the component — match the
  // named-import + module-specifier without pinning a single-binding shape.
  assert.match(
    readerSrc,
    /import\s*\{[^}]*\bReverseTopicsLink\b[^}]*\}\s*from\s*['"]\.\/reverse-topics-link/,
    'Reader imports ReverseTopicsLink from ./reverse-topics-link',
  );
  // The two header affordances live in the same action row.
  assert.match(
    readerSrc,
    /<ContinueInChatButton[\s\S]*<ReverseTopicsLink|<ReverseTopicsLink[\s\S]*<ContinueInChatButton/,
    'ReverseTopicsLink sits in the header alongside ContinueInChatButton',
  );
});
