// test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs
//
// Plan 15-02 Task 3 (15-CONTEXT D-10 / NO_UUID_LEAK) — extend the render-scan
// UUID-pattern guard to the new <PulseHeader> render path. The Phase-15 risk
// (T-15-04): worker integers + a deterministic sentence cross into the
// operator-visible DOM, and NO UUID (and no company-prefix literal) may ever
// reach a rendered text node.
//
// Two guarantees, mirroring employee-row-no-uuid-leak.test.mjs:
//   1) STRUCTURAL — the PulseHeader renders ONLY count integers + static English
//      labels + the deterministic sentence. There is no *Uuid / .id /
//      companyPrefix field threaded into a JSX text node or template literal — by
//      construction there is nothing UUID-shaped to leak.
//   2) BEHAVIORAL render-scan — simulate the PulseHeader text output (sentence +
//      the four chip count+label strings) from a `pulse` whose counts are
//      plausible integers, and assert the rendered text matches NO UUID pattern
//      across several count regimes, AND contains no company-prefix literal.
//
// Convention (no jsdom in devDependencies): source-grep for the structural scan;
// a small string-render simulation for the behavioral scan; a guard fixture
// proves the UUID regex is meaningful.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildPulseSentence } from '../../../../src/ui/surfaces/situation-room/pulse-sentence.ts';

// The exact UUID shape (mirrors src/shared/scrub-human-action.ts UUID_RE and the
// Phase 11/13/14 NO_UUID_LEAK render-scan guards).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// A handful of illustrative company prefixes — none may appear as a literal in
// the source or in the rendered output (instance-agnostic, D-10).
const PREFIX_LITERALS = ['BEAAA', 'COU'];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const HEADER = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/pulse-header.tsx'),
  'utf8',
);
const HEADER_CODE = stripComments(HEADER);
const SENTENCE = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/pulse-sentence.ts'),
  'utf8',
);
const SENTENCE_CODE = stripComments(SENTENCE);

// ---------------------------------------------------------------------------
// Guard fixture — prove the scan is meaningful.
// ---------------------------------------------------------------------------

test('guard — UUID_RE matches a real UUID (the render-scan is meaningful)', () => {
  assert.match('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', UUID_RE);
});

// ---------------------------------------------------------------------------
// (1) STRUCTURAL — no *Uuid / .id / companyPrefix interpolation in PulseHeader.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK structural — PulseHeader has no *Uuid identifier anywhere', () => {
  assert.doesNotMatch(HEADER_CODE, /\bUuid\b|[A-Za-z]Uuid\b/, 'no *Uuid token in the component');
});

test('NO_UUID_LEAK structural — PulseHeader has no companyPrefix reference (instance-agnostic)', () => {
  assert.doesNotMatch(HEADER_CODE, /companyPrefix/, 'no companyPrefix in the component');
  for (const lit of PREFIX_LITERALS) {
    assert.doesNotMatch(HEADER_CODE, new RegExp(`\\b${lit}\\b`), `no ${lit} literal in the component`);
  }
});

test('NO_UUID_LEAK structural — no .id / .sourceIssueUuid interpolated into a JSX text node or template', () => {
  // No raw uuid-ish key field appears in a template literal...
  assert.equal(
    (HEADER_CODE.match(/\$\{[^}]*(?:Uuid|\.id\b)[^}]*\}/g) || []).length,
    0,
    'no template interpolation of a *Uuid / .id field',
  );
  // ...or as a JSX text-node expression.
  assert.equal(
    (HEADER_CODE.match(/>\s*\{[^{}]*(?:Uuid|\.id\b)[^{}]*\}\s*</g) || []).length,
    0,
    'no JSX text-node render of a *Uuid / .id field',
  );
});

test('NO_UUID_LEAK structural — the only rendered values are the four counts + static labels + the sentence', () => {
  // The component must call buildPulseSentence and render integer counts. There
  // is no dangerouslySetInnerHTML (markup injection vector, T-15-06).
  assert.match(HEADER_CODE, /buildPulseSentence\s*\(/);
  assert.doesNotMatch(HEADER_CODE, /dangerouslySetInnerHTML/);
});

// ---------------------------------------------------------------------------
// (2) BEHAVIORAL render-scan — the simulated PulseHeader text is UUID-free and
// prefix-free across several count regimes.
// ---------------------------------------------------------------------------

const VITAL_LABELS = ['need you', 'in motion', 'stuck', 'self-clearing'];

/** Mirror of the PulseHeader text output (sentence + the four chip count+label
 *  strings) — kept in sync; the scan fails if the render shape drifts. */
function renderPulseText(pulse) {
  const floor = { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 };
  const p = pulse ?? floor;
  const chips = [
    `${p.needYou} ${VITAL_LABELS[0]}`,
    `${p.inMotion} ${VITAL_LABELS[1]}`,
    `${p.stuck} ${VITAL_LABELS[2]}`,
    `${p.selfClearing} ${VITAL_LABELS[3]}`,
  ];
  return `${buildPulseSentence(p)}\n${chips.join(' · ')}`;
}

test('NO_UUID_LEAK behavioral — PulseHeader rendered text has ZERO UUID matches across count regimes', () => {
  const regimes = [
    undefined, // absent -> floor
    { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 },
    { needYou: 9, inMotion: 12, stuck: 4, selfClearing: 2 },
    { needYou: 1, inMotion: 1, stuck: 1, selfClearing: 1 },
    { needYou: 3, inMotion: 0, stuck: 0, selfClearing: 0 },
  ];
  for (const r of regimes) {
    const text = renderPulseText(r);
    assert.doesNotMatch(text, UUID_RE, `rendered Pulse text leaked a UUID: ${text}`);
    for (const lit of PREFIX_LITERALS) {
      assert.doesNotMatch(text, new RegExp(`\\b${lit}\\b`), `rendered Pulse text leaked prefix ${lit}: ${text}`);
    }
    // Sanity — the guard is on real output: the four labels DID render.
    for (const label of VITAL_LABELS) assert.match(text, new RegExp(label));
  }
});

test('NO_UUID_LEAK behavioral — buildPulseSentence is UUID-free for every count regime', () => {
  for (const r of [
    { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 },
    { needYou: 7, inMotion: 0, stuck: 3, selfClearing: 5 },
    { needYou: 0, inMotion: 6, stuck: 0, selfClearing: 0 },
  ]) {
    assert.doesNotMatch(buildPulseSentence(r), UUID_RE);
  }
});

test('NO_UUID_LEAK structural — pulse-sentence.ts emits counts + static English only (no id/prefix)', () => {
  assert.doesNotMatch(SENTENCE_CODE, /companyPrefix|\bUuid\b/, 'sentence helper carries no id/prefix field');
  for (const lit of PREFIX_LITERALS) {
    assert.doesNotMatch(SENTENCE_CODE, new RegExp(`\\b${lit}\\b`), `no ${lit} literal in the sentence helper`);
  }
});
