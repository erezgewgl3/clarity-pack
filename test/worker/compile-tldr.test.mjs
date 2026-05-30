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
  polishTldr,
  isoDateToHuman,
  stripRestatedParenAfterRef,
  stripParensAroundLoneRef,
  applyJargonGlossary,
  JARGON_GLOSSARY,
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

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.8 — TRANSLATOR ROLE + VOICE RULES. The v1.1.6+v1.1.7
// fixes stopped meta-prose, but the resulting TL;DRs still read like agent-
// to-agent reports ("the binding ratification of Scope-β", "operational
// sign-offs closed", ISO dates, passive nominal voice). The operator's
// directive: write like a top-0.1% communicator briefing a busy founder.
// The prompt now frames the Editor-Agent's role as TRANSLATION (agent-
// language → founder-language), with 5 explicit voice rules and a
// stronger BAD/GOOD example pair grounded in the BEAAA-1000 failure.
// ---------------------------------------------------------------------------

test('v1.1.8 ROLE FRAME: the prompt declares the Editor-Agent\'s job as TRANSLATION (not summary)', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  // The role frame must explicitly call out translation as the duty — distinct
  // from "summarize". Translation = convert agent-internal vocabulary to
  // reader-readable English.
  assert.match(prompt, /translation/i, 'prompt declares the role as TRANSLATION');
  // Plus an explicit "internal vocabulary" or "agent language" framing.
  assert.match(prompt, /internal\s+vocabulary|agent[- ]language|agent[- ]term|agent[- ]internal/i,
    'prompt frames the source as agent-internal vocabulary');
});

test('v1.1.8 VOICE RULE 1 — DIRECT ADDRESS: the prompt instructs writing "you" when there is something Eric does', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /\bdirect\s+address\b|\bwrite\s+"you"|\baddress.*reader\b|\bwhen.*you\b/i,
    'prompt instructs direct address using "you"');
  // The contrast — what NOT to use — anchors the rule. Either "the operator"
  // or "ratification is queued" / similar nominal phrasing.
  assert.match(prompt, /\bthe\s+operator\b|\bratification\s+is\s+queued\b|\bqueued\b/i,
    'prompt contrasts "you" with the nominal phrasing it replaces');
});

test('v1.1.8 VOICE RULE 2 — ACTIVE VERBS: the prompt instructs active verbs / present tense', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /active\s+verbs?|present\s+tense/i, 'active verbs / present tense rule');
});

test('v1.1.8 VOICE RULE 3 — CONCRETE > NOMINAL: the prompt instructs concrete decisions over codenames', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /concrete|nominal|plain\s+words|codename/i,
    'prompt instructs concrete-over-nominal phrasing');
});

test('v1.1.8 VOICE RULE 4 — HUMAN DATES: the prompt forbids ISO dates and gives a human-date example', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /human\s+dates?|ISO|2026-06-03/i,
    'prompt addresses date format (rejects ISO)');
  // A concrete human-date example — "Wed 6/3" or "tomorrow morning" or similar.
  assert.match(prompt, /Wed\s+6\/3|6\/3|tomorrow\s+morning/i,
    'prompt gives a concrete human-date example');
});

test('v1.1.8 VOICE RULE 5 — TRANSLATE AGENT TERMS: the prompt names specific agent terms and instructs translation', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /translate.*agent\s+term|every\s+agent\s+term/i,
    'prompt instructs translation of every agent term');
  // Names specific agent-internal terms the agent commonly uses.
  assert.match(prompt, /Scope-?β|operational\s+sign-?off|compile-result|op-seat|pre-read/i,
    'prompt names specific agent-internal terms that need translation');
});

test('v1.1.8 BAD/GOOD EXAMPLE PAIR: the GOOD example demonstrates the new voice rules (you-address + human date + concrete decision)', () => {
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  // The GOOD example must use direct "you" address.
  assert.match(prompt, /you\s+ratify|you\s+sign|you\s+approve|you\s+ship/i,
    'GOOD example uses direct "you" address');
  // The GOOD example must use a human date format.
  assert.match(prompt, /Wed\s+6\/3/i, 'GOOD example uses human date "Wed 6/3"');
  // The GOOD example must name the actual decision in plain words (rescans
  // API + measurement) NOT by codename ("Scope-β binding ratification").
  assert.match(prompt, /rescans\s+API|doc-only.*measurement|measurement.*rescans/i,
    'GOOD example names the actual decision in plain words');
});

