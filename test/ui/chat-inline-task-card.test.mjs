// test/ui/chat-inline-task-card.test.mjs
//
// Plan 04.1-08 Task 6 — source-grep contract tests for the toned-down
// inline task card. The visual tone-down lives in chat.css (Task 1); the
// TSX wrapper class stays `.inline-task-card`. This test pins the CSS
// contract (left-rule, no full border) and the JSX (ref-chip renders via
// the RefChip primitive which emits an underlined anchor).

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
const CSS = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
  'utf8',
);
const TSX = readFileSync(path.join(TT_DIR, 'inline-task-card.tsx'), 'utf8');

test('inline-task-card.tsx: file exists', () => {
  assert.ok(existsSync(path.join(TT_DIR, 'inline-task-card.tsx')));
});

test('inline-task-card: CSS — 2px LEFT-RULE in --you (toned down)', () => {
  assert.match(
    CSS,
    /\.inline-task-card\b[\s\S]*?border-left:\s*2px solid var\(--you\)/,
    'inline-task-card uses a 2px left-rule (no full border, no gradient)',
  );
});

test('inline-task-card: CSS — title uses --ink-2 (not --ink — toned down)', () => {
  // The title rule must color with --ink-2; was --ink in Plan 04.1-06.
  assert.match(
    CSS,
    /\.inline-task-card-title\b[\s\S]*?color:\s*var\(--ink-2\)/,
    'title color is --ink-2 (provenance, not hero)',
  );
});

test('inline-task-card: CSS — title is 13px weight 400 (toned down from 14.5px/500)', () => {
  assert.match(
    CSS,
    /\.inline-task-card-title\b[\s\S]*?font-size:\s*13px[\s\S]*?font-weight:\s*400/,
  );
});

test('inline-task-card: CSS — eyebrow is 9px (was 10px)', () => {
  assert.match(
    CSS,
    /\.inline-task-card-eyebrow\b[\s\S]*?font-size:\s*9px/,
    'eyebrow font-size 9px per the toned-down sketch',
  );
});

test('inline-task-card: CSS — status pill is outlined-only (no background fill)', () => {
  // The .st rule body must NOT set a background fill (background: transparent
  // is explicit, since browsers default to transparent that's a positive
  // signal). Each per-status override flips border-color + color; backgrounds
  // are kept transparent.
  assert.match(
    CSS,
    /\.inline-task-card-meta\s+\.st\b[\s\S]*?background:\s*transparent/i,
    'status pill background is transparent (outlined-only)',
  );
});

test('inline-task-card.tsx: ref-chip is the RefChip primitive (renders an anchor, not a chip box)', () => {
  // The card uses the resolve-refs RefChip primitive (Plan 02). It emits a
  // gold underlined link.
  assert.match(TSX, /RefChip/);
  assert.match(TSX, /import\s*\{?\s*RefChip\s*\}?\s*from/);
});
