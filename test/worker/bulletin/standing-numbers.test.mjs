// test/worker/bulletin/standing-numbers.test.mjs
//
// Plan 03-02 Task 1 RED — STANDING_NUMBER_SLOTS registry + computeStandingNumbers.
// BULL-05: every number is grep-able to a static parameterized SQL query.
// T-03-10: no string concatenation in SQL — companyId is the only bound param.
//
// Debug verifier-counts-own-issue (2026-05-17): the three public.issues slots
// MUST exclude Clarity Pack's own operation issues (origin_kind prefixed
// `plugin:clarity-pack:operation:`) — otherwise the bulletin-compile pipeline
// counts its own dispatch issue and verifyDraft pass-2 hard-rejects every cycle.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  STANDING_NUMBER_SLOTS,
  computeStandingNumbers,
} from '../../../src/worker/bulletin/standing-numbers.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

test('standing-numbers: registry has exactly 5 slots', () => {
  assert.equal(STANDING_NUMBER_SLOTS.length, 5);
});

test('standing-numbers: registry keys are the 5 v1 slots in exact order', () => {
  assert.deepEqual(
    STANDING_NUMBER_SLOTS.map((s) => s.key),
    ['open_issues', 'completed_7d', 'blocked_issues', 'agent_spend_mtd', 'budget_used_pct'],
  );
});

test('standing-numbers: every slot SQL is non-empty, contains $1, and has no template literals', () => {
  for (const slot of STANDING_NUMBER_SLOTS) {
    assert.equal(typeof slot.sql, 'string');
    assert.ok(slot.sql.length > 0, `${slot.key} sql must be non-empty`);
    assert.ok(slot.sql.includes('$1'), `${slot.key} sql must bind $1`);
    assert.ok(!/\$\{[^}]*\}/.test(slot.sql), `${slot.key} sql must not contain a template literal`);
  }
});

test('standing-numbers: every slot params array carries exactly the companyId placeholder', () => {
  for (const slot of STANDING_NUMBER_SLOTS) {
    assert.ok(Array.isArray(slot.params));
    assert.equal(slot.params.length, 1);
    assert.equal(slot.params[0], '<companyId>');
  }
});

test('standing-numbers: every slot format is one of the four NumberFormat values', () => {
  for (const slot of STANDING_NUMBER_SLOTS) {
    assert.ok(['currency', 'count', 'pct', 'ratio'].includes(slot.format));
  }
});

test('standing-numbers: the three public.issues slots exclude clarity-pack operation issues', () => {
  // Debug verifier-counts-own-issue — the compile pipeline's own operation
  // issue (origin_kind `plugin:clarity-pack:operation:%`) must not be counted.
  for (const key of ['open_issues', 'completed_7d', 'blocked_issues']) {
    const slot = STANDING_NUMBER_SLOTS.find((s) => s.key === key);
    assert.ok(slot, `slot ${key} must exist`);
    assert.ok(
      slot.sql.includes('FROM public.issues'),
      `${key} must query public.issues`,
    );
    assert.ok(
      slot.sql.includes("origin_kind NOT LIKE 'plugin:clarity-pack:operation:%'"),
      `${key} must exclude clarity-pack operation issues by origin_kind`,
    );
    // The NULL-safe guard is mandatory: origin_kind is nullable, and a bare
    // `NOT LIKE` would drop every human issue (NULL NOT LIKE → NULL, not TRUE).
    assert.ok(
      slot.sql.includes('origin_kind IS NULL OR'),
      `${key} must keep human issues whose origin_kind IS NULL`,
    );
  }
});

test('standing-numbers: the two public.companies slots do NOT carry the issue-exclusion clause', () => {
  for (const key of ['agent_spend_mtd', 'budget_used_pct']) {
    const slot = STANDING_NUMBER_SLOTS.find((s) => s.key === key);
    assert.ok(slot, `slot ${key} must exist`);
    assert.ok(
      !slot.sql.includes('origin_kind'),
      `${key} queries public.companies and must not reference issues.origin_kind`,
    );
  }
});

test('standing-numbers: computeStandingNumbers calls db.query once per slot with companyId as $1', async () => {
  const calls = [];
  const ctx = {
    db: wrapHostFaithfulDb({
      async query(sql, params) {
        calls.push({ sql, params });
        return [{ value: 7 }];
      },
    }),
  };
  await computeStandingNumbers(ctx, 'company-1');
  assert.equal(calls.length, 5);
  for (const c of calls) {
    assert.equal(c.params[0], 'company-1', 'companyId must be substituted for the <companyId> placeholder');
  }
});

test('standing-numbers: computeStandingNumbers returns a Record with all 5 keys from each query first row', async () => {
  const ctx = {
    db: wrapHostFaithfulDb({
      async query() {
        return [{ value: 42 }];
      },
    }),
  };
  const out = await computeStandingNumbers(ctx, 'company-1');
  assert.deepEqual(
    Object.keys(out).sort(),
    ['agent_spend_mtd', 'blocked_issues', 'budget_used_pct', 'completed_7d', 'open_issues'],
  );
  for (const v of Object.values(out)) {
    assert.equal(v, 42);
  }
});
