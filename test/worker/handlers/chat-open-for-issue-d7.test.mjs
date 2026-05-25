// test/worker/handlers/chat-open-for-issue-d7.test.mjs
//
// Plan 04.2-07 Task 2 RED -> GREEN -- chat.openForIssue step-2 reverse-lookup
// + 'existing-topics-ambiguous' route (D-01 + D-04 + D-08).
//
// Closure-baseline tests (chat-open-for-issue.test.mjs Tests 1-9) MUST NOT
// regress; this file pins the NEW step-2 behaviour and its invariants.
//
// Test ctx pattern: `ctx.db.query` recognises the step-2 SELECT (joins
// chat_topics + chat_messages via GREATEST) and returns seeded rows; the
// chat_topics UPDATE (auto-unarchive) is tracked via `ctx.db.execute` calls
// on the chat_topics table — same idiom as chat-topic-archive.test.mjs Tests
// 4-6 (which spy on ctx.db.execute + ctx.issues.update).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatOpenForIssue } from '../../../src/worker/handlers/chat-open-for-issue.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  issue = null,
  issueGetThrows = false,
  agent = { id: 'agent-cmo', name: 'CMO' },
  agentGetThrows = false,
  // Plan 04.2-07 — rows the step-2 SELECT (origin_issue_id + employee_agent_id)
  // returns. snake_case (Postgres row shape).
  reverseTopicRows = [],
  // When true, the step-2 SELECT throws.
  reverseLookupThrows = false,
  // Plan 05-07 Task 1 — second-call issues.get (chat-task lineage topic
  // identifier resolution). Keyed by issueId so a single fake can serve both
  // the primary issue read AND the topic identifier read on the same fake.
  // Default: when set to null, the second issues.get returns null (no
  // identifier resolution); when an object, returns it (e.g. { identifier:
  // 'CHT-1117' }). When set to the special string 'throws', the second
  // issues.get throws.
  topicIssueLookup = null,
} = {}) {
  const handlers = new Map();
  const warnLogs = [];
  const infoLogs = [];
  const issueGetCalls = [];
  const agentGetCalls = [];
  const archiveExecuteCalls = [];
  // CTT-07 — host issue MUST stay untouched.
  const issueUpdateCalls = [];

  const fakeDb = {
    async query(sql, params) {
      if (/clarity_user_prefs/i.test(sql)) {
        return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
      }
      // Step-2 SELECT — matches the new helper's SQL (WHERE origin_issue_id + employee_agent_id).
      if (
        /chat_topics/i.test(sql) &&
        /origin_issue_id\s*=\s*\$2/i.test(sql) &&
        /employee_agent_id\s*=\s*\$3/i.test(sql)
      ) {
        if (reverseLookupThrows) throw new Error('host db.query 503 (step-2)');
        return reverseTopicRows;
      }
      return [];
    },
    async execute(sql, params) {
      if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
        archiveExecuteCalls.push({ sql, params });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  };

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info(msg, fields) {
        infoLogs.push({ msg, fields });
      },
    },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async get(issueId, companyId) {
        issueGetCalls.push({ issueId, companyId });
        // First call resolves the primary issue. Subsequent calls (Plan
        // 05-07 Task 1 — topic identifier resolution on the chat-task
        // lineage branch) are routed through topicIssueLookup.
        if (issueGetCalls.length === 1) {
          if (issueGetThrows) throw new Error('host issues.get 503');
          return issue;
        }
        // Second+ call — topic identifier resolution.
        if (topicIssueLookup === 'throws') {
          throw new Error('host issues.get 503 (topic identifier)');
        }
        return topicIssueLookup;
      },
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
    },
    agents: {
      async get(agentId, companyId) {
        agentGetCalls.push({ agentId, companyId });
        if (agentGetThrows) throw new Error('host agents.get 503');
        return agent;
      },
    },
    _handlers: handlers,
    _warnLogs: warnLogs,
    _infoLogs: infoLogs,
    _issueGetCalls: issueGetCalls,
    _agentGetCalls: agentGetCalls,
    _archiveExecuteCalls: archiveExecuteCalls,
    _issueUpdateCalls: issueUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(fakeDb);
  return ctx;
}

function params(overrides = {}) {
  return {
    companyId: 'COU',
    userId: 'user-eric',
    issueId: 'COU-2401',
    ...overrides,
  };
}

