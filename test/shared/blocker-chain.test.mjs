// test/shared/blocker-chain.test.mjs
//
// Plan 02-02 Task 1 — covers PRIM-03 (deterministic DFS, no LLM), PRIM-04 (cycle
// detection terminal), and PRIM-05 (HUMAN_ACTION_ON terminal). The four terminals
// (HUMAN_ACTION_ON | SELF_RESOLVING | EXTERNAL | CYCLE) are the canonical contract
// in 02-02-PLAN.md <interfaces>.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  classifyVerdict,
  flattenBlockerChain,
  makeBlockerFreeResult,
  makeDegradedResult,
  pickTopChains,
} from '../../src/shared/blocker-chain.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOCKER_CHAIN_SRC = path.resolve(HERE, '..', '..', 'src', 'shared', 'blocker-chain.ts');

test('AWAITING_HUMAN — A→B→C, C is awaiting eric, terminal is AWAITING_HUMAN(eric); pathIds=[A,B,C]; needsYou verdict', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [
      { from: 'A', to: 'B', reason: 'blocks' },
      { from: 'B', to: 'C', reason: 'blocks' },
    ],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'blocked' },
      C: { ownerUserId: 'eric', etaIso: null, status: 'awaiting' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.startId, 'A');
  assert.deepEqual(result.pathIds, ['A', 'B', 'C']);
  assert.equal(result.terminal.kind, 'AWAITING_HUMAN');
  assert.equal(result.terminal.userId, 'eric');
  assert.equal(typeof result.terminal.label, 'string');
  // D-13 verdict — a person must act.
  assert.equal(result.needsYou, true);
  assert.equal(result.tier, 'needs-you');
  assert.equal(result.actionAffordance, 'reply');
  assert.equal(typeof result.awaitedPartyLabel, 'string');
  assert.equal(result.targetIssueUuid, 'C');
});

test('AWAITING_AGENT_WORKING — walks THROUGH agent to a live agent leaf; in-motion, not needs-you (SC2)', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'B', reason: 'blocks' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'in_progress', assigneeAgentId: 'agent-actuary', agentState: 'working' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'AWAITING_AGENT_WORKING');
  assert.equal(result.terminal.agentId, 'agent-actuary');
  assert.equal(result.needsYou, false);
  assert.equal(result.tier, 'in-motion');
  assert.equal(result.actionAffordance, 'none');
  // D-15 split identity — agent UUID carried for dispatch, not rendered text.
  assert.equal(result.targetAgentUuid, 'agent-actuary');
});

test('AWAITING_AGENT_STUCK — agentState missing ⇒ conservative STUCK (D-04); watch tier + nudge', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'B', reason: 'blocks' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      // assigneeAgentId set, agentState absent → STUCK conservatively.
      B: { ownerUserId: null, etaIso: null, status: 'blocked', assigneeAgentId: 'agent-cfo' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'AWAITING_AGENT_STUCK');
  assert.equal(result.terminal.agentId, 'agent-cfo');
  assert.equal(result.needsYou, false);
  assert.equal(result.tier, 'watch');
  assert.equal(result.actionAffordance, 'nudge');
  assert.equal(result.targetAgentUuid, 'agent-cfo');
});

test('UNOWNED — leaf with no owner, no agent, no eta ⇒ genuine UNOWNED; needs-you + assign (the ONLY honest assign)', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'B', reason: 'blocks' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'blocked' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'UNOWNED');
  // D-11 — UNOWNED carries NO userId.
  assert.equal(result.terminal.userId, undefined);
  assert.equal(result.needsYou, true);
  assert.equal(result.tier, 'needs-you');
  assert.equal(result.actionAffordance, 'assign');
});

test('UNCLASSIFIED — classifyVerdict maps the degrade kind to watch/open/no-assign (D-12)', () => {
  const verdict = classifyVerdict({ kind: 'UNCLASSIFIED', label: 'x' });
  assert.equal(verdict.tier, 'watch');
  assert.equal(verdict.actionAffordance, 'open');
  assert.equal(verdict.needsYou, false);
});

