// test/ui/chat-context-rail.test.mjs
//
// Plan 04.1-09 Task 6 — source-grep contract tests for the context rail
// drill-fix #5 (pause heartbeat toast + CEO status pill flip).
//
// The Plan 04.1-08 build left the right rail's "⏸ Pause heartbeat" Quick
// Action as a `disabled` no-op stub with zero visible feedback. Operator
// drill 2026-05-20 confirmed: clicking did nothing. The Plan 04.1-09 wire
// makes it LIVE — clicking surfaces a transient toast via the new useToast()
// hook and OPTIMISTICALLY flips the CEO status pill from `live · idle` to
// `paused` (warn color) until the next 15s poll re-syncs.
//
// SOURCE-GREP idiom (Node doesn't load .tsx).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const PRIM_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives');
const SRC = readFileSync(path.join(CHAT_DIR, 'context-rail.tsx'), 'utf8');
const CSS = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// Toast primitive (NEW in Plan 04.1-09) — src/ui/primitives/toast.tsx
// ---------------------------------------------------------------------------

test('toast primitive: src/ui/primitives/toast.tsx exists', () => {
  assert.ok(
    existsSync(path.join(PRIM_DIR, 'toast.tsx')),
    'src/ui/primitives/toast.tsx must exist (the new toast primitive)',
  );
});

test('toast primitive: exports ToastProvider, useToast, and ChatToast', () => {
  const src = readFileSync(path.join(PRIM_DIR, 'toast.tsx'), 'utf8');
  assert.match(src, /export function ToastProvider/, 'must export ToastProvider');
  assert.match(src, /export function useToast/, 'must export useToast hook');
  assert.match(src, /export function ChatToast/, 'must export ChatToast component');
});

test('toast primitive: useToast throws outside a ToastProvider (developer guardrail)', () => {
  const src = readFileSync(path.join(PRIM_DIR, 'toast.tsx'), 'utf8');
  // The hook throws when no provider is mounted to make wiring errors loud.
  assert.match(
    src,
    /useToast must be called inside a <ToastProvider>/,
    'useToast must throw a helpful error when not inside a ToastProvider',
  );
});

test('toast primitive: showToast auto-dismisses after the duration (default 4000ms)', () => {
  const src = readFileSync(path.join(PRIM_DIR, 'toast.tsx'), 'utf8');
  // Default 4s auto-dismiss via setTimeout. Passing duration=0 disables it.
  assert.match(
    src,
    /duration\s*\?\?\s*4000/,
    'default auto-dismiss duration must be 4000ms',
  );
  assert.match(
    src,
    /setTimeout/,
    'auto-dismiss must use a setTimeout-driven removal',
  );
});

test('toast primitive: ChatToast is click-to-dismiss', () => {
  const src = readFileSync(path.join(PRIM_DIR, 'toast.tsx'), 'utf8');
  assert.match(
    src,
    /onClick=\{onDismiss\}/,
    'ChatToast onClick must invoke onDismiss for manual dismissal',
  );
});

// ---------------------------------------------------------------------------
// context-rail.tsx — Pause heartbeat wiring (drill fix #5)
// ---------------------------------------------------------------------------

