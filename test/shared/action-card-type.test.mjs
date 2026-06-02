// test/shared/action-card-type.test.mjs
//
// Phase 13 Plan 13-01 Task 2 -- ActionCard shared-type smoke + shape guard.
//
// The ActionCard type is the split-identity contract (D-14, NO_UUID_LEAK):
//   - DISPLAY fields (the ONLY fields a render surface may show):
//       namedAction, awaitedParty, estBucket, actionKind, decisionOptions
//   - KEY / DISPATCH-only field (carried, NEVER rendered):
//       sourceIssueUuid
//
// types.ts is a type-only module (no runtime exports), so a value-level import
// yields an empty namespace at runtime -- tsc (Task 3 / build gate) is what
// actually type-checks ActionCard assignability. This test asserts the runtime
// shape of a well-formed ActionCard object literal (it constructs one and
// checks every display field is present and sourceIssueUuid is a string) so the
// contract is exercised in `node --test` too, and documents the split: the set
// of rendered keys is exactly the five display fields.

import { strict as assert } from 'node:assert';
import test from 'node:test';

/**
 * A well-formed ActionCard value. Shaped to the exact type declared in
 * src/shared/types.ts. If the type drifts, the Task 3 tsc gate (and any worker
 * consumer) fails to compile against this literal.
 *
 * @type {import('../../src/shared/types.ts').ActionCard}
 */
const card = {
  namedAction: 'Approve the Q3 budget so Finance can proceed.',
  awaitedParty: 'Founder',
  estBucket: 'quick',
  actionKind: 'decide',
  decisionOptions: ['Approve', 'Reject'],
  generatedAt: '2026-06-02T12:00:00.000Z',
  sourceIssueUuid: 'leaf-uuid-1',
};

const DISPLAY_FIELDS = [
  'namedAction',
  'awaitedParty',
  'estBucket',
  'actionKind',
  'decisionOptions',
];

test('ActionCard: a well-formed object exposes all five display fields', () => {
  for (const f of DISPLAY_FIELDS) {
    assert.ok(f in card, `display field ${f} present`);
  }
  assert.equal(typeof card.namedAction, 'string');
  assert.equal(typeof card.awaitedParty, 'string');
  assert.equal(typeof card.actionKind, 'string');
  assert.ok(['quick', 'focused', 'deep'].includes(card.estBucket), 'estBucket is a coarse bucket');
});

test('ActionCard: decisionOptions is an array OR null (D-08 conservative default)', () => {
  assert.ok(Array.isArray(card.decisionOptions) || card.decisionOptions === null);
  // A binary-absent card carries null, not an invented option set.
  /** @type {import('../../src/shared/types.ts').ActionCard} */
  const openEnded = { ...card, decisionOptions: null };
  assert.equal(openEnded.decisionOptions, null);
});

test('ActionCard: sourceIssueUuid is a key/dispatch field, separate from every display field', () => {
  assert.equal(typeof card.sourceIssueUuid, 'string');
  // NO_UUID_LEAK contract: sourceIssueUuid is NOT one of the rendered fields.
  assert.ok(
    !DISPLAY_FIELDS.includes('sourceIssueUuid'),
    'sourceIssueUuid is excluded from the display-field set',
  );
});