test('v1.1.8 EXISTING RULES still hold: ref-as-plain-prose / no-meta / no-operation-issues / abbreviation expansion', () => {
  // The v1.1.8 rewrite must be ADDITIVE on top of the v1.1.3-1.1.7 contracts.
  // None of the prior rules should be lost.
  const prompt = promptFor({ body: 'A task body.', comments: [], refs: [] });
  assert.match(prompt, /plain\s+prose/i, 'plain-prose ref rule preserved');
  assert.match(prompt, /backticks?/i, 'no-backticks rule preserved');
  assert.match(prompt, /markdown\s+link/i, 'no-markdown-link rule preserved');
  assert.match(prompt, /compile-result/i, 'compile-result mention forbidden');
  assert.match(prompt, /operation\s+issue/i, 'operation-issue rule preserved');
  assert.match(prompt, /head\s+of\s+underwriting|acceptance\s+criterion/i, 'abbreviation example preserved');
  // Hard-shape rules unchanged.
  assert.match(prompt, /\b80\s+words?\b/i, '80-word cap preserved');
  assert.match(prompt, /bullets?/i, 'bullets rule preserved');
});

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.9 — DETERMINISTIC POLISH PIPELINE. The agent's surviving
// (non-meta) output still reads like AI slop: ISO dates, parenthetical
// restatements after chip ids, generic agent jargon ("operational sign-off",
// "pre-read", "binding ratification"). Three narrow regex passes fix each
// signature reliably.
// ---------------------------------------------------------------------------

// --- isoDateToHuman --------------------------------------------------------

test('v1.1.9 isoDateToHuman: a standalone ISO date becomes "Weekday M/D" with computed weekday', () => {
  // 2026-06-03 is a Wednesday. Verify computed weekday + zero-stripped M/D.
  const out = isoDateToHuman('Ratification on 2026-06-03.');
  assert.equal(out, 'Ratification on Wed 6/3.');
});

test('v1.1.9 isoDateToHuman: an agent-written weekday before the date is PRESERVED (no duplication)', () => {
  // "Wed 2026-06-03" must NOT become "Wed Wed 6/3".
  assert.equal(isoDateToHuman('Wed 2026-06-03 review'), 'Wed 6/3 review');
  assert.equal(isoDateToHuman('Wednesday 2026-06-03'), 'Wednesday 6/3');
  // Comma / period after the weekday word also works.
  assert.equal(isoDateToHuman('Tue, 2026-06-03'), 'Tue 6/3');
});

test('v1.1.9 isoDateToHuman: identifier-like contexts (BEAAA-2026-06-03) are NOT touched (boundary class)', () => {
  // The ISO date inside an identifier-shape must be left alone.
  assert.equal(isoDateToHuman('see BEAAA-2026-06-03'), 'see BEAAA-2026-06-03');
  assert.equal(isoDateToHuman('version 2026-06-03-rc1'), 'version 2026-06-03-rc1');
});

test('v1.1.9 isoDateToHuman: invalid dates (2026-13-45, 2026-02-30) pass through unchanged', () => {
  // Round-trip validation rejects fake dates.
  assert.equal(isoDateToHuman('see 2026-13-45'), 'see 2026-13-45'); // month > 12 already excluded by regex
  // 2026-02-30 — Feb has 29 days max (2026 is not a leap year); the regex
  // accepts day 30 syntactically but Date round-trip rejects it.
  assert.equal(isoDateToHuman('see 2026-02-30'), 'see 2026-02-30');
});

test('v1.1.9 isoDateToHuman: multiple dates in one string are all transformed', () => {
  const out = isoDateToHuman('Slipped from 2026-06-03 to 2026-06-10.');
  assert.equal(out, 'Slipped from Wed 6/3 to Wed 6/10.');
});

test('v1.1.9 isoDateToHuman: empty/null/non-string input passes through', () => {
  assert.equal(isoDateToHuman(''), '');
  assert.equal(isoDateToHuman(null), null);
  assert.equal(isoDateToHuman(undefined), undefined);
});

