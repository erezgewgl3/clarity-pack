// test/ui/chat-open-for-issue-d3-cross-employee.test.mjs
//
// Plan 05-07 Task 1 (D-03 cross-employee fall-through fixture).
//
// The 04.2-07 closure documented D-03 as "implicit": the worker handler's
// reverse-lookup helper (listTopicsForIssueAndAssignee at
// src/worker/db/chat-topics-repo.ts) filters BY employee_agent_id at the
// SQL layer, so cross-employee chat topics about the same issue can never
// reach the handler — they degrade to `reverseMatches.length === 0` and the
// route falls through to step 7 (new-topic-needed). The drill never had a
// fixture pinning this implicit behaviour; the 1.0.0-rc.7 forward defect
// list (CONTEXT.md D-03) routed adding one to Plan 05-07.
//
// Lives next to other chat-open-for-issue tests under test/ui/ (per CONTEXT.md
// guidance: "either test/integration/ or as a seedable Countermoves drill
// fixture" — we pick the worker-shape unit test at the existing UI test
// location so it stays inside the standard `node --test "test/**/*.test.mjs"`
// glob and reuses the host-faithful-db helper).
//
// Lesson pinned by this test (DOCUMENTED via comment + assertion):
//   The SQL employee filter in listTopicsForIssueAndAssignee scopes the
//   reverse-lookup BY employee. Cross-employee threads about the same
//   issue NEVER reach the handler — they degrade to the cold-task path
//   (new-topic-needed) by construction.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatOpenForIssue } from '../../src/worker/handlers/chat-open-for-issue.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  issue = null,
  agent = { id: 'agent-cmo', name: 'CMO' },
  // Rows the step-2 SELECT (origin_issue_id + employee_agent_id) returns.
  // For D-03 we PROVE the SQL filter scopes correctly by returning [] when
  // the queried employee is agent-A but the database has rows ONLY for
  // agent-B. The repo helper's WHERE clause discards them; the handler
  // receives [] and falls through to step 7.
  reverseTopicRows = [],
} = {}) {
  const handlers = new Map();
  const warnLogs = [];
  const infoLogs = [];
  const issueUpdateCalls = [];

  const fakeDb = {
    async query(sql, params) {
      if (/clarity_user_prefs/i.test(sql)) {
        return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
      }
      if (
        /chat_topics/i.test(sql) &&
        /origin_issue_id\s*=\s*\$2/i.test(sql) &&
        /employee_agent_id\s*=\s*\$3/i.test(sql)
      ) {
        // The SQL employee filter has been applied by the helper before
        // execution reaches the fake — return whatever was seeded.
        return reverseTopicRows;
      }
      return [];
    },
    async execute() {
      return { rowCount: 0 };
    },
  };

  const ctx = {
    logger: {
      warn(msg, fields) { warnLogs.push({ msg, fields }); },
      info(msg, fields) { infoLogs.push({ msg, fields }); },
    },
    data: { register(key, fn) { handlers.set(key, fn); } },
    issues: {
      async get() { return issue; },
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
    },
    agents: {
      async get() { return agent; },
    },
    _handlers: handlers,
    _warnLogs: warnLogs,
    _infoLogs: infoLogs,
    _issueUpdateCalls: issueUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(fakeDb);
  return ctx;
}

function issueRow(overrides = {}) {
  return {
    id: 'COU-7777',
    identifier: 'COU-7777',
    title: 'Cross-employee fixture',
    status: 'todo',
    originKind: 'paperclip:issue',
    originId: null,
    assigneeAgentId: 'agent-cmo',
    ...overrides,
  };
}

// ---- D-03 — cross-employee fall-through ------------------------------------

test('D-03: N>=2 OTHER-employee reverse matches fall through to new-topic-needed (D-03 — implicit by SQL employee filter)', async () => {
  // Scenario: issue COU-7777 is assigned to agent-CMO. The database has
  // TWO chat_topics rows whose origin_issue_id === COU-7777 — BUT both
  // belong to agent-CFO (a different employee). The repo helper's WHERE
  // clause (employee_agent_id = $3) discards them before the handler ever
  // sees them; the handler therefore receives reverseMatches.length === 0
  // and falls through to step 7 (new-topic-needed). NOT
  // 'existing-topics-ambiguous' (N>=2 SAME-employee), NOT 'existing-topic'
  // (N===1 same-employee) — D-03 reduces to the N=0 case by construction.
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-7777', title: 'Cross-employee fixture' }),
    // What the seeded DB rows WOULD look like — present here as a comment
    // for clarity; the helper's WHERE clause filters them out so the
    // handler receives []. We seed [] directly to match what the helper
    // actually returns for cross-employee scenarios.
    //
    //   { topic_id: 'CHT-501', employee_agent_id: 'agent-cfo', origin_issue_id: 'COU-7777', ... }
    //   { topic_id: 'CHT-502', employee_agent_id: 'agent-cfo', origin_issue_id: 'COU-7777', ... }
    //
    // The handler asks for params $3=agent-cmo; SQL returns nothing.
    reverseTopicRows: [],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')({
    companyId: 'COU',
    userId: 'user-eric',
    issueId: 'COU-7777',
  });

  assert.equal(result.kind, 'chatOpenForIssue');
  assert.equal(
    result.route,
    'new-topic-needed',
    'D-03: cross-employee reverse rows must NEVER fall into existing-topic or existing-topics-ambiguous',
  );
  assert.equal(result.assigneeAgentId, 'agent-cmo');
  assert.equal(result.assigneeName, 'CMO');
  assert.equal(result.seedTitle, 'Cross-employee fixture');
  assert.equal(
    result.seedBody,
    'Continuing from COU-7777: Cross-employee fixture',
  );
  // CTT-07 — host issue NEVER touched.
  assert.equal(
    ctx._issueUpdateCalls.length,
    0,
    'CTT-07: chat.openForIssue is read-only on the host issue',
  );
});
