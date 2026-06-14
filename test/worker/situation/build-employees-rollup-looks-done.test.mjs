// test/worker/situation/build-employees-rollup-looks-done.test.mjs
//
// Plan 18-03 Task 2 (LEG-03 / D-05/D-06/D-07) — the SR-row honest-divergence
// done-flag. The rollup attaches `looksDone: true` to a needs-you row ONLY when
// (a) the engine verdict is blocked-family (blockerChain.needsYou === true) AND
// (b) the row's cached TL;DR body reads as an explicit completion claim — sourced
// from a SINGLE batched, degrade-wrapped tldr_cache read.
//
// What these tests pin:
//   1. The done-flag read is ONE batched query, OUTSIDE the per-row loop (the
//      fake db counts queries — landmine #1 / SPEC O(1) acceptance).
//   2. The flag is set on a needs-you row whose TL;DR says done; ABSENT when the
//      TL;DR does not say done, when the row is not needs-you, or when no cached
//      TL;DR exists (degrade-safe — no false flag).
//   3. A THROWING db leaves the rollup intact: rows still returned, focusLine
//      preserved, no looksDone flag (degrade-wrapped — landmine #2).
//   4. With NO db on the ctx (old fixtures), the flag is never set and no query
//      is attempted.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildEmployeesRollup } from '../../../src/worker/situation/build-employees-rollup.ts';

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

function agent({ id, name = `Agent ${id}`, lastHeartbeatMs = null }) {
  return {
    id,
    name,
    role: 'general',
    title: null,
    lastHeartbeatAt: lastHeartbeatMs != null ? iso(lastHeartbeatMs) : null,
  };
}

function issue({ id, identifier, status, assigneeAgentId = null, lastActivityMs = null }) {
  return {
    id,
    identifier,
    title: `Title ${identifier}`,
    status,
    assigneeAgentId,
    lastActivityAt: lastActivityMs != null ? iso(lastActivityMs) : null,
  };
}

/**
 * Build a rollup ctx. `db` is optional; when present it simulates tldr_cache and
 * counts query() calls. `dbThrows` makes the batched read throw (degrade test).
 * `bodies` maps issue UUID → cached TL;DR body for the issue surface.
 */
