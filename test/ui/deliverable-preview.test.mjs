// test/ui/deliverable-preview.test.mjs
//
// Plan 05-04 Task 2 (DIST-04) -- source-grep pins for the rewritten
// DeliverablePreview UI dispatcher. Mirrors the reader-view.test.mjs style
// (Node native --test cannot load .tsx, so contract checks are source-grep
// based; runtime DOM checks live in the visual-regression + manual drill).
//
// Pins:
//   U1 — export contract preserved (`export function DeliverablePreview`)
//   U2 — wires usePluginData('deliverable.preview', ...)
//   U3 — imports from 'react-markdown'
//   U4 — NO dangerouslySetInnerHTML (T-05-04-05 + check-a11y R3)
//   U5 — <img> carries alt= (check-a11y R1)
//   U6 — pdf branch uses literal <embed type="application/pdf">
//   U7 — switch on data.kind covers all five worker-side kinds
//   U8 — error fallback renders the load-bearing visible string

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

function read() {
  return readFileSync(FILE, 'utf8');
}

test('U1: deliverable-preview.tsx still exports DeliverablePreview', () => {
  assert.match(read(), /export function DeliverablePreview/);
});

test('U2: file wires usePluginData with key "deliverable.preview"', () => {
  assert.match(read(), /usePluginData[\s\S]*['"]deliverable\.preview['"]/);
});

test('U3: file imports react-markdown', () => {
  assert.match(read(), /from\s+['"]react-markdown['"]/);
});

test('U4: file does NOT actually USE dangerouslySetInnerHTML (R3 invariant)', () => {
  // R3 invariant pins the actual prop USAGE, not documentary comments
  // (which are stripped by scripts/check-a11y.mjs before the static
  // check). We match the JSX attribute form `dangerouslySetInnerHTML=`
  // -- a literal usage would always have an `=` after the prop name.
  const src = read();
  assert.doesNotMatch(
    src,
    /dangerouslySetInnerHTML\s*=/,
    'dangerouslySetInnerHTML prop must not be used in DeliverablePreview',
  );
});

test('U5: <img> branch carries alt= (R1 invariant)', () => {
  const src = read();
  // The img tag must have an alt attribute. We grep the whole opening tag.
  assert.match(src, /<img[\s\S]*?\balt=/, '<img> must carry alt=');
});

test('U6: pdf branch uses literal <embed type="application/pdf">', () => {
  assert.match(read(), /<embed[\s\S]*?type=["']application\/pdf["']/);
});

test('U7: switch on data.kind covers all five kinds + placeholder', () => {
  const src = read();
  assert.match(src, /switch\s*\(\s*data\.kind\s*\)/);
  for (const kind of [
    "'xlsx-grid'",
    "'pdf-embed'",
    "'md'",
    "'img'",
    "'text'",
    "'placeholder'",
  ]) {
    assert.ok(
      src.includes(`case ${kind}`),
      `expected case ${kind} in the dispatch switch`,
    );
  }
});

test('U8: error fallback renders the load-bearing visible string', () => {
  // "Preview unavailable — open in classic Paperclip." is the contract
  // string the operator sees on any { error } envelope or unknown kind.
  // Em-dash is the literal character used in src; assertion uses the same.
  // T1-B — this literal is now the DEFAULT branch of deliverableErrorReason();
  // it must still be present in source.
  assert.match(
    read(),
    /Preview unavailable — open in classic Paperclip\./,
  );
});

test('U13 (T1-B): the text kind renders the body in a <pre> (inline text preview)', () => {
  const src = read();
  assert.ok(src.includes("case 'text'"), 'text case present in dispatch switch');
  assert.match(src, /<pre[\s\S]*?\{data\.body\}/, 'text body rendered inside <pre>');
});

test('U14 (T1-B): error reasons are mapped per-code, not a single opaque line', () => {
  const src = read();
  // The mapping function exists and distinguishes the common failure modes so
  // the operator sees an honest reason (too-large vs parse-fail vs read-fail).
  assert.match(src, /function deliverableErrorReason/);
  assert.ok(src.includes('DELIVERABLE_TOO_LARGE'), 'too-large is given a specific reason');
  assert.ok(src.includes('PARSE_FAILED'), 'parse-failure is given a specific reason');
  assert.ok(src.includes('READ_FAILED'), 'read-failure is given a specific reason');
  // The error branch calls the mapper (no single hard-coded opaque line).
  assert.match(src, /deliverableErrorReason\(data\.error/);
});

// U9 + U10 pin the GAP-DIST-04-NOT-RENDERING (2026-05-26) fix: the
// "no deliverable" path must render an explicit empty-state message so a
// future refactor does NOT silently reintroduce the disappearing section.
// Background: when issue.reader's data.deliverable is null (the live
// behavior for every issue with only host-uploaded attachments -- see the
// SPEC-implementation §7.14 vs §7.15 storage split), the previous code
// did `if (!deliverable) return null` and removed the entire "The
// deliverable" section from the DOM with zero operator-visible signal.

test('U9: no-deliverable path MUST NOT silently return null', () => {
  // The literal `if (!deliverable) return null` is the silent-failure
  // anti-pattern this fix removes. A regression that re-adds it would
  // re-introduce GAP-DIST-04-NOT-RENDERING.
  //
  // Strip comments before scanning so a docstring mentioning the legacy
  // anti-pattern (Plan 05-11 explanatory text) does not trip the gate.
  const src = read()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    src,
    /if\s*\(\s*!\s*deliverable\s*\)\s*return\s+null/,
    'DeliverablePreview must NOT silently return null on missing deliverable -- it must render an empty-state message instead (GAP-DIST-04-NOT-RENDERING).',
  );
});

// Plan 05-11 (CHAT-07 gap closure 2026-05-26) -- U10 literal-lock UPDATED in
// the same commit that adds the 3-branch logic. The 38e6ffa U10 copy is
// REPLACED: when there is no plugin-tracked deliverable AND no chat
// attachments, the operator now sees a copy that POINTS them at the chat
// composer (the live upload path Plan 05-11 wires up). U9 anti-pattern
// guard is PRESERVED unchanged.

test('U10 (Plan 05-11 supersede): empty-state copy points at the chat composer', () => {
  // The new locked literal. The 38e6ffa copy ("No plugin-tracked
  // deliverable on this issue. Host-uploaded attachments appear in
  // Paperclip's Attachments panel above ...") is REPLACED because chat-
  // uploaded attachments now ARE plugin-tracked and the operator should be
  // routed to the chat composer as the canonical upload path.
  assert.match(
    read(),
    /No deliverables on this issue yet\./,
    'updated empty-state copy must mention "No deliverables on this issue yet."',
  );
  assert.match(
    read(),
    /Upload via the chat composer/,
    'updated empty-state must point at the chat composer (Clarity Chat tab) as the canonical upload path',
  );
});

test('U11 (Plan 05-11): 3-branch logic -- when chat attachments exist, the empty-state is BYPASSED', () => {
  // The code path branches on `!deliverable && !newestChatAttach`. We pin
  // the source-grep contract: the chat-attachment fetch runs in parallel
  // (chat.attachment.list with topicIssueId=issueId, limit=1), and the
  // empty-state branch fires ONLY when both are null.
  const src = read();
  assert.match(
    src,
    /usePluginData[\s\S]*?['"]chat\.attachment\.list['"]/,
    'must dispatch a parallel chat.attachment.list lookup for the 3-branch logic',
  );
  assert.match(
    src,
    /if\s*\(\s*!deliverable\s*&&\s*!newestChatAttach\s*\)/,
    'empty-state must guard on BOTH deliverable AND newestChatAttach being null (3-branch contract)',
  );
});

test('U12 (Plan 05-11): newestChatAttach becomes the de-facto deliverable when no Reader-tracked deliverable exists', () => {
  // Branch (b): effectiveDeliverable is constructed from the newest chat
  // attachment when `deliverable` is null. The dispatcher fires through
  // the SAME Plan 05-04 worker handler.
  const src = read();
  assert.match(
    src,
    /effectiveDeliverable[\s\S]*?newestChatAttach!\.originalFilename/,
    'effectiveDeliverable.filename falls back to newestChatAttach.originalFilename',
  );
  assert.match(
    src,
    /effectiveDocumentKey[\s\S]*?effectiveDeliverable\.documentKey/,
    'effectiveDocumentKey overrides filename when documentKey is present (chat-attachment path)',
  );
});
