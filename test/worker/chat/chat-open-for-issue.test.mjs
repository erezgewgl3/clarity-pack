// test/worker/chat/chat-open-for-issue.test.mjs
//
// Plan 04.2-01 Task 2 RED -> GREEN -- chat.openForIssue DATA handler (RCB-02).
//
// Deterministic issue-lineage routing: given { companyId, userId, issueId }
// the handler reads the host issue ONCE and returns exactly one of four
// routes (existing-topic / new-topic-needed / topic-itself) plus the
// NO_ASSIGNEE error variant. Pure routing -- no DB write, no ctx.issues.update.
//
// Routing table (from the plan's <design_source>):
//   chat-topic issue itself      -> route: 'topic-itself'
//   no assignee                  -> route: 'new-topic-needed', error: 'NO_ASSIGNEE'
//   originId chat-task:<t>:<c>    -> route: 'existing-topic' (topicIssueId, sourceCommentId)
//   cold-task:... OR assignee-but-no-chat-origin -> route: 'new-topic-needed' (seed payload)
//
// INTERFACE NOTE (verified against src/worker/handlers/chat-topics.ts +
// src/worker/chat/true-task.ts): chat-topic issues created by chat.topic.create
// carry originKind 'plugin:clarity-pack' with originId 'chat-topic-<CHT-NN>'
// (NOT the originKind 'plugin:clarity-pack:chat-topic' the plan's prose
// assumed). The handler detects topic-itself by EITHER originKind ===
// 'plugin:clarity-pack:chat-topic' OR an originId beginning 'chat-topic-' so
// it is correct against both the live host shape and the plan's stated shape.
//
// Data-handler convention (mirrors chat-active-tasks.ts):
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//   - opted-out caller              -> RETURN { error: 'OPT_IN_REQUIRED' }

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatOpenForIssue } from '../../../src/worker/handlers/chat-open-for-issue.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  // issue: the ctx.issues.get response row, or null for not-found.
  issue = null,
  // issueGetThrows: when truthy, ctx.issues.get throws.
  issueGetThrows = false,
} = {}) {
  const handlers = new Map();
  const warnLogs = [];
  const issueGetCalls = [];

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
      async get(issueId, companyId) {
        issueGetCalls.push({ issueId, companyId });
        if (issueGetThrows) throw new Error('host issues.get 503');
        return issue;
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
    _warnLogs: warnLogs,
    _issueGetCalls: issueGetCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
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
    assigneeAgentId: 'agent-x',
    ...overrides,
  };
}

// ---- Test 1 — REGISTER ----------------------------------------------------

test('chat.openForIssue: registers exactly the chat.openForIssue key', () => {
  const ctx = makeCtx();
  registerChatOpenForIssue(ctx);
  assert.ok(ctx._handlers.has('chat.openForIssue'));
  assert.equal(ctx._handlers.size, 1, 'exactly one handler key registered');
});

// ---- Test 2 — OPT-IN-GATE -------------------------------------------------

test('chat.openForIssue: opted-out caller -> { error: OPT_IN_REQUIRED } before any ctx.issues.get', async () => {
  const ctx = makeCtx({ optedIn: false, issue: issueRow() });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._issueGetCalls.length, 0, 'gate fires before the host read');
});

// ---- Test 3 — MISSING-PARAM -----------------------------------------------

test('chat.openForIssue: missing issueId -> { error: ISSUE_ID_REQUIRED } (return, not throw)', async () => {
  const ctx = makeCtx({ issue: issueRow() });
  registerChatOpenForIssue(ctx);
  const p = params();
  delete p.issueId;
  const result = await ctx._handlers.get('chat.openForIssue')(p);
  assert.equal(result.error, 'ISSUE_ID_REQUIRED');
});

// ---- Test 4 — ROUTE existing-topic ----------------------------------------

