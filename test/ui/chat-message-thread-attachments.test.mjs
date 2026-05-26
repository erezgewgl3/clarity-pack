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
