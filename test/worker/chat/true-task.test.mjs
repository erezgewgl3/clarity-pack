// test/worker/chat/true-task.test.mjs
//
// Plan 04.1-02 Task 1 RED → GREEN — createTrueTask shared helper.
//
// One mechanism for the operator composer path (chat.createTrueTask) AND the
// agent-message Promote path (chat.promote). Both delegate to the helper.
//
// The helper writes a TOP-LEVEL Paperclip issue with assigneeAgentId set
// (D-05/D-06 — never parented under the topic, never unassigned), then posts a
// marker comment on the topic issue (D-07). Marker is best-effort durability;
// a failed marker write does NOT fail the create (the originId carries the
// authoritative back-link). createTrueTask THROWS on a create failure — the
// calling HANDLER converts to a structured error.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createTrueTask, titleFromBody } from '../../../src/worker/chat/true-task.ts';

function makeCtx({
  createIssueThrows = false,
  createCommentThrows = false,
  createdIssueId = 'BEAAA-202',
  // Plan 04.1-05 retrofit -- side-table INSERT modeling. If sideTableThrows
  // is true, ctx.db.execute throws when called against chat_topic_tasks.
  sideTableThrows = false,
  // quick-260619-r4v Piece 1 -- atomic new-topic path modeling.
  // existingParentId: the chat_employee_parents lookup result (null = first-ever).
  existingParentId = null,
  // chtMaxN: the allocateChtNumber MAX(...) seed (null = first ever -> CHT-1).
  chtMaxN = null,
} = {}) {
  const createCalls = [];
  const createCommentCalls = [];
  const warnLogs = [];
  const sideTableInserts = [];
  const topicInserts = [];
  const parentInserts = [];
  let createdSeq = 0;
  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
    },
    issues: {
      async create(input) {
        createCalls.push(input);
        if (createIssueThrows) throw new Error('host issues.create 503');
        // The atomic new-topic path calls create up to 3x (parent, topic,
        // task). Hand back deterministic ids so the test can assert the chain.
        createdSeq += 1;
        // The FIRST create in a single-create (existing-topic) flow keeps the
        // configured createdIssueId; the multi-create flow keys off originKind.
        if (typeof input.originId === 'string' && input.originId.startsWith('chat-parent-')) {
          return { id: `PARENT-${createdSeq}`, ...input };
        }
        if (typeof input.originId === 'string' && input.originId.startsWith('chat-topic-')) {
          return { id: `TOPIC-${createdSeq}`, ...input };
        }
        return { id: createdIssueId, ...input };
      },
      async createComment(issueId, body, companyId) {
        createCommentCalls.push({ issueId, body, companyId });
        if (createCommentThrows) throw new Error('host createComment 503');
        return { id: `comment-${createCommentCalls.length}`, issueId, body, companyId };
      },
    },
    // Plan 04.1-05 retrofit -- createTrueTask now writes to the
    // chat_topic_tasks side table best-effort post-create. The helper
    // accepts an optional `db` field; the older callers (which never
    // exercised the side table) supply nothing or supply this fake.
    db: {
      async execute(sql, params) {
        if (
          /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topic_tasks/i.test(sql)
        ) {
          if (sideTableThrows) throw new Error('host db.execute 503');
          sideTableInserts.push({ sql, params });
          return { rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics\b/i.test(sql)) {
          topicInserts.push({ sql, params });
          return { rowCount: 1 };
        }
        if (
          /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)
        ) {
          parentInserts.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      },
      async query(sql, params) {
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_employee_parents/i.test(sql)) {
          // getEmployeeParentIssueId pre-insert lookup + insertEmployeeParent
          // read-back. After a parent insert, return the inserted id.
          if (parentInserts.length > 0) {
            return [{ parent_issue_id: parentInserts[parentInserts.length - 1].params[2] }];
          }
          return existingParentId ? [{ parent_issue_id: existingParentId }] : [];
        }
        if (/MAX\(CAST\(substring\(topic_id/i.test(sql)) {
          return [{ max_n: chtMaxN }];
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics\b/i.test(sql)) {
          // getChatTopicByIssueId read-back inside insertChatTopic. Return the
          // row keyed on (company_id, issue_id) from the last topic insert.
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
    },
    _createCalls: createCalls,
    _createCommentCalls: createCommentCalls,
    _warnLogs: warnLogs,
    _sideTableInserts: sideTableInserts,
    _topicInserts: topicInserts,
    _parentInserts: parentInserts,
  };
  return ctx;
}

function input(overrides = {}) {
  return {
    companyId: 'co-1',
    title: 'Ship the pricing page by Friday',
    description: 'Created from a chat composer message.\n\nMessage body:\nShip the pricing page by Friday',
    assigneeAgentId: 'agent-cfo',
    topicIssueId: 'issue-topic-1',
    sourceCommentId: 'c-source-1',
    employeeName: 'CFO',
    ...overrides,
  };
}

// ---- Test 1 — module exports ------------------------------------------------

test('createTrueTask is exported from src/worker/chat/true-task.ts', () => {
  assert.equal(typeof createTrueTask, 'function');
});

// ---- Test 2 — HAPPY: ctx.issues.create called once with the locked shape ---

test('createTrueTask: ctx.issues.create called ONCE with locked payload (D-05/D-06/D-07)', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-202' });
  const result = await createTrueTask(ctx, input());

  assert.equal(ctx._createCalls.length, 1);
  const call = ctx._createCalls[0];
  assert.equal(call.companyId, 'co-1');
  assert.equal(call.title, 'Ship the pricing page by Friday');
  assert.equal(call.status, 'todo');
  assert.equal(call.assigneeAgentId, 'agent-cfo');
  assert.equal(call.originKind, 'plugin:clarity-pack');
  assert.equal(call.originId, 'chat-task:issue-topic-1:c-source-1');
  assert.equal(result.issueId, 'BEAAA-202');
});

// ---- Test 3 — TOP-LEVEL: no parentId key in the payload --------------------

test('createTrueTask: ctx.issues.create payload has NO parentId key (D-05 anti-regression)', async () => {
  const ctx = makeCtx();
  await createTrueTask(ctx, input());
  const call = ctx._createCalls[0];
  assert.ok(!('parentId' in call), 'parentId must NOT be present in the create payload');
});

// ---- Test 4 — ASSIGNED: assigneeAgentId is required, non-empty string ------

test('createTrueTask: assigneeAgentId is a non-empty string on the create payload (D-06 anti-regression)', async () => {
  const ctx = makeCtx();
  await createTrueTask(ctx, input({ assigneeAgentId: 'agent-cmo' }));
  const call = ctx._createCalls[0];
  assert.equal(typeof call.assigneeAgentId, 'string');
  assert.ok(call.assigneeAgentId.length > 0);
  assert.equal(call.assigneeAgentId, 'agent-cmo');
});

// ---- Test 5 — MARKER comment is posted on the topic issue with pinned copy

test('createTrueTask: posts marker comment on topic issue with locked wording (D-07)', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-202' });
  await createTrueTask(ctx, input({ employeeName: 'CFO' }));
  assert.equal(ctx._createCommentCalls.length, 1);
  const { issueId, body, companyId } = ctx._createCommentCalls[0];
  assert.equal(issueId, 'issue-topic-1');
  assert.equal(body, 'Task created — BEAAA-202, assigned to CFO.');
  assert.equal(companyId, 'co-1');
});

// ---- Test 6 — Marker wording MUST NOT match Plan 04.1-04 RUNTIME_PHRASES ---

test('createTrueTask: marker comment body does NOT match any RUNTIME_PHRASES (Pitfall 4)', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-202' });
  await createTrueTask(ctx, input({ employeeName: 'CFO' }));
  const body = ctx._createCommentCalls[0].body.toLowerCase();
  const RUNTIME_PHRASES = [
    'needs a disposition',
    'blocked on a recovery owner',
    'finish_successful_run_handoff',
    'exhausted the bounded corrective handoff',
  ];
  for (const phrase of RUNTIME_PHRASES) {
    assert.ok(
      !body.includes(phrase.toLowerCase()),
      `marker body must NOT contain runtime phrase ${JSON.stringify(phrase)}`,
    );
  }
});

