// test/worker/agents/tldr-truncation.test.mjs
//
// View-driven rework (2026-05-28) — the TL;DR input cap behavior changes from
// "throw and skip" to "raise the cap, and TRUNCATE as a backstop with a notice."
//
// Live evidence (BEAAA paperclipai@2026.525.0): long tasks (e.g. the strategy
// memo) hit the old 4000-token cap and were SKIPPED → "No TL;DR yet" forever on
// exactly the tasks most worth summarizing. Decision (operator): raise the cap so
// the agent summarizes the whole task; for pathological inputs beyond the raised
// cap, head/tail-truncate and SURFACE that it was truncated.
//
// Pins: the raised cap; the truncation helper (no-op under cap; head+tail over
// cap; keeps refs; flags truncated); and prepareTldrCompile returning
// kind:'compile' with truncated:true for an oversized input (never the old
// throw/skip).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  MAX_TOKENS,
  truncateTldrInputs,
  prepareTldrCompile,
  estimateTokens,
  buildTldrPrompt,
} from '../../../src/worker/agents/compile-tldr.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';

test('MAX_TOKENS is raised to 16000 (agent summarizes the whole task; old 4000 skipped long tasks)', () => {
  assert.equal(MAX_TOKENS, 16000);
});

test('truncateTldrInputs is a no-op when the input is within the cap', () => {
  const inputs = { body: 'a short task body', comments: ['one comment'], refs: ['BEAAA-1'] };
  const out = truncateTldrInputs(inputs, MAX_TOKENS);
  assert.equal(out.truncated, false);
  assert.equal(out.inputs.body, inputs.body);
  assert.deepEqual(out.inputs.comments, inputs.comments);
  assert.deepEqual(out.inputs.refs, inputs.refs, 'refs are preserved');
});

test('truncateTldrInputs head+tail-truncates an oversized body, flags truncated, and the result fits the cap', () => {
  // ~40k tokens of body → well over the 16k cap.
  const head = 'HEAD_MARKER ' + 'x'.repeat(80_000);
  const tail = 'y'.repeat(80_000) + ' TAIL_MARKER';
  const inputs = { body: head + tail, comments: [], refs: ['BEAAA-9'] };

  const out = truncateTldrInputs(inputs, MAX_TOKENS);

  assert.equal(out.truncated, true, 'oversized input is flagged truncated');
  // The truncated prompt must fit the cap.
  const prompt = buildTldrPrompt({
    surface: 'issue', scopeId: 'BEAAA-9', inputs: out.inputs,
    agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1',
  });
  assert.ok(estimateTokens(prompt) <= MAX_TOKENS, `truncated prompt must fit the cap, got ${estimateTokens(prompt)}`);
  // Head and tail are both retained (a middle-cut, not a head-only chop).
  assert.ok(out.inputs.body.includes('HEAD_MARKER'), 'keeps the opening');
  assert.ok(out.inputs.body.includes('TAIL_MARKER'), 'keeps the latest section');
  assert.deepEqual(out.inputs.refs, inputs.refs, 'refs preserved through truncation');
});

test('prepareTldrCompile returns kind:compile with truncated:true for an oversized input (no throw/skip)', async () => {
  resetCircuitBreakerState();
  // A ctx whose tldr_cache is empty (no cache hit).
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: { async query() { return []; }, async execute() { return { rowCount: 1 }; } },
  };
  const oversized = 'z'.repeat(200_000); // ~50k tokens
  const prep = await prepareTldrCompile(ctx, {
    surface: 'issue', scopeId: 'BEAAA-OVER', inputs: { body: oversized, comments: [], refs: [] },
    agentKey: 'editor-agent', agentId: 'uuid-1', companyId: 'co-1',
  });
  assert.equal(prep.kind, 'compile', `oversized input must now compile (truncated), not skip; got ${prep.kind}`);
  assert.equal(prep.truncated, true, 'prepare flags the truncation so the UI can surface it');
  assert.ok(estimateTokens(prep.prompt) <= MAX_TOKENS, 'the delivered prompt fits the cap');
});