test('classifyVerdict — encodes the design-seed Section 1 table for all 8 kinds', () => {
  const table = {
    AWAITING_HUMAN: { tier: 'needs-you', actionAffordance: 'reply', needsYou: true },
    AWAITING_AGENT_WORKING: { tier: 'in-motion', actionAffordance: 'none', needsYou: false },
    AWAITING_AGENT_STUCK: { tier: 'watch', actionAffordance: 'nudge', needsYou: false },
    SELF_RESOLVING: { tier: 'watch', actionAffordance: 'none', needsYou: false },
    EXTERNAL: { tier: 'watch', actionAffordance: 'open', needsYou: false },
    CYCLE: { tier: 'watch', actionAffordance: 'open', needsYou: false },
    UNOWNED: { tier: 'needs-you', actionAffordance: 'assign', needsYou: true },
    UNCLASSIFIED: { tier: 'watch', actionAffordance: 'open', needsYou: false },
  };
  for (const [kind, expected] of Object.entries(table)) {
    // Minimal terminal stub per kind — classifyVerdict reads only the discriminant.
    let terminal;
    if (kind === 'AWAITING_HUMAN') terminal = { kind, userId: 'u', label: 'l' };
    else if (kind === 'AWAITING_AGENT_WORKING' || kind === 'AWAITING_AGENT_STUCK') terminal = { kind, agentId: 'a', label: 'l' };
    else if (kind === 'SELF_RESOLVING') terminal = { kind, etaIso: '2026-06-02T00:00:00Z', label: 'l' };
    else if (kind === 'CYCLE') terminal = { kind, cycleNodes: ['A'], label: 'l' };
    else terminal = { kind, label: 'l' };
    assert.deepEqual(classifyVerdict(terminal), expected, `classifyVerdict(${kind}) must match the table`);
  }
});

test('SELF_RESOLVING — leaf has etaIso and no owner; terminal is SELF_RESOLVING with etaIso preserved', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'B', reason: 'blocks' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: '2026-05-20T12:00:00Z', status: 'in_progress' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'SELF_RESOLVING');
  assert.equal(result.terminal.etaIso, '2026-05-20T12:00:00Z');
});

test('EXTERNAL — final edge reason="external" produces EXTERNAL terminal', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'B', reason: 'external' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'external' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'EXTERNAL');
});

test('WR-05 — reached-via-external EXTERNAL branch: terminal.label names the SAME node as targetIssueUuid (current)', () => {
  // A→B via an external edge; B is the leaf reached via external.
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'B', reason: 'external' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'external' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'EXTERNAL');
  assert.equal(result.targetIssueUuid, 'B');
  assert.ok(
    result.terminal.label.includes(result.targetIssueUuid),
    `label "${result.terminal.label}" must name targetIssueUuid "${result.targetIssueUuid}"`,
  );
});

test('WR-05 — only-external-children EXTERNAL branch: label names the LEAF (current), not the refused child id', () => {
  // A is the leaf; its only outgoing edge is external (to child X). The walk does
  // NOT recurse into X — it fires EXTERNAL on A. Before the fix the label named X
  // (externalEdge.to) while targetIssueUuid was A — a mis-attribution (WR-05).
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [{ from: 'A', to: 'X', reason: 'external' }],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      X: { ownerUserId: null, etaIso: null, status: 'external' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'EXTERNAL');
  // The leaf reached is A — both label and targetIssueUuid must name A.
  assert.equal(result.targetIssueUuid, 'A');
  assert.ok(
    result.terminal.label.includes('A'),
    `label "${result.terminal.label}" must name the leaf "A"`,
  );
  assert.ok(
    !result.terminal.label.includes('X'),
    `label "${result.terminal.label}" must NOT name the refused child "X" (WR-05)`,
  );
});

