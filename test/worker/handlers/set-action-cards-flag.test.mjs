// test/worker/handlers/set-action-cards-flag.test.mjs
//
// Phase 19 Plan 19-04 Task 1 (CARD-03 / D-08 / T-19-11 / T-19-13) — the
// set-action-cards-flag operator RPC. A clone of set-opt-in.ts: it flips the
// action-cards runtime flag ON/OFF via the parameterized namespaced UPSERT in
// action-cards-flag-repo.ts (setActionCardsEnabled). BEAAA has NO psql on the
// box (memory beaaa-deploy-mechanics), so the Step-2 ON-flip AND the panic-OFF
// must both be RPC gestures, not shell. This is the redeploy-free flip.
//
// Assertions:
//   (1) {companyId, enabled:true, setBy} performs the ON UPSERT
//       (INSERT ... ON CONFLICT ... DO UPDATE SET enabled=$2) — assert SQL+params.
//   (2) {companyId, enabled:false} performs the OFF write (enabled bound false).
//   (3) missing/invalid companyId throws a clear param error (mirrors the
//       set-opt-in userId guard) — and refuses to write.
//   (4) invalid enabled (non-boolean) throws a clear param error.
//   (5) the write is PARAMETERIZED (no identifier interpolation): companyId/
//       enabled/setBy flow through $1/$2/$3 binds, routed via setActionCardsEnabled.
//   (6) setBy defaults to 'operator' when omitted (the handler never writes an
//       unattributed flip).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSetActionCardsFlag } from '../../../src/worker/handlers/set-action-cards-flag.ts';

function makeCtx() {
  const actionRegistry = new Map();
  const dbCalls = [];
  let flagRow = null;
  return {
    ctx: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      actions: { register(k, fn) { actionRegistry.set(k, fn); } },
      db: {
        namespace: 'plugin_clarity_pack_cdd6bda4bd',
        async query(sql, params) {
          dbCalls.push({ kind: 'query', sql, params });
          return [];
        },
        async execute(sql, params) {
          dbCalls.push({ kind: 'execute', sql, params });
          if (/action_cards_flag/.test(sql) && /INSERT/i.test(sql)) {
            flagRow = { company_id: params[0], enabled: params[1], set_by: params[2] };
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        },
      },
    },
    actionRegistry,
    dbCalls,
    getFlagRow: () => flagRow,
  };
}

test('set-action-cards-flag — ON: {companyId, enabled:true} routes the parameterized UPSERT (enabled bound true)', async () => {
  const bag = makeCtx();
  registerSetActionCardsFlag(bag.ctx);
  const handler = bag.actionRegistry.get('set-action-cards-flag');
  const result = await handler({ companyId: 'c1', enabled: true, setBy: 'eric-step2' });
  assert.equal(result.companyId, 'c1');
  assert.equal(result.enabled, true);
  const executes = bag.dbCalls.filter((c) => c.kind === 'execute');
  assert.equal(executes.length, 1, 'exactly one write');
  assert.match(
    executes[0].sql,
    /INSERT INTO plugin_clarity_pack_cdd6bda4bd\.action_cards_flag/,
    'writes the namespaced flag table',
  );
  assert.match(executes[0].sql, /ON CONFLICT.*company_id.*DO UPDATE/is, 'atomic upsert');
  // Parameterized: no identifier interpolation — companyId/enabled/setBy are binds.
  assert.equal(executes[0].params[0], 'c1');
  assert.equal(executes[0].params[1], true);
  assert.equal(executes[0].params[2], 'eric-step2');
  const row = bag.getFlagRow();
  assert.equal(row.enabled, true, 'ON write binds enabled=true');
});

test('set-action-cards-flag — OFF (panic): {companyId, enabled:false} binds enabled=false', async () => {
  const bag = makeCtx();
  registerSetActionCardsFlag(bag.ctx);
  const handler = bag.actionRegistry.get('set-action-cards-flag');
  const result = await handler({ companyId: 'c1', enabled: false, setBy: 'panic' });
  assert.equal(result.enabled, false);
  const executes = bag.dbCalls.filter((c) => c.kind === 'execute');
  assert.equal(executes[0].params[1], false, 'OFF write binds enabled=false');
  const row = bag.getFlagRow();
  assert.equal(row.enabled, false);
});

test('set-action-cards-flag — setBy defaults to "operator" when omitted', async () => {
  const bag = makeCtx();
  registerSetActionCardsFlag(bag.ctx);
  const handler = bag.actionRegistry.get('set-action-cards-flag');
  await handler({ companyId: 'c1', enabled: true });
  const row = bag.getFlagRow();
  assert.equal(row.set_by, 'operator', 'unattributed flip is recorded as "operator", never blank');
});

test('set-action-cards-flag — throws if companyId is missing (no target = refuse to write)', async () => {
  const bag = makeCtx();
  registerSetActionCardsFlag(bag.ctx);
  const handler = bag.actionRegistry.get('set-action-cards-flag');
  await assert.rejects(
    () => handler({ enabled: true }),
    /companyId required/,
  );
  assert.equal(bag.dbCalls.filter((c) => c.kind === 'execute').length, 0, 'no write on a bad param');
});

test('set-action-cards-flag — throws if companyId is the empty string', async () => {
  const bag = makeCtx();
  registerSetActionCardsFlag(bag.ctx);
  const handler = bag.actionRegistry.get('set-action-cards-flag');
  await assert.rejects(
    () => handler({ companyId: '', enabled: true }),
    /companyId required/,
  );
});

test('set-action-cards-flag — throws if enabled is not a boolean', async () => {
  const bag = makeCtx();
  registerSetActionCardsFlag(bag.ctx);
  const handler = bag.actionRegistry.get('set-action-cards-flag');
  await assert.rejects(
    () => handler({ companyId: 'c1', enabled: 'yes' }),
    /enabled must be a boolean/,
  );
  assert.equal(bag.dbCalls.filter((c) => c.kind === 'execute').length, 0, 'no write on a bad param');
});
