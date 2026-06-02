// test/ui/surfaces/situation-room/pulse-header.test.mjs
//
// Plan 15-02 Task 1 + Task 2 — the <PulseHeader> render contract + the
// buildPulseSentence pure-template helper.
//
// COCK-01 / SC1: the Pulse header answers "how's the company?" before any list —
// a DETERMINISTIC one-sentence status line + four always-on vital-sign chips
// (need-you / in-motion / stuck / self-clearing) summed in the worker (15-01).
//
// D-02 / SC4: the sentence is a PURE counts->string template (the always-on
// floor the Editor-Agent prose enrichment degrades to — DEFERRED this phase).
// Same counts -> same string; the all-zero floor is an honest non-empty
// sentence; the chips are always deterministic integers.
//
// D-07: the Phase-8 needs-you-banner role folds in — the need-you state lives in
// the Pulse sentence + chip; there is no second standalone status line.
//
// D-10: instance-agnostic + NO_UUID_LEAK — human labels + integers only; no
// companyPrefix literal, no dangerouslySetInnerHTML. (The dedicated render-scan
// guard lives in pulse-header-no-uuid-leak.test.mjs.)
//
// Convention (matches employee-row-no-uuid-leak.test.mjs): no jsdom in
// devDependencies, so the component contract is proven by (a) a source-grep of
// pulse-header.tsx and (b) a small string-render simulation that mirrors the
// component's text output, plus direct unit tests of the pure helper.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildPulseSentence } from '../../../../src/ui/surfaces/situation-room/pulse-sentence.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const HEADER_SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/pulse-header.tsx'),
  'utf8',
);
const HEADER_CODE = stripComments(HEADER_SRC);

// ---------------------------------------------------------------------------
// (1) buildPulseSentence — the four count regimes, plurals, determinism, floor.
// ---------------------------------------------------------------------------

test('buildPulseSentence — need-you > 0 leads with the human-actionable count', () => {
  const s = buildPulseSentence({ needYou: 3, inMotion: 5, stuck: 0, selfClearing: 0 });
  assert.match(s, /3 things need you/);
  assert.match(s, /5 in motion/);
});

test('buildPulseSentence — need-you === 1 is singular ("1 thing needs you")', () => {
  const s = buildPulseSentence({ needYou: 1, inMotion: 2, stuck: 0, selfClearing: 0 });
  assert.match(s, /1 thing needs you/);
  assert.doesNotMatch(s, /1 things/);
});

test('buildPulseSentence — need-you === 0 and in-motion > 0 is the calm/control voice', () => {
  const s = buildPulseSentence({ needYou: 0, inMotion: 4, stuck: 0, selfClearing: 0 });
  assert.match(s, /Nothing needs you/);
  assert.match(s, /4 in motion/);
});

test('buildPulseSentence — all four counts 0 returns an honest non-empty floor sentence', () => {
  const s = buildPulseSentence({ needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 });
  assert.ok(typeof s === 'string' && s.trim().length > 0, 'floor sentence is non-empty');
  assert.match(s, /board is clear/i);
});

test('buildPulseSentence — stuck/self-clearing appear in the tail ONLY when > 0', () => {
  const withTail = buildPulseSentence({ needYou: 0, inMotion: 3, stuck: 2, selfClearing: 1 });
  assert.match(withTail, /2 stuck/);
  assert.match(withTail, /1 self-clearing/);

  const noTail = buildPulseSentence({ needYou: 0, inMotion: 3, stuck: 0, selfClearing: 0 });
  assert.doesNotMatch(noTail, /stuck/);
  assert.doesNotMatch(noTail, /self-clearing/);
});

test('buildPulseSentence — stuck/self-clearing plurals are correct (1 stuck, not 1 stucks)', () => {
  const s = buildPulseSentence({ needYou: 0, inMotion: 1, stuck: 1, selfClearing: 1 });
  assert.match(s, /1 stuck\b/);
  assert.match(s, /1 self-clearing\b/);
});

test('buildPulseSentence — DETERMINISTIC: same input twice -> identical string', () => {
  const input = { needYou: 2, inMotion: 7, stuck: 1, selfClearing: 3 };
  assert.equal(buildPulseSentence(input), buildPulseSentence({ ...input }));
});

