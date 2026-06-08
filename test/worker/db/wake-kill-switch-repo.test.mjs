// test/worker/db/wake-kill-switch-repo.test.mjs
//
// Phase 16.1 Plan 16.1-01 Task 3 (D-08) — unit tests for the durable,
// version-scoped, operator-clear-only wake kill-switch repo. Hand-rolled
// fake-ctx idiom: the fake `db` simulates the single-row-per-company
// wake_kill_switch table as an in-memory Map<company_id, row> driven off SQL
// regex. `engage` upserts (ON CONFLICT DO UPDATE); `isEngaged` reads
// version-scoped (plugin_version = $2) and fails open on a throwing query;
// `clear` is the only reset path (no auto-clear in worker code).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import manifest from '../../../src/manifest.ts';
import {
  isEngaged,
  engage,
  clear,
} from '../../../src/worker/db/wake-kill-switch-repo.ts';

const CURRENT_VERSION = manifest.version;

/**
 * Fake ctx whose db simulates wake_kill_switch as a Map keyed by company_id.
 * Each row = { engaged, engaged_at, reason, plugin_version }.
 *   SELECT engaged ... WHERE company_id=$1 AND plugin_version=$2 -> version-scoped read
 *   INSERT ... ON CONFLICT (company_id) DO UPDATE                -> atomic engage upsert
 *   UPDATE ... SET engaged=false WHERE company_id=$1            -> operator clear
 */
function makeCtx() {
  const table = new Map();
  const ctx = {
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/select\s+engaged/i.test(sql) && /wake_kill_switch/i.test(sql)) {
          const [companyId, pluginVersion] = params;
          const row = table.get(companyId);
          if (!row || row.plugin_version !== pluginVersion) return [];
          return [{ engaged: row.engaged }];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      async execute(sql, params) {
        if (/insert\s+into/i.test(sql) && /wake_kill_switch/i.test(sql)) {
          // params: [companyId, reason, pluginVersion]
          const [companyId, reason, pluginVersion] = params;
          table.set(companyId, {
            engaged: true,
            engaged_at: new Date(),
            reason,
            plugin_version: pluginVersion,
          });
          return { rowCount: 1 };
        }
        if (/update/i.test(sql) && /set\s+engaged\s*=\s*false/i.test(sql)) {
          const [companyId] = params;
          const row = table.get(companyId);
          if (row) row.engaged = false;
          return { rowCount: row ? 1 : 0 };
        }
        throw new Error(`unexpected execute: ${sql}`);
      },
    },
  };
  return { ctx, table };
}

test('wake-kill-switch: engage then isEngaged === true (same version)', async () => {
  const { ctx } = makeCtx();
  await engage(ctx, 'c1', 'rate exceeded');
  assert.equal(await isEngaged(ctx, 'c1'), true);
});

test('wake-kill-switch: isEngaged is false for a row of a different plugin_version', async () => {
  const { ctx, table } = makeCtx();
  // simulate a row tripped by a pre-fix build (stale version)
  table.set('c1', {
    engaged: true,
    engaged_at: new Date(),
    reason: 'old',
    plugin_version: '0.0.0-prefix',
  });
  assert.notEqual(CURRENT_VERSION, '0.0.0-prefix');
  assert.equal(
    await isEngaged(ctx, 'c1'),
    false,
    'a fixed build is not DOA on a pre-fix tripped switch (Open Q #3 = YES)',
  );
});

test('wake-kill-switch: clear resets engaged -> isEngaged === false', async () => {
  const { ctx } = makeCtx();
  await engage(ctx, 'c1', 'rate exceeded');
  assert.equal(await isEngaged(ctx, 'c1'), true);
  await clear(ctx, 'c1');
  assert.equal(await isEngaged(ctx, 'c1'), false);
});

test('wake-kill-switch: isEngaged fails open (false) when the query throws', async () => {
  const ctx = {
    db: {
      async query() {
        throw new Error('transient DB error');
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
  };
  assert.equal(
    await isEngaged(ctx, 'c1'),
    false,
    'a transient DB error never wedges dispatch (T-161-05 accept: fail-open)',
  );
});

test('wake-kill-switch: engage uses ON CONFLICT (company_id) DO UPDATE', async () => {
  let seenSql = '';
  const ctx = {
    db: {
      async query() {
        return [];
      },
      async execute(sql) {
        seenSql = sql;
        return { rowCount: 1 };
      },
    },
  };
  await engage(ctx, 'c1', 'rate exceeded');
  assert.match(seenSql, /on\s+conflict\s*\(company_id\)\s+do\s+update/i);
});
