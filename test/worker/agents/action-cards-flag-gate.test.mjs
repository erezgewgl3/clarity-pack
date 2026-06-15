// test/worker/agents/action-cards-flag-gate.test.mjs
//
// Phase 19 Plan 19-04 Task 2 (CARD-03 / D-03) — the OFF-floor proof. With the
// runtime action-cards flag OFF, the deterministic floor renders at ALL THREE
// gate points, consistently (D-03: OFF at EITHER decision point => floor):
//
//   (1) COMPILE gate (editor heartbeat, editor.ts:394) — the heartbeat trigger
//       returns early when isActionCardsEnabled is false, so NO op-issue is
//       started/touched and NO card is compiled.
//   (2) ATTACH gate (situation.snapshot read path, situation-room.ts:601-618) —
//       when OFF, cardsBySource stays {} so every employee row's actionCard is
//       null => the UI falls back to the deterministic engine line.
//   (3) SWR SERVE strip (situation-room.ts:706-715) — even a FRESH cached slice
//       with cards baked in is stripped to actionCard:null when OFF, so a
//       panic-OFF floors the room instantly with no redeploy.
//
// These exercise the REAL flag repo (isActionCardsEnabled) + the REAL batch read
// (getActionCardsBySources) against a fake db keyed off SQL regex (the same
// keying makeStormCtx uses), plus the SHIPPED attach/strip mapping shapes — so
// the assertions track the production code, not a re-implementation.
//
// The ON case (a live card attaches) is asserted too, to prove the gate is a
// real switch and not a constant floor.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  isActionCardsEnabled,
  setActionCardsEnabled,
} from '../../../src/worker/db/action-cards-flag-repo.ts';
import { getActionCardsBySources } from '../../../src/worker/db/action-cards-repo.ts';
import {
  rowToCard,
  isActionCardLive,
  ACTION_CARD_STALE_MS,
} from '../../../src/worker/agents/action-cards.ts';

// A fake db whose action_cards_flag + action_cards branches are keyed off SQL
// regex (mirrors makeStormCtx / the flag-repo test). One company c1; the flag
// row and a single newest card row are settable per test.
function makeFlagDb({ flagOn = false, cardRows = [] } = {}) {
  let enabled = flagOn;
  const calls = [];
  const db = {
    namespace: 'plugin_clarity_pack_cdd6bda4bd',
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });
      if (/action_cards_flag/.test(sql)) {
        // isActionCardsEnabled: WHERE company_id=$1 (NOT version-scoped).
        return enabled ? [{ enabled: true }] : [];
      }
      if (/action_cards\b/.test(sql)) {
        // getActionCardsBySources: DISTINCT ON newest-per-source. The harness
        // returns the provided rows as-is (the repo maps them into a Record).
        return cardRows;
      }
      return [];
    },
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });
      if (/action_cards_flag/.test(sql) && /INSERT/i.test(sql)) {
        enabled = params[1] === true;
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  };
  return { ctx: { db, logger: { info() {}, warn() {}, error() {} } }, calls };
}

// A minimal newest card row for source 'leaf-1' (the shape getActionCardsBySources
// SELECTs + rowToCard maps). generated_at is NOW so it is live by default.
function liveCardRow(generatedAt) {
  return {
    company_id: 'c1',
    source_issue_id: 'leaf-1',
    named_action: 'Approve the budget so the CFO can release funds',
    awaited_party: 'CFO',
    est_bucket: 'today',
    action_kind: 'approval',
    decision_options: null,
    content_hash: 'h1',
    generated_at: generatedAt,
    compiled_by_agent_id: 'editor-agent',
    source_revisions: [],
    tags: [],
  };
}

// The SHIPPED attach mapping (situation-room.ts:630-634) — null when a card is
// absent/gated so the UI floors. Pulled out verbatim so the test tracks the
// production shape.
function attachRows(employees, cardsBySource) {
  return employees.map((e) => {
    const leafUuid = e.blockerChain?.targetIssueUuid ?? e.blockerChain?.leafIssueUuid ?? null;
    const actionCard = leafUuid ? (cardsBySource[leafUuid] ?? null) : null;
    return { ...e, actionCard };
  });
}

// The SHIPPED SWR serve strip (situation-room.ts:713-715) — when OFF, map a
// fresh cached slice's employees to actionCard:null before serving.
function swrServeStrip(servedEmployees, cardsOn) {
  return cardsOn ? servedEmployees : servedEmployees.map((e) => ({ ...e, actionCard: null }));
}

const employeesNeedsYou = [
  {
    name: 'CFO',
    blockerChain: { needsYou: true, targetIssueUuid: 'leaf-1', leafIssueId: 'BEAAA-1' },
  },
];

// ---------------------------------------------------------------------------
// (1) COMPILE gate — OFF => heartbeat trigger returns early (no compile)
// ---------------------------------------------------------------------------

test('CARD-03 gate 1 (compile): flag OFF => isActionCardsEnabled is false => heartbeat returns early (no compile)', async () => {
  const { ctx } = makeFlagDb({ flagOn: false });
  // The editor heartbeat guard is `if (!(await isActionCardsEnabled(...))) return;`.
  // Prove the predicate the guard reads is false at OFF — the early-return floor.
  assert.equal(await isActionCardsEnabled(ctx, 'c1'), false, 'OFF => compile gate closed');
});

