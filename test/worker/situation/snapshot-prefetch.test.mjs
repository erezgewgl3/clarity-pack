// test/worker/situation/snapshot-prefetch.test.mjs
//
// Plan 16-02 Task 1 (Wave A) RED — the situation.snapshot SQL prefetch + shared
// edge graph.
//
// The cold 25.7s is an N+1 RPC fan-out (16-RESEARCH). Wave A collapses it: the
// blocked-issue list, the agent roster, every per-agent focus issue, and every
// uuid→name resolution now come from TWO ctx.db.query SELECTs (one public.issues,
// one public.agents) instead of dozens of issues.list / agents.list / agents.get
// round-trips; the blocker BFS (buildEdges) is computed ONCE for the union of
// {blocked roots} ∪ {each blocked agent's focus issue} and shared by both
// builders.
//
// These tests use stubbed ctx clients with SPIES on db.query / relations.get /
// agents.get / issues.list to assert the round-trip-count contract:
//   - exactly TWO db.query prefetch calls (issues + agents) per snapshot;
//   - agents.get is NEVER called when the prefetch covers the uuids;
//   - per-agent issues.list is NEVER called when the prefetch covers the agent;
//   - buildEdges (observed via relations.get on the ROOT startId) runs at most
//     ONCE per distinct startId across the blocked∪focus union (memoized);
//   - needsYou stays viewer-scoped — two userIds over the SAME cached rows yield
//     different need_you_count (T-16-03; no cross-viewer bleed);
//   - each stage logs `snap.stage` with { stage, ms, companyId }.
//
// Instance-neutral fixture ids (co-1 / agent uuids). NO company-prefix literal.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationRoomHandlers } from '../../../src/worker/handlers/situation-room.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const FRESH = iso(NOW - 60 * 1000); // 1 min ago → running/working heartbeat

/**
 * A spy-instrumented ctx. The prefetch SELECTs are served from snake_case rows
 * (mirroring the live public.issues / public.agents projection). The RPC clients
 * are present but their call counts are recorded so the test can assert the
 * prefetch SUPPLANTS them.
 *
 * @param {object} opts
 * @param {Array} opts.issueRows    snake_case public.issues rows (status IN open set)
 * @param {Array} opts.agentRows    snake_case public.agents rows
 * @param {object} opts.relations   { startId: { blockedBy, blocks } } for relations.get
 * @param {boolean} [opts.optedIn]
 */