// ---- Test 7 — originId fallback when sourceCommentId is null (composer) ----

test('createTrueTask: originId uses ":composer" suffix when sourceCommentId is null', async () => {
  const ctx = makeCtx();
  await createTrueTask(ctx, input({ sourceCommentId: null }));
  const call = ctx._createCalls[0];
  assert.equal(call.originId, 'chat-task:issue-topic-1:composer');
});

// ---- Test 8 — returns the new issue id ------------------------------------

test('createTrueTask: returns { issueId } from ctx.issues.create result', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-999' });
  const result = await createTrueTask(ctx, input());
  assert.deepEqual(result, { issueId: 'BEAAA-999' });
});

// ---- Test 9 — ctx.issues.create failure RE-THROWS -------------------------

test('createTrueTask: re-throws when ctx.issues.create fails (handler converts to structured error)', async () => {
  const ctx = makeCtx({ createIssueThrows: true });
  await assert.rejects(
    () => createTrueTask(ctx, input()),
    /issues\.create 503/,
  );
  assert.equal(ctx._createCommentCalls.length, 0, 'no marker write attempted when create failed');
});

// ---- Test 10 — Marker-comment failure after successful create is NON-FATAL

test('createTrueTask: marker-comment write failure still returns { issueId } (best-effort durability)', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-202', createCommentThrows: true });
  const result = await createTrueTask(ctx, input());
  assert.deepEqual(result, { issueId: 'BEAAA-202' });
  assert.equal(ctx._warnLogs.length, 1, 'one warn-level log entry on marker failure');
  assert.match(ctx._warnLogs[0].msg, /marker|createComment/i);
});

