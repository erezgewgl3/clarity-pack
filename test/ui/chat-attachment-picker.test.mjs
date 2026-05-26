// test/ui/chat-attachment-picker.test.mjs
//
// Plan 05-11 Task 5 -- source-grep contract tests for useAttachmentPicker.
// The Composer wire-up test (Task 6) covers the live render path; here we
// pin the source-level contract that load-bears the Option B upload-on-send
// invariant:
//
//   - the hidden input uses accept=".xlsx,.pdf,.md,.png"
//   - onChange STAGES (no upload network call yet); chip.state === 'staged'
//   - removeStaged drops from local state; no host call
//   - uploadAll(chatMessageId) is the ONLY entry point that fires
//     usePluginAction('chat.attachment.upload')
//   - upload chain is sequential (await runOne in a for-of loop)
//   - on failure the chip flips to 'failed' with a bound retry callback
//   - the upload payload carries the supplied chatMessageId verbatim

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');
const SRC = readFileSync(path.join(CHAT_DIR, 'attachment-picker.tsx'), 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('attachment-picker.tsx: file exists', () => {
  assert.ok(existsSync(path.join(CHAT_DIR, 'attachment-picker.tsx')));
});

test('attachment-picker.tsx: exports useAttachmentPicker and AttachmentPickerInput', () => {
  assert.match(SRC, /export function useAttachmentPicker/);
  assert.match(SRC, /export const AttachmentPickerInput/);
});

test('attachment-picker.tsx: hidden input accept=".xlsx,.pdf,.md,.png"', () => {
  // The accept literal lives in the ACCEPT constant; both render paths
  // (PickerInput from the hook AND AttachmentPickerInput) reference it.
  assert.match(SRC, /ACCEPT\s*=\s*['"]\.xlsx,\.pdf,\.md,\.png['"]/);
  const c = code(SRC);
  assert.match(c, /accept=\{ACCEPT\}/, 'both inputs use the ACCEPT constant');
});

test('attachment-picker.tsx: onChange STAGES files (state === "staged"); no upload call from the picker path', () => {
  const c = code(SRC);
  // The staged entry literal is created with state: 'staged'.
  assert.match(c, /state:\s*['"]staged['"][\s\S]*?as AttachmentChipState/);
  // Within onChange we set staged and DO NOT dispatch uploadAction (the
  // dispatch path lives in runOne, gated by uploadAll(chatMessageId)).
  const onChangeIdx = c.indexOf('const onChange');
  const closingIdx = c.indexOf('const removeStaged');
  assert.ok(onChangeIdx >= 0 && closingIdx > onChangeIdx, 'onChange block locatable');
  const onChangeBlock = c.slice(onChangeIdx, closingIdx);
  assert.equal(
    (onChangeBlock.match(/uploadAction\s*\(/g) ?? []).length,
    0,
    'onChange must NOT call uploadAction (Option B: stage-only, no upload until Send)',
  );
});

test('attachment-picker.tsx: uploadAll fires chat.attachment.upload via usePluginAction', () => {
  const c = code(SRC);
  assert.match(
    c,
    /usePluginAction\(['"]chat\.attachment\.upload['"]\)/,
    'must dispatch via usePluginAction key chat.attachment.upload',
  );
});

test('attachment-picker.tsx: upload payload carries chatMessageId verbatim from uploadAll arg', () => {
  const c = code(SRC);
  // The uploadAction call site includes the chatMessageId field.
  assert.match(c, /uploadAction\(\{[\s\S]*?chatMessageId,/);
});

test('attachment-picker.tsx: upload chain is SEQUENTIAL (for-of + await)', () => {
  const c = code(SRC);
  // for-of loop awaiting runOne -- v1 sequential path; parallel deferred.
  assert.match(
    c,
    /for\s*\(\s*const tempId of tempIds\s*\)[\s\S]*?await runOne\(tempId,\s*chatMessageId\)/,
    'uploadAll iterates staged entries sequentially via for-of + await',
  );
});

test('attachment-picker.tsx: on failure the chip flips to "failed" with onRetry bindable', () => {
  const c = code(SRC);
  assert.match(c, /state:\s*['"]failed['"]/);
  assert.match(c, /export\s+const\s+retryFor\s*=|retryFor:\s*\(tempId/);
});

test('attachment-picker.tsx: clear() resets staged to []', () => {
  const c = code(SRC);
  assert.match(c, /const\s+clear\s*=[\s\S]*?setStaged\(\[\]\)/);
});

test('attachment-picker.tsx: openPicker programmatically clicks the hidden input', () => {
  const c = code(SRC);
  assert.match(c, /inputRef\.current\?\.click\(\)/);
});

test('attachment-picker.tsx: hidden input is multiple-capable for batch picks', () => {
  assert.match(SRC, /multiple/, 'native multiple attribute present');
});

test('attachment-picker.tsx: fileToBase64 prefers Buffer (Node) but supports btoa (browser)', () => {
  const c = code(SRC);
  assert.match(c, /Buffer\.from\(bytes\)\.toString\(['"]base64['"]\)/);
  assert.match(c, /btoa\(binary\)/);
});