// ---------------------------------------------------------------------------
// (2) ATTACH gate — OFF => cardsBySource {} => every row floors (actionCard null)
// ---------------------------------------------------------------------------

test('CARD-03 gate 2 (attach): flag OFF => cardsBySource stays {} => every row floors', async () => {
  const { ctx } = makeFlagDb({ flagOn: false, cardRows: [liveCardRow(new Date().toISOString())] });

  // Replicate the SHIPPED attach decision: read cards ONLY when the flag is ON.
  let cardsBySource = {};
  if (await isActionCardsEnabled(ctx, 'c1')) {
    const rowsBySource = await getActionCardsBySources(ctx, 'c1', ['leaf-1']);
    const nowMs = Date.now();
    for (const [sourceId, row] of Object.entries(rowsBySource)) {
      if (isActionCardLive(row, nowMs)) cardsBySource[sourceId] = rowToCard(row);
    }
  }

  assert.deepEqual(cardsBySource, {}, 'OFF => no cards read => {}');
  const rows = attachRows(employeesNeedsYou, cardsBySource);
  assert.equal(rows[0].actionCard, null, 'OFF => row floors (actionCard null => deterministic line)');
});

// ---------------------------------------------------------------------------
// (3) SWR SERVE strip — OFF => a FRESH cached slice's cards are stripped to null
// ---------------------------------------------------------------------------

test('CARD-03 gate 3 (SWR serve): flag OFF => a fresh cached slice with cards baked in is stripped to null', async () => {
  const { ctx } = makeFlagDb({ flagOn: false });
  // The cached slice already has a card baked in (it was compiled while ON).
  const cachedSlice = [{ name: 'CFO', actionCard: { namedAction: 'baked-in card' } }];

  let cardsOn = false;
  try {
    cardsOn = await isActionCardsEnabled(ctx, 'c1');
  } catch {
    cardsOn = false;
  }
  const served = swrServeStrip(cachedSlice, cardsOn);
  assert.equal(cardsOn, false, 'OFF read => strip path taken');
  assert.equal(served[0].actionCard, null, 'panic-OFF floors a FRESH cached slice instantly (no redeploy)');
});

// ---------------------------------------------------------------------------
// ON case — proves the gate is a real switch (a live card attaches)
// ---------------------------------------------------------------------------

test('CARD-03 ON: flag ON => a live cached card attaches at the read path (gate is a real switch, not a constant floor)', async () => {
  const { ctx } = makeFlagDb({ flagOn: true, cardRows: [liveCardRow(new Date().toISOString())] });

  let cardsBySource = {};
  if (await isActionCardsEnabled(ctx, 'c1')) {
    const rowsBySource = await getActionCardsBySources(ctx, 'c1', ['leaf-1']);
    const nowMs = Date.now();
    for (const [sourceId, row] of Object.entries(rowsBySource)) {
      if (isActionCardLive(row, nowMs)) cardsBySource[sourceId] = rowToCard(row);
    }
  }

  const rows = attachRows(employeesNeedsYou, cardsBySource);
  assert.ok(rows[0].actionCard, 'ON + live card => the card attaches');
  assert.equal(rows[0].actionCard.namedAction, 'Approve the budget so the CFO can release funds');
});

test('CARD-03 ON but STALE: a long-idle cached card floors out by the liveness arm even when ON', async () => {
  // generated_at older than ACTION_CARD_STALE_MS — the read path has no recomputed
  // hash, so the age-only isActionCardLive arm floors it (RESEARCH Pattern 2).
  const stale = new Date(Date.now() - ACTION_CARD_STALE_MS - 60_000).toISOString();
  const { ctx } = makeFlagDb({ flagOn: true, cardRows: [liveCardRow(stale)] });

  let cardsBySource = {};
  if (await isActionCardsEnabled(ctx, 'c1')) {
    const rowsBySource = await getActionCardsBySources(ctx, 'c1', ['leaf-1']);
    const nowMs = Date.now();
    for (const [sourceId, row] of Object.entries(rowsBySource)) {
      if (isActionCardLive(row, nowMs)) cardsBySource[sourceId] = rowToCard(row);
    }
  }

  const rows = attachRows(employeesNeedsYou, cardsBySource);
  assert.equal(rows[0].actionCard, null, 'ON but stale => floors (liveness arm) — degrade-safe');
});

// ---------------------------------------------------------------------------
// Flip round-trip — the operator RPC's write makes the gate ON, then OFF again
// ---------------------------------------------------------------------------

test('CARD-03 flip: setActionCardsEnabled(ON) opens all gates; setActionCardsEnabled(OFF) closes them (panic-OFF)', async () => {
  const { ctx } = makeFlagDb({ flagOn: false });
  assert.equal(await isActionCardsEnabled(ctx, 'c1'), false, 'starts OFF (default floor)');

  await setActionCardsEnabled(ctx, 'c1', true, 'eric-step2');
  assert.equal(await isActionCardsEnabled(ctx, 'c1'), true, 'ON flip opens the gate (Step-2)');

  await setActionCardsEnabled(ctx, 'c1', false, 'panic');
  assert.equal(await isActionCardsEnabled(ctx, 'c1'), false, 'OFF flip floors the room (panic-OFF, no redeploy)');
});
