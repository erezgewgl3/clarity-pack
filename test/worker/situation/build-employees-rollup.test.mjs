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
// Test 10 — within blocked bucket: oldest activity first
// ---------------------------------------------------------------------------
test('rollup — within blocked bucket: older (smaller lastActivityMs) first', async () => {
  const agents = [
    agent({ id: 'ag-new', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-old', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-new': [issue({ id: 'i-new', identifier: 'COU-NEW', status: 'blocked', assigneeAgentId: 'ag-new', lastActivityMs: NOW - 1 * HOUR })],
    'ag-old': [issue({ id: 'i-old', identifier: 'COU-OLD', status: 'blocked', assigneeAgentId: 'ag-old', lastActivityMs: NOW - 10 * HOUR })],
  };
  const relations = {
    'i-new': { blockedBy: [{ id: 'x1', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-old': { blockedBy: [{ id: 'x2', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  assert.equal(out.employees[0].agentId, 'ag-old');
  assert.equal(out.employees[1].agentId, 'ag-new');
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
  // fall back to a UUID (focusIssue.id), NEVER to the human identifier. (focusIssue.id
  // is 'i-m2' in this fixture — a non-identifier id; the UUID source is the focus id.)
  assert.equal(row.blockerChain.leafIssueUuid, 'i-m2', 'leafIssueUuid falls back to focusIssue.id, not the identifier');
  assert.notEqual(row.blockerChain.leafIssueUuid, 'COU-70', 'leafIssueUuid is NOT the human identifier');
});

// ---------------------------------------------------------------------------
// Test 17c (Plan 09-04) — leafIssueUuid is a UUID source, distinct from the human key
// ---------------------------------------------------------------------------
test('rollup — 09-04: blockerChain.leafIssueUuid is UUID-shaped (leaf.id from the leaf fetch) and distinct from the human leafIssueId', async () => {
  const a = agent({ id: 'ag-uuid', lastHeartbeatMs: NOW - 30 * MIN });
  // focusIssue.id is the human-ish start; the chain leaf is a real UUID that
  // resolves via issues.get to an issue carrying both a UUID id and a human identifier.
  const leafUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const blocked = issue({ id: 'i-uuid', identifier: 'COU-90', status: 'blocked', assigneeAgentId: 'ag-uuid', lastActivityMs: NOW - 30 * MIN });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-uuid': [blocked] },
    relations: {
      'i-uuid': { blockedBy: [{ id: leafUuid, assigneeUserId: 'u-owner', status: 'awaiting', etaIso: null }], blocks: [] },
      [leafUuid]: { blockedBy: [], blocks: [] },
    },
    // The leaf issues.get returns an issue whose id is the UUID and identifier the human key.
    issuesById: { [leafUuid]: { id: leafUuid, identifier: 'COU-91' } },
    agentsByUuid: { 'u-owner': { name: 'Owner' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees[0];
  assert.ok(row.blockerChain, 'chain present');
  // leafIssueUuid is UUID-shaped (sourced from leaf.id), the display key is the human identifier.
  assert.equal(row.blockerChain.leafIssueUuid, leafUuid, 'leafIssueUuid = leaf.id (the UUID)');
  assert.ok(UUID_RE.test(row.blockerChain.leafIssueUuid), 'leafIssueUuid is UUID-shaped');
  // The human display key (leafIssueId) is the human identifier, never the UUID.
  assert.equal(row.blockerChain.leafIssueId, 'COU-91', 'leafIssueId is the human identifier');
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
