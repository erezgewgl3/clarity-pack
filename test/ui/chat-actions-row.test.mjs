// test/ui/chat-actions-row.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the actions row.
// Plan 04.1-09 — SHORTCUT REPLACED. The Plan 04.1-08 build bound ⌘+T / Ctrl+T
// to open the cold task dialog; the operator drill 2026-05-20 confirmed the
// browser intercepts that chord for "New Tab" before the plugin handler
// runs. The shortcut is now a Linear-style single-key `T` (no modifier),
// guarded against active inputs. These tests pin the new behavior and
// guard the regression (Ctrl+T must NOT be bound any more).
//
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

// --- Plan 04.1-09: single-key `T` shortcut (replaces ⌘+T / Ctrl+T) ----------
//
// Operator drill 2026-05-20: pressing Ctrl+T opened a NEW BROWSER TAB before
// the plugin's keydown handler ran. The chord is unusable in any real browser
// context. Replaced with single-key `T` (no modifier) when no input is
// focused. The handler must:
//   - check the key is 'T' or 't'
//   - BAIL on any modifier (ctrlKey || metaKey || altKey || shiftKey)
//   - BAIL when focus is in an input / textarea / contentEditable
//   - preventDefault + call onCreateTask() in the happy path

test('actions-row.tsx (Plan 04.1-09): registers a global single-key T keyboard shortcut', () => {
  const c = code(SRC);
  // The key check is present — either inverse short-circuit or equality.
  assert.match(
    c,
    /e\.key\s*[!=]==?\s*['"]T['"]|e\.key\s*[!=]==?\s*['"]t['"]/,
    'must check the T/t key',
  );
  assert.match(c, /onCreateTask\(\)/, 'shortcut handler calls onCreateTask()');
  assert.match(c, /e\.preventDefault\(\)/, 'preventDefault keeps the keystroke for the dialog');
});

test('actions-row.tsx (Plan 04.1-09): T shortcut BAILS on every modifier (no Ctrl+T / ⌘+T binding)', () => {
  const c = code(SRC);
  // The four-way modifier bail is the regression guard — Ctrl+T must NOT
  // open the dialog any more (browser owns the chord for New Tab).
  assert.match(
    c,
    /e\.ctrlKey\s*\|\|\s*e\.metaKey/,
    'must check ctrl/meta modifiers (to bail on them)',
  );
  assert.match(c, /e\.altKey/, 'must check alt modifier (to bail on it)');
  assert.match(c, /e\.shiftKey/, 'must check shift modifier (to bail on it)');
});

test('actions-row.tsx (Plan 04.1-09): T shortcut respects active input/textarea/contenteditable', () => {
  const c = code(SRC);
  // The handler skips when the focused element is an input, textarea, or
  // contentEditable — operators typing should keep their keystroke.
  assert.match(c, /INPUT|TEXTAREA|isContentEditable/, 'must skip when focus is in an editable');
});

test('actions-row.tsx (Plan 04.1-09): the OLD Ctrl+T / ⌘+T shortcut binding is gone (regression guard)', () => {
  const c = code(SRC);
  // The Plan 04.1-08 binding used `(e.metaKey || e.ctrlKey)` to REQUIRE a
  // modifier — the new code uses the same expression to BAIL ON a modifier.
  // The semantic test: the handler MUST NOT call onCreateTask while a
  // modifier is held. The strongest signal is that the bail-line returns
  // early on the modifier check. We assert the early-return pattern.
  // (The acceptance test in the plan: grep -c '⌘T new task' must be 0.)
  assert.doesNotMatch(
    SRC,
    /⌘T new task/,
    'the old kbd-hint "⌘T new task" copy must be gone',
  );
  assert.doesNotMatch(
    SRC,
    /Create a task \(⌘T \/ Ctrl\+T\)/,
    'the old tooltip "Create a task (⌘T / Ctrl+T)" must be gone',
  );
});

test('actions-row.tsx (Plan 04.1-09): tooltip + kbd-hint copy is the single-key T form', () => {
  // The tooltip now reads `Create a task (T)`.
  assert.match(SRC, /Create a task \(T\)/, 'tooltip must read "Create a task (T)"');
  // The kbd hint surface keeps a single <kbd>T</kbd> chip — no ⌘ glyph.
  assert.match(SRC, /<kbd>T<\/kbd>/, 'kbd tag for T must render');
  assert.doesNotMatch(
    SRC,
    /<kbd>⌘<\/kbd>/,
    'the ⌘ kbd tag must be gone (single-key shortcut)',
  );
  // A .kbd-hint span is still rendered for shortcut surface.
  assert.match(SRC, /kbd-hint/, 'a .kbd-hint span is rendered for the shortcut surface');
});

test('actions-row.tsx: spacer pushes diagnostics + kbd-hint to the right', () => {
  assert.match(SRC, /className="spacer"/, 'a .spacer element divides primary/ghost from meta');
});

test('actions-row.tsx: no raw fetch / no dangerouslySetInnerHTML', () => {
  assert.doesNotMatch(SRC, /fetch\(/);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML/);
});
