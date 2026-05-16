// test/worker/bulletin/failed-compile-banner.test.mjs
//
// Plan 03-04 Task 1 RED — BULL-08 failed-compile status handler and retry
// metadata shape.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerBulletinLatestStatus } from '../../../src/worker/handlers/bulletin-latest-status.ts';
import { computeCompileRetry } from '../../../src/worker/jobs/compile-bulletin.ts';

function makeCtx({ failure = null, queryThrows = false } = {}) {
  const dataHandlers = new Map();
  const ctx = {
    data: { register: (key, fn) => dataHandlers.set(key, fn) },
    logger: { warn() {}, info() {} },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) return [{ opted_in_at: '2026-05-16T00:00:00.000Z' }];
        if (queryThrows) throw new Error('db down');
        if (/bulletin_compile_failures/i.test(sql)) return failure ? [failure] : [];
        return [];
      },
    },
  };
  registerBulletinLatestStatus(ctx);
  return { ctx, dataHandlers };
}

test('latest status registers bulletin.latestCompileStatus via data handler', () => {
  const { dataHandlers } = makeCtx();
  assert.equal(typeof dataHandlers.get('bulletin.latestCompileStatus'), 'function');
});

test('latest status returns ok when no compile failures exist', async () => {
  const { dataHandlers } = makeCtx();
  assert.deepEqual(
    await dataHandlers.get('bulletin.latestCompileStatus')({ userId: 'user-1', companyId: 'COU' }),
    { kind: 'ok' },
  );
});

test('latest status returns failed when next_retry_at is in the future', async () => {
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { dataHandlers } = makeCtx({
    failure: {
      id: 1,
      cycle_number: 8,
      failed_at: '2026-05-16T10:31:00.000Z',
      reason: 'Synthetic failure',
      attempt_n: 2,
      next_retry_at: future,
    },
  });
  assert.deepEqual(
    await dataHandlers.get('bulletin.latestCompileStatus')({ userId: 'user-1', companyId: 'COU' }),
    {
      kind: 'failed',
      attemptAt: '2026-05-16T10:31:00.000Z',
      nextRetryAt: future,
      reason: 'Synthetic failure',
      attemptN: 2,
    },
  );
});

test('latest status hides old failures once retry time is due', async () => {
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const { dataHandlers } = makeCtx({
    failure: {
      id: 1,
      cycle_number: 8,
      failed_at: '2026-05-16T10:31:00.000Z',
      reason: 'Retry already due',
      attempt_n: 1,
      next_retry_at: past,
    },
  });
  assert.deepEqual(
    await dataHandlers.get('bulletin.latestCompileStatus')({ userId: 'user-1', companyId: 'COU' }),
    { kind: 'ok' },
  );
});

test('latest status degrades to ok when db read throws', async () => {
  const { dataHandlers } = makeCtx({ queryThrows: true });
  assert.deepEqual(
    await dataHandlers.get('bulletin.latestCompileStatus')({ userId: 'user-1', companyId: 'COU' }),
    { kind: 'ok' },
  );
});

test('retry helper spaces retries at 15 minutes and increments attempt number', () => {
  const now = new Date('2026-05-16T10:30:00.000Z');
  assert.deepEqual(computeCompileRetry(0, now), {
    attemptN: 1,
    nextRetryAt: '2026-05-16T10:45:00.000Z',
  });
  assert.deepEqual(computeCompileRetry(1, now), {
    attemptN: 2,
    nextRetryAt: '2026-05-16T10:45:00.000Z',
  });
  assert.deepEqual(computeCompileRetry(2, now), {
    attemptN: 3,
    nextRetryAt: '2026-05-16T10:45:00.000Z',
  });
});

