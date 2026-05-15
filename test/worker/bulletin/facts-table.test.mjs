// test/worker/bulletin/facts-table.test.mjs
//
// Plan 03-02 Task 1 RED — facts-table extraction + slot interpolation.
// CONTEXT.md D-14: structured slots, not prose-extracted numbers. The LLM
// prose uses `{{NUMBER:key}}` placeholders that pure code replaces.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { computeFactsTable, replaceSlots } from '../../../src/worker/bulletin/facts-table.ts';

test('facts-table: computeFactsTable maps rows into FactsTable entry shape', () => {
  const ft = computeFactsTable({
    rows: { mrr: 2475, briefs: 4 },
    slotDefs: {
      mrr: { sql: 'SELECT 1', params: [], format: 'currency' },
      briefs: { sql: 'SELECT 2', params: [], format: 'count' },
    },
  });
  assert.equal(ft.mrr.value, 2475);
  assert.equal(ft.mrr.format, 'currency');
  assert.equal(typeof ft.mrr.sql, 'string');
  assert.ok(Array.isArray(ft.mrr.params));
});

test('facts-table: every emitted entry has a sql + format field (no orphan entries)', () => {
  const ft = computeFactsTable({
    rows: { a: 1, b: 2, c: 3 },
    slotDefs: {
      a: { sql: 'SELECT a', params: [], format: 'count' },
      b: { sql: 'SELECT b', params: [], format: 'pct' },
      c: { sql: 'SELECT c', params: [], format: 'currency' },
    },
  });
  for (const [, entry] of Object.entries(ft)) {
    assert.equal(typeof entry.sql, 'string');
    assert.ok(['currency', 'count', 'pct', 'ratio'].includes(entry.format));
  }
});

test('facts-table: replaceSlots formats a count slot as a raw integer', () => {
  const ft = computeFactsTable({
    rows: { briefs: 4 },
    slotDefs: { briefs: { sql: 'x', params: [], format: 'count' } },
  });
  assert.equal(replaceSlots('Sent {{NUMBER:briefs}} briefs', ft), 'Sent 4 briefs');
});

test('facts-table: replaceSlots formats a currency slot as en-US currency', () => {
  const ft = computeFactsTable({
    rows: { mrr: 2475 },
    slotDefs: { mrr: { sql: 'x', params: [], format: 'currency' } },
  });
  assert.equal(replaceSlots('MRR is {{NUMBER:mrr}}', ft), 'MRR is $2,475');
});

test('facts-table: replaceSlots formats a pct slot as one-decimal percent', () => {
  const ft = computeFactsTable({
    rows: { reply: 0.148 },
    slotDefs: { reply: { sql: 'x', params: [], format: 'pct' } },
  });
  assert.equal(replaceSlots('Rate is {{NUMBER:reply}}', ft), 'Rate is 14.8%');
});

test('facts-table: replaceSlots throws a tagged UNKNOWN_SLOT error for an unknown placeholder', () => {
  const ft = computeFactsTable({
    rows: { mrr: 1 },
    slotDefs: { mrr: { sql: 'x', params: [], format: 'count' } },
  });
  let thrown = null;
  try {
    replaceSlots('Missing {{NUMBER:zzz}}', ft);
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, 'replaceSlots must throw on an unknown slot');
  assert.equal(thrown.slot, 'zzz');
  assert.match(thrown.message, /UNKNOWN_SLOT/);
});
