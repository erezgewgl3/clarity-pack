// test/worker/agents/action-cards.test.mjs
//
// Plan 13-02 Task 2 — the Editor-Agent action-card step + its pure helpers.
//
// Covers:
//   - normalizeEstBucket: valid buckets pass; garbage/empty → null (D-09).
//   - parseDecisionOptions: an explicit >=2-element binary → array; open-ended /
//     single-element / non-array → null (conservative, D-08 / ACT-03).
//   - isActionCardFresh: fresh (hash match + age ≤ 10 min); hash mismatch →
//     stale; age > 10 min → stale; null → stale (D-11, both arms independently).
//   - buildActionCardPrompt: contains the anti-fabrication + no-UUID
//     instructions and NO company-prefix literal (D-07/D-10).
//   - driveActionCardsStep smoke: empty rows → 'ready' no cards; a thrown host
//     call yields a status (NEVER throws, D-12); a paused agent → 'paused'.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  normalizeEstBucket,
  parseDecisionOptions,
  isActionCardFresh,
  buildActionCardPrompt,
  driveActionCardsStep,
  ACTION_CARD_STALE_MS,
} from '../../../src/worker/agents/action-cards.ts';

const CID = 'co-1';
const LEAF = '11111111-2222-3333-4444-555555555555';
const EDITOR_UUID = '618eec58-2a0d-422f-9fbd-672c0cdddf2c';

function sampleRows() {
  return [
    {
      sourceIssueId: LEAF,
      leafIssueId: 'BEAAA-649',
      awaitedPartyLabel: 'waiting on you — Founder ruling',
      humanAction: 'waiting on you — Founder ruling, BEAAA-649',
      actionAffordance: 'reply',
      inputs: { body: 'Need a yes/no on shipping the rescans API upgrade.', comments: [], refs: [] },
    },
  ];
}

// --- normalizeEstBucket (D-09) ------------------------------------------------

test('normalizeEstBucket — valid buckets pass through', () => {
  assert.equal(normalizeEstBucket('quick'), 'quick');
  assert.equal(normalizeEstBucket('focused'), 'focused');
  assert.equal(normalizeEstBucket('deep'), 'deep');
});

test('normalizeEstBucket — garbage / empty / number → null (no fake minutes)', () => {
  assert.equal(normalizeEstBucket('12 minutes'), null);
  assert.equal(normalizeEstBucket(''), null);
  assert.equal(normalizeEstBucket(undefined), null);
  assert.equal(normalizeEstBucket(null), null);
  assert.equal(normalizeEstBucket(30), null);
  assert.equal(normalizeEstBucket('QUICK'), null); // case-sensitive enum
});

// --- parseDecisionOptions (D-08 / ACT-03) -------------------------------------

test('parseDecisionOptions — explicit >=2-element binary → array', () => {
  assert.deepEqual(parseDecisionOptions(['Approve', 'Reject']), ['Approve', 'Reject']);
  assert.deepEqual(parseDecisionOptions(['Ship', 'Hold', 'Defer']), ['Ship', 'Hold', 'Defer']);
});

test('parseDecisionOptions — single element → null (not a binary)', () => {
  assert.equal(parseDecisionOptions(['Approve']), null);
});

test('parseDecisionOptions — open-ended / non-array → null (conservative)', () => {
  assert.equal(parseDecisionOptions(null), null);
  assert.equal(parseDecisionOptions(undefined), null);
  assert.equal(parseDecisionOptions('Approve or reject'), null);
  assert.equal(parseDecisionOptions({}), null);
  assert.equal(parseDecisionOptions([]), null);
  assert.equal(parseDecisionOptions(['', '  ']), null); // empties stripped → <2
});

// --- isActionCardFresh (D-11 — both arms independently) -----------------------

test('isActionCardFresh — fresh: hash matches AND age ≤ 10 min', () => {
  const now = Date.parse('2026-06-02T12:00:00Z');
  const card = { content_hash: 'h', generated_at: '2026-06-02T11:55:00Z' };
  assert.equal(isActionCardFresh(card, 'h', now), true);
});

test('isActionCardFresh — hash MISMATCH → stale even when fresh by age', () => {
  const now = Date.parse('2026-06-02T12:00:00Z');
  const card = { content_hash: 'OLD', generated_at: '2026-06-02T11:59:00Z' };
  assert.equal(isActionCardFresh(card, 'NEW', now), false);
});

