// test/worker/situation-room-handler.test.mjs
//
// Plan 02-04 Task 2 RED — situation-room handlers.
//   - 'situation.snapshot' computes the rollup FRESH on every call (Plan 09-01
//     WARNING 5 removed the materialized situation_snapshots read-path — the
//     recompute cron writer was deleted, so a row is never written and the
//     handler no longer reads one). taken_at is a fresh ISO; the legacy
//     `employees` (AgentEmployee[]) grid feed is gone; situation_employees rides.
//   - is wrapped with opt-in-guard (returns OPT_IN_REQUIRED for opted-out)
//   - 'situation.active-viewer-ping' upserts a row into active_viewers with
//     the caller's userId, the surface 'situation-room', and the params.tabId

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationRoomHandlers } from '../../src/worker/handlers/situation-room.ts';
import { registerActiveViewerPing } from '../../src/worker/handlers/active-viewer-ping.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

// Plan 16-02 (Wave A) — map the test's camelCase Issue fixtures to the live
// snake_case public.issues projection the handler's prefetch SELECT returns. The
// prefetch projects the OPEN status set (in_progress|in_review|blocked), a
// superset of blocked, so one read serves BOTH the org-backlog blocked list and
// the rollup per-agent focus. Rows from issuesByAgent carry their agentId as
// assignee_agent_id (the grouping key); blockedIssues carry whatever they declare.
function snakeIssueRows({ blockedIssues = [], issuesByAgent = {} }) {
  const out = [];
  const seen = new Set();
  const push = (i, agentId) => {
    const id = i.id ?? i.identifier ?? '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      identifier: i.identifier ?? id,
      title: i.title ?? '',
      status: i.status ?? 'blocked',
      assignee_agent_id: i.assigneeAgentId ?? agentId ?? null,
      assignee_user_id: i.assigneeUserId ?? null,
      updated_at: i.updatedAt ?? null,
    });
  };
  for (const i of blockedIssues) push(i, null);
  for (const [agentId, list] of Object.entries(issuesByAgent)) {
    for (const i of list) push(i, agentId);
  }
  return out;
}

