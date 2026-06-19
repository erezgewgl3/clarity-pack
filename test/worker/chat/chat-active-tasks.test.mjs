// test/worker/chat/chat-active-tasks.test.mjs
//
// Plan 04.1-05 Task 2 RED -> GREEN -- chat.taskOwned DATA handler.
//
// D-08 -- list every true task spawned from a given chat topic with live
// status pills for the context rail (Plan 04.1-06 ActiveTasksOwned).
//
// Wave 1 lock per 04.1-01-SPIKE-FINDINGS PROBE-OQ2-FILTER: the host REST
// issues.list surface silently ignores originId / originIdPrefix filters
// (returns the 500-row cap; exact-match returns 0 even when the row
// exists). The handler therefore reads the chat_topic_tasks SIDE TABLE
// (populated by createTrueTask's retrofit write) -- NOT ctx.issues.list --
// and enriches each row via ctx.issues.get. listChatTopicTasksForTopic
// is bounded by LIMIT 50 in the repo so a runaway topic cannot blow up
// the rail.
//
// Data-handler convention (mirrors chat-messages / chat-topics data half):
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//                                       (data-handler convention: never throw)
//   - opted-out caller              -> RETURN { error: 'OPT_IN_REQUIRED' }
//                                       (via wrapDataHandler -- T-04-15)
//   - repo / get failure for the    -> per-row skip (do not fail the whole
//     side table SELECT             -> response); SELECT failure RETURNs
//                                       { error: 'TASKS_FAILED' } + warn log.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatActiveTasks } from '../../../src/worker/handlers/chat-active-tasks.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  // chatTopicTasks: side-table seed (already filtered by company+topic by the
  // caller). Each entry: { taskIssueId, createdAt }.
  chatTopicTasks = [],
  // issueGetThrows: when truthy, ctx.issues.get always throws.
  issueGetThrows = false,
  // issueDeleted: set of taskIssueIds for which ctx.issues.get resolves null
  // (issue deleted out-of-band).
  issueDeleted = new Set(),
  // issueGetFailsFor: set of taskIssueIds for which ctx.issues.get throws
  // (single-row failure -- handler should skip that row, not fail).
  issueGetFailsFor = new Set(),
  // issueRows: by id, a per-row record used as the ctx.issues.get response.
  issueRows = {},
  // selectThrows: when truthy, the side-table SELECT throws.
  selectThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  // The handler MUST NOT call ctx.issues.list -- this is the Pitfall 5
  // anti-regression. Spy on it; assert zero invocations.
  const issueListCalls = [];
  const issueGetCalls = [];
  // quick-260619-r4v anti-storm spies — the read path must NEVER wake an
  // agent or subscribe to events.
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
        // If something does manage to call list, return empty so any
        // accidental fall-through is at least quiet.
        return [];
      },
      async get(issueId, companyId) {
        issueGetCalls.push({ issueId, companyId });
        if (issueGetThrows) throw new Error('host issues.get 503');
        if (issueGetFailsFor.has(issueId)) {
          throw new Error(`host issues.get 503 for ${issueId}`);
        }
        if (issueDeleted.has(issueId)) return null;
        return issueRows[issueId] ?? null;
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
          // quick-260619-r4v Piece 2: company-wide SELECT (no topic filter).
          // Test seed is already pre-filtered; emit { task_issue_id } rows.
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
    _wakeCalls: wakeCalls,
    _eventSubs: eventSubs,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function activeTasksParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    ...overrides,
  };
}

