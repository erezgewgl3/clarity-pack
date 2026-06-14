// test/worker/db/tldr-bodies-batch.test.mjs
//
// Plan 18-03 Task 1 (LEG-03) — unit tests for getTldrBodiesByScopeIds, the
// BATCHED tldr_cache read behind the SR-row "Looks done — close it?" flag.
//
// The acceptance the SPEC pins (line 82) is a QUERY-COUNT proof: the needs-you
// done-flag read must be O(1) queries (one `= ANY`), never O(rows). So the fake
// `db` here COUNTS every query() call:
//   - empty scopeIds   → ZERO queries (short-circuit; no `= ANY('{}')`)
//   - non-empty set     → EXACTLY ONE query, returning the DISTINCT-ON most-
//                         recent body per scope_id.
//
// Hand-rolled fake-ctx idiom (mirrors wake-ledger-repo.test.mjs): the fake db
// simulates tldr_cache as an in-memory array and answers the `= ANY` SELECT by
// parsing the bound text[] literal.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  getTldrBodiesByScopeIds,
  toPgTextArrayLiteral,
} from '../../../src/worker/db/tldr-cache.ts';

/**
 * Fake ctx whose db simulates tldr_cache rows and counts queries.
 * Seed rows are { surface, scope_id, body, generated_at: Date }.
 * The `= ANY($2::text[])` SELECT is answered by parsing the array-literal the
 * caller bound (toPgTextArrayLiteral) back into a Set of scope_ids, then
 * returning the most-recent body per matching scope_id (DISTINCT ON emulation).
 */
function makeCtx(seed) {
  const rows = seed.slice();
  let queryCount = 0;
  const ctx = {
    db: {
      async query(sql, params) {
        queryCount += 1;
        assert.match(sql, /tldr_cache/i, 'query hits tldr_cache');
        assert.match(sql, /=\s*ANY\s*\(\s*\$2::text\[\]\s*\)/i, 'uses = ANY($2::text[]) batch form');
        assert.match(sql, /DISTINCT ON \(scope_id\)/i, 'uses DISTINCT ON (scope_id) for most-recent-per-scope');
        const [surface, literal] = params;
        // Parse the bound array-literal {"a","b"} back into scope_ids.
        const inner = String(literal).replace(/^\{|\}$/g, '');
        const wanted = new Set(
          inner.length === 0
            ? []
            : inner.split(',').map((s) => s.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\')),
        );
        // Most-recent body per scope_id among matching surface + wanted ids.
        const latest = new Map(); // scope_id -> { body, at }
        for (const r of rows) {
          if (r.surface !== surface) continue;
          if (!wanted.has(r.scope_id)) continue;
          const at = r.generated_at.getTime();
          const cur = latest.get(r.scope_id);
          if (!cur || at > cur.at) latest.set(r.scope_id, { body: r.body, at });
        }
        return [...latest.entries()].map(([scope_id, v]) => ({ scope_id, body: v.body }));
      },
    },
    get __queryCount() {
      return queryCount;
    },
  };
  return ctx;
}

test('getTldrBodiesByScopeIds — empty input → empty Map, ZERO queries (O(1) acceptance)', async () => {
  const ctx = makeCtx([]);
  const out = await getTldrBodiesByScopeIds(ctx, 'issue', []);
  assert.equal(out.size, 0, 'empty Map');
  assert.equal(ctx.__queryCount, 0, 'NO query issued on the empty needs-you set');
});

test('getTldrBodiesByScopeIds — non-empty set → EXACTLY ONE query (O(1), not O(rows))', async () => {
  const ctx = makeCtx([
    { surface: 'issue', scope_id: 'a', body: 'old A', generated_at: new Date('2026-06-01T00:00:00Z') },
    { surface: 'issue', scope_id: 'a', body: 'new A is done', generated_at: new Date('2026-06-10T00:00:00Z') },
    { surface: 'issue', scope_id: 'b', body: 'B is complete', generated_at: new Date('2026-06-05T00:00:00Z') },
    { surface: 'issue', scope_id: 'c', body: 'C unrelated', generated_at: new Date('2026-06-05T00:00:00Z') },
  ]);
  const out = await getTldrBodiesByScopeIds(ctx, 'issue', ['a', 'b']);
  assert.equal(ctx.__queryCount, 1, 'EXACTLY ONE query for the whole set (O(1), not per-row)');
  assert.equal(out.size, 2, 'one body per requested scope_id that has a cached row');
  // DISTINCT ON → the MOST-RECENT body per scope_id.
  assert.equal(out.get('a'), 'new A is done', 'most-recent body for scope a');
  assert.equal(out.get('b'), 'B is complete', 'body for scope b');
  // 'c' was not requested → absent.
  assert.equal(out.has('c'), false, 'un-requested scope is absent');
});

test('getTldrBodiesByScopeIds — a requested scope with no cached row is simply absent (degrade-ready)', async () => {
  const ctx = makeCtx([
    { surface: 'issue', scope_id: 'a', body: 'A is done', generated_at: new Date('2026-06-10T00:00:00Z') },
  ]);
  const out = await getTldrBodiesByScopeIds(ctx, 'issue', ['a', 'missing']);
  assert.equal(ctx.__queryCount, 1, 'still exactly one query');
  assert.equal(out.get('a'), 'A is done');
  assert.equal(out.has('missing'), false, 'no cached row → absent from Map');
});

test('getTldrBodiesByScopeIds — surface scoping: an issue-surface read ignores a same-id situation row', async () => {
  const ctx = makeCtx([
    { surface: 'situation', scope_id: 'a', body: 'situation body', generated_at: new Date('2026-06-10T00:00:00Z') },
    { surface: 'issue', scope_id: 'a', body: 'issue body is done', generated_at: new Date('2026-06-09T00:00:00Z') },
  ]);
  const out = await getTldrBodiesByScopeIds(ctx, 'issue', ['a']);
  assert.equal(out.get('a'), 'issue body is done', 'reads the issue-surface row only');
});

test('getTldrBodiesByScopeIds — whitespace/empty ids are filtered; an all-empty set short-circuits to zero queries', async () => {
  const ctx = makeCtx([
    { surface: 'issue', scope_id: 'a', body: 'A is done', generated_at: new Date('2026-06-10T00:00:00Z') },
  ]);
  const out = await getTldrBodiesByScopeIds(ctx, 'issue', ['', '']);
  assert.equal(ctx.__queryCount, 0, 'a set of only empty ids issues no query');
  assert.equal(out.size, 0);
});

// Sanity: the array-literal encoder the batched read binds is the SAME one
// upsertTldr uses (so the `= ANY($2::text[])` cast coerces identically).
test('toPgTextArrayLiteral — encodes the scope set as a Postgres array literal', () => {
  assert.equal(toPgTextArrayLiteral(['a', 'b']), '{"a","b"}');
  assert.equal(toPgTextArrayLiteral([]), '{}');
});
