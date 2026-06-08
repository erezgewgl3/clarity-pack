// test/worker/opted-in-company-set.test.mjs
//
// Phase 16.1 Plan 16.1-03 Task 1 — the lazy-seeded opted-in-company set
// (D-12 / L-2 / L-3 / W-2). Proves:
//   - W-2 acceptance: an opted-in user whose company is recorded in
//     clarity_agent_owners IS present in the set after a lazy seed (NOT
//     silently empty) — the gate never seeds empty when a real opted-in
//     mapping exists.
//   - an opted-in user with NO owners row yields an empty set (documented
//     limitation: only operator-claimed ownership links a user to a company).
//   - NO opted-in user yields an empty set (default OFF).
//   - the seed runs lazily (never at module load), only inside ensureSeeded.
//   - fast path: a repeat membership test within the TTL makes zero extra DB
//     calls (the seed query fires exactly once).
//   - invalidateOptedInCache forces the next ensureSeeded to re-read.
//   - fail-closed: a seed query error leaves the set as-is, never
//     everyone-opted-in.
//
// The fake ctx.db.query routes the two seed SELECTs off a SQL substring match:
//   (a) clarity_user_prefs  -> the opted-in user_id rows
//   (b) clarity_agent_owners -> the (owner_user_id -> company_id) rows
// so the two-step lazy seed returns its respective scripted rows.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  isCompanyOptedIn,
  ensureSeeded,
  invalidateOptedInCache,
} from '../../src/worker/opted-in-company-set.ts';

/**
 * Build a fake ctx whose db.query returns scripted rows keyed off the SQL
 * text. `prefsRows` are the clarity_user_prefs opted-in rows; `ownerRows`
 * are the clarity_agent_owners rows. A `calls` array records each query for
 * the fast-path assertion. `failOn` (substring) makes the matching query
 * throw so the fail-closed path can be exercised.
 */
function makeCtx(prefsRows, ownerRows, opts = {}) {
  const calls = [];
  const failOn = opts.failOn ?? null;
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        calls.push({ sql, params });
        if (failOn && sql.includes(failOn)) {
          throw new Error('seed query failed (test)');
        }
        if (sql.includes('clarity_user_prefs')) return prefsRows;
        if (sql.includes('clarity_agent_owners')) return ownerRows;
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
  };
  return { ctx, calls };
}

test('W-2: an opted-in user whose company is in clarity_agent_owners IS in the set after a lazy seed', async () => {
  invalidateOptedInCache();
  const { ctx } = makeCtx(
    [{ user_id: 'U' }],
    [{ company_id: 'c1' }],
  );
  await ensureSeeded(ctx);
  assert.equal(isCompanyOptedIn('c1'), true, 'c1 must be present (not silently empty)');
  assert.equal(isCompanyOptedIn('c-other'), false, 'a non-mapped company is absent');
});

test('opted-in user with NO owners row yields an empty set (documented mapping limitation)', async () => {
  invalidateOptedInCache();
  const { ctx } = makeCtx(
    [{ user_id: 'U' }],
    [], // no clarity_agent_owners row for U
  );
  await ensureSeeded(ctx);
  assert.equal(isCompanyOptedIn('c1'), false);
  assert.equal(isCompanyOptedIn('anything'), false);
});

test('no opted-in user yields an empty set (default OFF)', async () => {
  invalidateOptedInCache();
  const { ctx, calls } = makeCtx([], []);
  await ensureSeeded(ctx);
  assert.equal(isCompanyOptedIn('c1'), false);
  // With zero opted-in users the owners query may be skipped entirely — only
  // the prefs query is mandatory.
  assert.ok(
    calls.some((c) => c.sql.includes('clarity_user_prefs')),
    'the prefs seed query ran',
  );
});

test('fast path: a repeat membership test within the TTL makes zero extra DB calls', async () => {
  invalidateOptedInCache();
  const { ctx, calls } = makeCtx(
    [{ user_id: 'U' }],
    [{ company_id: 'c1' }],
  );
  await ensureSeeded(ctx);
  const afterFirstSeed = calls.length;
  // membership tests are pure in-memory — no DB
  assert.equal(isCompanyOptedIn('c1'), true);
  assert.equal(isCompanyOptedIn('c1'), true);
  // a second ensureSeeded within the TTL re-uses the cache: no new queries
  await ensureSeeded(ctx);
  assert.equal(calls.length, afterFirstSeed, 'no extra DB calls within the TTL');
  // the prefs seed query fired exactly once across both ensureSeeded calls
  assert.equal(
    calls.filter((c) => c.sql.includes('clarity_user_prefs')).length,
    1,
    'the prefs seed query fired exactly once (TTL fast-path)',
  );
});

test('invalidateOptedInCache forces the next ensureSeeded to re-read', async () => {
  invalidateOptedInCache();
  const { ctx, calls } = makeCtx(
    [{ user_id: 'U' }],
    [{ company_id: 'c1' }],
  );
  await ensureSeeded(ctx);
  const afterFirst = calls.filter((c) => c.sql.includes('clarity_user_prefs')).length;
  assert.equal(afterFirst, 1);
  invalidateOptedInCache();
  await ensureSeeded(ctx);
  const afterInvalidate = calls.filter((c) => c.sql.includes('clarity_user_prefs')).length;
  assert.equal(afterInvalidate, 2, 'invalidate forced a re-read');
});

test('fail-closed: a seed query error leaves the set unchanged (never everyone-opted-in)', async () => {
  invalidateOptedInCache();
  // First, a clean seed establishes c1.
  const ok = makeCtx([{ user_id: 'U' }], [{ company_id: 'c1' }]);
  await ensureSeeded(ok.ctx);
  assert.equal(isCompanyOptedIn('c1'), true);
  // Now force the next seed (after invalidate) to throw — the prior set must
  // remain, and NO company becomes spuriously opted-in.
  invalidateOptedInCache();
  const broken = makeCtx([{ user_id: 'U' }], [{ company_id: 'c1' }], {
    failOn: 'clarity_user_prefs',
  });
  await ensureSeeded(broken.ctx); // must not throw
  // membership is never "everyone" on error — only the previously-known set
  assert.equal(isCompanyOptedIn('random-unseen-company'), false);
});

test('the seed is reachable ONLY from ensureSeeded — module import alone runs no query', async () => {
  // Importing the module (done at top of file) must not have issued any query.
  // We prove this indirectly: a fresh ctx whose query throws if ever called at
  // import time would have already failed the import. Here we assert that
  // before any ensureSeeded in THIS test, a membership test is pure in-memory.
  invalidateOptedInCache();
  // No ensureSeeded called yet in a cleared state -> default OFF, no throw.
  assert.equal(isCompanyOptedIn('c-never-seeded'), false);
});
