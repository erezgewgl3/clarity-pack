// test/worker/set-opt-in.test.mjs
//
// Plan 02-04 Task 1 RED — set-opt-in handler writes ONLY current user's row
// (OPTIN-03). The handler reads userId from params.userId (the UI sends it
// via useHostContext().userId in usePluginAction), NOT from a fictional
// ctx.host.currentUserId — see DEVIATION note in opt-in-guard.test.mjs.
//
// The handler MUST ignore any other userId-like parameter the caller might
// try to pass (e.g. targetUserId, otherUser, etc.) — OPTIN-03 attack model:
// userA must NOT be able to write userB's prefs row.
//
// get-opt-in handler reads the caller's own prefs (or returns the default
// "opted-out + classic landing" shape when no row exists).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerGetOptIn } from '../../src/worker/handlers/get-opt-in.ts';
import { registerSetOptIn } from '../../src/worker/handlers/set-opt-in.ts';

function makeCtx() {
  const dataRegistry = new Map();
  const actionRegistry = new Map();
  const dbCalls = [];
  let prefsRow = null;
  return {
    ctx: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      data: { register(k, fn) { dataRegistry.set(k, fn); } },
      actions: { register(k, fn) { actionRegistry.set(k, fn); } },
      db: {
        namespace: 'plugin_clarity_pack_cdd6bda4bd',
        async query(sql, params) {
          dbCalls.push({ kind: 'query', sql, params });
          if (/clarity_user_prefs/.test(sql) && /SELECT/i.test(sql)) {
            const uid = params?.[0];
            if (prefsRow && prefsRow.user_id === uid) return [prefsRow];
            return [];
          }
          return [];
        },
        async execute(sql, params) {
          dbCalls.push({ kind: 'execute', sql, params });
          if (/clarity_user_prefs/.test(sql) && /INSERT/i.test(sql)) {
            prefsRow = {
              user_id: params[0],
              opted_in_at: params[1],
              default_landing: 'classic',
            };
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        },
      },
    },
    dataRegistry,
    actionRegistry,
    dbCalls,
    getPrefsRow: () => prefsRow,
  };
}

// ---------------------------------------------------------------------------
// set-opt-in
// ---------------------------------------------------------------------------

test('set-opt-in — writes row for params.userId only; SQL uses INSERT...ON CONFLICT', async () => {
  const bag = makeCtx();
  registerSetOptIn(bag.ctx);
  const handler = bag.actionRegistry.get('set-opt-in');
  const result = await handler({ userId: 'eric', optedInAt: '2026-05-14T08:00:00Z' });
  assert.equal(result.userId, 'eric');
  assert.equal(result.optedInAt, '2026-05-14T08:00:00Z');
  const executes = bag.dbCalls.filter((c) => c.kind === 'execute');
  assert.equal(executes.length, 1);
  assert.match(executes[0].sql, /INSERT INTO plugin_clarity_pack_cdd6bda4bd\.clarity_user_prefs/);
  assert.match(executes[0].sql, /ON CONFLICT.*user_id.*DO UPDATE/i);
  assert.deepEqual(executes[0].params, ['eric', '2026-05-14T08:00:00Z']);
});

test('set-opt-in — OPTIN-03 attack model: caller cannot write another user (params.userId is the ONLY identity)', async () => {
  // The attacker passes userId='attacker' but also tries to spoof targetUserId='victim'.
  // The handler MUST ignore everything except its declared userId param —
  // i.e. the row written has user_id='attacker', NOT 'victim'.
  const bag = makeCtx();
  registerSetOptIn(bag.ctx);
  const handler = bag.actionRegistry.get('set-opt-in');
  await handler({
    userId: 'attacker',
    optedInAt: '2026-05-14T08:00:00Z',
    targetUserId: 'victim', // attempted attack vector
    user_id: 'victim',
    forUser: 'victim',
  });
  const row = bag.getPrefsRow();
  assert.equal(row.user_id, 'attacker', 'must write caller-userId, NOT a spoofed target field');
});

test('set-opt-in — optedInAt:null writes null (toggle OFF)', async () => {
  const bag = makeCtx();
  registerSetOptIn(bag.ctx);
  const handler = bag.actionRegistry.get('set-opt-in');
  const result = await handler({ userId: 'eric', optedInAt: null });
  assert.equal(result.optedInAt, null);
  const row = bag.getPrefsRow();
  assert.equal(row.opted_in_at, null);
});

test('set-opt-in — throws if optedInAt is not ISO string or null', async () => {
  const bag = makeCtx();
  registerSetOptIn(bag.ctx);
  const handler = bag.actionRegistry.get('set-opt-in');
  await assert.rejects(
    () => handler({ userId: 'eric', optedInAt: 42 }),
    /optedInAt must be ISO string or null/,
  );
});

test('set-opt-in — throws if userId is missing (no caller identity = refuse to write)', async () => {
  const bag = makeCtx();
  registerSetOptIn(bag.ctx);
  const handler = bag.actionRegistry.get('set-opt-in');
  await assert.rejects(
    () => handler({ optedInAt: '2026-05-14T08:00:00Z' }),
    /userId required/,
  );
});

// ---------------------------------------------------------------------------
// get-opt-in
// ---------------------------------------------------------------------------

test('get-opt-in — returns {userId, optedInAt:null, defaultLanding:"classic"} when no row exists (default opted-out per OPTIN-01)', async () => {
  const bag = makeCtx();
  registerGetOptIn(bag.ctx);
  const handler = bag.dataRegistry.get('get-opt-in');
  const result = await handler({ userId: 'eric' });
  assert.deepEqual(result, {
    userId: 'eric',
    optedInAt: null,
    defaultLanding: 'classic',
  });
});

test('get-opt-in — returns row when present', async () => {
  const bag = makeCtx();
  registerSetOptIn(bag.ctx); // populates prefsRow
  const setHandler = bag.actionRegistry.get('set-opt-in');
  await setHandler({ userId: 'eric', optedInAt: '2026-05-14T08:00:00Z' });

  registerGetOptIn(bag.ctx);
  const handler = bag.dataRegistry.get('get-opt-in');
  const result = await handler({ userId: 'eric' });
  assert.equal(result.userId, 'eric');
  assert.equal(result.optedInAt, '2026-05-14T08:00:00Z');
  assert.equal(result.defaultLanding, 'classic');
});

test('get-opt-in — throws if userId is missing', async () => {
  const bag = makeCtx();
  registerGetOptIn(bag.ctx);
  const handler = bag.dataRegistry.get('get-opt-in');
  await assert.rejects(
    () => handler({}),
    /userId required/,
  );
});
