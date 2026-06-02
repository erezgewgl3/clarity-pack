// test/worker/issue-reader-integration.test.mjs
//
// Plan 02-03b Task 2 — integration tests that fake the ACTUAL
// @paperclipai/plugin-sdk@2026.512.0 PluginContext shape (per
// .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md). These
// supplement test/worker/issue-reader.test.mjs by pinning one shape contract
// per known SDK drift from the Plan 02-03 draft. RED initially (it.todo);
// GREEN after Task 2 rewrites the handlers.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerIssueReader } from '../../src/worker/handlers/issue-reader.ts';
import { registerFlattenBlockerChain } from '../../src/worker/handlers/flatten-blocker-chain.ts';
import { registerEditorPauseStatus } from '../../src/worker/handlers/editor-pause-status.ts';
import { MAX_CONSECUTIVE_FAILURES } from '../../src/worker/agents/circuit-breaker.ts';
import { EDITOR_AGENT_KEY } from '../../src/worker/agents/editor.ts';

// ---------------------------------------------------------------------------
// Shared ctx scaffolding — only what each test needs. Each maker returns a
// fresh ctx so tests don't leak state across each other.
// ---------------------------------------------------------------------------

function makeIssueReaderCtx(overrides = {}) {
  const calls = { db: [], fetch: [] };
  const registered = new Map();
  const issueGetCalls = [];
  const documentsListCalls = [];
  const listCommentsCalls = [];

  const fixtureIssue = {
    id: 'BEAAA-555',
    key: 'BEAAA-555',
    title: 'test issue',
    description:
      'Underwriting timeline for Q3 needs revision because BEAAA-141 added a new step. See BEAAA-203 and BEAAA-417.',
    parentId: 'BEAAA-100',
    projectId: 'p-1',
    goalId: 'g-q3',
    status: 'in_progress',
    priority: 'normal',
  };

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, h) { registered.set(k, h); } },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async execute(sql, params) { calls.db.push({ kind: 'execute', sql, params }); return { rowCount: 0 }; },
      async query(sql, params) {
        calls.db.push({ kind: 'query', sql, params });
        // Plan 02-03b: SDK returns T[] directly, NOT {rows: T[]}.
        if (/ac_checklist_items/.test(sql)) {
          return [{ id: 1, issue_id: fixtureIssue.id, label: 'item', checked: false, display_order: 0 }];
        }
        // Plan 02-04 Task 1 — wrapDataHandler queries clarity_user_prefs first.
        // Return an opted-in row so the wrap forwards to the inner handler.
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        return [];
      },
    },
    http: {
      async fetch(url) {
        calls.fetch.push(url);
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
    issues: {
      async get(issueId, companyId) {
        issueGetCalls.push({ issueId, companyId });
        if (issueId === fixtureIssue.id) return fixtureIssue;
        if (issueId === 'BEAAA-100') return { id: 'BEAAA-100', identifier: 'BEAAA-100', key: 'BEAAA-100', title: 'parent issue', description: '' };
        // 07-01 — the in-body refs resolve via per-ref get (camelCase Issue).
        if (/^BEAAA-(141|203|417)$/.test(issueId)) {
          return {
            id: `uuid-${issueId}`,
            identifier: issueId,
            title: `Title ${issueId}`,
            status: 'in_progress',
            assigneeUserId: 'agent-x',
            description: `Body of ${issueId}`,
          };
        }
        return null;
      },
      // 07-01 — list-and-match fallback (unused on the happy path).
      async list(_input) { return []; },
      async listComments(issueId, companyId) {
        listCommentsCalls.push({ issueId, companyId });
        return [
          { id: 'c-1', authorUserId: 'a', createdAt: '2026-05-13T19:30:00Z', body: 'first' },
          { id: 'c-2', authorUserId: 'b', createdAt: '2026-05-13T20:30:00Z', body: 'second' },
        ];
      },
      relations: { async get() { return { blockedBy: [], blocks: [] }; } },
      documents: {
        async list(issueId, companyId) {
          documentsListCalls.push({ issueId, companyId });
          return [
            { id: 'd-1', key: 'plan', title: 'Plan.docx', updatedAt: '2026-05-13T20:10:00Z' },
          ];
        },
        async get() { return null; },
      },
    },
    projects: {
      async get(id) { return id === 'p-1' ? { id: 'p-1', title: 'BEAAA Insurance' } : null; },
    },
    goals: {
      async get(id) { return id === 'g-q3' ? { id: 'g-q3', title: 'Q3 Launch' } : null; },
    },
    ...overrides,
  };

  return { ctx, calls, registered, issueGetCalls, documentsListCalls, listCommentsCalls };
}

