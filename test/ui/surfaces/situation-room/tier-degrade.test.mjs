// test/ui/surfaces/situation-room/tier-degrade.test.mjs
//
// Plan 15-03 Task 3 (SC4 / D-08) — the "honest when the Editor-Agent is down"
// contract for the cockpit. With NO pulse summary and NO action cards on any
// row, the board MUST still be fully legible from the deterministic engine
// verdict alone:
//   (a) the Pulse falls back to the deterministic floor sentence (non-blank,
//       UUID-free) computed purely from the counts (buildPulseSentence), and
//   (b) the tier partition still classifies every row from blockerChain.tier
//       only — it has ZERO dependency on actionCard (the AI layer).
//
// Plus the index-body wiring asserts: it mounts <PulseHeader pulse={payload.pulse}>
// + <TierStrip>, and it NO LONGER mounts <NeedsYouBanner> (the banner folded into
// the Pulse, D-07).
//
// Convention (matches tier-strip.test.mjs / pulse-header.test.mjs): no jsdom, so
// the contract is proven by a source-grep of index.tsx + a pure simulation of the
// degrade path (the same partition + the same pure sentence helper the components
// use).

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
const INDEX_SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/index.tsx'),
  'utf8',
);
const INDEX_CODE = stripComments(INDEX_SRC);

// ---------------------------------------------------------------------------
// (a) Pulse degrade — no pulse -> deterministic floor sentence (SC4).
// ---------------------------------------------------------------------------

test('SC4 — an absent pulse degrades the sentence to the all-zero deterministic floor (non-blank)', () => {
  // The index body passes payload.pulse straight through; an absent field is
  // undefined. The PulseHeader defends it to the all-zero floor. Exercise the
  // pure helper on the all-zero floor: it must be a non-empty, UUID-free string.
  const floor = { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 };
  const s = buildPulseSentence(floor);
  assert.ok(typeof s === 'string' && s.trim().length > 0, 'floor sentence is non-empty');
  assert.match(s, /board is clear/i);
  assert.doesNotMatch(s, UUID_RE, 'floor sentence is UUID-free');
});

test('SC4 — the deterministic sentence renders real counts with NO Editor-Agent input', () => {
  // Real counts (Editor-Agent down — no gloss, just the engine-summed numbers).
  const s = buildPulseSentence({ needYou: 3, inMotion: 5, stuck: 2, selfClearing: 1 });
  assert.match(s, /3 things need you/);
  assert.match(s, /5 in motion/);
  assert.match(s, /2 stuck/);
  assert.match(s, /1 self-clearing/);
  assert.doesNotMatch(s, UUID_RE);
});

// ---------------------------------------------------------------------------
// (b) Tier partition has ZERO actionCard dependency — classifies from the
//     engine verdict (blockerChain.tier) only, even with actionCard: null on
//     every row (SC4 / D-08: tier membership is degrade-safe by construction).
// ---------------------------------------------------------------------------

/** The same locked D-05 partition the TierStrip + EmployeeRow compute. */
function visualTierOf(row) {
  const t = row.blockerChain?.tier;
  if (t === 'needs-you' || t === 'in-motion' || t === 'watch') return t;
  if (row.blockerChain == null) return row.group === 'working' ? 'in-motion' : 'watch';
  return 'watch';
}

function chain(tier, terminalKind) {
  return {
    rootIssueId: 'r',
    leafIssueId: 'ISSUE-1',
    leafIssueUuid: null,
    humanAction: 'do the thing',
    ownerName: 'Someone',
    ownerAgentId: null,
    needsYou: tier === 'needs-you',
    tier,
    actionAffordance: tier === 'needs-you' ? 'reply' : 'open',
    awaitedPartyLabel: 'someone',
    targetAgentUuid: null,
    targetIssueUuid: null,
    terminalKind,
    needsDurabilityFlip: false,
  };
}

test('SC4 — the tier partition classifies rows with actionCard: null on EVERY row (no AI dependency)', () => {
  const rows = [
    { agentId: 'ny', group: 'needs_you', blockerChain: chain('needs-you', 'AWAITING_HUMAN'), actionCard: null },
    { agentId: 'mov', group: 'working', blockerChain: chain('in-motion', 'AWAITING_AGENT_WORKING'), actionCard: null },
    { agentId: 'stuck', group: 'needs_you', blockerChain: chain('watch', 'AWAITING_AGENT_STUCK'), actionCard: null },
    { agentId: 'self', group: 'working', blockerChain: chain('watch', 'SELF_RESOLVING'), actionCard: null },
    { agentId: 'idle', group: 'idle', blockerChain: null, actionCard: null },
  ];
  const out = { 'needs-you': [], 'in-motion': [], watch: [] };
  for (const r of rows) out[visualTierOf(r)].push(r.agentId);

  // The classification is correct WITHOUT any actionCard.
  assert.deepEqual(out['needs-you'], ['ny']);
  assert.deepEqual(out['in-motion'], ['mov']);
  assert.deepEqual(out.watch, ['stuck', 'self', 'idle']);
  // The stuck-agent (group needs_you) is in Watch, not Needs-you — degrade-safe.
  assert.ok(!out['needs-you'].includes('stuck'));
});

test('SC4 — a thrown/UNCLASSIFIED chain still partitions (degrade-safe by construction)', () => {
  const rows = [
    { agentId: 'unc', group: 'needs_you', blockerChain: chain('watch', 'UNCLASSIFIED'), actionCard: null },
  ];
  assert.equal(visualTierOf(rows[0]), 'watch', 'an UNCLASSIFIED honest-fallback row lands in Watch');
});

// ---------------------------------------------------------------------------
// (c) index.tsx wiring — PulseHeader + TierStrip mounted; NeedsYouBanner gone.
// ---------------------------------------------------------------------------

test('index — mounts <PulseHeader pulse={payload.pulse}>', () => {
  assert.match(INDEX_CODE, /<PulseHeader\b/, 'mounts PulseHeader');
  assert.match(INDEX_CODE, /payload\.pulse/, 'threads payload.pulse');
});

test('index — mounts <TierStrip> with the verdict-tier props', () => {
  assert.match(INDEX_CODE, /<TierStrip\b/, 'mounts TierStrip');
  assert.match(INDEX_CODE, /employees=\{employees\}/, 'threads the employees rows');
});

test('index — NO LONGER mounts <NeedsYouBanner> (folded into the Pulse, D-07)', () => {
  assert.equal(
    (INDEX_CODE.match(/NeedsYouBanner/g) || []).length,
    0,
    'NeedsYouBanner must not appear in index.tsx (banner folded into the Pulse)',
  );
});

test('index — SituationData is widened with an additive optional pulse field', () => {
  assert.match(INDEX_CODE, /pulse\?:\s*PulseSummary/, 'pulse?: PulseSummary additive optional');
});

test('index — the fetch/poll plumbing is unchanged (snapshot fetch + forceRefetch + ping retained)', () => {
  assert.match(INDEX_CODE, /situation\.snapshot/, 'snapshot fetch retained');
  assert.match(INDEX_CODE, /forceRefetch/, 'forceRefetch retained');
  assert.match(INDEX_CODE, /situation\.active-viewer-ping/, 'active-viewer ping retained');
});

test('index — no dangerouslySetInnerHTML and no UUID literal in the body', () => {
  assert.equal((INDEX_CODE.match(/dangerouslySetInnerHTML/g) || []).length, 0);
  assert.doesNotMatch(INDEX_CODE, UUID_RE);
});
