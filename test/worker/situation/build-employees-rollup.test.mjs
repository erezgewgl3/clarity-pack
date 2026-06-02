// test/worker/situation/build-employees-rollup.test.mjs
//
// Plan 08-01 Task 3 RED — the per-employee rollup builder (ROOM-13/15/16/17).
//
// Mirrors the org-blocked-backlog.test.mjs makeCtx idiom (plain-object ctx
// stub, no devDep, instance-neutral COU-/ACME- ids). Covers:
//   - 5-state classification per agent (via the Task 2 classifier)
//   - focusLine polish parity (polishTldr applied + ≤80 char truncation)
//   - blocker-chain reuse (flatten + pickTopChains + scrubHumanAction)
//   - NO_UUID_LEAK invariant on humanAction
//   - deterministic sort blocked → stale → idle → reviewing → running
//   - needsYou.count viewer-match semantic (terminal.userId === viewerUserId)
//   - B1: ownerAgentId = focusIssue.assigneeAgentId (AGENT uuid), NOT terminal.userId
//   - M2: leafIssueId fallback chain (leaf identifier → focusIssue.identifier → null),
//     NEVER a uuid-suffix string
//   - degrade-safe per-row try/catch

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildEmployeesRollup } from '../../../src/worker/situation/build-employees-rollup.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

/**
 * Plain-object ctx stub.
 * @param {object} opts
 * @param {Array} opts.agents              Agent[] from agents.list
 * @param {object} opts.issuesByAgent      { agentId: Issue[] } for issues.list
 * @param {object} opts.relations          { issueId: { blockedBy, blocks } }
 * @param {object} opts.issuesById         { issueId: Issue } for issues.get (leaf lookup)
 * @param {object} opts.agentsByUuid       { uuid: { name } } for agents.get
 * @param {Set<string>} [opts.listThrowsFor]   agentIds whose issues.list throws
 * @param {Set<string>} [opts.getThrowsFor]    issueIds whose issues.get throws
 * @param {Set<string>} [opts.relThrowsFor]    issueIds whose relations.get throws (root → chain-build throw)
 * @param {boolean} [opts.agentsListThrows]
 */
