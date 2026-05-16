// test/worker/agents/circuit-breaker-durable.test.mjs
//
// Plan 03-06 Task 1 RED — failing spec for the durable circuit-breaker
// predicates.
//
// The Plan 03-04 closure drill found a SECONDARY bug: the compile-bulletin job
// re-resumes the Editor-Agent on every fire, so a breaker-tripped pause never
// sticks (live `attempt_n` ran away to 470). The fix makes the resume
// breaker-aware AND durable across worker restarts:
//
//   - `isCircuitOpen(agentKey)` — the in-memory predicate (true once the
//     per-process counter hits MAX_CONSECUTIVE_FAILURES).
//   - `isCircuitOpenDurable(ctx, agentKey)` — reads the last
//     MAX_CONSECUTIVE_FAILURES `editor_agent_failures` rows; true when that
//     many rows exist and the most recent `consecutive` is >=
//     MAX_CONSECUTIVE_FAILURES (the breaker tripped and no recordSuccess has
//     since reset it — recordSuccess writes no row).
//
// RED expectation: `isCircuitOpen` / `isCircuitOpenDurable` are not yet
// exported from `circuit-breaker.ts` — the calls fail "is not a function".

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  isCircuitOpen,
  isCircuitOpenDurable,
  recordFailure,
  recordSuccess,
  resetCircuitBreakerState,
  MAX_CONSECUTIVE_FAILURES,
  CLARITY_PACK_VERSION,
} from '../../../src/worker/agents/circuit-breaker.ts';

const AGENT_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY_ID = 'COU';

/** A minimal CircuitBreakerCtx — agents.pause + db.execute (recordFailure needs both). */
function makeBreakerCtx() {
  const paused = [];
  return {
    paused,
    ctx: {
      agents: {
        async pause(agentId, companyId) {
          paused.push({ agentId, companyId });
        },
      },
      db: {
        async execute() {
          return { rowCount: 1 };
        },
      },
    },
  };
}

/** A fake ctx whose `db.query` returns a scripted row array for isCircuitOpenDurable. */
function makeDurableCtx(rows) {
  const queries = [];
  return {
    queries,
    ctx: {
      db: {
        async query(sql, params) {
          queries.push({ sql, params });
          return rows;
        },
      },
    },
  };
}

// ---- isCircuitOpen — the in-memory predicate ------------------------------

test('isCircuitOpen: false initially, true after MAX_CONSECUTIVE_FAILURES, false after recordSuccess', async () => {
  resetCircuitBreakerState();
  const key = 'k';
  assert.equal(isCircuitOpen(key), false, 'false on a fresh counter');

  const { ctx } = makeBreakerCtx();
  for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
    await recordFailure(ctx, { agentKey: key, agentId: AGENT_ID, companyId: COMPANY_ID, reason: `fail ${i}` });
  }
  assert.equal(isCircuitOpen(key), true, 'true once the counter hits MAX_CONSECUTIVE_FAILURES');

  recordSuccess(key);
  assert.equal(isCircuitOpen(key), false, 'false again after recordSuccess zeroes the counter');
});

// ---- isCircuitOpenDurable — the cross-restart backstop --------------------

test('isCircuitOpenDurable: true when the latest of MAX rows has consecutive >= MAX', async () => {
  const rows = [
    { consecutive: MAX_CONSECUTIVE_FAILURES }, // most recent (ORDER BY id DESC)
    { consecutive: MAX_CONSECUTIVE_FAILURES - 1 },
    { consecutive: MAX_CONSECUTIVE_FAILURES - 2 },
  ];
  const { ctx } = makeDurableCtx(rows);
  assert.equal(await isCircuitOpenDurable(ctx, 'bulletin-compile'), true);
});

test('isCircuitOpenDurable: false when fewer than MAX rows exist', async () => {
  const rows = [{ consecutive: 2 }, { consecutive: 1 }];
  const { ctx } = makeDurableCtx(rows);
  assert.equal(await isCircuitOpenDurable(ctx, 'bulletin-compile'), false);
});

test('isCircuitOpenDurable: false when the latest row consecutive < MAX (post-reset re-fail)', async () => {
  // A recordSuccess reset the in-memory counter; the NEXT failure carries
  // consecutive = 1. Three rows exist but the most recent is 1, not >= MAX.
  const rows = [{ consecutive: 1 }, { consecutive: MAX_CONSECUTIVE_FAILURES }, { consecutive: MAX_CONSECUTIVE_FAILURES - 1 }];
  const { ctx } = makeDurableCtx(rows);
  assert.equal(await isCircuitOpenDurable(ctx, 'bulletin-compile'), false);
});

