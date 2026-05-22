// test/ui/chat-url-params.test.mjs
//
// Plan 04.2-01 Task 5 / Plan 04.2-02 Task 2 — source-grep contract tests for
// the chat surface deep-link handling (RCB-03). Same source-grep idiom as
// chat-shell.test.mjs / chat-actions-row.test.mjs (Node's runner does not
// load .tsx).
//
// Plan 04.2-02 GREEN UPDATE: the chat surface NO LONGER hand-parses
// individual `?topic=` / `?comment=` / `?newTopic=` / seed params with
// URLSearchParams; it delegates to the SHARED parseChatDeepLink contract
// helper (src/ui/surfaces/chat/deep-link.mjs) which reads BOTH the
// structured `state` channel (the load-bearing one — the GAP-RCB-03 fix)
// AND the `?query` string (refresh / copy-link fallback). The greps below
// pin the NEW contract — assertions about the resolved ChatDeepLink fields
// (topic, comment, newTopic, seedTitle, seedBody, originIssueId) being
// consumed downstream, not about which specific URLSearchParams call site
// extracted them. The cross-hook round-trip itself is pinned by
// continue-in-chat-deeplink-contract.test.mjs.
//
// After consumption the link is cleared (router.replace) so a refresh does
// not re-trigger the dialog. The live DOM is covered by the Task 4 operator
// drill.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const STYLES_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'styles');

function readChat(rel) {
  return readFileSync(path.join(CHAT_DIR, rel), 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('chat/index.tsx: reads the host location (useHostLocation) — both search AND state channels', () => {
  const c = code(readChat('index.tsx'));
  // The repo convention is useHostLocation() — there is no react-router
  // useSearchParams in this codebase. The new contract reads BOTH the
  // structured `state` (load-bearing) AND `search` (refresh fallback).
  assert.match(c, /useHostLocation/, 'chat surface reads useHostLocation');
  assert.match(c, /\bsearch\b/, 'destructures search from the host location');
  assert.match(c, /\bstate\b/, 'destructures state from the host location (the load-bearing channel)');
  // Both channels feed parseChatDeepLink (the SHARED contract helper).
  assert.match(
    c,
    /parseChatDeepLink\(\s*\{[\s\S]{0,80}search[\s\S]{0,80}state|parseChatDeepLink\(\s*\{[\s\S]{0,80}state[\s\S]{0,80}search/,
    'both search and state are passed to parseChatDeepLink',
  );
});

test('Test 1 — TOPIC-SWITCH: a topic deep link drives a topic switch', () => {
  const c = code(readChat('index.tsx'));
  // The resolved ChatDeepLink's `topic` field feeds the topic-switch path.
  assert.match(c, /link\.topic/, 'reads the resolved deep-link topic field');
  assert.match(c, /setTopic\(/, 'a topic deep link results in a setTopic call');
});

test('Test 2 — NEW-TOPIC-SEEDED: a newTopic deep link opens a pre-seeded New Topic dialog', () => {
  const c = code(readChat('index.tsx'));
  // The resolved ChatDeepLink fields drive the seeded dialog.
  assert.match(c, /link\.newTopic/, 'branches on the resolved newTopic flag');
  assert.match(c, /link\.seedTitle/, 'reads the resolved seedTitle');
  assert.match(c, /link\.seedBody/, 'reads the resolved seedBody');
  assert.match(c, /link\.originIssueId/, 'reads the resolved originIssueId');
  // The seeded create threads originIssueId into chat.topic.create.
  assert.match(
    c,
    /createTopic\([\s\S]{0,400}originIssueId/,
    'chat.topic.create is invoked with originIssueId from the deep link',
  );
});

test('Test 2b — the deep-link seed values arrive URL-decoded (parseChatDeepLink contract)', () => {
  const c = code(readChat('index.tsx'));
  // The hand-rolled URLSearchParams / decodeURIComponent paths are gone —
  // the chat surface delegates to parseChatDeepLink, which decodes the
  // `?query` channel via URLSearchParams internally and returns plain
  // decoded strings (pinned by continue-in-chat-deeplink-contract.test.mjs
  // D2 + D5).
  assert.match(c, /parseChatDeepLink/, 'delegates decoding to parseChatDeepLink');
  // No raw URLSearchParams / decodeURIComponent in the deep-link path —
  // every consumer reads the resolved link fields, not raw params.
  assert.doesNotMatch(c, /new URLSearchParams\(/, 'no hand-rolled URLSearchParams in the chat surface (delegated)');
});

test('Test 3 — COMMENT-FLASH: a comment deep-link field scrolls + flash-highlights', () => {
  const c = code(readChat('index.tsx'));
  assert.match(c, /link\.comment/, 'reads the resolved deep-link comment field');
  // The comment field drives a scrollIntoView + the flash-highlight class.
  assert.match(c, /scrollIntoView/, 'the target comment is scrolled into view');
  assert.match(c, /flash-highlight/, 'the target comment gets the flash-highlight class');
});

test('Test 3b — message-thread.tsx gives each comment bubble a stable DOM id for the scroll target', () => {
  const c = code(readChat('message-thread.tsx'));
  // A comment scroll target needs a queryable id — `msg-<commentId>`.
  assert.match(c, /id=\{`msg-\$\{|id=\{['"]msg-|msg-\$\{.*commentId/, 'comment bubbles carry an id keyed on commentId');
});

test('Test 4 — PARAMS-CLEARED: params are cleared via a replace navigation after consumption', () => {
  const c = code(readChat('index.tsx'));
  // After consuming the deep-link params the surface clears them so a refresh
  // does not re-open the dialog — navigate(pathname, { replace: true }).
  assert.match(c, /replace:\s*true/, 'params cleared via a replace navigation');
});

test('chat.css: defines a .flash-highlight rule + a @keyframes clarity-flash', () => {
  const css = readFileSync(path.join(STYLES_DIR, 'chat.css'), 'utf8');
  assert.match(css, /flash-highlight/, 'a .flash-highlight rule exists');
  assert.match(css, /@keyframes\s+clarity-flash/, 'a @keyframes clarity-flash exists');
});

test('chat/index.tsx: the seeded New Topic dialog renders with pre-filled controlled inputs', () => {
  const c = code(readChat('index.tsx'));
  // The seeded dialog surface — a queryable region with the seeded title/body
  // as controlled React input values (T-04.2-01-03: never dangerouslySetInnerHTML).
  assert.match(c, /new-topic-dialog|newTopicDialog|seed.?dialog/i, 'a seeded New Topic dialog region renders');
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/, 'seed values render as controlled React text only');
});

test('chat/index.tsx: deep-link handling does not regress the existing handleNewTopic flow', () => {
  const c = code(readChat('index.tsx'));
  // The GAP-1 chat-shell contract must still hold.
  assert.match(c, /const\s+result\s*=\s*await\s+createTopic\(/, 'handleNewTopic still captures the create result');
  assert.match(c, /setCreateError\(/, 'a returned { error } is still surfaced');
});

test('chat surface files exist', () => {
  assert.ok(existsSync(path.join(CHAT_DIR, 'index.tsx')));
  assert.ok(existsSync(path.join(CHAT_DIR, 'message-thread.tsx')));
});
