// test/worker/chat/chat-promote.test.mjs
//
// Plan 04.1-02 Task 3 — chat.promote REWRITTEN to delegate to createTrueTask
// (D-04 unification). The agent-message Promote now produces the SAME
// assigned, findable, top-level Paperclip issue as the operator-composer
// chat.createTrueTask path. The old behaviour (parentId: topicIssueId +
// unassigned todo) is DELETED, not kept alongside.
//
// Tests updated:
//   U1 — REGRESSION-REMOVED-PARENT-ID: the create payload has NO parentId
//        key (anti-regression of the Phase 4 followup's "orphan task nested
//        under plugin plumbing" bug).
//   U2 — REGRESSION-REMOVED-UNASSIGNED: assigneeAgentId is a non-empty
//        string on the create payload (anti-regression of the Phase 4
//        followup's "nobody acts on it" bug).
//   U3 — NEW REQUIRES-ASSIGNEE-AGENT-ID: missing assigneeAgentId throws.
//   U4 — NEW REQUIRES-EMPLOYEE-NAME: missing employeeName throws.
//   U5 — DELEGATES-TO-HELPER: originId is the createTrueTask
//        'chat-task:<topic>:<commentId>' format, NOT the legacy
//        'chat-promote-<commentId>' format.
//   U6 — KEPT LISTCOMMENTS-RESOLUTION: the source comment is still resolved
//        by id from the topic thread (PITFALL #4 — the agent comment has no
//        chat_messages row, so we MUST re-fetch via listComments).
//   U7 — KEPT NOT-FOUND: a commentId not in the thread returns NOT_FOUND.
//   U8 — KEPT OPT-IN-GATE: opted-out caller returns OPT_IN_REQUIRED.
//   U9 — RESPONSE-SHAPE: returns { ok: true, issueId, topicIssueId } and
//        posts the D-07 marker comment on the topic issue.
//   U10 — listComments failure → NOT_FOUND.
//   U11 — issues.create failure → PROMOTE_FAILED.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatPromote } from '../../../src/worker/handlers/chat-promote.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  comments = [],
  createIssueThrows = false,
  createCommentThrows = false,
  listCommentsThrows = false,
  createdIssueId = 'BEAAA-205',
} = {}) {
  const handlers = new Map();
  const createdIssues = [];
  const createCommentCalls = [];
  const warnLogs = [];

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info() {},
    },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async create(input) {
        if (createIssueThrows) throw new Error('host issues.create 503');
        const row = { id: createdIssueId, ...input };
        createdIssues.push(row);
        return row;
      },
      async createComment(issueId, body, companyId) {
        createCommentCalls.push({ issueId, body, companyId });
        if (createCommentThrows) throw new Error('host createComment 503');
        return { id: `comment-${createCommentCalls.length}`, issueId, body, companyId };
      },
      async listComments(issueId, companyId) {
        void issueId;
        void companyId;
        if (listCommentsThrows) throw new Error('host listComments 503');
        return comments;
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _createdIssues: createdIssues,
    _createCommentCalls: createCommentCalls,
    _warnLogs: warnLogs,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function promoteParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    commentId: 'c-agent-1',
    topicIssueId: 'issue-topic-1',
    // NEW required params per Plan 04.1-02 — UI threads these through.
    assigneeAgentId: 'agent-cfo',
    employeeName: 'CFO',
    ...overrides,
  };
}

// ---- Registration ---------------------------------------------------------

test('chat.promote: handler registers under key chat.promote', () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  assert.ok(ctx._handlers.has('chat.promote'));
});

// ---- U1 — REGRESSION-REMOVED-PARENT-ID -----------------------------------

test('chat.promote: ctx.issues.create payload has NO parentId (Phase 4 bug fix)', async () => {
  const ctx = makeCtx({
    comments: [{ id: 'c-agent-1', body: 'Ship the pricing page by Friday' }],
  });
  registerChatPromote(ctx);
  await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(ctx._createdIssues.length, 1);
  const issue = ctx._createdIssues[0];
  assert.ok(!('parentId' in issue), 'D-05 — parentId must NOT be present on the create payload');
});

// ---- U2 — REGRESSION-REMOVED-UNASSIGNED ----------------------------------

test('chat.promote: assigneeAgentId is a non-empty string on the create payload (D-06)', async () => {
  const ctx = makeCtx({
    comments: [{ id: 'c-agent-1', body: 'Ship the pricing page by Friday' }],
  });
  registerChatPromote(ctx);
  await ctx._handlers.get('chat.promote')(promoteParams({ assigneeAgentId: 'agent-cmo' }));
  const issue = ctx._createdIssues[0];
  assert.equal(typeof issue.assigneeAgentId, 'string');
  assert.ok(issue.assigneeAgentId.length > 0);
  assert.equal(issue.assigneeAgentId, 'agent-cmo');
});

// ---- U3 — NEW REQUIRES-ASSIGNEE-AGENT-ID ----------------------------------

test('chat.promote: missing assigneeAgentId → throws', async () => {
  const ctx = makeCtx({ comments: [{ id: 'c-agent-1', body: 'x' }] });
  registerChatPromote(ctx);
  const p = promoteParams();
  delete p.assigneeAgentId;
  await assert.rejects(
    () => ctx._handlers.get('chat.promote')(p),
    /assigneeAgentId/i,
  );
});

