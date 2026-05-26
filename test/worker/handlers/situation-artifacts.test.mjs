// test/worker/handlers/situation-artifacts.test.mjs
//
// Phase 6.1 Plan 02 Task 2 -- situation.artifacts DATA handler (ROOM-10).
//
// Behaviors (from 06.1-02-PLAN.md <behavior> block):
//   1. opt-in gate: opted-out caller -> OPT_IN_REQUIRED; no SQL query, no
//      ctx.agents.list call.
//   2. missing companyId -> COMPANY_ID_REQUIRED (return, NOT throw -- data-
//      handler convention; chat-attachment-list.ts:67-69 template).
//   3. missing userId -> USER_ID_REQUIRED (return, NOT throw).
//   4. default 24h window: handler reads ctx.config; falls back to '24h' when
//      key absent; SQL parameter bound as Postgres '24 hours' interval.
//   5. configurable 7d / 30d: handler honors instance config value; SQL
//      parameter bound accordingly.
//   6. unknown window value: handler coerces to '24h' default
//      (T-06.1-10 mitigation; never trust raw config string in SQL).
//   7. empty result: artifacts:{} returned; no error.
//   8. PRIM-01 single bulk query for chat-attachments half: ctx.db.query
//      fires AT MOST TWICE per dispatch (once for clarity_user_prefs opt-in
//      lookup; once for the chat_message_attachments JOIN to chat_topics).
//      NO per-agent loop with multiple DB queries for the chat-attachments
//      half. The deliverables half uses ctx.issues.documents.list per agent
//      -- that is a host SDK call, not a DB query, and is bounded by
//      N agents (RESEARCH.md §A1).
//   9. newest-first ordering preserved through the map().
//  10. limit clamp at 100/agent: synthetic agent with 150 chat-attachments
//      in window returns array length <= 100.
//  11. CTT-07 runtime spy: across every code path in Tests 1-10,
//      ctx._issueUpdateCalls.length === 0. Load-bearing.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationArtifacts } from '../../../src/worker/handlers/situation-artifacts.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeAgentRow(overrides = {}) {
  return {
    id: 'agent-1',
    user_id: 'agent-user-1',
    role: 'manager',
    current_focus_issue_id: 'issue-source-1',
    ...overrides,
  };
}

function makeAttachmentRow(overrides = {}) {
  return {
    id: 'att-1',
    chat_message_id: 'msg-uuid-1',
    topic_issue_id: 'issue-topic-1',
    document_key: 'chat-attach-att-1',
    mime_type: 'application/pdf',
    original_filename: 'sample.pdf',
    byte_size: 2048,
    created_at: '2026-05-26T18:00:00.000Z',
    agent_id: 'agent-1',
    ...overrides,
  };
}

function makeDocumentRow(overrides = {}) {
  return {
    id: 'doc-1',
    key: 'deliverable-doc-1',
    title: 'Deliverable.pdf',
    mimeType: 'application/pdf',
    byteSize: 4096,
    createdAt: '2026-05-26T17:30:00.000Z',
    updatedAt: '2026-05-26T17:30:00.000Z',
    ...overrides,
  };
}

