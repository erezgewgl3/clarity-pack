// test/ui/chat-actions-row.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the new actions row.
// SOURCE-GREP idiom (matches the established chat-message-thread.test.mjs
// pattern — Node doesn't load .tsx, so we assert on rendered source strings).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'actions-row.tsx'), 'utf8');

function code(src) {
  // strip comments so we grep the code only.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('actions-row.tsx: file exists at the expected path', () => {
  assert.ok(
    existsSync(path.join(CHAT_DIR, 'actions-row.tsx')),
    'src/ui/surfaces/chat/actions-row.tsx must exist',
  );
});

test('actions-row.tsx: exports ChatActionsRow as a named function component', () => {
  assert.match(SRC, /export function ChatActionsRow/, 'must export ChatActionsRow');
});

test('actions-row.tsx: renders the "+ Create task" primary button', () => {
  assert.match(SRC, /\+ Create task/, '+ Create task button copy must render');
  assert.match(SRC, /btn primary/, 'the button must have the primary class for gold styling');
});

test('actions-row.tsx: + Create task button click invokes onCreateTask', () => {
  const c = code(SRC);
  assert.match(
    c,
    /onClick=\{onCreateTask\}/,
    '+ Create task button must wire onClick to the onCreateTask prop',
  );
});

test('actions-row.tsx: renders the "+ New topic" ghost button', () => {
  assert.match(SRC, /\+ New topic/, '+ New topic button copy must render');
  assert.match(SRC, /btn ghost/, 'the button must have the ghost class');
});

test('actions-row.tsx: + New topic button click invokes onNewTopic', () => {
  const c = code(SRC);
  assert.match(
    c,
    /onClick=\{onNewTopic\}/,
    '+ New topic button must wire onClick to the onNewTopic prop',
  );
});

test('actions-row.tsx: mounts the DiagnosticsToggle (moved from .head-actions)', () => {
  const c = code(SRC);
  assert.match(c, /import\s*\{?\s*DiagnosticsToggle/, 'must import DiagnosticsToggle');
  assert.match(c, /<DiagnosticsToggle\s+/, 'must render <DiagnosticsToggle>');
});

test('actions-row.tsx: Diagnostics passes armed + onToggle from props', () => {
  const c = code(SRC);
  assert.match(c, /armed=\{diagnosticsOn\}/);
  assert.match(c, /onToggle=\{onDiagnosticsToggle\}/);
});

test('actions-row.tsx: registers global ⌘+T / Ctrl+T keyboard shortcut', () => {
  const c = code(SRC);
  // The handler checks the "t" / "T" key + metaKey || ctrlKey, then calls
  // preventDefault and onCreateTask().
  assert.match(c, /e\.metaKey\s*\|\|\s*e\.ctrlKey/, 'modifier-key check');
  assert.match(c, /e\.key\s*[!=]==?\s*['"][tT]['"]/, 'key check on "t" or "T"');
  assert.match(c, /onCreateTask\(\)/, 'shortcut handler calls onCreateTask()');
  assert.match(c, /e\.preventDefault\(\)/, 'preventDefault prevents browser new-tab');
});

test('actions-row.tsx: ⌘T shortcut respects active input/textarea/contenteditable', () => {
  const c = code(SRC);
  // The handler skips when the focused element is an input, textarea, or
  // contentEditable — operators typing should keep their keystroke.
  assert.match(c, /INPUT|TEXTAREA|isContentEditable/, 'must skip when focus is in an editable');
});

test('actions-row.tsx: kbd-hint surface keyboard shortcut label', () => {
  // The visible kbd hint reads "⌘T new task" (or similar — at minimum kbd
  // tags for ⌘ and T are present).
  assert.match(SRC, /kbd-hint/, 'a .kbd-hint span is rendered for the shortcut surface');
  assert.match(SRC, /<kbd>⌘<\/kbd>/, 'kbd tag for ⌘');
  assert.match(SRC, /<kbd>T<\/kbd>/, 'kbd tag for T');
});

test('actions-row.tsx: spacer pushes diagnostics + kbd-hint to the right', () => {
  assert.match(SRC, /className="spacer"/, 'a .spacer element divides primary/ghost from meta');
});

test('actions-row.tsx: no raw fetch / no dangerouslySetInnerHTML', () => {
  assert.doesNotMatch(SRC, /fetch\(/);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML/);
});