test('IN-04 — makeDegradedResult returns a BlockerChainResult whose verdict matches classifyVerdict and whose ids target startId', () => {
  const terminal = { kind: 'UNCLASSIFIED', label: "Can't determine blocker for A" };
  const result = makeDegradedResult(terminal, 'A', 'max-depth-exceeded');
  const verdict = classifyVerdict(terminal);
  assert.equal(result.startId, 'A');
  assert.deepEqual(result.pathIds, ['A']);
  assert.equal(result.terminal, terminal);
  assert.equal(result.isStale, false);
  assert.equal(result.needsYou, verdict.needsYou);
  assert.equal(result.tier, verdict.tier);
  assert.equal(result.actionAffordance, verdict.actionAffordance);
  assert.equal(result.awaitedPartyLabel, terminal.label);
  assert.equal(result.targetAgentUuid, null);
  assert.equal(result.targetIssueUuid, 'A');
  assert.equal(result.degradeReason, 'max-depth-exceeded');
});

test('IN-04 — makeDegradedResult with empty startId yields empty pathIds and null targetIssueUuid', () => {
  const terminal = { kind: 'UNCLASSIFIED', label: 'x' };
  const result = makeDegradedResult(terminal, '');
  assert.deepEqual(result.pathIds, []);
  assert.equal(result.targetIssueUuid, null);
  assert.equal(result.degradeReason, undefined);
});

test('WR-01 — blocker-free synthetic case carries actionAffordance "none" (not the EXTERNAL "open" lie)', () => {
  const result = makeBlockerFreeResult('A', 'No active blockers');
  // The blocker-free row must be non-actionable — no dead "Open ↗" button.
  assert.equal(result.actionAffordance, 'none');
  assert.equal(result.needsYou, false);
  assert.equal(result.tier, 'watch');
  assert.equal(result.startId, 'A');
  assert.equal(result.targetIssueUuid, 'A');
  assert.equal(result.targetAgentUuid, null);
});

test('WR-01 — genuine EXTERNAL still maps to "open" (a real external blocker stays openable)', () => {
  const verdict = classifyVerdict({ kind: 'EXTERNAL', label: 'External (A)' });
  assert.equal(verdict.actionAffordance, 'open');
});

test('CYCLE — A→B→C→A is detected; terminal.kind=CYCLE; cycleNodes contains A,B,C in canonical order (smallest first); returns in <5ms (no infinite loop)', () => {
  const start = process.hrtime.bigint();
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [
      { from: 'A', to: 'B', reason: 'blocks' },
      { from: 'B', to: 'C', reason: 'blocks' },
      { from: 'C', to: 'A', reason: 'blocks' },
    ],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'blocked' },
      C: { ownerUserId: null, etaIso: null, status: 'blocked' },
    },
    viewerUserId: 'eric',
  });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result.terminal.kind, 'CYCLE');
  assert.ok(elapsedMs < 5, `cycle detection must return within 5ms; took ${elapsedMs.toFixed(2)}ms`);
  // Canonical order: smallest id first; full set contains A,B,C
  const cycleSet = new Set(result.terminal.cycleNodes);
  assert.deepEqual([...cycleSet].sort(), ['A', 'B', 'C']);
  assert.equal(result.terminal.cycleNodes[0], 'A', 'canonical order — smallest id first');
});

test('Determinism — same input produces same output bytes across 100 invocations', () => {
  const input = {
    startId: 'A',
    edges: [
      { from: 'A', to: 'B', reason: 'blocks' },
      { from: 'B', to: 'C', reason: 'blocks' },
    ],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'blocked' },
      C: { ownerUserId: 'eric', etaIso: null, status: 'awaiting' },
    },
    viewerUserId: 'eric',
  };
  const ref = JSON.stringify(flattenBlockerChain(input));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(
      JSON.stringify(flattenBlockerChain(input)),
      ref,
      `iteration ${i} diverged from reference output`,
    );
  }
});

// ---------------------------------------------------------------------------
// Plan 07-03 Task 1 — pickTopChains MOVED into the shared module (single
// source of truth for the HUMAN_ACTION_ON-first ranking; the recompute-
// situation job + the org-blocked-backlog builder both import it from here).
// Verbatim semantics from situation-snapshot.ts:286-303 (priority
// HUMAN_ACTION_ON=0 > SELF_RESOLVING=1 > EXTERNAL=2 > CYCLE=3; stable sort
// then slice(0, max); pure).
// ---------------------------------------------------------------------------