// Plan 16-02 (Wave A) — map the camelCase roster fixture to the snake_case
// public.agents projection the prefetch SELECT returns. Name resolution
// (nameByUuid) now comes from THIS SELECT, so any agentsByUuid name fixture
// (formerly served via agents.get) is folded in as an agent row — those uuids
// ARE company agents the prefetch resolves names for.
function snakeAgentRows(roster = [], agentsByUuid = {}) {
  const out = [];
  const seen = new Set();
  for (const a of roster) {
    const id = a.id ?? '';
    if (!id) continue;
    seen.add(id);
    out.push({
      id,
      name: a.name ?? '',
      role: a.role ?? null,
      title: a.title ?? null,
      last_heartbeat_at: a.lastHeartbeatAt ?? null,
      status: a.status ?? null,
      paused_at: a.pausedAt ?? null,
    });
  }
  for (const [uuid, a] of Object.entries(agentsByUuid)) {
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    out.push({
      id: uuid,
      name: a?.name ?? '',
      role: null,
      title: null,
      last_heartbeat_at: null,
      status: null,
      paused_at: null,
    });
  }
  return out;
}

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
        // Plan 16-02 (Wave A) — the situation.snapshot handler now PREFETCHES the
        // blocked-issue list + the open per-agent issues + the roster via two
        // public.issues / public.agents SELECTs (the prefetch supplants the RPC
        // list/get fan-out). Serve the SAME fixtures through db.query, mapped from
        // the test's camelCase shape to the live snake_case projection. When
        // rosterThrows is set the test exercises the RPC-fallback path, so the
        // agents SELECT throws too (the prefetch degrades → builders fall back).
        if (/FROM public\.issues/i.test(sql)) {
          return snakeIssueRows({ blockedIssues, issuesByAgent });
        }
        if (/FROM public\.agents/i.test(sql)) {
          if (rosterThrows) throw new Error('agents prefetch boom');
          return snakeAgentRows(roster, agentsByUuid);
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

test('situation.snapshot (Plan 09-01): computes FRESH (no materialized-row read); taken_at is a fresh ISO, no legacy employees key', async () => {
  // Plan 09-01 (WARNING 5) — the materialized situation_snapshots read-path was
  // removed (the recompute cron writer is deleted). The handler now ALWAYS
  // returns the freshly computed rollup; a pre-seeded snapshotRow is ignored.
  const snapshotRow = {
    id: 99,
    taken_at: '2026-05-14T10:00:00Z',
    computed_for_company_id: 'co-1',
    payload: { employees: [{ userId: 'STALE' }], critical_path: [], artifacts_shipped_today: [] },
    content_hash: 'abc',
  };
  const bag = makeCtx({ snapshotRow, optedIn: true });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const before = Date.now();
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  // taken_at is a FRESH timestamp (not the stale 2026-05-14 row value).
  assert.notEqual(result.taken_at, '2026-05-14T10:00:00Z', 'must NOT echo the stale materialized row');
  assert.ok(Date.parse(result.taken_at) >= before, 'taken_at is computed fresh on this request');
  // The legacy `employees` (AgentEmployee[]) grid feed is gone; the live rollup
  // rides under situation_employees only.
  assert.equal(result.employees, undefined, 'no legacy employees key (the materialized spread is removed)');
  assert.ok(Array.isArray(result.situation_employees), 'situation_employees rides instead');
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

test('situation.snapshot (Plan 16-04, SWR): the most-recent situation_snapshots row is read and a fresh slice is written back on a cache miss', async () => {
  // Plan 16-04 (Wave C) SUPERSEDES the Plan 09-01 WARNING 5 invariant: the
  // stale-while-revalidate design REINTRODUCES the situation_snapshots read — but
  // now it reads the VIEWER-INVARIANT slice (serve-last-good) and re-derives the
  // viewer-scoped needsYou per call. On a cache miss (no row) the handler
  // recomputes synchronously and WRITES the slice back for the next caller.
  const bag = makeCtx({ snapshotRow: null, optedIn: true });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  await handler({ userId: 'eric', companyId: 'co-1' });
  // The SWR read fires: the most-recent-row SELECT (ORDER BY taken_at DESC LIMIT 1,
  // filtered on computed_for_company_id = $1).
  const swrRead = bag.dbCalls.find(
    (c) => c.kind === 'query' && /situation_snapshots/.test(c.sql ?? ''),
  );
  assert.ok(swrRead, 'a situation_snapshots SELECT should be issued (SWR read)');
  assert.match(swrRead.sql, /computed_for_company_id\s*=\s*\$1/);
  assert.match(swrRead.sql, /ORDER BY\s+taken_at\s+DESC/i);
  assert.match(swrRead.sql, /LIMIT\s+1/i);
  assert.deepEqual(swrRead.params, ['co-1']);
  // The write-back fires on the miss: an INSERT ... ON CONFLICT DO NOTHING via
  // ctx.db.execute, parameterized on the company id (no prefix literal).
  const swrWrite = bag.dbCalls.find(
    (c) => c.kind === 'execute' && /situation_snapshots/.test(c.sql ?? ''),
  );
  assert.ok(swrWrite, 'a situation_snapshots INSERT should fire (SWR write-back on miss)');
  assert.match(swrWrite.sql, /ON CONFLICT \(computed_for_company_id, content_hash\) DO NOTHING/);
  assert.equal(swrWrite.params[0], 'co-1', 'the write is company-scoped (no prefix literal)');
});

// ---------------------------------------------------------------------------
// Plan 07-03 Task 2 — org_blocked_backlog computed in the DATA HANDLER
// (valid scope), NOT the dead recompute-situation job.
// ---------------------------------------------------------------------------

test('situation.snapshot (Plan 09-01): computes org_blocked_backlog FRESH and ignores any pre-seeded materialized row', async () => {
  // A stale snapshotRow is present but MUST be ignored post-Plan-09-01 (the
  // read-path is removed). taken_at is computed fresh; the backlog rides.
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

  // taken_at is FRESH — the stale materialized row's timestamp is ignored.
  assert.notEqual(result.taken_at, '2026-05-14T10:00:00Z', 'stale materialized taken_at must NOT be echoed');
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