test('isActionCardFresh — age > 10 min → stale even when hash matches', () => {
  const now = Date.parse('2026-06-02T12:00:00Z');
  // 11 minutes old — just past the 10-min liveness arm.
  const genMs = now - (ACTION_CARD_STALE_MS + 60_000);
  const card = { content_hash: 'h', generated_at: new Date(genMs).toISOString() };
  assert.equal(isActionCardFresh(card, 'h', now), false);
});

test('isActionCardFresh — null / absent card → stale', () => {
  const now = Date.parse('2026-06-02T12:00:00Z');
  assert.equal(isActionCardFresh(null, 'h', now), false);
  assert.equal(isActionCardFresh(undefined, 'h', now), false);
  assert.equal(isActionCardFresh({ content_hash: 'h', generated_at: 'not-a-date' }, 'h', now), false);
});

// --- buildActionCardPrompt (D-07 / D-10) --------------------------------------

test('buildActionCardPrompt — anti-fabrication + no-UUID instructions present', () => {
  const prompt = buildActionCardPrompt(sampleRows());
  assert.match(prompt, /do NOT invent/i);
  assert.match(prompt, /UUID/); // forbids UUIDs in the sentences
  // coarse bucket, never minutes
  assert.match(prompt, /NEVER a number of minutes/i);
  // conservative binary
  assert.match(prompt, /decisionOptions/);
});

test('buildActionCardPrompt — instance-agnostic (no company-prefix literal)', () => {
  const prompt = buildActionCardPrompt(sampleRows());
  assert.doesNotMatch(prompt, /BEAAA(?!-649)/); // the leaf id BEAAA-649 is allowed input; no other BEAAA literal
  assert.doesNotMatch(prompt, /\bCOU\b/);
});

// --- driveActionCardsStep smoke (D-12 — NEVER throws) -------------------------

test('driveActionCardsStep — empty needsYouRows → status ready, no cards', async () => {
  const ctx = { logger: { info() {}, warn() {} } };
  const res = await driveActionCardsStep(ctx, { companyId: CID, needsYouRows: [] });
  assert.equal(res.status, 'ready');
  assert.deepEqual(res.cards, {});
});

test('driveActionCardsStep — a thrown host call yields a status (NEVER throws)', async () => {
  // getActionCardBySource throws on the cache read; resolveEditorAgentId throws
  // too — the step must degrade to a status, not propagate.
  const ctx = {
    logger: { info() {}, warn() {} },
    db: {
      async query() {
        throw new Error('db boom');
      },
      async execute() {
        throw new Error('db boom');
      },
    },
    issues: {
      async list() {
        throw new Error('list boom');
      },
    },
    agents: {
      managed: {
        async reconcile() {
          throw new Error('reconcile boom');
        },
      },
    },
  };
  let res;
  await assert.doesNotReject(async () => {
    res = await driveActionCardsStep(ctx, { companyId: CID, needsYouRows: sampleRows() });
  });
  assert.ok(['compiling', 'paused', 'unavailable', 'ready'].includes(res.status));
});

test('driveActionCardsStep — a paused Editor-Agent → status paused, no new cards', async () => {
  const ctx = {
    logger: { info() {}, warn() {} },
    db: {
      async query() {
        return []; // no cached card → compile set non-empty
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    issues: {
      async list(input = {}) {
        // resolveEditorAgentId discovers the agent from an op issue; the
        // consume-before-spawn read-back lists ops by originId → none ready.
        if (input.originKindPrefix && input.originId === undefined) {
          return [{ id: 'op-seed', assigneeAgentId: EDITOR_UUID }];
        }
        return [];
      },
      async update() {
        return { id: 'x' };
      },
      async requestWakeup() {
        return { queued: true };
      },
      async listComments() {
        return [];
      },
      documents: {
        async list() {
          return [];
        },
        async get() {
          return null;
        },
      },
    },
    agents: {
      async get() {
        return { status: 'paused', pausedAt: new Date().toISOString() };
      },
    },
  };
  const res = await driveActionCardsStep(ctx, { companyId: CID, needsYouRows: sampleRows() });
  assert.equal(res.status, 'paused');
  assert.deepEqual(res.cards, {});
});