function makeCtx({ issueRows = [], agentRows = [], relations = {}, optedIn = true } = {}) {
  const dataRegistry = new Map();
  const actionRegistry = new Map();
  const spies = {
    dbQuerySql: [], // every ctx.db.query sql (excluding the opt-in prefs lookup)
    relationsGet: [], // every relations.get id
    agentsGet: [], // every agents.get uuid
    issuesListInputs: [], // every issues.list input
    agentsList: 0, // agents.list call count
    stageLogs: [], // every snap.stage log payload
    waitSelectSql: [], // Plan 17-02 — every clarity_human_waits prefetch SELECT
  };

  const ctx = {
    logger: {
      info(msg, meta) {
        if (msg === 'snap.stage') spies.stageLogs.push(meta);
      },
      warn() {},
      error() {},
      debug() {},
    },
    data: { register(k, fn) { dataRegistry.set(k, fn); } },
    actions: { register(k, fn) { actionRegistry.set(k, fn); } },
    issues: {
      async list(input) {
        spies.issuesListInputs.push(input);
        if (input && typeof input.assigneeAgentId === 'string') return [];
        return [];
      },
      async get() {
        return null;
      },
      relations: {
        async get(id) {
          spies.relationsGet.push(id);
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
    agents: {
      async list() {
        spies.agentsList += 1;
        return [];
      },
      async get(uuid) {
        spies.agentsGet.push(uuid);
        return null;
      },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/clarity_user_prefs/.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-05-14T08:00:00Z' }] : [];
        }
        // Plan 16-04 (Wave C) — the SWR situation_snapshots read is infrastructure
        // (serve-last-good), NOT a prefetch SELECT. It is excluded from dbQuerySql
        // (same posture as the opt-in prefs lookup) so the "exactly TWO prefetch
        // SELECTs" round-trip-count contract still measures only the public.*
        // prefetch reads. Return [] → a cache miss → synchronous recompute path.
        if (/situation_snapshots/.test(sql)) return [];
        // Plan 17-02 (WAIT-02) — the structured human-wait prefetch is a
        // plugin-NAMESPACE read (clarity_human_waits), distinct from the public.*
        // N+1-collapse round-trip contract this suite measures. Track it on its own
        // spy and exclude it from dbQuerySql (same posture as situation_snapshots),
        // so "exactly TWO public.* prefetch SELECTs" stays the public-read contract.
        if (/clarity_human_waits/.test(sql)) {
          spies.waitSelectSql.push(sql);
          return [];
        }
        spies.dbQuerySql.push(sql);
        if (/FROM public\.issues/i.test(sql)) return issueRows;
        if (/FROM public\.agents/i.test(sql)) return agentRows;
        return [];
      },
      async execute() {
        return { rowCount: 1 };
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, dataRegistry, actionRegistry, spies };
}

function issueRow({ id, identifier, title = `Title ${identifier}`, status, assignee_agent_id = null, assignee_user_id = null, updated_at = iso(NOW - 60_000) }) {
  return { id, identifier, title, status, assignee_agent_id, assignee_user_id, updated_at };
}

function agentRow({ id, name, role = 'general', title = null, last_heartbeat_at = FRESH, status = null, paused_at = null }) {
  return { id, name, role, title, last_heartbeat_at, status, paused_at };
}

async function runSnapshot(bag, params) {
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  return handler(params);
}

// ---------------------------------------------------------------------------
// Test 1 — exactly TWO prefetch db.query calls (issues + agents)
// ---------------------------------------------------------------------------
test('prefetch — issues exactly TWO db.query calls (one public.issues, one public.agents)', async () => {
  const bag = makeCtx({
    issueRows: [issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' })],
    agentRows: [agentRow({ id: 'ag-1', name: 'CTO' })],
    relations: { 'i-1': { blockedBy: [], blocks: [] } },
  });
  await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });

  assert.equal(bag.spies.dbQuerySql.length, 2, 'exactly two prefetch SELECTs');
  const issuesSelects = bag.spies.dbQuerySql.filter((s) => /FROM public\.issues/i.test(s));
  const agentsSelects = bag.spies.dbQuerySql.filter((s) => /FROM public\.agents/i.test(s));
  assert.equal(issuesSelects.length, 1, 'one public.issues SELECT');
  assert.equal(agentsSelects.length, 1, 'one public.agents SELECT');
  // Company-scoped + parameterized: $1 placeholder, no prefix literal.
  assert.match(issuesSelects[0], /company_id = \$1/);
  assert.match(agentsSelects[0], /company_id = \$1/);
  // Plan 17-02 (WAIT-02 / T-17-04) — exactly ONE structured-wait SELECT per
  // company per snapshot, company-scoped (WHERE company_id = $1, no cross-company
  // merge). The waitMap built from it feeds applyStructuredWait on all three
  // root-meta write sites (SC5).
  assert.equal(bag.spies.waitSelectSql.length, 1, 'exactly one clarity_human_waits SELECT');
  assert.match(bag.spies.waitSelectSql[0], /company_id = \$1/);
});

// ---------------------------------------------------------------------------
// Test 2 — the prefetch SUPPLANTS the RPC list/get fan-out
// ---------------------------------------------------------------------------
test('prefetch — agents.get + per-agent issues.list are NOT called when the prefetch covers them', async () => {
  const bag = makeCtx({
    // One blocked issue owned by an agent + one agent on the roster.
    issueRows: [issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_agent_id: 'ag-1', assignee_user_id: 'u-1' })],
    agentRows: [agentRow({ id: 'ag-1', name: 'CTO' })],
    relations: {
      'i-1': { blockedBy: [{ id: 'i-1-b', assigneeUserId: 'u-1', status: 'awaiting' }], blocks: [] },
    },
  });
  await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });

  assert.equal(bag.spies.agentsGet.length, 0, 'agents.get never called — nameByUuid serves names from the agents SELECT');
  assert.equal(bag.spies.agentsList, 0, 'agents.list never called — the roster comes from the agents SELECT');
  const perAgentLists = bag.spies.issuesListInputs.filter((i) => i && typeof i.assigneeAgentId === 'string');
  assert.equal(perAgentLists.length, 0, 'no per-agent issues.list — focus issues come from the prefetched set');
  const blockedLists = bag.spies.issuesListInputs.filter((i) => i && i.status === 'blocked' && i.assigneeAgentId === undefined);
  assert.equal(blockedLists.length, 0, 'no blocked issues.list — the blocked list comes from the prefetched set');
});