// --- stripRestatedParenAfterRef --------------------------------------------

test('v1.1.9 stripRestatedParenAfterRef: a title-like parenthetical after a ref id is removed', () => {
  // The exact BEAAA-1000 failure shape: "BEAAA-1086 (Underwriter pre-read)".
  assert.equal(
    stripRestatedParenAfterRef('see BEAAA-1086 (Underwriter pre-read).'),
    'see BEAAA-1086.',
  );
  assert.equal(
    stripRestatedParenAfterRef('BEAAA-1103 (Claims Architect).'),
    'BEAAA-1103.',
  );
});

test('v1.1.9 stripRestatedParenAfterRef: a lowercase-led parenthetical (footnote/note) is PRESERVED', () => {
  // "(for context)" and "(now closed)" are not restatements — keep.
  assert.equal(
    stripRestatedParenAfterRef('BEAAA-1086 (for context).'),
    'BEAAA-1086 (for context).',
  );
  assert.equal(
    stripRestatedParenAfterRef('BEAAA-1086 (now closed).'),
    'BEAAA-1086 (now closed).',
  );
});

test('v1.1.9 stripRestatedParenAfterRef: a parenthetical containing ANOTHER ref is PRESERVED (cross-ref)', () => {
  // "(or BEAAA-1103 as backup)" is a cross-ref the operator may want — keep.
  assert.equal(
    stripRestatedParenAfterRef('BEAAA-1086 (or BEAAA-1103 as backup).'),
    'BEAAA-1086 (or BEAAA-1103 as backup).',
  );
});

test('v1.1.9 stripRestatedParenAfterRef: status-like all-caps paren ("DONE", "BLOCKED") is stripped (chip shows status)', () => {
  // The chip already shows the status badge; an explicit "(DONE)" is redundant.
  assert.equal(
    stripRestatedParenAfterRef('BEAAA-1086 (DONE).'),
    'BEAAA-1086.',
  );
});

test('v1.1.9 stripRestatedParenAfterRef: the same id appearing multiple times — each restatement stripped', () => {
  const out = stripRestatedParenAfterRef(
    'sign-offs in: BEAAA-1086 (Underwriter), BEAAA-1103 (Claims Architect).',
  );
  assert.equal(out, 'sign-offs in: BEAAA-1086, BEAAA-1103.');
});

// --- applyJargonGlossary ---------------------------------------------------

test('v1.1.9 applyJargonGlossary: "operational sign-off" / "sign-offs" → "approval" / "approvals"', () => {
  assert.equal(
    applyJargonGlossary('Both operational sign-offs are in.'),
    'Both approvals are in.',
  );
  assert.equal(
    applyJargonGlossary('The operational sign-off is queued.'),
    'The approval is queued.',
  );
  // Bare "sign-off" / "sign-offs" also normalized.
  assert.equal(applyJargonGlossary('sign-offs pending'), 'approvals pending');
});

test('v1.1.9 applyJargonGlossary: "pre-read" / "pre-reads" → "review" / "reviews"', () => {
  assert.equal(applyJargonGlossary('UW pre-read is in.'), 'UW review is in.');
  assert.equal(applyJargonGlossary('Two pre-reads queued.'), 'Two reviews queued.');
});

test('v1.1.9 applyJargonGlossary: "binding ratification" → "final approval"; bare "ratification" → "approval"', () => {
  assert.equal(
    applyJargonGlossary('binding ratification on Wed 6/3.'),
    'final approval on Wed 6/3.',
  );
  assert.equal(applyJargonGlossary('post-ratification kickoff'), 'post-approval kickoff');
});

test('v1.1.9 applyJargonGlossary: "countersign" inflections → "sign off" / "signed off" / etc.', () => {
  assert.equal(applyJargonGlossary('HoUW must countersign.'), 'HoUW must sign off.');
  assert.equal(applyJargonGlossary('HoUW countersigned today.'), 'HoUW signed off today.');
  assert.equal(applyJargonGlossary('awaiting countersigning'), 'awaiting signing off');
});

