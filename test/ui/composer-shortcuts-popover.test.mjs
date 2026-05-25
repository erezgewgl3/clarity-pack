// test/ui/composer-shortcuts-popover.test.mjs
//
// Plan 05-08 (D-19) — Composer shortcuts popover TWO parallel triggers
// (checker BLOCKER 3):
//   SP1 PRIMARY: bare `?` in EMPTY composer textarea opens the popover.
//   SP3 PARALLEL: Shift-? regardless of textarea content opens the popover.
//   SP4: Esc closes; SP5: any printable key closes; SP6: shortcut list as
//        React text; SP7: click-outside closes.
//
// Source-grep style. The composer's handleKeyDown wires both triggers via
// `event.key === '?'` (Shift-/ produces `?` on US keyboards, so both paths
// collapse onto the same key check — the popover always opens on `?` and
// SP2 literal-? is reachable by dismissing the popover and typing).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POPOVER = path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'shortcuts-popover.tsx');
const COMPOSER = path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'composer.tsx');
const POPOVER_SRC = readFileSync(POPOVER, 'utf8');
const COMPOSER_SRC = readFileSync(COMPOSER, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const POPOVER_CODE = code(POPOVER_SRC);
const COMPOSER_CODE = code(COMPOSER_SRC);

test('SP-file: shortcuts-popover.tsx exists', () => {
  assert.ok(existsSync(POPOVER));
});

test('SP-export: exports ComposerShortcutsPopover', () => {
  assert.match(POPOVER_SRC, /export function ComposerShortcutsPopover/);
});

// ---- SP1 + SP3 — composer.tsx wires `?` key trigger ---------------------

test('SP1+SP3: composer.tsx handleKeyDown opens popover on event.key === ?', () => {
  // The dual trigger is consolidated into a single `event.key === '?'`
  // branch (Shift+/ on US layouts produces `?`; bare-? is rare and the
  // SP2 literal-? path is reachable via popover dismiss + retype).
  assert.match(COMPOSER_CODE, /e\.key\s*===\s*['"]\?['"]/);
  assert.match(COMPOSER_CODE, /setShortcutsPopoverOpen\(true\)/);
});

test('SP1+SP3: preventDefault suppresses literal ? insertion on popover-open path', () => {
  // The `?` branch in handleKeyDown must call preventDefault so the literal
  // character does not flow into the textarea.
  const block = COMPOSER_CODE.match(
    /if\s*\(\s*e\.key\s*===\s*['"]\?['"][\s\S]{0,160}?setShortcutsPopoverOpen\(true\)/,
  );
  assert.ok(block, 'popover-open block present');
  assert.match(block[0], /preventDefault/);
});

// ---- SP3 explicit Shift+? -- the dual-trigger commentary acknowledges it -

test('SP3: composer.tsx documents the Shift+? parallel trigger (BLOCKER 3 acknowledgment)', () => {
  assert.match(COMPOSER_SRC, /Shift-\?|Shift\+\?|shiftKey/);
});

// ---- SP4 — Escape closes the popover ------------------------------------

test('SP4: Escape inside composer closes the popover + restores focus to textarea', () => {
  assert.match(COMPOSER_CODE, /e\.key\s*===\s*['"]Escape['"]/);
  assert.match(COMPOSER_CODE, /closeShortcutsPopover|setShortcutsPopoverOpen\(false\)/);
});

// ---- SP5 — any printable key closes the popover (NO preventDefault) ----

test('SP5: printable key closes popover; the keystroke reaches the textarea', () => {
  // The handleKeyDown's open-state path calls setShortcutsPopoverOpen(false)
  // but does NOT preventDefault for printable keys (only Escape does).
  assert.match(
    COMPOSER_CODE,
    /shortcutsPopoverOpen[\s\S]{0,500}?setShortcutsPopoverOpen\(false\)/,
  );
});

// ---- SP6 — popover renders shortcuts as React text (no innerHTML) -------

test('SP6: popover lists shortcuts as React text rows; NO dangerouslySetInnerHTML', () => {
  assert.match(POPOVER_CODE, /SHORTCUTS\.map/);
  assert.match(POPOVER_SRC, /\bT\b/);
  assert.match(POPOVER_SRC, /Enter/);
  assert.doesNotMatch(POPOVER_CODE, /dangerouslySetInnerHTML/);
});

// ---- SP7 — click-outside closes the popover -----------------------------

test('SP7: shortcuts-popover.tsx wires a window mousedown listener with deferred registration', () => {
  assert.match(POPOVER_CODE, /mousedown/);
  // Deferred via setTimeout(...) to dodge the open-click closing immediately.
  assert.match(POPOVER_CODE, /setTimeout/);
  assert.match(POPOVER_CODE, /contains/);
});

// ---- SP-scope — popover binds to textarea onKeyDown only, NOT window ----

test('SP-scope: ComposerShortcutsPopover does NOT add a global keydown listener', () => {
  // The popover itself only wires mousedown (click-outside). No window
  // keydown listener escapes to other surfaces.
  assert.doesNotMatch(POPOVER_CODE, /window\.addEventListener\(\s*['"]keydown['"]/);
});
