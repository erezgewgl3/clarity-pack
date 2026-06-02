// test/worker/situation/build-pulse-summary.test.mjs
//
// Plan 15-01 Task 1 — buildPulseSummary pure aggregation (COCK-01 / SC1 worker
// half; SC3 no view re-derivation; SC4 all-zero floor).
//
// The four Pulse vital signs are sums over the EXISTING per-row engine verdicts
// (SituationEmployeeRow.blockerChain.{tier, terminalKind} + group) and the
// already-computed needsYou.count — per the LOCKED 15-CONTEXT D-01 definitions:
//   need-you     = needsYou.count (verbatim — NOT re-counted from rows)
//   in-motion    = rows with blockerChain.tier === 'in-motion'
//                  PLUS chainless rows with group === 'working' (no double-count)
//   stuck        = rows with blockerChain.terminalKind === 'AWAITING_AGENT_STUCK'
//   self-clearing= rows with blockerChain.terminalKind === 'SELF_RESOLVING'
//
// PURITY: buildPulseSummary makes ZERO host calls / awaits / fetches — it is a
// pure sum over its inputs. The source-grep assertion at the end of this file
// enforces that (no ctx./await/fetch token outside comments).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { buildPulseSummary } from '../../../src/worker/situation/build-pulse-summary.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Minimal fixture builders (only the fields the aggregation reads). --------

/** A row with a blocker chain carrying a given tier + terminalKind. */
function chainRow({ agentId, tier, terminalKind, group = 'needs_you' }) {
  return {
    agentId,
    name: `Agent ${agentId}`,
    role: 'general',
    state: 'blocked',
    group,
    isPaused: false,
    focusIssueId: null,
    focusLine: null,
    lastActivityAt: null,
    ageBucket: 'fresh',
    blockerChain: {
      rootIssueId: 'X-1',
      leafIssueId: 'X-1',
      leafIssueUuid: null,
      humanAction: 'do thing',
      ownerName: 'Unassigned',
      ownerAgentId: null,
      needsYou: tier === 'needs-you',
      tier,
      actionAffordance: 'none',
      awaitedPartyLabel: 'do thing',
      targetAgentUuid: null,
      targetIssueUuid: null,
      terminalKind,
      needsDurabilityFlip: false,
    },
    doneTodayCount: 0,
  };
}

/** A chainless row (blockerChain === null) with a given agent-state group. */
function chainlessRow({ agentId, group }) {
  return {
    agentId,
    name: `Agent ${agentId}`,
    role: 'general',
    state: group === 'working' ? 'running' : 'idle',
    group,
    isPaused: false,
    focusIssueId: null,
    focusLine: null,
    lastActivityAt: null,
    ageBucket: 'fresh',
    blockerChain: null,
    doneTodayCount: 0,
  };
}

const needsYou = (count) => ({ count, topAction: null });

// --- Tests -------------------------------------------------------------------

test('need-you === needsYou.count verbatim (not re-counted from rows)', () => {
  // 3 needs-you-tier rows present, but needsYou.count says 7 (per-leaf deduped).
  // The pulse must report the deduped count, NOT the row count.
  const rows = [
    chainRow({ agentId: 'a', tier: 'needs-you', terminalKind: 'AWAITING_HUMAN' }),
    chainRow({ agentId: 'b', tier: 'needs-you', terminalKind: 'UNOWNED' }),
    chainRow({ agentId: 'c', tier: 'needs-you', terminalKind: 'AWAITING_HUMAN' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(7));
  assert.equal(pulse.needYou, 7, 'need-you is the passed needsYou.count verbatim');
});

test('in-motion counts in-motion-tier rows + chainless working rows (NO double-count)', () => {
  const rows = [
    // in-motion-tier chain (counts via the tier branch ONCE — its group is
    // 'working' but it must NOT be double-counted by the group branch).
    chainRow({ agentId: 'a', tier: 'in-motion', terminalKind: 'AWAITING_AGENT_WORKING', group: 'working' }),
    // chainless working row (counts via the group branch).
    chainlessRow({ agentId: 'b', group: 'working' }),
    // chainless idle row (NOT in motion).
    chainlessRow({ agentId: 'c', group: 'idle' }),
    // needs-you chain (NOT in motion).
    chainRow({ agentId: 'd', tier: 'needs-you', terminalKind: 'AWAITING_HUMAN' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(0));
  assert.equal(pulse.inMotion, 2, 'one in-motion-tier chain + one chainless working row, counted once each');
});

test('stuck === rows with terminalKind AWAITING_AGENT_STUCK', () => {
  const rows = [
    chainRow({ agentId: 'a', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK' }),
    chainRow({ agentId: 'b', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK' }),
    chainRow({ agentId: 'c', tier: 'watch', terminalKind: 'SELF_RESOLVING' }),
    chainRow({ agentId: 'd', tier: 'in-motion', terminalKind: 'AWAITING_AGENT_WORKING' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(0));
  assert.equal(pulse.stuck, 2, 'two AWAITING_AGENT_STUCK rows');
});

test('self-clearing === rows with terminalKind SELF_RESOLVING', () => {
  const rows = [
    chainRow({ agentId: 'a', tier: 'watch', terminalKind: 'SELF_RESOLVING' }),
    chainRow({ agentId: 'b', tier: 'watch', terminalKind: 'SELF_RESOLVING' }),
    chainRow({ agentId: 'c', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(0));
  assert.equal(pulse.selfClearing, 2, 'two SELF_RESOLVING rows');
});

test('representative verdict set — all four counts at once', () => {
  const rows = [
    chainRow({ agentId: 'a', tier: 'needs-you', terminalKind: 'AWAITING_HUMAN' }),
    chainRow({ agentId: 'b', tier: 'in-motion', terminalKind: 'AWAITING_AGENT_WORKING', group: 'working' }),
    chainlessRow({ agentId: 'c', group: 'working' }),
    chainRow({ agentId: 'd', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK' }),
    chainRow({ agentId: 'e', tier: 'watch', terminalKind: 'SELF_RESOLVING' }),
    chainRow({ agentId: 'f', tier: 'watch', terminalKind: 'SELF_RESOLVING' }),
    chainlessRow({ agentId: 'g', group: 'idle' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(3));
  assert.deepEqual(pulse, {
    needYou: 3, // from needsYou.count verbatim
    inMotion: 2, // one in-motion chain + one chainless working
    stuck: 1, // one AWAITING_AGENT_STUCK
    selfClearing: 2, // two SELF_RESOLVING
  });
});

test('degrade — empty employees + needsYou {count:0} -> all-zero floor', () => {
  const pulse = buildPulseSummary([], needsYou(0));
  assert.deepEqual(pulse, { needYou: 0, inMotion: 0, stuck: 0, selfClearing: 0 });
});

test('SC3/SC4 purity — buildPulseSummary source makes no ctx./await/fetch call', () => {
  const src = readFileSync(
    join(__dirname, '../../../src/worker/situation/build-pulse-summary.ts'),
    'utf8',
  );
  // Strip line comments so the doc-comment vocabulary never trips the guard.
  const code = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  assert.ok(!/\bctx\./.test(code), 'no ctx. host call in the aggregation');
  assert.ok(!/\bawait\b/.test(code), 'no await — the aggregation is synchronous/pure');
  assert.ok(!/\bfetch\b/.test(code), 'no fetch — pure sum over inputs');
});
