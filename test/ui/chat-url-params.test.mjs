// test/ui/chat-url-params.test.mjs
//
// Plan 04.2-01 Task 5 / Plan 04.2-02 Task 2 / Plan 04.2-03 Task 2 — source-grep
// contract tests for the chat surface deep-link handling (RCB-03). Same
// source-grep idiom as chat-shell.test.mjs / chat-actions-row.test.mjs (Node's
// runner does not load .tsx).
//
// Plan 04.2-03 CARRIER SWAP: the empirical carrier-survival probe on live
// Countermoves 2026-05-23 (CARRIER=URL_HASH in scripts/probes/carrier-survival.
// mjs) proved that `window.location.hash` SURVIVES the host's
// useHostNavigation().navigate() -> useHostLocation() handoff while both the
// `?query` tail (stripped by `resolveHref`) and the `{ state }` argument
// (stripped before reaching react-router's useNavigate; history.state.usr ===
// null on the live host) DO NOT. The new contract is therefore: the encoded
// payload rides entirely in the URL fragment (`#h=<encodeURIComponent(btoa(JSON.
// stringify(payload)))>`); the chat surface destructures `hash` from
// useHostLocation() and passes it to parseChatDeepLink along with search and
// state (search + state are kept as defensive fallbacks; the canonical channel
// is hash). The cross-hook round-trip is pinned by
// continue-in-chat-deeplink-contract.test.mjs (E1-E6).
//
// After consumption the link is cleared (replace navigation to bare pathname)
// so a refresh does not re-trigger the dialog. The live DOM is covered by the
// Task 5 operator drill.

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

test('chat/index.tsx: reads the host location (useHostLocation) — destructures hash (the load-bearing channel)', () => {
  const c = code(readChat('index.tsx'));
  // The repo convention is useHostLocation() — there is no react-router
  // useSearchParams in this codebase. Plan 04.2-03: the load-bearing channel
  // is now `hash` (URL_HASH per the Task 1 probe — survives the host's
  // resolveHref step that strips `?query`, AND survives the host wrapper that
  // strips `{ state }` before reaching react-router's useNavigate). The
  // destructure includes `hash`; `search` and `state` are kept as defensive
  // fallbacks but no longer carry the canonical payload.
  assert.match(c, /useHostLocation/, 'chat surface reads useHostLocation');
  assert.match(c, /\bhash\b/, 'destructures hash from the host location (the load-bearing channel per 04.2-03 probe)');
  // hash MUST be threaded through to parseChatDeepLink (carrier swap).
  assert.match(
    c,
    /parseChatDeepLink\(\s*\{[\s\S]{0,160}\bhash\b/,
    'hash is passed to parseChatDeepLink',
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

test('Test 5 — DISPATCH (GAP-RCB-03-DISPATCH, Plan 04.2-04): existing-topic deep link sets employee from the roster', () => {
  // Live-host evidence (Countermoves COU-2215 drill, 2026-05-23, 0.9.2):
  //
  //   [chat-mount @1666ms] payload = {
  //     topic: 'e7b7fee8-b432-4422-8a1c-1bb3043a9d43',
  //     comment: 'df18ae28-34f8-4d59-9344-945667d19c73',
  //     employee: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984',
  //   }
  //   [replace-nav fired @2365ms] hash cleared — consume effect DID run
  //
  // Carrier + read both worked end-to-end, but the chat shell renders entirely
  // conditionally on the `employee` React state being non-null (index.tsx line
  // 683: `{!employee ? <empty> : <thread>}`). 0.9.2's existing-topic dispatch
  // calls setTopic with `employeeAgentId: ''` and never calls setEmployee, so
  // the surface stays on its empty state even though the topic dispatched.
  //
  // GAP-RCB-03-DISPATCH fix: look up the employee in chat.roster by
  // `link.employee` UUID and call setEmployee(matched). Thread link.employee
  // into setTopic's employeeAgentId so the topic-strip / context-rail can
  // reconcile from the topic side too.
  const c = code(readChat('index.tsx'));
  assert.match(
    c,
    /setEmployee\(/,
    'existing-topic dispatch sets employee (the chat shell renders conditionally on employee)',
  );
  assert.match(
    c,
    /employeeAgentId:\s*link\.employee/,
    'setTopic uses link.employee for employeeAgentId (was hardcoded empty in 0.9.2)',
  );
  assert.match(
    c,
    /usePluginData[<\s][^)]*['"]chat\.roster['"]/,
    'chat.roster is fetched in ChatPageBody so the dispatch can look up the employee',
  );
  assert.match(
    c,
    /link\.employee/,
    'the deep-link employee field is read on the dispatch path',
  );
});

test('Test 6 — DISPATCH-RACE (GAP-RCB-03-DISPATCH, Plan 04.2-04): consume defers when roster has not loaded', () => {
  // Without deferring, the deep link arrives at chat mount before the
  // chat.roster fetch returns. The roster lookup misses (roster === null),
  // setEmployee never runs, the consume-once guard marks the link consumed,
  // replace-nav clears the hash, and the surface settles on the empty state
  // with no way to retry. The fix gates the consume on roster availability
  // for the existing-topic+employee case: if `link.employee && roster === null`
  // and the fetch is still loading, return early WITHOUT setting the
  // consumed-once ref. The effect re-fires when the roster data arrives (it
  // is in the effect's dep array) and consume completes correctly.
  const c = code(readChat('index.tsx'));
  // The effect's dep array carries `roster` (or the rosterQuery — both reads
  // refire on data arrival).
  assert.match(
    c,
    /(\[[^\]]*\broster\b[^\]]*\]|\[[^\]]*\brosterData\b[^\]]*\])/,
    'the deep-link effect depends on roster so it re-fires when chat.roster resolves',
  );
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
