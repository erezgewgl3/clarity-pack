// test/ui/reader-continue-in-chat.test.mjs
//
// Plan 04.2-01 Task 4 — source-grep contract tests for wiring the
// ContinueInChatButton into the Reader header (RCB-01). Same source-grep
// idiom as reader-view.test.mjs / reader-view-null-context.test.mjs (Node's
// runner does not load .tsx; there is no jsdom render harness in this repo).
//
// The acceptance bar: the button is rendered ONLY once issue data has loaded
// AND companyId + userId are real strings (no premature chat.openForIssue
// call with undefined ids, no flicker, no crash on the companyId === null
// detail-tab loading window — memory feedback_test-usehostcontext-null-
// companyId). The live DOM is covered by the Task 8 operator drill.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER_SRC = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader', 'index.tsx'),
  'utf8',
);
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('Reader imports ContinueInChatButton from the reader folder', () => {
  assert.match(
    READER_SRC,
    /import\s*\{\s*ContinueInChatButton\s*\}\s*from\s*['"]\.\/continue-in-chat-button(\.tsx)?['"]/,
    'Reader index.tsx must import ContinueInChatButton',
  );
});

test('Test 1 — PRESENT-WHEN-LOADED: Reader renders <ContinueInChatButton> in its tree', () => {
  const c = code(READER_SRC);
  assert.match(c, /<ContinueInChatButton\b/, 'Reader renders <ContinueInChatButton ... />');
});

test('Test 1b — the button is rendered in the loaded ReaderViewReady component (not a loading branch)', () => {
  const c = code(READER_SRC);
  // ReaderViewReady is the component reached only when companyId + userId are
  // both real strings AND issue data has loaded — the button must mount there.
  const readyIdx = c.indexOf('ReaderViewReady');
  const btnIdx = c.indexOf('<ContinueInChatButton');
  assert.ok(readyIdx >= 0, 'ReaderViewReady component exists');
  assert.ok(btnIdx > readyIdx, 'ContinueInChatButton is rendered within/after ReaderViewReady');
});

test('Test 1c — the button receives issueId, companyId, userId, companyPrefix and issue props', () => {
  // The button needs all five props (Plan Task 3 signature). Isolate the
  // <ContinueInChatButton ...> element (open tag through its closing `/>`)
  // and assert each prop is wired inside it — robust to inline comments.
  const c = code(READER_SRC);
  const open = c.indexOf('<ContinueInChatButton');
  assert.ok(open >= 0, '<ContinueInChatButton ...> element present');
  const close = c.indexOf('/>', open);
  assert.ok(close > open, 'the element has a self-closing /> tag');
  const element = c.slice(open, close + 2);
  for (const prop of ['issueId', 'companyId', 'userId', 'companyPrefix', 'issue']) {
    assert.match(
      element,
      new RegExp(`\\b${prop}=`),
      `ContinueInChatButton receives the ${prop} prop`,
    );
  }
});

test('Test 2 — ABSENT-WHILE-LOADING: the button lives only past the loading guards', () => {
  const c = code(READER_SRC);
  // The data-loading branch renders the "Loading Reader view…" placeholder and
  // returns BEFORE the populated render. The button must NOT appear inside
  // that early-return block — it sits in the populated JSX only.
  const loadingReturnIdx = c.indexOf('Loading Reader view');
  const btnIdx = c.indexOf('<ContinueInChatButton');
  assert.ok(loadingReturnIdx >= 0, 'the loading placeholder branch exists');
  assert.ok(
    btnIdx > loadingReturnIdx,
    'ContinueInChatButton is rendered after the loading-guard return, never inside it',
  );
});

test('Test 3 — NULL-CONTEXT-SAFE: companyId resolver gates the populated render (no empty-string companyId)', () => {
  // The Reader already gates the populated render behind useResolvedCompanyId
  // + useResolvedUserId (ReaderViewReady only mounts with real strings). The
  // button rides those same guards, so a companyId === null detail-tab
  // loading window never mounts the button. Negative grep: no empty-string
  // companyId fallback was introduced.
  assert.doesNotMatch(
    READER_SRC,
    /companyId\s*\?\?\s*['"]\s*['"]/,
    'no `companyId ?? ""` fallback — the resolver gate stays intact',
  );
  // The resolver gate is still wired.
  assert.match(READER_SRC, /useResolvedCompanyId\(\)/, 'useResolvedCompanyId gate intact');
  assert.match(READER_SRC, /useResolvedUserId\(\)/, 'useResolvedUserId gate intact');
});

test('Reader still renders all nine original reader subcomponents (no regression)', () => {
  for (const name of [
    'TldrStrip',
    'Breadcrumb',
    'ProseWithRefChips',
    'AnchoredToCards',
    'DeliverablePreview',
    'AcChecklist',
    'ActivityTimeline',
    'LiveBlockerPanel',
    'PauseBanner',
  ]) {
    assert.match(READER_SRC, new RegExp(`<${name}\\b`), `Reader still renders <${name} />`);
  }
});
