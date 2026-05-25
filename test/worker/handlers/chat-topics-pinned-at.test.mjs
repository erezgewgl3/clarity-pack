// test/worker/handlers/chat-topics-pinned-at.test.mjs
//
// Plan 05-08 Task 2 -- chat.topics carrier extension (D-20).
//
// The chat.topics response now carries `pinnedAt` on every returned topic
// row, sourced from the migration-0010 chat_topics.pinned_at column. The
// chat right-rail Storage pin card reads it to render live pinned state
// without a second round-trip.
//
// Tests 15 + 16:
//  - For a row whose pinned_at is non-null, response carries the ISO string.
//  - For a row whose pinned_at is null, response carries explicit null
//    (NOT undefined; UI consumers can treat null as "not pinned" without
//    needing to check for field presence).
//  - All pre-existing fields are preserved.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatTopics } from '../../../src/worker/handlers/chat-topics.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ topics = [] } = {}) {
  const handlers = new Map();
  const ctx = {
    logger: { warn() {}, info() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async get(id) {
        // Used by resolveOriginIdentifiers; harmless null when origin_issue_id
        // is missing.
        return { id, identifier: null };
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return [{ opted_in_at: '2026-01-01T00:00:00.000Z' }];
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
          return topics;
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

const PINNED_AT = '2026-05-25T12:00:00Z';

const sampleRows = [
  {
    topic_id: 'CHT-1',
    company_id: 'co-1',
    issue_id: 'issue-1',
    parent_issue_id: 'parent-1',
    employee_agent_id: 'agent-cfo',
    title: 'Pinned topic',
    last_activity_at: '2026-05-25T10:00:00.000Z',
    archived: false,
    created_at: '2026-05-20T00:00:00.000Z',
    origin_issue_id: null,
    pinned_at: PINNED_AT,
  },
  {
    topic_id: 'CHT-2',
    company_id: 'co-1',
    issue_id: 'issue-2',
    parent_issue_id: 'parent-1',
    employee_agent_id: 'agent-cfo',
    title: 'Unpinned topic',
    last_activity_at: '2026-05-24T10:00:00.000Z',
    archived: false,
    created_at: '2026-05-19T00:00:00.000Z',
    origin_issue_id: null,
    pinned_at: null,
  },
];

// ---- Test 15 — chat.topics surfaces pinnedAt as ISO when set, null otherwise

test('chat.topics: response carries pinnedAt for each topic row (ISO string when set, null when null)', async () => {
  const ctx = makeCtx({ topics: sampleRows });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topics')({
    companyId: 'co-1',
    userId: 'user-eric',
    employeeAgentId: 'agent-cfo',
  });
  assert.equal(result.kind, 'topics');
  assert.equal(result.topics.length, 2);
  assert.equal(result.topics[0].pinnedAt, PINNED_AT);
  assert.equal(result.topics[1].pinnedAt, null);
  // Explicit null (not undefined) — the UI distinguishes these two cases.
  assert.ok('pinnedAt' in result.topics[0]);
  assert.ok('pinnedAt' in result.topics[1]);
  assert.notEqual(result.topics[1].pinnedAt, undefined);
});

// ---- Test 16 — existing fields preserved (snapshot of expected shape) ---

test('chat.topics: pinnedAt is additive — all pre-existing fields preserved', async () => {
  const ctx = makeCtx({ topics: [sampleRows[1]] });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topics')({
    companyId: 'co-1',
    userId: 'user-eric',
    employeeAgentId: 'agent-cfo',
  });
  const t = result.topics[0];
  // Snapshot-compare: every pre-existing field is present.
  const expectedKeys = new Set([
    'topicId',
    'issueId',
    'parentIssueId',
    'employeeAgentId',
    'title',
    'lastActivityAt',
    'archived',
    'originIssueId',
    'originIssueIdentifier',
    'pinnedAt',
  ]);
  for (const k of expectedKeys) {
    assert.ok(k in t, `topic row missing field ${k}`);
  }
  // No unexpected fields snuck in.
  const actualKeys = new Set(Object.keys(t));
  for (const k of actualKeys) {
    assert.ok(
      expectedKeys.has(k),
      `topic row carries unexpected field ${k} (snapshot drift)`,
    );
  }
});
