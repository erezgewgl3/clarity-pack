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

import { flattenBlockerChain } from '../../src/shared/blocker-chain.ts';

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

test('PRIM-03 deterministic-graph-only — blocker-chain.ts source contains zero LLM/AI references', () => {
  const src = readFileSync(BLOCKER_CHAIN_SRC, 'utf8');
  const banned = /\b(openai|anthropic|claude_local|llm|gpt|completion)\b/i;
  assert.ok(
    !banned.test(src),
    'blocker-chain.ts must contain zero LLM references — PRIM-03 requires deterministic graph code only',
  );
});
