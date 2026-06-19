// test/worker/chat/chat-topic-task-updates.test.mjs
//
// quick-260619-r4v Piece 3 — chat.topicTaskUpdates DATA handler.
//
// Read-time reflection: per the OPEN topic, enumerate its linked tasks
// (chat_topic_tasks, cap ~20), enrich each via ctx.issues.get for
// { identifier, status, assignee }, and read the latest AGENT-authored comment
// via ctx.issues.listComments(taskIssueId). polishTldr the agent comment;
// operator comments are NEVER selected/polished. Blocked tasks (isTopicStuck)
// carry blocked:true + the named recovery action. NO_UUID_LEAK on every string.
//
// ANTI-STORM (load-bearing): across populated AND empty inputs the handler
// performs ZERO ctx.issues.list, ZERO writes, ZERO requestWakeup, ZERO event
// subscriptions. All reads (issues.get / listComments / db.query) run
// in-dispatch (PR #6547 invocation-scope-safe).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerChatTopicTaskUpdates,
} from '../../../src/worker/handlers/chat-topic-task-updates.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  // chatTopicTasks: side-table seed (already filtered by company+topic).
  // Each entry: { taskIssueId }.
  chatTopicTasks = [],
  // issueRows: by id, the ctx.issues.get response row.
  issueRows = {},
  // commentsByIssue: by issueId, the listComments response array.
  commentsByIssue = {},
  // issueGetFailsFor: set of taskIssueIds where ctx.issues.get throws.
  issueGetFailsFor = new Set(),
  // selectThrows: when truthy, the side-table SELECT throws.
  selectThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  const issueListCalls = [];
  const issueGetCalls = [];
  const listCommentsCalls = [];
  const wakeCalls = [];
  const eventSubs = [];

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info() {},
    },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async list(input) {
        issueListCalls.push(input);
        return [];
      },
      async get(issueId, companyId) {
        issueGetCalls.push({ issueId, companyId });
        if (issueGetFailsFor.has(issueId)) {
          throw new Error(`host issues.get 503 for ${issueId}`);
        }
        return issueRows[issueId] ?? null;
      },
      async listComments(issueId, companyId) {
        listCommentsCalls.push({ issueId, companyId });
        return commentsByIssue[issueId] ?? [];
      },
      async requestWakeup(...args) {
        wakeCalls.push(args);
      },
    },
    events: {
      on(...args) {
        eventSubs.push(args);
      },
      subscribe(...args) {
        eventSubs.push(args);
      },
    },
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topic_tasks/i.test(sql)) {
          if (selectThrows) throw new Error('host db.query 503');
          return chatTopicTasks.map((r) => ({ task_issue_id: r.taskIssueId }));
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _calls: calls,
    _warnLogs: warnLogs,
    _issueListCalls: issueListCalls,
    _issueGetCalls: issueGetCalls,
    _listCommentsCalls: listCommentsCalls,
    _wakeCalls: wakeCalls,
    _eventSubs: eventSubs,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function topicTaskParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    ...overrides,
  };
}

function issueRow(overrides = {}) {
  return {
    id: 'T1',
    identifier: 'COU-11',
    title: 'Task A',
    status: 'in_progress',
    assignee: { id: 'agent-cto', name: 'CTO' },
    ...overrides,
  };
}

function agentComment(body, createdAt, overrides = {}) {
  return {
    id: `c-${createdAt}`,
    body,
    createdAt,
    authorUserId: null,
    authorAgentId: 'agent-cto',
    ...overrides,
  };
}

function operatorComment(body, createdAt, overrides = {}) {
  return {
    id: `c-${createdAt}`,
    body,
    createdAt,
    authorUserId: 'user-eric',
    authorAgentId: null,
    ...overrides,
  };
}

// ---- Registration --------------------------------------------------------

test('chat.topicTaskUpdates: handler registers under exactly chat.topicTaskUpdates', () => {
  const ctx = makeCtx();
  registerChatTopicTaskUpdates(ctx);
  assert.ok(ctx._handlers.has('chat.topicTaskUpdates'));
  assert.equal(ctx._handlers.size, 1);
});

test('registerChatTopicTaskUpdates is exported as a function', async () => {
  const mod = await import('../../../src/worker/handlers/chat-topic-task-updates.ts');
  assert.equal(typeof mod.registerChatTopicTaskUpdates, 'function');
});

// ---- Opt-in + required params --------------------------------------------

test('chat.topicTaskUpdates: opted-out caller -> { error: OPT_IN_REQUIRED }', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

test('chat.topicTaskUpdates: missing companyId -> { error: COMPANY_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatTopicTaskUpdates(ctx);
  const p = topicTaskParams();
  delete p.companyId;
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(p);
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.topicTaskUpdates: missing topicIssueId -> { error: TOPIC_ISSUE_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatTopicTaskUpdates(ctx);
  const p = topicTaskParams();
  delete p.topicIssueId;
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(p);
  assert.equal(result.error, 'TOPIC_ISSUE_ID_REQUIRED');
});

// ---- Render state: WORKING (no comment) ----------------------------------

test('chat.topicTaskUpdates: no comment yet -> latestComment null (Working…)', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1' }],
    issueRows: { T1: issueRow({ id: 'T1', status: 'in_progress' }) },
    commentsByIssue: { T1: [] },
  });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  assert.equal(result.kind, 'topicTaskUpdates');
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].latestComment, null);
  assert.equal(result.cards[0].status, 'in_progress');
  assert.equal(result.cards[0].blocked, false);
});

// ---- Render state: latest AGENT comment selected + polished --------------