// ---- Test 11 — titleFromBody: short body returned as-is -------------------

test('titleFromBody: short single-line body is returned trimmed and intact', () => {
  assert.equal(titleFromBody('short body'), 'short body');
});

// ---- Test 12 — titleFromBody: long body → 77 + "..." (80 total) -----------

test('titleFromBody: 100-char single-line body returns first 77 chars + "..." (80 total)', () => {
  const body = 'a'.repeat(100);
  const out = titleFromBody(body);
  assert.equal(out.length, 80);
  assert.equal(out.slice(-3), '...');
  assert.equal(out.slice(0, 77), 'a'.repeat(77));
});

// ---- Test 13 — titleFromBody: empty body → 'Promoted chat message' --------

test('titleFromBody: empty body returns "Promoted chat message" fallback', () => {
  assert.equal(titleFromBody(''), 'Promoted chat message');
});

// ===========================================================================
// Plan 04.1-05 cross-plan retrofit -- side-table back-link write
// ===========================================================================
//
// Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER: the host REST
// issues.list silently ignores originId filters, so chat.taskOwned (D-08)
// reads the chat_topic_tasks side table. createTrueTask MUST write the
// topic -> task back-link on every successful task create. The write is
// best-effort (try/catch + warn-log; failure never bubbles), mirroring
// the marker-comment best-effort discipline already in this helper. This
// is the cross-plan retrofit Plan 04.1-05 spec explicitly carries.

test('createTrueTask retrofit: writes chat_topic_tasks back-link after successful issue create', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-RETRO-1' });
  await createTrueTask(ctx, input());
  assert.equal(
    ctx._sideTableInserts.length,
    1,
    'exactly one chat_topic_tasks INSERT issued post-create',
  );
  const insert = ctx._sideTableInserts[0];
  // params: [company_id, topic_issue_id, task_issue_id]
  assert.deepEqual(insert.params, ['co-1', 'issue-topic-1', 'BEAAA-RETRO-1']);
  assert.match(
    insert.sql,
    /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_topic_tasks/i,
  );
  assert.match(
    insert.sql,
    /ON CONFLICT[\s\S]*DO NOTHING/i,
    'idempotent retrofit write (race-safe)',
  );
});

test('createTrueTask retrofit: side-table INSERT failure does NOT fail the helper (best-effort)', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-RETRO-2', sideTableThrows: true });
  const result = await createTrueTask(ctx, input());
  assert.deepEqual(
    result,
    { issueId: 'BEAAA-RETRO-2' },
    'helper still returns the created issueId',
  );
  // A warn-log entry mentions the side-table failure.
  assert.ok(
    ctx._warnLogs.some((w) =>
      /chat_topic_tasks|side[-_ ]?table|retrofit/i.test(w.msg ?? ''),
    ),
    'warn-log entry mentions the side-table failure',
  );
});

test('createTrueTask retrofit: side-table write happens AFTER ctx.issues.create succeeds (not before)', async () => {
  // If create fails, the helper re-throws BEFORE any side-table write.
  const ctx = makeCtx({ createIssueThrows: true });
  await assert.rejects(() => createTrueTask(ctx, input()), /issues\.create 503/);
  assert.equal(
    ctx._sideTableInserts.length,
    0,
    'no side-table INSERT when create itself fails',
  );
});

test('createTrueTask retrofit: side-table write happens even if marker createComment fails (best-effort symmetry)', async () => {
  const ctx = makeCtx({
    createdIssueId: 'BEAAA-RETRO-3',
    createCommentThrows: true,
  });
  await createTrueTask(ctx, input());
  // The marker comment failed -- a warn-log recorded it -- but the side
  // table was still written, because the task was created successfully
  // (the side table is the AUTHORITATIVE back-link per Wave 1 lock).
  assert.equal(ctx._sideTableInserts.length, 1);
  assert.equal(ctx._sideTableInserts[0].params[2], 'BEAAA-RETRO-3');
});

// ===========================================================================
// quick-260619-r4v Piece 1 -- cold-path REMOVED + atomic new-topic create
// ===========================================================================
//
// SPEC Piece 1: every operator-created task is topic-linked. The cold-task
// branch (topicIssueId === null, no newTopicTitle, originId `cold-task:...`)
// is DELETED. A new `newTopicTitle` input atomically creates the topic
// (parent + CHT-N + chat_topics row) and then the topic-linked task.

