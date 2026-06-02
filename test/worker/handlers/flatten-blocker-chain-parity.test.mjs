// test/worker/handlers/flatten-blocker-chain-parity.test.mjs
//
// Plan 11-02 Task 3 — SC5 parity + the graceful() EXTERNAL-lie fix.
//
// SC5 (the two worker BFS builders must agree): walkBlockerChain (the Reader
// handler's private BFS) must emit the IDENTICAL nodeMeta field set as buildEdges
// (the shared Situation Room / rollup builder), so the same chain classifies the
// same way on both surfaces. This test pins the key-set parity and the
// agent-owned-leaf classification, and confirms a thrown relations.get degrades
// to UNCLASSIFIED (never the old EXTERNAL lie).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { walkBlockerChain } from '../../../src/worker/handlers/flatten-blocker-chain.ts';
import { buildEdges } from '../../../src/worker/handlers/org-blocked-backlog.ts';
import { flattenBlockerChain } from '../../../src/shared/blocker-chain.ts';

// A structural issues client (Reader path) + a structural backlog ctx
// (Situation Room path) over the SAME relations fixture, so any nodeMeta drift
// between the two builders fails this test.
function makeRelationsFixture() {
  const agentUuid = 'ffffffff-1111-2222-3333-444444444444';
  // Root i-root blocked by an AGENT-owned leaf i-leaf with a fresh heartbeat.
  return {
    agentUuid,
    relations: {
      'i-root': {
        blockedBy: [
          {
            id: 'i-leaf',
            assigneeUserId: null,
            ownerUserId: null,
            assigneeAgentId: agentUuid,
            status: 'in_progress',
            etaIso: null,
            lastHeartbeatMs: Date.now() - 60 * 1000, // fresh ⇒ working
            hasQueuedWork: true,
          },
        ],
        blocks: [],
      },
      'i-leaf': { blockedBy: [], blocks: [] },
    },
  };
}

// Reader-path stub: PluginIssuesClient shape, only relations.get is used.
function makeIssuesClient(relations, { throwFor = new Set() } = {}) {
  return {
    relations: {
      async get(id) {
        if (throwFor.has(id)) throw new Error(`relations.get boom for ${id}`);
        return relations[id] ?? { blockedBy: [], blocks: [] };
      },
    },
  };
}

// Situation-Room-path stub: OrgBlockedBacklogCtx shape.
function makeBacklogCtx(relations) {
  return {
    logger: { warn() {} },
    issues: {
      async list() {
        return [];
      },
      relations: {
        async get(id) {
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
  };
}

test('SC5 — walkBlockerChain nodeMeta key set === buildEdges nodeMeta key set (incl. assigneeAgentId + agentState)', async () => {
  const { relations } = makeRelationsFixture();

  const walk = await walkBlockerChain(makeIssuesClient(relations), 'co-1', 'i-root');
  const built = await buildEdges(makeBacklogCtx(relations), 'co-1', 'i-root');

  // Both builders should have produced meta for the SAME blocker node.
  assert.deepEqual(Object.keys(walk.nodeMeta).sort(), Object.keys(built.nodeMeta).sort());

  // The per-node field set must be identical (SC5). Compare sorted key arrays
  // for every node both produced.
  for (const nodeId of Object.keys(built.nodeMeta)) {
    const walkKeys = Object.keys(walk.nodeMeta[nodeId]).sort();
    const builtKeys = Object.keys(built.nodeMeta[nodeId]).sort();
    assert.deepEqual(
      walkKeys,
      builtKeys,
      `nodeMeta field set diverged for ${nodeId}: walk=${walkKeys} built=${builtKeys}`,
    );
    // The new fields must be present in BOTH.
    assert.ok(walkKeys.includes('assigneeAgentId'), 'walk nodeMeta carries assigneeAgentId');
    assert.ok(walkKeys.includes('agentState'), 'walk nodeMeta carries agentState');
  }
});

test('SC5 — the same agent-owned leaf classifies AWAITING_AGENT_WORKING on BOTH builders', async () => {
  const { relations } = makeRelationsFixture();

  const walk = await walkBlockerChain(makeIssuesClient(relations), 'co-1', 'i-root');
  const built = await buildEdges(makeBacklogCtx(relations), 'co-1', 'i-root');

  const readerResult = flattenBlockerChain({
    startId: 'i-root',
    edges: walk.edges,
    nodeMeta: walk.nodeMeta,
    viewerUserId: 'u-viewer',
  });
  const roomResult = flattenBlockerChain({
    startId: 'i-root',
    edges: built.edges,
    nodeMeta: built.nodeMeta,
    viewerUserId: 'u-viewer',
  });

  assert.equal(readerResult.terminal.kind, 'AWAITING_AGENT_WORKING');
  assert.equal(roomResult.terminal.kind, readerResult.terminal.kind);
});

test('D-10 — a thrown ROOT relations.get propagates so the handler degrades to UNCLASSIFIED (never EXTERNAL)', async () => {
  const { relations } = makeRelationsFixture();
  const client = makeIssuesClient(relations, { throwFor: new Set(['i-root']) });

  // walkBlockerChain propagates the root failure (mirrors buildEdges) — this is
  // the signal the handler's catch turns into an UNCLASSIFIED degrade rather
  // than the old EXTERNAL "no chain to flatten" lie.
  await assert.rejects(
    () => walkBlockerChain(client, 'co-1', 'i-root'),
    /relations\.get boom/,
    'root relations.get failure must propagate, not be swallowed into an empty (EXTERNAL) walk',
  );
});

test('Pitfall 3 — an INNER relations.get throw is swallowed; the walk survives (NOT a degrade)', async () => {
  // i-root blocked by i-leaf; i-leaf's own relations.get throws. The inner
  // throw is swallowed, the edge to i-leaf survives, and the leaf classifies
  // normally (agent-owned WORKING) — distinct from a root walk failure.
  const { relations } = makeRelationsFixture();
  const client = makeIssuesClient(relations, { throwFor: new Set(['i-leaf']) });

  const walk = await walkBlockerChain(client, 'co-1', 'i-root');
  assert.ok(walk.edges.length > 0, 'the root edge to the leaf survives the inner throw');
  assert.ok(walk.nodeMeta['i-leaf'], 'the leaf nodeMeta was captured before its inner walk threw');
});
