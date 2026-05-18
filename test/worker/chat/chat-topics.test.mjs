// test/worker/chat/chat-topics.test.mjs
//
// Plan 04-04 Task A (data half) + Task B (action half) — chat-topics handler.
//
// chat-topics registers TWO handler keys:
//   - chat.topics (DATA): lists chat_topics rows for a selected employee-agent,
//     company-scoped, ordered by last_activity_at desc.
//   - chat.topic.create (ACTION): creates a child topic issue assigned to the
//     employee-agent and inserts a chat_topics row. The per-employee
//     `Chat — <employee>` parent issue is resolved O(1) via
//     getEmployeeParentIssueId (BLOCKER-3 — no issue-tree scan); on the
//     first-ever topic the parent is created and recorded via
//     insertEmployeeParent.
//
// Task A writes the chat.topics data tests; Task B appends the
// chat.topic.create action tests below the marked divider.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatTopics } from '../../../src/worker/handlers/chat-topics.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// makeCtx wires an in-memory ctx covering BOTH handler keys.
// `topics` seeds chat_topics; `parents` seeds chat_employee_parents (keyed by
// employee_agent_id); `maxChtN` controls the CHT-NN allocator.
function makeCtx({
  optedIn = true,
  topics = [],
  parents = {},
  maxChtN = 0,
  createIssueThrows = false,
} = {}) {
  const handlers = new Map();
  const createdIssues = [];
  const insertedTopics = [];
  const insertedParents = [];
  const parentStore = { ...parents };

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
      async create(input) {
        if (createIssueThrows) throw new Error('host issues.create 503');
        const id = `issue-${createdIssues.length + 1}`;
        const row = { id, ...input };
        createdIssues.push(row);
        return row;
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/MAX\(CAST/i.test(sql)) {
          return [{ max_n: maxChtN > 0 ? maxChtN : null }];
        }
        if (/chat_employee_parents/i.test(sql)) {
          // getEmployeeParentIssueId: WHERE company_id=$1 AND employee_agent_id=$2
          const employeeAgentId = params?.[1];
          const pid = parentStore[employeeAgentId];
          return pid ? [{ parent_issue_id: pid }] : [];
        }
        if (/chat_topics/i.test(sql)) {
          // listChatTopicsForEmployee — WHERE company_id=$1 AND employee_agent_id=$2
          if (/WHERE company_id = \$1 AND employee_agent_id = \$2/i.test(sql)) {
            const employeeAgentId = params?.[1];
            return topics
              .filter((t) => t.employee_agent_id === employeeAgentId)
              .slice()
              .sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1));
          }
          // getChatTopicByIssueId: WHERE company_id=$1 AND issue_id=$2
          const issueId = params?.[1];
          const found = [...topics, ...insertedTopics].find((t) => t.issue_id === issueId);
          return found ? [found] : [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/INSERT INTO .*chat_employee_parents/i.test(sql)) {
          const employeeAgentId = params[1];
          if (!(employeeAgentId in parentStore)) {
            parentStore[employeeAgentId] = params[2];
          }
          insertedParents.push({
            company_id: params[0],
            employee_agent_id: params[1],
            parent_issue_id: params[2],
          });
        }
        if (/INSERT INTO .*chat_topics/i.test(sql)) {
          insertedTopics.push({
            topic_id: params[0],
            company_id: params[1],
            issue_id: params[2],
            parent_issue_id: params[3],
            employee_agent_id: params[4],
            title: params[5],
            last_activity_at: params[6],
            archived: params[7],
            created_at: params[8],
          });
        }
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _createdIssues: createdIssues,
    _insertedTopics: insertedTopics,
    _insertedParents: insertedParents,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

// ===========================================================================
// Task A — chat.topics DATA handler
// ===========================================================================

test('chat.topics: handler registers under key chat.topics', () => {
  const ctx = makeCtx();
  registerChatTopics(ctx);
  assert.ok(ctx._handlers.has('chat.topics'));
});

test('chat.topics: lists chat_topics rows for an employee, ordered by last_activity desc', async () => {
  const ctx = makeCtx({
    topics: [
      {
        topic_id: 'CHT-1', company_id: 'co-1', issue_id: 'i-1', parent_issue_id: 'p-1',
        employee_agent_id: 'agent-sdr', title: 'Old topic', last_activity_at: '2026-01-01T00:00:00.000Z',
        archived: false, created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        topic_id: 'CHT-2', company_id: 'co-1', issue_id: 'i-2', parent_issue_id: 'p-1',
        employee_agent_id: 'agent-sdr', title: 'Recent topic', last_activity_at: '2026-01-05T00:00:00.000Z',
        archived: false, created_at: '2026-01-02T00:00:00.000Z',
      },
      {
        topic_id: 'CHT-3', company_id: 'co-1', issue_id: 'i-3', parent_issue_id: 'p-2',
        employee_agent_id: 'agent-dev', title: 'Other employee', last_activity_at: '2026-01-09T00:00:00.000Z',
        archived: false, created_at: '2026-01-03T00:00:00.000Z',
      },
    ],
  });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topics')({
    companyId: 'co-1', userId: 'user-eric', employeeAgentId: 'agent-sdr',
  });

  assert.equal(result.kind, 'topics');
  assert.equal(result.topics.length, 2, 'only the selected employee topics');
  assert.deepEqual(result.topics.map((t) => t.topicId), ['CHT-2', 'CHT-1']);
});