function makeCtx({
  optedIn = true,
  agents = [makeAgentRow(), makeAgentRow({ id: 'agent-2', user_id: 'agent-user-2', current_focus_issue_id: 'issue-source-2' })],
  attachments = [],
  // Map of issueId -> Document[] returned by ctx.issues.documents.list.
  // Default: each agent has zero deliverables (so empty-window happy path
  // returns artifacts:{}).
  documentsByIssue = {},
  // Configurable instance-config value for situationArtifactsWindow.
  // `undefined` (default) means the key is absent -> handler must coerce
  // to '24h'.
  configValue = undefined,
  agentsListThrows = false,
  documentsListThrowsForIssues = new Set(),
  unionQueryThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  const issueUpdateCalls = [];
  const agentsListCalls = [];
  const documentsListCalls = [];

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
    config: {
      async get() {
        // Mirror the runtime contract -- ctx.config.get returns a
        // Record<string, unknown>; the handler reads
        // raw.situationArtifactsWindow.
        if (configValue === undefined) return {};
        return { situationArtifactsWindow: configValue };
      },
    },
    agents: {
      async list({ companyId }) {
        agentsListCalls.push({ companyId });
        if (agentsListThrows) throw new Error('host agents.list 503');
        return agents;
      },
    },
    issues: {
      // CTT-07 spy -- must stay at zero across every path.
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
      documents: {
        async list(issueId, companyId) {
          documentsListCalls.push({ issueId, companyId });
          if (documentsListThrowsForIssues.has(issueId)) {
            throw new Error('host documents.list 503 for ' + issueId);
          }
          return documentsByIssue[issueId] ?? [];
        },
      },
    },
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (
          /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(
            sql,
          )
        ) {
          if (unionQueryThrows) throw new Error('host db.query 503 (union)');
          return attachments;
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
    _issueUpdateCalls: issueUpdateCalls,
    _agentsListCalls: agentsListCalls,
    _documentsListCalls: documentsListCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function dispatchParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    ...overrides,
  };
}

function dbQueriesFor(ctx, sqlRegex) {
  return ctx._calls.filter(
    (c) => c.kind === 'query' && sqlRegex.test(c.sql),
  );
}

// ---- Test 1 -- opted-out caller -> OPT_IN_REQUIRED ----------------------

test('situation.artifacts: opted-out caller returns OPT_IN_REQUIRED, no body call', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  // No agents.list, no union query, no documents.list -- body never runs.
  assert.equal(ctx._agentsListCalls.length, 0);
  assert.equal(ctx._documentsListCalls.length, 0);
  const unionQueries = dbQueriesFor(ctx, /chat_message_attachments/i);
  assert.equal(unionQueries.length, 0);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 2 -- missing companyId returns structured error ---------------

test('situation.artifacts: missing companyId -> COMPANY_ID_REQUIRED', async () => {
  const ctx = makeCtx();
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams({ companyId: undefined }));
  assert.deepEqual(result, { error: 'COMPANY_ID_REQUIRED' });
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 3 -- missing userId returns structured error -----------------

test('situation.artifacts: missing userId -> OPT_IN_REQUIRED (opt-in-guard short-circuits before USER_ID_REQUIRED)', async () => {
  // The opt-in-guard's wrapDataHandler extracts userId from params BEFORE
  // the body runs (opt-in-guard.ts:96-103). When userId is missing
  // (or empty), extractUserId returns null, isOptedIn returns false,
  // and the guard returns OPT_IN_REQUIRED -- the body's USER_ID_REQUIRED
  // check never runs. This mirrors the Plan 06.1-01 finding documented in
  // 06.1-01-SUMMARY.md's "Rule 3 -- Test 2 param-validation behavior"
  // deviation: the opt-in-guard wins by ordering.
  const ctx = makeCtx();
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams({ userId: undefined }));
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 4 -- default 24h window when config key absent ----------------

test('situation.artifacts: default 24h window when config key absent; SQL interval = 24 hours', async () => {
  const ctx = makeCtx({ configValue: undefined });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  assert.equal(result.kind, 'situation-artifacts');
  assert.equal(result.windowDuration, '24h');
  const unionQueries = dbQueriesFor(ctx, /chat_message_attachments/i);
  assert.equal(unionQueries.length, 1, 'one chat-attachments union query fires');
  // $2 is the interval literal -- bind value must be the canonical
  // '24 hours' Postgres interval string for default.
  assert.equal(unionQueries[0].params[1], '24 hours');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 5 -- configurable 7d / 30d windows ---------------------------

test('situation.artifacts: configurable 7d window honored; SQL interval = 7 days', async () => {
  const ctx = makeCtx({ configValue: '7d' });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  assert.equal(result.windowDuration, '7d');
  const unionQueries = dbQueriesFor(ctx, /chat_message_attachments/i);
  assert.equal(unionQueries[0].params[1], '7 days');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

test('situation.artifacts: configurable 30d window honored; SQL interval = 30 days', async () => {
  const ctx = makeCtx({ configValue: '30d' });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  assert.equal(result.windowDuration, '30d');
  const unionQueries = dbQueriesFor(ctx, /chat_message_attachments/i);
  assert.equal(unionQueries[0].params[1], '30 days');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 6 -- unknown window value coerces to 24h (T-06.1-10) ---------

test('situation.artifacts: unknown window value coerces to 24h default', async () => {
  // T-06.1-10 mitigation: an attacker / misconfigured operator passes
  // a non-enum string; the handler must coerce to '24h' before any SQL
  // bind. The raw config string MUST NEVER reach SQL.
  const ctx = makeCtx({ configValue: 'rm -rf /' });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  assert.equal(result.windowDuration, '24h');
  const unionQueries = dbQueriesFor(ctx, /chat_message_attachments/i);
  // The bind value is the canonical interval, not the raw config string.
  assert.equal(unionQueries[0].params[1], '24 hours');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 7 -- empty result -> artifacts:{} graceful return ------------

test('situation.artifacts: empty window returns { kind, windowDuration, artifacts: {} }', async () => {
  // No attachments, no per-agent deliverables. Handler must NOT throw
  // and MUST return artifacts:{} so the UI renders the empty state.
  const ctx = makeCtx({
    attachments: [],
    documentsByIssue: {},
  });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  assert.equal(result.kind, 'situation-artifacts');
  assert.equal(result.windowDuration, '24h');
  assert.deepEqual(result.artifacts, {});
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 8 -- PRIM-01 single bulk query for chat-attachments half ----

test('situation.artifacts: PRIM-01 -- chat-attachments half fires ONE bulk query regardless of agent count', async () => {
  // 5 agents, all with chat attachments. The chat-attachments half must
  // be ONE single query covering ALL agents; per-agent loops with multiple
  // queries are disallowed (RESEARCH.md §A1 PRIM-01 by construction).
  const agents = Array.from({ length: 5 }, (_, i) =>
    makeAgentRow({
      id: `agent-${i}`,
      user_id: `agent-user-${i}`,
      current_focus_issue_id: `issue-source-${i}`,
    }),
  );
  const attachments = agents.flatMap((a, i) =>
    Array.from({ length: 3 }, (_, j) =>
      makeAttachmentRow({
        id: `att-${i}-${j}`,
        agent_id: a.id,
        created_at: `2026-05-26T18:${String(j).padStart(2, '0')}:00.000Z`,
      }),
    ),
  );
  const ctx = makeCtx({ agents, attachments });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  await handler(dispatchParams());
  const unionQueries = dbQueriesFor(ctx, /chat_message_attachments/i);
  assert.equal(
    unionQueries.length,
    1,
    'PRIM-01: chat_message_attachments union must fire ONE query regardless of agent count',
  );
  // Total db.query call count is at most 2: clarity_user_prefs + union.
  const totalQueries = ctx._calls.filter((c) => c.kind === 'query');
  assert.ok(
    totalQueries.length <= 2,
    `total db.query calls must be <= 2 (prefs + union); got ${totalQueries.length}`,
  );
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 9 -- newest-first ordering preserved through the map() ------

test('situation.artifacts: per-agent arrays sorted DESC by createdAt', async () => {
  const agents = [makeAgentRow()];
  const attachments = [
    makeAttachmentRow({
      id: 'a-oldest',
      created_at: '2026-05-26T15:00:00.000Z',
      agent_id: 'agent-1',
    }),
    makeAttachmentRow({
      id: 'a-newest',
      created_at: '2026-05-26T19:00:00.000Z',
      agent_id: 'agent-1',
    }),
    makeAttachmentRow({
      id: 'a-mid',
      created_at: '2026-05-26T17:00:00.000Z',
      agent_id: 'agent-1',
    }),
  ];
  const documentsByIssue = {
    'issue-source-1': [
      makeDocumentRow({
        id: 'doc-mid',
        key: 'deliverable-mid',
        createdAt: '2026-05-26T16:00:00.000Z',
        updatedAt: '2026-05-26T16:00:00.000Z',
      }),
      makeDocumentRow({
        id: 'doc-newest',
        key: 'deliverable-newest',
        createdAt: '2026-05-26T18:00:00.000Z',
        updatedAt: '2026-05-26T18:00:00.000Z',
      }),
    ],
  };
  const ctx = makeCtx({ agents, attachments, documentsByIssue });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  const arr = result.artifacts['agent-1'];
  assert.ok(Array.isArray(arr) && arr.length === 5);
  // Sorted DESC by createdAt across both kinds.
  for (let i = 1; i < arr.length; i++) {
    assert.ok(
      arr[i - 1].createdAt >= arr[i].createdAt,
      `ordering at index ${i}: ${arr[i - 1].createdAt} >= ${arr[i].createdAt}`,
    );
  }
  assert.equal(arr[0].id, 'a-newest');
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 10 -- limit clamp at 100 per agent ---------------------------

test('situation.artifacts: per-agent array length clamped at MAX_LIST_LIMIT=100', async () => {
  const agents = [makeAgentRow()];
  // 150 chat-attachments in window for one agent -- clamp must trim to 100.
  const attachments = Array.from({ length: 150 }, (_, i) =>
    makeAttachmentRow({
      id: `att-${String(i).padStart(3, '0')}`,
      agent_id: 'agent-1',
      created_at: `2026-05-26T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }),
  );
  const ctx = makeCtx({ agents, attachments });
  registerSituationArtifacts(ctx);
  const handler = ctx._handlers.get('situation.artifacts');
  const result = await handler(dispatchParams());
  const arr = result.artifacts['agent-1'];
  assert.ok(arr.length <= 100, `length ${arr.length} must be <= 100`);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});

// ---- Test 11 -- CTT-07 invariant: ctx.issues.update never called ------

test('situation.artifacts: CTT-07 invariant -- zero ctx.issues.update calls across all paths', async () => {
  // Walk every code branch above in one test so the runtime spy assertion
  // is the single source of truth for the invariant.
  const ctxA = makeCtx({ optedIn: false }); // opted-out path
  registerSituationArtifacts(ctxA);
  await ctxA._handlers.get('situation.artifacts')(dispatchParams());

  const ctxB = makeCtx(); // missing companyId
  registerSituationArtifacts(ctxB);
  await ctxB._handlers.get('situation.artifacts')(
    dispatchParams({ companyId: undefined }),
  );

  const ctxC = makeCtx(); // missing userId (opt-in-guard short-circuit)
  registerSituationArtifacts(ctxC);
  await ctxC._handlers.get('situation.artifacts')(
    dispatchParams({ userId: undefined }),
  );

  const ctxD = makeCtx({ configValue: 'gibberish' }); // unknown window
  registerSituationArtifacts(ctxD);
  await ctxD._handlers.get('situation.artifacts')(dispatchParams());

  const ctxE = makeCtx({
    agents: [makeAgentRow()],
    attachments: [makeAttachmentRow()],
    documentsByIssue: {
      'issue-source-1': [makeDocumentRow()],
    },
  }); // happy path
  registerSituationArtifacts(ctxE);
  await ctxE._handlers.get('situation.artifacts')(dispatchParams());

  const ctxF = makeCtx({ agentsListThrows: true }); // agents.list throws
  registerSituationArtifacts(ctxF);
  await ctxF._handlers.get('situation.artifacts')(dispatchParams());

  const ctxG = makeCtx({
    agents: [makeAgentRow()],
    documentsListThrowsForIssues: new Set(['issue-source-1']),
  }); // per-agent documents.list throws
  registerSituationArtifacts(ctxG);
  await ctxG._handlers.get('situation.artifacts')(dispatchParams());

  for (const c of [ctxA, ctxB, ctxC, ctxD, ctxE, ctxF, ctxG]) {
    assert.equal(
      c._issueUpdateCalls.length,
      0,
      'CTT-07 invariant: ctx.issues.update never called',
    );
  }
});