test('isCircuitOpenDurable: query carries the agentKey and a LIMIT of MAX_CONSECUTIVE_FAILURES', async () => {
  const rows = [
    { consecutive: MAX_CONSECUTIVE_FAILURES },
    { consecutive: MAX_CONSECUTIVE_FAILURES },
    { consecutive: MAX_CONSECUTIVE_FAILURES },
  ];
  const { ctx, queries } = makeDurableCtx(rows);
  await isCircuitOpenDurable(ctx, 'bulletin-compile');
  assert.equal(queries.length, 1, 'exactly one SELECT');
  assert.match(queries[0].sql, /editor_agent_failures/i, 'reads the durable audit table');
  assert.ok(
    queries[0].params.includes('bulletin-compile'),
    'the query is scoped to the agentKey',
  );
  assert.ok(
    queries[0].params.includes(MAX_CONSECUTIVE_FAILURES),
    'the query LIMITs to MAX_CONSECUTIVE_FAILURES rows',
  );
});

test('isCircuitOpenDurable: a query error fails open (returns false)', async () => {
  const ctx = {
    db: {
      async query() {
        throw new Error('connection lost');
      },
    },
  };
  assert.equal(await isCircuitOpenDurable(ctx, 'bulletin-compile'), false);
});

// ===========================================================================
// Plan 03-07 Task 1 RED — version-scoped durable breaker.
// `isCircuitOpenDurable` used to count ALL editor_agent_failures rows, so a
// fresh post-fix install was silently DOA on pre-fix failure history (the
// 2026-05-16 re-drill had to hand-delete 518+482 stale rows). recordFailure
// now stamps the current plugin version (CLARITY_PACK_VERSION) on each row;
// isCircuitOpenDurable filters WHERE plugin_version = $N.
// ===========================================================================

/** A CircuitBreakerCtx whose `db.execute` RECORDS each INSERT's SQL + params. */
function makeRecordingBreakerCtx() {
  const executes = [];
  const paused = [];
  return {
    executes,
    paused,
    ctx: {
      agents: {
        async pause(agentId, companyId) {
          paused.push({ agentId, companyId });
        },
      },
      db: {
        async execute(sql, params) {
          executes.push({ sql, params });
          return { rowCount: 1 };
        },
      },
    },
  };
}

test('CLARITY_PACK_VERSION is a non-empty string', () => {
  assert.equal(typeof CLARITY_PACK_VERSION, 'string');
  assert.ok(CLARITY_PACK_VERSION.length > 0);
});

// ---- Test E — recordFailure stamps the plugin version ---------------------

test('Test E — recordFailure stamps CLARITY_PACK_VERSION on the editor_agent_failures INSERT', async () => {
  resetCircuitBreakerState();
  const { ctx, executes } = makeRecordingBreakerCtx();
  await recordFailure(ctx, {
    agentKey: 'bulletin-compile',
    agentId: AGENT_ID,
    companyId: COMPANY_ID,
    reason: 'forced failure',
  });
  assert.equal(executes.length, 1, 'one INSERT');
  assert.match(executes[0].sql, /plugin_version/i, 'the INSERT SQL mentions plugin_version');
  assert.ok(
    executes[0].params.includes(CLARITY_PACK_VERSION),
    'the INSERT params include the current plugin version',
  );
});

// ---- Test F — isCircuitOpenDurable filters by plugin_version --------------

test('Test F — isCircuitOpenDurable SELECT filters WHERE plugin_version = $N', async () => {
  resetCircuitBreakerState();
  const { ctx, queries } = makeDurableCtx([]);
  await isCircuitOpenDurable(ctx, 'bulletin-compile');
  assert.equal(queries.length, 1, 'exactly one SELECT');
  assert.match(queries[0].sql, /plugin_version/i, 'the SELECT SQL filters on plugin_version');
  assert.ok(
    queries[0].params.includes(CLARITY_PACK_VERSION),
    'the SELECT params include the current plugin version',
  );
});

// ---- Test G — version-scoped: fresh install is NOT breaker-suppressed -----

test('Test G — isCircuitOpenDurable: 3 current-version rows → true; [] (only pre-fix NULL rows filtered out) → false', async () => {
  resetCircuitBreakerState();
  const open = makeDurableCtx([
    { consecutive: MAX_CONSECUTIVE_FAILURES },
    { consecutive: MAX_CONSECUTIVE_FAILURES - 1 },
    { consecutive: MAX_CONSECUTIVE_FAILURES - 2 },
  ]);
  assert.equal(
    await isCircuitOpenDurable(open.ctx, 'bulletin-compile'),
    true,
    'three current-version failure rows read as an open circuit',
  );

  // A fresh post-fix install: the only rows in the table are pre-fix
  // NULL-version rows, which the plugin_version = $N filter excludes — so the
  // query returns []. The breaker must read closed (a fresh install is NOT DOA).
  const fresh = makeDurableCtx([]);
  assert.equal(
    await isCircuitOpenDurable(fresh.ctx, 'bulletin-compile'),
    false,
    'a fresh install whose only rows are pre-fix NULL-version rows reads as a closed circuit',
  );
});
