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

test('context-rail.tsx (Plan 05-06 item d): pause-heartbeat toast points at the inline ▶ Resume affordance', () => {
  const c = code(SRC);
  // Plan 05-06 item (d): the toast copy NO LONGER says "Resume from the
  // agent page." The inline ▶ Resume heartbeat row landed in Plan 04.1-10
  // (same component, lines 215-224) — it IS the canonical resume surface, so
  // the toast directs the operator there. Pinned-string regression guard for
  // both the new copy AND the absence of the old copy.
  assert.match(
    c,
    /showToast\(\{[\s\S]*?message:[\s\S]*?Use ▶ Resume heartbeat below to restart/,
    'pause-toast must read "Use ▶ Resume heartbeat below to restart"',
  );
  assert.doesNotMatch(
    c,
    /Resume from the agent page/,
    'old pause-toast string ("Resume from the agent page.") must be REMOVED — Plan 05-06 item (d)',
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

test('index.tsx (Plan 05-08 Task 5 D-17 supersedes Plan 04.1-09 ToastProvider lock): ToastProvider hoisted to ClaritySurfaceRoot; chat no longer wraps it locally', () => {
  const src = readFileSync(path.join(CHAT_DIR, 'index.tsx'), 'utf8');
  // Plan 05-08 D-17 (checker BLOCKER 4) hoisted ToastProvider into
  // ClaritySurfaceRoot so EVERY clarity-pack surface gets useToast() in
  // scope (Reader / Situation Room / Bulletin / Chat / Archive). The
  // chat surface's in-body <ToastProvider> wrapper was removed to avoid
  // nested providers (Task 5 of Plan 05-08).
  //
  // The 04.1-09 lock (must wrap ChatPageBody) is explicitly superseded.
  // We re-pin the new contract: chat/index.tsx does NOT mount a
  // <ToastProvider> wrapper, and ClaritySurfaceRoot does.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    codeOnly,
    /<ToastProvider>/,
    'chat/index.tsx must NOT mount a <ToastProvider> wrapper (D-17 hoist supersedes)',
  );
  // useToast is still imported because ChatPageBody calls it for the
  // task-created + pause toasts.
  assert.match(src, /useToast/);
  // Pin the hoist: ClaritySurfaceRoot is the source of ToastProvider.
  const rootSrc = readFileSync(
    path.join(CHAT_DIR, '..', '..', 'primitives', 'clarity-surface-root.tsx'),
    'utf8',
  );
  assert.match(rootSrc, /<ToastProvider>/, 'ClaritySurfaceRoot must mount ToastProvider');
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

// ---------------------------------------------------------------------------
// Plan 04.1-10 — Resume heartbeat inline toggle (drill fix #3). Once paused,
// the Quick Action row toggles to ▶ Resume; clicking attempts the host
// action AND optimistically flips the visual back to live. Graceful-degrade
// toast when the host action key isn't bound.
// ---------------------------------------------------------------------------

test('context-rail.tsx (Plan 04.1-10): when CEO status is paused, Resume row renders (NOT Pause)', () => {
  const c = code(SRC);
  // The render is gated on isPausedDisplay — true → Resume button; false → Pause.
  assert.match(
    c,
    /isPausedDisplay\s*\?\s*\([\s\S]*?Resume heartbeat[\s\S]*?\)\s*:\s*\([\s\S]*?Pause heartbeat/,
    'paused state must render Resume; otherwise Pause',
  );
});

test('context-rail.tsx (Plan 04.1-10): Resume button has data-clarity-action="resume-heartbeat"', () => {
  const c = code(SRC);
  assert.match(
    c,
    /data-clarity-action="resume-heartbeat"/,
    'Resume button needs a stable selector for the operator drill',
  );
});

test('context-rail.tsx (Plan 04.1-10): Resume click invokes onResumeHeartbeat', () => {
  const c = code(SRC);
  // The Resume button's onClick wraps onResumeHeartbeat in a fire-and-forget
  // arrow so React's synthetic event matches the void return type.
  assert.match(
    c,
    /onClick=\{\s*\(\)\s*=>\s*void\s+onResumeHeartbeat\(\)\s*\}/,
    'Resume click must invoke onResumeHeartbeat',
  );
});

test('context-rail.tsx (Plan 04.1-10): onResumeHeartbeat optimistically flips paused → live FIRST', () => {
  const c = code(SRC);
  // Before the async host call, setPausedOverride(null) lands so the visual
  // flips back instantly; the host call follows. This ordering keeps the
  // visual snappy when the host call latency is non-trivial.
  const block = c.match(/const onResumeHeartbeat[\s\S]*?\}\,\s*\[/);
  assert.ok(block, 'onResumeHeartbeat must exist');
  // setPausedOverride(null) appears before the resumeAction(...) call.
  const setIdx = block[0].indexOf('setPausedOverride(null)');
  const callIdx = block[0].indexOf('resumeAction(');
  assert.ok(setIdx >= 0, 'must call setPausedOverride(null)');
  assert.ok(callIdx >= 0, 'must call resumeAction');
  assert.ok(
    setIdx < callIdx,
    'optimistic flip must happen BEFORE the host action call',
  );
});

test('context-rail.tsx (Plan 04.1-10): Resume invokes agents.resumeHeartbeat via usePluginAction', () => {
  const c = code(SRC);
  assert.match(
    c,
    /usePluginAction\(\s*['"]agents\.resumeHeartbeat['"]\s*\)/,
    'must bind the agents.resumeHeartbeat action via usePluginAction',
  );
});

test('context-rail.tsx (Plan 04.1-10): Resume host-call failure path fires a graceful-degrade toast', () => {
  const c = code(SRC);
  // The catch arm in onResumeHeartbeat surfaces a toast that names the
  // agent page as the canonical resume path AND still leaves the optimistic
  // flip in place (no rollback).
  assert.match(
    c,
    /host call pending — verify on the agent page/,
    'catch-block toast must include the host-pending hint',
  );
});

test('context-rail.tsx (Plan 04.1-10): Resume success path fires a confirming toast', () => {
  const c = code(SRC);
  // The success arm fires a 4s confirm toast.
  assert.match(
    c,
    /Heartbeat resumed for \$\{name\}\.`,\s*duration:\s*4000/,
    'success toast must be "Heartbeat resumed for <name>." at 4s duration',
  );
});

test('chat.css (Plan 04.1-10): .qa-resume gives the leading glyph a live-green hint', () => {
  // The ▶ play-glyph reads as "go" in the live token color, mirroring the
  // amber warn tint on .stat-value.paused for the paused state.
  assert.match(
    CSS,
    /\.qa-resume::first-letter\b[\s\S]*?color:\s*var\(--live\)/,
    '.qa-resume leading glyph must be the live-green token',
  );
});