async function invokeReader(ctxBag, params) {
  registerIssueReader(ctxBag.ctx);
  const handler = ctxBag.registered.get('issue.reader');
  // Plan 02-04 Task 1: opt-in-guard wrap requires userId; tests now thread it.
  return handler({ userId: 'test-user', ...params });
}

// ---------------------------------------------------------------------------
// issue.reader — 10 contracts
// ---------------------------------------------------------------------------

test('issue.reader — handler reads issue.description (NOT issue.body)', async () => {
  const ctxBag = makeIssueReaderCtx();
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  assert.match(result.issueBody, /Underwriting timeline/);
});

test('issue.reader — handler passes companyId to ctx.issues.get', async () => {
  const ctxBag = makeIssueReaderCtx();
  await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  const firstCall = ctxBag.issueGetCalls[0];
  assert.equal(firstCall.issueId, 'BEAAA-555');
  assert.equal(firstCall.companyId, 'co-1');
});

test('issue.reader — handler derives ancestry by walking parentId chain (NOT ctx.issues.ancestry)', async () => {
  const ctxBag = makeIssueReaderCtx();
  // Explicitly assert ctx has NO ancestry method, just like the real SDK.
  assert.equal(typeof ctxBag.ctx.issues.ancestry, 'undefined');
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  assert.ok(result.ancestry.parent);
  assert.equal(result.ancestry.parent.id, 'BEAAA-100');
  assert.ok(result.ancestry.project);
  assert.equal(result.ancestry.project.title, 'BEAAA Insurance');
  assert.ok(result.ancestry.milestone);
  assert.equal(result.ancestry.milestone.title, 'Q3 Launch');
});

test('issue.reader — handler calls ctx.issues.documents.list (NOT ctx.issue.documents.read)', async () => {
  const ctxBag = makeIssueReaderCtx();
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  assert.equal(ctxBag.documentsListCalls.length, 1);
  assert.equal(ctxBag.documentsListCalls[0].issueId, 'BEAAA-555');
  assert.equal(ctxBag.documentsListCalls[0].companyId, 'co-1');
  assert.equal(result.deliverable.filename, 'Plan.docx');
});

test('issue.reader — handler derives activity from ctx.issues.listComments (NOT ctx.activity.log.read)', async () => {
  const ctxBag = makeIssueReaderCtx();
  // ctx.activity.log.read does not exist on the SDK at 2026.512.0.
  assert.equal(typeof ctxBag.ctx.activity, 'undefined');
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  assert.equal(ctxBag.listCommentsCalls.length, 1);
  assert.equal(result.activity.length, 2);
  for (const e of result.activity) {
    assert.equal(e.kind, 'comment');
    assert.ok(e.at);
  }
});

test('issue.reader — handler reads companyId from params (NOT ctx.host)', async () => {
  const ctxBag = makeIssueReaderCtx();
  // ctx.host does not exist on the SDK at 2026.512.0.
  assert.equal(typeof ctxBag.ctx.host, 'undefined');
  await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-XYZ' });
  // Every downstream SDK call carries the companyId we threaded in.
  for (const c of ctxBag.issueGetCalls) assert.equal(c.companyId, 'co-XYZ');
  for (const c of ctxBag.documentsListCalls) assert.equal(c.companyId, 'co-XYZ');
  for (const c of ctxBag.listCommentsCalls) assert.equal(c.companyId, 'co-XYZ');
});

