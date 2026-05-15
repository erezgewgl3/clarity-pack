// test/worker/bulletin/department-reconcile.test.mjs
//
// Plan 03-03 Task 1 RED — BULL-04 department reconcile (D-20).
//
// deriveDepartmentForAgent is a pure role-regex heuristic with a Builder
// fallback. reconcileDepartments is an idempotent UPSERT pass: it calls
// ctx.agents.list once and UPSERTs each agent with source='reconcile'.
// upsertDepartmentMembership uses ON CONFLICT DO NOTHING so a manual-source
// override row always survives a re-reconcile.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  reconcileDepartments,
  deriveDepartmentForAgent,
} from '../../../src/worker/bulletin/department-reconcile.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

test('deriveDepartmentForAgent: Sales role → Sales', () => {
  assert.equal(deriveDepartmentForAgent({ role: 'Sales Cold Email' }), 'Sales');
});

test('deriveDepartmentForAgent: Customer Onboarding → Customer', () => {
  assert.equal(deriveDepartmentForAgent({ role: 'Customer Onboarding' }), 'Customer');
});

test('deriveDepartmentForAgent: Senior Builder Eng → Builder', () => {
  assert.equal(deriveDepartmentForAgent({ role: 'Senior Builder Eng' }), 'Builder');
});

test('deriveDepartmentForAgent: Writer Cyber → Production (writer/producer/scout/qa)', () => {
  assert.equal(deriveDepartmentForAgent({ role: 'Writer Cyber' }), 'Production');
});

test('deriveDepartmentForAgent: Refund Agent → Customer', () => {
  assert.equal(deriveDepartmentForAgent({ role: 'Refund Agent' }), 'Customer');
});

test('deriveDepartmentForAgent: empty/missing role → Builder fallback', () => {
  assert.equal(deriveDepartmentForAgent({}), 'Builder');
  assert.equal(deriveDepartmentForAgent({ role: '' }), 'Builder');
  assert.equal(deriveDepartmentForAgent({ role: 'Mystery Worker' }), 'Builder');
});

// makeCtx: `agents` is the ctx.agents.list result; `existing` seeds the
// in-memory clarity_department_membership table keyed company:user.
function makeCtx({ agents = [], existing = {}, listThrows = false } = {}) {
  const table = new Map(Object.entries(existing)); // key `${company}:${user}` -> row
  const upserts = [];
  let listCalls = 0;
  const ctx = {
    logger: { warn() {} },
    agents: {
      async list() {
        listCalls += 1;
        if (listThrows) throw new Error('agents.list down');
        return agents;
      },
    },
    db: {
      async execute(sql, params) {
        // upsertDepartmentMembership SQL: ON CONFLICT (company_id, employee_user_id) DO NOTHING
        if (/clarity_department_membership/i.test(sql) && /INSERT/i.test(sql)) {
          const [company, user, department, source] = params;
          const key = `${company}:${user}`;
          upserts.push({ company, user, department, source });
          if (!table.has(key)) {
            table.set(key, { company, user, department, source });
          }
          // ON CONFLICT DO NOTHING — existing rows untouched.
          return { rowCount: table.has(key) ? 0 : 1 };
        }
        return { rowCount: 0 };
      },
      async query() {
        return [];
      },
    },
    _table: table,
    _upserts: upserts,
    get _listCalls() {
      return listCalls;
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

test('reconcileDepartments: calls agents.list once and UPSERTs each agent with source=reconcile', async () => {
  const ctx = makeCtx({
    agents: [
      { userId: 'u-sales', role: 'Sales SDR' },
      { userId: 'u-builder', role: 'Builder Engineer' },
    ],
  });
  await reconcileDepartments(ctx, 'company-1');
  assert.equal(ctx._listCalls, 1);
  assert.equal(ctx._upserts.length, 2);
  for (const up of ctx._upserts) {
    assert.equal(up.source, 'reconcile');
    assert.equal(up.company, 'company-1');
  }
  assert.equal(ctx._table.get('company-1:u-sales').department, 'Sales');
  assert.equal(ctx._table.get('company-1:u-builder').department, 'Builder');
});

test('reconcileDepartments: idempotent — a manual-source row survives a re-reconcile', async () => {
  const ctx = makeCtx({
    agents: [{ userId: 'u-x', role: 'Sales SDR' }],
    existing: {
      'company-1:u-x': { company: 'company-1', user: 'u-x', department: 'Customer', source: 'manual' },
    },
  });
  await reconcileDepartments(ctx, 'company-1');
  // Run a second time — still idempotent.
  await reconcileDepartments(ctx, 'company-1');
  const row = ctx._table.get('company-1:u-x');
  // The manual override is NOT clobbered by the reconcile UPSERT.
  assert.equal(row.department, 'Customer');
  assert.equal(row.source, 'manual');
});