test('chat.openForIssue: chat-task originId -> route existing-topic with topicIssueId + sourceCommentId', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originId: 'chat-task:CHT-1117:cmt-9',
      assigneeAgentId: 'agent-cfo',
    }),
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.kind, 'chatOpenForIssue');
  assert.equal(result.route, 'existing-topic');
  assert.equal(result.topicIssueId, 'CHT-1117');
  assert.equal(result.sourceCommentId, 'cmt-9');
  assert.equal(result.assigneeAgentId, 'agent-cfo');
});

// ---- Test 5 — ROUTE new-topic-needed COLD ---------------------------------

test('chat.openForIssue: cold-task originId -> route new-topic-needed with seed payload', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originId: 'cold-task:user-1:1716000000000',
      assigneeAgentId: 'agent-x',
      title: 'Fix login',
      identifier: 'COU-2401',
    }),
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'new-topic-needed');
  assert.equal(result.assigneeAgentId, 'agent-x');
  assert.equal(result.seedTitle, 'Fix login');
  assert.equal(result.seedBody, 'Continuing from COU-2401: Fix login');
  assert.equal(result.error, undefined, 'no error on a clean new-topic route');
});

// ---- Test 6 — ROUTE new-topic-needed REGULAR ------------------------------

test('chat.openForIssue: regular assigned task (assignee, originId null) -> route new-topic-needed', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originId: null,
      assigneeAgentId: 'agent-x',
      title: 'Ship the runbook',
      identifier: 'COU-9000',
    }),
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'new-topic-needed');
  assert.equal(result.assigneeAgentId, 'agent-x');
  assert.equal(result.seedTitle, 'Ship the runbook');
  assert.equal(result.seedBody, 'Continuing from COU-9000: Ship the runbook');
});

// ---- Test 7 — ROUTE topic-itself ------------------------------------------

test('chat.openForIssue: chat-topic issue itself -> route topic-itself, no seed/topic fields', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originKind: 'plugin:clarity-pack:chat-topic',
      assigneeAgentId: 'agent-cfo',
    }),
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'topic-itself');
  assert.equal(result.topicIssueId, undefined);
  assert.equal(result.seedTitle, undefined);
  assert.equal(result.seedBody, undefined);
});

test('chat.openForIssue: live-host chat-topic shape (originKind plugin:clarity-pack, originId chat-topic-CHT-NN) -> topic-itself', async () => {
  const ctx = makeCtx({
    issue: issueRow({
      originKind: 'plugin:clarity-pack',
      originId: 'chat-topic-CHT-12',
      assigneeAgentId: 'agent-cfo',
    }),
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'topic-itself');
});

// ---- Test 8 — NO_ASSIGNEE -------------------------------------------------

test('chat.openForIssue: no assignee -> route new-topic-needed with error NO_ASSIGNEE', async () => {
  const ctx = makeCtx({
    issue: issueRow({ assigneeAgentId: null, originId: null }),
  });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.route, 'new-topic-needed');
  assert.equal(result.error, 'NO_ASSIGNEE');
});

// ---- Test 9 — LOOKUP-FAILS ------------------------------------------------

test('chat.openForIssue: ctx.issues.get throws -> { error: ISSUE_LOOKUP_FAILED } + warn-log, called once', async () => {
  const ctx = makeCtx({ issueGetThrows: true });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.error, 'ISSUE_LOOKUP_FAILED');
  assert.ok(ctx._warnLogs.length >= 1, 'at least one warn-log entry');
  assert.equal(ctx._issueGetCalls.length, 1, 'ctx.issues.get called exactly once (no retry storm)');
});

test('chat.openForIssue: issue not found (ctx.issues.get returns null) -> { error: ISSUE_LOOKUP_FAILED }', async () => {
  const ctx = makeCtx({ issue: null });
  registerChatOpenForIssue(ctx);
  const result = await ctx._handlers.get('chat.openForIssue')(params());
  assert.equal(result.error, 'ISSUE_LOOKUP_FAILED');
});

// ---- export shape ---------------------------------------------------------

test('registerChatOpenForIssue is exported as a function', async () => {
  const mod = await import('../../../src/worker/handlers/chat-open-for-issue.ts');
  assert.equal(typeof mod.registerChatOpenForIssue, 'function');
});
