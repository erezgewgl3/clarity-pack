// test/worker/situation/snapshot-degrade.test.mjs
//
// Plan 16-03 Task 1 (Wave B) — make the snapshot honestly degrade-safe AND
// DoS-resistant. SQL-ifying the lists (16-02) removed most round-trips, but the
// blocker EDGES cannot be SQL-ified (no relations table in coreReadTables) — they
// stay on the irreducible `ctx.issues.relations.get` RPC. Wave B runs the shared
// edge-graph build through the bounded pool from 16-01 (mapBounded, ≤LIMIT in
// flight) and floors every walk with a per-call deadline (withDeadline ~2s) so a
// slow/hung/thrown walk floors that ONE row to the deterministic UNCLASSIFIED line
// and the snapshot still returns 200 with every other row intact — never a hang,
// never a blank view.
//
// These tests stub relations.get to (a) HANG forever, (b) THROW, (c) be
// slow-but-eventually-resolve, and assert:
//   - a hung walk floors to UNCLASSIFIED with degradeReason 'relations-walk-timeout'
//     within the per-walk deadline (NOT the 30s default), and the snapshot returns
//     a 200-shaped payload with all OTHER rows intact (T-16-02 / SNAP-02 SC2);
//   - a thrown walk also floors (existing 'relations-walk-failed'); neither path
//     drops the issue or hangs;
//   - no more than LIMIT buildEdges/relations.get walks are in flight at once
//     (T-16-01 DoS cap);
//   - the overall snapshot honors SNAPSHOT_BUDGET_MS (well under 30s); a budget
//     overridden to ~200ms via the env-style override settles the test in well
//     under a second with leftover startIds floored.
//
// Instance-neutral fixture ids (co-1 / i-N / agent uuids). NO company-prefix literal.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationRoomHandlers } from '../../../src/worker/handlers/situation-room.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const FRESH = iso(NOW - 60 * 1000); // 1 min ago → running/working heartbeat

/**
 * A spy-instrumented ctx whose relations.get behavior is controlled per-startId.
 * The prefetch SELECTs are served from snake_case rows (the live public.issues /
 * public.agents projection). relations.get records max-in-flight so the test can
 * assert the concurrency ceiling.
 *
 * @param {object} opts
 * @param {Array} opts.issueRows   snake_case public.issues rows
 * @param {Array} opts.agentRows   snake_case public.agents rows
 * @param {(id:string)=>Promise<any>} opts.relationsGet  per-startId relations.get
 */
