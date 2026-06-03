// test/worker/handlers/sdk-ref-fetch-prefix-gate.test.mjs
//
// HOTFIX v1.4.3 (incident 2026-06-03) — the fake-issue-ID lookup flood.
//
// resolveRefsViaSdk did a per-ref `ctx.issues.get(token, companyId)` for EVERY
// extracted token, including broad-regex false positives like TIER-2, DRAFT-2,
// PHASE-1, ADR-0017, AG-1, DAY-80. On BEAAA this produced ~4,192 GET /issues/<token>
// 404s (~21% of all host requests) — pure wasted DB load.
//
// The fix: list the company's issues ONCE, derive the set of REAL issue prefixes,
// and only `issues.get` a token whose prefix actually exists on this instance.
// Unknown-prefix tokens get ZERO host calls and fall through to the `unknown`
// placeholder (identical UX — they 404'd to unknown before anyway).
//
// Instance-agnostic: the valid prefix is DERIVED from the company's own issues,
// never hardcoded (no 'BEAAA' literal).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveRefsViaSdk, __resetRefPrefixCache } from '../../../src/worker/handlers/sdk-ref-fetch.ts';

test.beforeEach(() => __resetRefPrefixCache());

/** A stub issues client that records every `get` id and resolves from a fixed
 *  list of issues (by identifier). `extra` lets a test expose an issue to `get`
 *  that is intentionally absent from `list` (pagination-gap case). */
function makeIssues({ listIssues, extra = {} }) {
  const getCalls = [];
  let listCalls = 0;
  return {
    getCalls,
    get listCalls() {
      return listCalls;
    },
    async get(id /*, companyId */) {
      getCalls.push(id);
      if (extra[id]) return extra[id];
      return listIssues.find((i) => i.identifier === id) ?? null;
    },
    async list(/* { companyId } */) {
      listCalls += 1;
      return listIssues;
    },
  };
}

test('resolveRefsViaSdk does NOT issues.get tokens whose prefix is not a real company prefix', async () => {
  const listIssues = [
    { id: 'u1', identifier: 'BEAAA-972', title: 'Real one', status: 'blocked' },
    { id: 'u2', identifier: 'BEAAA-100', title: 'Real two', status: 'todo' },
  ];
  const issues = makeIssues({ listIssues });

  const refs = ['BEAAA-972', 'TIER-2', 'DRAFT-2', 'PHASE-1', 'ADR-0017', 'AG-1', 'DAY-80'];
  const resolved = await resolveRefsViaSdk(issues, refs, 'co-flood');

  // Real ref resolves.
  assert.equal(
    resolved.find((r) => r.requestedId === 'BEAAA-972')?.issue.identifier,
    'BEAAA-972',
    'a real BEAAA ref must still resolve',
  );

  // False-positive tokens are omitted (the pure resolver emits `unknown`).
  for (const fp of ['TIER-2', 'DRAFT-2', 'PHASE-1', 'ADR-0017', 'AG-1', 'DAY-80']) {
    assert.equal(
      resolved.find((r) => r.requestedId === fp),
      undefined,
      `${fp} must be unresolved`,
    );
  }

  // CRITICAL (the flood fix): ZERO issues.get for any non-company-prefix token.
  for (const fp of ['TIER-2', 'DRAFT-2', 'PHASE-1', 'ADR-0017', 'AG-1', 'DAY-80']) {
    assert.ok(
      !issues.getCalls.includes(fp),
      `issues.get must NOT be called for the false-positive token ${fp} (got calls: ${JSON.stringify(issues.getCalls)})`,
    );
  }
});

test('resolveRefsViaSdk still resolves a valid-prefix ref missing from the list page (pagination safety)', async () => {
  // The list page contains only BEAAA-1, so the valid prefix {BEAAA} is derived,
  // but the requested BEAAA-999 is NOT in the page — it must still be fetched via get.
  const listIssues = [{ id: 'u1', identifier: 'BEAAA-1', title: 'x', status: 'todo' }];
  const issues = makeIssues({
    listIssues,
    extra: { 'BEAAA-999': { id: 'u999', identifier: 'BEAAA-999', title: 'deep', status: 'done' } },
  });

  const resolved = await resolveRefsViaSdk(issues, ['BEAAA-999', 'TIER-9'], 'co-flood');

  assert.equal(
    resolved.find((r) => r.requestedId === 'BEAAA-999')?.issue.identifier,
    'BEAAA-999',
    'a valid-prefix ref absent from the list page must still resolve via get',
  );
  assert.ok(issues.getCalls.includes('BEAAA-999'), 'BEAAA-999 must be fetched via get');
  // The non-matching-prefix token is still skipped.
  assert.ok(!issues.getCalls.includes('TIER-9'), 'TIER-9 must NOT be fetched');
});

test('resolveRefsViaSdk makes zero host calls when no token matches any real prefix', async () => {
  const listIssues = [{ id: 'u1', identifier: 'COU-5', title: 'real', status: 'todo' }];
  const issues = makeIssues({ listIssues });
  const resolved = await resolveRefsViaSdk(issues, ['TIER-2', 'PHASE-1', 'SHA-256'], 'co-flood');
  assert.equal(resolved.length, 0, 'all false positives unresolved');
  assert.equal(issues.getCalls.length, 0, 'zero issues.get for an all-false-positive batch');
});
