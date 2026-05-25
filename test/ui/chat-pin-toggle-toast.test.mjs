// test/ui/chat-pin-toggle-toast.test.mjs
//
// Plan 05-06 Task 1 (item a, D-11) — source-grep contract tests pinning the
// silent-toggle invariant for the chat Pin/Unpin affordance.
//
// D-11 (CONTEXT.md): Pin/Unpin = silent toggle + clarity-pack toast.
// Mirrors `chat.topic.archive` toggle shape from Plan 04.1-05.
// - Success path: fires showToast({ message: 'Message pinned' | 'Message unpinned' }).
// - The inline success-only setFeedback({ kind: 'ok', text: '⚑ Pinned' }) is REMOVED.
// - Error path: setFeedback({ kind: 'error', text: 'Could not pin ...' }) is PRESERVED
//   (errors stay loud — a toast that auto-dismisses is not a safe channel for failure).
//
// CTT-07 invariant: chat.pin worker handler MUST NOT call ctx.issues.update.
//
// SOURCE-GREP idiom (Node doesn't load .tsx) — matches chat-url-params.test.mjs
// + chat-context-rail.test.mjs.

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
const PIN_HANDLER = readFileSync(
  path.join(ROOT, 'src', 'worker', 'handlers', 'chat-pin.ts'),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('message-thread.tsx: imports useToast from the toast primitive', () => {
  const c = code(MT);
  assert.match(
    c,
    /import\s*\{[^}]*useToast[^}]*\}\s*from\s*['"][^'"]*primitives\/toast/,
    'message-thread must import useToast from src/ui/primitives/toast.tsx',
  );
});

test('message-thread.tsx: Pin success path calls showToast with literal "Message pinned" AND "Message unpinned"', () => {
  const c = code(MT);
  // Both literals must appear in a showToast call. The branch direction
  // (pinned vs unpinned) is computed from the toggle-target boolean.
  assert.match(
    c,
    /showToast\(\{[^}]*['"]Message pinned['"]/,
    'must call showToast({ message: "Message pinned" }) on the pin branch',
  );
  assert.match(
    c,
    /showToast\(\{[^}]*['"]Message unpinned['"]/,
    'must call showToast({ message: "Message unpinned" }) on the unpin branch',
  );
});

test('message-thread.tsx: D-11 SILENT-TOGGLE — success-only setFeedback("⚑ Pinned") is REMOVED', () => {
  const c = code(MT);
  // The Plan 04.1-09 success line used setFeedback({ kind: 'ok', text: '⚑ Pinned' }).
  // D-11 silent-toggle: this line MUST be gone. Match flexibly across quote
  // styles and whitespace.
  assert.doesNotMatch(
    c,
    /setFeedback\(\{[^}]*kind:\s*['"]ok['"][^}]*text:\s*['"]⚑\s*Pinned['"]/,
    'success-path setFeedback("⚑ Pinned") must be REMOVED (D-11 silent-toggle invariant)',
  );
});

test('message-thread.tsx: D-11 ERROR-LOUD — error-path setFeedback("Could not pin") is PRESERVED', () => {
  const c = code(MT);
  // Errors stay loud — the inline error UI must remain alongside the toast
  // path so a transient toast that auto-dismisses doesn't leave the operator
  // without recourse.
  assert.match(
    c,
    /setFeedback\(\{[^}]*kind:\s*['"]error['"][^}]*Could not pin/,
    'error-path setFeedback("Could not pin ...") must remain present',
  );
});

test('message-thread.tsx: D-11 NO modal / NO confirm dialog on Pin/Unpin', () => {
  const c = code(MT);
  // The silent-toggle invariant forbids any window.confirm() prompt and any
  // dialog mount on the Pin/Unpin branches. window.confirm is a global hazard
  // (the chat surface doesn't currently use it anywhere); a regression that
  // introduced it would land in the same callback. Source-grep guards.
  assert.doesNotMatch(
    c,
    /window\.confirm\(/,
    'no window.confirm() call introduced',
  );
});

test('CTT-07: chat-pin.ts worker handler contains zero ctx.issues.update call sites', () => {
  const stripped = code(PIN_HANDLER);
  const calls = stripped.match(/ctx\.issues\.update\(/g) || [];
  assert.equal(
    calls.length,
    0,
    'CTT-07: chat.pin must never mutate public.issues (host-issue invariant)',
  );
});
