// test/ui/chat-url-params.test.mjs
//
// Plan 04.2-01 Task 5 — source-grep contract tests for the chat surface
// deep-link URL-param handling (RCB-03). Same source-grep idiom as
// chat-shell.test.mjs / chat-actions-row.test.mjs (Node's runner does not
// load .tsx). The chat surface learns to honour the params the Reader's
// ContinueInChatButton (Task 3) hands it:
//
//   ?topic=<id>            — switch to that topic
//   ?topic&comment=<id>    — switch + scroll the comment into view + flash
//   ?newTopic=1&seed...    — open a pre-seeded New Topic dialog; create
//                            threads originIssueId to chat.topic.create
//   ?employee=<agentId>    — select that employee
//
// After consumption the params are cleared (router.replace) so a refresh
// does not re-trigger the dialog. The live DOM is covered by the Task 8
// operator drill.

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

test('chat/index.tsx: reads the host location search params (useHostLocation)', () => {
  const c = code(readChat('index.tsx'));
  // The repo convention is useHostLocation().search — there is no react-router
  // useSearchParams in this codebase.
  assert.match(c, /useHostLocation/, 'chat surface reads useHostLocation');
  assert.match(c, /\.search\b/, 'reads the location.search query string');
});

test('Test 1 — TOPIC-SWITCH: a ?topic= param drives a topic switch', () => {
  const c = code(readChat('index.tsx'));
  assert.match(c, /['"]topic['"]/, 'parses the topic param');
  // The consumed topic param feeds the topic-switch path (setTopic).
  assert.match(c, /setTopic\(/, 'a topic param results in a setTopic call');
});

test('Test 2 — NEW-TOPIC-SEEDED: ?newTopic=1 opens a pre-seeded New Topic dialog', () => {
  const c = code(readChat('index.tsx'));
  assert.match(c, /newTopic/, 'parses the newTopic param');
  assert.match(c, /seedTitle/, 'parses the seedTitle param');
  assert.match(c, /seedBody/, 'parses the seedBody param');
  assert.match(c, /originIssueId/, 'parses the originIssueId param');
  // The seeded create threads originIssueId into chat.topic.create.
  assert.match(
    c,
    /createTopic\([\s\S]{0,400}originIssueId/,
    'chat.topic.create is invoked with originIssueId from the URL',
  );
});

test('Test 2b — the seeded values are URL-decoded before use (decodeURIComponent)', () => {
  const c = code(readChat('index.tsx'));
  // URLSearchParams.get() already decodes, OR an explicit decodeURIComponent
  // is used — either satisfies the decode contract. URLSearchParams counts.
  assert.match(
    c,
    /URLSearchParams|decodeURIComponent/,
    'seed params are decoded (URLSearchParams or decodeURIComponent)',
  );
});

test('Test 3 — COMMENT-FLASH: ?comment= scrolls + flash-highlights the target comment', () => {
  const c = code(readChat('index.tsx'));
  assert.match(c, /['"]comment['"]/, 'parses the comment param');
  // The comment param drives a scrollIntoView + the flash-highlight class.
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
