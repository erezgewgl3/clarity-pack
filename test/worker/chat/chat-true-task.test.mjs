// test/worker/chat/chat-true-task.test.mjs
//
// Plan 04.1-02 Task 2 RED → GREEN — chat.createTrueTask action handler.
//
// chat.createTrueTask is the operator-composer entry point onto createTrueTask
// (the D-04 shared mechanism — same artifact as chat.promote). The handler:
//   1. Wraps with wrapActionHandler — opted-out callers get OPT_IN_REQUIRED.
//   2. Validates required params via reqStr — THROWS on missing required
//      strings (action-handler convention; same shape as chat.send / chat.promote).
//   3. Calls createTrueTask(ctx, {...}) — top-level + assigned + marker.
//   4. ctx.issues.create failure → { error: 'CREATE_FAILED' }; marker-comment
//      failure still returns { ok: true, issueId } (best-effort durability).
//
// originId: 'chat-task:<topicIssueId>:<sourceCommentId>' when the operator
// promotes an existing message; 'chat-task:<topicIssueId>:composer' when the
// operator types a task directly into the composer (no source message).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerChatTrueTask,
} from '../../../src/worker/handlers/chat-true-task.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  createIssueThrows = false,
  createCommentThrows = false,
  createdIssueId = 'BEAAA-203',
} = {}) {
  const handlers = new Map();
  const createdIssues = [];
  const createCommentCalls = [];
  const warnLogs = [];
  const topicInserts = [];
  const parentInserts = [];

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
        // quick-260619-r4v Piece 1 — the atomic new-topic path issues up to
        // three creates (parent, topic, task). Hand back distinct ids keyed
        // off the originId prefix so the chain links correctly; the task
        // (chat-task: / chat-parent fallback) keeps the configured id.
        let id = createdIssueId;
        if (typeof input.originId === 'string' && input.originId.startsWith('chat-parent-')) {
          id = `PARENT-${createdIssues.length + 1}`;
        } else if (typeof input.originId === 'string' && input.originId.startsWith('chat-topic-')) {
          id = `TOPIC-${createdIssues.length + 1}`;
        }
        const row = { id, ...input };
        createdIssues.push(row);
        return row;
      },
      async createComment(issueId, body, companyId) {
        createCommentCalls.push({ issueId, body, companyId });
        if (createCommentThrows) throw new Error('host createComment 503');
        return { id: `comment-${createCommentCalls.length}`, issueId, body, companyId };
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        // quick-260619-r4v Piece 1 — atomic new-topic create primitives.
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)) {
          if (parentInserts.length > 0) {
            return [{ parent_issue_id: parentInserts[parentInserts.length - 1].params[2] }];
          }
          return [];
        }
        if (/MAX\(CAST\(substring\(topic_id/i.test(sql)) {
          return [{ max_n: null }];
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics\b/i.test(sql)) {
          if (topicInserts.length > 0) {
            const p = topicInserts[topicInserts.length - 1].params;
            return [
              {
                topic_id: p[0],
                company_id: p[1],
                issue_id: p[2],
                parent_issue_id: p[3],
                employee_agent_id: p[4],
                title: p[5],
                last_activity_at: p[6],
                archived: p[7],
                created_at: p[8],
              },
            ];
          }
          return [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics\b/i.test(sql)) {
          topicInserts.push({ sql, params });
          return { rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)) {
          parentInserts.push({ sql, params });
          return { rowCount: 1 };
        }
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

function params(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    sourceCommentId: 'c-source-1',
    title: 'Ship the pricing page by Friday',
    body: 'Ship the pricing page by Friday',
    assigneeAgentId: 'agent-cfo',
    employeeName: 'CFO',
    ...overrides,
  };
}

// ---- Test 1 — handler registers under the chat.createTrueTask key ----------

test('chat.createTrueTask: handler registers under key chat.createTrueTask', () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  assert.ok(ctx._handlers.has('chat.createTrueTask'));
  assert.equal(ctx._handlers.size, 1, 'exactly one handler key registered');
});

// ---- Test 2 — OPT-IN gate: opted-out caller → OPT_IN_REQUIRED -------------

test('chat.createTrueTask: opted-out caller → OPT_IN_REQUIRED, no host calls', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatTrueTask(ctx);
  const result = await ctx._handlers.get('chat.createTrueTask')(params());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0, 'no issues.create call');
  assert.equal(ctx._createCommentCalls.length, 0, 'no createComment call');
});

// ---- Test 3 — reqStr THROWS on every missing required string param --------
//
// NOTE: userId is NOT in this list because the opt-in-guard wrapper fires
// BEFORE the handler body — a request with no userId is treated as opted-out
// (extractUserId returns null, isOptedIn(ctx, null) returns false, the guard
// returns OPT_IN_REQUIRED). The reqStr(params, 'userId') inside the handler
// is defensive/structural — see Test 3b which pins the OPT_IN_REQUIRED path
// for a missing userId. This matches existing chat.send / chat.promote tests.

// NOTE (quick-260619-r4v Piece 1): topicIssueId is NO LONGER an unconditional
// required string — a non-empty newTopicTitle is an accepted alternative
// (atomic new-topic create). topicIssueId-missing is exercised separately
// below (TOPIC_REQUIRED when newTopicTitle is also absent).
for (const key of ['companyId', 'title', 'body', 'assigneeAgentId', 'employeeName']) {
  test(`chat.createTrueTask: missing ${key} → throws (action-handler convention)`, async () => {
    const ctx = makeCtx();
    registerChatTrueTask(ctx);
    const p = params();
    delete p[key];
    await assert.rejects(
      () => ctx._handlers.get('chat.createTrueTask')(p),
      new RegExp(key, 'i'),
    );
  });
}

