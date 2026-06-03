// test/worker/blocked-no-edge-verdict-consistency.test.mjs
//
// Phase 12 — SC5 "one verdict everywhere" fix for the blocked-issue-with-NO-
// structured-blockers case (e.g. BEAAA-972).
//
// CONFIRMED PRODUCTION BUG: the SAME blocked issue (status='blocked',
// assigneeAgentId set, ZERO blockedBy edges) got TWO different engine verdicts:
//   - Reader  (walkBlockerChain → buildHandlerResult): empty edges →
//             makeBlockerFreeResult → EXTERNAL "No active blockers" (WRONG — it
//             IS blocked + agent-owned).
//   - Situation Room (buildEdges → flattenBlockerChain): empty edges + NO root
//             meta → the engine fell through to UNOWNED "assign owner" (WRONG —
//             it has an agent owner).
//
// ROOT CAUSE: both BFS walkers only attached nodeMeta for blocker TARGETS, never
// the START/root issue's OWN meta (status, assigneeAgentId, ownerUserId).
//
// THE FIX (this test pins it): attach the ROOT issue's own meta into
// nodeMeta[startId] in BOTH walkers, and route the empty-edges case through the
// SAME pure engine when the root is blocked/owned. Product matrix (locked):
//   blocked + agent-owned  → AWAITING_AGENT_STUCK (tier 'watch', needsYou false)
//   blocked + human-owned  → AWAITING_HUMAN
//   blocked + no-owner     → UNOWNED
//   NOT-blocked + no-edges  → blocker-free EXTERNAL ('none', UNCHANGED)

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  walkBlockerChain,
  buildHandlerResult,
} from '../../src/worker/handlers/flatten-blocker-chain.ts';
import { buildEmployeesRollup } from '../../src/worker/situation/build-employees-rollup.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const ROOT_UUID = '99999999-7777-2222-3333-444444444444';
const AGENT_UUID = 'ffffffff-1111-2222-3333-444444444444';
const HUMAN_UUID = 'aaaaaaaa-1111-2222-3333-555555555555';
const VIEWER_UUID = 'dddddddd-aaaa-bbbb-cccc-eeeeeeeeeeee';
const NOW = Date.now();

