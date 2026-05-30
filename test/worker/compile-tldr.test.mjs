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

// ---------------------------------------------------------------------------
// Plan 250530 — REF + JARGON contract. BEAAA-1047 (2026-05-30) compiled a TL;DR
// that wrapped every cited id in either a markdown link (`[BEAAA-933](...)`) or
// backticks (`` `BEAAA-933` ``) — both bypass the Reader's ref-chip pipeline,
// so the operator saw bare ids without titles. Plus the agent used domain
// jargon (AC4 / HoUW / op-seat / dual-anchor) with no expansion. Tighten the
// prompt at the source so future TL;DRs stop emitting these shapes.
// ---------------------------------------------------------------------------

test('REF CONTRACT (250530): the prompt instructs PLAIN-PROSE ids — explicitly forbids backticks and markdown links around an id', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: ['BEAAA-933'] });
  // The instruction must (a) tell the agent to write the id as plain prose AND
  // (b) explicitly call out BOTH wrapping shapes (backticks + markdown link).
  assert.match(
    prompt,
    /plain prose/i,
    'the prompt instructs ids as plain prose (not backticks, not markdown links)',
  );
  assert.match(
    prompt,
    /backticks?/i,
    'the prompt explicitly forbids backticks around an id',
  );
  assert.match(
    prompt,
    /markdown link|\[.+?\]\(.+?\)/i,
    'the prompt explicitly forbids a markdown link around an id',
  );
  // and explains WHY — so the constraint sticks. The "chip" / "title" rationale
  // tells the agent the Reader does the rendering; wrapping breaks it.
  assert.match(prompt, /chip/i, 'the prompt cites the Reader chip as the rationale');
});

test('REF CONTRACT (250530): the prompt instructs NO restatement of the cited issue title or status next to its id', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  // The chip already shows id + title + status; redundant restatement bloats
  // the TL;DR (the agent has been doing `BEAAA-933 — manual title — in_review`).
  assert.match(prompt, /restate|do not.*(title|status)/i, 'the prompt forbids restating title/status next to the id');
});

test('JARGON CONTRACT (250530): the prompt instructs first-use expansion of abbreviations and domain jargon', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /abbreviation|jargon|expand/i, 'the prompt instructs first-use expansion');
  // and gives a concrete example so the agent has a pattern to copy. Either the
  // explicit "Head of Underwriting" expansion OR the "Acceptance Criterion 4" one.
  assert.match(
    prompt,
    /head of underwriting|acceptance criterion/i,
    'the prompt gives a concrete expansion example',
  );
});