function issueRow(overrides = {}) {
  return {
    id: 'COU-2401',
    identifier: 'COU-2401',
    title: 'Fix login',
    status: 'todo',
    originKind: 'paperclip:issue',
    originId: null,
    assigneeAgentId: 'agent-cmo',
    ...overrides,
  };
}

function topicRow(overrides = {}) {
  return {
    topic_id: 'CHT-100',
    company_id: 'COU',
    issue_id: 'topic-uuid-default',
    parent_issue_id: 'p-1',
    employee_agent_id: 'agent-cmo',
    title: 'Thread',
    last_activity_at: '2026-05-22T10:00:00.000Z',
    archived: false,
    created_at: '2026-05-21T09:00:00.000Z',
    origin_issue_id: 'COU-2401',
    ...overrides,
  };
}

// ---- RED 1 — N=0 fall-through ---------------------------------------------

test('RED 1: N=0 same-assignee matches → new-topic-needed (D-03/D-11 fall-through)', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2401', title: 'Fix login' }),
    reverseTopicRows: [],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.kind, 'chatOpenForIssue');
  assert.equal(result.route, 'new-topic-needed');
  assert.equal(result.assigneeAgentId, 'agent-cmo');
  assert.equal(result.assigneeName, 'CMO');
  assert.equal(result.seedTitle, 'Fix login');
  assert.equal(result.seedBody, 'Continuing from COU-2401: Fix login');
});

// ---- RED 2 — N=1 silent resume (non-archived) -----------------------------

test('RED 2: N=1 non-archived match → existing-topic without sourceCommentId (silent resume)', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2215' }),
    reverseTopicRows: [
      topicRow({ topic_id: 'CHT-101', issue_id: 'topic-uuid-1', archived: false }),
    ],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'topic-uuid-1');
  assert.equal(result.sourceCommentId, undefined, 'no sourceCommentId on D-01 reverse resume');
  assert.equal(result.assigneeAgentId, 'agent-cmo');
  assert.equal(result.assigneeName, 'CMO');
  // No unarchive UPDATE for non-archived row.
  assert.equal(ctx._archiveExecuteCalls.length, 0, 'no chat_topics UPDATE on non-archived row');
  // CTT-07 — host issue NEVER touched.
  assert.equal(ctx._issueUpdateCalls.length, 0, 'CTT-07: ctx.issues.update zero-times called');
});

// ---- RED 3 — N=1 archived → silent resume + auto-unarchive (D-04) --------

test('RED 3: N=1 archived match → existing-topic + setChatTopicArchived(false); host issue UNTOUCHED', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2215' }),
    reverseTopicRows: [
      topicRow({ topic_id: 'CHT-77', issue_id: 'topic-uuid-arch', archived: true }),
    ],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'topic-uuid-arch');
  // setChatTopicArchived(ctx, companyId, topicIssueId, false) → UPDATE chat_topics
  // with [false, topicIssueId, companyId] params.
  assert.equal(ctx._archiveExecuteCalls.length, 1, 'auto-unarchive UPDATE fires once');
  const call = ctx._archiveExecuteCalls[0];
  assert.deepEqual(
    call.params,
    [false, 'topic-uuid-arch', 'COU'],
    'unarchive params: [false, topicIssueId, companyId]',
  );
  // CTT-07 — host issue UNTOUCHED.
  assert.equal(ctx._issueUpdateCalls.length, 0, 'CTT-07: ctx.issues.update zero-times called');
  // Log channel: info-level entry mentions unarchive.
  const unarchiveInfo = ctx._infoLogs.find((l) => /unarchive/i.test(l.msg));
  assert.ok(unarchiveInfo, 'info log records the unarchive');
});

// ---- RED 4 — N>=2 → existing-topics-ambiguous ----------------------------

test('RED 4: N>=2 matches → existing-topics-ambiguous with candidates list', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2215' }),
    reverseTopicRows: [
      topicRow({ topic_id: 'CHT-201', issue_id: 'topic-uuid-a', archived: false }),
      topicRow({ topic_id: 'CHT-202', issue_id: 'topic-uuid-b', archived: true }),
    ],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topics-ambiguous');
  assert.equal(result.assigneeAgentId, 'agent-cmo');
  assert.equal(result.assigneeName, 'CMO');
  assert.equal(result.sourceIssueIdentifier, 'COU-2215');
  assert.ok(Array.isArray(result.candidates), 'candidates is an array');
  assert.equal(result.candidates.length, 2);
  for (const c of result.candidates) {
    assert.equal(typeof c.topicId, 'string', 'topicId present');
    assert.equal(typeof c.archived, 'boolean', 'archived flag present');
    assert.equal(typeof c.topicIssueId, 'string', 'topicIssueId present');
    assert.equal(typeof c.title, 'string');
    assert.equal(typeof c.lastActivityAt, 'string');
  }
  // No unarchive on the ambiguous path.
  assert.equal(ctx._archiveExecuteCalls.length, 0);
  assert.equal(ctx._issueUpdateCalls.length, 0, 'CTT-07: host issue untouched');
});

