// test/ui/continue-in-chat-button-d8.test.mjs
//
// Plan 05-07 Task 1 — D-08 source-grep contract test. The Reader-header
// Continue-in-chat button must consume the new `topicIdentifier`
// (GAP-D8-LINEAGE-TOOLTIP) and the reverse-lookup `sourceIssueIdentifier`
// (GAP-D8-REVERSE-TOOLTIP-FALLBACK) fields that the worker handler now
// ships. The `'this issue'` fallback on the reverse-lookup tooltip is kept
// as a defensive guard against a future worker contract violation that
// drops sourceIssueIdentifier — documented in the source as such.
//
// Same source-grep idiom as continue-in-chat-button-d9.test.mjs (Node's
// test runner does not load .tsx).

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
  'continue-in-chat-button.tsx',
);

function rawSrc() {
  return readFileSync(FILE, 'utf8');
}
function strippedSrc() {
  return rawSrc()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ---- T1 — type declaration -----------------------------------------------

test('D-08 T1 — ChatOpenForIssueResult type declares topicIdentifier?: string', () => {
  const src = strippedSrc();
  assert.match(
    src,
    /topicIdentifier\?\s*:\s*string/,
    'expected topicIdentifier?: string on the ChatOpenForIssueResult type',
  );
});

// ---- T2 — lineage tooltip consumes topicIdentifier first -----------------

test('D-08 T2 — chat-task lineage tooltip uses `result.topicIdentifier ?? result.topicIssueId`', () => {
  const src = strippedSrc();
  // The tooltip expression for the lineage branch (`has sourceCommentId`)
  // MUST use the topicIdentifier with a UUID fallback. We pin the literal
  // `result.topicIdentifier ?? result.topicIssueId` so a regression that
  // drops the topicIdentifier consumption is caught.
  assert.match(
    src,
    /result\.topicIdentifier\s*\?\?\s*result\.topicIssueId/,
    'expected `result.topicIdentifier ?? result.topicIssueId` in the lineage tooltip',
  );
});

// ---- T3 — reverse-lookup tooltip preserves defensive `'this issue'` -----

test('D-08 T3 — reverse-lookup tooltip uses `result.sourceIssueIdentifier ?? \'this issue\'`', () => {
  const src = strippedSrc();
  assert.match(
    src,
    /result\.sourceIssueIdentifier\s*\?\?\s*'this issue'/,
    'expected the defensive `?? \'this issue\'` fallback to be preserved',
  );
});

// ---- T4 — fallback rationale documented in source -----------------------

test('D-08 T4 — header comment block documents the `worker contract violation` rationale', () => {
  // Use RAW source (comments NOT stripped) for this assertion.
  const src = rawSrc();
  assert.match(
    src,
    /worker contract violation/,
    'expected a comment citing the `worker contract violation` rationale for the defensive fallback',
  );
});

// ---- T5 — header comment references Plan 05-07 + the GAP- IDs -----------

test('D-08 T5 — header comment block cites Plan 05-07 + GAP-D8-LINEAGE-TOOLTIP + GAP-D8-REVERSE-TOOLTIP-FALLBACK', () => {
  const src = rawSrc();
  assert.match(src, /05-07/, 'expected Plan 05-07 reference in the source comments');
  assert.match(src, /GAP-D8-LINEAGE-TOOLTIP/, 'expected GAP-D8-LINEAGE-TOOLTIP citation');
  assert.match(
    src,
    /GAP-D8-REVERSE-TOOLTIP-FALLBACK/,
    'expected GAP-D8-REVERSE-TOOLTIP-FALLBACK citation',
  );
});

// ---- T6 — NO_UUID_LEAK invariant: topicIssueId appears only in expected sites -

test('D-08 T6 — topicIssueId references stay within their allowed sites', () => {
  // After this plan's edit, `topicIssueId` should appear in code (NOT
  // counting JSDoc / comment text) at a SMALL, KNOWN set of sites:
  //   1. ChatOpenForIssueCandidate.topicIssueId (type field).
  //   2. ChatOpenForIssueResult.topicIssueId (type field).
  //   3. The `data.topicIssueId` route-precondition check inside buildChatNav.
  //   4. The `topicIssueId: data.topicIssueId,` pass-through key.
  //   5. The `topicIssueId: data.topicIssueId,` pass-through value.
  //   6. The `result.topicIssueId &&` precondition in the tooltip route check.
  //   7. The `result.topicIssueId` degrade-fallback inside the `??` expression.
  //
  // Strip comments + comment-only lines, then count code occurrences. The
  // expected count is 7; if it grows, this assertion fails so the reviewer
  // can confirm whether the new site is a degrade-acceptable reference or
  // an actual UUID leak in operator-visible text.
  const src = strippedSrc();
  const matches = src.match(/topicIssueId/g) ?? [];
  assert.equal(
    matches.length,
    7,
    `expected exactly 7 in-code references to topicIssueId; found ${matches.length}. Audit each new occurrence for D-08 UUID-leak hygiene.`,
  );
});
