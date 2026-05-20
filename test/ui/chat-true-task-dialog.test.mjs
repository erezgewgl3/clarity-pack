// test/ui/chat-true-task-dialog.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the dual-mode dialog.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TT_DIR = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'chat',
  'true-task',
);
const SRC = readFileSync(path.join(TT_DIR, 'true-task-dialog.tsx'), 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('true-task-dialog.tsx: file exists', () => {
  assert.ok(existsSync(path.join(TT_DIR, 'true-task-dialog.tsx')));
});

test('true-task-dialog.tsx: takes a mode prop with cold | promote values', () => {
  // The exported TrueTaskDialogMode type must list both modes; the
  // component must consume `mode` as a prop.
  assert.match(SRC, /TrueTaskDialogMode\s*=\s*['"]cold['"]\s*\|\s*['"]promote['"]/);
  const c = code(SRC);
  assert.match(c, /mode:\s*TrueTaskDialogMode/);
});

test('true-task-dialog.tsx: COLD mode — heading "Create a task"', () => {
  assert.match(SRC, /Create a task/);
});

test('true-task-dialog.tsx: PROMOTE mode — heading "Promote message to task"', () => {
  assert.match(SRC, /Promote message to task/);
});

test('true-task-dialog.tsx: title input is autoFocused', () => {
  assert.match(SRC, /autoFocus/, 'title field must autofocus on open');
});

test('true-task-dialog.tsx: topic dropdown defaults to Standalone for cold mode', () => {
  // The Standalone (null) option is the first <option> in the topic select.
  assert.match(SRC, /Standalone \(not linked to any topic\)/);
});

test('true-task-dialog.tsx: cold topic value is null (not a stringified id)', () => {
  const c = code(SRC);
  // The select state holds string | null; the Standalone option's value is
  // empty string and the onChange falls back to null.
  assert.match(c, /setTopicIssueId\(e\.target\.value\s*\|\|\s*null\)/);
});

test('true-task-dialog.tsx: COLD topic helper copy', () => {
  assert.match(
    SRC,
    /Standalone tasks won&apos;t appear in any topic|Standalone tasks won['’]t appear in any topic/,
    'helper hint visible in COLD mode',
  );
});

test('true-task-dialog.tsx: PROMOTE topic helper copy', () => {
  assert.match(SRC, /will appear in the source topic/i);
});

test('true-task-dialog.tsx: ⌘+Enter / Ctrl+Enter submits the dialog', () => {
  const c = code(SRC);
  assert.match(c, /e\.metaKey\s*\|\|\s*e\.ctrlKey/);
  // The implementation uses the inverse short-circuit `if (e.key !== 'Enter') return;`
  // so the substring "'Enter'" is asserted via a broader match.
  assert.match(c, /e\.key\s*[!=]==?\s*['"]Enter['"]/);
  assert.match(c, /onCreate/);
});

test('true-task-dialog.tsx: PROMOTE mode renders the FROM-MESSAGE block', () => {
  // The FROM-MESSAGE block uses the new class names and the FROM THIS MESSAGE
  // eyebrow text.
  assert.match(SRC, /true-task-dialog-from-msg/);
  assert.match(SRC, /FROM THIS MESSAGE/);
});

test('true-task-dialog.tsx: PROMOTE mode is gated on `mode === "promote"`', () => {
  const c = code(SRC);
  // Source-render guarded — the FROM-MESSAGE block does not render in COLD.
  assert.match(c, /mode\s*===?\s*['"]promote['"]/);
});

test('true-task-dialog.tsx: submit passes topicIssueId (null for cold) + sourceCommentId', () => {
  const c = code(SRC);
  // The createTrueTask call references both fields.
  assert.match(c, /topicIssueId,/);
  assert.match(c, /sourceCommentId,/);
});

test('true-task-dialog.tsx: PROMOTE submit uses the source body; COLD falls back to details', () => {
  const c = code(SRC);
  // body argument is `sourceMessage.body` in promote mode and
  // `details.trim() || trimmedTitle` (the cold-side fallback) otherwise.
  assert.match(c, /sourceMessage\.body/);
  assert.match(c, /details\.trim\(\)/);
});

test('true-task-dialog.tsx: footer kbd hint copy mentions ⌘⏎ create + Esc cancel', () => {
  assert.match(SRC, /create/);
  assert.match(SRC, /cancel/);
  assert.match(SRC, /<kbd>⌘<\/kbd>/);
  assert.match(SRC, /<kbd>Esc<\/kbd>/);
});

test('true-task-dialog.tsx: no raw fetch / no dangerouslySetInnerHTML', () => {
  const c = code(SRC); // strip comments (the header mentions "raw fetch")
  assert.doesNotMatch(c, /fetch\(/);
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/);
});
