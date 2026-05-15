// test/worker/situation-snapshot.test.mjs
//
// Plan 02-04 Task 2 RED — recompute-situation 60s job. Verifies:
//   - No-op when active_viewers table has zero rows < 90s old (ROOM-05 gate)
//   - Snapshot payload includes one employee row per Paperclip agent + the
//     critical-path strip (max 3) + artifacts shipped today
//   - blocker_chain field uses the existing flattenBlockerChain primitive
//     (PRIM-03 — deterministic, no LLM in the terminal selection)
//   - Idempotent: same content_hash dedupes on ON CONFLICT DO NOTHING
//   - INSERT targets plugin_clarity_pack_cdd6bda4bd.situation_snapshots
//     (Finding #4 fully-qualified namespace)

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationSnapshotJob } from '../../src/worker/jobs/situation-snapshot.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

function makeJobCtx({ activeViewerCount = 1, companies = [], employees = {} } = {}) {
  const dbCalls = [];
  const jobs = new Map();
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        if (/active_viewers/.test(sql)) {
          return [{ n: activeViewerCount }];
        }
        return [];
      },
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        return { rowCount: 1 };
      },
    },
    jobs: {
      register(key, fn) {
        jobs.set(key, fn);
      },
    },
    companies: {
      async list() {
        return companies;
      },
      async get(id) {
        return companies.find((c) => c.id === id) ?? null;
      },
    },
    agents: {
      async list({ companyId }) {
        return employees[companyId] ?? [];
      },
    },
    issues: {
      relations: {
        async get() {
          return { blockedBy: [], blocks: [] };
        },
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, dbCalls, jobs };
}

// ---------------------------------------------------------------------------
// ROOM-05: active-viewer gating
// ---------------------------------------------------------------------------

test('situation-snapshot: no-op when active_viewers count = 0 (ROOM-05)', async () => {
  const { ctx, dbCalls, jobs } = makeJobCtx({ activeViewerCount: 0 });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r1', trigger: 'schedule', scheduledAt: new Date().toISOString() });

  // Only the active_viewers count query should have run; NO INSERT into
  // situation_snapshots should have happened.
  const inserts = dbCalls.filter((c) => /INSERT INTO/.test(c.sql ?? ''));
  assert.equal(inserts.length, 0, 'job must short-circuit when no active viewers');
});

test('situation-snapshot: runs when ≥1 active viewer (ROOM-05 negative gate test)', async () => {
  const { ctx, dbCalls, jobs } = makeJobCtx({
    activeViewerCount: 1,
    companies: [{ id: 'co-1', name: 'Acme', owner_user_id: 'eric' }],
    employees: {
      'co-1': [
        {
          id: 'agent-1',
          user_id: 'agent-1',
          role: 'engineer',
          state: 'Working',
          last_state_change_at: new Date(Date.now() - 60_000).toISOString(),
          current_focus_issue_id: 'BEAAA-100',
          current_task_summary: 'Refactor the auth flow',
          latest_work_product: null,
          velocity_7d_array: [1, 2, 3, 4, 5, 6, 7],
        },
      ],
    },
  });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r2', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  const inserts = dbCalls.filter((c) => /INSERT INTO/.test(c.sql ?? ''));
  assert.equal(inserts.length, 1, 'one INSERT per company with active viewers');
});

// ---------------------------------------------------------------------------
// DDL target — fully qualified namespace (Finding #4)
// ---------------------------------------------------------------------------

test('situation-snapshot: INSERT targets plugin_clarity_pack_cdd6bda4bd.situation_snapshots (Finding #4)', async () => {
  const { ctx, dbCalls, jobs } = makeJobCtx({
    activeViewerCount: 1,
    companies: [{ id: 'co-1', name: 'Acme', owner_user_id: 'eric' }],
    employees: { 'co-1': [] },
  });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r3', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  const inserts = dbCalls.filter((c) => /INSERT INTO/.test(c.sql ?? ''));
  assert.equal(inserts.length, 1);
  assert.match(
    inserts[0].sql,
    /INSERT INTO plugin_clarity_pack_cdd6bda4bd\.situation_snapshots/,
  );
});

