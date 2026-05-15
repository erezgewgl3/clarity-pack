// test/worker/bulletin/verifier.test.mjs
//
// Plan 03-02 Task 1 RED — pass-2 deterministic verifier (CONTEXT.md D-15).
// verifyDraft re-runs every standing_numbers[i].sql via an injected SqlClient
// and rejects on numeric mismatch (typed) or UNKNOWN_SLOT.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { verifyDraft } from '../../../src/worker/bulletin/bulletin-verifier.ts';

// Build a draft with the supplied standing-number rows. departments carry no
// `{{NUMBER:X}}` prose unless `prose` is given.
function makeDraft({ standingNumbers = [], prose = '' } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Monday', dateText: '2026-05-07', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: prose ? [{ name: 'Sales', items: [], editorialSummary: prose }] : [],
    standingNumbers,
    lineageThreads: [],
  };
}

// A SqlClient whose query returns the canned value for any SQL string.
function fakeSql(value) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async query() {
      calls += 1;
      return [{ value }];
    },
  };
}

test('verifier: draft with no standing_numbers returns {ok:true}', async () => {
  const result = await verifyDraft(makeDraft(), fakeSql(0), 'company-1');
  assert.deepEqual(result, { ok: true });
});

test('verifier: all slots match claimed values returns {ok:true}', async () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' }],
  });
  const result = await verifyDraft(draft, fakeSql(2475), 'company-1');
  assert.deepEqual(result, { ok: true });
});

test('verifier: integer mismatch returns typed {ok:false, mismatches}', async () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' }],
  });
  const result = await verifyDraft(draft, fakeSql(2470), 'company-1');
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.mismatches));
  assert.equal(result.mismatches[0].slot, 'mrr');
  assert.equal(result.mismatches[0].claimed, 2475);
  assert.equal(result.mismatches[0].actual, 2470);
  assert.equal(result.mismatches[0].tolerance, 0);
});

test('verifier: pct slot within ±0.01 tolerance passes', async () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'reply_rate_7d', displayName: 'Reply rate', value: 0.150, format: 'pct' }],
  });
  const result = await verifyDraft(draft, fakeSql(0.145), 'company-1');
  assert.deepEqual(result, { ok: true });
});

test('verifier: pct slot beyond ±0.01 tolerance fails', async () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'reply_rate_7d', displayName: 'Reply rate', value: 0.150, format: 'pct' }],
  });
  const result = await verifyDraft(draft, fakeSql(0.100), 'company-1');
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.mismatches));
  assert.equal(result.mismatches[0].slot, 'reply_rate_7d');
});

test('verifier: unknown standing-number slot key returns {ok:false, kind:UNKNOWN_SLOT}', async () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'foo', displayName: 'Foo', value: 1, format: 'count' }],
  });
  const result = await verifyDraft(draft, fakeSql(1), 'company-1');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'UNKNOWN_SLOT');
  assert.equal(result.slot, 'foo');
});

test('verifier: deterministic — twice with same inputs is deep-equal', async () => {
  const draft = makeDraft({
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' }],
  });
  const a = await verifyDraft(draft, fakeSql(2470), 'company-1');
  const b = await verifyDraft(draft, fakeSql(2470), 'company-1');
  assert.deepEqual(a, b);
});

test('verifier: async — accepts a narrow SqlClient and calls query once per known slot', async () => {
  const sql = fakeSql(2475);
  const draft = makeDraft({
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' }],
  });
  await verifyDraft(draft, sql, 'company-1');
  assert.equal(sql.calls, 1);
});
