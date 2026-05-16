// test/worker/circuit-breaker.test.mjs
//
// Plan 02-03 Task 1 — D-06 circuit breaker. After 3 consecutive failures
// (counted in-memory per worker process), recordFailure invokes
// ctx.agents.pause(agentId, companyId) exactly once with the resolved agent
// row's UUID. A subsequent recordSuccess() resets the counter; another 3
// failures triggers pause again. Failures also append to the durable
// editor_agent_failures audit table in the plugin namespace.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  recordFailure,
  recordSuccess,
  resetCircuitBreakerState,
  MAX_CONSECUTIVE_FAILURES,
} from '../../src/worker/agents/circuit-breaker.ts';

function makeFakeCtx() {
  const pauseCalls = [];
  const dbCalls = [];
  return {
    pauseCalls,
    dbCalls,
    ctx: {
      agents: {
        async pause(agentId, companyId) {
          pauseCalls.push({ agentId, companyId });
          return { id: agentId, status: 'paused' };
        },
      },
      db: {
        async execute(sql, params) {
          dbCalls.push({ sql, params });
        },
      },
    },
  };
}

test('MAX_CONSECUTIVE_FAILURES is the locked literal 3 (D-06)', () => {
  assert.equal(MAX_CONSECUTIVE_FAILURES, 3);
});

test('First two consecutive failures do NOT invoke pause', async () => {
  resetCircuitBreakerState();
  const { ctx, pauseCalls } = makeFakeCtx();
  const c1 = await recordFailure(ctx, {
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
    reason: 'first',
  });
  assert.equal(c1, 1, 'first failure count is 1');
  const c2 = await recordFailure(ctx, {
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
    reason: 'second',
  });
  assert.equal(c2, 2, 'second failure count is 2');
  assert.equal(pauseCalls.length, 0, 'no pause yet');
});

test('Third consecutive failure invokes ctx.agents.pause exactly once with (agentId, companyId)', async () => {
  resetCircuitBreakerState();
  const { ctx, pauseCalls } = makeFakeCtx();
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'r1' });
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'r2' });
  const c3 = await recordFailure(ctx, {
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
    reason: 'r3',
  });
  assert.equal(c3, 3);
  assert.equal(pauseCalls.length, 1, 'pause invoked once');
  assert.equal(pauseCalls[0].agentId, 'uuid-1', 'pause called with the resolved agentId (UUID), not agentKey');
  assert.equal(pauseCalls[0].companyId, 'co-1');
});

test('recordSuccess resets the counter so another 3 failures trigger pause again', async () => {
  resetCircuitBreakerState();
  const { ctx, pauseCalls } = makeFakeCtx();
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'a' });
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'b' });
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'c' }); // pause
  assert.equal(pauseCalls.length, 1);
  recordSuccess('editor-agent');
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'd' });
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'e' });
  await recordFailure(ctx, { agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1', reason: 'f' }); // pause again
  assert.equal(pauseCalls.length, 2, 'pause invoked again after reset + 3 failures');
});

test('recordFailure appends to editor_agent_failures audit table in the baked plugin namespace', async () => {
  resetCircuitBreakerState();
  const { ctx, dbCalls } = makeFakeCtx();
  await recordFailure(ctx, {
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
    reason: 'audit-row-test',
  });
  assert.equal(dbCalls.length, 1);
  assert.match(
    dbCalls[0].sql,
    /plugin_clarity_pack_cdd6bda4bd\.editor_agent_failures/,
    'SQL must target the baked-namespace audit table (02-01 SMOKE-FINDINGS Finding #4)',
  );
  // params: [agentKey, reason, consecutive, plugin_version]
  // Plan 03-07 — recordFailure now stamps the plugin version (migration 0005's
  // plugin_version column) so isCircuitOpenDurable can scope its count to the
  // current version (DURABLE-BREAKER-STALE-HISTORY fix).
  assert.equal(dbCalls[0].params.length, 4, 'INSERT carries 4 params incl. plugin_version');
  assert.deepEqual(
    dbCalls[0].params.slice(0, 3),
    ['editor-agent', 'audit-row-test', 1],
    'the first three params (agentKey, reason, consecutive) are unchanged',
  );
  assert.match(dbCalls[0].sql, /plugin_version/, 'the INSERT column list includes plugin_version');
  assert.equal(typeof dbCalls[0].params[3], 'string', 'the 4th param is the plugin version string');
});

test('recordFailure returns the current consecutive count', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeFakeCtx();
  const c = await recordFailure(ctx, {
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
    reason: 'r',
  });
  assert.equal(c, 1);
});
