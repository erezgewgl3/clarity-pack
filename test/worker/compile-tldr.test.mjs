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

import {
  buildTldrPrompt,
  MAX_TOKENS,
  stripMetaProse,
  splitSentences,
  META_PROSE_PATTERNS,
  MIN_USEFUL_TLDR_LEN,
} from '../../src/worker/agents/compile-tldr.ts';

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

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.6 — CONTENT RULE. BEAAA-1000 (2026-05-30) shipped a TL;DR
// that opened with "TL;DR stored as the compile-result document on BEAAA-1168
// and the operation issue is marked done." — the Editor-Agent was describing
// WHERE its own TL;DR was filed instead of summarizing the issue. The chip-
// hide structural fix (v1.1.5) makes the operation refs invisible but the
// prose is still meta-bureaucratic. Tighten the contract at the prompt level
// with explicit BAD vs GOOD examples.
// ---------------------------------------------------------------------------

test('CONTENT RULE (v1.1.6): the prompt forbids meta-information about the compile process / storage / operation issues', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  // The instruction must explicitly call out the failure modes: don't describe
  // HOW the TL;DR is compiled, WHERE it is stored, WHAT operation issue tracks
  // it, or any internal bookkeeping.
  assert.match(prompt, /compiled|stored|operation issue|bookkeeping|meta/i,
    'prompt explicitly forbids meta-information about the compile process');
  // The reader's POV anchor — what they actually want.
  assert.match(prompt, /what.*issue.*about|decision.*flight|next action/i,
    'prompt restates the reader\'s POV: what is the issue / decision / next action');
});

test('CONTENT RULE (v1.1.6): the prompt explicitly forbids referencing clarity-pack internal operation issues', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  // The agent should not name its own compile-tracking issues at all — they
  // carry UUID-bearing titles and the reader has no context for them.
  assert.match(
    prompt,
    /operation issue|compile-result|compile.*TL;DR|uuid/i,
    'prompt names the forbidden reference shape (operation issues / compile-result / UUID titles)',
  );
});

test('CONTENT RULE (v1.1.6): the prompt carries a BAD example AND a GOOD example so the agent has a concrete template', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  // BAD example: includes the exact phrase from the failed BEAAA-1000 TL;DR.
  assert.match(prompt, /BAD example|what NOT to write|do not write/i,
    'prompt labels a BAD example');
  // GOOD example: contrasting template the agent should follow.
  assert.match(prompt, /GOOD example|what TO write|should write/i,
    'prompt labels a GOOD example');
  // The BAD example should reference the actual failure (compile-result on an
  // operation issue) so the agent can pattern-match.
  assert.match(prompt, /compile-result/i,
    'the BAD example mentions compile-result (the actual failure mode)');
});

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.7 — DETERMINISTIC META-PROSE STRIPPER. The agent ignores
// the v1.1.6 prompt rules on BEAAA-1000 (cached output was full meta-narration).
// Strip at the worker tier with regex patterns so we don't rely on LLM
// compliance. If the strip leaves the body empty / too short, throw — the
// next view-driven trigger retries (and circuit breaker eventually pauses
// the agent if it can't comply).
// ---------------------------------------------------------------------------

test('v1.1.7 stripMetaProse: the EXACT BEAAA-1000 failure text is stripped to (nearly) empty', () => {
  // Verbatim TL;DR text from the BEAAA-1000 screenshot (2026-05-30). Every
  // sentence is meta — the agent produced a TL;DR-about-its-own-TL;DR with
  // zero substance about what BEAAA-1000 actually is. Post-strip MUST be very
  // short so finalizeTldr's MIN_USEFUL_TLDR_LEN gate fires and the cache is
  // not written.
  const bad = `TL;DR stored as the \`compile-result\` document on BEAAA-1168 and the operation issue is marked done. The TL;DR leads with the Wed 2026-06-03 binding ratification, notes both operational sign-offs closed (BEAAA-1086 — UW operational pre-read of BEAAA-1000 Scope-β engagement plan (for 2026-06-03 CTO ↔ HoUW review) / BEAAA-1103 — Claims Architect operational sign-off of BEAAA-1000 Scope-β SLA + audit-trail (for 2026-06-03 CTO ↔ HoUW review)) with the variance resolved, and points at the post-ratification kickoff path. 82 words, within the ~80-word envelope.`;
  const out = stripMetaProse(bad);
  assert.ok(
    out.length < MIN_USEFUL_TLDR_LEN,
    `the BEAAA-1000 meta-prose TL;DR must strip below ${MIN_USEFUL_TLDR_LEN} chars (got ${out.length}: ${JSON.stringify(out)})`,
  );
});

