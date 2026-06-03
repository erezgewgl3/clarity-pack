// test/worker/situation/snapshot-cache.test.mjs
//
// Plan 16-04 Task 1 (Wave C) — the stale-while-revalidate snapshot cache.
//
// Covers every <behavior> bullet:
//   - readLatestSnapshot returns the single most-recent row (ORDER BY taken_at
//     DESC LIMIT 1) or null when none exists.
//   - writeSnapshot inserts the viewer-invariant slice with ON CONFLICT
//     (computed_for_company_id, content_hash) DO NOTHING (idempotent).
//   - buildNeedsYou is PURE (no fetch, no ctx): it re-partitions the
//     unowned ∪ viewer-targeted set over the cached rows.
//   - buildNeedsYou over the SAME rows with two DIFFERENT viewerUserIds yields
//     DIFFERENT counts (T-16-03 — the count is viewer-scoped, not baked in).
//   - On a FRESH cached row the handler serves the cached slice immediately,
//     recomputes needsYou per call, AND triggers a fresh recompute fire-and-forget
//     (no cron, no setInterval).
//   - On NO / STALE cached row the handler recomputes synchronously, returns the
//     fresh result, recomputes needsYou, and writes the slice back.
//   - needsYou is NEVER read from the cache.
//   - The cached payload contains ONLY the viewer-invariant slice (no needsYou).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  readLatestSnapshot,
  writeSnapshot,
  hashViewerInvariantSlice,
} from '../../../src/worker/situation/snapshot-cache.ts';
import { buildNeedsYou } from '../../../src/worker/situation/build-employees-rollup.ts';
import { registerSituationRoomHandlers } from '../../../src/worker/handlers/situation-room.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------
// Row fixtures — the cached viewer-invariant employee shape carrying the
// blockerChain terminal metadata buildNeedsYou re-partitions against (the
// terminalKind + awaitedUserId are what make per-viewer re-partition possible).
// ---------------------------------------------------------------------------

/** A genuinely-UNOWNED needs-you row (viewer-INVARIANT membership). */
function unownedRow({ agentId, leafIssueUuid }) {
  return {
    agentId,
    name: `Agent ${agentId}`,
    role: 'general',
    state: 'blocked',
    group: 'needs_you',
    isPaused: false,
    focusIssueId: 'CO-1',
    focusLine: 'doing a thing',
    lastActivityAt: null,
    ageBucket: 'stale',
    blockerChain: {
      rootIssueId: 'CO-1',
      leafIssueId: 'CO-1',
      leafIssueUuid,
      humanAction: 'Assign someone to this',
      ownerName: 'Unassigned',
      ownerAgentId: null,
      needsYou: true,
      tier: 'needs-you',
      actionAffordance: 'assign',
      awaitedPartyLabel: 'Assign someone to this',
      targetAgentUuid: null,
      targetIssueUuid: leafIssueUuid,
      awaitedUserId: null,
      terminalKind: 'UNOWNED',
      needsDurabilityFlip: false,
    },
    doneTodayCount: 0,
  };
}

/** An AWAITING_HUMAN row targeted at a specific user (viewer-DEPENDENT). */
function awaitingHumanRow({ agentId, leafIssueUuid, awaitedUserId }) {
  return {
    agentId,
    name: `Agent ${agentId}`,
    role: 'general',
    state: 'blocked',
    group: 'working',
    isPaused: false,
    focusIssueId: 'CO-2',
    focusLine: 'waiting on a person',
    lastActivityAt: null,
    ageBucket: 'stale',
    blockerChain: {
      rootIssueId: 'CO-2',
      leafIssueId: 'CO-2',
      leafIssueUuid,
      humanAction: 'Waiting on a teammate',
      ownerName: 'A Person',
      ownerAgentId: null,
      needsYou: true,
      tier: 'needs-you',
      actionAffordance: 'reply',
      awaitedPartyLabel: 'Waiting on a teammate',
      targetAgentUuid: null,
      targetIssueUuid: leafIssueUuid,
      // The captured AWAITING_HUMAN USER uuid — the cached viewer-invariant
      // metadata buildNeedsYou re-partitions against.
      awaitedUserId,
      terminalKind: 'AWAITING_HUMAN',
      needsDurabilityFlip: false,
    },
    doneTodayCount: 0,
  };
}

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// readLatestSnapshot
// ---------------------------------------------------------------------------

