// test/worker/handlers/chat-archived-topics-all.test.mjs
//
// Plan 05-08 Task 2 -- chat.archivedTopics handler extension.
//
// Previously (Plan 04.1-08): handler REQUIRED employeeAgentId and returned
// EMPLOYEE_AGENT_ID_REQUIRED when missing. Powers the chat right-rail
// archive panel.
//
// Now (Plan 05-08 D-15): employeeAgentId is OPTIONAL. When omitted, the
// handler returns the company-scoped archived listing for the archive
// full-view page at /<companyPrefix>/archive. The existing employee-scoped
// path is preserved unchanged. Response shape grows the `pinnedAt` field
// (D-20 carrier).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatArchivedTopics } from '../../../src/worker/handlers/chat-archived-topics.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ optedIn = true, archivedRows = [] } = {}) {
  const handlers = new Map();
  const calls = [];
  const ctx = {
    logger: { warn() {}, info() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {},
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (
          /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics[\s\S]*archived\s*=\s*true/i.test(
            sql,
          )
        ) {
          return archivedRows;
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _calls: calls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

const sampleRows = [
  {
    topic_id: 'CHT-1',
    company_id: 'co-1',
    issue_id: 'issue-archived-1',
    parent_issue_id: 'parent-1',
    employee_agent_id: 'agent-cfo',
    title: 'Pricing thread',
    last_activity_at: '2026-05-20T00:00:00.000Z',
    archived: true,
    created_at: '2026-05-20T00:00:00.000Z',
    archived_at: '2026-05-21T00:00:00.000Z',
    pinned_at: '2026-05-22T00:00:00.000Z',
  },
  {
    topic_id: 'CHT-2',
    company_id: 'co-1',
    issue_id: 'issue-archived-2',
    parent_issue_id: 'parent-1',
    employee_agent_id: 'agent-ceo',
    title: 'Older thread',
    last_activity_at: '2026-05-18T00:00:00.000Z',
    archived: true,
    created_at: '2026-05-18T00:00:00.000Z',
    archived_at: '2026-05-19T00:00:00.000Z',
    pinned_at: null,
  },
];

// ---- Test 13 — existing employee-scoped path is unchanged --------------

test('chat.archivedTopics: employeeAgentId path runs listArchivedChatTopicsForEmployee', async () => {
  const ctx = makeCtx({ archivedRows: [sampleRows[0]] });
  registerChatArchivedTopics(ctx);
  const result = await ctx._handlers.get('chat.archivedTopics')({
    companyId: 'co-1',
    userId: 'user-eric',
    employeeAgentId: 'agent-cfo',
  });
  assert.equal(result.kind, 'archivedTopics');
  assert.equal(result.topics.length, 1);
  // The SQL fired carries employee_agent_id filter (Plan 04.1-08 path).
  const archivedQuery = ctx._calls.find(
    (c) => c.kind === 'query' && /archived\s*=\s*true/i.test(c.sql),
  );
  assert.ok(
    /employee_agent_id\s*=\s*\$2/i.test(archivedQuery.sql),
    'employee-scoped WHERE includes employee_agent_id = $2',
  );
});

// ---- Test 14 — omitted employeeAgentId hits the all-archived path -------

test('chat.archivedTopics: omitted employeeAgentId -> company-scoped listing with pinnedAt', async () => {
  const ctx = makeCtx({ archivedRows: sampleRows });
  registerChatArchivedTopics(ctx);
  const result = await ctx._handlers.get('chat.archivedTopics')({
    companyId: 'co-1',
    userId: 'user-eric',
    // employeeAgentId omitted
  });
  assert.equal(result.kind, 'archivedTopics');
  assert.equal(result.topics.length, 2);
  // pinnedAt surfaces for both rows (ISO when set, null otherwise).
  assert.equal(result.topics[0].pinnedAt, '2026-05-22T00:00:00.000Z');
  assert.equal(result.topics[1].pinnedAt, null);
  // The SQL fired is the company-scoped variant (no employee_agent_id in WHERE).
  const archivedQuery = ctx._calls.find(
    (c) => c.kind === 'query' && /archived\s*=\s*true/i.test(c.sql),
  );
  const whereClause = archivedQuery.sql.match(/WHERE[\s\S]*?ORDER\s+BY/i)?.[0] ?? '';
  assert.doesNotMatch(
    whereClause,
    /employee_agent_id/i,
    'company-scoped WHERE has no employee_agent_id',
  );
  assert.match(
    archivedQuery.sql,
    /pinned_at/i,
    'SELECT pulls pinned_at (D-20 carrier)',
  );
});

// ---- empty employeeAgentId string ('') treated as omitted ---------------

test('chat.archivedTopics: empty employeeAgentId string -> company-scoped path', async () => {
  const ctx = makeCtx({ archivedRows: sampleRows });
  registerChatArchivedTopics(ctx);
  const result = await ctx._handlers.get('chat.archivedTopics')({
    companyId: 'co-1',
    userId: 'user-eric',
    employeeAgentId: '',
  });
  assert.equal(result.kind, 'archivedTopics');
  assert.equal(result.topics.length, 2);
});

// ---- EMPLOYEE_AGENT_ID_REQUIRED is retired ------------------------------

test('chat.archivedTopics: no longer returns EMPLOYEE_AGENT_ID_REQUIRED', async () => {
  const ctx = makeCtx();
  registerChatArchivedTopics(ctx);
  const result = await ctx._handlers.get('chat.archivedTopics')({
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.notEqual(result.error, 'EMPLOYEE_AGENT_ID_REQUIRED');
});

// ---- companyId / userId still required (data-handler convention) -------

test('chat.archivedTopics: missing companyId -> COMPANY_ID_REQUIRED', async () => {
  const ctx = makeCtx();
  registerChatArchivedTopics(ctx);
  const result = await ctx._handlers.get('chat.archivedTopics')({
    userId: 'user-eric',
  });
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.archivedTopics: missing userId is intercepted by opt-in guard (returns OPT_IN_REQUIRED before USER_ID_REQUIRED)', async () => {
  // The wrapDataHandler opt-in guard treats absent userId as opted-out
  // (cannot identify caller, refuse to serve). USER_ID_REQUIRED is still
  // wired as a defensive inner check but the outer guard fires first in
  // practice. Per src/worker/opt-in-guard.ts:69 `if (!userId) return false`.
  const ctx = makeCtx();
  registerChatArchivedTopics(ctx);
  const result = await ctx._handlers.get('chat.archivedTopics')({
    companyId: 'co-1',
  });
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});
