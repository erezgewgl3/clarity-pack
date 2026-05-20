// test/ui/chat-archived-banner.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the new archived
// banner (sticky read-only banner shown when an archived topic is open).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'archived-banner.tsx'), 'utf8');
const CSS = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('archived-banner.tsx: file exists at the expected path', () => {
  assert.ok(
    existsSync(path.join(CHAT_DIR, 'archived-banner.tsx')),
    'src/ui/surfaces/chat/archived-banner.tsx must exist',
  );
});

test('archived-banner.tsx: exports ArchivedBanner as a named function component', () => {
  assert.match(SRC, /export function ArchivedBanner/);
});

test('archived-banner.tsx: banner renders the ARCHIVED — read-only title', () => {
  assert.match(SRC, /ARCHIVED — read-only/);
});

test('archived-banner.tsx: Unarchive button click invokes onUnarchive', () => {
  const c = code(SRC);
  assert.match(c, /onClick=\{onUnarchive\}/);
});

test('archived-banner.tsx: banner CSS uses --warn (NOT --alert; alert reserved for host-stuck)', () => {
  // CSS file pin: the banner background uses --warn-soft + --warn border —
  // never --alert (which is reserved for host-stuck per the UI-SPEC and
  // sketch contract).
  assert.match(CSS, /\.chat-archived-banner\b[\s\S]*?--warn-soft/, 'uses --warn-soft bg');
  assert.match(CSS, /\.chat-archived-banner\b[\s\S]*?border:\s*1px solid var\(--warn\)/);
});
