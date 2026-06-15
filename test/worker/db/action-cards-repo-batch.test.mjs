// test/worker/db/action-cards-repo-batch.test.mjs
//
// Phase 19 Plan 19-02 Task 1 (CARD-01 batch cached read + A2 binding probe) —
// the unit proof for getActionCardsBySources, the NEW newest-per-source batch
// read that the read-cached-only snapshot handler uses in place of the deleted
// on-request compile.
//
// THREE behavior cases (the plan's <behavior>):
//   (1) A2 BINDING PROBE. A fake ctx.db.query records the SQL + params the batch
//       read sends; assert it binds the source ids via toPgTextArrayLiteral and
//       a `= ANY($2::text[])` predicate — the SAME text[] discipline upsertActionCard
//       uses for its $N::text[] writes (proving the bind is wired consistently
//       and a native JS array is NEVER handed to the host bridge).
//   (2) getActionCardsBySources([]) returns {} WITHOUT querying (early-return).
//   (3) Given two source ids each with two generations, the result maps each
//       source_issue_id to its NEWEST row (DISTINCT ON + generated_at DESC) and
//       is a Record keyed by source_issue_id; absent ids are simply missing.
//
// HARNESS. A hand-rolled fake ctx.db whose query() records every call and returns
// canned rows. The DISTINCT ON newest-per-source semantics are exercised by
// feeding the fake the rows Postgres WOULD return for that ORDER BY (one newest
// row per source) — the test asserts the function shapes them into the Record
// contract the snapshot handler consumes, and that its bind is text[]-literal.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { getActionCardsBySources } from '../../../src/worker/db/action-cards-repo.ts';
import { toPgTextArrayLiteral } from '../../../src/worker/db/tldr-cache.ts';

const CID = 'co-1';
const SRC_A = '11111111-1111-1111-1111-111111111111';
const SRC_B = '22222222-2222-2222-2222-222222222222';

function makeRow(sourceId, generatedAt, namedAction) {
  return {
    company_id: CID,
    source_issue_id: sourceId,
    named_action: namedAction,
    awaited_party: 'you',
    est_bucket: 'quick',
    action_kind: 'answer',
    decision_options: null,
    content_hash: `h-${namedAction}`,
    generated_at: generatedAt,
    compiled_by_agent_id: 'editor',
    source_revisions: [],
    tags: [],
  };
}

/**
 * Fake db that records every query() call (sql + params) and returns whatever
 * rows the test pre-loads. Mirrors the storm-safety makeStormCtx SQL-regex
 * keying style but is simpler — this is a single-query unit.
 */
function makeCacheCtx(returnRows) {
  const calls = [];
  return {
    calls,
    ctx: {
      db: {
        async query(sql, params) {
          calls.push({ sql, params });
          return returnRows ?? [];
        },
        async execute() {
          return { rowCount: 0 };
        },
      },
    },
  };
}

// --- (2) empty input → {} without querying ----------------------------------

test('getActionCardsBySources([]) returns {} and issues NO query (early return)', async () => {
  const { ctx, calls } = makeCacheCtx([]);
  const out = await getActionCardsBySources(ctx, CID, []);
  assert.deepEqual(out, {});
  assert.equal(calls.length, 0, 'empty input must not hit the db at all');
});

// --- (1) A2 binding probe — text[] literal via toPgTextArrayLiteral + ANY ----

test('A2 probe: getActionCardsBySources binds source ids as a text[] LITERAL via ANY($2::text[])', async () => {
  const { ctx, calls } = makeCacheCtx([]);
  await getActionCardsBySources(ctx, CID, [SRC_A, SRC_B]);

  assert.equal(calls.length, 1, 'exactly one query for a non-empty input');
  const { sql, params } = calls[0];

  // The predicate is the parameterized ANY-over-text[] form (not an interpolated
  // IN-list, not a native-array bind).
  assert.match(
    sql,
    /source_issue_id\s*=\s*ANY\(\$2::text\[\]\)/i,
    'must use = ANY($2::text[]) — the parameterized text[] predicate',
  );
  // newest-per-source: DISTINCT ON (source_issue_id) ... ORDER BY source_issue_id, generated_at DESC
  assert.match(sql, /DISTINCT ON \(source_issue_id\)/i, 'must use DISTINCT ON (source_issue_id)');
  assert.match(
    sql,
    /ORDER BY\s+source_issue_id\s*,\s*generated_at\s+DESC/i,
    'ORDER BY source_issue_id, generated_at DESC selects the newest per source',
  );

  // company is bound as $1; the ids are bound as $2 — and $2 is the EXACT
  // text[]-literal toPgTextArrayLiteral produces (the same discipline
  // upsertActionCard uses for its $N::text[] writes). NOT a native JS array.
  assert.equal(params[0], CID, '$1 is the company id');
  assert.equal(
    params[1],
    toPgTextArrayLiteral([SRC_A, SRC_B]),
    '$2 is the toPgTextArrayLiteral encoding (host bridge never receives a native array)',
  );
  assert.equal(typeof params[1], 'string', '$2 must be a scalar text[]-literal string, not an array');

  // No identifier interpolation: the namespace literal is the only fully-qualified
  // ref, and there are exactly two binds.
  assert.equal(params.length, 2, 'exactly two parameterized binds ($1 company, $2 ids)');
});

// --- (3) newest-per-source mapping into the Record contract ------------------

test('getActionCardsBySources maps each source to its NEWEST row; absent ids are missing', async () => {
  // The fake returns what Postgres' DISTINCT ON + ORDER BY ... generated_at DESC
  // would yield: exactly ONE row per source, the newest. (A third id is absent
  // from the result set entirely.)
  const newestA = makeRow(SRC_A, '2026-06-15T12:00:00.000Z', 'newest-A');
  const newestB = makeRow(SRC_B, '2026-06-15T11:00:00.000Z', 'newest-B');
  const { ctx } = makeCacheCtx([newestA, newestB]);

  const ABSENT = '33333333-3333-3333-3333-333333333333';
  const out = await getActionCardsBySources(ctx, CID, [SRC_A, SRC_B, ABSENT]);

  // Record keyed by source_issue_id.
  assert.deepEqual(Object.keys(out).sort(), [SRC_A, SRC_B].sort());
  assert.equal(out[SRC_A].named_action, 'newest-A');
  assert.equal(out[SRC_B].named_action, 'newest-B');
  // The id with no row is simply missing from the map (caller degrades to floor).
  assert.equal(out[ABSENT], undefined, 'an absent source id is not a key in the result');
});

// --- de-dupe guard: if the host ever returns >1 row for a source, first wins ---

test('getActionCardsBySources is robust if the result accidentally carries duplicate sources (first row per source wins, DESC-ordered)', async () => {
  // Postgres DISTINCT ON guarantees one row per source, but the function must not
  // crash or mis-key if the bridge ever hands back an extra row — the FIRST row
  // for a source (the newest, since the query is generated_at DESC) is kept.
  const newer = makeRow(SRC_A, '2026-06-15T12:00:00.000Z', 'kept-newer');
  const older = makeRow(SRC_A, '2026-06-15T09:00:00.000Z', 'dropped-older');
  const { ctx } = makeCacheCtx([newer, older]);

  const out = await getActionCardsBySources(ctx, CID, [SRC_A]);
  assert.equal(out[SRC_A].named_action, 'kept-newer', 'the first (newest, DESC) row per source is kept');
});