function makeCtx({
  agents = [],
  issuesByAgent = {},
  relations = {},
  bodies = null,
  dbThrows = false,
} = {}) {
  let queryCount = 0;
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    issues: {
      async list(input) {
        return issuesByAgent[input?.assigneeAgentId ?? ''] ?? [];
      },
      async get() {
        return null;
      },
      relations: {
        async get(id) {
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
    agents: {
      async list() {
        return agents;
      },
      async get() {
        return null;
      },
    },
  };
  if (bodies != null || dbThrows) {
    ctx.db = {
      async query(sql, params) {
        queryCount += 1;
        if (dbThrows) throw new Error('simulated tldr_cache read failure');
        assert.match(sql, /tldr_cache/i, 'the batched read hits tldr_cache');
        assert.match(sql, /=\s*ANY/i, 'the batched read uses = ANY (one query, not per-row)');
        const literal = String(params[1]);
        const inner = literal.replace(/^\{|\}$/g, '');
        const wanted = new Set(
          inner.length === 0 ? [] : inner.split(',').map((s) => s.replace(/^"|"$/g, '')),
        );
        const out = [];
        for (const [scope_id, body] of Object.entries(bodies)) {
          if (wanted.has(scope_id)) out.push({ scope_id, body });
        }
        return out;
      },
    };
  }
  Object.defineProperty(ctx, '__queryCount', { get: () => queryCount });
  return ctx;
}

// A needs-you (genuinely unowned blocked) row: the blocker leaf has no
// assigneeUserId → terminal UNOWNED → blockerChain.needsYou === true.
function unownedBlockedFixture() {
  const a = agent({ id: 'ag1', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({
    id: 'i-1',
    identifier: 'COU-100',
    status: 'blocked',
    assigneeAgentId: 'ag1',
    lastActivityMs: NOW - 5 * HOUR,
  });
  return {
    agents: [a],
    issuesByAgent: { ag1: [blocked] },
    relations: {
      'i-1': {
        blockedBy: [{ id: 'i-1-x', assigneeUserId: null, status: 'blocked', etaIso: null }],
        blocks: [],
      },
    },
  };
}

test('LEG-03 — needs-you row whose TL;DR says done gets looksDone=true (ONE batched query)', async () => {
  const fx = unownedBlockedFixture();
  const ctx = makeCtx({ ...fx, bodies: { 'i-1-x': 'This work is complete.' } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag1');
  assert.ok(row.blockerChain && row.blockerChain.needsYou === true, 'row is needs-you (precondition)');
  assert.equal(row.looksDone, true, 'looksDone flag set when TL;DR says done AND verdict is blocked-family');
  assert.equal(ctx.__queryCount, 1, 'EXACTLY ONE batched query for the needs-you set (O(1))');
  // focusLine untouched (still polishTldr(title)).
  assert.equal(row.focusLine, 'Title COU-100', 'focusLine is unchanged (polishTldr(title))');
});

test('LEG-03 — needs-you row whose TL;DR does NOT say done has no looksDone flag (no false prompt)', async () => {
  const fx = unownedBlockedFixture();
  const ctx = makeCtx({ ...fx, bodies: { 'i-1-x': 'Still investigating the blocker.' } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag1');
  assert.ok(row.blockerChain && row.blockerChain.needsYou === true);
  assert.notEqual(row.looksDone, true, 'no flag when the TL;DR does not read as done');
});

test('LEG-03 — degrade-safe: no cached TL;DR for the issue → no flag (and still one query)', async () => {
  const fx = unownedBlockedFixture();
  // bodies has an entry, but NOT for i-1 → the Map lacks i-1 → no flag.
  const ctx = makeCtx({ ...fx, bodies: { 'other-issue': 'done' } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag1');
  assert.notEqual(row.looksDone, true, 'no flag when there is no cached TL;DR for the row');
});

test('LEG-03 — degrade-wrapped: a THROWING db leaves rows + focusLine intact, no flag', async () => {
  const fx = unownedBlockedFixture();
  const ctx = makeCtx({ ...fx, dbThrows: true });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag1');
  assert.ok(row, 'row still returned after a throwing batched read');
  assert.equal(row.focusLine, 'Title COU-100', 'focusLine intact through the degrade');
  assert.notEqual(row.looksDone, true, 'no flag on a degrade (never block/slow the snapshot)');
  assert.ok(row.blockerChain && row.blockerChain.needsYou === true, 'engine verdict untouched');
});

test('LEG-03 — NO db on ctx (old fixtures) → no query attempted, no flag', async () => {
  const fx = unownedBlockedFixture();
  const ctx = makeCtx({ ...fx }); // no bodies, no dbThrows → no ctx.db
  assert.equal(ctx.db, undefined, 'ctx has no db (old-fixture shape)');
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag1');
  assert.notEqual(row.looksDone, true, 'no flag without a db to read from');
  assert.equal(ctx.__queryCount, 0, 'no batched query attempted without a db');
});

test('LEG-03 — a non-needs-you row never gets looksDone even if a (stray) done body existed', async () => {
  // A running (not blocked) agent → no blockerChain.needsYou → not in the
  // needs-you set → never read, never flagged.
  const a = agent({ id: 'ag-run', lastHeartbeatMs: NOW - 1 * MIN });
  const running = issue({
    id: 'i-run',
    identifier: 'COU-200',
    status: 'in_progress',
    assigneeAgentId: 'ag-run',
    lastActivityMs: NOW - 1 * MIN,
  });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-run': [running] },
    bodies: { 'i-run': 'This is done.' },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag-run');
  assert.notEqual(row.looksDone, true, 'a non-needs-you row is never flagged (divergence requires both signals)');
});
