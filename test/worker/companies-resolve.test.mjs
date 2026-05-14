// test/worker/companies-resolve.test.mjs
//
// Plan 02-03c Task 2 — RED-then-GREEN test for the companies.resolve-prefix
// worker handler. The handler exists to support useResolvedCompanyId() in the
// UI: when useHostContext().companyId is null (the 02-03b drill defect), the
// hook parses companyPrefix from the URL pathname and calls this handler to
// resolve the prefix to a UUID.
//
// Empirical evidence backing this design:
//   - 02-03c-HOST-CONTEXT.md Section 1: detail-tab slot's companyPrefix is
//     ALWAYS null (IssueDetail.tsx never passes it). URL parsing is the only
//     viable fallback.
//   - 02-03c-company-shape-output: Company has `id: string` (UUID) and
//     `issuePrefix: string` (the URL-segment prefix like "COU" or "BEAAA").
//   - SDK 2026.512.0 PluginCompaniesClient (types.d.ts:776-788): exposes
//     list() and get(id) — NO get-by-prefix method. Hence client-side filter.
//
// Capability: companies.read — already declared in src/manifest.ts:58.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerCompaniesResolve } from '../../src/worker/handlers/companies-resolve.ts';

function makeFakeCtx({ companies = [] } = {}) {
  const listCalls = [];
  const registered = new Map();
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: {
      register(key, handler) {
        registered.set(key, handler);
      },
    },
    companies: {
      async list(input) {
        listCalls.push(input ?? null);
        return companies;
      },
      async get() {
        throw new Error('ctx.companies.get unused by companies.resolve-prefix');
      },
    },
  };
  return { ctx, listCalls, registered };
}

const SAMPLE = [
  { id: '0d4fc40a-0541-4b67-8979-9d346cb9c07b', name: 'Countermoves', issuePrefix: 'COU' },
  { id: 'aaaa1111-bbbb-2222-cccc-333333333333', name: 'BEAAA Insurance', issuePrefix: 'BEAAA' },
  { id: 'bbbb2222-cccc-3333-dddd-444444444444', name: 'Acme Corp', issuePrefix: 'ACME' },
];

test('registerCompaniesResolve registers a companies.resolve-prefix handler', () => {
  const { ctx, registered } = makeFakeCtx();
  registerCompaniesResolve(ctx);
  assert.ok(registered.has('companies.resolve-prefix'), 'handler key registered');
});

test('handler returns {companyId, displayName} for a known prefix (Countermoves COU)', async () => {
  const { ctx, registered } = makeFakeCtx({ companies: SAMPLE });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  const result = await handler({ companyPrefix: 'COU' });
  assert.deepEqual(result, {
    companyId: '0d4fc40a-0541-4b67-8979-9d346cb9c07b',
    displayName: 'Countermoves',
  });
});

test('handler matches issuePrefix exactly (case-sensitive — URLs are case-sensitive)', async () => {
  const { ctx, registered } = makeFakeCtx({ companies: SAMPLE });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  // Lowercase "cou" should NOT match uppercase "COU" — Paperclip URLs are
  // canonicalized to a fixed case by the host. Mismatched casing is a real
  // bug, not a UX papercut to silently work around.
  await assert.rejects(
    () => handler({ companyPrefix: 'cou' }),
    /no company found/i,
    'lowercase prefix must NOT silently match uppercase issuePrefix',
  );
});

test('handler throws when prefix is not found in companies.list()', async () => {
  const { ctx, registered } = makeFakeCtx({ companies: SAMPLE });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  await assert.rejects(
    () => handler({ companyPrefix: 'NOPE' }),
    /no company found.*NOPE/i,
  );
});

test('handler returns null (no-op, NOT a throw) when companyPrefix is missing or empty', async () => {
  // The hook calls this handler unconditionally per React rules-of-hooks;
  // when host companyId is populated the hook passes empty params and
  // ignores the result. Throwing here surfaces as 502 in the browser console
  // even though the hook short-circuits. Return null silently instead.
  const { ctx, listCalls, registered } = makeFakeCtx({ companies: SAMPLE });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  assert.equal(await handler({}), null, 'missing prefix → null');
  assert.equal(await handler({ companyPrefix: '' }), null, 'empty prefix → null');
  assert.equal(await handler({ companyPrefix: '   ' }), null, 'whitespace-only prefix → null');
  assert.equal(await handler({ companyPrefix: null }), null, 'null prefix → null');
  // Importantly: companies.list was NOT called for any of these (no wasted
  // host round-trip when there's nothing to resolve).
  assert.equal(listCalls.length, 0, 'companies.list not called for no-op invocations');
});

test('handler throws when companies.list returns empty (host visibility issue)', async () => {
  const { ctx, registered } = makeFakeCtx({ companies: [] });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  await assert.rejects(
    () => handler({ companyPrefix: 'COU' }),
    /no company found/i,
    'empty list is a no-match (we do NOT swallow it)',
  );
});

test('handler calls companies.list at most once per invocation (no needless re-list per prefix)', async () => {
  const { ctx, listCalls, registered } = makeFakeCtx({ companies: SAMPLE });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  await handler({ companyPrefix: 'COU' });
  assert.equal(listCalls.length, 1, 'one list call per resolve');
});

test('handler trims whitespace around the prefix (URL parser may yield " COU ")', async () => {
  const { ctx, registered } = makeFakeCtx({ companies: SAMPLE });
  registerCompaniesResolve(ctx);
  const handler = registered.get('companies.resolve-prefix');
  const result = await handler({ companyPrefix: '  COU  ' });
  assert.equal(result.companyId, '0d4fc40a-0541-4b67-8979-9d346cb9c07b');
});
