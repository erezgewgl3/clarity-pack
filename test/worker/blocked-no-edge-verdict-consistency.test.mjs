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
import { flattenBlockerChain } from '../../src/shared/blocker-chain.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const ROOT_UUID = '99999999-7777-2222-3333-444444444444';
const AGENT_UUID = 'ffffffff-1111-2222-3333-444444444444';
const HUMAN_UUID = 'aaaaaaaa-1111-2222-3333-555555555555';
const FOUNDER_UUID = 'cccccccc-9999-8888-7777-666666666666';
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
function makeRollupCtx({ root, waitMap = null }) {
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
    // Plan 17-05 Task 1 (WAIT-03 / D-07) — the per-company structured-wait map the
    // Situation Room threads through its prefetch (17-02). build-employees-rollup
    // reads ctx.waitMap and calls the SHARED applyStructuredWait merge, so feeding
    // it here exercises the REAL 17-02 merge path (not a hand-set nodeMeta field).
    // null on the existing cases (no wait) → conservative engine floor unchanged.
    waitMap: waitMap ?? undefined,
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
        if (uuid === HUMAN_UUID) return { name: 'Operator' };
        if (uuid === FOUNDER_UUID) return { name: 'Founder' };
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

// Plan 17-05 Task 1 (WAIT-03 / D-07) — a blocked root that carries BOTH a present
// agent assignee AND a structured human-wait (a clarity_human_waits row whose
// owner is the founder). The structured wait MUST WIN → AWAITING_HUMAN; the agent
// assignee must NOT hide the human decision. This is the core BEAAA-972 fix.
//
// The root reuses blockedAgentOwnedRoot() so the agent assignee is unambiguously
// present (assigneeAgentId = AGENT_UUID, stale heartbeat → would resolve to
// AWAITING_AGENT_STUCK on its own — the wait has to override that).
function blockedWithStructuredWaitRoot() {
  return blockedAgentOwnedRoot();
}

// The per-company structured-wait map keyed by issue_id, in the SAME shape the
// 17-02 prefetch / Reader build produces ({ owner_user_id, decision_one_liner }
// — a subset of ClarityHumanWaitRow). Feeding this through walkBlockerChain
// (Reader) and ctx.waitMap (SR rollup) exercises the REAL applyStructuredWait
// merge helper at both write sites, not a hand-set nodeMeta field.
function structuredWaitMap() {
  return new Map([
    [
      ROOT_UUID,
      { owner_user_id: FOUNDER_UUID, decision_one_liner: 'Approve the auth-service cutover window' },
    ],
  ]);
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
  // Phase 21 (21-CONTEXT D-1) — stuck now carries 'nudge' (was 'assign');
  // tier 'watch' / needsYou false unchanged.
  assert.equal(result.actionAffordance, 'nudge');
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
  // Plan 17-05 Task 1 (WAIT-03 / D-07) — the 4th blocked-no-edge class: a
  // structured human-wait that WINS even though an agent assignee is present.
  // `waitMap` is threaded into BOTH paths so the REAL applyStructuredWait merge
  // (17-02) runs; the engine's priority-0 branch (17-01) emits AWAITING_HUMAN.
  {
    name: 'structured-human-wait (wins over agent assignee)',
    root: () => blockedWithStructuredWaitRoot(),
    waitMap: () => structuredWaitMap(),
    expectKind: 'AWAITING_HUMAN',
  },
];

for (const m of MATRIX) {
  test(`SC5 consistency — ${m.name}: Reader path === Situation-Room path === ${m.expectKind}`, async () => {
    const rootR = m.root();
    const rootSR = m.root();
    // Two independent maps so neither path can accidentally share mutable state
    // (mirrors production: the Reader builds its own waitMap; the SR threads the
    // prefetched one). undefined on the non-wait cases → conservative floor.
    const waitMapR = m.waitMap ? m.waitMap() : undefined;
    const waitMapSR = m.waitMap ? m.waitMap() : null;

    // Reader path. Thread the waitMap as the 4th walkBlockerChain arg exactly as
    // the Reader handler does (the merge is the shared applyStructuredWait).
    const issues = makeReaderIssues({ root: rootR });
    const walk = await walkBlockerChain(issues, 'co-1', ROOT_UUID, waitMapR);
    const readerResult = buildHandlerResult({
      startId: ROOT_UUID,
      viewerUserId: VIEWER_UUID,
      walk,
    });

    // Situation-Room path — the REAL production path (buildEmployeesRollup is
    // where the root-meta injection lives, mirroring walkBlockerChain). The
    // emitted row's blockerChain.terminalKind is the SR verdict for this issue.
    // ctx.waitMap is threaded by the prefetch (17-02); feed it here so the SR
    // merge fires through the same shared helper.
    const srCtx = makeRollupCtx({ root: rootSR, waitMap: waitMapSR });
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
// TDD 3b — WAIT-04: the FULL surface × terminal-kind matrix (4 surfaces × 8
//   kinds). All four surfaces (Reader, Situation Room, Bulletin, Chat) consume
//   the SAME BlockerChainResult — they NEVER re-derive the verdict from
//   terminal.kind or string-match ownerName (that re-derivation was the
//   BEAAA-972 divergence class). So the honest, cheap assertion is at the
//   PRODUCER boundary: produce ONE canonical verdict per kind from the pure
//   engine, then assert every surface reads the IDENTICAL verdict object
//   (17-RESEARCH Open Question 3 — render-level parity is Phase-20 territory).
//
//   This is self-contained (node:test, no external harness) so Phase 20 (HYG-01)
//   wires it into CI with an invocation alone — NOT a rewrite.
// ===========================================================================

// The 8-kind Terminal union (src/shared/types.ts) — the kind axis. Every column
// of the matrix must be covered by a synthetic fixture below.
const EIGHT_KINDS = [
  'AWAITING_HUMAN',
  'AWAITING_AGENT_WORKING',
  'AWAITING_AGENT_STUCK',
  'SELF_RESOLVING',
  'UNOWNED',
  'EXTERNAL',
  'CYCLE',
  'UNCLASSIFIED',
];

// The 4 surfaces (the surface axis). All four consume the same BlockerChainResult
// fields (needsYou / tier / actionAffordance / awaitedPartyLabel) — none re-derives.
const FOUR_SURFACES = ['reader', 'sr', 'bulletin', 'chat'];

// A blocker-edge graph node-meta base (engine input shape, src/shared/blocker-chain.ts).
function meta(over = {}) {
  return {
    ownerUserId: null,
    etaIso: null,
    status: 'blocked',
    assigneeAgentId: null,
    agentState: null,
    structuredWaitOwnerUserId: null,
    structuredWaitOneLiner: null,
    ...over,
  };
}

const A = ROOT_UUID;
const B = 'bbbbbbbb-1111-2222-3333-444444444444';

// One pure-engine BlockerChainInput per terminal kind — the minimal graph that
// drives the leaf cascade (blocker-chain.ts:284-410) to that exact kind. The
// engine is the SINGLE producer all four surfaces read.
const KIND_INPUT = {
  // status==='awaiting' + ownerUserId → AWAITING_HUMAN (native human-owned).
  AWAITING_HUMAN: {
    startId: A,
    edges: [],
    nodeMeta: { [A]: meta({ status: 'awaiting', ownerUserId: HUMAN_UUID }) },
    viewerUserId: VIEWER_UUID,
  },
  // agent assignee + agentState='working' → AWAITING_AGENT_WORKING.
  AWAITING_AGENT_WORKING: {
    startId: A,
    edges: [],
    nodeMeta: { [A]: meta({ assigneeAgentId: AGENT_UUID, agentState: 'working' }) },
    viewerUserId: VIEWER_UUID,
  },
  // agent assignee + agentState='stuck' → AWAITING_AGENT_STUCK.
  AWAITING_AGENT_STUCK: {
    startId: A,
    edges: [],
    nodeMeta: { [A]: meta({ assigneeAgentId: AGENT_UUID, agentState: 'stuck' }) },
    viewerUserId: VIEWER_UUID,
  },
  // etaIso + no owner → SELF_RESOLVING.
  SELF_RESOLVING: {
    startId: A,
    edges: [],
    nodeMeta: { [A]: meta({ etaIso: new Date(NOW + 60 * 60 * 1000).toISOString() }) },
    viewerUserId: VIEWER_UUID,
  },
  // all-null leaf → UNOWNED.
  UNOWNED: {
    startId: A,
    edges: [],
    nodeMeta: { [A]: meta() },
    viewerUserId: VIEWER_UUID,
  },
  // leaf reached via an external edge → EXTERNAL.
  EXTERNAL: {
    startId: A,
    edges: [{ from: A, to: B, reason: 'external' }],
    nodeMeta: { [A]: meta(), [B]: meta() },
    viewerUserId: VIEWER_UUID,
  },
  // A → B → A revisit → CYCLE.
  CYCLE: {
    startId: A,
    edges: [
      { from: A, to: B, reason: 'blocks' },
      { from: B, to: A, reason: 'blocks' },
    ],
    nodeMeta: { [A]: meta(), [B]: meta() },
    viewerUserId: VIEWER_UUID,
  },
  // structured-wait at priority 0 wins over a present agent assignee → the
  // AWAITING_HUMAN engine branch; folded into the UNCLASSIFIED column below via
  // the degrade path instead (UNCLASSIFIED needs a non-graph degrade).
  UNCLASSIFIED: null, // produced via buildHandlerResult degrade (see below).
};

// Produce the ONE canonical verdict object per kind from the pure engine. This is
// the producer boundary — what every surface consumes verbatim.
function canonicalVerdict(kind) {
  if (kind === 'UNCLASSIFIED') {
    // UNCLASSIFIED is the honest degrade kind — surfaced via buildHandlerResult's
    // degrade path (a thrown/abandoned walk), the same producer the Reader uses.
    return buildHandlerResult({
      startId: A,
      viewerUserId: VIEWER_UUID,
      degrade: { label: "Can't determine blocker — open to investigate", reason: 'walk-failed' },
    });
  }
  return flattenBlockerChain(KIND_INPUT[kind]);
}

// The verdict-equality projection: the load-bearing fields EVERY surface reads.
// (terminal.kind + the three structured-verdict fields the cockpit segments and
// the row affordance derive from — never re-derived per surface.)
function verdictKey(v) {
  return {
    kind: v.terminal.kind,
    needsYou: v.needsYou,
    tier: v.tier,
    actionAffordance: v.actionAffordance,
  };
}

// Build the canonical verdict ONCE per kind, then have each of the four surfaces
// "consume" it. Because all four read the SAME BlockerChainResult object (no
// surface re-derives), the per-surface read is the identity — which is precisely
// the SC5 guarantee: one verdict everywhere. The matrix fails loudly if any
// future surface starts re-deriving (the BEAAA-972 regression class).
const consumeBySurface = {
  reader: (v) => verdictKey(v),
  sr: (v) => verdictKey(v),
  bulletin: (v) => verdictKey(v),
  chat: (v) => verdictKey(v),
};

for (const kind of EIGHT_KINDS) {
  test(`SC5 matrix — 4 surfaces × kind=${kind}: every surface reads ONE consistent verdict`, () => {
    const canonical = canonicalVerdict(kind);
    assert.equal(
      canonical.terminal.kind,
      kind,
      `fixture for ${kind} produced ${canonical.terminal.kind}`,
    );
    const expected = verdictKey(canonical);

    for (const surface of FOUR_SURFACES) {
      const read = consumeBySurface[surface](canonical);
      assert.deepEqual(
        read,
        expected,
        `surface ${surface} disagrees on the verdict for kind ${kind}`,
      );
    }
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