// Helper: build an ctx.issues.get response row matching the Issue shape
// the handler reads. Only the fields we surface are required; everything
// else is permitted (real host returns much more).
function issueRow(overrides = {}) {
  return {
    id: 'T1',
    identifier: 'BEAAA-200',
    title: 'Task A',
    status: 'todo',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---- Test 1 — handler registers under exactly chat.taskOwned -------------

test('chat.taskOwned: handler registers under key chat.taskOwned', () => {
  const ctx = makeCtx();
  registerChatActiveTasks(ctx);
  assert.ok(ctx._handlers.has('chat.taskOwned'));
  assert.equal(ctx._handlers.size, 1, 'exactly one handler key registered');
});

// ---- Test 2 — OPT-IN gate ------------------------------------------------

test('chat.taskOwned: opted-out caller -> { error: OPT_IN_REQUIRED }', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

// ---- Test 3 — MISSING-PARAMS-RETURN-ERROR (data-handler convention) ------

test('chat.taskOwned: missing companyId -> { error: COMPANY_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatActiveTasks(ctx);
  const p = activeTasksParams();
  delete p.companyId;
  const result = await ctx._handlers.get('chat.taskOwned')(p);
  // Opt-in gate fires first when userId is present; without companyId, the
  // gate still tries to look up prefs by userId -- which DOES return the
  // opted-in row. So the handler body runs, hits the missing-param branch,
  // and returns COMPANY_ID_REQUIRED.
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.taskOwned: missing userId -> { error: OPT_IN_REQUIRED } (opt-in-guard fires first)', async () => {
  const ctx = makeCtx();
  registerChatActiveTasks(ctx);
  const p = activeTasksParams();
  delete p.userId;
  const result = await ctx._handlers.get('chat.taskOwned')(p);
  // extractUserId returns null -> isOptedIn returns false -> OPT_IN_REQUIRED.
  // The handler body never executes, so USER_ID_REQUIRED is not reachable.
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

// quick-260619-r4v Piece 2 — the rail is now COMPANY-WIDE. topicIssueId is no
// longer required (it is accepted-and-ignored for back-compat). A request
// without it succeeds (company-wide enumerate).
test('chat.taskOwned: missing topicIssueId -> OK (company-wide; topic no longer required)', async () => {
  const ctx = makeCtx({ chatTopicTasks: [] });
  registerChatActiveTasks(ctx);
  const p = activeTasksParams();
  delete p.topicIssueId;
  const result = await ctx._handlers.get('chat.taskOwned')(p);
  assert.equal(result.kind, 'taskOwned');
  assert.deepEqual(result.tasks, []);
});

// ---- Test 4 — HAPPY-PATH-MATCH: side-table SELECT + per-row issues.get ----

test('chat.taskOwned: returns { kind: taskOwned, topicIssueId, tasks: [...] } with shape mapped from per-row issues.get', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [
      { taskIssueId: 'T-NEW', createdAt: '2026-01-02T00:00:00Z' },
      { taskIssueId: 'T-OLD', createdAt: '2026-01-01T00:00:00Z' },
    ],
    issueRows: {
      'T-NEW': issueRow({
        id: 'T-NEW',
        identifier: 'BEAAA-201',
        title: 'Task B',
        status: 'in_progress',
        createdAt: '2026-01-02T00:00:00Z',
      }),
      'T-OLD': issueRow({
        id: 'T-OLD',
        identifier: 'BEAAA-200',
        title: 'Task A',
        status: 'todo',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    },
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());

  assert.equal(result.kind, 'taskOwned');
  assert.equal(result.topicIssueId, 'issue-topic-1');
  assert.equal(result.tasks.length, 2, 'both side-table rows surfaced');
  // Order follows the side-table SELECT ORDER BY created_at DESC (the fake
  // returns rows in seed order -- the test seeds newest-first).
  assert.deepEqual(result.tasks[0], {
    issueId: 'T-NEW',
    identifier: 'BEAAA-201',
    title: 'Task B',
    status: 'in_progress',
    createdAt: '2026-01-02T00:00:00Z',
  });
  assert.deepEqual(result.tasks[1], {
    issueId: 'T-OLD',
    identifier: 'BEAAA-200',
    title: 'Task A',
    status: 'todo',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

// ---- Test 5 — EMPTY-LIST: no tasks for this topic -> tasks: [] -----------

test('chat.taskOwned: side table empty -> { kind: taskOwned, tasks: [] } (no host calls)', async () => {
  const ctx = makeCtx({ chatTopicTasks: [] });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.kind, 'taskOwned');
  assert.deepEqual(result.tasks, []);
  assert.equal(ctx._issueGetCalls.length, 0, 'no per-row enrich calls when list is empty');
});

// ---- Test 6 — SELECT-FAILS: side-table query throws -> TASKS_FAILED ------

test('chat.taskOwned: side-table SELECT throws -> { error: TASKS_FAILED } + warn log', async () => {
  const ctx = makeCtx({ selectThrows: true });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.error, 'TASKS_FAILED');
  assert.ok(ctx._warnLogs.length >= 1, 'at least one warn-log entry');
});

// ---- Test 7 — PER-ROW-FAILURE: one issues.get throws -> skip that row ----

test('chat.taskOwned: one bad row (issues.get throws) is SKIPPED -- the rest still surface', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [
      { taskIssueId: 'T-GOOD', createdAt: '2026-01-02T00:00:00Z' },
      { taskIssueId: 'T-BAD', createdAt: '2026-01-01T00:00:00Z' },
    ],
    issueRows: {
      'T-GOOD': issueRow({
        id: 'T-GOOD',
        identifier: 'BEAAA-200',
        title: 'Good task',
        status: 'todo',
        createdAt: '2026-01-02T00:00:00Z',
      }),
    },
    issueGetFailsFor: new Set(['T-BAD']),
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.kind, 'taskOwned');
  assert.equal(result.tasks.length, 1, 'only the good row surfaces');
  assert.equal(result.tasks[0].issueId, 'T-GOOD');
});

// ---- Test 8 — PER-ROW-DELETED: issues.get returns null -> SKIP ----------

test('chat.taskOwned: deleted-out-of-band row (issues.get returns null) is SKIPPED', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [
      { taskIssueId: 'T-GOOD', createdAt: '2026-01-02T00:00:00Z' },
      { taskIssueId: 'T-DEL', createdAt: '2026-01-01T00:00:00Z' },
    ],
    issueRows: {
      'T-GOOD': issueRow({
        id: 'T-GOOD',
        identifier: 'BEAAA-200',
        title: 'Good',
        status: 'todo',
        createdAt: '2026-01-02T00:00:00Z',
      }),
    },
    issueDeleted: new Set(['T-DEL']),
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.tasks.length, 1, 'only the surviving row surfaces');
  assert.equal(result.tasks[0].issueId, 'T-GOOD');
});

// ---- Test 9 — CREATED-AT-COERCION: Date / string / null ------------------

test('chat.taskOwned: createdAt coerces Date -> ISO string; string -> string; null/undefined -> null', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [
      { taskIssueId: 'T-DATE', createdAt: '2026-01-03T00:00:00Z' },
      { taskIssueId: 'T-STR', createdAt: '2026-01-02T00:00:00Z' },
      { taskIssueId: 'T-NULL', createdAt: '2026-01-01T00:00:00Z' },
    ],
    issueRows: {
      'T-DATE': issueRow({
        id: 'T-DATE',
        identifier: 'BEAAA-A',
        title: 'Date',
        status: 'todo',
        createdAt: new Date('2026-01-03T12:34:56Z'),
      }),
      'T-STR': issueRow({
        id: 'T-STR',
        identifier: 'BEAAA-B',
        title: 'Str',
        status: 'todo',
        createdAt: '2026-01-02T07:00:00Z',
      }),
      'T-NULL': issueRow({
        id: 'T-NULL',
        identifier: 'BEAAA-C',
        title: 'Null',
        status: 'todo',
        createdAt: null,
      }),
    },
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  const byId = Object.fromEntries(result.tasks.map((t) => [t.issueId, t.createdAt]));
  assert.equal(byId['T-DATE'], '2026-01-03T12:34:56.000Z', 'Date -> ISO');
  assert.equal(byId['T-STR'], '2026-01-02T07:00:00Z', 'string passes through');
  assert.equal(byId['T-NULL'], null, 'null stays null');
});

// ---- Test 10 — NEVER-CALLS-CTX.ISSUES.LIST (Pitfall 5 anti-regression) ---
//
// The Wave 1 lock made the side table the steady-state path because the
// host's REST issues.list silently ignores originId filters. This test
// pins that ctx.issues.list is NEVER called from chat.taskOwned -- even
// when the side table is empty.

test('chat.taskOwned: NEVER calls ctx.issues.list (Wave 1 lock + Pitfall 5 anti-regression)', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1', createdAt: '2026-01-01Z' }],
    issueRows: {
      T1: issueRow({ id: 'T1', identifier: 'BEAAA-A', title: 'T', status: 'todo' }),
    },
  });
  registerChatActiveTasks(ctx);
  await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  // Also exercise the empty path.
  const ctx2 = makeCtx({ chatTopicTasks: [] });
  registerChatActiveTasks(ctx2);
  await ctx2._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(ctx._issueListCalls.length, 0);
  assert.equal(ctx2._issueListCalls.length, 0);
});