test('chat.topics: missing companyId → { error: COMPANY_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topics')({
    userId: 'user-eric', employeeAgentId: 'agent-sdr',
  });
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.topics: missing employeeAgentId → { error: EMPLOYEE_AGENT_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topics')({
    companyId: 'co-1', userId: 'user-eric',
  });
  assert.equal(result.error, 'EMPLOYEE_AGENT_ID_REQUIRED');
});

test('chat.topics: opted-out caller → OPT_IN_REQUIRED', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topics')({
    companyId: 'co-1', userId: 'user-eric', employeeAgentId: 'agent-sdr',
  });
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

// ===========================================================================
// Task B — chat.topic.create ACTION handler
// ===========================================================================

function createParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    employeeAgentId: 'agent-sdr',
    employeeName: 'Cold Outreach',
    title: 'Pricing question',
    ...overrides,
  };
}

test('chat.topic.create: handler registers under key chat.topic.create', () => {
  const ctx = makeCtx();
  registerChatTopics(ctx);
  assert.ok(ctx._handlers.has('chat.topic.create'));
});

test('chat.topic.create: parent EXISTS → reuses it, no parent issue created', async () => {
  const ctx = makeCtx({ parents: { 'agent-sdr': 'parent-issue-9' } });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topic.create')(createParams());

  // Only ONE issue created — the child topic. No parent issue.
  assert.equal(ctx._createdIssues.length, 1);
  assert.equal(ctx._createdIssues[0].parentId, 'parent-issue-9');
  assert.equal(ctx._insertedParents.length, 0, 'no insertEmployeeParent when parent already exists');
  assert.equal(result.ok, true);
  assert.ok(result.issueId);
});

test('chat.topic.create: FIRST-ever topic → creates parent issue, records it, then child', async () => {
  const ctx = makeCtx({ parents: {} });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topic.create')(createParams());

  // TWO issues created — the parent, then the child.
  assert.equal(ctx._createdIssues.length, 2);
  const parent = ctx._createdIssues[0];
  const child = ctx._createdIssues[1];
  assert.equal(parent.title, 'Chat — Cold Outreach');
  assert.equal(parent.originId, 'chat-parent-agent-sdr');
  assert.equal(parent.originKind, 'plugin:clarity-pack');
  // the parent was recorded in chat_employee_parents
  assert.equal(ctx._insertedParents.length, 1);
  assert.equal(ctx._insertedParents[0].parent_issue_id, parent.id);
  // the child is parented under the freshly-created parent
  assert.equal(child.parentId, parent.id);
  assert.equal(result.ok, true);
});

test('chat.topic.create: child issue is assigned to the employee-agent (D-02 wake contract)', async () => {
  const ctx = makeCtx({ parents: { 'agent-sdr': 'parent-issue-9' } });
  registerChatTopics(ctx);
  await ctx._handlers.get('chat.topic.create')(createParams());
  const child = ctx._createdIssues[0];
  assert.equal(child.assigneeAgentId, 'agent-sdr');
  assert.equal(child.originKind, 'plugin:clarity-pack');
  assert.equal(child.status, 'todo');
});

test('chat.topic.create: allocates a CHT-NN and inserts a chat_topics row', async () => {
  const ctx = makeCtx({ parents: { 'agent-sdr': 'parent-issue-9' }, maxChtN: 7 });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topic.create')(createParams());

  assert.equal(ctx._insertedTopics.length, 1);
  assert.equal(ctx._insertedTopics[0].topic_id, 'CHT-8', 'allocates MAX+1');
  assert.equal(ctx._insertedTopics[0].employee_agent_id, 'agent-sdr');
  assert.equal(ctx._insertedTopics[0].title, 'Pricing question');
  assert.equal(result.topicId, 'CHT-8');
});

test('chat.topic.create: child description carries the D-14 reasoning block', async () => {
  const ctx = makeCtx({ parents: { 'agent-sdr': 'parent-issue-9' } });
  registerChatTopics(ctx);
  await ctx._handlers.get('chat.topic.create')(createParams());
  const child = ctx._createdIssues[0];
  assert.ok(
    /reply.*comment/i.test(child.description ?? ''),
    'the child issue description instructs the agent to reply by commenting',
  );
});

test('chat.topic.create: missing title → throws (action-handler convention)', async () => {
  const ctx = makeCtx({ parents: { 'agent-sdr': 'parent-issue-9' } });
  registerChatTopics(ctx);
  const params = createParams();
  delete params.title;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.create')(params),
    /title/i,
  );
});

test('chat.topic.create: missing employeeAgentId → throws', async () => {
  const ctx = makeCtx();
  registerChatTopics(ctx);
  const params = createParams();
  delete params.employeeAgentId;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.create')(params),
    /employeeAgentId/i,
  );
});

test('chat.topic.create: opted-out caller → OPT_IN_REQUIRED, no issue created', async () => {
  const ctx = makeCtx({ optedIn: false, parents: { 'agent-sdr': 'parent-issue-9' } });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topic.create')(createParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.topic.create: issues.create failure → { error: CREATE_FAILED }', async () => {
  const ctx = makeCtx({ parents: { 'agent-sdr': 'parent-issue-9' }, createIssueThrows: true });
  registerChatTopics(ctx);
  const result = await ctx._handlers.get('chat.topic.create')(createParams());
  assert.equal(result.error, 'CREATE_FAILED');
});
