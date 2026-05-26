// test/ui/chat-context-rail-recent-attachments.test.mjs
//
// Plan 05-11 Task 8 -- right-rail Recent Attachments wire-up. Source-grep
// contract gate. The load-bearing invariants:
//
//   - The "Attachments are temporarily unavailable" literal is GONE from
//     the code (placeholder block REPLACED).
//   - context-rail.tsx fetches via usePluginData('chat.attachment.list',
//     { topicIssueId, companyId, userId, limit: 5 }).
//   - When the topic has attachments, the rail-attachments wrapper
//     renders one AttachmentChipWithPreview per row, keyed on a.id.
//   - When the topic has no attachments, the empty-state copy is
//     "No attachments on this topic yet."
//   - When no topic is selected, "Select a topic to see attachments."
//   - The Storage Pin block (Plan 05-08 D-20) is UNCHANGED -- its
//     'Pinned — exempt from archive' literal must still be present.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'chat',
  'context-rail.tsx',
);
const SRC = readFileSync(SRC_PATH, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODE = code(SRC);

test('context-rail.tsx: "Attachments are temporarily unavailable" literal is GONE from code', () => {
  assert.equal(
    (CODE.match(/Attachments are temporarily unavailable/g) ?? []).length,
    0,
    'placeholder block must be replaced by Plan 05-11 live wire-up',
  );
});

test('context-rail.tsx: imports AttachmentChipWithPreview', () => {
  assert.match(
    CODE,
    /import\s*\{\s*AttachmentChipWithPreview\s*\}\s+from\s+['"]\.\/attachment-chip-with-preview/,
  );
});

test('context-rail.tsx: usePluginData("chat.attachment.list", { topicIssueId, companyId, userId, limit: 5 })', () => {
  assert.match(
    CODE,
    /usePluginData[\s\S]*?['"]chat\.attachment\.list['"]/,
  );
  assert.match(CODE, /topicIssueId:\s*topic\.issueId/);
  assert.match(CODE, /limit:\s*5/);
});

test('context-rail.tsx: skip-fetch idiom when no topic is selected (empty params)', () => {
  // The pattern matches chat.messages above; empty params {} when topic is null.
  assert.match(
    CODE,
    /topic\s*\?\s*\{\s*topicIssueId:\s*topic\.issueId[\s\S]*?\}\s*:\s*\{\s*\}/,
  );
});

test('context-rail.tsx: rail-attachments wrapper renders one AttachmentChipWithPreview per row, keyed on a.id', () => {
  assert.match(CODE, /rail-attachments/);
  assert.match(
    CODE,
    /recentAttachments\.map\(\s*\(a\)\s*=>\s*\(\s*<AttachmentChipWithPreview[\s\S]*?key=\{a\.id\}/,
  );
});

test('context-rail.tsx: empty-state copy "No attachments on this topic yet." when topic has zero attachments', () => {
  assert.match(CODE, /No attachments on this topic yet\./);
});

test('context-rail.tsx: no-topic empty-state copy "Select a topic to see attachments."', () => {
  assert.match(CODE, /Select a topic to see attachments\./);
});

test('context-rail.tsx: Storage Pin block (Plan 05-08 D-20) is UNCHANGED -- "Pinned — exempt from archive" literal present', () => {
  assert.match(SRC, /Pinned\s*—\s*exempt from archive/);
});

test('context-rail.tsx: Storage Pin block dispatches chat.topic.pin (D-20 invariant preserved)', () => {
  assert.match(CODE, /usePluginAction\(['"]chat\.topic\.pin['"]\)/);
});

test('context-rail.tsx: AttachmentChipWithPreview receives topic.issueId for the DeliverablePreview dispatch', () => {
  assert.match(
    CODE,
    /<AttachmentChipWithPreview[\s\S]*?topicIssueId=\{topic\.issueId\}/,
  );
});