// ---------------------------------------------------------------------------
// Test 3 — name resolution served from the single agents SELECT (NO_UUID_LEAK)
// ---------------------------------------------------------------------------
test('prefetch — owner name resolves from the agents SELECT (never a raw UUID, never agents.get)', async () => {
  const bag = makeCtx({
    issueRows: [issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' })],
    // The owner u-1 is also an agent row → resolvable from nameByUuid.
    agentRows: [agentRow({ id: 'u-1', name: 'Head of Compliance' })],
    relations: { 'i-1': { blockedBy: [{ id: 'i-1-b', assigneeUserId: 'u-1', status: 'awaiting' }], blocks: [] } },
  });
  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });
  const row = result.org_blocked_backlog.rows[0];
  assert.equal(row.ownerName, 'Head of Compliance', 'name from the agents SELECT');
  assert.notEqual(row.ownerName, 'u-1', 'NEVER the raw UUID');
  assert.equal(bag.spies.agentsGet.length, 0, 'no agents.get round-trip');
});

// ---------------------------------------------------------------------------
// Test 4 — buildEdges memoized: a startId in BOTH {blocked} and {focus} walks ONCE
// ---------------------------------------------------------------------------
test('prefetch — a startId in both the blocked roots and a blocked agent focus triggers exactly ONE buildEdges (relations.get) on that root', async () => {
  // i-1 is BOTH a company-wide blocked issue AND the focus of its blocked agent
  // ag-1. The union must walk i-1's edges exactly once (memoized by startId).
  const bag = makeCtx({
    issueRows: [
      issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_agent_id: 'ag-1' }),
    ],
    agentRows: [agentRow({ id: 'ag-1', name: 'CTO', last_heartbeat_at: FRESH })],
    relations: { 'i-1': { blockedBy: [], blocks: [] } },
  });
  await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });

  // relations.get on the ROOT startId i-1 fires exactly once across the whole
  // snapshot (the org-backlog walk and the rollup focus walk SHARE the memo).
  const rootWalks = bag.spies.relationsGet.filter((id) => id === 'i-1');
  assert.equal(rootWalks.length, 1, 'i-1 edges walked exactly once (shared memo), not twice');
});

