// test/worker/structured-human-wait-verdict.test.mjs
//
// Phase 17 Plan 17-01 Task 2 (WAIT-02/WAIT-03, D-07/D-08) — engine-level proof
// that a persisted structured human-wait classifies as AWAITING_HUMAN and WINS
// over a nominal agent assignee.
//
// This asserts the two-field contract on nodeMeta directly against the PURE
// engine (flattenBlockerChain + classifyVerdict) — no worker, no DB, no AI.
// Self-contained (node:test, no external harness) so Phase 20 can wire it into
// CI unchanged.
//
//   D-07: structuredWaitOwnerUserId beats BOTH status==='awaiting' AND
//         assigneeAgentId — a real human decision must not hide behind a
//         nominally-assigned agent (the core BEAAA-972 fix).
//   D-08: the structured wait REUSES the existing AWAITING_HUMAN terminal kind
//         (no 9th kind); classifyVerdict maps it to needs-you / reply /
//         needsYou:true with ZERO change to classifyVerdict.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { classifyVerdict, flattenBlockerChain } from '../../src/shared/blocker-chain.ts';

const FOUNDER_UUID = 'aaaaaaaa-1111-2222-3333-555555555555';
const AGENT_UUID = 'ffffffff-1111-2222-3333-444444444444';
const VIEWER_UUID = 'dddddddd-aaaa-bbbb-cccc-eeeeeeeeeeee';
const ROOT_ID = '99999999-7777-2222-3333-444444444444';
const ONE_LINER = 'Pick the launch date for the auth migration';

// A synthetic root: a single blocked leaf carrying BOTH a structured wait AND
// an agent assignee. No outgoing edges — the leaf IS the terminal (the
// BEAAA-972 empty-edges shape). The structured wait must win.
function makeInput(meta) {
  return {
    startId: ROOT_ID,
    edges: [],
    nodeMeta: { [ROOT_ID]: meta },
    viewerUserId: VIEWER_UUID,
  };
}

test('D-07 — structured wait wins over a present agent assignee → AWAITING_HUMAN(founder)', () => {
  const result = flattenBlockerChain(
    makeInput({
      ownerUserId: null,
      etaIso: null,
      status: 'blocked',
      assigneeAgentId: AGENT_UUID, // agent nominally assigned
      agentState: 'working',
      structuredWaitOwnerUserId: FOUNDER_UUID, // structured wait present
      structuredWaitOneLiner: ONE_LINER,
    }),
  );
  assert.equal(result.terminal.kind, 'AWAITING_HUMAN', 'structured wait wins over agent');
  assert.equal(result.terminal.userId, FOUNDER_UUID, 'terminal carries the founder user id');
});

test('D-07 — structured wait wins over a native status===awaiting + ownerUserId leaf', () => {
  const result = flattenBlockerChain(
    makeInput({
      ownerUserId: 'someone-else-1111-2222-3333-444444444444',
      etaIso: null,
      status: 'awaiting', // native awaiting branch would otherwise fire first
      assigneeAgentId: null,
      agentState: null,
      structuredWaitOwnerUserId: FOUNDER_UUID,
      structuredWaitOneLiner: ONE_LINER,
    }),
  );
  assert.equal(result.terminal.kind, 'AWAITING_HUMAN');
  assert.equal(result.terminal.userId, FOUNDER_UUID, 'structured-wait founder, not the native owner');
});

test('D-05 — the decision one-liner is in the terminal label', () => {
  const result = flattenBlockerChain(
    makeInput({
      ownerUserId: null,
      etaIso: null,
      status: 'blocked',
      assigneeAgentId: AGENT_UUID,
      agentState: 'working',
      structuredWaitOwnerUserId: FOUNDER_UUID,
      structuredWaitOneLiner: ONE_LINER,
    }),
  );
  assert.ok(
    result.terminal.label.includes(ONE_LINER),
    `label "${result.terminal.label}" must contain the decision one-liner`,
  );
});

test('D-08 — verdict maps to needs-you / reply / needsYou:true with no classifyVerdict change', () => {
  const result = flattenBlockerChain(
    makeInput({
      ownerUserId: null,
      etaIso: null,
      status: 'blocked',
      assigneeAgentId: AGENT_UUID,
      agentState: 'working',
      structuredWaitOwnerUserId: FOUNDER_UUID,
      structuredWaitOneLiner: ONE_LINER,
    }),
  );
  // Engine-derived verdict on the BlockerChainResult.
  assert.equal(result.tier, 'needs-you');
  assert.equal(result.actionAffordance, 'reply');
  assert.equal(result.needsYou, true);
  // And the raw classifyVerdict over the terminal agrees (D-08 reuse).
  const v = classifyVerdict(result.terminal);
  assert.deepEqual(v, { tier: 'needs-you', actionAffordance: 'reply', needsYou: true });
});

test('Fallback label — no one-liner still emits AWAITING_HUMAN(founder)', () => {
  const result = flattenBlockerChain(
    makeInput({
      ownerUserId: null,
      etaIso: null,
      status: 'blocked',
      assigneeAgentId: AGENT_UUID,
      agentState: 'working',
      structuredWaitOwnerUserId: FOUNDER_UUID,
      structuredWaitOneLiner: null,
    }),
  );
  assert.equal(result.terminal.kind, 'AWAITING_HUMAN');
  assert.equal(result.terminal.userId, FOUNDER_UUID);
  assert.ok(result.terminal.label.length > 0, 'fallback label is non-empty');
});

test('Determinism — same structured-wait input is JSON.stringify-equal across 100 runs', () => {
  const input = makeInput({
    ownerUserId: null,
    etaIso: null,
    status: 'blocked',
    assigneeAgentId: AGENT_UUID,
    agentState: 'working',
    structuredWaitOwnerUserId: FOUNDER_UUID,
    structuredWaitOneLiner: ONE_LINER,
  });
  const ref = JSON.stringify(flattenBlockerChain(input));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(JSON.stringify(flattenBlockerChain(input)), ref, `iteration ${i} diverged`);
  }
});

test('No structured wait — agent assignee still classifies AWAITING_AGENT_* (no regression)', () => {
  const result = flattenBlockerChain(
    makeInput({
      ownerUserId: null,
      etaIso: null,
      status: 'blocked',
      assigneeAgentId: AGENT_UUID,
      agentState: 'working',
      structuredWaitOwnerUserId: null,
      structuredWaitOneLiner: null,
    }),
  );
  assert.equal(result.terminal.kind, 'AWAITING_AGENT_WORKING', 'no wait → agent path unchanged');
});
