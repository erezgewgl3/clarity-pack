// test/worker/db/wake-ledger-repo.test.mjs
//
// Phase 16.1 Plan 16.1-01 Task 2 (D-06) — unit tests for the sliding-window
// wake ledger repo. Hand-rolled fake-ctx idiom: the fake `db` simulates
// wake_ledger as an in-memory array of { company_id, woke_at } rows driven off
// SQL regex. `appendWake` adds a row; `countTrailingWakes` counts rows newer
// than the window; `pruneOldWakes` deletes rows older than the window.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  appendWake,
  countTrailingWakes,
  pruneOldWakes,
} from '../../../src/worker/db/wake-ledger-repo.ts';

/**
 * Fake ctx whose db simulates wake_ledger as an array of timestamps.
 * The window param is `($N || ' seconds')::interval` — the fake reads the
 * numeric window from params and applies a real Date cutoff so the windowed
 * count and prune behave like Postgres now() - interval.
 */
function makeCtx() {
  const rows = []; // { company_id, woke_at: Date }
  const ctx = {
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/count\(\*\)/i.test(sql) && /wake_ledger/i.test(sql)) {
          const [companyId, windowSeconds] = params;
          const cutoff = Date.now() - Number(windowSeconds) * 1000;
          const n = rows.filter(
            (r) => r.company_id === companyId && r.woke_at.getTime() > cutoff,
          ).length;
          return [{ n: String(n) }]; // pg count(*) comes back as a string
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      async execute(sql, params) {
        if (/insert\s+into/i.test(sql) && /wake_ledger/i.test(sql)) {
          const [companyId] = params;
          rows.push({ company_id: companyId, woke_at: new Date() });
          return { rowCount: 1 };
        }
        if (/delete\s+from/i.test(sql) && /wake_ledger/i.test(sql)) {
          const [windowSeconds] = params;
          const cutoff = Date.now() - Number(windowSeconds) * 1000;
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i].woke_at.getTime() < cutoff) rows.splice(i, 1);
          }
          return { rowCount: before - rows.length };
        }
        throw new Error(`unexpected execute: ${sql}`);
      },
    },
  };
  return { ctx, rows };
}

test('wake-ledger: append x3 within window -> countTrailingWakes === 3', async () => {
  const { ctx } = makeCtx();
  await appendWake(ctx, 'c1');
  await appendWake(ctx, 'c1');
  await appendWake(ctx, 'c1');
  assert.equal(await countTrailingWakes(ctx, 'c1', 60), 3);
});

test('wake-ledger: count is company-scoped', async () => {
  const { ctx } = makeCtx();
  await appendWake(ctx, 'c1');
  await appendWake(ctx, 'c2');
  assert.equal(await countTrailingWakes(ctx, 'c1', 60), 1);
  assert.equal(await countTrailingWakes(ctx, 'c2', 60), 1);
});

test('wake-ledger: countTrailingWakes returns 0 for an empty ledger', async () => {
  const { ctx } = makeCtx();
  assert.equal(await countTrailingWakes(ctx, 'c1', 60), 0);
});

test('wake-ledger: pruneOldWakes deletes rows older than the window', async () => {
  const { ctx, rows } = makeCtx();
  // seed an old row directly + a fresh one via append
  rows.push({ company_id: 'c1', woke_at: new Date(Date.now() - 120 * 1000) });
  await appendWake(ctx, 'c1');
  assert.equal(rows.length, 2);
  await pruneOldWakes(ctx, 60);
  assert.equal(rows.length, 1, 'the 120s-old row is pruned, the fresh one survives');
});

test('wake-ledger: pruneOldWakes DELETE targets woke_at older than the interval', async () => {
  let seenSql = '';
  const ctx = {
    db: {
      async query() {
        return [{ n: '0' }];
      },
      async execute(sql) {
        seenSql = sql;
        return { rowCount: 0 };
      },
    },
  };
  await pruneOldWakes(ctx, 60);
  assert.match(seenSql, /delete\s+from/i);
  assert.match(seenSql, /woke_at\s*<\s*now\(\)\s*-/i);
  assert.match(seenSql, /seconds.*::interval/i);
});