// ---- Test 11 — DEFAULTS: missing identifier/title/status from issues.get ---
//
// Defensive mapping for a host that ever returns a sparser Issue shape.

test('chat.taskOwned: defensive defaults when identifier/title/status are missing on the host row', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T-SPARSE', createdAt: '2026-01-01Z' }],
    issueRows: {
      'T-SPARSE': { id: 'T-SPARSE' }, // no identifier/title/status/createdAt
    },
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.tasks.length, 1);
  const t = result.tasks[0];
  assert.equal(t.issueId, 'T-SPARSE');
  assert.equal(t.identifier, 'T-SPARSE', 'identifier falls back to issueId');
  assert.ok(typeof t.title === 'string' && t.title.length > 0, 'title has a fallback');
  assert.ok(typeof t.status === 'string' && t.status.length > 0, 'status has a fallback');
  assert.equal(t.createdAt, null);
});

// ---- Test 12 — registerChatActiveTasks is exported as a function ---------

test('registerChatActiveTasks is exported as a function', async () => {
  const mod = await import('../../../src/worker/handlers/chat-active-tasks.ts');
  assert.equal(typeof mod.registerChatActiveTasks, 'function');
});

// ===========================================================================
// quick-260619-r4v Piece 2 — company-wide, grouped-by-live-assignee rail
// ===========================================================================