// ---- U4 — NEW REQUIRES-EMPLOYEE-NAME -------------------------------------

test('chat.promote: missing employeeName → throws', async () => {
  const ctx = makeCtx({ comments: [{ id: 'c-agent-1', body: 'x' }] });
  registerChatPromote(ctx);
  const p = promoteParams();
  delete p.employeeName;
  await assert.rejects(
    () => ctx._handlers.get('chat.promote')(p),
    /employeeName/i,
  );
});

// ---- U5 — DELEGATES-TO-HELPER (originId format) --------------------------

test('chat.promote: originId is the createTrueTask format, NOT the legacy chat-promote- format', async () => {
  const ctx = makeCtx({
    comments: [{ id: 'c-agent-77', body: 'Ship the pricing page by Friday' }],
  });
  registerChatPromote(ctx);
  await ctx._handlers.get('chat.promote')(
    promoteParams({ commentId: 'c-agent-77', topicIssueId: 'issue-topic-9' }),
  );
  const issue = ctx._createdIssues[0];
  assert.equal(issue.originId, 'chat-task:issue-topic-9:c-agent-77');
  assert.ok(
    !String(issue.originId).startsWith('chat-promote-'),
    'legacy originId format must be gone',
  );
});

// ---- U6 — KEPT LISTCOMMENTS-RESOLUTION (PITFALL #4) ----------------------

test('chat.promote: re-fetches AGENT comment body via listComments (PITFALL #4 — no chat_messages row)', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-agent-1', body: 'Ship the pricing page by Friday' },
      { id: 'c-other', body: 'unrelated' },
    ],
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(ctx._createdIssues.length, 1);
  const issue = ctx._createdIssues[0];
  // pre-filled from the agent comment body
  assert.match(issue.title + (issue.description ?? ''), /pricing page/i);
  assert.equal(result.ok, true);
  assert.equal(result.issueId, issue.id);
});

// ---- U7 — KEPT NOT-FOUND --------------------------------------------------

test('chat.promote: comment id not in the topic thread → { error: NOT_FOUND }', async () => {
  const ctx = makeCtx({ comments: [{ id: 'c-different', body: 'a different comment' }] });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'NOT_FOUND');
  assert.equal(ctx._createdIssues.length, 0);
});

// ---- U8 — KEPT OPT-IN-GATE ------------------------------------------------

test('chat.promote: opted-out caller → OPT_IN_REQUIRED, no issue created', async () => {
  const ctx = makeCtx({ optedIn: false, comments: [{ id: 'c-agent-1', body: 'x' }] });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0);
});

// ---- U9 — RESPONSE-SHAPE + MARKER COMMENT --------------------------------

test('chat.promote: response is { ok: true, issueId, topicIssueId } AND posts D-07 marker comment', async () => {
  const ctx = makeCtx({
    createdIssueId: 'BEAAA-301',
    comments: [{ id: 'c-agent-1', body: 'Ship the pricing page by Friday' }],
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.deepEqual(result, {
    ok: true,
    issueId: 'BEAAA-301',
    topicIssueId: 'issue-topic-1',
  });
  // D-07 marker on the topic
  assert.equal(ctx._createCommentCalls.length, 1);
  assert.equal(ctx._createCommentCalls[0].issueId, 'issue-topic-1');
  assert.equal(
    ctx._createCommentCalls[0].body,
    'Task created — BEAAA-301, assigned to CFO.',
  );
});

// ---- U10 — listComments failure → NOT_FOUND ------------------------------

test('chat.promote: listComments failure → { error: NOT_FOUND }, no issue created', async () => {
  const ctx = makeCtx({ listCommentsThrows: true });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'NOT_FOUND');
  assert.equal(ctx._createdIssues.length, 0);
});

// ---- U11 — issues.create failure → PROMOTE_FAILED ------------------------

test('chat.promote: issues.create failure → { error: PROMOTE_FAILED }', async () => {
  const ctx = makeCtx({
    comments: [{ id: 'c-agent-1', body: 'something' }],
    createIssueThrows: true,
  });
  registerChatPromote(ctx);
  const result = await ctx._handlers.get('chat.promote')(promoteParams());
  assert.equal(result.error, 'PROMOTE_FAILED');
});

// ---- Other KEPT throws --------------------------------------------------

test('chat.promote: missing commentId → throws', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const p = promoteParams();
  delete p.commentId;
  await assert.rejects(() => ctx._handlers.get('chat.promote')(p), /commentId/i);
});

test('chat.promote: missing topicIssueId → throws', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const p = promoteParams();
  delete p.topicIssueId;
  await assert.rejects(() => ctx._handlers.get('chat.promote')(p), /topicIssueId/i);
});

test('chat.promote: missing companyId → throws', async () => {
  const ctx = makeCtx();
  registerChatPromote(ctx);
  const p = promoteParams();
  delete p.companyId;
  await assert.rejects(() => ctx._handlers.get('chat.promote')(p), /companyId/i);
});
