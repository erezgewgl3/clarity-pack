// test/ui/chat-message-thread-attachments.test.mjs
//
// Plan 05-11 Task 7 -- per-bubble attachment chip rendering. Source-grep
// contract gate (Node does not load .tsx). The load-bearing invariants:
//
//   - message-thread.tsx imports AttachmentChipWithPreview.
//   - ChatMessage type carries an optional `attachments` field.
//   - PersistedMessage renders a `<div className="message-attachments">`
//     wrapper only when msg.attachments is non-empty.
//   - Each chip is keyed on the stable attachment id.
//   - The chip click target is the AttachmentChipWithPreview (which opens
//     the Plan 05-04 DIST-04 DeliverablePreview popover -- verified by
//     attachment-chip-with-preview.test.mjs).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'message-thread.tsx'), 'utf8');
const WRAPPER_SRC = readFileSync(
  path.join(CHAT_DIR, 'attachment-chip-with-preview.tsx'),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODE = code(SRC);
const WRAPPER_CODE = code(WRAPPER_SRC);

test('attachment-chip-with-preview.tsx: file exists at expected path', () => {
  assert.ok(
    existsSync(path.join(CHAT_DIR, 'attachment-chip-with-preview.tsx')),
    'attachment-chip-with-preview.tsx must exist',
  );
});

test('attachment-chip-with-preview.tsx: imports DeliverablePreview from the Reader for single-source-of-truth dispatch', () => {
  assert.match(
    WRAPPER_CODE,
    /import\s*\{\s*DeliverablePreview\s*\}\s+from\s+['"]\.\.\/reader\/deliverable-preview/,
    'must import DeliverablePreview from ../reader/deliverable-preview.tsx (single source of truth)',
  );
});

test('attachment-chip-with-preview.tsx: passes documentKey through to the DeliverablePreview deliverable prop', () => {
  // The wrapper threads attachment.documentKey into deliverable.documentKey
  // so the worker dispatch fires against the canonical chat-attach-<uuid>-
  // <safefilename> key (Plan 05-11 contract extension on DeliverableProps).
  assert.match(WRAPPER_CODE, /documentKey:\s*attachment\.documentKey/);
});

test('attachment-chip-with-preview.tsx: popover dismissal -- click outside + Escape', () => {
  assert.match(WRAPPER_CODE, /mousedown/);
  assert.match(WRAPPER_CODE, /['"]Escape['"]/);
});

test('attachment-chip-with-preview.tsx: chip is rendered in ready state via AttachmentChip', () => {
  assert.match(WRAPPER_CODE, /state="ready"/);
  assert.match(WRAPPER_CODE, /onClick=\{\(\)\s*=>\s*setOpen\(\(p\)\s*=>\s*!p\)\}/);
});

test('message-thread.tsx: imports AttachmentChipWithPreview', () => {
  assert.match(
    CODE,
    /import\s*\{\s*AttachmentChipWithPreview\s*\}\s+from\s+['"]\.\/attachment-chip-with-preview/,
  );
});

test('message-thread.tsx: ChatMessage type carries an optional attachments field', () => {
  assert.match(
    SRC,
    /attachments\?:\s*Array</,
    'ChatMessage type must declare an optional attachments array',
  );
});

test('message-thread.tsx: PersistedMessage renders message-attachments wrapper only when msg.attachments is non-empty', () => {
  // The conditional renders ONLY when length > 0; an empty / undefined
  // attachments field produces no DOM (saves an empty wrapper element).
  assert.match(
    CODE,
    /msg\.attachments\s*&&\s*msg\.attachments\.length\s*>\s*0\s*\?[\s\S]*?message-attachments[\s\S]*?AttachmentChipWithPreview/,
    'must render <div className="message-attachments"> with AttachmentChipWithPreview when attachments are present',
  );
});

test('message-thread.tsx: each AttachmentChipWithPreview is keyed on attachment.id', () => {
  assert.match(
    CODE,
    /<AttachmentChipWithPreview[\s\S]*?key=\{a\.id\}/,
    'stable key on every chip in the .map() (no react-key warnings)',
  );
});

test('message-thread.tsx: chip wrapper receives companyId + userId + topicIssueId for the DeliverablePreview dispatch', () => {
  assert.match(
    CODE,
    /<AttachmentChipWithPreview[\s\S]*?companyId=\{companyId\}[\s\S]*?userId=\{userId\}[\s\S]*?topicIssueId=\{topicIssueId\}/,
  );
});

// ---- Hotfix 2026-05-26 (chip-click-overflow-clip) regression tests ----
//
// The Plan 05-11 ship rendered the popover as `position: absolute`
// anchored to a wrapper <span>. In the right-rail use-case the .ctx
// container has `overflow-y: auto`, so the absolutely-positioned popover
// was clipped behind the rail's overflow context. Chip clicks toggled
// state but the popover was invisible / unreachable -- live drill
// 2026-05-26 18:30 "clicking chips in the right-rail does nothing".
//
// Hotfix: switch to a fixed-inset backdrop + centered body shell,
// matching the canonical true-task-dialog pattern (Plan 04.1-09). The
// shell escapes ALL parent overflow contexts. These regression tests
// pin (a) the backdrop wrapper exists, (b) backdrop click closes,
// (c) clicks inside the popover stop propagation, (d) the close button
// affordance ships, (e) the CSS uses position: fixed (not absolute).

test('attachment-chip-with-preview.tsx: popover renders inside a fixed-inset backdrop overlay (escapes parent overflow contexts)', () => {
  assert.match(
    WRAPPER_CODE,
    /className="attachment-popover-backdrop"/,
    'must render a backdrop overlay so the popover escapes .ctx { overflow-y: auto }',
  );
});

test('attachment-chip-with-preview.tsx: backdrop click closes the popover', () => {
  // The backdrop <div> has onClick={() => setOpen(false)} so an outside
  // click anywhere on the backdrop closes the preview.
  assert.match(
    WRAPPER_CODE,
    /attachment-popover-backdrop[\s\S]*?onClick=\{\(\)\s*=>\s*setOpen\(false\)\}/,
    'backdrop onClick must close the popover',
  );
});

test('attachment-chip-with-preview.tsx: clicks INSIDE the popover body stop propagation (no accidental close)', () => {
  // The popover body has onClick={(e) => e.stopPropagation()} so the
  // operator can scroll + interact with the preview without
  // accidentally bubbling up to the backdrop's close handler.
  assert.match(
    WRAPPER_CODE,
    /className="attachment-popover"[\s\S]*?onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
    'popover body onClick must stopPropagation',
  );
});

test('attachment-chip-with-preview.tsx: explicit close button affordance is rendered + closes', () => {
  // The popover body carries a `<button className="attachment-popover-close">`
  // with aria-label and onClick={() => setOpen(false)}.
  assert.match(
    WRAPPER_CODE,
    /className="attachment-popover-close"/,
    'close button class is present',
  );
  assert.match(
    WRAPPER_CODE,
    /attachment-popover-close[\s\S]*?aria-label="Close preview"/,
    'close button is announced to screen readers',
  );
});

test('attachment-chip-with-preview.tsx: popover carries role="dialog" + aria-modal="true" (matches true-task-dialog convention)', () => {
  assert.match(WRAPPER_CODE, /role="dialog"/);
  assert.match(WRAPPER_CODE, /aria-modal="true"/);
});

// ---- CSS regression: position: fixed (not absolute) -------------------
//
// The chat.css selectors must back the new shell. We verify that:
//   - .attachment-popover-backdrop carries `position: fixed; inset: 0`
//   - .attachment-popover is `position: relative` (lives inside the
//     flex-centered backdrop)
//   - The old `position: absolute` rule is GONE from the .attachment-popover
//     declaration block so it does not clip in .ctx.

const CSS_PATH = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'styles',
  'chat.css',
);
const CSS = readFileSync(CSS_PATH, 'utf8');

test('chat.css: .attachment-popover-backdrop uses position: fixed + inset: 0 (escapes parent overflow)', () => {
  assert.match(
    CSS,
    /\.attachment-popover-backdrop\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/,
    'backdrop must be fixed-inset',
  );
});

test('chat.css: .attachment-popover is NOT position: absolute (regression guard for overflow-clip bug)', () => {
  // Extract just the .attachment-popover block (the first one -- without
  // -backdrop or -close suffix).
  const blockMatch = CSS.match(
    /\[data-clarity-surface="chat"\]\s+\.attachment-popover\s*\{[^}]*\}/,
  );
  assert.ok(blockMatch, '.attachment-popover declaration block exists');
  assert.doesNotMatch(
    blockMatch[0],
    /position:\s*absolute/,
    'popover MUST NOT be position: absolute (would clip in .ctx)',
  );
  // It IS position: relative inside the flex-centered backdrop.
  assert.match(blockMatch[0], /position:\s*relative/);
});

test('chat.css: backdrop z-index > 50 so it lifts above any sibling content', () => {
  assert.match(
    CSS,
    /\.attachment-popover-backdrop\s*\{[^}]*z-index:\s*(?:1[0-9]{2,}|[2-9][0-9])/,
    'backdrop z-index must be >= 50 so it lifts above the rail content',
  );
});
