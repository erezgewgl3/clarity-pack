// test/worker/compile-tldr.test.mjs
//
// Plan 07-02 Task 3 (D-I3-03) — tighten the TL;DR compile prompt to a hard,
// founder-readable shape: a 1-2 sentence headline + at most 3 bullets + a length
// cap, voice = "for a busy founder: lead with the decision, then the current
// state, then the single next action." The old prompt (just "Compile a
// plain-English TL;DR") gave the agent no shape, so it emitted long, raw-markdown
// blobs the operator could not skim. The INPUT cap (MAX_TOKENS) is unchanged —
// this only tightens the OUTPUT-shape instructions in the prompt scaffolding.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildTldrPrompt, MAX_TOKENS } from '../../src/worker/agents/compile-tldr.ts';

function promptFor(inputs) {
  return buildTldrPrompt({
    surface: 'issue',
    scopeId: 'BEAAA-555',
    inputs,
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
  });
}

test('buildTldrPrompt instructs the busy-founder voice', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /busy founder/i, 'prompt carries the busy-founder voice');
});

test('buildTldrPrompt instructs a hard shape: a 1-2 sentence headline + <=3 bullets + a length cap', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /headline/i, 'a headline instruction');
  assert.match(prompt, /bullets?/i, 'a bullets instruction');
  assert.match(prompt, /3/, 'an at-most-3 bullets cap is present');
  // an explicit OUTPUT length cap (words or short-bullets phrasing)
  assert.match(prompt, /word|short|concise|brief|cap/i, 'an explicit length cap');
});

test('buildTldrPrompt names the decision / current state / next action arc', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /decision/i);
  assert.match(prompt, /(current )?state/i);
  assert.match(prompt, /next action/i);
});

test('buildTldrPrompt keeps the existing input scaffolding (Surface / Scope id / Issue body / comments / refs)', () => {
  const prompt = promptFor({
    body: 'Underwriting timeline needs revision.',
    comments: ['SOC-2 step added'],
    refs: ['BEAAA-141'],
  });
  assert.match(prompt, /Surface:/);
  assert.match(prompt, /Scope id:/);
  assert.match(prompt, /Issue body:/);
  assert.match(prompt, /Underwriting timeline needs revision\./);
  assert.match(prompt, /Recent comments:/);
  assert.match(prompt, /SOC-2 step added/);
  assert.match(prompt, /Referenced ids:.*BEAAA-141/);
});

test('the input token cap (MAX_TOKENS) is unchanged at 16000 (prompt change is OUTPUT-shape only)', () => {
  assert.equal(MAX_TOKENS, 16000);
});