test('v1.1.9 applyJargonGlossary: case-insensitive — "OPERATIONAL SIGN-OFF" still substitutes', () => {
  assert.equal(
    applyJargonGlossary('OPERATIONAL SIGN-OFF status: closed.'),
    'approval status: closed.',
  );
});

test('v1.1.9 applyJargonGlossary: domain-specific codenames (Scope-β, G7, Tier-2) are NOT translated', () => {
  // These are unique to the source issue — the agent is meant to keep them.
  const input = 'Scope-β engagement; G7 tabletop; Tier-2+ claim';
  assert.equal(applyJargonGlossary(input), input);
});

test('v1.1.9 JARGON_GLOSSARY: entries are well-formed { pattern: RegExp, replacement: string }', () => {
  assert.ok(Array.isArray(JARGON_GLOSSARY));
  assert.ok(JARGON_GLOSSARY.length >= 5);
  for (const e of JARGON_GLOSSARY) {
    assert.ok(e.pattern instanceof RegExp, 'pattern is a RegExp');
    assert.equal(typeof e.replacement, 'string', 'replacement is a string');
    // All patterns use the case-insensitive flag.
    assert.ok(e.pattern.flags.includes('i'), `pattern is case-insensitive: ${e.pattern}`);
  }
});

// --- polishTldr (integration) ----------------------------------------------

test('v1.1.9 polishTldr: the EXACT BEAAA-1000 v1.1.8-output failure transforms across all three passes', () => {
  // Verbatim slice of the agent's v1.1.8 output, copied from the operator's screenshot:
  // ISO date + restated paren + agent jargon all in one paragraph.
  const input = 'Engagement plan is posted; both operational sign-offs are in hand: BEAAA-1086 (Underwriter pre-read) and BEAAA-1103 (Claims Architect). Wed 2026-06-03 CTO ↔ Head of Underwriting (HoUW) scanner-contract review — binding ratification.';
  const out = polishTldr(input);

  // 1. ISO date → human format (with weekday preserved).
  assert.ok(out.includes('Wed 6/3'), `expected "Wed 6/3" in output: ${out}`);
  assert.equal(/2026-06-03/.test(out), false, 'ISO date removed');

  // 2. Restated parentheticals after ref ids removed.
  assert.equal(/BEAAA-1086\s*\(Underwriter pre-read\)/.test(out), false, 'restated paren after BEAAA-1086 removed');
  assert.equal(/BEAAA-1103\s*\(Claims Architect\)/.test(out), false, 'restated paren after BEAAA-1103 removed');
  // The chips themselves survive.
  assert.ok(out.includes('BEAAA-1086') && out.includes('BEAAA-1103'), 'ref ids survive');

  // 3. Jargon substitutions applied.
  assert.equal(/operational sign-offs/.test(out), false, '"operational sign-offs" translated');
  assert.ok(out.includes('approvals'), 'jargon translated to "approvals"');
  assert.equal(/binding ratification/.test(out), false, '"binding ratification" translated');
  assert.ok(out.includes('final approval'), 'jargon translated to "final approval"');
  // "(HoUW)" parenthetical is a first-use abbreviation expansion, NOT a title
  // restatement after a ref id — preserved.
  assert.ok(out.includes('(HoUW)'), 'abbreviation-expansion paren preserved');
});

test('v1.1.9 polishTldr: pure substantive prose with NO slop signatures is BYTE-IDENTICAL after polish', () => {
  const clean = '**Wed 6/3 you ratify upgrading the rescans API from doc-only to actual measurement.**\n\n- Underwriter review and Claims Architect approval are both in (BEAAA-1086, BEAAA-1103). Pricing variance is settled.\n- Next: show up to the 6/3 review ready to sign.';
  // Note: the GOOD example uses "Underwriter review" (already plain English),
  // bare "BEAAA-NNN" refs (no restated parens), "Wed 6/3" (human date), and
  // "ratify" (acceptable English verb; only "ratification" the noun is in the
  // glossary). Polish should be a no-op.
  assert.equal(polishTldr(clean), clean);
});

test('v1.1.9 polishTldr: empty/null/non-string input returns empty string', () => {
  assert.equal(polishTldr(''), '');
  assert.equal(polishTldr(null), '');
  assert.equal(polishTldr(undefined), '');
});