test('createTrueTask: NEVER emits a cold-task: originId (cold path removed)', async () => {
  const ctx = makeCtx();
  await createTrueTask(ctx, input());
  for (const call of ctx._createCalls) {
    assert.ok(
      typeof call.originId !== 'string' || !call.originId.startsWith('cold-task:'),
      `no create payload may carry a cold-task: originId (got ${call.originId})`,
    );
  }
});

test('createTrueTask: topicIssueId null AND no newTopicTitle -> THROWS (no cold task)', async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => createTrueTask(ctx, input({ topicIssueId: null, newTopicTitle: undefined })),
    /topic/i,
  );
  assert.equal(ctx._createCalls.length, 0, 'no issue created when neither topic nor newTopicTitle present');
});

test('createTrueTask newTopicTitle (first-ever topic): creates parent + topic + task + marker + back-link atomically', async () => {
  const ctx = makeCtx({ existingParentId: null, chtMaxN: null });
  const result = await createTrueTask(
    ctx,
    input({
      topicIssueId: null,
      newTopicTitle: 'Q3 pricing rework',
      assigneeAgentId: 'agent-cfo',
      employeeName: 'CFO',
    }),
  );

  // 3 ctx.issues.create calls: parent, topic, task.
  assert.equal(ctx._createCalls.length, 3, 'parent + topic + task created');
  const parent = ctx._createCalls.find((c) => String(c.originId).startsWith('chat-parent-'));
  const topic = ctx._createCalls.find((c) => String(c.originId).startsWith('chat-topic-'));
  const task = ctx._createCalls.find((c) => String(c.originId).startsWith('chat-task:'));
  assert.ok(parent, 'a chat-parent issue was created (first-ever topic)');
  assert.ok(topic, 'a chat-topic issue was created');
  assert.ok(task, 'a chat-task issue was created');

  // The topic is created at the non-terminal conversation status, assigned.
  assert.equal(topic.status, 'in_progress');
  assert.equal(topic.assigneeAgentId, 'agent-cfo');
  assert.equal(topic.title, 'Q3 pricing rework');

  // chat_topics row inserted; chat_employee_parents row inserted (first-ever).
  assert.equal(ctx._topicInserts.length, 1, 'one chat_topics row inserted');
  assert.equal(ctx._parentInserts.length, 1, 'one chat_employee_parents row inserted (bootstrap)');

  // The task is the locked top-level create with a chat-task: originId keyed
  // on the NEW topic issue id.
  assert.equal(task.status, 'todo');
  assert.equal(task.assigneeAgentId, 'agent-cfo');
  assert.ok(String(task.originId).startsWith(`chat-task:${topic.id ?? 'TOPIC'}`) || String(task.originId).startsWith('chat-task:TOPIC-'));

  // Marker comment posted on the NEW topic issue.
  assert.equal(ctx._createCommentCalls.length, 1, 'marker comment posted on the new topic');
  assert.match(ctx._createCommentCalls[0].body, /^Task created — .+, assigned to CFO\.$/);

  // Side-table back-link written for the new topic.
  assert.equal(ctx._sideTableInserts.length, 1, 'one chat_topic_tasks back-link written');

  // Returns the created task issueId.
  assert.equal(result.issueId, 'BEAAA-202');
});

test('createTrueTask newTopicTitle (existing parent): reuses parent, does NOT bootstrap a new one', async () => {
  const ctx = makeCtx({ existingParentId: 'PARENT-EXISTING', chtMaxN: 4 });
  await createTrueTask(
    ctx,
    input({
      topicIssueId: null,
      newTopicTitle: 'Another conversation',
      assigneeAgentId: 'agent-cfo',
      employeeName: 'CFO',
    }),
  );
  // No parent create (reused), no parent insert (already mapped). 2 creates:
  // topic + task.
  assert.equal(ctx._parentInserts.length, 0, 'existing parent reused -- no bootstrap insert');
  const parent = ctx._createCalls.find((c) => String(c.originId).startsWith('chat-parent-'));
  assert.ok(!parent, 'no new parent issue created when one already exists');
  assert.equal(ctx._createCalls.length, 2, 'topic + task created (no parent bootstrap)');
});

test('createTrueTask: existing topicIssueId path is unchanged (single create + marker + back-link)', async () => {
  const ctx = makeCtx({ createdIssueId: 'BEAAA-EXIST' });
  const result = await createTrueTask(ctx, input());
  assert.equal(ctx._createCalls.length, 1, 'single create on the existing-topic path');
  assert.equal(ctx._createCalls[0].originId, 'chat-task:issue-topic-1:c-source-1');
  assert.equal(ctx._createCommentCalls.length, 1);
  assert.equal(ctx._sideTableInserts.length, 1);
  assert.equal(result.issueId, 'BEAAA-EXIST');
});