test('context-rail.tsx: imports + uses the new useToast() hook', () => {
  const c = code(SRC);
  assert.match(c, /import\s*\{?\s*useToast/, 'must import useToast');
  assert.match(c, /useToast\(\)/, 'must call the hook');
  assert.match(c, /showToast/, 'must expose showToast from the hook');
});

test('context-rail.tsx: pause-heartbeat click invokes showToast with a helpful message', () => {
  const c = code(SRC);
  // The toast message tells the operator the canonical pause path is the
  // agent page (the real host RPC for pause-heartbeat is deferred to 4.2).
  assert.match(
    c,
    /showToast\(\{[\s\S]*?message:[\s\S]*?Resume from the agent page/,
    'showToast must include a "Resume from the agent page" hint',
  );
});

test('context-rail.tsx: pause-heartbeat OPTIMISTICALLY flips CEO status pill to "paused"', () => {
  const c = code(SRC);
  // The local override state — `pausedOverride` — is set to 'paused' on
  // click and wins over the host status until the next poll clears it.
  assert.match(
    c,
    /setPausedOverride\(['"]paused['"]\)/,
    'click must set the local pausedOverride state to "paused"',
  );
});

test('context-rail.tsx: the paused override clears when the selected employee changes', () => {
  const c = code(SRC);
  // A useEffect on employee.id resets the override so the next employee
  // shows the host's truth, not a stale paused flag.
  assert.match(
    c,
    /setPausedOverride\(null\)/,
    'override must be reset to null when employee changes',
  );
  assert.match(
    c,
    /\[employee\?\.id\]/,
    'reset effect must depend on employee.id',
  );
});

test('context-rail.tsx: pause-heartbeat button is no longer a disabled no-op', () => {
  const c = code(SRC);
  // The Plan 04.1-08 build rendered `<button disabled>⏸ Pause heartbeat`
  // with NO onClick. The new wiring has onClick + disabled only when no
  // employee is selected (sensible — no agent to pause).
  assert.match(
    c,
    /onClick=\{onPauseHeartbeat\}/,
    'pause-heartbeat button must have an onClick handler',
  );
  assert.match(
    c,
    /data-clarity-action="pause-heartbeat"/,
    'pause-heartbeat button must carry a data-clarity-action attribute for the drill',
  );
});

test('context-rail.tsx: CEO status pill renders the resolved display status', () => {
  const c = code(SRC);
  // The displayed status string is the optimistic override ?? employee.status.
  assert.match(
    c,
    /pausedOverride\s*\?\?\s*employee\?\.status/,
    'display status must prefer the optimistic override over the host status',
  );
});

// ---------------------------------------------------------------------------
// chat.css — clarity-toast + paused-pill styling
// ---------------------------------------------------------------------------

test('chat.css (Plan 04.1-09): .clarity-toast-stack is fixed bottom-right with z-index above the dialog', () => {
  const block = CSS.match(/\.clarity-toast-stack\s*\{([^}]*)\}/);
  assert.ok(block, '.clarity-toast-stack must be styled');
  assert.match(block[1], /position:\s*fixed/, 'stack is position: fixed');
  assert.match(block[1], /bottom:\s*24px/, 'stack pinned to bottom-right');
  assert.match(block[1], /right:\s*24px/, 'stack pinned to bottom-right');
  // z-index MUST be above the dialog backdrop (z-index 200) so a toast that
  // fires while the dialog is open is still visible.
  assert.match(
    block[1],
    /z-index:\s*3\d\d/,
    'stack z-index must be in the 300+ range (above the dialog backdrop at 200)',
  );
});

test('chat.css (Plan 04.1-09): .clarity-toast carries an entrance animation keyframe', () => {
  // Pure CSS slide+fade — no animation library.
  assert.match(
    CSS,
    /@keyframes\s+clarity-toast-in/,
    'a clarity-toast-in keyframe must define the entrance animation',
  );
  // The toast body uses it.
  assert.match(
    CSS,
    /\.clarity-toast\b[\s\S]*?animation:\s*clarity-toast-in/,
    'the .clarity-toast rule must reference the keyframe',
  );
});

test('chat.css (Plan 04.1-09): .stat-value.paused uses the warn color (the optimistic pause state)', () => {
  assert.match(
    CSS,
    /\.stat-value\.paused\b[\s\S]*?color:\s*var\(--warn\)/,
    '.stat-value.paused must be the warn-amber color',
  );
});

// ---------------------------------------------------------------------------
// Right-rail task-row word-wrap (drill fix from Plan 04.1-08 — chars wrapped
// line-by-line). Task 5 in the plan.
// ---------------------------------------------------------------------------

test('chat.css (Plan 04.1-09): .task-row middle column uses minmax(0, 1fr) to allow shrink', () => {
  // The Plan 04.1-06 grid was `auto 1fr auto` — the 1fr column had no
  // min-width: 0 override so it could not shrink below the content's
  // intrinsic size. The new rule is `auto minmax(0, 1fr) auto`.
  assert.match(
    CSS,
    /\.task-row\b[\s\S]*?grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/,
    '.task-row grid must use minmax(0, 1fr) for the middle column',
  );
});

test('chat.css (Plan 04.1-09): .task-row .ttl wraps at word boundaries, not char-by-char, and clamps to 3 lines', () => {
  // word-break: normal + overflow-wrap: break-word + hyphens: auto wraps at
  // word boundaries (not characters). A 3-line clamp keeps the row
  // predictable; the full title surfaces via hover (title= attribute on
  // .ttl set in active-tasks-owned.tsx).
  const block = CSS.match(/\.task-row\s+\.ttl\b[^{]*\{([^}]*)\}/);
  assert.ok(block, '.task-row .ttl must have a dedicated rule');
  assert.match(block[1], /word-break:\s*normal/, 'word-break must be normal (no char-by-char wrap)');
  assert.match(block[1], /overflow-wrap:\s*break-word/, 'overflow-wrap break-word for long unbreakable words');
  assert.match(block[1], /hyphens:\s*auto/, 'hyphens auto for soft-break hints');
  assert.match(block[1], /-webkit-line-clamp:\s*3/, 'clamp to 3 lines');
});

test('active-tasks-owned.tsx (Plan 04.1-09): .ttl carries a hover-tooltip title attribute for full text', () => {
  const src = readFileSync(
    path.join(CHAT_DIR, 'active-tasks-owned.tsx'),
    'utf8',
  );
  // The 3-line clamp truncates long titles — hover must reveal the full
  // string via the title= attribute.
  assert.match(
    src,
    /title=\{t\.title\}/,
    '.ttl must carry a title=t.title attribute for hover tooltip',
  );
});

// ---------------------------------------------------------------------------
// index.tsx — ToastProvider mount + activeTasks fetch wiring
// ---------------------------------------------------------------------------

test('index.tsx (Plan 04.1-09): ToastProvider wraps ChatPageBody', () => {
  const src = readFileSync(path.join(CHAT_DIR, 'index.tsx'), 'utf8');
  assert.match(src, /import\s*\{?\s*ToastProvider/, 'must import ToastProvider');
  // ChatPageBody is wrapped so any descendant can useToast().
  assert.match(
    src,
    /<ToastProvider>[\s\S]*?<ChatPageBody/,
    '<ToastProvider> must wrap <ChatPageBody>',
  );
});

test('index.tsx (Plan 04.1-09): chat.taskOwned fetch lifted via useChatActiveTasks', () => {
  const src = readFileSync(path.join(CHAT_DIR, 'index.tsx'), 'utf8');
  // The fetch is single-sourced via the new hook; the data flows to both
  // ContextRail (right rail) and Composer (MessageThread title lookup).
  assert.match(
    src,
    /useChatActiveTasks\(/,
    'index.tsx must call useChatActiveTasks to fetch chat.taskOwned',
  );
  assert.match(
    src,
    /activeTasks=\{activeTasks\}/,
    'index.tsx must pass activeTasks to both consumers',
  );
});