// ---------------------------------------------------------------------------
// Idempotency — ON CONFLICT DO NOTHING (content_hash dedupe)
// ---------------------------------------------------------------------------

test('situation-snapshot: INSERT contains ON CONFLICT DO NOTHING for content_hash dedupe', async () => {
  const { ctx, dbCalls, jobs } = makeJobCtx({
    activeViewerCount: 1,
    companies: [{ id: 'co-1', name: 'Acme', owner_user_id: 'eric' }],
    employees: { 'co-1': [] },
  });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r4', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  const insert = dbCalls.find((c) => /INSERT INTO/.test(c.sql ?? ''));
  assert.match(insert.sql, /ON CONFLICT[\s\S]*DO NOTHING/i);
});

// ---------------------------------------------------------------------------
// PRIM-03 — chain selection is deterministic (not LLM)
// ---------------------------------------------------------------------------

test('situation-snapshot: payload includes blocker_chain via flattenBlockerChain (PRIM-03 deterministic)', async () => {
  let capturedPayload = null;
  const { ctx, jobs } = makeJobCtx({
    activeViewerCount: 1,
    companies: [{ id: 'co-1', name: 'Acme', owner_user_id: 'eric' }],
    employees: {
      'co-1': [
        {
          id: 'agent-1',
          user_id: 'agent-1',
          role: 'engineer',
          state: 'Stuck',
          last_state_change_at: new Date(Date.now() - 3_600_000).toISOString(),
          current_focus_issue_id: 'BEAAA-100',
          current_task_summary: 'Resolve the auth issue',
          latest_work_product: null,
          velocity_7d_array: [],
        },
      ],
    },
  });
  ctx.db.execute = async (sql, params) => {
    if (/situation_snapshots/.test(sql)) {
      // payload is the second positional param after company_id
      capturedPayload = JSON.parse(params[1]);
    }
    return { rowCount: 1 };
  };
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r5', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  assert.ok(capturedPayload, 'INSERT must have captured a payload');
  assert.ok(Array.isArray(capturedPayload.employees), 'payload.employees exists');
  assert.equal(capturedPayload.employees.length, 1);
  // PRIM-03: blocker_chain is the deterministic output of flattenBlockerChain
  // — its terminal kind is one of the four documented kinds (no LLM-derived).
  const chain = capturedPayload.employees[0].blocker_chain;
  assert.ok(chain, 'employee.blocker_chain exists');
  assert.ok(['HUMAN_ACTION_ON', 'SELF_RESOLVING', 'EXTERNAL', 'CYCLE'].includes(chain.terminal.kind));
});

test('situation-snapshot: critical_path strip has at most 3 chains (ROOM-02)', async () => {
  let capturedPayload = null;
  const { ctx, jobs } = makeJobCtx({
    activeViewerCount: 1,
    companies: [{ id: 'co-1', name: 'Acme', owner_user_id: 'eric' }],
    employees: {
      'co-1': Array.from({ length: 7 }).map((_, i) => ({
        id: `agent-${i}`,
        user_id: `agent-${i}`,
        role: 'engineer',
        state: 'Working',
        last_state_change_at: new Date().toISOString(),
        current_focus_issue_id: `BEAAA-${i}`,
        current_task_summary: `Task ${i}`,
        latest_work_product: null,
        velocity_7d_array: [],
      })),
    },
  });
  ctx.db.execute = async (sql, params) => {
    if (/situation_snapshots/.test(sql)) {
      capturedPayload = JSON.parse(params[1]);
    }
    return { rowCount: 1 };
  };
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r6', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  assert.ok(capturedPayload.critical_path);
  assert.ok(capturedPayload.critical_path.length <= 3, 'critical_path is bounded at 3');
});
