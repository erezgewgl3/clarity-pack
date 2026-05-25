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

// ---------------------------------------------------------------------------
// Plan 04.1-09 — WRAPPER FIXED. Drill fix #2a from 2026-05-20.
// The Plan 04.1-08 build wrapped the card in `<article className="msg">`.
// The `.msg` class is the chat-bubble grid (`grid-template-columns: 34px
// 1fr`) — the card has no avatar so it collapsed into the 34px column and
// the UUID title wrapped char-by-char. The new wrapper is the non-grid
// `.inline-task-card-row` block. The `title` prop also accepts `null` to
// render a skeleton placeholder during the 15s race window before
// chat.taskOwned catches up.
// ---------------------------------------------------------------------------

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('inline-task-card.tsx (Plan 04.1-09): wrapper is .inline-task-card-row (NOT the 34px-column .msg grid)', () => {
  const c = code(TSX);
  // The .msg wrapper that caused the 34px-column squeeze must be gone from
  // the JSX (it stays referenced in comments only).
  assert.doesNotMatch(
    c,
    /className="msg"/,
    'wrapper class must NOT be "msg" (.msg is the chat-bubble grid with 34px avatar column)',
  );
  // The new wrapper class is .inline-task-card-row.
  assert.match(
    c,
    /className="inline-task-card-row"/,
    'wrapper class must be "inline-task-card-row" (a non-grid block)',
  );
});

test('inline-task-card.tsx (Plan 04.1-09): title prop accepts null + renders a skeleton placeholder', () => {
  // The title prop type now accepts null; when null the title slot renders
  // a .clarity-loading-skeleton placeholder.
  assert.match(
    TSX,
    /title:\s*string\s*\|\s*null/,
    'title prop type must accept null (the skeleton state)',
  );
  assert.match(
    TSX,
    /clarity-loading-skeleton/,
    'the skeleton placeholder class must render in the title slot when title is null',
  );
  // The null guard is present in the title slot's render branch.
  assert.match(
    TSX,
    /title === null/,
    'the title slot must branch on the null state to render the skeleton',
  );
});

test('inline-task-card.tsx (Plan 04.1-09): a11y label degrades gracefully when title is null', () => {
  // The Plan 04.1-08 build interpolated the title (which could be a UUID)
  // into the aria-label. The new code guards on null and reads "loading
  // title" instead.
  assert.match(
    TSX,
    /loading title/,
    'a11y label must degrade to "loading title" when title prop is null',
  );
});

// ---------------------------------------------------------------------------
// Plan 05-06 item (g) — optimistic Todo render. The Plan 04.1-09 build mapped
// null/undefined status through ChatTaskStatusPill's null branch which renders
// the muted `· — ·` loader. Item (g): InlineTaskCard now coerces status to
// 'todo' before passing to the pill, so the operator sees `Todo` immediately
// while waiting for chat.taskOwned to reconcile. Coercion is scoped to
// InlineTaskCard — ChatTaskStatusPill's null branch is unchanged, so any
// other call site that genuinely wants the `· — ·` loader still gets it.
// ---------------------------------------------------------------------------

test('inline-task-card.tsx (Plan 05-06 item g): pill receives optimistic "todo" coercion when status is null', () => {
  const c = code(TSX);
  // The pill call site must apply the optimistic coercion — either by passing
  // `status ?? 'todo'` directly, or via an intermediate `statusForPill`
  // variable computed as `status ?? 'todo'`.
  assert.match(
    c,
    /status\s*\?\?\s*['"]todo['"]/,
    'inline-task-card must coerce a null status to "todo" before passing to the pill',
  );
});

test('inline-task-card.tsx (Plan 05-06 item g): statusLabel default is "todo" (was "pending")', () => {
  const c = code(TSX);
  // The aria-label string carries the human-readable status. The Plan 04.1-09
  // build defaulted to "pending" (which contradicts the visible Todo render).
  // Item (g): default is "todo".
  assert.match(
    c,
    /statusLabel\s*=\s*status\s*\?\?\s*['"]todo['"]/,
    'statusLabel default must be "todo" (matches the optimistic pill render)',
  );
  assert.doesNotMatch(
    c,
    /statusLabel\s*=\s*status\s*\?\?\s*['"]pending['"]/,
    'old "pending" default must be REMOVED — Plan 05-06 item (g)',
  );
});

test('inline-task-card.tsx (Plan 05-06 item g): ChatTaskStatusPill null branch is NOT modified', () => {
  // The optimism is scoped to InlineTaskCard. The chat-task-status-pill
  // primitive must keep its null/undefined branch (`· — ·`) for other
  // potential callers. The pill module is unchanged by this plan.
  const PILL = readFileSync(
    path.join(TT_DIR, 'chat-task-status-pill.tsx'),
    'utf8',
  );
  assert.match(
    PILL,
    /Status: loading/,
    'pill must keep the "Status: loading" aria-label branch (the null/undefined render)',
  );
});

test('chat.css (Plan 04.1-09): .inline-task-card-row is a non-grid block that lets the card breathe full width', () => {
  // The .inline-task-card-row rule must set display: block (NOT a grid),
  // width: 100%, and a reasonable max-width.
  const block = CSS.match(/\.inline-task-card-row\s*\{([^}]*)\}/);
  assert.ok(block, '.inline-task-card-row must be styled');
  assert.match(block[1], /display:\s*block/, 'inline-task-card-row is display: block');
  assert.match(block[1], /width:\s*100%/, 'inline-task-card-row is full width');
  // No grid-template-columns on the row (would re-introduce the 34px squeeze).
  assert.doesNotMatch(
    block[1],
    /grid-template-columns/,
    'inline-task-card-row must NOT use a grid (regression guard for the 34px squeeze bug)',
  );
});

test('chat.css (Plan 04.1-09): .clarity-loading-skeleton is styled for the title-pending state', () => {
  // The skeleton placeholder uses --ink-3 + italic to read as "still
  // resolving" without screaming "error".
  assert.match(
    CSS,
    /\.clarity-loading-skeleton\s*\{[\s\S]*?color:\s*var\(--ink-3\)[\s\S]*?font-style:\s*italic/,
    '.clarity-loading-skeleton must be muted italic (the calm pending look)',
  );
});
