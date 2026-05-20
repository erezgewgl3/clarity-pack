// test/ui/chat-index-on-dialog-success.test.mjs
//
// Plan 04.1-10 Task 4 — source-grep contract tests for the drill fix #1
// rewire (onDialogSuccess now sets pendingTaskCard + fires the creation
// toast). The Plan 04.1-09 build did `void result; setRefreshKey(k=>k+1)`
// — discarded the dialog payload entirely; the inline task card never lit
// up and cold tasks vanished with zero operator confirmation.
//
// SOURCE-GREP idiom (Node doesn't load .tsx).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const INDEX = readFileSync(path.join(CHAT_DIR, 'index.tsx'), 'utf8');
const DIALOG = readFileSync(
  path.join(CHAT_DIR, 'true-task', 'true-task-dialog.tsx'),
  'utf8',
);
const COMPOSER = readFileSync(path.join(CHAT_DIR, 'composer.tsx'), 'utf8');
const THREAD = readFileSync(path.join(CHAT_DIR, 'message-thread.tsx'), 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// onDialogSuccess REWRITTEN — sets pendingTaskCard for promote, NOT for cold
// ---------------------------------------------------------------------------

test('index.tsx (Plan 04.1-10): onDialogSuccess receives { issueId, mode, title }', () => {
  const c = code(INDEX);
  // The success payload now carries title (added in Task 1 to the dialog).
  assert.match(
    c,
    /onDialogSuccess[\s\S]*?\(\s*result:\s*\{[\s\S]*?title:\s*string/,
    'onDialogSuccess signature must accept title in the result payload',
  );
});

test('index.tsx (Plan 04.1-10): onDialogSuccess sets pendingTaskCard for PROMOTE mode', () => {
  const c = code(INDEX);
  // The promote-branch writes setPendingTaskCard with issueId + title.
  assert.match(
    c,
    /result\.mode\s*===\s*['"]promote['"]/,
    'must gate on result.mode === "promote"',
  );
  assert.match(
    c,
    /setPendingTaskCard\(\s*\{\s*issueId:\s*result\.issueId,\s*title:[\s\S]*?\}\s*\)/,
    'promote branch must call setPendingTaskCard with issueId + title',
  );
});

test('index.tsx (Plan 04.1-10): onDialogSuccess does NOT set pendingTaskCard for COLD mode', () => {
  const c = code(INDEX);
  // Static analysis: there is exactly ONE setPendingTaskCard({issueId, ...})
  // call inside onDialogSuccess and it lives inside the promote branch.
  // The cold path has NO inline-card surface by spec (no marker comment).
  // The setPendingTaskCard inside the promote branch must be its only
  // value-setting call in onDialogSuccess; clears (set to null) elsewhere
  // are fine.
  const onDialogSuccessBlock = c.match(
    /const onDialogSuccess[\s\S]*?\[employee,\s*showToast\][\s\S]*?\);/,
  );
  assert.ok(onDialogSuccessBlock, 'onDialogSuccess must exist');
  // Inside onDialogSuccess, the only setPendingTaskCard with a value is
  // the one in the promote branch.
  const setPendingCalls = onDialogSuccessBlock[0].match(
    /setPendingTaskCard\([^)]*\)/g,
  );
  assert.ok(setPendingCalls, 'onDialogSuccess must call setPendingTaskCard');
  assert.equal(
    setPendingCalls.length,
    1,
    'onDialogSuccess must call setPendingTaskCard exactly once (promote branch only)',
  );
});

test('index.tsx (Plan 04.1-10): onDialogSuccess fires showToast with "Task created" prefix for BOTH modes', () => {
  const c = code(INDEX);
  // The toast call is OUTSIDE the `if (result.mode === 'promote')` gate so
  // both modes fire it. The message string contains "Task created".
  assert.match(
    c,
    /showToast\(\s*\{[\s\S]*?Task created[\s\S]*?\}\s*\)/,
    'showToast must include the "Task created" message prefix',
  );
});

test('index.tsx (Plan 04.1-10): creation toast uses an 8-char short-id slice', () => {
  const c = code(INDEX);
  // result.issueId.slice(0, 8) is the v1 short-id until 4.2 wires the proper
  // BEAAA-NNN identifier through the success result.
  assert.match(
    c,
    /result\.issueId[\s\S]*?\.slice\(\s*0,\s*8\s*\)/,
    'must slice the first 8 chars of issueId for the short-id',
  );
});

test('index.tsx (Plan 04.1-10): creation toast duration is 6000ms (longer than the default 4s)', () => {
  const c = code(INDEX);
  // The toast lingers a touch longer so the operator catches it even when
  // their attention is on the thread.
  assert.match(
    c,
    /showToast\([\s\S]*?duration:\s*6000/,
    'creation toast duration must be 6000ms',
  );
});

// ---------------------------------------------------------------------------
// pendingTaskCard state lifted to index.tsx
// ---------------------------------------------------------------------------

test('index.tsx (Plan 04.1-10): pendingTaskCard state declared at the ChatPageBody level', () => {
  const c = code(INDEX);
  // The state lives next to activeTasks (one source of truth shared with
  // MessageThread via Composer).
  assert.match(
    c,
    /useState<\s*\{\s*issueId:\s*string;\s*title:\s*string;\s*\}\s*\|\s*null\s*>/,
    'pendingTaskCard typed state must be declared',
  );
  assert.match(c, /setPendingTaskCard/, 'setter must be exposed');
});

test('index.tsx (Plan 04.1-10): pendingTaskCard cleared on topic switch', () => {
  const c = code(INDEX);
  const block = c.match(/handleSelectTopic[\s\S]*?\}\,\s*\[\]\)/);
  assert.ok(block, 'handleSelectTopic must exist');
  assert.match(
    block[0],
    /setPendingTaskCard\(\s*null\s*\)/,
    'handleSelectTopic must clear pendingTaskCard (defensive against stale state)',
  );
});

test('index.tsx (Plan 04.1-10): pendingTaskCard cleared on employee switch', () => {
  const c = code(INDEX);
  const block = c.match(/handleSelectEmployee[\s\S]*?\}\,\s*\[\]\)/);
  assert.ok(block, 'handleSelectEmployee must exist');
  assert.match(
    block[0],
    /setPendingTaskCard\(\s*null\s*\)/,
    'handleSelectEmployee must clear pendingTaskCard',
  );
});

