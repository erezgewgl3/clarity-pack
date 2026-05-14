// test/worker/opt-in-guard.test.mjs
//
// Plan 02-04 Task 1 RED — opt-in-guard wraps every non-exempt data/action
// handler so opted-out callers receive {error: 'OPT_IN_REQUIRED'} BEFORE the
// inner handler logic runs. This protects the same-origin trust model where
// UI gating alone is insufficient (PITFALLS.md #5).
//
// DEVIATION FROM PLAN: The plan called for ctx.host.currentUserId — but
// PluginContext has no `host` field per the SDK types.d.ts and the
// 02-03b-API-SHAPES.md Section 5 finding. Following the 02-03b convention,
// the wrap reads `userId` from the handler's params (the UI passes it via
// useHostContext().userId in usePluginData). The wrap-fn requires the inner
// handler to accept `{ userId, ... }` and the guard re-uses that field.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  wrapDataHandler,
  wrapActionHandler,
  EXEMPT_HANDLER_KEYS,
} from '../../src/worker/opt-in-guard.ts';

// ---------------------------------------------------------------------------
// Shared ctx scaffolding mirroring the REAL SDK PluginDatabaseClient + Data +
// Actions shapes (T[] query return; not {rows: T[]}; see 02-03b §6).
// ---------------------------------------------------------------------------

function makeCtx({ optedInUserIds = new Set() } = {}) {
  const dataRegistry = new Map();
  const actionRegistry = new Map();
  const dbCalls = [];
  return {
    ctx: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      data: {
        register(key, fn) {
          dataRegistry.set(key, fn);
        },
      },
      actions: {
        register(key, fn) {
          actionRegistry.set(key, fn);
        },
      },
      db: {
        namespace: 'plugin_clarity_pack_cdd6bda4bd',
        async query(sql, params) {
          dbCalls.push({ sql, params });
          if (/clarity_user_prefs/.test(sql)) {
            const uid = params?.[0];
            if (optedInUserIds.has(uid)) {
              return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
            }
            return [];
          }
          return [];
        },
        async execute() {
          return { rowCount: 0 };
        },
      },
    },
    dataRegistry,
    actionRegistry,
    dbCalls,
  };
}

// ---------------------------------------------------------------------------
// Data handler wrap
// ---------------------------------------------------------------------------

test('wrapDataHandler — opted-out caller (no row) gets {error:OPT_IN_REQUIRED} and inner fn is NOT invoked', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set() });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'situation.snapshot', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0, 'inner fn must NOT run for opted-out users');
});

test('wrapDataHandler — caller with opted_in_at NULL gets {error:OPT_IN_REQUIRED}', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set() });
  // override query to return a row with opted_in_at = null
  ctx.db.query = async (sql, params) => {
    if (/clarity_user_prefs/.test(sql)) return [{ opted_in_at: null }];
    return [];
  };
  let innerCalls = 0;
  wrapDataHandler(ctx, 'situation.snapshot', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0);
});

test('wrapDataHandler — opted-in caller has inner fn invoked, result forwarded', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set(['eric']) });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'situation.snapshot', async () => {
    innerCalls += 1;
    return { ok: true, payload: [1, 2, 3] };
  });
  const handler = dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: 'eric' });
  assert.equal(innerCalls, 1);
  assert.deepEqual(result, { ok: true, payload: [1, 2, 3] });
});

test('wrapDataHandler — missing userId param returns {error:OPT_IN_REQUIRED} (cannot identify caller = treat as opted out)', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set(['eric']) });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'situation.snapshot', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = dataRegistry.get('situation.snapshot');
  const result = await handler({});
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0);
});

// ---------------------------------------------------------------------------
// Action handler wrap
// ---------------------------------------------------------------------------

test('wrapActionHandler — opted-out caller gets {error:OPT_IN_REQUIRED}; inner fn NOT invoked', async () => {
  const { ctx, actionRegistry } = makeCtx({ optedInUserIds: new Set() });
  let innerCalls = 0;
  wrapActionHandler(ctx, 'ac-toggle', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = actionRegistry.get('ac-toggle');
  const result = await handler({ userId: 'eric', id: 1, checked: true });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0);
});

test('wrapActionHandler — opted-in caller forwards inner fn result', async () => {
  const { ctx, actionRegistry } = makeCtx({ optedInUserIds: new Set(['eric']) });
  wrapActionHandler(ctx, 'ac-toggle', async (params) => ({ ok: true, gotId: params.id }));
  const handler = actionRegistry.get('ac-toggle');
  const result = await handler({ userId: 'eric', id: 42, checked: true });
  assert.deepEqual(result, { ok: true, gotId: 42 });
});

// ---------------------------------------------------------------------------
// Exempt handlers (get-opt-in, set-opt-in, clarity-pack/get-instance-config)
// ---------------------------------------------------------------------------

test('EXEMPT_HANDLER_KEYS contains the three boot-time / self-prefs keys', () => {
  assert.ok(EXEMPT_HANDLER_KEYS instanceof Set, 'EXEMPT_HANDLER_KEYS is a Set');
  assert.ok(EXEMPT_HANDLER_KEYS.has('get-opt-in'));
  assert.ok(EXEMPT_HANDLER_KEYS.has('set-opt-in'));
  assert.ok(EXEMPT_HANDLER_KEYS.has('clarity-pack/get-instance-config'));
});

test('wrapDataHandler — exempt key get-opt-in invokes inner fn for opted-out caller (no prefs row)', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set() });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'get-opt-in', async () => {
    innerCalls += 1;
    return { optedInAt: null };
  });
  const handler = dataRegistry.get('get-opt-in');
  const result = await handler({ userId: 'eric' });
  assert.equal(innerCalls, 1, 'exempt handler must run for opted-out user (so they can READ their state)');
  assert.deepEqual(result, { optedInAt: null });
});

test('wrapActionHandler — exempt key set-opt-in runs for opted-out caller (so they can toggle ON)', async () => {
  const { ctx, actionRegistry } = makeCtx({ optedInUserIds: new Set() });
  let innerCalls = 0;
  wrapActionHandler(ctx, 'set-opt-in', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = actionRegistry.get('set-opt-in');
  const result = await handler({ userId: 'eric', optedInAt: '2026-05-14T08:00:00Z' });
  assert.equal(innerCalls, 1);
  assert.deepEqual(result, { ok: true });
});

test('wrapDataHandler — exempt key clarity-pack/get-instance-config runs for opted-out caller (boot-time config read)', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set() });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'clarity-pack/get-instance-config', async () => {
    innerCalls += 1;
    return { situationRefreshIntervalMs: 60000 };
  });
  const handler = dataRegistry.get('clarity-pack/get-instance-config');
  const result = await handler({});
  assert.equal(innerCalls, 1, 'instance-config is boot-time and MUST be readable even when opted-out');
  assert.deepEqual(result, { situationRefreshIntervalMs: 60000 });
});
