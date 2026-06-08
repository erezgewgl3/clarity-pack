// test/worker/agents/wake-governor.test.mjs
//
// Phase 16.1 Plan 16.1-02 Task 1 (D-06/D-07/D-08) — unit tests for the
// throughput wake-governor. Hand-rolled fake-ctx idiom (no mock lib), same
// shape as RESEARCH section 3 makeStormCtx: a fake `db` backing the durable
// wake_ledger + wake_kill_switch tables with in-memory structures keyed off the
// SQL the repos emit.
//
// The governor composes three Plan-01 repos:
//   - wake-ledger-repo: appendWake / countTrailingWakes / pruneOldWakes
//   - wake-kill-switch-repo: isEngaged / engage
// so the fake db must answer the exact SQL those repos run.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { checkAndRecordWake } from '../../../src/worker/agents/wake-governor.ts';

const ENV_KEY = 'CLARITY_WAKE_CEILING_PER_MIN';

/**
 * Build a fake ctx whose db simulates the two durable tables with in-memory
 * structures, dispatched off the SQL text the Plan-01 repos emit:
 *   - INSERT ... wake_ledger        → push a wake timestamp
 *   - SELECT count(*) ... wake_ledger → trailing-window count
 *   - DELETE ... wake_ledger        → prune (no-op for this in-memory clock)
 *   - SELECT engaged ... wake_kill_switch → read the engaged flag
 *   - INSERT ... wake_kill_switch ... ON CONFLICT → engage (set flag + reason)
 *
 * The window predicate is honored loosely: every appended wake is counted
 * (tests drive bursts inside one synthetic minute), which is exactly the storm
 * shape the governor must bound.
 */
function makeCtx({ engaged = false } = {}) {
  const state = {
    wakeLedger: [], // array of { companyId }
    killSwitch: new Map(), // companyId → { engaged, reason }
    warnLogs: [],
    infoLogs: [],
  };
  if (engaged) state.killSwitch.set('company-1', { engaged: true, reason: 'pre' });

  const ctx = {
    logger: {
      info: (msg, meta) => state.infoLogs.push({ msg, meta }),
      warn: (msg, meta) => state.warnLogs.push({ msg, meta }),
      error() {},
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/count\(\*\)/i.test(sql) && /wake_ledger/i.test(sql)) {
          const companyId = params[0];
          const n = state.wakeLedger.filter((r) => r.companyId === companyId).length;
          return [{ n }];
        }
        if (/wake_kill_switch/i.test(sql) && /select/i.test(sql)) {
          const companyId = params[0];
          const row = state.killSwitch.get(companyId);
          return row?.engaged ? [{ engaged: true }] : [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/insert/i.test(sql) && /wake_ledger/i.test(sql)) {
          state.wakeLedger.push({ companyId: params[0] });
          return { rowCount: 1 };
        }
        if (/delete/i.test(sql) && /wake_ledger/i.test(sql)) {
          // prune — in-memory clock keeps everything; no-op is faithful to a
          // burst inside one window.
          return { rowCount: 0 };
        }
        if (/insert/i.test(sql) && /wake_kill_switch/i.test(sql)) {
          const companyId = params[0];
          const reason = params[1];
          state.killSwitch.set(companyId, { engaged: true, reason });
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      },
    },
  };
  return { ctx, state };
}

test('checkAndRecordWake: under the ceiling → returns true and appends a ledger row', async () => {
  delete process.env[ENV_KEY]; // default ceiling 6
  const { ctx, state } = makeCtx();

  const allowed = await checkAndRecordWake(ctx, 'company-1');

  assert.equal(allowed, true, 'a first wake well under the ceiling is allowed');
  assert.equal(state.wakeLedger.length, 1, 'the wake was recorded in the ledger');
  assert.equal(state.killSwitch.size, 0, 'the kill-switch is NOT engaged under the ceiling');
});

test('checkAndRecordWake: env-default ceiling is 6 — the 7th wake in the window is suppressed AND engages the kill-switch', async () => {
  delete process.env[ENV_KEY]; // absent → default 6
  const { ctx, state } = makeCtx();

  const results = [];
  for (let i = 0; i < 7; i += 1) {
    results.push(await checkAndRecordWake(ctx, 'company-1'));
  }

  // calls 1..6 are at-or-under the ceiling; the 7th drives the trailing count
  // above 6 → suppressed.
  assert.deepEqual(
    results,
    [true, true, true, true, true, true, false],
    'six wakes pass, the seventh (rate > 6) is suppressed',
  );
  const ks = state.killSwitch.get('company-1');
  assert.ok(ks?.engaged, 'the durable kill-switch is engaged on overflow (D-08)');
  assert.ok(state.warnLogs.length >= 1, 'the trip is observable in logs (LOOP-03)');
});

test('checkAndRecordWake: env override CLARITY_WAKE_CEILING_PER_MIN=2 — the 3rd wake is suppressed', async () => {
  process.env[ENV_KEY] = '2';
  try {
    const { ctx, state } = makeCtx();
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await checkAndRecordWake(ctx, 'company-1'));
    }
    assert.deepEqual(results, [true, true, false], 'ceiling=2 → third wake suppressed');
    assert.ok(state.killSwitch.get('company-1')?.engaged, 'overflow engages the switch');
  } finally {
    delete process.env[ENV_KEY];
  }
});

test('checkAndRecordWake: kill-switch already engaged at entry → returns false immediately without re-exceeding the ceiling', async () => {
  delete process.env[ENV_KEY];
  const { ctx, state } = makeCtx({ engaged: true });

  const allowed = await checkAndRecordWake(ctx, 'company-1');

  assert.equal(allowed, false, 'a pre-engaged switch suppresses the wake immediately (D-08)');
  assert.equal(
    state.wakeLedger.length,
    0,
    'no ledger append happens when the switch is already engaged (short-circuit)',
  );
  assert.ok(
    state.infoLogs.some((l) => /kill-switch/i.test(l.msg)),
    'the short-circuit is observable in logs',
  );
});
