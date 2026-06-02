// test/worker/handlers/flatten-blocker-chain-scrub.test.mjs
//
// Plan 11-06 Task 1 — the CR-01 BLOCKER fix (failed truth #5 / SC5 / D-15).
//
// flatten-blocker-chain is the ONLY chain producer that did not scrub before
// returning, so raw user/agent/issue UUIDs reached the Reader's
// awaitedPartyLabel. This test pins the NO_UUID_LEAK guarantee on the SUCCESS
// path: after the handler resolves a nameByUuid map from ctx.agents and runs
// scrubHumanAction(result.terminal, viewerUserId, nameByUuid), the returned
// awaitedPartyLabel matches ZERO UUID pattern across every UUID-bearing kind.
//
// It also pins WR-01 (blocker-free → 'none') and the agents.get-throws degrade.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  scrubResultLabel,
  buildHandlerResult,
} from '../../../src/worker/handlers/flatten-blocker-chain.ts';

const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// A structural agents stub: get(uuid, companyId) → { name } or null; can throw.
function makeAgents({ names = {}, throwAll = false } = {}) {
  return {
    async get(uuid) {
      if (throwAll) throw new Error(`agents.get boom for ${uuid}`);
      return names[uuid] ? { name: names[uuid] } : null;
    },
  };
}

const OWNER_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';
const AGENT_UUID = 'bbbbbbbb-5555-6666-7777-888888888888';
const LEAF_UUID = 'cccccccc-9999-0000-1111-222222222222';
const VIEWER_UUID = 'dddddddd-aaaa-bbbb-cccc-eeeeeeeeeeee';

// Build a BlockerChainResult-shaped object with a UUID-bearing terminal label
// (mirrors what flattenBlockerChain returns on the success path — raw label).
function resultWith(terminal) {
  return {
    startId: 'i-root',
    pathIds: ['i-root', LEAF_UUID],
    terminal,
    isStale: false,
    needsYou: terminal.kind === 'AWAITING_HUMAN',
    tier: 'needs-you',
    actionAffordance: 'reply',
    awaitedPartyLabel: terminal.label, // RAW — the leak source
    targetAgentUuid: null,
    targetIssueUuid: LEAF_UUID,
  };
}

test('NO_UUID_LEAK — AWAITING_HUMAN success label is scrubbed of every raw UUID', async () => {
  const terminal = {
    kind: 'AWAITING_HUMAN',
    userId: OWNER_UUID,
    label: `Waiting on ${OWNER_UUID} to act on ${LEAF_UUID}`,
  };
  const result = resultWith(terminal);
  const scrubbed = await scrubResultLabel(
    { agents: makeAgents({ names: { [OWNER_UUID]: 'Dana Owner' } }) },
    'co-1',
    VIEWER_UUID,
    result,
  );
  assert.equal(scrubbed.awaitedPartyLabel.match(UUID_RE_G), null);
  assert.ok(scrubbed.awaitedPartyLabel.includes('Dana Owner'));
});

test('NO_UUID_LEAK — AWAITING_AGENT_STUCK agentId resolves to a name (no UUID)', async () => {
  const terminal = {
    kind: 'AWAITING_AGENT_STUCK',
    agentId: AGENT_UUID,
    label: `Nudge ${AGENT_UUID} (stuck)`,
  };
  const result = resultWith(terminal);
  const scrubbed = await scrubResultLabel(
    { agents: makeAgents({ names: { [AGENT_UUID]: 'Worker Bot' } }) },
    'co-1',
    VIEWER_UUID,
    result,
  );
  assert.equal(scrubbed.awaitedPartyLabel.match(UUID_RE_G), null);
  assert.ok(scrubbed.awaitedPartyLabel.includes('Worker Bot'));
});

test('viewer substitution survives the scrub — userId === viewer → "You"', async () => {
  const terminal = {
    kind: 'AWAITING_HUMAN',
    userId: VIEWER_UUID,
    label: `Waiting on ${VIEWER_UUID}`,
  };
  const result = resultWith(terminal);
  const scrubbed = await scrubResultLabel(
    { agents: makeAgents({ names: { [VIEWER_UUID]: 'Eric' } }) },
    'co-1',
    VIEWER_UUID,
    result,
  );
  assert.equal(scrubbed.awaitedPartyLabel.match(UUID_RE_G), null);
  assert.ok(scrubbed.awaitedPartyLabel.includes('You'));
});

test('agents.get throws → label still UUID-free (agent#<8> fallback, never the raw UUID)', async () => {
  const terminal = {
    kind: 'AWAITING_AGENT_STUCK',
    agentId: AGENT_UUID,
    label: `Nudge ${AGENT_UUID}`,
  };
  const result = resultWith(terminal);
  const scrubbed = await scrubResultLabel(
    { agents: makeAgents({ throwAll: true }) },
    'co-1',
    VIEWER_UUID,
    result,
  );
  assert.equal(scrubbed.awaitedPartyLabel.match(UUID_RE_G), null);
  assert.ok(scrubbed.awaitedPartyLabel.includes('agent#'));
});

test('absent ctx.agents → label still UUID-free (empty map, agent#<8> fallback)', async () => {
  const terminal = {
    kind: 'EXTERNAL',
    label: `External (${LEAF_UUID})`,
  };
  const result = resultWith(terminal);
  const scrubbed = await scrubResultLabel({}, 'co-1', VIEWER_UUID, result);
  assert.equal(scrubbed.awaitedPartyLabel.match(UUID_RE_G), null);
});

test('CYCLE + UNOWNED labels scrub to zero UUIDs', async () => {
  for (const terminal of [
    { kind: 'CYCLE', cycleNodes: [LEAF_UUID], label: `Cycle: ${LEAF_UUID} → ${LEAF_UUID}` },
    { kind: 'UNOWNED', label: `No owner on ${LEAF_UUID}` },
  ]) {
    const scrubbed = await scrubResultLabel(
      { agents: makeAgents() },
      'co-1',
      VIEWER_UUID,
      resultWith(terminal),
    );
    assert.equal(
      scrubbed.awaitedPartyLabel.match(UUID_RE_G),
      null,
      `${terminal.kind} label leaked a UUID`,
    );
  }
});

test('WR-01 — a blocker-free handler result carries actionAffordance "none"', () => {
  // buildHandlerResult routes the (walk.edges.length === 0) case through
  // makeBlockerFreeResult, which forces 'none'.
  const res = buildHandlerResult({
    startId: 'i-root',
    walk: { edges: [], nodeMeta: {} },
    viewerUserId: VIEWER_UUID,
  });
  assert.equal(res.actionAffordance, 'none');
  assert.equal(res.awaitedPartyLabel.match(UUID_RE_G), null);
});

test('UNCLASSIFIED degrade path is preserved (honest open-to-investigate, no assign)', () => {
  const res = buildHandlerResult({
    startId: 'i-root',
    degrade: { label: 'Relations unavailable', reason: 'relations-walk-failed' },
    viewerUserId: VIEWER_UUID,
  });
  assert.equal(res.terminal.kind, 'UNCLASSIFIED');
  assert.equal(res.degradeReason, 'relations-walk-failed');
  assert.notEqual(res.actionAffordance, 'assign');
});
