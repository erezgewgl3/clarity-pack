// test/worker/situation/build-employees-rollup-needsyou.test.mjs
//
// Plan 09-01 Task 2 (RED) — the un-frozen needsYou compute (R5).
//
// The Phase 8 needsYou counted ONLY viewer-owned blocked chains, so an
// all-unowned org showed a permanent "✓ 0 need you" — the headline signal
// could never fire (09-SPEC.md Background → "Frozen banner"). R5 un-freezes it:
//   count = (unowned blocked rows) ∪ (viewer-targeted blocked rows)   [de-duped by agentId]
//   topAction = oldest unowned blocked row when any unowned exists;
//               else oldest viewer-targeted row (preserve Phase 8 behavior).
//
// WARNING 1 / R4 — for the unowned case topAction MUST carry the oldest-unowned
// row's agentId AND a non-null leafIssueId so 09-02's [Assign first ▾] can drive
// the owner picker (NOT a chat deep-link). A null leafIssueId there would force
// the UI to render a disabled button (an R4 dead-button violation).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildEmployeesRollup } from '../../../src/worker/situation/build-employees-rollup.ts';

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

function makeCtx({ agents = [], issuesByAgent = {}, relations = {}, issuesById = {}, agentsByUuid = {} } = {}) {
  return {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    issues: {
      async list(input) {
        return issuesByAgent[input?.assigneeAgentId ?? ''] ?? [];
      },
      async get(id) {
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
        return agents;
      },
      async get(uuid) {
        return agentsByUuid[uuid] ?? null;
      },
    },
  };
}

function agent({ id, name = `Agent ${id}`, lastHeartbeatMs = null }) {
  return { id, name, role: 'general', title: null, lastHeartbeatAt: lastHeartbeatMs != null ? iso(lastHeartbeatMs) : null };
}

function issue({ id, identifier, status, assigneeAgentId = null, lastActivityMs = null }) {
  return { id, identifier, title: `Title ${identifier}`, status, assigneeAgentId, lastActivityAt: lastActivityMs != null ? iso(lastActivityMs) : null };
}

