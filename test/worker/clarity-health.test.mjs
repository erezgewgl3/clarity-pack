// test/worker/clarity-health.test.mjs
//
// T1-D (no-rabbit-holes self-health, 2026-06-15) — the worker liveness probe.
// A dependency-free, opt-in-EXEMPT, zero-DB handler an ops probe can hit to
// detect a crashed/not-ready worker (the BEAAA blank-UI incident root class).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerClarityHealth,
  CLARITY_HEALTH_KEY,
} from '../../src/worker/handlers/clarity-health.ts';

function makeCtx() {
  const handlers = new Map();
  return {
    _handlers: handlers,
    data: { register: (key, fn) => handlers.set(key, fn) },
  };
}

test('clarity-health: registers under the clarity-pack/health key', () => {
  const ctx = makeCtx();
  registerClarityHealth(ctx);
  assert.equal(CLARITY_HEALTH_KEY, 'clarity-pack/health');
  assert.equal(typeof ctx._handlers.get('clarity-pack/health'), 'function');
});

test('clarity-health: returns { ok: true, ts } — a liveness signal', async () => {
  const ctx = makeCtx();
  registerClarityHealth(ctx);
  const result = await ctx._handlers.get('clarity-pack/health')({});
  assert.equal(result.ok, true);
  assert.equal(typeof result.ts, 'number');
});

test('clarity-health: answers regardless of opt-in (no userId / no prefs lookup)', async () => {
  // The probe is registered DIRECTLY (not through wrapDataHandler), so it never
  // touches the prefs table and never short-circuits to OPT_IN_REQUIRED. Empty
  // params (no userId) must still return ok.
  const ctx = makeCtx();
  registerClarityHealth(ctx);
  const result = await ctx._handlers.get('clarity-pack/health')({});
  assert.equal(result.error, undefined, 'liveness probe must not be opt-in gated');
  assert.equal(result.ok, true);
});