test('readLatestSnapshot — returns the most-recent row (ORDER BY taken_at DESC LIMIT 1)', async () => {
  const calls = [];
  const slice = { org_blocked_backlog: { rows: [] }, situation_employees: [], pulse: {} };
  const db = wrapHostFaithfulDb({
    namespace: 'plugin_clarity_pack_cdd6bda4bd',
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ payload: slice, taken_at: '2026-06-03T10:00:00Z' }];
    },
    async execute() {
      return { rowCount: 1 };
    },
  });
  const out = await readLatestSnapshot({ db }, 'co-1');
  assert.deepEqual(out, { payload: slice, takenAt: '2026-06-03T10:00:00Z' });
  // SQL contract: most-recent row, company-scoped, parameterized.
  assert.match(calls[0].sql, /ORDER BY\s+taken_at\s+DESC/i);
  assert.match(calls[0].sql, /LIMIT\s+1/i);
  assert.match(calls[0].sql, /computed_for_company_id\s*=\s*\$1/);
  assert.deepEqual(calls[0].params, ['co-1']);
});

test('readLatestSnapshot — returns null when no row exists', async () => {
  const db = wrapHostFaithfulDb({
    namespace: 'plugin_clarity_pack_cdd6bda4bd',
    async query() {
      return [];
    },
    async execute() {
      return { rowCount: 1 };
    },
  });
  assert.equal(await readLatestSnapshot({ db }, 'co-1'), null);
});

test('readLatestSnapshot — parses a string payload (defensive JSON.parse)', async () => {
  const slice = { org_blocked_backlog: { rows: [] }, situation_employees: [], pulse: {} };
  const db = wrapHostFaithfulDb({
    namespace: 'plugin_clarity_pack_cdd6bda4bd',
    async query() {
      return [{ payload: JSON.stringify(slice), taken_at: '2026-06-03T10:00:00Z' }];
    },
    async execute() {
      return { rowCount: 1 };
    },
  });
  const out = await readLatestSnapshot({ db }, 'co-1');
  assert.deepEqual(out.payload, slice);
});

// ---------------------------------------------------------------------------
// writeSnapshot
// ---------------------------------------------------------------------------