// ---- RED 5 — D-08 hygiene (no UUID in operator-visible fields) -----------

test('RED 5: D-08 hygiene — sourceIssueIdentifier is BEAAA-NNN; candidates[i].topicId matches CHT-N', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2215' }),
    agent: { id: 'agent-cmo', name: 'CMO' },
    reverseTopicRows: [
      topicRow({
        topic_id: 'CHT-303',
        issue_id: '618ebd0d-4d39-45f4-8380-3b30b205d02d',
        archived: false,
      }),
      topicRow({
        topic_id: 'CHT-304',
        issue_id: 'aaa-bbb-ccc',
        archived: false,
      }),
    ],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.assigneeName, 'CMO');
  assert.equal(result.sourceIssueIdentifier, 'COU-2215');
  for (const c of result.candidates) {
    assert.match(c.topicId, /^CHT-\d+$/, 'topicId is CHT-N (no UUID)');
  }
});

// ---- RED 7 — chat-task lineage UNCHANGED (step-2 NOT called) -------------

test('RED 7: chat-task originId → existing-topic with topicIssueId + sourceCommentId; step-2 lookup never queried', async () => {
  // The fake db tracks query SQL — we assert no step-2 SELECT runs by
  // counting queries against the fingerprint. Wrap query to record SQL.
  const queriedSql = [];
  const baseCtx = makeCtx({
    issue: issueRow({
      originId: 'chat-task:CHT-1117:cmt-9',
      assigneeAgentId: 'agent-cfo',
      identifier: 'COU-2361',
    }),
    agent: { id: 'agent-cfo', name: 'CFO' },
    // Seed bogus rows that should NEVER be returned because step-2 won't run.
    reverseTopicRows: [
      topicRow({ topic_id: 'CHT-9999', issue_id: 'should-not-be-used' }),
    ],
  });
  // Wrap the (already-wrapped) db to record SQL.
  const innerQuery = baseCtx.db.query.bind(baseCtx.db);
  baseCtx.db.query = async (sql, p) => {
    queriedSql.push(sql);
    return innerQuery(sql, p);
  };
  registerChatOpenForIssue(baseCtx);
  const result = await baseCtx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'CHT-1117', 'topicIssueId from chat-task regex match');
  assert.equal(result.sourceCommentId, 'cmt-9');
  // No SQL queried against origin_issue_id + employee_agent_id pair.
  const step2 = queriedSql.find(
    (s) => /origin_issue_id\s*=\s*\$2/i.test(s) && /employee_agent_id\s*=\s*\$3/i.test(s),
  );
  assert.equal(step2, undefined, 'step-2 SELECT NEVER fires when chat-task lineage matches');
});

// ---- RED 8 — step-2 throw → fail-open to new-topic-needed -----------------

test('RED 8: step-2 SELECT throws → handler falls through to new-topic-needed (fail-open + warn)', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-9000', title: 'Ship it' }),
    reverseLookupThrows: true,
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'new-topic-needed', 'fails open to cold-task path');
  assert.equal(result.seedTitle, 'Ship it');
  assert.equal(result.assigneeAgentId, 'agent-cmo');
  // The throw was logged at warn level.
  const warn = ctx._warnLogs.find((l) => /listTopicsForIssueAndAssignee|step-2/i.test(l.msg));
  assert.ok(warn, 'warn-logs the step-2 throw');
});

// ---- Plan 05-07 Task 1 — D-08 topicIdentifier + sourceIssueIdentifier ----
// GAP-D8-LINEAGE-TOOLTIP / GAP-D8-REVERSE-TOOLTIP-FALLBACK closure tests.