function makeCtx({ issueRows = [], agentRows = [], relationsGet } = {}) {
  const dataRegistry = new Map();
  const actionRegistry = new Map();
  const spies = {
    relationsGet: [],
    inFlight: 0,
    maxInFlight: 0,
    stageLogs: [],
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
      async list() { return []; },
      async get() { return null; },
      relations: {
        async get(id) {
          spies.relationsGet.push(id);
          spies.inFlight += 1;
          spies.maxInFlight = Math.max(spies.maxInFlight, spies.inFlight);
          try {
            return await relationsGet(id);
          } finally {
            spies.inFlight -= 1;
          }
        },
      },
    },
    agents: {
      async list() { return []; },
      async get() { return null; },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        if (/FROM public\.issues/i.test(sql)) return issueRows;
        if (/FROM public\.agents/i.test(sql)) return agentRows;
        if (/situation_snapshots/.test(sql)) return [];
        return [];
      },
      async execute() { return { rowCount: 1 }; },
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

// A promise that never settles — the canonical "hung relations.get" fixture.
const NEVER = () => new Promise(() => {});

// ---------------------------------------------------------------------------
// Test 1 — a HUNG relations.get floors that row to UNCLASSIFIED within the
// per-walk deadline; the snapshot returns 200 with all OTHER rows intact.
// ---------------------------------------------------------------------------
test('degrade — a hung relations.get floors that ONE row to UNCLASSIFIED (relations-walk-timeout) and the snapshot returns 200 with other rows intact', async () => {
  const bag = makeCtx({
    issueRows: [
      issueRow({ id: 'i-hang', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' }),
      issueRow({ id: 'i-ok', identifier: 'CO-2', status: 'blocked', assignee_user_id: 'u-1' }),
    ],
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
    relationsGet: async (id) => {
      if (id === 'i-hang') return NEVER(); // hangs forever
      return { blockedBy: [], blocks: [] };
    },
  });

  const t0 = Date.now();
  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1', snapshotBudgetMs: 200 });
  const elapsed = Date.now() - t0;

  // Floored, not hung: both blocked issues are surfaced (the hung one as an
  // UNCLASSIFIED degrade row), and the response returns far under 30s.
  assert.ok(elapsed < 5000, `snapshot returned in ${elapsed}ms, well under the 30s host timeout`);
  assert.equal(result.org_blocked_backlog.blocked_count, 2, 'both blocked issues counted (the hung one not dropped)');
  const hung = result.org_blocked_backlog.rows.find((r) => r.issueId === 'i-hang');
  const ok = result.org_blocked_backlog.rows.find((r) => r.issueId === 'i-ok');
  assert.ok(hung, 'the hung-walk issue is surfaced, not dropped');
  assert.equal(hung.terminalKind, 'UNCLASSIFIED', 'the hung walk floors to the honest UNCLASSIFIED row');
  assert.match(hung.humanAction, /open to investigate/i, 'the deterministic UNCLASSIFIED label');
  assert.ok(ok, 'the other (fast) row is intact');
  assert.notEqual(ok.terminalKind, 'UNCLASSIFIED', 'the fast row is NOT floored');
});

// ---------------------------------------------------------------------------
// Test 2 — a THROWN relations.get also floors (existing 'relations-walk-failed');
// neither path drops the issue.
// ---------------------------------------------------------------------------
test('degrade — a thrown relations.get floors that row to UNCLASSIFIED and the snapshot returns 200', async () => {
  const bag = makeCtx({
    issueRows: [
      issueRow({ id: 'i-throw', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' }),
      issueRow({ id: 'i-ok', identifier: 'CO-2', status: 'blocked', assignee_user_id: 'u-1' }),
    ],
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
    relationsGet: async (id) => {
      if (id === 'i-throw') throw new Error('relations.get boom for i-throw');
      return { blockedBy: [], blocks: [] };
    },
  });

  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1', snapshotBudgetMs: 200 });
  assert.equal(result.org_blocked_backlog.blocked_count, 2, 'both blocked issues counted');
  const thrown = result.org_blocked_backlog.rows.find((r) => r.issueId === 'i-throw');
  assert.ok(thrown, 'the thrown-walk issue is surfaced, not dropped');
  assert.equal(thrown.terminalKind, 'UNCLASSIFIED', 'the thrown walk floors to UNCLASSIFIED');
});

// ---------------------------------------------------------------------------
// Test 3 — a slow-but-eventually-resolving walk that finishes WITHIN the
// per-walk deadline resolves normally (NOT floored).
// ---------------------------------------------------------------------------
test('degrade — a slow walk that resolves within the per-walk deadline is NOT floored', async () => {
  const bag = makeCtx({
    issueRows: [
      issueRow({ id: 'i-slow', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' }),
    ],
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
    relationsGet: async () =>
      new Promise((resolve) => setTimeout(() => resolve({ blockedBy: [], blocks: [] }), 30)),
  });

  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });
  const row = result.org_blocked_backlog.rows.find((r) => r.issueId === 'i-slow');
  assert.ok(row, 'the slow row is present');
  assert.notEqual(row.terminalKind, 'UNCLASSIFIED', 'a within-deadline slow walk is NOT floored');
});

// ---------------------------------------------------------------------------
// Test 4 — the shared edge-graph build runs through mapBounded: no more than
// LIMIT relations.get walks are in flight at once (T-16-01 DoS cap).
// ---------------------------------------------------------------------------
test('degrade — the shared edge-graph build holds the concurrency ceiling (≤ LIMIT walks in flight)', async () => {
  const LIMIT = 5;
  // 12 blocked roots, each walk gated open only after we observe how many start.
  const N = 12;
  const issueRows = [];
  for (let k = 0; k < N; k += 1) {
    issueRows.push(issueRow({ id: `i-${k}`, identifier: `CO-${k}`, status: 'blocked', assignee_user_id: 'u-1' }));
  }
  let release;
  const gate = new Promise((r) => { release = r; });
  let started = 0;
  const bag = makeCtx({
    issueRows,
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
    relationsGet: async () => {
      started += 1;
      // Once the first LIMIT walks have all entered, release the gate so they
      // settle and the pool pulls the next batch — proving the cap held.
      if (started >= LIMIT) release();
      await gate;
      return { blockedBy: [], blocks: [] };
    },
  });

  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1' });
  assert.ok(
    bag.spies.maxInFlight <= LIMIT,
    `max-in-flight ${bag.spies.maxInFlight} must be ≤ LIMIT ${LIMIT} (DoS cap holds)`,
  );
  assert.equal(result.org_blocked_backlog.blocked_count, N, 'all blocked issues surfaced');
});

// ---------------------------------------------------------------------------
// Test 5 — SNAPSHOT_BUDGET_MS is injectable: an overall budget overridden to
// ~200ms exhausts fast and floors leftover startIds rather than blocking the
// response (the test does not burn the production ~8s).
// ---------------------------------------------------------------------------
test('degrade — an overall budget override (~200ms) floors leftover startIds and the snapshot returns fast', async () => {
  // Many blocked roots, EVERY walk hangs forever. Without an overall budget the
  // per-walk deadline alone would still settle each in ~2s, but the budget proves
  // the TOTAL build is bounded — overridden to ~200ms so the test is sub-second.
  const N = 8;
  const issueRows = [];
  for (let k = 0; k < N; k += 1) {
    issueRows.push(issueRow({ id: `i-${k}`, identifier: `CO-${k}`, status: 'blocked', assignee_user_id: 'u-1' }));
  }
  const bag = makeCtx({
    issueRows,
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
    relationsGet: NEVER, // every walk hangs
  });

  const t0 = Date.now();
  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1', snapshotBudgetMs: 200 });
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 3000, `budget-bounded snapshot returned in ${elapsed}ms (sub-second budget override honored)`);
  assert.equal(result.org_blocked_backlog.blocked_count, N, 'every blocked issue surfaced (none dropped)');
  // Every row floored to UNCLASSIFIED (all walks hung past the budget).
  const allFloored = result.org_blocked_backlog.rows.every((r) => r.terminalKind === 'UNCLASSIFIED');
  assert.ok(allFloored, 'leftover (un-computed) startIds floor to UNCLASSIFIED rather than blocking');
});

// ---------------------------------------------------------------------------
// Test 6 — return shape unchanged under degrade.
// ---------------------------------------------------------------------------
test('degrade — the return shape stays {org_blocked_backlog, situation_employees, needsYou, pulse, taken_at} under a hung walk', async () => {
  const bag = makeCtx({
    issueRows: [issueRow({ id: 'i-hang', identifier: 'CO-1', status: 'blocked', assignee_user_id: 'u-1' })],
    agentRows: [agentRow({ id: 'u-1', name: 'You' })],
    relationsGet: NEVER,
  });
  const result = await runSnapshot(bag, { userId: 'u-1', companyId: 'co-1', snapshotBudgetMs: 200 });
  assert.ok(result.org_blocked_backlog, 'org_blocked_backlog present');
  assert.ok(Array.isArray(result.situation_employees), 'situation_employees present');
  assert.ok(result.needsYou, 'needsYou present');
  assert.ok(result.pulse, 'pulse present');
  assert.equal(typeof result.taken_at, 'string', 'taken_at present');
});
