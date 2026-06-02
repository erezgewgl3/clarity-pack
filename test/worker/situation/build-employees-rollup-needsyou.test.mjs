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
  // Plan 11-03 (D-13/D-14) — assert the ENGINE VERDICT (the new re-triage key),
  // not the legacy ownerName display string: a genuinely-unowned chain has
  // needsYou true + affordance 'assign' (UNOWNED). The ownerName display value is
  // still 'Unassigned' but the count is computed off the verdict (SC5).
  assert.equal(row.blockerChain.needsYou, true, 'verdict.needsYou true for an unowned chain');
  assert.equal(row.blockerChain.actionAffordance, 'assign', "verdict affordance 'assign' for UNOWNED");
  assert.equal(row.blockerChain.ownerName, 'Unassigned', 'display ownerName remains Unassigned');
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

// ===========================================================================
// Plan 12-02 (NY-01/NY-02) — D-11 exclusion + leverage rank + per-leaf dedup +
// D-12 highest-leverage topAction.
// ===========================================================================

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function issueWith({ id, identifier, status = 'blocked', assigneeAgentId = null, lastActivityMs = null }) {
  return { id, identifier, title: `Title ${identifier}`, status, assigneeAgentId, lastActivityAt: lastActivityMs != null ? iso(lastActivityMs) : null };
}