function makeCtx({
  agents = [],
  issuesByAgent = {},
  relations = {},
  issuesById = {},
  agentsByUuid = {},
  listThrowsFor = new Set(),
  getThrowsFor = new Set(),
  relThrowsFor = new Set(),
  agentsListThrows = false,
} = {}) {
  return {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    issues: {
      async list(input) {
        const agentId = input?.assigneeAgentId ?? '';
        if (listThrowsFor.has(agentId)) throw new Error(`issues.list boom for ${agentId}`);
        return issuesByAgent[agentId] ?? [];
      },
      async get(id) {
        if (getThrowsFor.has(id)) throw new Error(`issues.get boom for ${id}`);
        return issuesById[id] ?? null;
      },
      relations: {
        async get(id) {
          // A ROOT relations.get throw propagates through buildEdges → the rollup
          // chain-build try/catch (Plan 11-03 D-09: honest UNCLASSIFIED, not null).
          if (relThrowsFor.has(id)) throw new Error(`relations.get boom for ${id}`);
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
    agents: {
      async list() {
        if (agentsListThrows) throw new Error('agents.list boom');
        return agents;
      },
      async get(uuid) {
        return agentsByUuid[uuid] ?? null;
      },
    },
  };
}

function agent({ id, name = `Agent ${id}`, role = 'general', title = null, lastHeartbeatMs = null, status = null, pausedAt = null }) {
  return {
    id,
    name,
    role,
    title,
    lastHeartbeatAt: lastHeartbeatMs != null ? iso(lastHeartbeatMs) : null,
    // Plan 09-01 D-04 — host agent status drives the row's isPaused marker.
    status,
    pausedAt,
  };
}

function issue({ id, identifier, title = `Title ${identifier}`, status, assigneeAgentId = null, lastActivityMs = null }) {
  return {
    id,
    identifier,
    title,
    status,
    assigneeAgentId,
    lastActivityAt: lastActivityMs != null ? iso(lastActivityMs) : null,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — empty roster
// ---------------------------------------------------------------------------
test('rollup — empty roster → {employees:[], needsYou:{count:0,topAction:null}}', async () => {
  const ctx = makeCtx({ agents: [] });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  assert.deepEqual(out, { employees: [], needsYou: { count: 0, topAction: null } });
});

// ---------------------------------------------------------------------------
// Test 2 — single running agent, no open issues, fresh heartbeat
// ---------------------------------------------------------------------------
test('rollup — running agent (fresh heartbeat, no open issues): focus null, chain null', async () => {
  const a = agent({ id: 'ag-run', lastHeartbeatMs: NOW - 60_000 });
  const ctx = makeCtx({ agents: [a], issuesByAgent: { 'ag-run': [] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  assert.equal(out.employees.length, 1);
  const row = out.employees[0];
  assert.equal(row.state, 'running');
  assert.equal(row.focusIssueId, null);
  assert.equal(row.focusLine, null);
  assert.equal(row.blockerChain, null);
});

// ---------------------------------------------------------------------------
// Test 3 — single blocked agent with chain leaf
// ---------------------------------------------------------------------------
test('rollup — blocked agent with chain leaf: humanAction has no UUID, ownerName "Unassigned" when __unowned__', async () => {
  const a = agent({ id: 'ag-blk', lastHeartbeatMs: NOW - 30 * MIN });
  const blockerUuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const blocked = issue({ id: 'i-blk', identifier: 'COU-10', status: 'blocked', assigneeAgentId: 'ag-blk', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-blk': [blocked] },
    relations: { 'i-blk': { blockedBy: [{ id: blockerUuid, assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.equal(row.state, 'blocked');
  assert.ok(row.blockerChain, 'blockerChain present');
  assert.ok(!UUID_RE.test(row.blockerChain.humanAction), `no UUID; got: ${row.blockerChain.humanAction}`);
  assert.equal(row.blockerChain.ownerName, 'Unassigned');
});

// ---------------------------------------------------------------------------
// Test 4 — idle agent (no open issues, recent heartbeat)
// ---------------------------------------------------------------------------
test('rollup — idle agent (no open issues, 2h heartbeat): state idle, focusLine null', async () => {
  const a = agent({ id: 'ag-idle', lastHeartbeatMs: NOW - 2 * HOUR });
  const ctx = makeCtx({ agents: [a], issuesByAgent: { 'ag-idle': [] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.equal(row.state, 'idle');
  assert.equal(row.focusLine, null);
});

// ---------------------------------------------------------------------------
// Test 5 — stale agent (no open issues, 48h heartbeat)
// ---------------------------------------------------------------------------
test('rollup — stale agent (no open issues, 48h heartbeat): state stale', async () => {
  const a = agent({ id: 'ag-stale', lastHeartbeatMs: NOW - 48 * HOUR });
  const ctx = makeCtx({ agents: [a], issuesByAgent: { 'ag-stale': [] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  assert.equal(out.employees[0].state, 'stale');
});

// ---------------------------------------------------------------------------
// Test 6 — reviewing agent (in_review, no fresh heartbeat)
// ---------------------------------------------------------------------------
test('rollup — reviewing agent: state reviewing, focusLine = polished title', async () => {
  const a = agent({ id: 'ag-rev', lastHeartbeatMs: NOW - 30 * MIN });
  const rev = issue({ id: 'i-rev', identifier: 'COU-20', title: 'Co-sign rev 2', status: 'in_review', assigneeAgentId: 'ag-rev', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({ agents: [a], issuesByAgent: { 'ag-rev': [rev] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.equal(row.state, 'reviewing');
  assert.equal(row.focusLine, 'Co-sign rev 2');
  assert.equal(row.focusIssueId, 'COU-20');
});

// ---------------------------------------------------------------------------
// Test 7 — focusLine polish parity (lone-ref paren strip)
// ---------------------------------------------------------------------------
test('rollup — focusLine runs through polishTldr (lone-ref paren stripped)', async () => {
  const a = agent({ id: 'ag-p', lastHeartbeatMs: NOW - 30 * MIN });
  const ip = issue({ id: 'i-p', identifier: 'COU-30', title: 'Scope (BEAAA-1234)', status: 'in_review', assigneeAgentId: 'ag-p', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({ agents: [a], issuesByAgent: { 'ag-p': [ip] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  // polishTldr's stripParensAroundLoneRef removes the wrapping parens.
  assert.ok(!/\(BEAAA-1234\)/.test(row.focusLine), `parens should be stripped; got: ${row.focusLine}`);
  assert.match(row.focusLine, /BEAAA-1234/);
});

// ---------------------------------------------------------------------------
// Test 8 — focusLine truncation ≤ 80, ellipsis when truncated
// ---------------------------------------------------------------------------
test('rollup — focusLine truncated to ≤80 chars with ellipsis', async () => {
  const longTitle = 'X'.repeat(100);
  const a = agent({ id: 'ag-t', lastHeartbeatMs: NOW - 30 * MIN });
  const ip = issue({ id: 'i-t', identifier: 'COU-40', title: longTitle, status: 'in_review', assigneeAgentId: 'ag-t', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({ agents: [a], issuesByAgent: { 'ag-t': [ip] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const fl = out.employees[0].focusLine;
  assert.ok(fl.length <= 80, `length ${fl.length} must be ≤80`);
  assert.ok(fl.endsWith('…'), 'truncated focusLine ends with ellipsis');
});

// ---------------------------------------------------------------------------
// Test 9 — sort order blocked → stale → idle → reviewing → running
// ---------------------------------------------------------------------------
test('rollup — sort order: blocked, stale, idle, reviewing, running', async () => {
  const agents = [
    agent({ id: 'ag-running', lastHeartbeatMs: NOW - 60_000 }),
    agent({ id: 'ag-idle', lastHeartbeatMs: NOW - 2 * HOUR }),
    agent({ id: 'ag-blocked', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-reviewing', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-stale', lastHeartbeatMs: NOW - 48 * HOUR }),
  ];
  const issuesByAgent = {
    'ag-running': [],
    'ag-idle': [],
    'ag-blocked': [issue({ id: 'i-b', identifier: 'COU-1', status: 'blocked', assigneeAgentId: 'ag-blocked', lastActivityMs: NOW - 30 * MIN })],
    'ag-reviewing': [issue({ id: 'i-r', identifier: 'COU-2', status: 'in_review', assigneeAgentId: 'ag-reviewing', lastActivityMs: NOW - 30 * MIN })],
    'ag-stale': [],
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations: { 'i-b': { blockedBy: [{ id: 'i-b-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  assert.deepEqual(out.employees.map((r) => r.state), ['blocked', 'stale', 'idle', 'reviewing', 'running']);
});

// ---------------------------------------------------------------------------
// Test 10 (UPDATED for Plan 12-02 / NY-02) — within the needs_you (blocked) band,
// rows are ordered by LEVERAGE descending, tie-break stable leaf id ascending —
// NOT by activity age (D-02: the sort is time-free). The two rows here have equal
// leverage (1 each, distinct leaves x1/x2), so the deterministic stable-id
// tie-break orders them x1 < x2 → ag-new (leaf x1) before ag-old (leaf x2),
// REGARDLESS of activity timestamps (the older row no longer wins by age).
// ---------------------------------------------------------------------------
test('rollup — needs_you band ordered by leverage then stable leaf id (time-free, D-02), not by activity age', async () => {
  const agents = [
    agent({ id: 'ag-new', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-old', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-new': [issue({ id: 'i-new', identifier: 'COU-NEW', status: 'blocked', assigneeAgentId: 'ag-new', lastActivityMs: NOW - 1 * HOUR })],
    // ag-old is OLDER by activity — under the old age-based rule it led; under the
    // new leverage rule its leaf (x2) sorts AFTER x1 on the stable tie-break.
    'ag-old': [issue({ id: 'i-old', identifier: 'COU-OLD', status: 'blocked', assigneeAgentId: 'ag-old', lastActivityMs: NOW - 10 * HOUR })],
  };
  const relations = {
    'i-new': { blockedBy: [{ id: 'x1', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-old': { blockedBy: [{ id: 'x2', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  // Leverage equal (1 each) → stable leaf id ascending: x1 (ag-new) before x2 (ag-old).
  assert.equal(out.employees[0].agentId, 'ag-new', 'leaf x1 sorts before x2 (stable tie-break, not age)');
  assert.equal(out.employees[1].agentId, 'ag-old');
});

// ---------------------------------------------------------------------------
// Test 11 — within running bucket: most-recent heartbeat first
// ---------------------------------------------------------------------------
test('rollup — within running bucket: most-recent activity first', async () => {
  const agents = [
    agent({ id: 'ag-older', lastHeartbeatMs: NOW - 4 * MIN }),
    agent({ id: 'ag-newer', lastHeartbeatMs: NOW - 1 * MIN }),
  ];
  const ctx = makeCtx({ agents, issuesByAgent: { 'ag-older': [], 'ag-newer': [] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  assert.equal(out.employees[0].agentId, 'ag-newer');
  assert.equal(out.employees[1].agentId, 'ag-older');
});

// ---------------------------------------------------------------------------
// Test 12 — degrade-safe per-row (one agent's issues.list throws)
// ---------------------------------------------------------------------------
test('rollup — degrade-safe: one agent issues.list throws → that row state "unknown", others normal', async () => {
  const agents = [
    agent({ id: 'ag-ok', lastHeartbeatMs: NOW - 60_000 }),
    agent({ id: 'ag-bad', name: 'Broken One', lastHeartbeatMs: NOW - 60_000 }),
  ];
  const ctx = makeCtx({
    agents,
    issuesByAgent: { 'ag-ok': [] },
    listThrowsFor: new Set(['ag-bad']),
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const bad = out.employees.find((r) => r.agentId === 'ag-bad');
  const ok = out.employees.find((r) => r.agentId === 'ag-ok');
  assert.equal(bad.state, 'unknown');
  assert.equal(bad.name, 'Broken One');
  assert.ok(!UUID_RE.test(bad.name), 'degrade-safe name is not a UUID');
  assert.equal(ok.state, 'running');
});

// ---------------------------------------------------------------------------
// Test 13 — NO_UUID_LEAK across every row
// ---------------------------------------------------------------------------
test('rollup — NO_UUID_LEAK: no humanAction across any row contains a hex UUID', async () => {
  const a = agent({ id: 'ag-blk', lastHeartbeatMs: NOW - 30 * MIN });
  const blockerUuid = 'aaaaaaaa-1111-2222-3333-444444444444';
  const blocked = issue({ id: 'i-blk', identifier: 'COU-10', status: 'blocked', assigneeAgentId: 'ag-blk', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-blk': [blocked] },
    relations: { 'i-blk': { blockedBy: [{ id: blockerUuid, assigneeUserId: blockerUuid, status: 'awaiting', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  for (const row of out.employees) {
    assert.ok(!UUID_RE.test(row.blockerChain?.humanAction ?? ''), `row ${row.agentId} leaked UUID`);
  }
});

// ---------------------------------------------------------------------------
// Test 14 — needsYou.count semantic (terminal.userId === viewerUserId)
// ---------------------------------------------------------------------------
test('rollup — needsYou.count counts blocked rows whose terminal.userId === viewer', async () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const a = agent({ id: 'ag-me', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-me', identifier: 'COU-50', status: 'blocked', assigneeAgentId: 'ag-me', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-me': [blocked] },
    relations: { 'i-me': { blockedBy: [{ id: 'i-me-x', assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [viewer]: { name: 'You' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', viewer);
  assert.equal(out.needsYou.count, 1);
  assert.equal(out.needsYou.topAction.agentId, 'ag-me');
});

// ---------------------------------------------------------------------------
// Test 15 — needsYou.topAction picks oldest blocker
// ---------------------------------------------------------------------------
test('rollup — needsYou.topAction names the agent with the OLDEST blocker', async () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const agents = [
    agent({ id: 'ag-recent', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-oldest', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-recent': [issue({ id: 'i-recent', identifier: 'COU-R', status: 'blocked', assigneeAgentId: 'ag-recent', lastActivityMs: NOW - 1 * HOUR })],
    'ag-oldest': [issue({ id: 'i-oldest', identifier: 'COU-O', status: 'blocked', assigneeAgentId: 'ag-oldest', lastActivityMs: NOW - 20 * HOUR })],
  };
  const relations = {
    'i-recent': { blockedBy: [{ id: 'r-x', assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] },
    'i-oldest': { blockedBy: [{ id: 'o-x', assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations, agentsByUuid: { [viewer]: { name: 'You' } } });
  const out = await buildEmployeesRollup(ctx, 'co-1', viewer);
  assert.equal(out.needsYou.count, 2);
  assert.equal(out.needsYou.topAction.agentId, 'ag-oldest');
});

// ---------------------------------------------------------------------------
// Test 16 — B1: ownerAgentId = focusIssue.assigneeAgentId (AGENT uuid)
// ---------------------------------------------------------------------------
test('rollup — B1: ownerAgentId is focusIssue.assigneeAgentId (AGENT uuid), NOT terminal.userId (USER uuid)', async () => {
  const agentUuid = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const userUuid = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';
  const a = agent({ id: 'ag-b1', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-b1', identifier: 'COU-60', status: 'blocked', assigneeAgentId: agentUuid, lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-b1': [blocked] },
    relations: { 'i-b1': { blockedBy: [{ id: 'i-b1-x', assigneeUserId: userUuid, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [userUuid]: { name: 'Some User' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  assert.equal(row.blockerChain.ownerAgentId, agentUuid);
  assert.notEqual(row.blockerChain.ownerAgentId, userUuid);
});

// ---------------------------------------------------------------------------
// Test 17 — M2: leafIssueId falls back to focusIssue.identifier, never a uuid-suffix
// ---------------------------------------------------------------------------
test('rollup — M2: leafIssueId falls back to focusIssue.identifier when leaf issues.get throws; never uuid-suffix', async () => {
  const a = agent({ id: 'ag-m2', lastHeartbeatMs: NOW - 30 * MIN });
  // leaf node is a distinct issue id whose issues.get THROWS.
  const leafUuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const blocked = issue({ id: 'i-m2', identifier: 'COU-70', status: 'blocked', assigneeAgentId: 'ag-m2', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-m2': [blocked] },
    relations: {
      'i-m2': { blockedBy: [{ id: leafUuid, assigneeUserId: 'u-owner', status: 'awaiting', etaIso: null }], blocks: [] },
      [leafUuid]: { blockedBy: [], blocks: [] },
    },
    getThrowsFor: new Set([leafUuid]),
    agentsByUuid: { 'u-owner': { name: 'Owner' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  assert.equal(row.blockerChain.leafIssueId, 'COU-70');
  assert.ok(!/[0-9a-f]{8}/i.test(row.blockerChain.leafIssueId), 'leafIssueId carries no uuid-suffix');
  // Plan 09-04 — even when the leaf issues.get THROWS, leafIssueUuid must still
  // be a non-null UUID source, NEVER the human identifier. The plan's UUID
  // source chain is leaf.id → leafNodeId (picked.pathIds[last]) → focusIssue.id.
  // With the leaf fetch throwing, leaf.id is unavailable, so it stays the
  // leafNodeId — the chain-leaf node UUID ('7b5c7deb-…') — which is still a
  // UUID and never an .identifier. Asserted as the robust property (non-null +
  // a UUID-source id distinct from the human key) so it is clock/order-independent.
  assert.ok(row.blockerChain.leafIssueUuid != null, 'leafIssueUuid is non-null on leaf-fetch throw');
  assert.ok(
    ['7b5c7deb-8135-4d23-b41b-6cf7b724e945', 'i-m2'].includes(row.blockerChain.leafIssueUuid),
    `leafIssueUuid is a UUID-source id (leafNodeId or focusIssue.id), got: ${row.blockerChain.leafIssueUuid}`,
  );
  assert.notEqual(row.blockerChain.leafIssueUuid, 'COU-70', 'leafIssueUuid is NOT the human identifier');
  assert.notEqual(row.blockerChain.leafIssueUuid, row.blockerChain.leafIssueId, 'leafIssueUuid distinct from the human key');
});

// ---------------------------------------------------------------------------
// Test 17c (Plan 09-04) — leafIssueUuid is a UUID source, distinct from the human key
// ---------------------------------------------------------------------------
test('rollup — 09-04: blockerChain.leafIssueUuid is UUID-shaped (a UUID source) and distinct from the human leafIssueId', async () => {
  // Both the focus id AND the chain-leaf id are real UUIDs, so whichever rung of
  // the source chain (leaf.id → leafNodeId → focusIssue.id) fires, leafIssueUuid
  // is UUID-shaped and never the human identifier — making the property
  // (UUID source, distinct from the human key) order/clock-independent.
  const focusUuid = 'ffffffff-0000-1111-2222-333333333333';
  const leafUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const a = agent({ id: 'ag-uuid', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: focusUuid, identifier: 'COU-90', status: 'blocked', assigneeAgentId: 'ag-uuid', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-uuid': [blocked] },
    relations: {
      [focusUuid]: { blockedBy: [{ id: leafUuid, assigneeUserId: 'u-owner', status: 'awaiting', etaIso: null }], blocks: [] },
      [leafUuid]: { blockedBy: [], blocks: [] },
    },
    // The leaf issues.get returns an issue whose id is the UUID and identifier the human key.
    issuesById: { [leafUuid]: { id: leafUuid, identifier: 'COU-91' } },
    agentsByUuid: { 'u-owner': { name: 'Owner' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  // leafIssueUuid is UUID-shaped (sourced from a UUID id, never an .identifier).
  assert.ok(row.blockerChain.leafIssueUuid != null, 'leafIssueUuid is non-null');
  assert.ok(UUID_RE.test(row.blockerChain.leafIssueUuid), `leafIssueUuid is UUID-shaped, got: ${row.blockerChain.leafIssueUuid}`);
  assert.ok(
    [leafUuid, focusUuid].includes(row.blockerChain.leafIssueUuid),
    `leafIssueUuid is a UUID source (leaf.id or focusIssue.id), got: ${row.blockerChain.leafIssueUuid}`,
  );
  // The human display key (leafIssueId) is a human identifier (COU-90/COU-91), never a UUID.
  assert.ok(['COU-90', 'COU-91'].includes(row.blockerChain.leafIssueId), 'leafIssueId is the human identifier');
  assert.notEqual(row.blockerChain.leafIssueUuid, row.blockerChain.leafIssueId, 'UUID distinct from human key');
});

// ---------------------------------------------------------------------------
// Test 18 (Plan 09-01 R2) — every row carries a worker-assigned group bucket
// ---------------------------------------------------------------------------
test('rollup — R2: each row carries group (blocked→needs_you; running→working; idle→idle)', async () => {
  const agents = [
    agent({ id: 'ag-running', lastHeartbeatMs: NOW - 60_000 }),
    agent({ id: 'ag-idle', lastHeartbeatMs: NOW - 2 * HOUR }),
    agent({ id: 'ag-blocked', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-reviewing', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-stale', lastHeartbeatMs: NOW - 48 * HOUR }),
  ];
  const issuesByAgent = {
    'ag-running': [],
    'ag-idle': [],
    'ag-blocked': [issue({ id: 'i-b', identifier: 'COU-1', status: 'blocked', assigneeAgentId: 'ag-blocked', lastActivityMs: NOW - 30 * MIN })],
    'ag-reviewing': [issue({ id: 'i-r', identifier: 'COU-2', status: 'in_review', assigneeAgentId: 'ag-reviewing', lastActivityMs: NOW - 30 * MIN })],
    'ag-stale': [],
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations: { 'i-b': { blockedBy: [{ id: 'i-b-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const byId = Object.fromEntries(out.employees.map((r) => [r.agentId, r]));
  assert.equal(byId['ag-blocked'].group, 'needs_you');
  assert.equal(byId['ag-running'].group, 'working');
  assert.equal(byId['ag-reviewing'].group, 'working');
  assert.equal(byId['ag-idle'].group, 'idle');
  assert.equal(byId['ag-stale'].group, 'idle');
});

// ---------------------------------------------------------------------------
// Test 19 (Plan 09-01 D-04) — paused agent: isPaused=true, group still 'idle'
// ---------------------------------------------------------------------------
test('rollup — D-04: paused agent has isPaused=true and group=idle (paused does NOT change the bucket)', async () => {
  // A stood-down agent reports host status 'paused'. It still buckets as idle
  // (paused is INDEPENDENT of group — no 6th group, no 6th state).
  const paused = agent({ id: 'ag-paused', lastHeartbeatMs: NOW - 2 * HOUR, status: 'paused' });
  const active = agent({ id: 'ag-active', lastHeartbeatMs: NOW - 2 * HOUR });
  const ctx = makeCtx({ agents: [paused, active], issuesByAgent: { 'ag-paused': [], 'ag-active': [] } });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const byId = Object.fromEntries(out.employees.map((r) => [r.agentId, r]));
  assert.equal(byId['ag-paused'].isPaused, true, 'paused agent → isPaused true');
  assert.equal(byId['ag-paused'].group, 'idle', 'paused agent still buckets idle');
  assert.equal(byId['ag-active'].isPaused, false, 'non-paused agent → isPaused false');
  assert.equal(byId['ag-active'].group, 'idle');
});

// ---------------------------------------------------------------------------
// Test 17b — needsYou keys on terminal.userId (USER uuid), not agent id
// ---------------------------------------------------------------------------
test('rollup — 17b: needsYou.count keys on terminal.userId === viewer even when focusIssue.assigneeAgentId differs', async () => {
  const viewer = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';
  const agentUuid = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const a = agent({ id: 'ag-17b', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-17b', identifier: 'COU-80', status: 'blocked', assigneeAgentId: agentUuid, lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-17b': [blocked] },
    relations: { 'i-17b': { blockedBy: [{ id: 'i-17b-x', assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [viewer]: { name: 'You' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', viewer);
  assert.equal(out.needsYou.count, 1);
});

// ---------------------------------------------------------------------------
// Test 20 (Plan 11-03 D-13/D-14) — needs-you re-triage reads the engine verdict
// ---------------------------------------------------------------------------
test('rollup — 11-03: blockerChain carries the engine verdict (needsYou/tier/actionAffordance), not an ownerName string-match', async () => {
  // A genuinely-unowned blocker (assigneeUserId null, no eta) classifies UNOWNED →
  // verdict needsYou true, tier 'needs-you', affordance 'assign'.
  const a = agent({ id: 'ag-verdict', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-verdict', identifier: 'COU-V1', status: 'blocked', assigneeAgentId: 'ag-verdict', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-verdict': [blocked] },
    relations: { 'i-verdict': { blockedBy: [{ id: 'i-verdict-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  // The verdict fields are present and drive the unowned/needs-you re-triage.
  assert.equal(row.blockerChain.needsYou, true, 'verdict.needsYou true for an unowned blocker');
  assert.equal(row.blockerChain.tier, 'needs-you', "tier 'needs-you' for an unowned blocker");
  assert.equal(row.blockerChain.actionAffordance, 'assign', "affordance 'assign' fires ONLY for UNOWNED");
  // The needs-you count is computed off the verdict, not ownerName === 'Unassigned'.
  assert.ok(out.needsYou.count >= 1, 'verdict-driven re-triage counts the unowned row');
});

// ---------------------------------------------------------------------------
// Test 21 (Plan 11-03 D-09/TAX-03) — chain-build throw → UNCLASSIFIED verdict, NOT null
// ---------------------------------------------------------------------------
test('rollup — 11-03: a chain-build throw yields an UNCLASSIFIED verdict row (honest fallback), not blockerChain=null', async () => {
  const a = agent({ id: 'ag-throw', lastHeartbeatMs: NOW - 30 * MIN });
  // The focus issue is blocked, but its ROOT relations.get THROWS → buildEdges
  // propagates the root throw → the rollup's chain-build try/catch fires.
  const blocked = issue({ id: 'i-throw', identifier: 'COU-T1', status: 'blocked', assigneeAgentId: 'ag-throw', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-throw': [blocked] },
    relThrowsFor: new Set(['i-throw']),
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag-throw');
  assert.equal(row.state, 'blocked', 'the row stays blocked (not degraded to unknown)');
  // The honest fallback: an UNCLASSIFIED verdict, NOT a silent null.
  assert.ok(row.blockerChain, 'chain-build throw emits an UNCLASSIFIED verdict, not blockerChain=null');
  assert.equal(row.blockerChain.actionAffordance, 'open', "UNCLASSIFIED affordance is 'open' (never a false 'assign')");
  assert.equal(row.blockerChain.needsYou, false, 'UNCLASSIFIED is not a needs-you (no false assign)');
  assert.equal(row.blockerChain.tier, 'watch', "UNCLASSIFIED tiers to 'watch'");
  assert.ok(typeof row.blockerChain.degradeReason === 'string' && row.blockerChain.degradeReason.length > 0, 'a degradeReason is recorded');
  // The throw must NEVER surface a false "assign owner" → not counted as needs-you.
  assert.equal(out.needsYou.count, 0, 'an UNCLASSIFIED degrade does not inflate needs-you');
});

// ---------------------------------------------------------------------------
// Test 22 (Plan 11-03 D-15 / Pitfall 5) — split identity: no raw UUID in the
// rendered awaitedPartyLabel while targetAgentUuid/targetIssueUuid carry UUIDs.
// ---------------------------------------------------------------------------
test('rollup — 11-03: split identity — awaitedPartyLabel has NO raw UUID; targetAgentUuid/targetIssueUuid carry the UUID (NO_UUID_LEAK)', async () => {
  // An agent-owned, STUCK leaf classifies AWAITING_AGENT_STUCK → verdict carries
  // targetAgentUuid = the agent UUID (mutation-only), affordance 'assign' (Plan
  // 12-01 D-05). The leaf node is a real UUID so targetIssueUuid is UUID-shaped.
  // The rendered awaitedPartyLabel must be scrubbed of every raw UUID.
  const focusUuid = 'ffffffff-1111-2222-3333-444444444444';
  const blockerAgentUuid = 'aaaaaaaa-5555-6666-7777-888888888888';
  const leafUuid = 'bbbbbbbb-9999-0000-1111-222222222222';
  const a = agent({ id: 'ag-split', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: focusUuid, identifier: 'COU-S1', status: 'blocked', assigneeAgentId: 'ag-split', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-split': [blocked] },
    relations: {
      // The leaf node is owned by a STUCK agent (no heartbeat → conservative stuck)
      // with no human owner / eta → AWAITING_AGENT_STUCK.
      [focusUuid]: { blockedBy: [{ id: leafUuid, assigneeUserId: null, assigneeAgentId: blockerAgentUuid, status: 'blocked', etaIso: null, lastHeartbeatAt: null }], blocks: [] },
      [leafUuid]: { blockedBy: [], blocks: [] },
    },
    issuesById: { [leafUuid]: { id: leafUuid, identifier: 'COU-S2' } },
    agentsByUuid: { [blockerAgentUuid]: { name: 'Stuck Agent' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  // RENDER-SCAN: the only displayed string carries no raw UUID.
  assert.ok(!UUID_RE.test(row.blockerChain.awaitedPartyLabel), `awaitedPartyLabel leaked a UUID: ${row.blockerChain.awaitedPartyLabel}`);
  assert.ok(!UUID_RE.test(row.blockerChain.humanAction), `humanAction leaked a UUID: ${row.blockerChain.humanAction}`);
  // SOURCE-SCAN: the mutation-only ids carry the UUIDs (never rendered).
  assert.equal(row.blockerChain.targetIssueUuid, leafUuid, 'targetIssueUuid carries the leaf UUID');
  assert.ok(UUID_RE.test(row.blockerChain.targetIssueUuid), 'targetIssueUuid is UUID-shaped (mutation id)');
  // The stuck-agent leaf surfaces the agent UUID as the mutation target, never rendered.
  assert.equal(row.blockerChain.targetAgentUuid, blockerAgentUuid, 'targetAgentUuid carries the stuck-agent UUID');
  assert.equal(row.blockerChain.actionAffordance, 'assign', "AWAITING_AGENT_STUCK affordance is 'assign' (Plan 12-01 D-05)");
});

// ---------------------------------------------------------------------------
// Test 23 (Plan 14-04 Task 1 — BLOCKER 2+4 / T-14-19) — needsDurabilityFlip is
// derived from the LEAF issue status === 'blocked', NOT from terminal.kind. A
// single-hop blocked leaf (the focus issue itself, status='blocked') → true.
// ---------------------------------------------------------------------------
test('rollup — 14-04: single-hop blocked leaf emits needsDurabilityFlip true + terminalKind matching the terminal', async () => {
  const a = agent({ id: 'ag-flip', lastHeartbeatMs: NOW - 30 * MIN });
  // A genuinely-unowned blocked single-hop leaf → UNOWNED terminal. The focus
  // issue is status='blocked' (single-hop: the leaf IS the focus), so
  // needsDurabilityFlip must be true off the REAL leaf status.
  const blocked = issue({ id: 'i-flip', identifier: 'COU-F1', status: 'blocked', assigneeAgentId: 'ag-flip', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-flip': [blocked] },
    relations: { 'i-flip': { blockedBy: [{ id: 'i-flip-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  assert.equal(row.blockerChain.needsDurabilityFlip, true, 'blocked leaf → needsDurabilityFlip true');
  // terminalKind is the leaf Terminal kind string (here UNOWNED), carried for isReplyReachable.
  assert.equal(typeof row.blockerChain.terminalKind, 'string', 'terminalKind is a kind string');
  assert.equal(row.blockerChain.terminalKind, 'UNOWNED', 'terminalKind matches the flattened terminal');
});

// ---------------------------------------------------------------------------
// Test 24 (Plan 14-04 Task 1 — T-14-19) — an AWAITING_HUMAN awaiting-answer leaf
// whose RESOLVED leaf status is NOT 'blocked' → needsDurabilityFlip false. This
// is the BLOCKER-2+4 correctness assertion: the flip is OFF leaf status, NOT off
// terminal.kind (an AWAITING_HUMAN row would be a flip-true bug if proxied).
// ---------------------------------------------------------------------------
test('rollup — 14-04: multi-hop leaf whose resolved status is not "blocked" → needsDurabilityFlip false (off leaf status, not terminal.kind)', async () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const focusUuid = 'ffffffff-0000-1111-2222-333333333333';
  const leafUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const a = agent({ id: 'ag-noflip', lastHeartbeatMs: NOW - 30 * MIN });
  // The FOCUS issue is status='blocked' (so a row is built), but the MULTI-HOP
  // leaf (fetched at the existing issues.get) resolves to status='awaiting' — so
  // the flip must read the resolved leaf status (false), NOT focusIssue.status.
  const blocked = issue({ id: focusUuid, identifier: 'COU-NF', status: 'blocked', assigneeAgentId: 'ag-noflip', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-noflip': [blocked] },
    relations: {
      [focusUuid]: { blockedBy: [{ id: leafUuid, assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] },
      [leafUuid]: { blockedBy: [], blocks: [] },
    },
    // The resolved leaf carries a NON-blocked status → flip false.
    issuesById: { [leafUuid]: { id: leafUuid, identifier: 'COU-NF2', status: 'awaiting' } },
    agentsByUuid: { [viewer]: { name: 'You' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', viewer);
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  assert.equal(row.blockerChain.terminalKind, 'AWAITING_HUMAN', 'terminal is AWAITING_HUMAN');
  assert.equal(row.blockerChain.needsDurabilityFlip, false, 'resolved leaf status not blocked → flip false (NOT proxied off terminal.kind)');
});

// ---------------------------------------------------------------------------
// Test 25 (Plan 14-04 Task 1) — the multi-hop path reads the RESOLVED leaf
// status from the SAME existing issues.get (a blocked resolved leaf → true),
// proving no new fetch and that the resolved status (not focusIssue.status) wins.
// ---------------------------------------------------------------------------
test('rollup — 14-04: multi-hop resolved-leaf status "blocked" → needsDurabilityFlip true (reuses the existing leaf fetch)', async () => {
  const focusUuid = 'ffffffff-1111-2222-3333-444444444444';
  const leafUuid = 'aaaaaaaa-1111-cccc-dddd-eeeeeeeeeeee';
  const a = agent({ id: 'ag-mhflip', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: focusUuid, identifier: 'COU-MH', status: 'blocked', assigneeAgentId: 'ag-mhflip', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-mhflip': [blocked] },
    relations: {
      [focusUuid]: { blockedBy: [{ id: leafUuid, assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
      [leafUuid]: { blockedBy: [], blocks: [] },
    },
    issuesById: { [leafUuid]: { id: leafUuid, identifier: 'COU-MH2', status: 'blocked' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  assert.equal(row.blockerChain.needsDurabilityFlip, true, 'resolved leaf status blocked → flip true');
});

// ---------------------------------------------------------------------------
// Test 26 (Plan 14-04 Task 1) — the UNCLASSIFIED degrade row carries
// terminalKind === 'UNCLASSIFIED' and an honest needsDurabilityFlip off the
// real focusIssue.status (blocked by construction here → true).
// ---------------------------------------------------------------------------
test('rollup — 14-04: UNCLASSIFIED degrade row carries terminalKind "UNCLASSIFIED" + needsDurabilityFlip off focusIssue.status', async () => {
  const a = agent({ id: 'ag-uflip', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-uflip', identifier: 'COU-U1', status: 'blocked', assigneeAgentId: 'ag-uflip', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-uflip': [blocked] },
    relThrowsFor: new Set(['i-uflip']), // root relations.get throws → UNCLASSIFIED degrade row
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag-uflip');
  assert.ok(row.blockerChain, 'UNCLASSIFIED degrade emits a chain (not null)');
  assert.equal(row.blockerChain.terminalKind, 'UNCLASSIFIED', "degrade row terminalKind is 'UNCLASSIFIED'");
  // focusIssue.status === 'blocked' by construction (state==='blocked') → honest true.
  assert.equal(row.blockerChain.needsDurabilityFlip, true, 'degrade flip honestly off focusIssue.status (blocked)');
});
