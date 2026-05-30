// test/worker/situation-room-handler.test.mjs
//
// Plan 02-04 Task 2 RED — situation-room handlers.
//   - 'situation.snapshot' reads the most-recent row for the caller's company
//   - returns null when no row exists
//   - is wrapped with opt-in-guard (returns OPT_IN_REQUIRED for opted-out)
//   - 'situation.active-viewer-ping' upserts a row into active_viewers with
//     the caller's userId, the surface 'situation-room', and the params.tabId
//   - SQL targets the fully-qualified namespace (Finding #4)

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationRoomHandlers } from '../../src/worker/handlers/situation-room.ts';
import { registerActiveViewerPing } from '../../src/worker/handlers/active-viewer-ping.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

function makeCtx({
  snapshotRow = null,
  optedIn = true,
  // Plan 07-03 Task 2 — stub the SDK clients the org-blocked-backlog builder
  // needs (issues.list + issues.relations.get + agents.get). Defaults yield an
  // empty backlog so the pre-existing 6 tests still pass unchanged.
  blockedIssues = [],
  relations = {},
  agentsByUuid = {},
  // Plan 08-01 Task 3 — stub the roster + per-agent issues the employees rollup
  // reads. Defaults (empty roster) yield employees:[] + needsYou:{0,null} so the
  // pre-existing tests are unaffected.
  roster = [],
  issuesByAgent = {},
  issuesById = {},
  rosterThrows = false,
} = {}) {
  const dataRegistry = new Map();
  const actionRegistry = new Map();
  const dbCalls = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, fn) { dataRegistry.set(k, fn); } },
    actions: { register(k, fn) { actionRegistry.set(k, fn); } },
    issues: {
      async list(input) {
        // org-blocked-backlog calls list({companyId, status:'blocked'}); the
        // employees rollup calls list({companyId, assigneeAgentId}). Route by
        // the presence of assigneeAgentId.
        if (input && typeof input.assigneeAgentId === 'string') {
          return issuesByAgent[input.assigneeAgentId] ?? [];
        }
        return blockedIssues;
      },
      async get(id) {
        return issuesById[id] ?? null;
      },
      relations: {
        async get(id) {
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
    agents: {
      async list() {
        if (rosterThrows) throw new Error('agents.list boom');
        return roster;
      },
      async get(uuid) {
        return agentsByUuid[uuid] ?? null;
      },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-05-14T08:00:00Z' }] : [];
        }
        if (/situation_snapshots/.test(sql)) {
          return snapshotRow ? [snapshotRow] : [];
        }
        return [];
      },
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        return { rowCount: 1 };
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return {
    ctx,
    dataRegistry,
    actionRegistry,
    dbCalls,
  };
}

// ---------------------------------------------------------------------------
// situation.snapshot
// ---------------------------------------------------------------------------

test('situation.snapshot: returns most-recent row payload for the caller company', async () => {
  const snapshotRow = {
    id: 99,
    taken_at: '2026-05-14T10:00:00Z',
    computed_for_company_id: 'co-1',
    payload: { employees: [], critical_path: [], artifacts_shipped_today: [] },
    content_hash: 'abc',
  };
  const bag = makeCtx({ snapshotRow, optedIn: true });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  // The handler returns the unpacked payload plus taken_at meta.
  assert.equal(result.taken_at, '2026-05-14T10:00:00Z');
  assert.deepEqual(result.employees, []);
});

// Plan 07-03 Task 2 — the dead-job path. When no materialized snapshot row
// exists (the common case on the live host — the recompute job is scope-dead),
// the handler must STILL return a fresh org_blocked_backlog + taken_at so the
// banner renders. The previous `return null` would swallow the computed
// backlog (<compute_vs_cache_note>).
test('situation.snapshot: returns a fresh {org_blocked_backlog, taken_at} when NO row exists (dead-job path)', async () => {
  const bag = makeCtx({ snapshotRow: null, optedIn: true });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.notEqual(result, null, 'must not return null — the backlog rides even with no snapshot row');
  assert.ok(result.org_blocked_backlog, 'carries a freshly computed org_blocked_backlog');
  assert.equal(typeof result.taken_at, 'string');
  // Empty company → empty backlog shape.
  assert.equal(result.org_blocked_backlog.blocked_count, 0);
});

test('situation.snapshot: opted-out caller returns {error:OPT_IN_REQUIRED} (wrap intercepts)', async () => {
  const bag = makeCtx({ snapshotRow: { payload: {} }, optedIn: false });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
});

test('situation.snapshot: SQL targets fully-qualified namespace (Finding #4)', async () => {
  const bag = makeCtx({ snapshotRow: null, optedIn: true });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  await handler({ userId: 'eric', companyId: 'co-1' });
  const snapshotQuery = bag.dbCalls.find((c) => /situation_snapshots/.test(c.sql ?? ''));
  assert.ok(snapshotQuery);
  assert.match(snapshotQuery.sql, /plugin_clarity_pack_cdd6bda4bd\.situation_snapshots/);
});

// ---------------------------------------------------------------------------
// Plan 07-03 Task 2 — org_blocked_backlog computed in the DATA HANDLER
// (valid scope), NOT the dead recompute-situation job.
// ---------------------------------------------------------------------------

test('situation.snapshot: computes org_blocked_backlog from ctx.issues/ctx.agents and attaches it (with a snapshot row present)', async () => {
  const snapshotRow = {
    id: 99,
    taken_at: '2026-05-14T10:00:00Z',
    computed_for_company_id: 'co-1',
    payload: { employees: [], critical_path: [], artifacts_shipped_today: [] },
    content_hash: 'abc',
  };
  const blockedIssues = [
    {
      id: 'i-1',
      identifier: 'CO-1',
      title: 'Blocked thing',
      status: 'blocked',
      assigneeUserId: 'u-1',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  ];
  const relations = {
    'i-1': {
      blockedBy: [{ id: 'i-1-b', assigneeUserId: 'u-1', status: 'awaiting', etaIso: null }],
      blocks: [],
    },
  };
  const bag = makeCtx({
    snapshotRow,
    optedIn: true,
    blockedIssues,
    relations,
    agentsByUuid: { 'u-1': { name: 'Head of Compliance' } },
  });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'u-1', companyId: 'co-1' });

  // Snapshot meta preserved.
  assert.equal(result.taken_at, '2026-05-14T10:00:00Z');
  // Backlog attached.
  assert.ok(result.org_blocked_backlog, 'org_blocked_backlog attached');
  assert.equal(result.org_blocked_backlog.blocked_count, 1);
  const row = result.org_blocked_backlog.rows[0];
  // Owner resolves to the agents.get NAME, NEVER the UUID (NO_UUID_LEAK).
  assert.equal(row.ownerName, 'Head of Compliance');
  assert.notEqual(row.ownerName, 'u-1');
});

