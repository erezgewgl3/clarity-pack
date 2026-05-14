// test/worker/situation-snapshot-narration.test.mjs
//
// Plan 02-08 Task 2 RED — integration test: the recompute-situation job MUST
// call humanizeChain on every blocker_chain + critical_path entry BEFORE
// INSERT. Captured INSERT payload is asserted UUID-free in terminal.label.
//
// This is the integration contract closing DEV-11 (raw UUIDs leaked to UI in
// the Plan 02-04 drill). The pure helper unit tests live in humanize-snapshot
// .test.mjs; this file proves the helper is wired into the job.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationSnapshotJob } from '../../src/worker/jobs/situation-snapshot.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The drill captured these exact UUIDs as the agent ids; replicate the shape.
const CEO_AGENT_ID = 'b2a22e50-d772-4b70-bb50-4f4e93c2e984';
const EDITOR_AGENT_ID = '58f86f42-9fa3-4922-acff-985191ca15a7';
const ERIC_USER_ID = 'eric-uuid-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeJobCtx({ employees }) {
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
        return [{ id: 'co-1', name: 'Acme', owner_user_id: ERIC_USER_ID }];
      },
    },
    agents: {
      async list({ companyId }) {
        return employees;
      },
    },
    issues: {
      relations: {
        async get() { return { blockedBy: [], blocks: [] }; },
      },
    },
  };
  return { ctx, dbCalls, jobs, getCapturedPayload: () => capturedPayload };
}

const DRILL_EMPLOYEES = [
  {
    id: CEO_AGENT_ID,
    user_id: CEO_AGENT_ID,
    role: 'ceo',
    state: 'Standby',
    last_state_change_at: new Date().toISOString(),
    current_focus_issue_id: '',
    current_task_summary: null,
    latest_work_product: null,
    velocity_7d_array: [],
  },
  {
    id: EDITOR_AGENT_ID,
    user_id: EDITOR_AGENT_ID,
    role: 'editor',
    state: 'Standby',
    last_state_change_at: new Date().toISOString(),
    current_focus_issue_id: '',
    current_task_summary: null,
    latest_work_product: null,
    velocity_7d_array: [],
  },
];

test('situation-snapshot: every employee blocker_chain terminal.label is UUID-free after humanization (DEV-11)', async () => {
  const { ctx, jobs, getCapturedPayload } = makeJobCtx({ employees: DRILL_EMPLOYEES });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r1', trigger: 'schedule', scheduledAt: new Date().toISOString() });

  const payload = getCapturedPayload();
  assert.ok(payload, 'INSERT must have run with a payload');
  assert.ok(payload.employees.length >= 2, 'both drill agents land in payload');

  for (const emp of payload.employees) {
    assert.doesNotMatch(
      emp.blocker_chain.terminal.label,
      UUID_RE,
      `employee.blocker_chain.terminal.label leaked a UUID: ${emp.blocker_chain.terminal.label}`,
    );
  }
});

test('situation-snapshot: every critical_path entry terminal.label is UUID-free after humanization (DEV-11)', async () => {
  const { ctx, jobs, getCapturedPayload } = makeJobCtx({ employees: DRILL_EMPLOYEES });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r2', trigger: 'schedule', scheduledAt: new Date().toISOString() });

  const payload = getCapturedPayload();
  assert.ok(payload.critical_path.length >= 1, 'critical_path is populated');
  for (const chain of payload.critical_path) {
    assert.doesNotMatch(
      chain.terminal.label,
      UUID_RE,
      `critical_path entry terminal.label leaked a UUID: ${chain.terminal.label}`,
    );
  }
});

test('situation-snapshot: terminal.label contains the human role label (CEO / Editor) when lookup hits', async () => {
  const { ctx, jobs, getCapturedPayload } = makeJobCtx({ employees: DRILL_EMPLOYEES });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r3', trigger: 'schedule', scheduledAt: new Date().toISOString() });

  const payload = getCapturedPayload();
  const ceoEmp = payload.employees.find((e) => e.role === 'ceo');
  assert.ok(ceoEmp, 'CEO employee row exists');
  // ceo agent has __unowned__ HUMAN_ACTION_ON; humanization should produce
  // "CEO has no owner assigned" (lookup hit form).
  assert.match(
    ceoEmp.blocker_chain.terminal.label,
    /CEO has no owner assigned|CEO|no owner assigned/,
    `expected CEO row label to be humanized; got: ${ceoEmp.blocker_chain.terminal.label}`,
  );
});

test('situation-snapshot: payload JSON-stringified contains zero UUID-shaped substrings in any terminal.label (BLANKET)', async () => {
  const { ctx, jobs, getCapturedPayload } = makeJobCtx({ employees: DRILL_EMPLOYEES });
  registerSituationSnapshotJob(ctx);
  const job = jobs.get('recompute-situation');
  await job({ jobKey: 'recompute-situation', runId: 'r4', trigger: 'schedule', scheduledAt: new Date().toISOString() });

  const payload = getCapturedPayload();
  // Stringify the labels only — other fields legitimately contain agent UUIDs.
  const labels = [
    ...payload.employees.map((e) => e.blocker_chain.terminal.label),
    ...payload.critical_path.map((c) => c.terminal.label),
  ];
  for (const label of labels) {
    assert.doesNotMatch(label, UUID_RE, `label leaked a UUID: ${label}`);
  }
});
