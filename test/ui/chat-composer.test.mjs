// test/ui/chat-composer.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the STRIPPED composer.
// Pin: no Send-as-task toggle, placeholder is single-purpose, send button is
// always SEND, disabled-state on archived topics is wired.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'composer.tsx'), 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('composer.tsx: no TrueTaskToggle import (file is deleted)', () => {
  assert.equal(
    (SRC.match(/TrueTaskToggle/g) || []).length,
    0,
    'TrueTaskToggle import + render must be REMOVED',
  );
});

test('composer.tsx: no TrueTaskDialog import (dialog now hosts at index.tsx)', () => {
  // Plan 04.1-08 — the dialog is no longer hosted by the composer; it's
  // hosted at the shell root in index.tsx.
  const c = code(SRC);
  assert.equal(
    (c.match(/TrueTaskDialog/g) || []).length,
    0,
    'composer.tsx must NOT import or render TrueTaskDialog',
  );
});

test('composer.tsx: placeholder is "Message {employeeName}…" (single-purpose)', () => {
  assert.match(SRC, /Message \$\{employeeName\}…/);
});

test('composer.tsx: send button label is always "SEND" (no OPEN TASK FORM flip)', () => {
  // Pin the literal "SEND" in the JSX; assert the legacy "Open task form"
  // copy is GONE.
  assert.match(SRC, />\s*SEND\s*</);
  assert.doesNotMatch(SRC, /Open task form/i);
});

test('composer.tsx: disabled prop drives composer--disabled class + read-only textarea', () => {
  const c = code(SRC);
  assert.match(c, /composer--disabled/, 'disabled state applies the new CSS class');
  assert.match(c, /readOnly=\{disabled\}/, 'textarea read-only when disabled');
  assert.match(c, /disabled=\{disabled\}/, 'textarea disabled when disabled');
});

test('composer.tsx: disabled placeholder is "Unarchive to send messages."', () => {
  assert.match(SRC, /Unarchive to send messages\./);
});

test('composer.tsx: handleSend hard-blocks when disabled', () => {
  const c = code(SRC);
  // First branch in handleSend short-circuits on disabled — never fires
  // chat.send when the composer is in archived state.
  assert.match(c, /if\s*\(disabled\)\s*return/);
});