test('situation.snapshot: need_you_count is viewer-scoped (derived from params.userId)', async () => {
  const blockedIssues = [
    {
      id: 'i-1',
      identifier: 'CO-1',
      title: 'Blocked thing',
      status: 'blocked',
      assigneeUserId: 'u-viewer',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  ];
  const relations = {
    'i-1': {
      blockedBy: [{ id: 'i-1-b', assigneeUserId: 'u-viewer', status: 'awaiting', etaIso: null }],
      blocks: [],
    },
  };
  const bag = makeCtx({
    snapshotRow: null,
    optedIn: true,
    blockedIssues,
    relations,
    agentsByUuid: { 'u-viewer': { name: 'You' } },
  });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  // viewer is the blocker owner → counts toward need_you.
  const mine = await handler({ userId: 'u-viewer', companyId: 'co-1' });
  assert.equal(mine.org_blocked_backlog.need_you_count, 1);
  // a different viewer → does NOT count.
  const theirs = await handler({ userId: 'someone-else', companyId: 'co-1' });
  assert.equal(theirs.org_blocked_backlog.need_you_count, 0);
});

// ---------------------------------------------------------------------------
// Plan 08-01 Task 3 — employees + needsYou computed in the DATA HANDLER
// alongside org_blocked_backlog (ROOM-13..17). Both return paths carry them.
// ---------------------------------------------------------------------------

test('situation.snapshot: no-row path returns {org_blocked_backlog, situation_employees, needsYou, taken_at}', async () => {
  // Plan 08-02 fix: the Phase 8 rollup rides under `situation_employees` so it
  // does not clobber the agent-grid `employees` (AgentEmployee[]).
  const nowIso = new Date(Date.now() - 60_000).toISOString();
  const roster = [
    { id: 'ag-1', name: 'CTO', role: 'general', title: 'CTO', lastHeartbeatAt: nowIso },
  ];
  const bag = makeCtx({ snapshotRow: null, optedIn: true, roster, issuesByAgent: { 'ag-1': [] } });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.ok(result.org_blocked_backlog, 'org_blocked_backlog present');
  assert.ok(Array.isArray(result.situation_employees), 'situation_employees array present');
  assert.equal(result.situation_employees.length, 1);
  assert.equal(result.situation_employees[0].state, 'running');
  assert.ok(result.needsYou, 'needsYou present');
  assert.equal(result.needsYou.count, 0);
  assert.equal(typeof result.taken_at, 'string');
});

test('situation.snapshot: rollup builder throwing degrades to situation_employees:[] (handler never throws)', async () => {
  const bag = makeCtx({ snapshotRow: null, optedIn: true, rosterThrows: true });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.notEqual(result, null);
  assert.ok(result.org_blocked_backlog, 'backlog still rides');
  assert.deepEqual(result.situation_employees, []);
  assert.deepEqual(result.needsYou, { count: 0, topAction: null });
});

// ---------------------------------------------------------------------------
// situation.active-viewer-ping
// ---------------------------------------------------------------------------

test('active-viewer-ping: upserts row with userId, surface=situation-room, tabId', async () => {
  const bag = makeCtx({ optedIn: true });
  registerActiveViewerPing(bag.ctx);
  const handler = bag.actionRegistry.get('situation.active-viewer-ping');
  await handler({ userId: 'eric', tabId: 'tab-abc' });
  const insert = bag.dbCalls.find((c) => c.kind === 'execute' && /active_viewers/.test(c.sql));
  assert.ok(insert, 'one INSERT INTO active_viewers');
  assert.match(insert.sql, /plugin_clarity_pack_cdd6bda4bd\.active_viewers/);
  assert.match(insert.sql, /ON CONFLICT[\s\S]*DO UPDATE SET last_seen_at/i);
  assert.equal(insert.params[0], 'eric');
  assert.equal(insert.params[1], 'tab-abc');
});

test('active-viewer-ping: opted-out caller returns {error:OPT_IN_REQUIRED}', async () => {
  const bag = makeCtx({ optedIn: false });
  registerActiveViewerPing(bag.ctx);
  const handler = bag.actionRegistry.get('situation.active-viewer-ping');
  const result = await handler({ userId: 'eric', tabId: 'tab-abc' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
});
