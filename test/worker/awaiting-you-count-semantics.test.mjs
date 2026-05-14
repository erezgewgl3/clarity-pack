// test/worker/awaiting-you-count-semantics.test.mjs
//
// Plan 02-08 Task 3 RED — DEV-13 closure. The "Awaiting You" pill count must
// exclude __unowned__ terminals and other-user terminals; only count
// HUMAN_ACTION_ON terminals whose userId === viewerUserId.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationSnapshotJob } from '../../src/worker/jobs/situation-snapshot.ts';

const ERIC = 'eric-uuid-aaaa';
const BOB = 'bob-uuid-bbbb';

function makeJobCtx({ employees, ownerUserId = ERIC }) {
  const dbCalls = [];
  const jobs = new Map();
  let capturedPayload = null;
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        dbCalls.push({ kind: 'query', sql });
        if (/active_viewers/.test(sql)) return [{ n: 1 }];
        return [];
      },
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        if (/situation_snapshots/.test(sql)) {
          capturedPayload = JSON.parse(params[1]);
        }
        return { rowCount: 1 };
      },
    },
    jobs: { register(key, fn) { jobs.set(key, fn); } },
    companies: {
      async list() {
        return [{ id: 'co-1', owner_user_id: ownerUserId }];
      },
    },
    agents: {
      async list({ companyId }) {
        return employees;
      },
    },
    issues: {
      relations: {
        async get(issueId) {
          // The custom flag in agents tells us what shape to emit.
          return { blockedBy: [], blocks: [] };
        },
      },
    },
  };
  return { ctx, jobs, getCapturedPayload: () => capturedPayload };
}

/**
 * Make an agent whose flattenBlockerChain output's terminal will become
 * `{ kind: 'HUMAN_ACTION_ON', userId: '__unowned__', label: 'Owner unknown — ...' }`
 * by leaving current_focus_issue_id empty + no relations — this is the same
 * code path that produced the captured drill payload.
 */
function unownedAgent(role, idSuffix) {
  return {
    id: `agent-${idSuffix}`,
    user_id: `agent-${idSuffix}`,
    role,
    state: 'Standby',
    last_state_change_at: new Date().toISOString(),
    current_focus_issue_id: '',
    current_task_summary: null,
    latest_work_product: null,
    velocity_7d_array: [],
  };
}

test('awaitingYouCount excludes __unowned__ terminals (DEV-13)', async () => {
  const { ctx, jobs, getCapturedPayload } = makeJobCtx({
    employees: [unownedAgent('ceo', 'a'), unownedAgent('editor', 'b')],
  });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r1', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  const payload = getCapturedPayload();
  assert.equal(
    payload.awaiting_you_count,
    0,
    `expected 0 (both terminals are __unowned__, not awaiting Eric); got ${payload.awaiting_you_count}`,
  );
});

test('awaitingYouCount counts only HUMAN_ACTION_ON terminals targeting the viewer (DEV-13)', async () => {
  // Build a custom job ctx that injects a fake blocker chain via the
  // relations.get path: agent-eric's start issue resolves to an owner=ERIC
  // HUMAN_ACTION_ON; agent-bob's start issue resolves to owner=BOB; agent-x is
  // __unowned__.
  const employees = [
    {
      id: 'a-eric',
      user_id: 'a-eric',
      role: 'engineer',
      state: 'Stuck',
      last_state_change_at: new Date().toISOString(),
      current_focus_issue_id: 'ISSUE-ERIC',
      current_task_summary: null,
      latest_work_product: null,
      velocity_7d_array: [],
    },
    {
      id: 'a-bob',
      user_id: 'a-bob',
      role: 'designer',
      state: 'Stuck',
      last_state_change_at: new Date().toISOString(),
      current_focus_issue_id: 'ISSUE-BOB',
      current_task_summary: null,
      latest_work_product: null,
      velocity_7d_array: [],
    },
    unownedAgent('pm', 'x'),
  ];
  const { ctx, jobs, getCapturedPayload } = makeJobCtx({ employees, ownerUserId: ERIC });
  // Override issues.relations.get so the ERIC-owned issue resolves to ERIC and
  // BOB-owned resolves to BOB.
  ctx.issues.relations.get = async (issueId) => {
    if (issueId === 'ISSUE-ERIC') {
      return {
        blockedBy: [
          { id: 'LEAF-ERIC', assigneeUserId: ERIC, status: 'awaiting' },
        ],
        blocks: [],
      };
    }
    if (issueId === 'ISSUE-BOB') {
      return {
        blockedBy: [
          { id: 'LEAF-BOB', assigneeUserId: BOB, status: 'awaiting' },
        ],
        blocks: [],
      };
    }
    return { blockedBy: [], blocks: [] };
  };
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r2', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  const payload = getCapturedPayload();
  assert.equal(
    payload.awaiting_you_count,
    1,
    `expected 1 (only ERIC-targeting terminal counts); got ${payload.awaiting_you_count}. Employees: ${JSON.stringify(payload.employees.map(e => ({ role: e.role, terminal: e.blocker_chain.terminal })))}`,
  );
});
