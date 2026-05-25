// test/ui/reverse-topics-link-entry-point.test.mjs
//
// Plan 04.2-07 Task 4 — source-grep contract test for the lifted popover
// state machine on reverse-topics-link.tsx (D-02). Same source-grep idiom as
// reverse-topics-link.test.mjs (Node's runner does not load .tsx).
//
// Locks the new contract:
//   - Three new props: entryPoint, filterToAssignee, autoOpen
//   - ReverseTopic type adds optional employeeAgentId
//   - React.useEffect that opens the popover when autoOpen flips true
//   - visibleTopics derivation filters by employeeAgentId when filterToAssignee
//     is a non-empty string
//   - Picker row click still emits the unchanged buildTopicDeepLink contract
//     (D-07 — parseChatDeepLink NOT extended)

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
  'reverse-topics-link.tsx',
);

function code() {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ---- T1 — entryPoint prop declaration -------------------------------------

test('T1 — ReverseTopicsLinkProps declares entryPoint?: "continue-in-chat" | "manual"', () => {
  const src = code();
  assert.match(
    src,
    /entryPoint\?\s*:\s*'continue-in-chat'\s*\|\s*'manual'/,
    "expected entryPoint?: 'continue-in-chat' | 'manual' in props",
  );
});

// ---- T2 — filterToAssignee prop declaration -------------------------------

test('T2 — ReverseTopicsLinkProps declares filterToAssignee?: string | null', () => {
  const src = code();
  assert.match(
    src,
    /filterToAssignee\?\s*:\s*string\s*\|\s*null/,
    'expected filterToAssignee?: string | null in props',
  );
});

// ---- T3 — autoOpen prop declaration ---------------------------------------

test('T3 — ReverseTopicsLinkProps declares autoOpen?: boolean', () => {
  const src = code();
  assert.match(
    src,
    /autoOpen\?\s*:\s*boolean/,
    'expected autoOpen?: boolean in props',
  );
});

// ---- T4 — useEffect references autoOpen -----------------------------------

test('T4 — React.useEffect block references autoOpen (controlled auto-open)', () => {
  const src = code();
  assert.match(
    src,
    /React\.useEffect\([\s\S]{0,400}autoOpen/,
    'expected React.useEffect that references autoOpen',
  );
});

// ---- T5 — visibleTopics filter derivation ---------------------------------

test('T5 — visibleTopics derivation filters by employeeAgentId === filterToAssignee', () => {
  const src = code();
  assert.match(
    src,
    /visibleTopics[\s\S]{0,200}filterToAssignee/,
    'expected visibleTopics derivation that consults filterToAssignee',
  );
  assert.match(
    src,
    /employeeAgentId\s*===\s*filterToAssignee/,
    'expected the filter predicate to compare employeeAgentId === filterToAssignee',
  );
});

// ---- T6 — buildTopicDeepLink row navigation unchanged (D-07 lock) --------

test('T6 — row click still calls buildTopicDeepLink(companyPrefix, t.topicIssueId) (D-07 lock)', () => {
  const src = code();
  assert.match(
    src,
    /buildTopicDeepLink\s*\(\s*companyPrefix\s*,\s*t\.topicIssueId\s*\)/,
    'expected buildTopicDeepLink(companyPrefix, t.topicIssueId) call (D-07 deep-link contract unchanged)',
  );
});

// ---- T7 — no buildChatDeepLink with existing-topics-ambiguous route ------

test('T7 — file does NOT emit a chat deep link with route: existing-topics-ambiguous (D-07 lock)', () => {
  const src = code();
  assert.doesNotMatch(
    src,
    /route\s*:\s*'existing-topics-ambiguous'/,
    'the chat surface must never see the ambiguous route — picker emits existing-topic URL_HASH',
  );
});

// ---- T8 — ReverseTopic adds optional employeeAgentId field ----------------

test('T8 — ReverseTopic type adds optional employeeAgentId?: string', () => {
  const src = code();
  assert.match(
    src,
    /employeeAgentId\?\s*:\s*string/,
    'expected ReverseTopic to expose employeeAgentId?: string for the filter',
  );
});

// ---- T9 — .map iterates visibleTopics --------------------------------------

test('T9 — .map call iterates visibleTopics (not topicsForIssue directly)', () => {
  const src = code();
  assert.match(
    src,
    /visibleTopics\.map\(/,
    'expected visibleTopics.map( ... ) in the row render',
  );
});