/** Build a BlockerChainResult of a given terminal kind for ranking tests. */
function chainOf(kind, startId) {
  let terminal;
  switch (kind) {
    case 'AWAITING_HUMAN':
      terminal = { kind, userId: 'eric', label: `${startId} human` };
      break;
    case 'AWAITING_AGENT_WORKING':
    case 'AWAITING_AGENT_STUCK':
      terminal = { kind, agentId: 'agent', label: `${startId} agent` };
      break;
    case 'SELF_RESOLVING':
      terminal = { kind, etaIso: '2026-05-30T00:00:00Z', label: `${startId} self` };
      break;
    case 'EXTERNAL':
      terminal = { kind, label: `${startId} external` };
      break;
    case 'CYCLE':
      terminal = { kind, cycleNodes: [startId], label: `${startId} cycle` };
      break;
    case 'UNOWNED':
    case 'UNCLASSIFIED':
      terminal = { kind, label: `${startId} ${kind}` };
      break;
    default:
      terminal = { kind: 'EXTERNAL', label: 'x' };
  }
  return { startId, pathIds: [startId], terminal, isStale: false };
}

test('pickTopChains — ranks needs-you kinds first per the 8-kind order (D-07/Pitfall 6)', () => {
  const input = [
    chainOf('UNCLASSIFIED', 'x'),
    chainOf('CYCLE', 'c'),
    chainOf('EXTERNAL', 'e'),
    chainOf('AWAITING_AGENT_STUCK', 'as'),
    chainOf('AWAITING_AGENT_WORKING', 'aw'),
    chainOf('SELF_RESOLVING', 's'),
    chainOf('UNOWNED', 'u'),
    chainOf('AWAITING_HUMAN', 'h'),
  ];
  const ranked = pickTopChains(input, 10);
  assert.deepEqual(
    ranked.map((c) => c.terminal.kind),
    [
      'AWAITING_HUMAN',
      'UNOWNED',
      'SELF_RESOLVING',
      'AWAITING_AGENT_WORKING',
      'AWAITING_AGENT_STUCK',
      'EXTERNAL',
      'CYCLE',
      'UNCLASSIFIED',
    ],
  );
});

test('pickTopChains — slice(0, max) caps the result length', () => {
  const input = [
    chainOf('AWAITING_HUMAN', 'h1'),
    chainOf('AWAITING_HUMAN', 'h2'),
    chainOf('SELF_RESOLVING', 's1'),
    chainOf('EXTERNAL', 'e1'),
  ];
  const ranked = pickTopChains(input, 2);
  assert.equal(ranked.length, 2);
  // The two highest-priority survive the cap.
  assert.deepEqual(
    ranked.map((c) => c.terminal.kind),
    ['AWAITING_HUMAN', 'AWAITING_HUMAN'],
  );
});

test('pickTopChains — empty list yields empty list', () => {
  assert.deepEqual(pickTopChains([], 5), []);
});

test('pickTopChains — is pure (does not mutate the input array order)', () => {
  const input = [
    chainOf('CYCLE', 'c'),
    chainOf('AWAITING_HUMAN', 'h'),
  ];
  const before = input.map((c) => c.startId).join(',');
  pickTopChains(input, 10);
  const after = input.map((c) => c.startId).join(',');
  assert.equal(before, after, 'pickTopChains must not mutate the input array');
});

test('PRIM-03 deterministic-graph-only — blocker-chain.ts source contains zero LLM/AI references', () => {
  const src = readFileSync(BLOCKER_CHAIN_SRC, 'utf8');
  const banned = /\b(openai|anthropic|claude_local|llm|gpt|completion)\b/i;
  assert.ok(
    !banned.test(src),
    'blocker-chain.ts must contain zero LLM references — PRIM-03 requires deterministic graph code only',
  );
});