test('writeSnapshot — INSERT ... ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING; idempotent', async () => {
  const calls = [];
  const db = wrapHostFaithfulDb({
    namespace: 'plugin_clarity_pack_cdd6bda4bd',
    async query() {
      return [];
    },
    async execute(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  });
  const slice = { org_blocked_backlog: { rows: [] }, situation_employees: [], pulse: {} };
  const hash = hashViewerInvariantSlice(slice);
  await writeSnapshot({ db }, 'co-1', slice, hash);
  await writeSnapshot({ db }, 'co-1', slice, hash); // same hash twice → still a no-op server-side
  assert.equal(calls.length, 2, 'both writes issue the INSERT (dedup happens in Postgres)');
  // WARNING 5 — the ON CONFLICT target is the migrations/0003 line 43 constraint.
  assert.match(
    calls[0].sql,
    /ON CONFLICT \(computed_for_company_id, content_hash\) DO NOTHING/,
  );
  // Namespace-qualified literally; payload bound via a $2::jsonb cast; company $1.
  assert.match(calls[0].sql, /plugin_clarity_pack_cdd6bda4bd\.situation_snapshots/);
  assert.match(calls[0].sql, /\$2::jsonb/);
  assert.equal(calls[0].params[0], 'co-1');
  assert.equal(typeof calls[0].params[1], 'string', 'payload is JSON-stringified');
  assert.equal(calls[0].params[2], hash);
});

// ---------------------------------------------------------------------------
// buildNeedsYou — pure viewer-scoped re-partition
// ---------------------------------------------------------------------------

test('buildNeedsYou — PURE: no fetch / no ctx; counts the unowned ∪ viewer-targeted set', () => {
  const rows = [
    unownedRow({ agentId: 'ag-1', leafIssueUuid: 'leaf-1' }),
    awaitingHumanRow({ agentId: 'ag-2', leafIssueUuid: 'leaf-2', awaitedUserId: U1 }),
  ];
  // Viewer U1: unowned (ag-1) + targeted-at-U1 (ag-2) = 2 distinct leaves.
  const ny = buildNeedsYou(rows, U1);
  assert.equal(ny.count, 2);
  assert.ok(ny.topAction, 'topAction is set when there are needs-you items');
});

test('buildNeedsYou — two DIFFERENT viewerUserIds over the SAME rows yield DIFFERENT counts (T-16-03 no cross-viewer leak)', () => {
  const rows = [
    unownedRow({ agentId: 'ag-1', leafIssueUuid: 'leaf-1' }), // viewer-invariant
    awaitingHumanRow({ agentId: 'ag-2', leafIssueUuid: 'leaf-2', awaitedUserId: U1 }), // targets U1 only
  ];
  const forU1 = buildNeedsYou(rows, U1);
  const forU2 = buildNeedsYou(rows, U2);
  // U1 sees the unowned row + the row targeted at U1 = 2. U2 sees only the
  // unowned row (the AWAITING_HUMAN row is NOT targeted at U2) = 1.
  assert.equal(forU1.count, 2, 'U1: unowned + targeted-at-U1');
  assert.equal(forU2.count, 1, 'U2: only the unowned row (no leak of U1 targeting)');
  assert.notEqual(forU1.count, forU2.count, 'the count is viewer-scoped, not baked into the cache');
});

test('buildNeedsYou — NO_UUID_LEAK: topAction.humanAction carries no raw UUID', () => {
  const rows = [unownedRow({ agentId: 'ag-1', leafIssueUuid: 'leaf-1' })];
  const ny = buildNeedsYou(rows, U1);
  assert.ok(!UUID_RE.test(ny.topAction.humanAction));
});

// ---------------------------------------------------------------------------
// SWR handler integration — serve-last-good + revalidate; miss → recompute+write
// ---------------------------------------------------------------------------

function makeHandlerCtx({ snapshotRow = null, optedIn = true } = {}) {
  const dataRegistry = new Map();
  const dbCalls = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, fn) { dataRegistry.set(k, fn); } },
    actions: { register() {} },
    issues: {
      async list() {
        return [];
      },
      async get() {
        return null;
      },
      relations: { async get() { return { blockedBy: [], blocks: [] }; } },
    },
    agents: {
      async list() {
        return [];
      },
      async get() {
        return null;
      },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-05-14T08:00:00Z' }] : [];
        }
        if (/situation_snapshots/.test(sql)) {
          return snapshotRow ? [snapshotRow] : [];
        }
        return [];
      },
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        return { rowCount: 1 };
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, dataRegistry, dbCalls };
}