// ---------------------------------------------------------------------------
// Plan 250530 v1.1.10 — stripParensAroundLoneRef. BEAAA-1000's v1.1.9 output
// shipped clean voice + good headline, but the agent wrote "(BEAAA-1086) and
// (BEAAA-1103)" — agent parens wrapping a lone chip id. The chip then expands
// to a wide titled element and the outer parens become orphan brackets around
// the chip (compounded by chip-title CSS truncation cutting mid-content).
// Strip the agent's wrapping parens; the chip itself is the affordance.
// ---------------------------------------------------------------------------

test('v1.1.10 stripParensAroundLoneRef: agent parens wrapping a lone ref id are removed', () => {
  // EXACT BEAAA-1000 v1.1.9 shape: "Underwriter (BEAAA-1086) and Claims
  // Architect (BEAAA-1103) approved".
  assert.equal(
    stripParensAroundLoneRef('Underwriter (BEAAA-1086) and Claims Architect (BEAAA-1103) approved.'),
    'Underwriter BEAAA-1086 and Claims Architect BEAAA-1103 approved.',
  );
});

test('v1.1.10 stripParensAroundLoneRef: tolerates whitespace inside parens', () => {
  assert.equal(stripParensAroundLoneRef('see ( BEAAA-933 ) here'), 'see BEAAA-933 here');
  assert.equal(stripParensAroundLoneRef('see (BEAAA-933 ) here'), 'see BEAAA-933 here');
});

test('v1.1.10 stripParensAroundLoneRef: parens with MULTIPLE refs are PRESERVED', () => {
  // The v1.1.9 stripRestatedParenAfterRef preserves cross-ref parens; the
  // v1.1.10 lone-ref strip ONLY matches a single id inside the parens.
  assert.equal(
    stripParensAroundLoneRef('see (BEAAA-1086, BEAAA-1103)'),
    'see (BEAAA-1086, BEAAA-1103)',
  );
});

test('v1.1.10 stripParensAroundLoneRef: parens with the id + extra content are PRESERVED', () => {
  // "(BEAAA-1086 done)" / "(BEAAA-1086 — Title)" are handled by the v1.1.9
  // stripRestatedParenAfterRef (when capital-led) or preserved as footnotes
  // (when lowercase-led). The lone-ref strip does NOT fire here — its regex
  // requires the parens to contain ONLY the id (plus optional whitespace).
  assert.equal(stripParensAroundLoneRef('see (BEAAA-1086 done)'), 'see (BEAAA-1086 done)');
  assert.equal(stripParensAroundLoneRef('see (BEAAA-1086 for context)'), 'see (BEAAA-1086 for context)');
});

test('v1.1.10 stripParensAroundLoneRef: empty/null/non-string input passes through', () => {
  assert.equal(stripParensAroundLoneRef(''), '');
  assert.equal(stripParensAroundLoneRef(null), null);
  assert.equal(stripParensAroundLoneRef(undefined), undefined);
});

test('v1.1.10 polishTldr: the EXACT BEAAA-1000 v1.1.9-output layout disaster is fixed', () => {
  // Verbatim slice from the operator's screenshot (2026-05-30 13:44 TL;DR):
  // agent parens around lone refs + jargon + a human date (already good).
  const input = 'Wed 6/3 you ratify upgrading the rescans API from ping-only to full measurement. Both approvals are in: Underwriter (BEAAA-1086) and Claims Architect (BEAAA-1103) approved; the SLA variance is resolved.';
  const out = polishTldr(input);
  // The agent's outer parens around lone ref ids are gone — chip sits inline.
  assert.equal(/\(BEAAA-1086\)/.test(out), false, 'parens around BEAAA-1086 stripped');
  assert.equal(/\(BEAAA-1103\)/.test(out), false, 'parens around BEAAA-1103 stripped');
  // The refs survive as plain ids.
  assert.ok(out.includes('BEAAA-1086'), 'BEAAA-1086 survives');
  assert.ok(out.includes('BEAAA-1103'), 'BEAAA-1103 survives');
  // The substantive prose survives.
  assert.ok(out.includes('Wed 6/3 you ratify'), 'headline preserved');
  assert.ok(out.includes('SLA variance is resolved'), 'tail content preserved');
});
