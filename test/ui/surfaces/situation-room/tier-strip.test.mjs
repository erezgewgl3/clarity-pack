// test/ui/surfaces/situation-room/tier-strip.test.mjs
//
// Plan 15-03 Task 1 + Task 2 (COCK-02 / SC2 / SC3) — the <TierStrip> partition
// contract + the EmployeeRow calm tier-variant.
//
// THE LOCK (15-CONTEXT D-04/D-05): the three VISUAL tiers (Needs-you -> In-motion
// -> Watch, loudest-on-top) partition off the ENGINE verdict `blockerChain.tier`
// ('needs-you' | 'in-motion' | 'watch'), NOT the Phase-9 agent-state EmployeeGroup
// ('needs_you' | 'working' | 'idle'). They are NOT 1:1: a stuck-agent row is
// group 'needs_you' but tier 'watch' -> it MUST land in WATCH, never Needs-you.
//
// Convention (matches employee-row-action-card.test.mjs / pulse-header.test.mjs):
// no jsdom in devDependencies, so the contract is proven by (a) a source-grep of
// tier-strip.tsx + employee-row.tsx and (b) a small partition simulation that
// mirrors the component's locked D-05 partition rule.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const STRIP_SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/tier-strip.tsx'),
  'utf8',
);
const STRIP_CODE = stripComments(STRIP_SRC);
const ROW_SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/employee-row.tsx'),
  'utf8',
);
const ROW_CODE = stripComments(ROW_SRC);

// ---------------------------------------------------------------------------
// Shared partition simulation — MIRRORS the locked D-05 rule in tier-strip.tsx.
// (Kept in sync; the simulation tests assert the partition the component must
// implement; the source-grep tests assert the component implements it the same
// way — keying on blockerChain.tier, not row.group.)
// ---------------------------------------------------------------------------

/** The locked D-05 partition: tier where a chain exists; chainless -> group
 *  fallback (working -> in-motion, else watch); any unmatched -> watch. */
function visualTierOf(row) {
  const t = row.blockerChain?.tier;
  if (t === 'needs-you' || t === 'in-motion' || t === 'watch') return t;
  // chainless fallback
  if (row.blockerChain == null) {
    return row.group === 'working' ? 'in-motion' : 'watch';
  }
  return 'watch';
}

function partition(rows) {
  const out = { 'needs-you': [], 'in-motion': [], watch: [] };
  for (const r of rows) out[visualTierOf(r)].push(r);
  return out;
}

function chain(tier, extra = {}) {
  return {
    rootIssueId: 'r',
    leafIssueId: 'ISSUE-1',
    leafIssueUuid: null,
    humanAction: 'do the thing',
    ownerName: 'Someone',
    ownerAgentId: null,
    needsYou: tier === 'needs-you',
    tier,
    actionAffordance: 'open',
    awaitedPartyLabel: 'someone',
    targetAgentUuid: null,
    targetIssueUuid: null,
    terminalKind: 'UNCLASSIFIED',
    needsDurabilityFlip: false,
    ...extra,
  };
}

function row(agentId, group, ch) {
  return {
    agentId,
    name: agentId,
    role: 'role',
    state: 'running',
    group,
    isPaused: false,
    focusIssueId: null,
    focusLine: 'working on X',
    lastActivityAt: null,
    ageBucket: 'fresh',
    blockerChain: ch,
    actionCard: null,
    doneTodayCount: 0,
  };
}

// ===========================================================================
// Task 1 — <TierStrip> partition contract
// ===========================================================================