test('issue.reader — handler unwraps ctx.db.query result as T[] (NOT {rows: T[]})', async () => {
  const ctxBag = makeIssueReaderCtx();
  // Override ac_checklist_items query to return a sentinel-named row.
  ctxBag.ctx.db.query = async (sql) => {
    if (/clarity_user_prefs/.test(sql)) {
      // Plan 02-04 Task 1: wrap queries prefs first.
      return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
    }
    if (/ac_checklist_items/.test(sql)) {
      return [{ id: 42, issue_id: 'BEAAA-555', label: 'sentinel', checked: true, display_order: 0 }];
    }
    return [];
  };
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  assert.equal(result.acItems.length, 1);
  assert.equal(result.acItems[0].label, 'sentinel');
});

test('issue.reader — handler throws loudly when companyId missing', async () => {
  const ctxBag = makeIssueReaderCtx();
  registerIssueReader(ctxBag.ctx);
  const handler = ctxBag.registered.get('issue.reader');
  // Plan 02-04 Task 1: opt-in-guard wrap requires userId; test passes it so the
  // inner handler runs and we can verify it throws on the missing companyId.
  await assert.rejects(
    () => handler({ userId: 'test-user', issueId: 'BEAAA-555' }),
    /companyId required/,
  );
});

test('issue.reader — refCards resolved via per-ref ctx.issues.get (PRIM-01: one fetcher invocation, zero ?ids= http.fetch)', async () => {
  const ctxBag = makeIssueReaderCtx();
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  // 07-01 — the legacy SSRF-blocked `?ids=` http.fetch path must NOT be used.
  const refFetches = ctxBag.calls.fetch.filter((u) => /\/issues\?ids=/.test(u));
  assert.equal(refFetches.length, 0, 'no legacy ?ids= http.fetch for ref resolution');
  // All 3 in-body refs resolved to real titles (byId.get(ref) hit).
  assert.equal(result.refCards.length, 3);
  assert.equal(result.refCards[0].id, 'BEAAA-141');
  assert.notEqual(result.refCards[0].status, 'unknown');
});

test('issue.reader — each data slice wraps in try/catch and degrades gracefully', async () => {
  const ctxBag = makeIssueReaderCtx();
  ctxBag.ctx.issues.documents.list = async () => {
    throw new Error('documents.list broken');
  };
  const result = await invokeReader(ctxBag, { issueId: 'BEAAA-555', companyId: 'co-1' });
  // Failure in one slice does NOT blank the whole tab.
  assert.equal(result.deliverable, null);
  assert.match(result.issueBody, /Underwriting timeline/);
  assert.ok(result.ancestry);
});

// ---------------------------------------------------------------------------
// flatten-blocker-chain — 4 contracts
// ---------------------------------------------------------------------------

