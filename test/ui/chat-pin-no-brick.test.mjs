// test/ui/chat-pin-no-brick.test.mjs
//
// Plan 250529 Task 1 — source-grep contract tests pinning the NEVER-BRICK
// invariant for the chat Pin/Unpin (and the legacy inline Promote) affordance.
//
// 2026-05-29 root-cause: the Pin button is disabled={busy}; onPin set busy=true,
// awaited pin(), and only reset busy in finally(). Under box load the chat.pin
// ACK was measured at 45s+ (write persisted server-side regardless), so `busy`
// stayed true and the button bricked on cursor:not-allowed (the operator's
// "round X"). Fix: optimistic marker + toast fire immediately, pin() is NOT
// awaited inside the busy window, and busy resets via BOTH .finally() AND an 8s
// safety setTimeout so a slow/hung ACK can never leave the button stuck.
//
// SOURCE-GREP idiom (Node doesn't load .tsx) — matches chat-pin-toggle-toast.test.mjs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MT = readFileSync(
  path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'message-thread.tsx'),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Slice the source between two anchor substrings (start inclusive). */
function sliceBetween(src, startAnchor, endAnchor) {
  const start = src.indexOf(startAnchor);
  assert.notEqual(start, -1, `anchor not found: ${startAnchor}`);
  const end = src.indexOf(endAnchor, start);
  assert.notEqual(end, -1, `end anchor not found: ${endAnchor}`);
  return src.slice(start, end);
}

const C = code(MT);
// onPin runs from its declaration up to the component's JSX return.
const ON_PIN = sliceBetween(C, 'const onPin = React.useCallback', 'return (');
// onPromote runs from its declaration up to the onPin declaration.
const ON_PROMOTE = sliceBetween(
  C,
  'const onPromote = React.useCallback',
  'const onPin = React.useCallback',
);

test('onPin: has an 8s setTimeout busy-reset safety guard', () => {
  assert.match(
    ON_PIN,
    /setTimeout\(\s*\(\)\s*=>\s*setBusy\(false\)\s*,\s*8000\s*\)/,
    'onPin must arm a setTimeout(() => setBusy(false), 8000) safety guard',
  );
});

test('onPin: flips the optimistic marker BEFORE invoking pin() (no wait on ACK)', () => {
  const optimisticIdx = ON_PIN.indexOf('setOptimisticPinned(nextPinned)');
  const pinCallIdx = ON_PIN.search(/\bpin\(\{/);
  assert.notEqual(optimisticIdx, -1, 'setOptimisticPinned(nextPinned) must be present');
  assert.notEqual(pinCallIdx, -1, 'pin({ ... }) action call must be present');
  assert.ok(
    optimisticIdx < pinCallIdx,
    'setOptimisticPinned must fire BEFORE the pin() action call (optimistic update)',
  );
});

test('onPin: does NOT await pin() inside the busy window (fire-and-forget .then chain)', () => {
  // The action call must be a .then()/.catch()/.finally() chain, never `await pin(`.
  assert.doesNotMatch(
    ON_PIN,
    /await\s+pin\(\{/,
    'onPin must NOT await pin() — a slow ACK must not block the busy window',
  );
  assert.match(ON_PIN, /\bpin\(\{[\s\S]*?\}\)\s*\.then\(/, 'pin() must be a .then() chain');
});

test('onPin: .finally() clears the safety timeout AND resets busy', () => {
  assert.match(
    ON_PIN,
    /\.finally\(\s*\(\)\s*=>\s*\{[\s\S]*?clearTimeout\(safety\)[\s\S]*?setBusy\(false\)[\s\S]*?\}\)/,
    'onPin .finally() must clearTimeout(safety) and setBusy(false)',
  );
});

test('onPin: a confirmed { error } reverts the optimistic marker', () => {
  assert.match(
    ON_PIN,
    /setOptimisticPinned\(!nextPinned\)/,
    'on a confirmed error result, onPin must revert via setOptimisticPinned(!nextPinned)',
  );
});

test('onPromote: legacy inline path also has the 8s setTimeout busy-reset safety guard', () => {
  assert.match(
    ON_PROMOTE,
    /setTimeout\(\s*\(\)\s*=>\s*setBusy\(false\)\s*,\s*8000\s*\)/,
    'onPromote inline path must arm a setTimeout(() => setBusy(false), 8000) safety guard',
  );
  assert.match(
    ON_PROMOTE,
    /clearTimeout\(safety\)/,
    'onPromote finally must clearTimeout(safety)',
  );
});
