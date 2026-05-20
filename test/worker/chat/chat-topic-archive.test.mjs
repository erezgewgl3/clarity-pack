// test/worker/chat/chat-topic-archive.test.mjs
//
// Plan 04.1-05 Task 1 RED -> GREEN -- chat.topic.archive ACTION handler.
//
// D-10 invariant (Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ3 attempt 2):
// the chat-topic issue's status MUST stay non-terminal at the host. The
// archive flag lives plugin-side ONLY (chat_topics.archived). Marking the
// host issue done would re-engage the disposition-recovery machinery
// (evidence: the captured fa25ef4d-... system_notice the host wrote
// post-run on the OQ3 probe issue). Test 6 below is the by-construction
// regression guard -- ctx.issues.update remains zero-times called.
//
// Action-handler convention (mirrors chat-pin / chat-promote / chat-send):
//   - missing required string param  -> THROW with "<key>" in the message
//   - missing/wrong-typed boolean    -> THROW with "boolean" in the message
//   - opted-out caller               -> RETURN { error: 'OPT_IN_REQUIRED' }
//   - repo failure                   -> RETURN { error: 'ARCHIVE_FAILED' } + warn log

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatTopicArchive } from '../../../src/worker/handlers/chat-topic-archive.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  topics = [
    {
      topic_id: 'CHT-1',
      company_id: 'co-1',
      issue_id: 'issue-topic-1',
      parent_issue_id: 'parent-1',
      employee_agent_id: 'agent-cfo',
      title: 'Pricing',
      last_activity_at: '2026-01-01T00:00:00.000Z',
      archived: false,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  repoThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  // Test 6 anti-regression — a spy on ctx.issues.update that MUST remain
  // zero-times called. The handler MUST NOT touch the host issue.
  const issueUpdateCalls = [];
  const issueClient = {
    async update(issueId, patch, companyId) {
      issueUpdateCalls.push({ issueId, patch, companyId });
      return { id: issueId, ...patch };
    },
  };

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
    issues: issueClient,
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        if (repoThrows) throw new Error('host db.execute 503');
        if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
          const [archived, issueId, companyId] = params;
          const row = topics.find(
            (t) => t.issue_id === issueId && t.company_id === companyId,
          );
          if (row) row.archived = archived;
          return { rowCount: row ? 1 : 0 };
        }
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _topics: topics,
    _calls: calls,
    _warnLogs: warnLogs,
    _issueUpdateCalls: issueUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function archiveParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    archived: true,
    ...overrides,
  };
}

// ---- Test 1 — handler registers under exactly chat.topic.archive ----------

test('chat.topic.archive: handler registers under key chat.topic.archive', () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  assert.ok(ctx._handlers.has('chat.topic.archive'));
  assert.equal(ctx._handlers.size, 1, 'exactly one handler key registered');
});

// ---- Test 2 — OPT-IN gate: opted-out caller -> OPT_IN_REQUIRED -----------

test('chat.topic.archive: opted-out caller -> OPT_IN_REQUIRED, no UPDATE issued', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(archiveParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  const writes = ctx._calls.filter(
    (c) => c.kind === 'execute' && /chat_topics/i.test(c.sql),
  );
  assert.equal(writes.length, 0, 'no chat_topics UPDATE for an opted-out caller');
});

// ---- Test 3 — MISSING-PARAMS-THROW (action-handler convention) -----------

test('chat.topic.archive: missing companyId -> throws (action-handler convention)', async () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  const p = archiveParams();
  delete p.companyId;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.archive')(p),
    /companyId/i,
  );
});

test('chat.topic.archive: missing topicIssueId -> throws', async () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  const p = archiveParams();
  delete p.topicIssueId;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.archive')(p),
    /topicIssueId/i,
  );
});

test('chat.topic.archive: missing archived flag -> throws with /boolean/', async () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  const p = archiveParams();
  delete p.archived;
  await assert.rejects(
    () => ctx._handlers.get('chat.topic.archive')(p),
    /archived.*boolean|boolean.*archived/i,
  );
});

test('chat.topic.archive: non-boolean archived value -> throws with /boolean/', async () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  await assert.rejects(
    () =>
      ctx._handlers.get('chat.topic.archive')(
        archiveParams({ archived: 'yes' }),
      ),
    /boolean/i,
  );
});

// ---- Test 4 — HAPPY-ARCHIVE: { archived: true } --------------------------

test('chat.topic.archive: { archived: true } -> repo writes true, returns { ok, topicIssueId, archived: true }', async () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  );
  assert.deepEqual(result, {
    ok: true,
    topicIssueId: 'issue-topic-1',
    archived: true,
  });
  // The chat_topics row was flipped.
  assert.equal(ctx._topics[0].archived, true, 'chat_topics.archived = true persisted');
});

// ---- Test 5 — HAPPY-UNARCHIVE: { archived: false } -----------------------

test('chat.topic.archive: { archived: false } -> repo writes false, returns { ok, archived: false }', async () => {
  const ctx = makeCtx({
    topics: [
      {
        topic_id: 'CHT-1',
        company_id: 'co-1',
        issue_id: 'issue-topic-1',
        parent_issue_id: 'parent-1',
        employee_agent_id: 'agent-cfo',
        title: 'Pricing',
        last_activity_at: '2026-01-01T00:00:00.000Z',
        archived: true, // start archived
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: false }),
  );
  assert.deepEqual(result, {
    ok: true,
    topicIssueId: 'issue-topic-1',
    archived: false,
  });
  assert.equal(ctx._topics[0].archived, false, 'un-archive flipped the flag back');
});

// ---- Test 6 — D-10 CRITICAL: NEVER calls ctx.issues.update ---------------
//
// The load-bearing invariant. If a future refactor accidentally re-introduces
// host status mutation on archive, the host's disposition-recovery service
// re-engages (evidence: 04.1-01-SPIKE-FINDINGS PROBE-OQ3 attempt 2 captured
// the fa25ef4d-... missing-disposition system_notice the host wrote on the
// chat-topic issue post-run). This test pins the by-construction guarantee.

test('chat.topic.archive: NEVER calls ctx.issues.update (D-10 invariant -- archive is plugin-side only)', async () => {
  const ctx = makeCtx();
  registerChatTopicArchive(ctx);
  // Run both archive AND un-archive paths.
  await ctx._handlers.get('chat.topic.archive')(archiveParams({ archived: true }));
  await ctx._handlers.get('chat.topic.archive')(archiveParams({ archived: false }));
  assert.equal(
    ctx._issueUpdateCalls.length,
    0,
    'ctx.issues.update MUST remain zero-times called across both paths',
  );
});

// ---- Test 7 — REPO-FAILURE -> { error: ARCHIVE_FAILED } + warn log -------

test('chat.topic.archive: repo failure -> { error: ARCHIVE_FAILED } + warn log', async () => {
  const ctx = makeCtx({ repoThrows: true });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(archiveParams());
  assert.equal(result.error, 'ARCHIVE_FAILED');
  assert.ok(ctx._warnLogs.length >= 1, 'at least one warn log entry');
  // Still no host-issue mutation on the failure path.
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 8 — registerChatTopicArchive is exported as a function --------

test('registerChatTopicArchive is exported as a function', async () => {
  const mod = await import('../../../src/worker/handlers/chat-topic-archive.ts');
  assert.equal(typeof mod.registerChatTopicArchive, 'function');
});