// ---------------------------------------------------------------------------
// Reader-path ctx: issues.get (root meta) + issues.relations.get (BFS edges).
// ---------------------------------------------------------------------------
function makeReaderIssues({ root, relations = {} }) {
  return {
    async get(id) {
      return id === ROOT_UUID ? root : null;
    },
    relations: {
      async get(id) {
        return relations[id] ?? { blockedBy: [], blocks: [] };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Situation-Room-path ctx (EmployeesRollupCtx): agents.list + issues.list +
// issues.get + issues.relations.get + agents.get.
// ---------------------------------------------------------------------------
function makeRollupCtx({ root }) {
  // STALE heartbeat (>10 min = 2x the 5-min running window) so the rollup
  // classifies state='blocked' (a fresh heartbeat would be 'running' and skip the
  // blocker-chain build). A stale heartbeat also resolves agentState='stuck' →
  // AWAITING_AGENT_STUCK for the agent-owned case (the BEAAA-972 verdict).
  const agentRow = {
    id: AGENT_UUID,
    name: 'Drill Agent',
    role: 'engineer',
    lastHeartbeatAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
  };
  return {
    logger: { warn() {}, info() {} },
    issues: {
      async list(input) {
        // The agent's only open issue is the blocked root.
        if (input?.assigneeAgentId === AGENT_UUID) return [root];
        return [];
      },
      async get(id) {
        return id === ROOT_UUID ? root : null;
      },
      relations: {
        async get(id) {
          // No structured blockers — this is the BEAAA-972 shape.
          void id;
          return { blockedBy: [], blocks: [] };
        },
      },
    },
    agents: {
      async list() {
        return [agentRow];
      },
      async get(uuid) {
        if (uuid === AGENT_UUID) return { name: 'Drill Agent' };
        if (uuid === HUMAN_UUID) return { name: 'Eric' };
        return null;
      },
    },
  };
}

// A blocked root issue with an agent owner and NO structured blockers.
function blockedAgentOwnedRoot() {
  return {
    id: ROOT_UUID,
    identifier: 'BEAAA-972',
    title: 'Migrate the auth service',
    status: 'blocked',
    assigneeAgentId: AGENT_UUID,
    assigneeUserId: null,
    ownerUserId: null,
    lastActivityAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    lastHeartbeatAt: new Date(NOW - 60 * 1000).toISOString(),
  };
}

// ===========================================================================
// TDD 1 — Reader: blocked + agent + zero blockedBy → AWAITING_AGENT_STUCK.
// ===========================================================================
test('Reader — blocked + agent-owned + zero blockedBy → AWAITING_AGENT_STUCK (NOT EXTERNAL/blocker-free)', async () => {
  const root = blockedAgentOwnedRoot();
  const issues = makeReaderIssues({ root });
  const walk = await walkBlockerChain(issues, 'co-1', ROOT_UUID);
  const result = buildHandlerResult({
    startId: ROOT_UUID,
    viewerUserId: VIEWER_UUID,
    walk,
  });
  assert.equal(result.terminal.kind, 'AWAITING_AGENT_STUCK');
  assert.equal(result.tier, 'watch');
  assert.equal(result.needsYou, false);
  assert.equal(result.actionAffordance, 'assign');
});

// ===========================================================================
// TDD 2 — Situation Room: same synthetic issue → AWAITING_AGENT_STUCK row.
// ===========================================================================
test('Situation Room — blocked + agent-owned + zero blockedBy → terminalKind AWAITING_AGENT_STUCK, watch, needsYou false', async () => {
  const root = blockedAgentOwnedRoot();
  const ctx = makeRollupCtx({ root });
  const { employees } = await buildEmployeesRollup(ctx, 'co-1', VIEWER_UUID);
  const row = employees.find((e) => e.agentId === AGENT_UUID);
  assert.ok(row, 'agent row exists');
  assert.ok(row.blockerChain, 'agent row has a blockerChain');
  assert.equal(row.blockerChain.terminalKind, 'AWAITING_AGENT_STUCK');
  assert.equal(row.blockerChain.tier, 'watch');
  assert.equal(row.blockerChain.needsYou, false);
});

// ===========================================================================
// TDD 3 — SC5 cross-surface consistency across the FULL matrix.
//   Construct ONE synthetic root per matrix case; assert the Reader path AND
//   the Situation-Room path agree on terminal.kind.
// ===========================================================================
const MATRIX = [
  {
    name: 'blocked + agent-owned',
    root: () => blockedAgentOwnedRoot(),
    expectKind: 'AWAITING_AGENT_STUCK',
  },
  {
    name: 'blocked + human-owned',
    root: () => ({
      id: ROOT_UUID,
      identifier: 'BEAAA-973',
      title: 'Approve the budget',
      status: 'blocked',
      assigneeAgentId: null,
      assigneeUserId: HUMAN_UUID,
      ownerUserId: HUMAN_UUID,
      lastActivityAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    }),
    expectKind: 'AWAITING_HUMAN',
  },
  {
    name: 'blocked + no-owner',
    root: () => ({
      id: ROOT_UUID,
      identifier: 'BEAAA-974',
      title: 'Orphaned blocked task',
      status: 'blocked',
      assigneeAgentId: null,
      assigneeUserId: null,
      ownerUserId: null,
      lastActivityAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    }),
    expectKind: 'UNOWNED',
  },
];

for (const m of MATRIX) {
  test(`SC5 consistency — ${m.name}: Reader path === Situation-Room path === ${m.expectKind}`, async () => {
    const rootR = m.root();
    const rootSR = m.root();

    // Reader path.
    const issues = makeReaderIssues({ root: rootR });
    const walk = await walkBlockerChain(issues, 'co-1', ROOT_UUID);
    const readerResult = buildHandlerResult({
      startId: ROOT_UUID,
      viewerUserId: VIEWER_UUID,
      walk,
    });

    // Situation-Room path — the REAL production path (buildEmployeesRollup is
    // where the root-meta injection lives, mirroring walkBlockerChain). The
    // emitted row's blockerChain.terminalKind is the SR verdict for this issue.
    const srCtx = makeRollupCtx({ root: rootSR });
    const { employees } = await buildEmployeesRollup(srCtx, 'co-1', VIEWER_UUID);
    const srRow = employees.find((e) => e.blockerChain != null);
    assert.ok(srRow, `Situation-Room produced a blockerChain row for ${m.name}`);
    const srKind = srRow.blockerChain.terminalKind;

    assert.equal(readerResult.terminal.kind, m.expectKind, `Reader kind for ${m.name}`);
    assert.equal(srKind, m.expectKind, `Situation-Room kind for ${m.name}`);
    assert.equal(
      readerResult.terminal.kind,
      srKind,
      `SC5: surfaces disagree for ${m.name}`,
    );
  });
}

// ===========================================================================
// TDD 4 — Regression guard: a genuinely NOT-blocked, no-blocker issue STILL
//   resolves to blocker-free EXTERNAL / 'none' on the Reader (UNCHANGED).
// ===========================================================================
test('Regression — NOT-blocked + zero edges → blocker-free EXTERNAL, affordance none (UNCHANGED)', async () => {
  const root = {
    id: ROOT_UUID,
    identifier: 'BEAAA-100',
    title: 'A normal in-progress task',
    status: 'in_progress',
    assigneeAgentId: AGENT_UUID,
    assigneeUserId: null,
    ownerUserId: null,
  };
  const issues = makeReaderIssues({ root });
  const walk = await walkBlockerChain(issues, 'co-1', ROOT_UUID);
  const result = buildHandlerResult({
    startId: ROOT_UUID,
    viewerUserId: VIEWER_UUID,
    walk,
  });
  assert.equal(result.terminal.kind, 'EXTERNAL');
  assert.equal(result.actionAffordance, 'none');
  assert.equal(result.needsYou, false);
  assert.equal(result.terminal.label, 'No active blockers');
});

// ===========================================================================
// TDD 5 — NO_UUID_LEAK: the blocked-no-edge terminal label carries no raw UUID
//   after the handler scrub (the label now embeds ROOT_UUID / AGENT_UUID).
// ===========================================================================
test('NO_UUID_LEAK — blocked + agent-owned + no-edge awaitedPartyLabel has no raw UUID after scrub', async () => {
  const root = blockedAgentOwnedRoot();
  // Reader handler full path includes scrubResultLabel; exercise it via the
  // exported scrub on the engine result. Import lazily to avoid a top-level
  // dependency the other tests don't need.
  const { scrubResultLabel } = await import(
    '../../src/worker/handlers/flatten-blocker-chain.ts'
  );
  const issues = makeReaderIssues({ root });
  const walk = await walkBlockerChain(issues, 'co-1', ROOT_UUID);
  const result = buildHandlerResult({
    startId: ROOT_UUID,
    viewerUserId: VIEWER_UUID,
    walk,
  });
  const agents = {
    async get(uuid) {
      return uuid === AGENT_UUID ? { name: 'Drill Agent' } : null;
    },
  };
  const scrubbed = await scrubResultLabel({ agents }, 'co-1', VIEWER_UUID, result);
  assert.equal(
    UUID_RE.test(scrubbed.awaitedPartyLabel),
    false,
    `awaitedPartyLabel leaked a UUID: ${scrubbed.awaitedPartyLabel}`,
  );
});
