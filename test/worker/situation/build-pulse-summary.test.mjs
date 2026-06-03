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
// IN-02 — the ONE shared view partition helper (tier-utils.ts). Importing it here
// mechanically locks the pulse chip counts to the tier-strip partition: a future
// engine reclassification that desyncs a chip label from its tier column fails a
// test instead of silently shipping.
import { visualTierOf } from '../../../src/ui/surfaces/situation-room/tier-utils.ts';

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

// --- IN-02: pulse chip ⇔ tier partition consistency --------------------------
//
// The Pulse chips and the tier strip are two views of the same engine verdicts.
// These tests mechanically assert they agree, so a future classifyVerdict change
// that (for example) reclassified AWAITING_AGENT_STUCK to a different tier can't
// silently desync the "N stuck" chip from the Watch column it claims to summarize.

test('IN-02 — every row counted in pulse.stuck (AWAITING_AGENT_STUCK) lands in the Watch tier', () => {
  const rows = [
    chainRow({ agentId: 'a', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK', group: 'needs_you' }),
    chainRow({ agentId: 'b', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK', group: 'working' }),
    chainRow({ agentId: 'c', tier: 'needs-you', terminalKind: 'AWAITING_HUMAN' }),
    chainlessRow({ agentId: 'd', group: 'idle' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(0));
  const stuckRows = rows.filter((r) => r.blockerChain?.terminalKind === 'AWAITING_AGENT_STUCK');
  // The pulse count and the set it summarizes agree.
  assert.equal(pulse.stuck, stuckRows.length, 'pulse.stuck counts every AWAITING_AGENT_STUCK row');
  // EVERY stuck-counted row partitions into Watch — the chip never points at a
  // row that renders outside the Watch column.
  for (const r of stuckRows) {
    assert.equal(visualTierOf(r), 'watch', `stuck row ${r.agentId} must be in the Watch tier`);
  }
});

test('IN-02 — every row counted in pulse.selfClearing (SELF_RESOLVING) lands in the Watch tier', () => {
  const rows = [
    chainRow({ agentId: 'a', tier: 'watch', terminalKind: 'SELF_RESOLVING', group: 'working' }),
    chainRow({ agentId: 'b', tier: 'watch', terminalKind: 'SELF_RESOLVING', group: 'idle' }),
    chainRow({ agentId: 'c', tier: 'in-motion', terminalKind: 'AWAITING_AGENT_WORKING', group: 'working' }),
  ];
  const pulse = buildPulseSummary(rows, needsYou(0));
  const selfRows = rows.filter((r) => r.blockerChain?.terminalKind === 'SELF_RESOLVING');
  assert.equal(pulse.selfClearing, selfRows.length);
  for (const r of selfRows) {
    assert.equal(visualTierOf(r), 'watch', `self-clearing row ${r.agentId} must be in the Watch tier`);
  }
});

test('IN-02 — every row counted in pulse.inMotion lands in the In-motion tier', () => {
  const rows = [
    chainRow({ agentId: 'a', tier: 'in-motion', terminalKind: 'AWAITING_AGENT_WORKING', group: 'working' }),
    chainlessRow({ agentId: 'b', group: 'working' }),
    chainlessRow({ agentId: 'c', group: 'idle' }), // NOT in motion
    chainRow({ agentId: 'd', tier: 'watch', terminalKind: 'AWAITING_AGENT_STUCK' }), // NOT in motion
  ];
  const pulse = buildPulseSummary(rows, needsYou(0));
  const inMotionRows = rows.filter(
    (r) => r.blockerChain?.tier === 'in-motion' || (r.blockerChain == null && r.group === 'working'),
  );
  assert.equal(pulse.inMotion, inMotionRows.length);
  for (const r of inMotionRows) {
    assert.equal(visualTierOf(r), 'in-motion', `in-motion row ${r.agentId} must be in the In-motion tier`);
  }
});

test('IN-02 — the Needs-you tier partition count agrees with the per-leaf needsYou.count on a deduped board', () => {
  // On a board where every needs-you-tier row maps to a distinct leaf (no
  // dedup collapse), the count of rows partitioned into Needs-you equals
  // needsYou.count — the chip label and the tier column agree.
  const rows = [
    chainRow({ agentId: 'a', tier: 'needs-you', terminalKind: 'AWAITING_HUMAN' }),
    chainRow({ agentId: 'b', tier: 'needs-you', terminalKind: 'UNOWNED' }),
    chainRow({ agentId: 'c', tier: 'in-motion', terminalKind: 'AWAITING_AGENT_WORKING', group: 'working' }),
  ];
  const needsYouTierCount = rows.filter((r) => visualTierOf(r) === 'needs-you').length;
  const pulse = buildPulseSummary(rows, needsYou(needsYouTierCount));
  assert.equal(pulse.needYou, needsYouTierCount, 'needYou chip agrees with the Needs-you tier partition');
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