// ---- Group by LIVE assignee; reassignment follows owner ------------------

test('chat.taskOwned: groups by LIVE assignee (issues.get assignee), reassignment follows owner', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [
      { taskIssueId: 'T1', createdAt: '2026-01-03Z' },
      { taskIssueId: 'T2', createdAt: '2026-01-02Z' },
      { taskIssueId: 'T3', createdAt: '2026-01-01Z' },
    ],
    issueRows: {
      // T1 + T3 live-assigned to CFO; T2 reassigned out-of-band to CMO.
      T1: issueRow({ id: 'T1', identifier: 'B-1', title: 'A', status: 'todo', assignee: { id: 'agent-cfo', name: 'CFO' } }),
      T2: issueRow({ id: 'T2', identifier: 'B-2', title: 'B', status: 'in_progress', assignee: { id: 'agent-cmo', name: 'CMO' } }),
      T3: issueRow({ id: 'T3', identifier: 'B-3', title: 'C', status: 'done', assignee: { id: 'agent-cfo', name: 'CFO' } }),
    },
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.kind, 'taskOwned');
  assert.ok(Array.isArray(result.groups), 'groups array present');
  const byAssignee = Object.fromEntries(result.groups.map((g) => [g.assignee, g.tasks.map((t) => t.issueId)]));
  assert.deepEqual(byAssignee['CFO'].sort(), ['T1', 'T3'], 'CFO group has T1 + T3');
  assert.deepEqual(byAssignee['CMO'], ['T2'], 'CMO group has the reassigned T2 (follows live owner)');
});

// ---- NO_UUID_LEAK: raw-UUID assignee degrades to "Unassigned" ------------

test('chat.taskOwned: a raw-UUID assignee never leaks; degrades to Unassigned bucket', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1', createdAt: '2026-01-01Z' }],
    issueRows: {
      T1: issueRow({
        id: 'T1',
        identifier: 'B-1',
        title: 'A',
        status: 'todo',
        // assignee name is a bare UUID (host degraded) — must NOT render raw.
        assignee: { id: '11111111-2222-3333-4444-555555555555', name: '11111111-2222-3333-4444-555555555555' },
      }),
    },
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  for (const g of result.groups) {
    assert.ok(
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(g.assignee),
      `group assignee label must not be a raw UUID (got ${g.assignee})`,
    );
  }
});