// ---------------------------------------------------------------------------
// Test 1 — THE un-freeze proof: ≥1 unowned blocked + 0 viewer-owned → count ≥ 1
// ---------------------------------------------------------------------------
test('needsYou (R5): an UNOWNED blocked row with 0 viewer-owned yields count ≥ 1 (the frozen-banner bug fixed)', async () => {
  // The blocker leaf has assigneeUserId null → terminal is __unowned__ →
  // ownerName scrubs to 'Unassigned' → the row is unowned (not viewer-targeted).
  const a = agent({ id: 'ag-unowned', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-un', identifier: 'COU-100', status: 'blocked', assigneeAgentId: 'ag-unowned', lastActivityMs: NOW - 5 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-unowned': [blocked] },
    relations: { 'i-un': { blockedBy: [{ id: 'i-un-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  // The blocked row buckets needs_you and is unowned.
  const row = out.employees.find((r) => r.agentId === 'ag-unowned');
  assert.equal(row.group, 'needs_you');
  assert.equal(row.blockerChain.ownerName, 'Unassigned');
  // R5 — the count must NOW be ≥ 1 (Phase 8 would have returned 0).
  assert.ok(out.needsYou.count >= 1, `un-frozen count must be ≥1, got ${out.needsYou.count}`);
});

// ---------------------------------------------------------------------------
// Test 2 — WARNING 1 / R4: unowned topAction drives the picker (agentId + non-null leafIssueId)
// ---------------------------------------------------------------------------
test('needsYou (R4/WARNING 1): unowned topAction carries the oldest-unowned agentId + a NON-NULL leafIssueId', async () => {
  const agents = [
    agent({ id: 'ag-recent', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-oldest', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-recent': [issue({ id: 'i-recent', identifier: 'COU-R', status: 'blocked', assigneeAgentId: 'ag-recent', lastActivityMs: NOW - 1 * HOUR })],
    'ag-oldest': [issue({ id: 'i-oldest', identifier: 'COU-OLDEST', status: 'blocked', assigneeAgentId: 'ag-oldest', lastActivityMs: NOW - 20 * HOUR })],
  };
  const relations = {
    'i-recent': { blockedBy: [{ id: 'r-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-oldest': { blockedBy: [{ id: 'o-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  assert.equal(out.needsYou.count, 2, 'both unowned blocked rows are counted');
  assert.ok(out.needsYou.topAction, 'topAction must NOT be null when count > 0 (R4 — no dead [Assign first ▾])');
  // Oldest-unowned (smallest lastActivityMs) is ag-oldest.
  assert.equal(out.needsYou.topAction.agentId, 'ag-oldest', 'topAction points to the OLDEST unowned row');
  // WARNING 1 — leafIssueId MUST be non-null so the UI can open THAT row's picker.
  assert.ok(
    out.needsYou.topAction.leafIssueId != null && out.needsYou.topAction.leafIssueId.length > 0,
    `unowned topAction.leafIssueId must be non-null (got ${out.needsYou.topAction.leafIssueId})`,
  );
  // It is the human identifier (COU-OLDEST), never a uuid.
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(out.needsYou.topAction.leafIssueId), 'leafIssueId is no uuid');
  // Plan 09-04 — the unowned topAction MUST also carry a non-null leafIssueUuid
  // (the mutation id the picker dispatches to situation.assignOwner). It mirrors
  // the oldest-unowned row's blockerChain.leafIssueUuid — a UUID source
  // (leaf.id / leafNodeId=picked.pathIds[last]=the chain leaf 'o-x' / focusIssue.id),
  // distinct from the human leafIssueId. Asserted as the robust property
  // (non-null + a UUID-source id distinct from the human key) so it is
  // order/clock-independent across the suite.
  assert.ok(
    out.needsYou.topAction.leafIssueUuid != null && out.needsYou.topAction.leafIssueUuid.length > 0,
    `unowned topAction.leafIssueUuid must be non-null (got ${out.needsYou.topAction.leafIssueUuid})`,
  );
  assert.ok(
    ['o-x', 'i-oldest'].includes(out.needsYou.topAction.leafIssueUuid),
    `unowned topAction.leafIssueUuid is a UUID source (chain leaf or focus id), got ${out.needsYou.topAction.leafIssueUuid}`,
  );
  assert.notEqual(out.needsYou.topAction.leafIssueUuid, out.needsYou.topAction.leafIssueId, 'UUID distinct from the human key');
});

// ---------------------------------------------------------------------------
// Test 3 — zero unowned AND zero viewer-targeted → count 0 (all owned by others)
// ---------------------------------------------------------------------------
test('needsYou (R5): all blockers owned by OTHER users (not viewer, not unowned) → count 0', async () => {
  const someoneElse = 'dddddddd-eeee-ffff-0000-111111111111';
  const a = agent({ id: 'ag-other', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-other', identifier: 'COU-200', status: 'blocked', assigneeAgentId: 'ag-other', lastActivityMs: NOW - 2 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-other': [blocked] },
    relations: { 'i-other': { blockedBy: [{ id: 'i-other-x', assigneeUserId: someoneElse, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [someoneElse]: { name: 'Someone Else' } },
  });
  // viewer is a DIFFERENT user than someoneElse → not viewer-targeted; and the
  // chain IS owned (someoneElse, not __unowned__) → not unowned. So count 0.
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  const row = out.employees.find((r) => r.agentId === 'ag-other');
  assert.equal(row.blockerChain.ownerName, 'Someone Else', 'owned by another user (not Unassigned)');
  assert.equal(out.needsYou.count, 0, 'owned-by-others is neither unowned nor viewer-targeted → 0');
  assert.equal(out.needsYou.topAction, null);
});

// ---------------------------------------------------------------------------
// Test 4 — viewer-targeted preserved: when 0 unowned, topAction = oldest viewer row
// ---------------------------------------------------------------------------
test('needsYou (R5): zero unowned but ≥1 viewer-targeted → count counts viewer rows; topAction = oldest viewer row', async () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const a = agent({ id: 'ag-me', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-me', identifier: 'COU-300', status: 'blocked', assigneeAgentId: 'ag-me', lastActivityMs: NOW - 3 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-me': [blocked] },
    relations: { 'i-me': { blockedBy: [{ id: 'i-me-x', assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [viewer]: { name: 'You' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', viewer);
  assert.equal(out.needsYou.count, 1, 'viewer-targeted blocked row counts (legacy behavior preserved)');
  assert.equal(out.needsYou.topAction.agentId, 'ag-me');
  // Plan 09-04 — the OWNED fallback topAction also carries leafIssueUuid (the
  // mutation id), sourced from the owned row's blockerChain.leafIssueUuid.
  assert.ok(
    out.needsYou.topAction.leafIssueUuid != null && out.needsYou.topAction.leafIssueUuid.length > 0,
    `owned-fallback topAction.leafIssueUuid must be non-null (got ${out.needsYou.topAction.leafIssueUuid})`,
  );
  assert.ok(
    ['i-me-x', 'i-me'].includes(out.needsYou.topAction.leafIssueUuid),
    `owned-fallback leafIssueUuid is a UUID source (chain leaf or focus id), got ${out.needsYou.topAction.leafIssueUuid}`,
  );
  assert.notEqual(out.needsYou.topAction.leafIssueUuid, out.needsYou.topAction.leafIssueId, 'UUID distinct from the human key');
});

// ---------------------------------------------------------------------------
// Test 5 — de-dupe: a single row counts once even if it satisfies both sets
// ---------------------------------------------------------------------------
test('needsYou (R5): count is a Set of agentIds (a row never double-counts)', async () => {
  // Two unowned rows; one also happens to be older. Count must equal 2 (Set
  // size), not 4 (naive sum of two predicate filters over the same rows).
  const agents = [
    agent({ id: 'ag-a', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-b', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-a': [issue({ id: 'i-a', identifier: 'COU-A', status: 'blocked', assigneeAgentId: 'ag-a', lastActivityMs: NOW - 2 * HOUR })],
    'ag-b': [issue({ id: 'i-b', identifier: 'COU-B', status: 'blocked', assigneeAgentId: 'ag-b', lastActivityMs: NOW - 4 * HOUR })],
  };
  const relations = {
    'i-a': { blockedBy: [{ id: 'a-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-b': { blockedBy: [{ id: 'b-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  assert.equal(out.needsYou.count, 2, 'exactly two distinct unowned agentIds');
});
