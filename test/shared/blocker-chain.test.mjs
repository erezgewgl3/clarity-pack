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

import { flattenBlockerChain, pickTopChains } from '../../src/shared/blocker-chain.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOCKER_CHAIN_SRC = path.resolve(HERE, '..', '..', 'src', 'shared', 'blocker-chain.ts');

test('HUMAN_ACTION_ON — A→B→C, C is awaiting eric, terminal is HUMAN_ACTION_ON(eric); pathIds=[A,B,C]', () => {
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
  assert.equal(result.terminal.kind, 'HUMAN_ACTION_ON');
  assert.equal(result.terminal.userId, 'eric');
  assert.equal(typeof result.terminal.label, 'string');
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
    case 'HUMAN_ACTION_ON':
      terminal = { kind, userId: 'eric', label: `${startId} human` };
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
    default:
      terminal = { kind: 'EXTERNAL', label: 'x' };
  }
  return { startId, pathIds: [startId], terminal, isStale: false };
}

test('pickTopChains — sorts HUMAN_ACTION_ON first, then SELF_RESOLVING, EXTERNAL, CYCLE', () => {
  const input = [
    chainOf('CYCLE', 'c'),
    chainOf('EXTERNAL', 'e'),
    chainOf('SELF_RESOLVING', 's'),
    chainOf('HUMAN_ACTION_ON', 'h'),
  ];
  const ranked = pickTopChains(input, 10);
  assert.deepEqual(
    ranked.map((c) => c.terminal.kind),
    ['HUMAN_ACTION_ON', 'SELF_RESOLVING', 'EXTERNAL', 'CYCLE'],
  );
});

test('pickTopChains — slice(0, max) caps the result length', () => {
  const input = [
    chainOf('HUMAN_ACTION_ON', 'h1'),
    chainOf('HUMAN_ACTION_ON', 'h2'),
    chainOf('SELF_RESOLVING', 's1'),
    chainOf('EXTERNAL', 'e1'),
  ];
  const ranked = pickTopChains(input, 2);
  assert.equal(ranked.length, 2);
  // The two highest-priority survive the cap.
  assert.deepEqual(
    ranked.map((c) => c.terminal.kind),
    ['HUMAN_ACTION_ON', 'HUMAN_ACTION_ON'],
  );
});

test('pickTopChains — empty list yields empty list', () => {
  assert.deepEqual(pickTopChains([], 5), []);
});

test('pickTopChains — is pure (does not mutate the input array order)', () => {
  const input = [
    chainOf('CYCLE', 'c'),
    chainOf('HUMAN_ACTION_ON', 'h'),
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