// ---- Cap M=100 + shown/total/capped --------------------------------------

test('chat.taskOwned: caps at M=100 with capped:true + total/shown when the side table returns the cap', async () => {
  const seed = [];
  const rows = {};
  for (let i = 0; i < 100; i += 1) {
    const id = `K${i}`;
    seed.push({ taskIssueId: id, createdAt: `2026-01-01Z` });
    rows[id] = issueRow({ id, identifier: `B-${i}`, title: `t${i}`, status: 'todo', assignee: { id: 'agent-cfo', name: 'CFO' } });
  }
  const ctx = makeCtx({ chatTopicTasks: seed, issueRows: rows });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.capped, true, 'capped flips true at the M=100 boundary');
  assert.equal(result.shown, 100);
  assert.equal(result.total, 100);
});

test('chat.taskOwned: under the cap, capped:false', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1', createdAt: '2026-01-01Z' }],
    issueRows: { T1: issueRow({ id: 'T1', identifier: 'B-1', title: 'A', status: 'todo', assignee: { id: 'agent-cfo', name: 'CFO' } }) },
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.capped, false);
  assert.equal(result.shown, 1);
  assert.equal(result.total, 1);
});

// ---- Per-row enrich failure COUNTED (skipped), never silently dropped -----

test('chat.taskOwned: a failed enrich is COUNTED in skipped (not silently dropped)', async () => {
  const ctx = makeCtx({
    chatTopicTasks: [
      { taskIssueId: 'T-GOOD', createdAt: '2026-01-02Z' },
      { taskIssueId: 'T-BAD', createdAt: '2026-01-01Z' },
    ],
    issueRows: {
      'T-GOOD': issueRow({ id: 'T-GOOD', identifier: 'B-1', title: 'G', status: 'todo', assignee: { id: 'agent-cfo', name: 'CFO' } }),
    },
    issueGetFailsFor: new Set(['T-BAD']),
  });
  registerChatActiveTasks(ctx);
  const result = await ctx._handlers.get('chat.taskOwned')(activeTasksParams());
  assert.equal(result.skipped, 1, 'the failed row is counted, not dropped silently');
  assert.equal(result.total, 2, 'total reflects the side-table rows');
  // The good row still surfaces in a group.
  const ids = result.groups.flatMap((g) => g.tasks.map((t) => t.issueId));
  assert.deepEqual(ids, ['T-GOOD']);
});

// ---- ANTI-STORM (company-wide): zero list / db.execute / wake / events ----
// (also see the cross-cutting Task-5 guard; this pins it at the handler.)

test('chat.taskOwned (company-wide): ZERO issues.list / db.execute / requestWakeup / events — populated AND empty', async () => {
  // Populated.
  const ctxP = makeCtx({
    chatTopicTasks: [{ taskIssueId: 'T1', createdAt: '2026-01-01Z' }],
    issueRows: { T1: issueRow({ id: 'T1', identifier: 'B-1', title: 'A', status: 'todo', assignee: { id: 'agent-cfo', name: 'CFO' } }) },
  });
  registerChatActiveTasks(ctxP);
  await ctxP._handlers.get('chat.taskOwned')(activeTasksParams());
  // Empty.
  const ctxE = makeCtx({ chatTopicTasks: [] });
  registerChatActiveTasks(ctxE);
  await ctxE._handlers.get('chat.taskOwned')(activeTasksParams());

  for (const ctx of [ctxP, ctxE]) {
    assert.equal(ctx._issueListCalls.length, 0, 'zero ctx.issues.list');
    const executes = ctx._calls.filter((c) => c.kind === 'execute');
    assert.equal(executes.length, 0, 'zero ctx.db.execute (read path)');
    assert.equal((ctx._wakeCalls ?? []).length, 0, 'zero requestWakeup');
    assert.equal((ctx._eventSubs ?? []).length, 0, 'zero event subscriptions');
  }
});