// ---------------------------------------------------------------------------
// Test 6 (D-11) — agent-working + self-resolving rows are EXCLUDED from Needs-you
// ---------------------------------------------------------------------------
test('needsYou (12-02 D-11): AWAITING_AGENT_WORKING + SELF_RESOLVING rows are EXCLUDED from Needs-you', async () => {
  const working = agent({ id: 'ag-working', lastHeartbeatMs: NOW - 30 * MIN });
  const selfres = agent({ id: 'ag-selfres', lastHeartbeatMs: NOW - 30 * MIN });
  const blockedWorking = issueWith({ id: 'i-working', identifier: 'COU-W1', assigneeAgentId: 'ag-working', lastActivityMs: NOW - 2 * HOUR });
  const blockedSelf = issueWith({ id: 'i-selfres', identifier: 'COU-SR1', assigneeAgentId: 'ag-selfres', lastActivityMs: NOW - 2 * HOUR });
  const blockerAgentUuid = 'aaaaaaaa-1111-2222-3333-444444444444';
  const ctx = makeCtx({
    agents: [working, selfres],
    issuesByAgent: { 'ag-working': [blockedWorking], 'ag-selfres': [blockedSelf] },
    relations: {
      // A live (heartbeat fresh) agent-owned leaf → AWAITING_AGENT_WORKING (needsYou false).
      'i-working': { blockedBy: [{ id: 'wkr-x', assigneeUserId: null, assigneeAgentId: blockerAgentUuid, status: 'blocked', etaIso: null, lastHeartbeatAt: iso(NOW - 1 * MIN) }], blocks: [] },
      // An eta-bearing, owner-less leaf → SELF_RESOLVING (needsYou false).
      'i-selfres': { blockedBy: [{ id: 'sr-x', assigneeUserId: null, status: 'blocked', etaIso: iso(NOW + 4 * HOUR) }], blocks: [] },
    },
    agentsByUuid: { [blockerAgentUuid]: { name: 'Worker Agent' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  const wRow = out.employees.find((r) => r.agentId === 'ag-working');
  const sRow = out.employees.find((r) => r.agentId === 'ag-selfres');
  // Both verdicts are non-needs-you.
  assert.equal(wRow.blockerChain.needsYou, false, 'AWAITING_AGENT_WORKING is not needs-you');
  assert.equal(sRow.blockerChain.needsYou, false, 'SELF_RESOLVING is not needs-you');
  // The hard invariant: neither inflates the Needs-you count.
  assert.equal(out.needsYou.count, 0, 'agent-working + self-resolving never enter Needs-you (D-11)');
  assert.equal(out.needsYou.topAction, null, 'no needs-you item → no topAction');
});

// ---------------------------------------------------------------------------
// Test 7 (D-11 / 12-01) — AWAITING_AGENT_STUCK (affordance now 'assign') is STILL
// excluded from Needs-you because needsYou is false (tier 'watch').
// ---------------------------------------------------------------------------
test('needsYou (12-02 D-11): AWAITING_AGENT_STUCK is EXCLUDED from Needs-you even though its affordance is now "assign"', async () => {
  const stuck = agent({ id: 'ag-stuck', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issueWith({ id: 'i-stuck', identifier: 'COU-ST1', assigneeAgentId: 'ag-stuck', lastActivityMs: NOW - 2 * HOUR });
  const blockerAgentUuid = 'bbbbbbbb-5555-6666-7777-888888888888';
  const ctx = makeCtx({
    agents: [stuck],
    issuesByAgent: { 'ag-stuck': [blocked] },
    relations: {
      // Agent-owned leaf with NO heartbeat → conservative-stuck → AWAITING_AGENT_STUCK.
      'i-stuck': { blockedBy: [{ id: 'stk-x', assigneeUserId: null, assigneeAgentId: blockerAgentUuid, status: 'blocked', etaIso: null, lastHeartbeatAt: null }], blocks: [] },
    },
    agentsByUuid: { [blockerAgentUuid]: { name: 'Stuck Agent' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  const row = out.employees.find((r) => r.agentId === 'ag-stuck');
  assert.equal(row.blockerChain.actionAffordance, 'assign', '12-01: stuck affordance is now assign');
  assert.equal(row.blockerChain.needsYou, false, 'but the verdict is NOT needs-you (tier watch)');
  assert.equal(out.needsYou.count, 0, 'stuck is excluded from the loud Needs-you list (D-04/D-11)');
  assert.equal(out.needsYou.topAction, null);
});

// ---------------------------------------------------------------------------
// Test 8 (D-01/D-02/D-12) — leverage ranking: highest-leverage leaf wins topAction;
// order is time-free.
// ---------------------------------------------------------------------------
test('needsYou (12-02 D-12): topAction = the HIGHEST-LEVERAGE item (the leaf that frees the most), not the oldest', async () => {
  // Two unowned agents whose chains both terminate at the SAME leaf 'shared-leaf'
  // (leverage 2) and one unowned agent at a lone leaf 'lone-leaf' (leverage 1).
  // The shared leaf frees more → it is the topAction even though one of its rows
  // is the NEWEST (so an oldest-based pick would have chosen the lone older row).
  const agents = [
    agent({ id: 'ag-share-old', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-share-new', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-lone', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-share-old': [issueWith({ id: 'i-so', identifier: 'COU-SO', assigneeAgentId: 'ag-share-old', lastActivityMs: NOW - 1 * HOUR })],
    'ag-share-new': [issueWith({ id: 'i-sn', identifier: 'COU-SN', assigneeAgentId: 'ag-share-new', lastActivityMs: NOW - 1 * HOUR })],
    // The lone row is the OLDEST by activity — an oldest pick would choose it.
    'ag-lone': [issueWith({ id: 'i-lone', identifier: 'COU-LONE', assigneeAgentId: 'ag-lone', lastActivityMs: NOW - 50 * HOUR })],
  };
  const relations = {
    // Both share-* focus issues are blocked by the SAME unowned leaf node.
    'i-so': { blockedBy: [{ id: 'shared-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-sn': { blockedBy: [{ id: 'shared-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-lone': { blockedBy: [{ id: 'lone-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    // The shared leaf is itself a genuinely-unowned terminal.
    'shared-leaf': { blockedBy: [], blocks: [] },
    'lone-leaf': { blockedBy: [], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  // Per-leaf dedup: 'shared-leaf' (frees 2) + 'lone-leaf' (frees 1) → 2 action items.
  assert.equal(out.needsYou.count, 2, 'per-leaf dedup: two distinct leaves → count 2 (D-03)');
  // D-12 — topAction is the highest-leverage item (the shared leaf), NOT the oldest lone row.
  assert.ok(out.needsYou.topAction, 'topAction present');
  assert.ok(
    ['ag-share-old', 'ag-share-new'].includes(out.needsYou.topAction.agentId),
    `topAction must come from the highest-leverage shared leaf, got ${out.needsYou.topAction.agentId}`,
  );
  assert.notEqual(out.needsYou.topAction.agentId, 'ag-lone', 'NOT the oldest lone row (D-12: highest-leverage wins)');
});

// ---------------------------------------------------------------------------
// Test 9 (D-02 time-invariance) — changing a row's activity timestamp does NOT
// change the leverage order / topAction pick.
// ---------------------------------------------------------------------------
test('needsYou (12-02 D-02): topAction is time-free — flipping the lone row to the NEWEST does not change the highest-leverage pick', async () => {
  // Identical to Test 8 but the lone row is now the NEWEST. The leverage order is
  // independent of activity time, so topAction STILL comes from the shared leaf.
  const agents = [
    agent({ id: 'ag-share-old', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-share-new', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-lone', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-share-old': [issueWith({ id: 'i-so', identifier: 'COU-SO', assigneeAgentId: 'ag-share-old', lastActivityMs: NOW - 40 * HOUR })],
    'ag-share-new': [issueWith({ id: 'i-sn', identifier: 'COU-SN', assigneeAgentId: 'ag-share-new', lastActivityMs: NOW - 40 * HOUR })],
    // Lone row is now the NEWEST.
    'ag-lone': [issueWith({ id: 'i-lone', identifier: 'COU-LONE', assigneeAgentId: 'ag-lone', lastActivityMs: NOW - 1 * MIN })],
  };
  const relations = {
    'i-so': { blockedBy: [{ id: 'shared-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-sn': { blockedBy: [{ id: 'shared-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-lone': { blockedBy: [{ id: 'lone-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'shared-leaf': { blockedBy: [], blocks: [] },
    'lone-leaf': { blockedBy: [], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  assert.equal(out.needsYou.count, 2);
  assert.ok(
    ['ag-share-old', 'ag-share-new'].includes(out.needsYou.topAction.agentId),
    `topAction still highest-leverage regardless of activity time, got ${out.needsYou.topAction.agentId}`,
  );
});

// ---------------------------------------------------------------------------
// Test 10 (D-03) — per-leaf dedup count: two needs-you rows at the same leaf
// collapse to ONE action item.
// ---------------------------------------------------------------------------
test('needsYou (12-02 D-03): two needs-you rows terminating at the same leaf collapse to ONE action item', async () => {
  const agents = [
    agent({ id: 'ag-1', lastHeartbeatMs: NOW - 30 * MIN }),
    agent({ id: 'ag-2', lastHeartbeatMs: NOW - 30 * MIN }),
  ];
  const issuesByAgent = {
    'ag-1': [issueWith({ id: 'i-1', identifier: 'COU-1', assigneeAgentId: 'ag-1', lastActivityMs: NOW - 2 * HOUR })],
    'ag-2': [issueWith({ id: 'i-2', identifier: 'COU-2', assigneeAgentId: 'ag-2', lastActivityMs: NOW - 3 * HOUR })],
  };
  const relations = {
    'i-1': { blockedBy: [{ id: 'one-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'i-2': { blockedBy: [{ id: 'one-leaf', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] },
    'one-leaf': { blockedBy: [], blocks: [] },
  };
  const ctx = makeCtx({ agents, issuesByAgent, relations });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  assert.equal(out.needsYou.count, 1, 'two rows, one shared leaf → ONE deduped action item (D-03)');
  assert.ok(out.needsYou.topAction, 'a single deduped item still yields a topAction');
});

// ---------------------------------------------------------------------------
// Test 11 (NO_UUID_LEAK) — topAction.humanAction carries no raw UUID after the
// leverage repoint.
// ---------------------------------------------------------------------------
test('needsYou (12-02 NO_UUID_LEAK): topAction.humanAction has no raw UUID', async () => {
  const a = agent({ id: 'ag-leak', lastHeartbeatMs: NOW - 30 * MIN });
  const blockerUuid = 'cccccccc-1111-2222-3333-444444444444';
  const blocked = issueWith({ id: 'i-leak', identifier: 'COU-LEAK', assigneeAgentId: 'ag-leak', lastActivityMs: NOW - 2 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-leak': [blocked] },
    relations: { 'i-leak': { blockedBy: [{ id: blockerUuid, assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  assert.ok(out.needsYou.topAction, 'topAction present');
  assert.ok(!UUID_RE.test(out.needsYou.topAction.humanAction), `topAction.humanAction leaked a UUID: ${out.needsYou.topAction.humanAction}`);
});