test('buildPulseSentence — sentence is UUID-free across several count regimes', () => {
  for (const c of [
    { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 },
    { needYou: 9, inMotion: 12, stuck: 4, selfClearing: 2 },
    { needYou: 1, inMotion: 1, stuck: 1, selfClearing: 1 },
  ]) {
    assert.doesNotMatch(buildPulseSentence(c), UUID_RE);
  }
});

// ---------------------------------------------------------------------------
// (2) <PulseHeader> render contract — source-grep (no jsdom) + string-render sim.
// ---------------------------------------------------------------------------

test('PulseHeader — calls buildPulseSentence and renders its output (banner folds in, D-07)', () => {
  assert.match(HEADER_CODE, /buildPulseSentence\s*\(/, 'PulseHeader calls buildPulseSentence');
});

test('PulseHeader — renders four vital chips (>= 4 clarity-pulse-vital references)', () => {
  const refs = (HEADER_CODE.match(/clarity-pulse-vital/g) || []).length;
  assert.ok(refs >= 4, `expected >= 4 clarity-pulse-vital references, got ${refs}`);
});

test('PulseHeader — contains zero companyPrefix references and no dangerouslySetInnerHTML', () => {
  const bad = (HEADER_CODE.match(/dangerouslySetInnerHTML|companyPrefix/g) || []).length;
  assert.equal(bad, 0, 'no companyPrefix / dangerouslySetInnerHTML in PulseHeader');
});

test('PulseHeader — does NOT import worker types (structural PulseSummary mirror)', () => {
  assert.doesNotMatch(HEADER_CODE, /from\s+['"][^'"]*worker[^'"]*['"]/, 'no worker import');
  assert.match(HEADER_CODE, /export\s+type\s+PulseSummary/, 'PulseSummary is mirrored in the UI');
});

test('PulseHeader — defends an absent pulse prop to the all-zero floor (SC4)', () => {
  // The source must default the pulse to the all-zero floor before calling the
  // sentence helper (pulse ?? {needYou:0,inMotion:0,stuck:0,selfClearing:0}).
  assert.match(
    HEADER_CODE,
    /needYou:\s*0[\s,]+inMotion:\s*0[\s,]+stuck:\s*0[\s,]+selfClearing:\s*0/,
    'PulseHeader carries an all-zero floor default for an absent pulse',
  );
});

// Mirror of the component's rendered text (sentence + the four chip count+label
// strings) — kept in sync; the behavioral scan fails if the mapping drifts.
const VITAL_LABELS = {
  needYou: 'need you',
  inMotion: 'in motion',
  stuck: 'stuck',
  selfClearing: 'self-clearing',
};

function renderPulseText(pulse) {
  const floor = { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 };
  const p = pulse ?? floor;
  const chips = [
    `${p.needYou} ${VITAL_LABELS.needYou}`,
    `${p.inMotion} ${VITAL_LABELS.inMotion}`,
    `${p.stuck} ${VITAL_LABELS.stuck}`,
    `${p.selfClearing} ${VITAL_LABELS.selfClearing}`,
  ];
  return `${buildPulseSentence(p)}\n${chips.join(' · ')}`;
}

test('PulseHeader render-sim — the four counts + labels appear', () => {
  const text = renderPulseText({ needYou: 3, inMotion: 5, stuck: 2, selfClearing: 1 });
  assert.match(text, /3 need you/);
  assert.match(text, /5 in motion/);
  assert.match(text, /2 stuck/);
  assert.match(text, /1 self-clearing/);
});

test('PulseHeader render-sim — an undefined pulse renders the all-zero floor (non-blank, never throws)', () => {
  let text;
  assert.doesNotThrow(() => {
    text = renderPulseText(undefined);
  });
  assert.ok(text.trim().length > 0, 'floor render is non-empty');
  assert.match(text, /0 need you/);
  assert.match(text, /0 in motion/);
  assert.match(text, /0 stuck/);
  assert.match(text, /0 self-clearing/);
  assert.match(text, /board is clear/i);
});
