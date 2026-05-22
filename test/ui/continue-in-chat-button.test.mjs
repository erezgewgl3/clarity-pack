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

test('Test 5 — existing-topic click navigates with ?topic= and &comment=', () => {
  const c = code(readSrc());
  // The existing-topic deep link carries topic + comment.
  assert.match(c, /\?topic=/, 'existing-topic href carries ?topic=');
  assert.match(c, /comment=/, 'existing-topic href carries comment=');
});

test('Test 6 — new-topic-needed click navigates with newTopic=1, originIssueId= and encoded seed', () => {
  const c = code(readSrc());
  assert.match(c, /newTopic=1/, 'new-topic-needed href carries newTopic=1');
  assert.match(c, /originIssueId=/, 'new-topic-needed href carries originIssueId=');
  assert.match(c, /seedTitle=/, 'new-topic-needed href carries seedTitle=');
  assert.match(c, /seedBody=/, 'new-topic-needed href carries seedBody=');
});

test('continue-in-chat-button.tsx: seedTitle + seedBody are encodeURIComponent-encoded (>= 2 calls)', () => {
  const c = code(readSrc());
  const matches = c.match(/encodeURIComponent/g) ?? [];
  assert.ok(matches.length >= 2, `expected >= 2 encodeURIComponent calls, found ${matches.length}`);
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
