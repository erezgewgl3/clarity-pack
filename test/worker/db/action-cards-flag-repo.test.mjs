// test/worker/db/action-cards-flag-repo.test.mjs
//
// Phase 19 Plan 19-01 Task 1 (D-01 / D-02) — unit proof for the runtime
// action-cards enablement flag repo. Models a fake ctx.db keyed off SQL regex
// (the makeStormCtx pattern from test/loop/storm-safety.test.mjs) so the
// assertions exercise the SHIPPED repo, not a re-implementation.
//
// Locked assertions:
//   (1) absent row              -> isActionCardsEnabled === false (D-02 default OFF).
//   (2) ctx.db.query throws     -> isActionCardsEnabled === false, never rejects
//                                   (D-02 degrade-safe — inverted polarity).
//   (3) row { enabled: true }   -> isActionCardsEnabled === true.
//   (4) row { enabled: false }  -> isActionCardsEnabled === false.
//   (5) the read SQL contains NO plugin_version filter (D-01 NOT-version-scoped).
//   (6) setActionCardsEnabled emits an INSERT ... ON CONFLICT (company_id)
//       DO UPDATE upsert with parameterized binds only.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  isActionCardsEnabled,
  setActionCardsEnabled,
} from '../../../src/worker/db/action-cards-flag-repo.ts';

const COMPANY = 'COU-1';

/**
 * Fake ctx whose db.query/execute simulate the action_cards_flag table off SQL
 * regex. `flagRow` is the row the SELECT returns (null = absent). `throwOnQuery`
 * forces the degrade-safe path. Captured SQL/params land on `seen` for the
 * version-scope + upsert-shape assertions.
 */
function makeFlagCtx({ flagRow = null, throwOnQuery = false } = {}) {
  const seen = { querySql: null, queryParams: null, execSql: null, execParams: null };
  const ctx = {
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        seen.querySql = sql;
        seen.queryParams = params;
        if (throwOnQuery) throw new Error('simulated unreadable flag row');
        if (/action_cards_flag/.test(sql)) {
          return flagRow ? [flagRow] : [];
        }
        return [];
      },
      async execute(sql, params) {
        seen.execSql = sql;
        seen.execParams = params;
        return { rowCount: 1 };
      },
    },
  };
  return { ctx, seen };
}

test('isActionCardsEnabled — absent row returns false (D-02 default OFF)', async () => {
  const { ctx } = makeFlagCtx({ flagRow: null });
  assert.equal(await isActionCardsEnabled(ctx, COMPANY), false);
});

test('isActionCardsEnabled — query throw returns false and never rejects (D-02 degrade-safe)', async () => {
  const { ctx } = makeFlagCtx({ throwOnQuery: true });
  // must resolve, not reject
  const result = await isActionCardsEnabled(ctx, COMPANY);
  assert.equal(result, false);
});

test('isActionCardsEnabled — row { enabled: true } returns true', async () => {
  const { ctx } = makeFlagCtx({ flagRow: { enabled: true } });
  assert.equal(await isActionCardsEnabled(ctx, COMPANY), true);
});

test('isActionCardsEnabled — row { enabled: false } returns false', async () => {
  const { ctx } = makeFlagCtx({ flagRow: { enabled: false } });
  assert.equal(await isActionCardsEnabled(ctx, COMPANY), false);
});

test('isActionCardsEnabled — read SQL has NO plugin_version filter (D-01 not version-scoped)', async () => {
  const { ctx, seen } = makeFlagCtx({ flagRow: { enabled: true } });
  await isActionCardsEnabled(ctx, COMPANY);
  assert.ok(seen.querySql, 'query was issued');
  assert.ok(/action_cards_flag/.test(seen.querySql), 'reads the flag table');
  assert.ok(
    !/plugin_version/i.test(seen.querySql),
    'the read MUST NOT filter on plugin_version (the ON state survives a version bump)',
  );
  // company_id is the sole predicate, parameterized
  assert.ok(/where\s+company_id\s*=\s*\$1/i.test(seen.querySql), 'company_id = $1 predicate');
  assert.deepEqual(seen.queryParams, [COMPANY], 'only the company id is bound');
});

test('setActionCardsEnabled — INSERT ... ON CONFLICT (company_id) DO UPDATE, parameterized', async () => {
  const { ctx, seen } = makeFlagCtx();
  await setActionCardsEnabled(ctx, COMPANY, true, 'eric-step2');
  assert.ok(seen.execSql, 'execute was issued');
  assert.ok(/insert\s+into[\s\S]*action_cards_flag/i.test(seen.execSql), 'INSERT into the flag table');
  assert.ok(/on\s+conflict\s*\(\s*company_id\s*\)\s+do\s+update/i.test(seen.execSql), 'upsert on UNIQUE(company_id)');
  assert.ok(!/plugin_version/i.test(seen.execSql), 'no plugin_version stamp (not version-scoped)');
  // parameterized binds only — no interpolated identifiers or literals for the flip
  assert.deepEqual(seen.execParams, [COMPANY, true, 'eric-step2']);
  assert.ok(/\$1/.test(seen.execSql) && /\$2/.test(seen.execSql) && /\$3/.test(seen.execSql), 'binds $1/$2/$3');
});

test('setActionCardsEnabled — OFF flip binds enabled=false (panic-OFF path)', async () => {
  const { ctx, seen } = makeFlagCtx();
  await setActionCardsEnabled(ctx, COMPANY, false, 'eric-panic');
  assert.deepEqual(seen.execParams, [COMPANY, false, 'eric-panic']);
});
