// test/ui/chat-attachment-chip.test.mjs
//
// Plan 05-11 Task 5 -- source-grep contract tests for AttachmentChip.
//
// SOURCE-GREP idiom (matches the chat-actions-row.test.mjs + chat-composer.test.mjs
// pattern -- Node does not load .tsx, so we assert on rendered source strings).
// The DOM-render path is exercised by the integration round-trip + the
// Composer + ContextRail wire-up tests (Tasks 6 + 8).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'attachment-chip.tsx'), 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('attachment-chip.tsx: file exists at the expected path', () => {
  assert.ok(
    existsSync(path.join(CHAT_DIR, 'attachment-chip.tsx')),
    'src/ui/surfaces/chat/attachment-chip.tsx must exist',
  );
});

test('attachment-chip.tsx: exports AttachmentChip + humanizeBytes + mimeIconFor + AttachmentChipProps + AttachmentChipState', () => {
  assert.match(SRC, /export function AttachmentChip/, 'must export AttachmentChip');
  assert.match(SRC, /export function humanizeBytes/, 'must export humanizeBytes');
  assert.match(SRC, /export function mimeIconFor/, 'must export mimeIconFor');
  assert.match(SRC, /export type AttachmentChipProps/, 'must export AttachmentChipProps type');
  assert.match(SRC, /export type AttachmentChipState/, 'must export AttachmentChipState type');
});

test('attachment-chip.tsx: 4 state classes -- staged / uploading / ready / failed', () => {
  const c = code(SRC);
  for (const state of ['staged', 'uploading', 'ready', 'failed']) {
    assert.match(
      c,
      new RegExp(`['"\`]${state}['"\`]`),
      `state literal "${state}" must be present`,
    );
  }
  assert.match(c, /attachment-chip--\$\{state\}/, 'BEM-style state modifier on className');
});

test('attachment-chip.tsx: NO dangerouslySetInnerHTML anywhere (in code, not comments)', () => {
  const c = code(SRC);
  assert.equal(
    (c.match(/dangerouslySetInnerHTML/g) ?? []).length,
    0,
    'dangerouslySetInnerHTML must NOT be used in the chip code (comments mentioning it are fine)',
  );
});

test('attachment-chip.tsx: filename truncates with a title attribute for full hover', () => {
  const c = code(SRC);
  assert.match(c, /title=\{filename\}/, 'full filename surfaces on hover');
});

test('attachment-chip.tsx: chip is a <button> when onClick provided, <span> otherwise', () => {
  const c = code(SRC);
  // Both branches present.
  assert.match(c, /<button[\s\S]*?type="button"[\s\S]*?className=\{cls\}/);
  assert.match(c, /<span\s+className=\{cls\}/);
});

test('attachment-chip.tsx: Remove + Retry buttons stopPropagation so outer onClick does not fire', () => {
  const c = code(SRC);
  // stopPropagation guards on both nested buttons.
  assert.match(
    c,
    /attachment-chip-remove[\s\S]*?e\.stopPropagation\(\)/,
    'Remove button calls e.stopPropagation()',
  );
  assert.match(
    c,
    /attachment-chip-retry[\s\S]*?e\.stopPropagation\(\)/,
    'Retry button calls e.stopPropagation()',
  );
});

test('attachment-chip.tsx: Retry is conditional on state==="failed" AND onRetry', () => {
  const c = code(SRC);
  assert.match(
    c,
    /state\s*===\s*['"]failed['"]\s*&&\s*onRetry/,
    'Retry only renders when state is failed AND onRetry provided',
  );
});

test('attachment-chip.tsx: mimeIconFor returns inline SVG (pure -- no external icon dep)', () => {
  const c = code(SRC);
  assert.match(c, /<svg/, 'mimeIconFor renders <svg> inline');
  // Check we cover the four allowlisted formats.
  assert.match(c, /application\/pdf/i);
  assert.match(c, /spreadsheetml\.sheet/i);
  assert.match(c, /text\/markdown/i);
  assert.match(c, /image\/png/i);
});

test('attachment-chip.tsx: humanizeBytes covers KB / MB / GB', () => {
  const c = code(SRC);
  assert.match(c, /KB/);
  assert.match(c, /MB/);
  assert.match(c, /GB/);
});

test('attachment-chip.tsx: data-clarity-attachment-state attribute mirrors state for test/visual hooks', () => {
  const c = code(SRC);
  assert.match(c, /data-clarity-attachment-state=\{state\}/);
});
