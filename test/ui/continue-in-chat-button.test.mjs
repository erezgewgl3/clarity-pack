// test/ui/continue-in-chat-button.test.mjs
//
// Plan 04.2-01 Task 3 — source-grep contract tests for the Reader-header
// Continue-in-chat primitive (RCB-01). Node's test runner cannot load .tsx
// (no React render harness in this repo — see test/ui/reader-view.test.mjs +
// test/ui/chat-actions-row.test.mjs), so these tests assert on the rendered
// source strings: the four lineage routes, the topic-itself / loading
// null-render, the disabled NO_ASSIGNEE state, and the encodeURIComponent +
// deep-link query-string construction.
//
// The component's behaviour is pinned by the routing table in the Plan
// <design_source>; the operator drill (Task 8) covers the live DOM.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader');
const FILE = path.join(READER_DIR, 'continue-in-chat-button.tsx');

function readSrc() {
  return readFileSync(FILE, 'utf8');
}
function code(src) {
  // strip block + line comments so greps assert on the code only.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('continue-in-chat-button.tsx: file exists at the expected path', () => {
  assert.ok(existsSync(FILE), 'src/ui/surfaces/reader/continue-in-chat-button.tsx must exist');
});

test('continue-in-chat-button.tsx: exports ContinueInChatButton as a named function', () => {
  assert.match(readSrc(), /export function ContinueInChatButton/, 'ContinueInChatButton named export');
});

test('Test 1 — existing-topic route renders an enabled PRIMARY button with "Continue in chat" label', () => {
  const c = code(readSrc());
  // Branches on route 'existing-topic'.
  assert.match(c, /'existing-topic'|"existing-topic"/, 'handles the existing-topic route');
  // The PRIMARY gold weight — matches actions-row.tsx `btn primary`.
  assert.match(c, /btn primary|btn.{0,3}primary/, 'renders a PRIMARY (gold) button');
  assert.match(c, /Continue in chat/, 'the label copy is "Continue in chat ..."');
});

test('Test 2 — new-topic-needed route (no error) renders an enabled PRIMARY button', () => {
  const c = code(readSrc());
  assert.match(c, /'new-topic-needed'|"new-topic-needed"/, 'handles the new-topic-needed route');
});

test('Test 3 — topic-itself route renders nothing (returns null)', () => {
  const c = code(readSrc());
  assert.match(c, /'topic-itself'|"topic-itself"/, 'handles the topic-itself route');
  // The component must be able to return null (for topic-itself + loading).
  assert.match(c, /return null/, 'returns null for the topic-itself / loading branches');
});

test('Test 4 — NO_ASSIGNEE renders a DISABLED button with the locked tooltip', () => {
  const c = code(readSrc());
  assert.match(c, /NO_ASSIGNEE/, 'branches on the NO_ASSIGNEE error');
  assert.match(c, /disabled/, 'renders a disabled button for NO_ASSIGNEE');
  assert.match(
    readSrc(),
    /Assign this issue to an employee before opening chat\./,
    'the locked NO_ASSIGNEE tooltip copy appears verbatim',
  );
});

test('Test 5 — existing-topic click delegates to the shared deep-link contract', () => {
  // Plan 04.2-02 GAP-RCB-03 fix: the literal `?topic=`/`?comment=` href
  // build moved into the SHARED src/ui/surfaces/chat/deep-link.mjs
  // (buildChatDeepLink). continue-in-chat-button.tsx now delegates by
  // passing { route: 'existing-topic', topicIssueId, sourceCommentId, ... }.
  // The literal-query-string round-trip is pinned by
  // continue-in-chat-deeplink-contract.test.mjs D1 (existing-topic).
  const c = code(readSrc());
  assert.match(c, /buildChatDeepLink/, 'delegates to the shared buildChatDeepLink');
  assert.match(c, /'existing-topic'|"existing-topic"/, 'forwards the existing-topic route');
  assert.match(c, /topicIssueId/, 'forwards topicIssueId to the contract helper');
  assert.match(c, /sourceCommentId/, 'forwards sourceCommentId to the contract helper');
});

test('Test 6 — new-topic-needed click delegates with originIssueId + seed payload', () => {
  // Plan 04.2-02 GAP-RCB-03 fix: literal `newTopic=1`/`seedTitle=` query
  // construction moved to the shared deep-link helper. Pinned end-to-end by
  // continue-in-chat-deeplink-contract.test.mjs D2 (new-topic round-trip).
  const c = code(readSrc());
  assert.match(c, /buildChatDeepLink/, 'delegates to the shared buildChatDeepLink');
  assert.match(c, /'new-topic-needed'|"new-topic-needed"/, 'forwards the new-topic-needed route');
  assert.match(c, /seedTitle/, 'forwards seedTitle to the contract helper');
  assert.match(c, /seedBody/, 'forwards seedBody to the contract helper');
  assert.match(c, /originIssueId/, 'forwards originIssueId to the contract helper');
});

test('continue-in-chat-button.tsx: navigate() uses URL_HASH carrier (Plan 04.2-03 GAP-RCB-03-CARRIER fix)', () => {
  // Plan 04.2-03 carrier swap: the live Countermoves probe 2026-05-23 proved
  // the host strips BOTH the `?query` tail (resolveHref) AND the `{ state }`
  // argument (host wrapper around react-router's useNavigate). The fragment
  // (`#h=<encoded>`) survives end-to-end because RFC 3986 fragments never
  // reach the server and the host's path-routing/resolveHref cannot touch
  // them. The Continue button now calls `nav.navigate(deepLink.to)` with the
  // encoded payload baked into `to` — NO second `state:` argument.
  const c = code(readSrc());
  // The navigate call must NOT pass a `state:` option (carrier swap).
  assert.doesNotMatch(
    c,
    /navigate\([\s\S]{0,160}state\s*:/,
    'navigate() must NOT carry a state argument (Plan 04.2-03 URL_HASH carrier)',
  );
  // The navigate target is `deepLink.to` — the fragment-bearing URL.
  assert.match(
    c,
    /navigate\(\s*deepLink\.to\s*\)/,
    'navigate(deepLink.to) — the fragment-bearing URL carries the payload',
  );
});

test('continue-in-chat-button.tsx: invokes the chat.openForIssue data handler', () => {
  const c = code(readSrc());
  assert.match(c, /chat\.openForIssue/, 'reads the chat.openForIssue route');
});

test('continue-in-chat-button.tsx: navigates via useHostNavigation linkProps (no raw <a href> / no useNavigate)', () => {
  const c = code(readSrc());
  // Repo convention (breadcrumb.tsx / SCAF-09): host router, not react-router useNavigate.
  assert.match(c, /useHostNavigation/, 'uses the host navigation hook');
});

test('continue-in-chat-button.tsx: no raw fetch / no dangerouslySetInnerHTML (T-04.2-01-03)', () => {
  const c = code(readSrc());
  assert.doesNotMatch(c, /fetch\(/, 'no raw fetch — data flows through the bridge');
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/, 'seed values render as React text only');
});
