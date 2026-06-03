// test/worker/jobs/compile-bulletin-scope-backoff.test.mjs
//
// HOTFIX v1.4.3 (incident 2026-06-03) — the dead-scope scheduler churn.
//
// registerCompileBulletinJob fires every minute and calls ctx.companies.list().
// On paperclipai@2026.525.0 the scheduled-job invocation scope is dead (PR #6547),
// so companies.list throws "missing, expired, or unknown invocation scope" on
// EVERY tick → on BEAAA, 678 identical failures + 60 wasted calls/hour. The cron
// compile is already non-functional (the bulletin is served by the view-driven
// resumePendingCompile path), so the every-minute retry is pure churn + log spam.
//
// Fix: ADAPTIVE backoff — after N consecutive companies.list failures, skip the
// call for a backoff window (one attempt per window instead of 60/hr). A healthy
// host where companies.list works keeps iterating every tick (the backoff resets
// on success), so this is safe on instances without the PR #6547 scope bug.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerCompileBulletinJob,
  __resetBulletinScopeBackoff,
} from '../../../src/worker/jobs/compile-bulletin.ts';

const SCOPE_ERR =
  'Plugin "x" is not allowed to perform "companies.list": the worker referenced a missing, expired, or unknown invocation scope';

function register(ctx) {
  const handlers = new Map();
  ctx.jobs = { register: (key, fn) => handlers.set(key, fn) };
  registerCompileBulletinJob(ctx);
  return handlers.get('compile-bulletin');
}

test.beforeEach(() => __resetBulletinScopeBackoff());

test('compile-bulletin backs off companies.list after repeated dead-scope failures', async () => {
  let listCalls = 0;
  const ctx = {
    logger: { warn() {}, info() {} },
    config: { async get() { return {}; } },
    companies: {
      async list() {
        listCalls += 1;
        throw new Error(SCOPE_ERR);
      },
    },
  };
  const job = register(ctx);

  // Fire many ticks in quick succession (all within the backoff window).
  for (let i = 0; i < 12; i += 1) await job();

  // Without backoff this would be 12. With backoff it must stop attempting after
  // the small failure threshold.
  assert.ok(
    listCalls <= 3,
    `companies.list must back off after repeated dead-scope failures, got ${listCalls} calls in 12 ticks`,
  );
});

test('compile-bulletin keeps calling companies.list every tick on a healthy host', async () => {
  let listCalls = 0;
  const ctx = {
    logger: { warn() {}, info() {} },
    config: { async get() { return {}; } },
    companies: {
      async list() {
        listCalls += 1;
        return []; // healthy: no companies → loop body is a no-op
      },
    },
  };
  const job = register(ctx);

  for (let i = 0; i < 4; i += 1) await job();

  assert.equal(listCalls, 4, 'a healthy host (companies.list works) must NOT back off');
});

test('compile-bulletin resets backoff after a recovery (failures then success)', async () => {
  let mode = 'fail';
  let listCalls = 0;
  const ctx = {
    logger: { warn() {}, info() {} },
    config: { async get() { return {}; } },
    companies: {
      async list() {
        listCalls += 1;
        if (mode === 'fail') throw new Error(SCOPE_ERR);
        return [];
      },
    },
  };
  const job = register(ctx);

  // Trip the backoff.
  for (let i = 0; i < 6; i += 1) await job();
  const callsAtBackoff = listCalls;
  // Recovery + reset, then a healthy tick should call again.
  mode = 'ok';
  __resetBulletinScopeBackoff();
  await job();
  assert.equal(listCalls, callsAtBackoff + 1, 'after reset+recovery, companies.list is attempted again');
});