test('chat.topicTaskUpdates: picks the NEWEST agent comment, never the operator comment', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1' }],
    issueRows: { T1: issueRow({ id: 'T1', status: 'in_review' }) },
    commentsByIssue: {
      T1: [
        agentComment('First agent note', '2026-01-01T00:00:00Z'),
        operatorComment('operator nudge', '2026-01-02T00:00:00Z'),
        agentComment('Done — pushed the branch', '2026-01-03T00:00:00Z'),
      ],
    },
  });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  const card = result.cards[0];
  assert.ok(card.latestComment, 'latest comment present');
  assert.match(card.latestComment.text, /pushed the branch/);
  // The operator comment is never the chosen one.
  assert.ok(!/operator nudge/i.test(card.latestComment.text));
  assert.equal(card.latestComment.createdAt, '2026-01-03T00:00:00Z');
});

test('chat.topicTaskUpdates: an operator-only comment thread -> latestComment null (no operator polish)', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1' }],
    issueRows: { T1: issueRow({ id: 'T1', status: 'todo' }) },
    commentsByIssue: {
      T1: [operatorComment('only operator text here', '2026-01-02T00:00:00Z')],
    },
  });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  assert.equal(result.cards[0].latestComment, null, 'operator comments are never selected');
});

// ---- Render state: BLOCKED — needs you -----------------------------------

test('chat.topicTaskUpdates: stuck task -> blocked:true + named recovery action', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1' }],
    issueRows: {
      T1: issueRow({
        id: 'T1',
        status: 'blocked',
        activeRecoveryAction: { recoveryOwnerName: 'Eric' },
      }),
    },
    commentsByIssue: { T1: [] },
  });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  const card = result.cards[0];
  assert.equal(card.blocked, true);
  assert.equal(card.blockedAction, 'Eric');
});

// ---- NO_UUID_LEAK scrub ---------------------------------------------------

test('chat.topicTaskUpdates: UUID in agent comment / assignee / action is scrubbed', async () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1' }],
    issueRows: {
      T1: issueRow({
        id: 'T1',
        status: 'in_progress',
        assignee: { id: uuid, name: uuid },
        activeRecoveryAction: { recoveryOwnerName: `waiting on ${uuid}` },
      }),
    },
    commentsByIssue: {
      T1: [agentComment(`Handed to ${uuid} for review`, '2026-01-03T00:00:00Z')],
    },
  });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  const card = result.cards[0];
  const RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  assert.ok(!RE.test(card.assignee), 'assignee scrubbed');
  assert.ok(card.latestComment && !RE.test(card.latestComment.text), 'comment text scrubbed');
  if (card.blockedAction) assert.ok(!RE.test(card.blockedAction), 'blocked action scrubbed');
});

// ---- Cap ~20 + shown/total/capped ----------------------------------------

test('chat.topicTaskUpdates: caps at 20 cards with capped:true + total/shown', async () => {
  const seed = [];
  const rows = {};
  const comments = {};
  for (let i = 0; i < 20; i += 1) {
    const id = `K${i}`;
    seed.push({ taskIssueId: id });
    rows[id] = issueRow({ id, identifier: `COU-${i}`, status: 'todo' });
    comments[id] = [];
  }
  const ctx = makeCtx({ chatTopicTasks: seed, issueRows: rows, commentsByIssue: comments });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  assert.equal(result.capped, true);
  assert.equal(result.shown, 20);
  assert.equal(result.total, 20);
});

// ---- Per-row failure tolerance -------------------------------------------

test('chat.topicTaskUpdates: a failed enrich is counted in skipped, not a silent total drop', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T-GOOD' }, { taskIssueId: 'T-BAD' }],
    issueRows: { 'T-GOOD': issueRow({ id: 'T-GOOD', status: 'todo' }) },
    commentsByIssue: { 'T-GOOD': [] },
    issueGetFailsFor: new Set(['T-BAD']),
  });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 2);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].issueId, 'T-GOOD');
});

// ---- EMPTY topic ----------------------------------------------------------

test('chat.topicTaskUpdates: empty topic -> cards:[] (no enrich calls)', async () => {
  const ctx = makeCtx({ chatTopicTasks: [] });
  registerChatTopicTaskUpdates(ctx);
  const result = await ctx._handlers.get('chat.topicTaskUpdates')(topicTaskParams());
  assert.equal(result.kind, 'topicTaskUpdates');
  assert.deepEqual(result.cards, []);
  assert.equal(ctx._issueGetCalls.length, 0);
  assert.equal(ctx._listCommentsCalls.length, 0);
});

// ---- ANTI-STORM (load-bearing): zero list / write / wake / events --------

test('chat.topicTaskUpdates: ZERO issues.list / db.execute / requestWakeup / events — populated AND empty', async () => {
  const ctxP = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1' }],
    issueRows: { T1: issueRow({ id: 'T1', status: 'in_progress' }) },
    commentsByIssue: { T1: [agentComment('a note', '2026-01-03T00:00:00Z')] },
  });
  registerChatTopicTaskUpdates(ctxP);
  await ctxP._handlers.get('chat.topicTaskUpdates')(topicTaskParams());

  const ctxE = makeCtx({ chatTopicTasks: [] });
  registerChatTopicTaskUpdates(ctxE);
  await ctxE._handlers.get('chat.topicTaskUpdates')(topicTaskParams());

  for (const ctx of [ctxP, ctxE]) {
    assert.equal(ctx._issueListCalls.length, 0, 'zero ctx.issues.list');
    const executes = ctx._calls.filter((c) => c.kind === 'execute');
    assert.equal(executes.length, 0, 'zero ctx.db.execute (read path)');
    assert.equal(ctx._wakeCalls.length, 0, 'zero requestWakeup');
    assert.equal(ctx._eventSubs.length, 0, 'zero event subscriptions');
  }
});