test('D-08 lineage: chat-task lineage branch ships topicIdentifier resolved via ctx.issues.get', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originId: 'chat-task:topic-uuid-1117:cmt-9',
      identifier: 'COU-2361',
    }),
    agent: { id: 'agent-cmo', name: 'CMO' },
    // The second ctx.issues.get(topic-uuid-1117, COU) returns this row.
    topicIssueLookup: { identifier: 'CHT-1117', id: 'topic-uuid-1117' },
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'topic-uuid-1117');
  assert.equal(result.sourceCommentId, 'cmt-9');
  assert.equal(
    result.topicIdentifier,
    'CHT-1117',
    'D-08: topicIdentifier resolved via ctx.issues.get(topicIssueId)',
  );
  // Two issues.get calls — primary + topic identifier resolution.
  assert.equal(ctx._issueGetCalls.length, 2, 'two issues.get calls');
  assert.equal(
    ctx._issueGetCalls[1].issueId,
    'topic-uuid-1117',
    'second issues.get targets the topic UUID',
  );
  // CTT-07 invariant — purely read; no host issue mutation.
  assert.equal(ctx._issueUpdateCalls.length, 0, 'CTT-07: ctx.issues.update zero times');
});

test('D-08 lineage: topicIdentifier undefined when ctx.issues.get for topic throws (warn-log; no throw bubbled)', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originId: 'chat-task:topic-uuid-9999:cmt-x',
      identifier: 'COU-2361',
    }),
    topicIssueLookup: 'throws',
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'topic-uuid-9999');
  assert.equal(
    result.topicIdentifier,
    undefined,
    'D-08: topicIdentifier left undefined on resolver throw (no UUID fallback)',
  );
  const warn = ctx._warnLogs.find((l) => /topic identifier/i.test(l.msg));
  assert.ok(warn, 'warn-logged the topic identifier resolver throw');
});

test('D-08 lineage: topicIdentifier undefined when topic issue row has no identifier', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originId: 'chat-task:topic-uuid-noid:cmt-x',
      identifier: 'COU-2361',
    }),
    // Topic issue exists but lacks an identifier field — no CHT-N to ship.
    topicIssueLookup: { id: 'topic-uuid-noid' },
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(
    result.topicIdentifier,
    undefined,
    'D-08: topicIdentifier left undefined when resolved row lacks identifier',
  );
});

test('D-08 reverse-lookup: N=1 branch ships topicIdentifier from match.topicId', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2215' }),
    reverseTopicRows: [
      topicRow({ topic_id: 'CHT-501', issue_id: 'topic-uuid-rev1', archived: false }),
    ],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'topic-uuid-rev1');
  assert.equal(result.sourceCommentId, undefined, 'reverse-lookup has no source comment');
  assert.equal(
    result.topicIdentifier,
    'CHT-501',
    'D-08: topicIdentifier comes from match.topicId on the reverse-lookup branch',
  );
});

test('D-08 reverse-lookup: N=1 branch ships sourceIssueIdentifier (BEAAA-NNN from source issue)', async () => {
  const ctx = makeCtx({
    issue: issueRow({ identifier: 'COU-2215' }),
    reverseTopicRows: [
      topicRow({ topic_id: 'CHT-502', issue_id: 'topic-uuid-rev2', archived: false }),
    ],
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(
    result.sourceIssueIdentifier,
    'COU-2215',
    'D-08: sourceIssueIdentifier ships on reverse-lookup N=1 (was: ambiguous-only)',
  );
  // CTT-07 anti-regression on the new payload field path.
  assert.equal(ctx._issueUpdateCalls.length, 0, 'CTT-07: read-only path');
});

test('D-08 invariant: chat-task lineage branch does NOT trigger reverse-lookup step-2 SELECT', async () => {
  // Pinned by RED 7 already, but re-asserted here in the context of the
  // new identifier-resolution path: adding the second issues.get call
  // must NOT change the routing precedence (lineage wins).
  const queriedSql = [];
  const ctx = makeCtx({
    issue: issueRow({
      originId: 'chat-task:topic-uuid-pin:cmt-z',
      identifier: 'COU-2361',
    }),
    topicIssueLookup: { identifier: 'CHT-9001' },
    reverseTopicRows: [topicRow({ topic_id: 'CHT-NEVER', issue_id: 'never-used' })],
  });
  const innerQuery = ctx.db.query.bind(ctx.db);
  ctx.db.query = async (sql, p) => {
    queriedSql.push(sql);
    return innerQuery(sql, p);
  };
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'topic-uuid-pin');
  assert.equal(result.topicIdentifier, 'CHT-9001');
  const step2 = queriedSql.find(
    (s) => /origin_issue_id\s*=\s*\$2/i.test(s) && /employee_agent_id\s*=\s*\$3/i.test(s),
  );
  assert.equal(step2, undefined, 'step-2 reverse-lookup never fires when lineage matches');
});
