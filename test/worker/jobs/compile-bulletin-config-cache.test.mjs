// test/worker/jobs/compile-bulletin-config-cache.test.mjs
//
// COU-2798 — the scheduled compile-bulletin tick must NOT call ctx.config.get().
//
// The host dispatches scheduled jobs (runJob) without a company invocation
// scope, so config.get from the cron tick is always denied by the host gate
// ("company context is required"). On the CounterMoves box that produced one
// host-handler ERROR + one plugin WARN every minute. The denial is correct and
// stays; the tick now reads bulletinTimezone from a cache that the plugin's
// onConfigChanged hook fills from host-pushed config (startup + operator save).
// Host-scoped handlers (compileNow / byCycle) keep reading config directly via
// resolveBulletinTz.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  registerCompileBulletinJob,
  resolveBulletinTz,
  setCachedBulletinConfig,
  getCachedBulletinTz,
  __resetCachedBulletinTz,
  __resetBulletinScopeBackoff,
} from '../../../src/worker/jobs/compile-bulletin.ts';

const DENIED =
  'Plugin "x" is not allowed to perform "config.get": company context is required';

function register(ctx) {
  const handlers = new Map();
  ctx.jobs = { register: (key, fn) => handlers.set(key, fn) };
  registerCompileBulletinJob(ctx);
  return handlers.get('compile-bulletin');
}

function deniedConfigCtx(extra = {}) {
  const calls = { configGet: 0, warns: [] };
  const ctx = {
    logger: {
      warn(msg) { calls.warns.push(String(msg)); },
      info() {},
    },
    config: {
      async get() {
        calls.configGet += 1;
        throw new Error(DENIED);
      },
    },
    ...extra,
  };
  return { ctx, calls };
}

test.beforeEach(() => {
  __resetBulletinScopeBackoff();
  __resetCachedBulletinTz();
});

test('scheduled tick makes zero config.get calls and logs no config warning (companies.list ok, empty)', async () => {
  const { ctx, calls } = deniedConfigCtx({
    companies: { async list() { return []; } },
  });
  const job = register(ctx);
  for (let i = 0; i < 5; i += 1) await job();
  assert.equal(calls.configGet, 0, 'scheduled tick must not call ctx.config.get()');
  assert.ok(
    !calls.warns.some((w) => w.includes('config.get failed')),
    `no "config.get failed" warning expected, got: ${JSON.stringify(calls.warns)}`,
  );
});

test('scheduled tick makes zero config.get calls when companies.list fails too', async () => {
  const { ctx, calls } = deniedConfigCtx({
    companies: { async list() { throw new Error('boom'); } },
  });
  const job = register(ctx);
  for (let i = 0; i < 3; i += 1) await job();
  assert.equal(calls.configGet, 0);
});

test('cache: empty by default → undefined (computeNextDueAt default tz)', () => {
  assert.equal(getCachedBulletinTz(), undefined);
});

test('cache: host-pushed bulletinTimezone is honoured and trimmed', () => {
  setCachedBulletinConfig({ bulletinTimezone: '  America/New_York ' });
  assert.equal(getCachedBulletinTz(), 'America/New_York');
});

test('cache: a later push without a timezone clears back to default', () => {
  setCachedBulletinConfig({ bulletinTimezone: 'Europe/London' });
  setCachedBulletinConfig({});
  assert.equal(getCachedBulletinTz(), undefined);
  setCachedBulletinConfig({ bulletinTimezone: 'Europe/London' });
  setCachedBulletinConfig({ bulletinTimezone: '   ' });
  assert.equal(getCachedBulletinTz(), undefined);
  setCachedBulletinConfig({ bulletinTimezone: 42 });
  assert.equal(getCachedBulletinTz(), undefined);
  setCachedBulletinConfig(null);
  assert.equal(getCachedBulletinTz(), undefined);
});

test('scoped path unchanged: resolveBulletinTz still reads ctx.config.get()', async () => {
  let gets = 0;
  const tz = await resolveBulletinTz({
    config: { async get() { gets += 1; return { bulletinTimezone: 'Asia/Tokyo' }; } },
  });
  assert.equal(gets, 1);
  assert.equal(tz, 'Asia/Tokyo');
});

test('scoped path unchanged: resolveBulletinTz still falls back (undefined) + warns on denial', async () => {
  const { ctx, calls } = deniedConfigCtx();
  const tz = await resolveBulletinTz(ctx);
  assert.equal(tz, undefined);
  assert.equal(calls.configGet, 1);
  assert.ok(calls.warns.some((w) => w.includes('config.get failed')));
});

test('worker.ts wires onConfigChanged → setCachedBulletinConfig', () => {
  const src = readFileSync(new URL('../../../src/worker.ts', import.meta.url), 'utf8');
  assert.match(src, /async onConfigChanged\(newConfig\)\s*\{\s*setCachedBulletinConfig\(newConfig\);/);
});
