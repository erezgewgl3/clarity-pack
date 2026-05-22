// test/ui/topic-strip-backlink.test.mjs
//
// Plan 04.2-01 Task 6 — source-grep contract tests for the topic-strip
// `About <COU-NNNN> ↗` backlink chip (RCB-05). Same source-grep idiom as
// chat-shell.test.mjs (Node's runner does not load .tsx). When the active
// topic carries a non-null origin_issue_id (a topic started from a Reader),
// the strip renders a dismissible left-end chip that navigates back to the
// source issue's Reader. The live DOM is covered by the Task 8 operator drill.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STRIP = path.resolve(
  HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'topic-strip.tsx',
);
function readSrc() {
  return readFileSync(STRIP, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('topic-strip.tsx: the ChatTopic type carries an optional originIssueId', () => {
  const c = code(readSrc());
  assert.match(c, /originIssueId/, 'ChatTopic exposes originIssueId to the strip');
});

test('Test 1 — chip rendered when the active topic has an origin issue', () => {
  const c = code(readSrc());
  // The chip copy is `About <id> ↗`.
  assert.match(readSrc(), /About /, 'the About-issue chip copy is present');
  assert.match(c, /originIssueId/, 'the chip render is gated on originIssueId');
});

test('Test 2 — chip ABSENT when origin_issue_id is null (conditional render)', () => {
  const c = code(readSrc());
  // The chip is conditional — a truthiness check on originIssueId guards it.
  assert.match(
    c,
    /originIssueId\s*(\?|&&)|\bif\s*\(\s*[a-zA-Z]*[Oo]riginIssueId/,
    'the chip render is conditional on originIssueId being set',
  );
});

test('Test 3 — chip click navigates to the source issue Reader (/<prefix>/issues/<id>)', () => {
  const c = code(readSrc());
  assert.match(c, /issues\//, 'the chip navigates into /<prefix>/issues/<originIssueId>');
  // Navigation uses the host hook (SCAF-09 — no raw <a href>).
  assert.match(c, /useHostNavigation|linkProps|navigate/, 'navigates via the host navigation hook');
});

test('Test 4 — chip dismissal persists in localStorage (stays dismissed this session)', () => {
  const c = code(readSrc());
  assert.match(c, /localStorage/, 'dismissal persists in localStorage');
  // The dismissal key is topic-scoped so dismissing one chip does not hide others.
  assert.match(c, /clarity.*about.*chip|about-chip|aboutChip/i, 'a topic-scoped dismissal key is used');
});

test('topic-strip.tsx: the chip renders untrusted text only (no dangerouslySetInnerHTML)', () => {
  assert.doesNotMatch(code(readSrc()), /dangerouslySetInnerHTML/);
});