function makeBlockerCtx({ relationsResponses = {}, throwOn = null } = {}) {
  const calls = [];
  const registered = new Map();
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, h) { registered.set(k, h); } },
    // Plan 02-04 Task 1: opt-in-guard wrap needs ctx.db to look up prefs.
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    issues: {
      relations: {
        async get(id, companyId) {
          calls.push({ id, companyId });
          if (throwOn && throwOn(id)) throw new Error('relations.get blew up');
          return relationsResponses[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
  };
  return { ctx, calls, registered };
}

test('flatten-blocker-chain — handler calls ctx.issues.relations.get (NOT http.fetch /blockers)', async () => {
  const ctxBag = makeBlockerCtx({
    relationsResponses: {
      'BEAAA-1': {
        blockedBy: [{ id: 'BEAAA-2', assigneeUserId: 'eric', status: 'awaiting', etaIso: null }],
        blocks: [],
      },
      'BEAAA-2': { blockedBy: [], blocks: [] },
    },
  });
  // Assert no http on ctx at all (the handler must not route via fetch).
  assert.equal(typeof ctxBag.ctx.http, 'undefined');
  registerFlattenBlockerChain(ctxBag.ctx);
  const handler = ctxBag.registered.get('flatten-blocker-chain');
  const result = await handler({ userId: 'eric', startId: 'BEAAA-1', companyId: 'co-1', viewerUserId: 'eric' });
  assert.ok(result);
  assert.ok(result.pathIds.includes('BEAAA-1'));
  // The walk visited at least the start + its blocker.
  const visitedIds = ctxBag.calls.map((c) => c.id);
  assert.ok(visitedIds.includes('BEAAA-1'));
  assert.ok(visitedIds.includes('BEAAA-2'));
});

test('flatten-blocker-chain — handler walks transitively up to MAX_CHAIN_DEPTH=6', async () => {
  // 4-level chain
  const ctxBag = makeBlockerCtx({
    relationsResponses: {
      'A': { blockedBy: [{ id: 'B', status: 'awaiting' }], blocks: [] },
      'B': { blockedBy: [{ id: 'C', status: 'awaiting' }], blocks: [] },
      'C': { blockedBy: [{ id: 'D', status: 'awaiting' }], blocks: [] },
      'D': { blockedBy: [], blocks: [] },
    },
  });
  registerFlattenBlockerChain(ctxBag.ctx);
  const handler = ctxBag.registered.get('flatten-blocker-chain');
  await handler({ userId: 'eric', startId: 'A', companyId: 'co-1', viewerUserId: 'eric' });
  const ids = ctxBag.calls.map((c) => c.id);
  assert.deepEqual(ids.sort(), ['A', 'B', 'C', 'D']);
});

test('flatten-blocker-chain — handler returns graceful terminal when chain empty', async () => {
  const ctxBag = makeBlockerCtx(); // every id returns empty blockedBy
  registerFlattenBlockerChain(ctxBag.ctx);
  const handler = ctxBag.registered.get('flatten-blocker-chain');
  const result = await handler({ userId: 'eric', startId: 'X', companyId: 'co-1', viewerUserId: 'eric' });
  assert.equal(result.terminal.kind, 'EXTERNAL');
  assert.match(result.terminal.label, /No active blockers/);
});

test('flatten-blocker-chain — handler returns 200 (NOT 502) even when SDK call throws', async () => {
  const ctxBag = makeBlockerCtx({ throwOn: (id) => id === 'X' });
  registerFlattenBlockerChain(ctxBag.ctx);
  const handler = ctxBag.registered.get('flatten-blocker-chain');
  // Must NOT throw — the host bridge translates a thrown handler to 502.
  const result = await handler({ userId: 'eric', startId: 'X', companyId: 'co-1', viewerUserId: 'eric' });
  assert.ok(result);
  // Plan 11-02 (D-10/TAX-03) — a ROOT relations.get throw is now an HONEST
  // degrade: UNCLASSIFIED (open affordance, never a false EXTERNAL chase), not
  // the old EXTERNAL lie. The genuinely-empty graph (test above) still → EXTERNAL.
  assert.equal(result.terminal.kind, 'UNCLASSIFIED');
});

// ---------------------------------------------------------------------------
// editor.pause-status — 1 contract (db.query unwrap)
// ---------------------------------------------------------------------------

test('editor.pause-status — handler unwraps ctx.db.query as T[] (NOT {rows: T[]})', async () => {
  const registered = new Map();
  const ctx = {
    data: { register(k, h) { registered.set(k, h); } },
    db: {
      // Plan 02-04 Task 1: editor.pause-status is wrapped, so query is called
      // for both prefs lookup AND the actual failures-row read. Route by SQL.
      async query(sql, _params) {
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        return [
          {
            failed_at: '2026-05-13T22:00:00Z',
            reason: 'token_cap',
            consecutive: MAX_CONSECUTIVE_FAILURES,
          },
        ];
      },
      async execute() { return { rowCount: 0 }; },
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
    },
  };
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const status = await handler({ userId: 'eric' });
  assert.equal(status.paused, true);
  assert.equal(status.lastFailureAt, '2026-05-13T22:00:00Z');
  assert.equal(status.reason, 'token_cap');
  // Confirm EDITOR_AGENT_KEY makes it into the query params (sanity).
  void EDITOR_AGENT_KEY;
});
