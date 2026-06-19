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

// quick-260619-r4v Piece 1 — the Standalone option is REMOVED; topic is
// REQUIRED. The dropdown defaults to the open/source topic; a "+ New topic"
// affordance reveals the new-topic name input.
test('true-task-dialog.tsx: Standalone option is GONE (topic required)', () => {
  assert.doesNotMatch(SRC, /Standalone \(not linked to any topic\)/);
});

test('true-task-dialog.tsx: TOPIC label is required (no "(OPTIONAL)" suffix)', () => {
  assert.doesNotMatch(SRC, /TOPIC \(OPTIONAL\)/);
  assert.match(SRC, /<label htmlFor="true-task-dialog-topic">TOPIC<\/label>/);
});

test('true-task-dialog.tsx: inline "+ New topic" affordance + new-topic name input', () => {
  assert.match(SRC, /\+ New topic/);
  assert.match(SRC, /true-task-dialog-new-topic/);
});

test('true-task-dialog.tsx: defaults the topic to the currently-open topic (currentTopic)', () => {
  const c = code(SRC);
  assert.match(c, /currentTopic/);
});

test('true-task-dialog.tsx: Create is gated on a topic OR a new-topic name (hasTopic)', () => {
  const c = code(SRC);
  assert.match(c, /canSubmit\s*=\s*[\s\S]*hasTopic/);
});

test('true-task-dialog.tsx: passes newTopicTitle to createTrueTask', () => {
  const c = code(SRC);
  assert.match(c, /newTopicTitle:/);
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

test('true-task-dialog.tsx: submit passes topicIssueId + sourceCommentId', () => {
  const c = code(SRC);
  // The createTrueTask call references both fields (topicIssueId is now
  // null when creating a new topic; non-null when an existing one is chosen).
  assert.match(c, /topicIssueId:/);
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

// ---------------------------------------------------------------------------
// Plan 04.1-09 — DIALOG SHELL REWORKED. Drill fix #4 from 2026-05-20.
// The Plan 04.1-08 build used the native <dialog> element with showModal();
// the existing CSS forced position:fixed inset:0 width:480px margin:0 which
// fought native auto-centering and the dialog rendered TOP-LEFT. The shell
// is now a custom backdrop + body pair: the backdrop centers the body via
// flex; backdrop click closes; click inside the body stops propagation;
// Escape closes via a window listener.
// ---------------------------------------------------------------------------

test('true-task-dialog.tsx (Plan 04.1-09): renders .true-task-dialog-backdrop wrapper', () => {
  assert.match(
    SRC,
    /true-task-dialog-backdrop/,
    'the dialog must wrap its body in a .true-task-dialog-backdrop element',
  );
});

test('true-task-dialog.tsx (Plan 04.1-09): backdrop click invokes onClose', () => {
  const c = code(SRC);
  // The outer wrapper's onClick is bound to onClose.
  assert.match(
    c,
    /className="true-task-dialog-backdrop"[\s\S]*?onClick=\{onClose\}/,
    'backdrop onClick must invoke onClose',
  );
});

test('true-task-dialog.tsx (Plan 04.1-09): dialog body uses e.stopPropagation to swallow inner clicks', () => {
  const c = code(SRC);
  // The inner body element's onClick stops propagation so a click on the
  // dialog itself (inputs / buttons / etc.) does NOT bubble up and close.
  assert.match(
    c,
    /onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
    'inner dialog body must stop click propagation so clicks inside do not close',
  );
});

test('true-task-dialog.tsx (Plan 04.1-09): Escape is bound via window keydown listener', () => {
  const c = code(SRC);
  // The Plan 04.1-08 build relied on the native <dialog> Escape semantics.
  // The new shell needs an explicit window listener that fires regardless of
  // focus location. The handler checks e.key === 'Escape' and calls onClose.
  assert.match(
    c,
    /window\.addEventListener\(['"]keydown['"]/,
    'must register a window keydown listener',
  );
  assert.match(
    c,
    /e\.key\s*[!=]==?\s*['"]Escape['"]/,
    'must check the Escape key',
  );
});

test('true-task-dialog.tsx (Plan 04.1-09): the native <dialog> + showModal/close shell is gone', () => {
  const c = code(SRC);
  // The new shell is a div pair — no more imperative dialog API.
  assert.doesNotMatch(
    c,
    /\.showModal\(\)/,
    'showModal() must not be called any more — the new shell is a div pair',
  );
  assert.doesNotMatch(
    c,
    /HTMLDialogElement/,
    'the HTMLDialogElement ref type must be gone',
  );
});

test('chat.css (Plan 04.1-09): .true-task-dialog-backdrop is fixed inset 0 with flex centering', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  const block = css.match(/\.true-task-dialog-backdrop\s*\{([^}]*)\}/);
  assert.ok(block, '.true-task-dialog-backdrop must be styled');
  assert.match(block[1], /position:\s*fixed/, 'backdrop is position: fixed');
  assert.match(block[1], /inset:\s*0/, 'backdrop covers the viewport (inset: 0)');
  assert.match(block[1], /display:\s*flex/, 'backdrop is a flex container');
  assert.match(
    block[1],
    /align-items:\s*center/,
    'backdrop centers vertically',
  );
  assert.match(
    block[1],
    /justify-content:\s*center/,
    'backdrop centers horizontally',
  );
});

// ---------------------------------------------------------------------------
// Plan 04.1-10 — DETAILS textarea sizing (drill fix #2a). The Plan 04.1-08
// build rendered DETAILS as a single-line <input type="text">; Task 1 of
// this plan promoted it to a <textarea> and Task 2 adds the sizing CSS:
// min-height 140px, max-height 40vh, vertical resize, overflow-y auto.
// ---------------------------------------------------------------------------

test('chat.css (Plan 04.1-10): .true-task-dialog textarea has min-height 140px', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  const block = css.match(/\.true-task-dialog\s+textarea\s*\{([^}]*)\}/);
  assert.ok(block, '.true-task-dialog textarea must be styled');
  assert.match(
    block[1],
    /min-height:\s*140px/,
    'textarea min-height 140px so it opens at ~6 lines',
  );
});

test('chat.css (Plan 04.1-10): .true-task-dialog textarea has max-height 40vh + scrollable + vertical resize', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  const block = css.match(/\.true-task-dialog\s+textarea\s*\{([^}]*)\}/);
  assert.ok(block, '.true-task-dialog textarea must be styled');
  assert.match(
    block[1],
    /max-height:\s*40vh/,
    'textarea max-height 40vh so the dialog stays on small screens',
  );
  assert.match(
    block[1],
    /overflow-y:\s*auto/,
    'textarea overflow-y auto so content scrolls inside it past the cap',
  );
  assert.match(
    block[1],
    /resize:\s*vertical/,
    'textarea resize: vertical so the operator can drag taller',
  );
});

test('chat.css (Plan 04.1-09): .true-task-dialog is position:relative (not the stale position:fixed top-left)', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  // The first .true-task-dialog rule (the BASE rule — not the per-mode
  // overrides that follow) must set position: relative explicitly so the
  // backdrop's flex centering wins.
  const block = css.match(/\.true-task-dialog\s*\{([^}]*)\}/);
  assert.ok(block, '.true-task-dialog must be styled');
  assert.match(
    block[1],
    /position:\s*relative/,
    '.true-task-dialog must be position: relative (was position: fixed in Plan 04.1-08)',
  );
  assert.match(
    block[1],
    /max-width:\s*560px/,
    '.true-task-dialog max-width 560px (was 480px)',
  );
});