test('SWR — FRESH cached row is served immediately AND a fire-and-forget recompute is triggered', async () => {
  const cachedSlice = {
    org_blocked_backlog: { rows: [], total: 0, blocked_count: 0, need_you_count: 0, overflow: false },
    situation_employees: [
      unownedRow({ agentId: 'ag-1', leafIssueUuid: 'leaf-1' }),
      awaitingHumanRow({ agentId: 'ag-2', leafIssueUuid: 'leaf-2', awaitedUserId: U1 }),
    ],
    pulse: { needYou: 99, inMotion: 0, stuck: 0, selfClearing: 0 }, // a STALE/WRONG cached count
  };
  const freshTakenAt = new Date(Date.now() - 5_000).toISOString(); // 5s old → FRESH (< 60s)
  const bag = makeHandlerCtx({
    snapshotRow: { payload: cachedSlice, taken_at: freshTakenAt },
  });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: U1, companyId: 'co-1' });

  // Served from the cache: taken_at echoes the cached row (serve-last-good).
  assert.equal(result.taken_at, freshTakenAt, 'serves the cached row timestamp');
  // needsYou is recomputed per call (NOT read from the cache): U1 sees 2.
  assert.equal(result.needsYou.count, 2, 'needsYou recomputed per call over the cached rows');
  // pulse.needYou is recomputed too (NOT the stale 99 in the cached payload).
  assert.equal(result.pulse.needYou, 2, 'pulse.needYou is recomputed, not the stale cached value');

  // A fire-and-forget recompute was triggered: a write-back INSERT eventually
  // fires. Drain the microtask/timer queue so the background promise settles.
  await new Promise((r) => setTimeout(r, 20));
  const swrWrite = bag.dbCalls.find(
    (c) => c.kind === 'execute' && /situation_snapshots/.test(c.sql ?? ''),
  );
  assert.ok(swrWrite, 'a background recompute write-back fired (revalidate)');
});

test('SWR — STALE cached row → synchronous recompute + write-back (cache not served)', async () => {
  const staleSlice = {
    org_blocked_backlog: { rows: [], total: 0, blocked_count: 0, need_you_count: 0, overflow: false },
    situation_employees: [unownedRow({ agentId: 'ag-OLD', leafIssueUuid: 'leaf-OLD' })],
    pulse: { needYou: 1, inMotion: 0, stuck: 0, selfClearing: 0 },
  };
  const staleTakenAt = '2026-05-14T10:00:00Z'; // far past → STALE
  const before = Date.now();
  const bag = makeHandlerCtx({
    snapshotRow: { payload: staleSlice, taken_at: staleTakenAt },
  });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: U1, companyId: 'co-1' });

  // The stale row is NOT served: taken_at is a fresh timestamp, and the empty
  // RPC/prefetch fixtures yield an empty rollup (the stale ag-OLD row is gone).
  assert.notEqual(result.taken_at, staleTakenAt, 'must not echo the stale row');
  assert.ok(Date.parse(result.taken_at) >= before, 'taken_at is computed fresh');
  assert.deepEqual(result.situation_employees, [], 'fresh recompute (empty fixtures), not the stale cache');
  // The write-back fires (next caller gets a fresh row).
  const swrWrite = bag.dbCalls.find(
    (c) => c.kind === 'execute' && /situation_snapshots/.test(c.sql ?? ''),
  );
  assert.ok(swrWrite, 'a synchronous write-back fired on the stale path');
});

test('SWR — NO cached row → synchronous recompute + write-back', async () => {
  const bag = makeHandlerCtx({ snapshotRow: null });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  const result = await handler({ userId: U1, companyId: 'co-1' });
  assert.ok(Array.isArray(result.situation_employees));
  const swrWrite = bag.dbCalls.find(
    (c) => c.kind === 'execute' && /situation_snapshots/.test(c.sql ?? ''),
  );
  assert.ok(swrWrite, 'a write-back fired on the cache-miss path');
});

test('SWR — the cached payload (write-back) is the VIEWER-INVARIANT slice ONLY (no needsYou key)', async () => {
  const bag = makeHandlerCtx({ snapshotRow: null });
  registerSituationRoomHandlers(bag.ctx);
  const handler = bag.dataRegistry.get('situation.snapshot');
  await handler({ userId: U1, companyId: 'co-1' });
  const swrWrite = bag.dbCalls.find(
    (c) => c.kind === 'execute' && /situation_snapshots/.test(c.sql ?? ''),
  );
  const written = JSON.parse(swrWrite.params[1]);
  assert.deepEqual(
    Object.keys(written).sort(),
    ['org_blocked_backlog', 'pulse', 'situation_employees'],
    'the cached payload carries ONLY the viewer-invariant slice',
  );
  assert.equal(written.needsYou, undefined, 'no viewer-scoped needsYou is cached (T-16-03)');
});