// ---------------------------------------------------------------------------
// Test 5 — viewer-scoping preserved (T-16-03): two userIds over identical rows
// ---------------------------------------------------------------------------
test('prefetch — needsYou stays viewer-scoped: two userId params over identical cached rows yield different need_you_count', async () => {
  const issueRows = [issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-viewer' })];
  const agentRows = [agentRow({ id: 'u-viewer', name: 'You' })];
  const relations = { 'i-1': { blockedBy: [{ id: 'i-1-b', assigneeUserId: 'u-viewer', status: 'awaiting' }], blocks: [] } };

  const bagMine = makeCtx({ issueRows, agentRows, relations });
  const mine = await runSnapshot(bagMine, { userId: 'u-viewer', companyId: 'co-1' });
  assert.equal(mine.org_blocked_backlog.need_you_count, 1, 'the owner-viewer counts');

  const bagTheirs = makeCtx({ issueRows, agentRows, relations });
  const theirs = await runSnapshot(bagTheirs, { userId: 'someone-else', companyId: 'co-1' });
  assert.equal(theirs.org_blocked_backlog.need_you_count, 0, 'a different viewer does NOT count (no cross-viewer bleed)');
});

// ---------------------------------------------------------------------------
// Test 6 — every stage logs snap.stage {stage, ms, companyId}
// ---------------------------------------------------------------------------
test('prefetch — each stage logs snap.stage with {stage, ms, companyId}', async () => {
  const bag = makeCtx({
    issueRows: [issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' })],
    agentRows: [agentRow({ id: 'ag-1', name: 'CTO' })],
  });
  await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });

  const stages = new Set(bag.spies.stageLogs.map((s) => s.stage));
  assert.ok(stages.has('prefetch'), 'prefetch stage logged');
  assert.ok(stages.has('org-backlog'), 'org-backlog stage logged');
  assert.ok(stages.has('employees-rollup'), 'employees-rollup stage logged');
  for (const s of bag.spies.stageLogs) {
    assert.equal(typeof s.ms, 'number', 'ms is a number');
    assert.ok(Number.isFinite(s.ms) && s.ms >= 0, 'ms is a finite non-negative wall-clock');
    assert.equal(s.companyId, 'co-1', 'companyId carried');
  }
});

// ---------------------------------------------------------------------------
// Test 7 — degrade: a thrown buildEdges floors the row to UNCLASSIFIED, prefetch survives
// ---------------------------------------------------------------------------
test('prefetch — a thrown buildEdges for one startId floors that row to UNCLASSIFIED (the prefetch is not aborted)', async () => {
  const bag = makeCtx({
    issueRows: [
      issueRow({ id: 'i-1', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' }),
      issueRow({ id: 'i-2', identifier: 'CO-2', status: 'blocked', assignee_user_id: 'u-1' }),
    ],
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
  });
  // Make i-1's root relations.get throw → its edge build is floored to a
  // sentinel; i-2 still resolves normally.
  bag.ctx.issues.relations.get = async (id) => {
    bag.spies.relationsGet.push(id);
    if (id === 'i-1') throw new Error('relations.get boom for i-1');
    return { blockedBy: [], blocks: [] };
  };
  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });
  // Both blocked issues are surfaced (i-1 as an UNCLASSIFIED degrade row, not dropped).
  assert.equal(result.org_blocked_backlog.blocked_count, 2, 'both blocked issues counted');
  const degraded = result.org_blocked_backlog.rows.find((r) => r.issueId === 'i-1');
  assert.ok(degraded, 'the failed-walk issue is surfaced, not dropped');
  assert.equal(degraded.terminalKind, 'UNCLASSIFIED', 'floored to the honest UNCLASSIFIED row');
});

// ---------------------------------------------------------------------------
// Test 8 — return shape unchanged
// ---------------------------------------------------------------------------
test('prefetch — return shape stays {org_blocked_backlog, situation_employees, needsYou, pulse, taken_at}', async () => {
  const bag = makeCtx({
    issueRows: [],
    agentRows: [agentRow({ id: 'ag-1', name: 'CTO', last_heartbeat_at: FRESH })],
  });
  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });
  assert.ok(result.org_blocked_backlog, 'org_blocked_backlog present');
  assert.ok(Array.isArray(result.situation_employees), 'situation_employees present');
  assert.ok(result.needsYou, 'needsYou present');
  assert.ok(result.pulse, 'pulse present');
  assert.equal(typeof result.taken_at, 'string', 'taken_at present');
  // The roster rode through the prefetch → one employee row.
  assert.equal(result.situation_employees.length, 1, 'roster served from the agents SELECT');
});
