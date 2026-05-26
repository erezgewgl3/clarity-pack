// test/ui/reader-empty-state-with-chat-attachments.test.mjs
//
// Plan 05-11 Task 7 -- Reader empty-state 3-branch refinement.
//
// Branches:
//   (a) data.deliverable !== null
//        -> existing Plan 05-04 DIST-04 dispatcher fires (unchanged).
//   (b) data.deliverable === null AND chatAttachments.length > 0
//        -> dispatch the previewer against the newest chat attachment as
//         the de-facto deliverable; effectiveDocumentKey overrides
//         effectiveDeliverable.filename as the worker param.
//   (c) both null
//        -> updated empty-state copy:
//         "No deliverables on this issue yet. Upload via the chat composer
//          (Clarity Chat tab)."
//
// U9 anti-pattern guard (no `if (!deliverable) return null`) is PRESERVED
// from the 38e6ffa fix. U10 literal-copy lock is REPLACED in the same
// commit that adds the 3-branch logic (D-24-style atomic test+code swap).
//
// This file is a parallel source-grep gate to deliverable-preview.test.mjs
// dedicated to the 3-branch contract.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'deliverable-preview.tsx',
);
const SRC = readFileSync(FILE, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODE = code(SRC);

// --- Branch (c): empty-state copy ---

test('Branch C: empty-state copy mentions "No deliverables on this issue yet."', () => {
  assert.match(CODE, /No deliverables on this issue yet\./);
});

test('Branch C: empty-state copy points at the chat composer', () => {
  assert.match(CODE, /Upload via the chat composer/);
});

test('Branch C: U9 anti-pattern guard preserved (NO `if (!deliverable) return null`)', () => {
  assert.doesNotMatch(
    CODE,
    /if\s*\(\s*!\s*deliverable\s*\)\s*return\s+null/,
    'U9: must not silently return null on missing deliverable',
  );
});

test('Branch C: empty-state condition guards on BOTH deliverable AND newestChatAttach', () => {
  assert.match(
    CODE,
    /if\s*\(\s*!deliverable\s*&&\s*!newestChatAttach\s*\)/,
    'empty-state branch must fire only when BOTH are null',
  );
});

// --- Branch (b): chat-attachment as de-facto deliverable ---

test('Branch B: parallel usePluginData chat.attachment.list fetch with topicIssueId=issueId, limit=1', () => {
  assert.match(
    CODE,
    /usePluginData[\s\S]*?chat\.attachment\.list/,
    'parallel chat.attachment.list fetch must be present',
  );
  assert.match(CODE, /topicIssueId:\s*issueId/, 'topicIssueId aliased from issueId');
  assert.match(CODE, /limit:\s*1/, 'limit=1 for the de-facto-deliverable check');
});

test('Branch B: effectiveDeliverable is built from newestChatAttach when deliverable is null', () => {
  assert.match(
    CODE,
    /effectiveDeliverable[\s\S]*?newestChatAttach!\.originalFilename/,
  );
  assert.match(
    CODE,
    /effectiveDeliverable[\s\S]*?newestChatAttach!\.createdAt/,
  );
  assert.match(
    CODE,
    /effectiveDeliverable[\s\S]*?newestChatAttach!\.documentKey/,
  );
});

test('Branch B: effectiveDocumentKey overrides filename when documentKey is present', () => {
  assert.match(
    CODE,
    /const\s+effectiveDocumentKey\s*=[\s\S]*?effectiveDeliverable\.documentKey\s*\?\?\s*effectiveDeliverable\.filename/,
  );
});

// --- Branch (a): existing happy path unchanged on the Reader call site ---

test('Branch A: worker dispatch uses effectiveDocumentKey (the contract extension)', () => {
  assert.match(
    CODE,
    /documentKey:\s*effectiveDocumentKey/,
    'the deliverable.preview worker param must use effectiveDocumentKey',
  );
});

test('Branch A: DeliverableProps.deliverable optional documentKey field present', () => {
  // The type extension. We grep the export type.
  assert.match(
    SRC,
    /deliverable:[\s\S]*?documentKey\?:\s*string/,
    'DeliverableProps.deliverable carries optional documentKey for Plan 05-11 callers',
  );
});

test('Branch A: section header renders unconditionally (U9 preserved across all 3 branches)', () => {
  // Both the empty-state branch and the dispatcher branch render the same
  // <h3>The deliverable</h3> header. We pin the literal so a future fix
  // cannot accidentally remove it from either branch.
  const headerMatches = (CODE.match(/<h3>The deliverable<\/h3>/g) ?? []).length;
  assert.ok(
    headerMatches >= 2,
    `expected the deliverable header to render in at least 2 branches; got ${headerMatches}`,
  );
});
