// test/worker/chat-topics-parent-title.test.mjs
//
// Plan 04.2-05 D7 — pure-formatter test for formatParentIssueTitle.
//
// The classic Paperclip Reader renders the parent issue's title as a clickable
// breadcrumb at the top of every child issue. When the chat surface didn't
// thread employeeName to chat.topic.create, the worker's fallback set
// `employeeName = employeeAgentId` (a UUID), so the parent title became
// "Chat — <UUID>" — visually mistaken for a styling-broken Continue button on
// a chat-topic Reader (Countermoves drill 2026-05-24 D7).
//
// formatParentIssueTitle (chat-topics.ts) is the single source of truth for
// the parent issue's title format; this test pins its behaviour by case.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { formatParentIssueTitle } from '../../src/worker/handlers/chat-topics.ts';

test('D7 case 1 — a human-friendly name renders as `Chat — <name>`', () => {
  assert.equal(formatParentIssueTitle('CEO'), 'Chat — CEO');
});

test('D7 case 2 — a multi-word name keeps the full name', () => {
  assert.equal(formatParentIssueTitle('Eric Greenwald'), 'Chat — Eric Greenwald');
});

test('D7 case 3 — a bare UUID fallback drops to `Chat thread` (no — UUID tail)', () => {
  assert.equal(
    formatParentIssueTitle('b2a22e50-d772-4b70-bb50-4f4e93c2e984'),
    'Chat thread',
  );
});

test('D7 case 4 — a UUID with surrounding whitespace still detected and trimmed', () => {
  assert.equal(
    formatParentIssueTitle('  b2a22e50-d772-4b70-bb50-4f4e93c2e984  '),
    'Chat thread',
  );
});

test('D7 case 5 — a string CONTAINING a UUID (e.g. `Agent <uuid>`) is not mis-detected', () => {
  // Only an exact-shape UUID match triggers the fallback; a name that happens
  // to include a UUID-shaped substring keeps the full "Chat — …" treatment.
  assert.equal(
    formatParentIssueTitle('Agent b2a22e50-d772-4b70-bb50-4f4e93c2e984'),
    'Chat — Agent b2a22e50-d772-4b70-bb50-4f4e93c2e984',
  );
});

test('D7 case 6 — uppercase UUID also detected (case-insensitive)', () => {
  assert.equal(
    formatParentIssueTitle('B2A22E50-D772-4B70-BB50-4F4E93C2E984'),
    'Chat thread',
  );
});
