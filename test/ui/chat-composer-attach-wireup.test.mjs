// test/ui/chat-composer-attach-wireup.test.mjs
//
// Plan 05-11 Task 6 -- composer attachment wire-up. Source-grep contract
// gate (Node does not load .tsx). The load-bearing Option B invariants:
//
//   - ATTACHMENTS_AVAILABLE const GONE; the Attachments are temporarily
//     unavailable literal NOT present.
//   - The composer imports useAttachmentPicker + AttachmentChip.
//   - The 📎 Attach button is enabled (only disabled on the `disabled` prop);
//     onClick is wired to openPicker.
//   - <PickerInput /> is mounted inside the composer wrapper.
//   - A composer-attachments wrapper renders one AttachmentChip per staged
//     entry.
//   - handleSend chains: chat.send -> uploadAll(messageUuid).
//   - Send button is disabled while any chip is in 'uploading' state.
//   - On chat.send failure, uploadAll is NOT called.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSER = readFileSync(
  path.resolve(
    HERE,
    '..',
    '..',
    'src',
    'ui',
    'surfaces',
    'chat',
    'composer.tsx',
  ),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODE = code(COMPOSER);

test('composer.tsx: ATTACHMENTS_AVAILABLE constant is GONE', () => {
  assert.equal(
    (CODE.match(/ATTACHMENTS_AVAILABLE/g) ?? []).length,
    0,
    'ATTACHMENTS_AVAILABLE must be removed in the code (Plan 05-11 closes the NO-PATH gap)',
  );
});

test('composer.tsx: Attachments are temporarily unavailable literal is GONE from code', () => {
  assert.equal(
    (CODE.match(/Attachments are temporarily unavailable/g) ?? []).length,
    0,
    'placeholder copy must be removed (Plan 05-11 flips to live)',
  );
});

test('composer.tsx: imports useAttachmentPicker + AttachmentChip', () => {
  assert.match(CODE, /import\s*\{\s*useAttachmentPicker\s*\}\s+from\s+['"]\.\/attachment-picker/);
  assert.match(CODE, /import\s*\{\s*AttachmentChip\s*\}\s+from\s+['"]\.\/attachment-chip/);
});

test('composer.tsx: 📎 Attach button onClick wires to openPicker', () => {
  // The button literal "📎 Attach" remains; onClick={openPicker} replaces
  // the old disabled-with-title-message pattern.
  assert.match(CODE, /📎 Attach/);
  assert.match(CODE, /onClick=\{openPicker\}/);
});

test('composer.tsx: <PickerInput /> mounted inside the composer wrapper', () => {
  assert.match(CODE, /<PickerInput\s*\/>/);
});

test('composer.tsx: composer-attachments wrapper renders one AttachmentChip per staged entry', () => {
  assert.match(CODE, /composer-attachments/);
  assert.match(CODE, /staged\.map\(\s*\(a\)\s*=>\s*\(\s*<AttachmentChip/);
});

test('composer.tsx: handleSend chains chat.send -> uploadAll(messageUuid)', () => {
  // Look for the order of doSend (which dispatches chat.send) followed by
  // uploadAll(messageUuid) within the same async block.
  assert.match(
    CODE,
    /const ok\s*=\s*await doSend\(messageUuid,[\s\S]*?await uploadAll\(messageUuid\)/,
    'handleSend awaits doSend, then awaits uploadAll(messageUuid)',
  );
});

test('composer.tsx: Send button is disabled while any chip is uploading', () => {
  assert.match(CODE, /anyUploading\s*=\s*staged\.some\(\s*\(s\)\s*=>\s*s\.state\s*===\s*['"]uploading['"]/);
  // The Send <button>'s disabled prop ORs anyUploading in.
  assert.match(
    CODE,
    /disabled=\{[\s\S]*?anyUploading[\s\S]*?\}\s*>\s*SEND/,
    'SEND button disabled while a chip is mid-upload',
  );
});

test('composer.tsx: on chat.send failure, uploadAll is NOT called', () => {
  // The handleSend chain returns early when doSend resolves to !ok.
  assert.match(
    CODE,
    /if\s*\(\s*!ok\s*\)\s*\{[\s\S]*?return\s*;[\s\S]*?\}/,
    'short-circuits on doSend failure -- staged chips remain for retry',
  );
});

test('composer.tsx: doSend now returns Promise<boolean>', () => {
  assert.match(CODE, /async\s*\(messageUuid:\s*string,\s*body:\s*string\):\s*Promise<boolean>/);
});

test('composer.tsx: AttachmentChip onRetry uses lastChatMessageId for the SAME FK target', () => {
  assert.match(
    CODE,
    /onRetry=\{[\s\S]*?a\.lastChatMessageId/,
    'failed chip Retry binds against the lastChatMessageId stored on the staged entry',
  );
});

test('composer.tsx: hidden file input acceptance is .xlsx,.pdf,.md,.png via PickerInput (the hook owns the literal)', () => {
  // The composer doesn't restate the accept string -- the hook does. We
  // verify via the hook's source (the attachment-picker.test.mjs gate),
  // and pin the import here.
  assert.match(CODE, /useAttachmentPicker/);
});