test('index.tsx (Plan 04.1-10): pendingTaskCard threaded through to Composer', () => {
  const c = code(INDEX);
  // The prop passes from ChatPageBody → Composer → MessageThread.
  assert.match(
    c,
    /pendingTaskCard=\{pendingTaskCard\}/,
    'index.tsx must pass pendingTaskCard down to <Composer>',
  );
  assert.match(
    c,
    /onPendingResolved=\{handlePendingResolved\}/,
    'index.tsx must pass the onPendingResolved callback down',
  );
});

// ---------------------------------------------------------------------------
// Marker-arrival clear path (MessageThread → onPendingResolved → index.tsx)
// ---------------------------------------------------------------------------

test('index.tsx (Plan 04.1-10): handlePendingResolved clears pendingTaskCard when issueIds match', () => {
  const c = code(INDEX);
  assert.match(
    c,
    /handlePendingResolved[\s\S]*?cur\s*&&\s*cur\.issueId\s*===\s*issueId\s*\?\s*null\s*:\s*cur/,
    'handlePendingResolved must clear only when the pending issueId matches',
  );
});

test('message-thread.tsx (Plan 04.1-10): fires onPendingResolved when a marker matches the pending issueId', () => {
  const c = code(THREAD);
  // The effect scans `ordered` for a marker comment whose first capture
  // equals pendingTaskCard.issueId, then calls onPendingResolved(pendingId).
  assert.match(
    c,
    /onPendingResolved\(\s*pendingId\s*\)/,
    'message-thread must call onPendingResolved with the pending id when matched',
  );
  // The regex pattern matches the marker shape.
  assert.match(
    c,
    /\/\^Task created — \(\[\^,\]\+\), assigned to/,
    'message-thread must scan for the "Task created" marker regex',
  );
});

test('composer.tsx (Plan 04.1-10): onPendingResolved prop threaded through', () => {
  // Composer is a transparent pass-through layer for the new callback.
  assert.match(
    COMPOSER,
    /onPendingResolved/,
    'composer must accept and forward onPendingResolved',
  );
});

// ---------------------------------------------------------------------------
// Dialog success payload includes title (the missing piece in Plan 04.1-09)
// ---------------------------------------------------------------------------

test('true-task-dialog.tsx (Plan 04.1-10): onSuccess result type includes title', () => {
  assert.match(
    DIALOG,
    /onSuccess:\s*\(result:\s*\{\s*issueId:\s*string;\s*mode:\s*TrueTaskDialogMode;\s*title:\s*string\s*\}\)/,
    'dialog onSuccess type must include title',
  );
});

test('true-task-dialog.tsx (Plan 04.1-10): submit passes trimmedTitle to onSuccess', () => {
  const c = code(DIALOG);
  assert.match(
    c,
    /onSuccess\(\s*\{\s*issueId,\s*mode,\s*title:\s*trimmedTitle\s*\}\s*\)/,
    'onSuccess invocation must pass title: trimmedTitle',
  );
});

// ---------------------------------------------------------------------------
// DETAILS field is now a <textarea> (markup change required for Task 2a CSS)
// ---------------------------------------------------------------------------

test('true-task-dialog.tsx (Plan 04.1-10): DETAILS control is a <textarea> (was <input type="text">)', () => {
  const c = code(DIALOG);
  // The Plan 04.1-08 build had <input id="true-task-dialog-details" type="text">.
  // The new control is <textarea id="true-task-dialog-details">.
  assert.match(
    c,
    /<textarea[\s\S]*?id="true-task-dialog-details"/,
    'DETAILS control must be a <textarea>',
  );
  // And the old single-line <input> for DETAILS must be gone.
  assert.doesNotMatch(
    c,
    /<input[^>]*?id="true-task-dialog-details"/,
    'the legacy <input id="true-task-dialog-details"> must be gone',
  );
});