test('v1.1.7 stripMetaProse: legitimate prose ABOUT the issue (not about the TL;DR) is PRESERVED', () => {
  const good = `Wed 2026-06-03 binding ratification on hold pending HoUW countersign of BEAAA-933.\n\n- Both operational sign-offs closed (BEAAA-1086, BEAAA-1103) — pre-read and sign-off complete.\n- Variance resolved.\n- Next: HoUW countersign on BEAAA-933 to unblock the ratification.`;
  const out = stripMetaProse(good);
  // The substantive content survives unchanged.
  assert.ok(out.includes('Wed 2026-06-03 binding ratification'), 'headline preserved');
  assert.ok(out.includes('HoUW countersign'), 'next-action preserved');
  assert.ok(out.includes('BEAAA-1086'), 'cited refs preserved');
  assert.ok(out.length >= good.length - 5, 'no significant content lost (allow ~5 chars for trim)');
});

test('v1.1.7 stripMetaProse: each individual meta pattern is detected', () => {
  // Each line is meta — the strip should drop them all.
  const lines = [
    'The TL;DR leads with the binding ratification.',
    'TL;DR notes both sign-offs closed.',
    'TL;DR is stored as a compile-result document on BEAAA-1168.',
    'TL;DR opens with the headline.',
    'The operation issue is marked done.',
    '82 words, within the ~80-word envelope.',
    'Within the 80-word envelope.',
    'Stored as the compile-result document.',
  ];
  for (const line of lines) {
    const out = stripMetaProse(line);
    assert.equal(out, '', `should be stripped: ${JSON.stringify(line)} → got ${JSON.stringify(out)}`);
  }
});

test('v1.1.7 stripMetaProse: preserves markdown structure (bullets, headings, paragraphs) on legit prose', () => {
  const md = `# What this is\n\n- Bullet one with substance.\n- Bullet two with substance.\n\nA paragraph with substance about BEAAA-933.`;
  const out = stripMetaProse(md);
  assert.ok(out.includes('# What this is'), 'heading survives');
  assert.ok(out.includes('- Bullet one'), 'bullet survives');
  assert.ok(out.includes('BEAAA-933'), 'ref survives');
});

test('v1.1.7 stripMetaProse: a mix of meta + substantive sentences keeps the substantive ones', () => {
  // A bullet that has BOTH meta and substance gets stripped only at the meta
  // sentence; the substantive sentence survives.
  const mixed = `- The TL;DR leads with X. HoUW countersign is the unblocker. 82 words, within the ~80-word envelope.`;
  const out = stripMetaProse(mixed);
  assert.ok(out.includes('HoUW countersign is the unblocker'), 'substantive middle sentence kept');
  assert.equal(/the TL;DR leads with/i.test(out), false, 'meta head sentence removed');
  assert.equal(/word envelope/i.test(out), false, 'meta tail sentence removed');
});

test('v1.1.7 stripMetaProse: pure substantive prose is unchanged (zero false positives)', () => {
  const fine = `Upgrade POST /scanner/v1/rescans from doc-only to measurement, with a claims-suitable latency SLA and timestamped audit-trail linkage. Commissioned per BEAAA-974. Why this is now scoped: tabletop #1 named G7 as the gap that blocks measured ARE evidence re-pull at adjudication time.`;
  const out = stripMetaProse(fine);
  assert.equal(out, fine.trim(), 'a clean TL;DR is unchanged by the strip');
});

test('v1.1.7 stripMetaProse: empty / null / non-string input returns empty string (never throws)', () => {
  assert.equal(stripMetaProse(''), '');
  assert.equal(stripMetaProse(null), '');
  assert.equal(stripMetaProse(undefined), '');
  assert.equal(stripMetaProse(42), '');
  assert.equal(stripMetaProse({ body: 'x' }), '');
});

test('v1.1.7 META_PROSE_PATTERNS: each pattern is exported as a RegExp', () => {
  assert.ok(Array.isArray(META_PROSE_PATTERNS));
  assert.ok(META_PROSE_PATTERNS.length >= 5, 'at least 5 patterns');
  for (const p of META_PROSE_PATTERNS) {
    assert.ok(p instanceof RegExp, `pattern is a RegExp: ${p}`);
  }
});

test('v1.1.7 MIN_USEFUL_TLDR_LEN: a positive integer (the post-strip minimum)', () => {
  assert.equal(typeof MIN_USEFUL_TLDR_LEN, 'number');
  assert.ok(MIN_USEFUL_TLDR_LEN >= 20 && MIN_USEFUL_TLDR_LEN <= 200,
    'reasonable minimum (a useful headline + something is at least ~50 chars)');
});

test('v1.1.7 splitSentences: splits on `. ` followed by an uppercase / paren start', () => {
  const parts = splitSentences('First sentence. Second sentence. Third sentence.');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'First sentence.');
  assert.equal(parts[1], 'Second sentence.');
  assert.equal(parts[2], 'Third sentence.');
});

test('v1.1.7 splitSentences: a single sentence stays one element', () => {
  const parts = splitSentences('Just one sentence here.');
  assert.deepEqual(parts, ['Just one sentence here.']);
});

test('v1.1.7 splitSentences: empty input returns []', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences(null), []);
});