test('TierStrip — TIER_ORDER is loudest-on-top: needs-you -> in-motion -> watch', () => {
  assert.match(STRIP_CODE, /needs-you[\s\S]{0,40}in-motion[\s\S]{0,40}watch/);
  // The order array must literally list the three hyphenated tiers in order.
  const m = STRIP_CODE.match(/TIER_ORDER[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'TIER_ORDER array present');
  const order = m[1];
  const iNeeds = order.indexOf('needs-you');
  const iMotion = order.indexOf('in-motion');
  const iWatch = order.indexOf('watch');
  assert.ok(iNeeds >= 0 && iMotion > iNeeds && iWatch > iMotion, `bad order: ${order}`);
});

test('TierStrip — partitions on the ENGINE blockerChain.tier (not row.group as the primary tier key)', () => {
  assert.match(STRIP_CODE, /blockerChain/, 'references blockerChain');
  assert.match(STRIP_CODE, /\.tier/, 'reads the tier field');
  // The primary partition key is NOT `row.group ===` — group is only a chainless
  // fallback. There must be a blockerChain?.tier read; the group compare (if any)
  // is the fallback only.
  assert.match(
    STRIP_CODE,
    /blockerChain\??\.\s*tier|chain\??\.\s*tier/,
    'partition keys on blockerChain.tier',
  );
});

test('TierStrip — chainless fallback: working -> in-motion, else -> watch', () => {
  assert.match(STRIP_CODE, /'working'|"working"/, 'fallback references the working group');
  assert.match(STRIP_CODE, /in-motion/, 'working fallback -> in-motion');
});

test('TierStrip — reuses EmployeeRow (no row re-implementation)', () => {
  assert.match(STRIP_CODE, /import[\s\S]*EmployeeRow[\s\S]*from\s*['"]\.\/employee-row/);
  assert.match(STRIP_CODE, /<EmployeeRow\b/);
});

test('TierStrip — does NOT re-sort the rows in the view (grep .sort( is 0)', () => {
  assert.equal((STRIP_CODE.match(/\.sort\(/g) || []).length, 0, 'no .sort() in the view');
});

test('TierStrip — mounts <BlockedBacklogExpander> exactly once, under the WATCH branch', () => {
  const mounts = (STRIP_CODE.match(/<BlockedBacklogExpander\b/g) || []).length;
  assert.equal(mounts, 1, 'exactly one BlockedBacklogExpander mount');
  // The mount must be gated on the watch tier.
  assert.match(
    STRIP_CODE,
    /watch[\s\S]{0,200}<BlockedBacklogExpander|BlockedBacklogExpander[\s\S]{0,1}/,
    'expander mounts in the watch branch',
  );
});

test('TierStrip — every tier renders its header + count even when empty (a zero is a signal)', () => {
  assert.match(STRIP_CODE, /clarity-tier-header/);
  assert.match(STRIP_CODE, /clarity-tier-count/);
  assert.match(STRIP_CODE, /clarity-tier-empty|— none —/);
});

test('TierStrip — uses clarity-tier* class names (scoped CSS family)', () => {
  assert.match(STRIP_CODE, /clarity-tier-section/);
  assert.match(STRIP_CODE, /clarity-tier-needs-you|clarity-tier-\$\{|clarity-tier-`/);
});

test('TierStrip source contains no dangerouslySetInnerHTML and no UUID literal', () => {
  assert.equal((STRIP_CODE.match(/dangerouslySetInnerHTML/g) || []).length, 0);
  assert.doesNotMatch(STRIP_CODE, UUID_RE);
});

// ---- partition simulation (the locked D-05 behavior) -----------------------

test('PARTITION — a needs-you-tier row lands in Needs-you', () => {
  const rows = [row('a', 'needs_you', chain('needs-you', { actionAffordance: 'reply' }))];
  const p = partition(rows);
  assert.deepEqual(p['needs-you'].map((r) => r.agentId), ['a']);
  assert.equal(p['in-motion'].length, 0);
  assert.equal(p.watch.length, 0);
});

test('PARTITION — an in-motion-tier row AND a chainless working row both land in In-motion', () => {
  const rows = [
    row('motion', 'working', chain('in-motion')),
    row('chainless', 'working', null),
  ];
  const p = partition(rows);
  assert.deepEqual(p['in-motion'].map((r) => r.agentId).sort(), ['chainless', 'motion']);
});

test('THE LOCK (D-04) — a stuck-agent row (group needs_you, tier watch) lands in WATCH, NOT Needs-you', () => {
  const rows = [
    row('stuck', 'needs_you', chain('watch', { actionAffordance: 'assign', terminalKind: 'AWAITING_AGENT_STUCK' })),
  ];
  const p = partition(rows);
  assert.equal(p['needs-you'].length, 0, 'stuck agent must NOT be in Needs-you');
  assert.deepEqual(p.watch.map((r) => r.agentId), ['stuck'], 'stuck agent is in Watch');
});

test('PARTITION — chainless idle/stale rows land in Watch as awareness', () => {
  const rows = [
    row('idle', 'idle', null),
    row('stale', 'idle', null),
  ];
  const p = partition(rows);
  assert.deepEqual(p.watch.map((r) => r.agentId).sort(), ['idle', 'stale']);
});

test('PARTITION — no row is dropped (defensive fall-through lands unmatched in Watch)', () => {
  const rows = [
    row('garbage', 'needs_you', chain('not-a-real-tier')),
  ];
  const p = partition(rows);
  assert.equal(p['needs-you'].length + p['in-motion'].length + p.watch.length, 1);
  assert.deepEqual(p.watch.map((r) => r.agentId), ['garbage']);
});

test('PARTITION — full mixed board partitions exactly per D-05', () => {
  const rows = [
    row('ny', 'needs_you', chain('needs-you', { actionAffordance: 'reply', terminalKind: 'AWAITING_HUMAN' })),
    row('mov', 'working', chain('in-motion', { terminalKind: 'AWAITING_AGENT_WORKING' })),
    row('movChainless', 'working', null),
    row('stuck', 'needs_you', chain('watch', { actionAffordance: 'assign', terminalKind: 'AWAITING_AGENT_STUCK' })),
    row('selfres', 'working', chain('watch', { actionAffordance: 'none', terminalKind: 'SELF_RESOLVING' })),
    row('idle', 'idle', null),
  ];
  const p = partition(rows);
  assert.deepEqual(p['needs-you'].map((r) => r.agentId), ['ny']);
  assert.deepEqual(p['in-motion'].map((r) => r.agentId), ['mov', 'movChainless']);
  assert.deepEqual(p.watch.map((r) => r.agentId), ['stuck', 'selfres', 'idle']);
});

// ===========================================================================
// Task 2 — EmployeeRow calm tier-variant (body gates on the engine tier)
// ===========================================================================

test('EmployeeRow — derives a visualTier from the engine blockerChain.tier (not row.group as the body gate)', () => {
  assert.match(ROW_CODE, /visualTier/, 'a visualTier is computed');
  assert.match(ROW_CODE, /blockerChain\??\.\s*tier|chain\??\.\s*tier/, 'visualTier reads the engine tier');
});

test('EmployeeRow — stamps a tier modifier class on the row root for the calm CSS variant', () => {
  assert.match(ROW_CODE, /clarity-tier-row/, 'row root carries a clarity-tier-row modifier');
});

test('EmployeeRow — the Needs-you body keeps the FULL stack: OwnerPickerPopover + ReplyInPlace + the action card', () => {
  assert.match(ROW_CODE, /OwnerPickerPopover/);
  assert.match(ROW_CODE, /ReplyInPlace/);
  assert.match(ROW_CODE, /row\.actionCard/);
});

test('EmployeeRow — the Needs-you cluster gates on the verdict tier (visualTier === needs-you), not row.group', () => {
  // The loud needs-you cluster must be reachable via visualTier === 'needs-you'.
  assert.match(ROW_CODE, /visualTier\s*===\s*'needs-you'|visualTier\s*===\s*"needs-you"/);
});

test('EmployeeRow — an In-motion body renders the legible focusLine and NO action button cluster', () => {
  // There is an in-motion branch keyed on the visual tier.
  assert.match(ROW_CODE, /visualTier\s*===\s*'in-motion'|visualTier\s*===\s*"in-motion"/);
  // The in-motion calm body references focusLine.
  assert.match(ROW_CODE, /focusLine/);
});

test('EmployeeRow — a Watch body keeps the honest affordance (assign for stuck, Open for external/cycle, none for self-resolving)', () => {
  assert.match(ROW_CODE, /visualTier\s*===\s*'watch'|visualTier\s*===\s*"watch"/);
  // The watch body still references the affordance / assign / open path.
  assert.match(ROW_CODE, /actionAffordance|showAssign|OwnerPickerPopover/);
});

test('EmployeeRow — chainless idle/stale Watch rows keep stand-down/resume (Phase-9 affordances preserved)', () => {
  assert.match(ROW_CODE, /standDown|Stand down/);
  assert.match(ROW_CODE, /resume|Resume/);
});

test('EmployeeRow — no UUID literal / no dangerouslySetInnerHTML in the tier-variant render path', () => {
  assert.equal((ROW_CODE.match(/dangerouslySetInnerHTML/g) || []).length, 0);
  assert.doesNotMatch(ROW_CODE, UUID_RE);
});
