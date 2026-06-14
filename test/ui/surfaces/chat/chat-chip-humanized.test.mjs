// test/ui/surfaces/chat/chat-chip-humanized.test.mjs
//
// Plan 18-02 Task 2 (LEG-02 / D-08 / D-09) — the chat CHT-<8> and run·<8> chips
// no longer render a raw id hex slice; they resolve to the human topic title /
// agent name-or-role via the single-sourced humanizeChatChip.
//
// Convention (no jsdom): a behavioral unit test on the pure humanizeChatChip
// helper + a source-grep over topic-strip.tsx / message-thread.tsx proving the
// raw `id.slice(0,8)` chip render is gone and the helper is wired in. Mirrors
// the *-no-uuid-leak.test.mjs source-grep convention.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { AGENT_FALLBACK, humanizeChatChip } from '../../../../src/shared/scrub-human-action.ts';

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const STRIP = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/chat/topic-strip.tsx'),
  'utf8',
);
const STRIP_CODE = stripComments(STRIP);
const THREAD = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/chat/message-thread.tsx'),
  'utf8',
);
const THREAD_CODE = stripComments(THREAD);

// ---------------------------------------------------------------------------
// (1) humanizeChatChip behavior (D-08/D-09).
// ---------------------------------------------------------------------------

test('humanizeChatChip — a topic chip resolves to the topic title', () => {
  assert.equal(
    humanizeChatChip({ kind: 'topic', title: 'Q3 budget approval', topicId: 'a1b2c3d4e5' }),
    'Q3 budget approval',
  );
});

test('humanizeChatChip — a topic chip with no title degrades to "this topic" (never the hex)', () => {
  assert.equal(humanizeChatChip({ kind: 'topic', title: null, topicId: 'a1b2c3d4e5' }), 'this topic');
  assert.equal(humanizeChatChip({ kind: 'topic', title: '   ', topicId: 'a1b2c3d4e5' }), 'this topic');
});

test('humanizeChatChip — a run chip with an agent name resolves to the name', () => {
  assert.equal(humanizeChatChip({ kind: 'run', agentName: 'Drafting Bot', title: 'draft v2' }), 'Drafting Bot');
});

test('humanizeChatChip — a run chip with no agent name → AGENT_FALLBACK (A4: run_link carries no name)', () => {
  assert.equal(humanizeChatChip({ kind: 'run', agentName: null, title: 'draft v2' }), AGENT_FALLBACK);
  assert.equal(humanizeChatChip({ kind: 'run' }), AGENT_FALLBACK);
});

// ---------------------------------------------------------------------------
// (2) Source-grep — the raw hex-slice chip render is gone; the helper is wired.
// ---------------------------------------------------------------------------

test('topic-strip chtLabel resolves via humanizeChatChip — no raw id.slice(0,8) hex render', () => {
  assert.match(STRIP_CODE, /humanizeChatChip\s*\(/, 'topic-strip wires humanizeChatChip');
  assert.equal(
    (STRIP_CODE.match(/\.slice\(\s*0\s*,\s*8\s*\)/g) || []).length,
    0,
    'no raw id.slice(0,8) hex render remains in topic-strip',
  );
});

test('topic-strip chtLabel preserves the legitimate CHT ordinal branches', () => {
  assert.match(STRIP_CODE, /\^CHT-\\d\+\$/, 'CHT-NN ordinal branch preserved');
  assert.match(STRIP_CODE, /\^\\d\+\$/, 'numeric ordinal branch preserved');
});

test('message-thread run_link chip resolves via humanizeChatChip — no raw runId.slice(0,8)', () => {
  assert.match(THREAD_CODE, /humanizeChatChip\s*\(\s*\{\s*kind:\s*['"]run['"]/, 'run chip wires humanizeChatChip');
  assert.equal(
    (THREAD_CODE.match(/runId\s*\?\?\s*['"]['"]\s*\)\s*\.slice\(\s*0\s*,\s*8\s*\)/g) || []).length,
    0,
    'no raw runId.slice(0,8) hex render remains in the run chip',
  );
});