// ---- quick-260619-r4v Piece 1 — TOPIC_REQUIRED + newTopicTitle alternative -

test('chat.createTrueTask: no topicIssueId AND no newTopicTitle → { error: TOPIC_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  const p = params();
  delete p.topicIssueId;
  const result = await ctx._handlers.get('chat.createTrueTask')(p);
  assert.equal(result.error, 'TOPIC_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0, 'no host create when neither topic nor newTopicTitle present');
});

test('chat.createTrueTask: topicIssueId null AND no newTopicTitle → { error: TOPIC_REQUIRED } (cold path removed)', async () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  const result = await ctx._handlers.get('chat.createTrueTask')(params({ topicIssueId: null }));
  assert.equal(result.error, 'TOPIC_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0);
});

test('chat.createTrueTask: newTopicTitle (no topicIssueId) → atomic new-topic create, never a cold task', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-NEW' });
  registerChatTrueTask(ctx);
  const result = await ctx._handlers.get('chat.createTrueTask')(
    params({ topicIssueId: null, newTopicTitle: 'Brand new topic' }),
  );
  assert.equal(result.ok, true);
  // No create payload carries a cold-task: originId.
  for (const issue of ctx._createdIssues) {
    assert.ok(
      typeof issue.originId !== 'string' || !issue.originId.startsWith('cold-task:'),
      'no cold-task: originId is ever emitted',
    );
  }
  // At least a topic + task were created (the parent may be reused).
  assert.ok(
    ctx._createdIssues.some((i) => String(i.originId).startsWith('chat-topic-')),
    'a chat-topic issue was created',
  );
  assert.ok(
    ctx._createdIssues.some((i) => String(i.originId).startsWith('chat-task:')),
    'a chat-task issue was created',
  );
});

// ---- Test 3b — missing userId is gated by opt-in-guard, not reqStr --------

test('chat.createTrueTask: missing userId → OPT_IN_REQUIRED (opt-in-guard fires before reqStr)', async () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  const p = params();
  delete p.userId;
  const result = await ctx._handlers.get('chat.createTrueTask')(p);
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._createdIssues.length, 0);
});

// ---- Test 4 — HAPPY: opted-in operator gets a top-level assigned task -----

test('chat.createTrueTask: happy path → { ok: true, issueId, topicIssueId }', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-203' });
  registerChatTrueTask(ctx);
  const result = await ctx._handlers.get('chat.createTrueTask')(params());

  assert.deepEqual(result, {
    ok: true,
    issueId: 'BEAAA-203',
    topicIssueId: 'issue-topic-1',
  });
  assert.equal(ctx._createdIssues.length, 1);
  const issue = ctx._createdIssues[0];
  assert.ok(!('parentId' in issue), 'D-05 — no parentId on the create payload');
  assert.equal(issue.assigneeAgentId, 'agent-cfo');
  assert.equal(issue.title, 'Ship the pricing page by Friday');
  assert.equal(issue.originKind, 'plugin:clarity-pack');
  assert.equal(issue.originId, 'chat-task:issue-topic-1:c-source-1');
  assert.equal(ctx._createCommentCalls.length, 1, 'marker comment posted');
  assert.equal(
    ctx._createCommentCalls[0].body,
    'Task created — BEAAA-203, assigned to CFO.',
  );
});

// ---- Test 5 — ctx.issues.create failure → { error: CREATE_FAILED } --------

test('chat.createTrueTask: issues.create failure → { error: CREATE_FAILED } + warn log', async () => {
  const ctx = makeCtx({ createIssueThrows: true });
  registerChatTrueTask(ctx);
  const result = await ctx._handlers.get('chat.createTrueTask')(params());
  assert.equal(result.error, 'CREATE_FAILED');
  assert.equal(ctx._createCommentCalls.length, 0);
  assert.ok(ctx._warnLogs.length >= 1, 'at least one warn log entry');
});

// ---- Test 6 — sourceCommentId null → originId ":composer" suffix ---------

test('chat.createTrueTask: sourceCommentId null → originId "chat-task:<topic>:composer"', async () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  const result = await ctx._handlers.get('chat.createTrueTask')(params({ sourceCommentId: null }));
  assert.equal(result.ok, true);
  const issue = ctx._createdIssues[0];
  assert.equal(issue.originId, 'chat-task:issue-topic-1:composer');
});

// ---- Test 7 — sourceCommentId present → originId includes that comment id

test('chat.createTrueTask: sourceCommentId present → originId "chat-task:<topic>:<commentId>"', async () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  await ctx._handlers.get('chat.createTrueTask')(params({ sourceCommentId: 'c-source-99' }));
  const issue = ctx._createdIssues[0];
  assert.equal(issue.originId, 'chat-task:issue-topic-1:c-source-99');
});

// ---- Test 8 — NO parentId on EVERY ctx.issues.create call ----------------

test('chat.createTrueTask: ctx.issues.create payload NEVER carries parentId (D-05 anti-regression)', async () => {
  const ctx = makeCtx();
  registerChatTrueTask(ctx);
  await ctx._handlers.get('chat.createTrueTask')(params());
  for (const issue of ctx._createdIssues) {
    assert.ok(!('parentId' in issue), 'parentId must NOT be present');
  }
});

// ---- Test 9 — registerChatTrueTask is exported as a function -------------

test('registerChatTrueTask is exported as a function', async () => {
  const mod = await import('../../../src/worker/handlers/chat-true-task.ts');
  assert.equal(typeof mod.registerChatTrueTask, 'function');
});
