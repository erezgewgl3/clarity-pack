// test/ui/clarity-surface-header.test.mjs
//
// Plan 05-08 Task 5 — source-grep contract tests for ClaritySurfaceHeader
// and its cross-surface mount points (Reader / Situation Room / Bulletin /
// Chat). Source-grep style mirrors test/ui/chat-archive-panel.test.mjs;
// runtime behavior (toast on TrueTaskDialog onSuccess) is exercised
// implicitly via the contract gates below (showToast call site present,
// no window keydown listener registered).
//
// CSH1: header renders a button labeled `+ Create task`.
// CSH2: clicking the button sets dialogOpen state (setDialogOpen(true)).
// CSH3: surface prop is propagated as data-clarity-surface-header-context.
// CSH4: NO window addEventListener for keydown — the chat actions-row
//       owns the `T` shortcut; the shared header is click-only.
// CSH5: On TrueTaskDialog onSuccess, the header calls showToast with
//       message 'Task created' (D-17 cross-surface toast,
//       checker BLOCKER 4).
// CSH6: All four non-chat surfaces (reader / situation-room / bulletin)
//       mount <ClaritySurfaceHeader>; chat surface ALSO mounts one (the
//       global affordance, paired with its actions-row T-button).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const HEADER = path.join(ROOT, 'src', 'ui', 'primitives', 'clarity-surface-header.tsx');
const SRC = readFileSync(HEADER, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODE = code(SRC);

test('CSH-file: clarity-surface-header.tsx exists at expected path', () => {
  assert.ok(existsSync(HEADER));
});

test('CSH-export: exports ClaritySurfaceHeader as a named function', () => {
  assert.match(SRC, /export function ClaritySurfaceHeader/);
});

// ---- CSH1 — button text is `+ Create task` -------------------------------

test('CSH1: header renders a button labeled `+ Create task`', () => {
  assert.match(SRC, /\+ Create task/);
  assert.match(CODE, /<button[\s\S]*?className=["']clarity-cold-task-btn["']/);
});

// ---- CSH2 — click toggles dialogOpen state -------------------------------

test('CSH2: button click sets dialogOpen state via setDialogOpen(true)', () => {
  assert.match(CODE, /setDialogOpen/);
  assert.match(CODE, /onClick=\{\(\)\s*=>\s*setDialogOpen\(true\)\}/);
});

// ---- CSH3 — surface prop surfaces via data-attribute ---------------------

test('CSH3: surface prop is propagated via data-clarity-surface-header-context', () => {
  assert.match(CODE, /data-clarity-surface-header-context=\{surface\}/);
});

// ---- CSH4 — NO window keydown listener (no T-key collision) --------------

test('CSH4: ClaritySurfaceHeader does NOT bind a window keydown listener', () => {
  // No window.addEventListener('keydown', ...) anywhere in the file.
  assert.doesNotMatch(CODE, /window\.addEventListener\(\s*['"]keydown['"]/);
});

// ---- CSH5 — showToast called with 'Task created' on dialog success ------

test('CSH5: on TrueTaskDialog onSuccess, showToast fires `Task created`', () => {
  // useToast() destructured + showToast invoked with the literal.
  assert.match(CODE, /useToast\(\)/);
  assert.match(CODE, /showToast\(\s*\{\s*message:\s*['"]Task created['"]/);
});

// ---- CSH-cold — dialog always opens in cold mode -------------------------

test('CSH-cold: TrueTaskDialog mounted with mode="cold" (no sourceMessage)', () => {
  assert.match(CODE, /<TrueTaskDialog[\s\S]*?mode=["']cold["']/);
});

// ---- CSH6 — all 4 surface index.tsx files mount ClaritySurfaceHeader -----

const SURFACE_INDEXES = {
  reader: path.join(ROOT, 'src', 'ui', 'surfaces', 'reader', 'index.tsx'),
  'situation-room': path.join(ROOT, 'src', 'ui', 'surfaces', 'situation-room', 'index.tsx'),
  bulletin: path.join(ROOT, 'src', 'ui', 'surfaces', 'bulletin', 'index.tsx'),
  chat: path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'index.tsx'),
};

for (const [name, p] of Object.entries(SURFACE_INDEXES)) {
  test(`CSH6: ${name}/index.tsx mounts <ClaritySurfaceHeader>`, () => {
    const s = readFileSync(p, 'utf8');
    assert.match(s, /<ClaritySurfaceHeader/);
    assert.match(s, new RegExp(`surface=["']${name}["']`));
  });
}

// ---- CSH-no-dup-toast: chat/index.tsx no longer wraps a duplicate ToastProvider

test('CSH-no-dup-toast: chat/index.tsx removes the duplicate <ToastProvider> wrapper (Task 5 D-17)', () => {
  const s = readFileSync(SURFACE_INDEXES.chat, 'utf8');
  // Strip comments first since the file documents the removal in a comment.
  const c = code(s);
  assert.doesNotMatch(c, /<ToastProvider>/);
  assert.doesNotMatch(c, /<\/ToastProvider>/);
});

// ---- CSH-import: chat keeps useToast import (still used by ChatPageBody) -

test('CSH-import: chat/index.tsx still imports useToast (ChatPageBody uses it)', () => {
  const s = readFileSync(SURFACE_INDEXES.chat, 'utf8');
  assert.match(s, /useToast/);
});
