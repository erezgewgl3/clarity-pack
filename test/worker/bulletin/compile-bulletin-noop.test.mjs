// test/worker/bulletin/compile-bulletin-noop.test.mjs
//
// Plan 03-01 Task 1 RED — BULL-02 idempotency foundation. The compile-bulletin
// job is registered as a Wave-1 SKELETON: it fires every minute, reads
// next_due_at per company, and short-circuits to a no-op when
// `now < next_due_at`. The actual two-pass compile pipeline lands in Plan
// 03-02. These tests lock the gating + bootstrap behavior:
//   - registration happens exactly once under the 'compile-bulletin' key
//   - now < next_due_at  -> no INSERT, no ctx.issues.create
//   - next_due_at null   -> bootstrap a 'pending' row at sentinel cycle 0,
//     do NOT compile (cycle 0 must not collide with the first real cycle 1 —
//     see the Plan 03-03 drill PK-collision fix)
//   - empty company list -> clean no-op
//   - per-company try/catch isolates a thrown company (matches
//     situation-snapshot.ts:127 warn-not-throw style)

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerCompileBulletinJob } from '../../../src/worker/jobs/compile-bulletin.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';
// Phase 16.1 Plan 16.1-04 — reset the module-level opted-in set between tests so
// the per-test seed is re-read (not served stale by the 60s TTL).
import { invalidateOptedInCache } from '../../../src/worker/opted-in-company-set.ts';

test.beforeEach(() => invalidateOptedInCache());

// Build a fake job ctx. `nextDueByCompany` maps companyId -> ISO string (or
// null). `query` returns next_due_at rows for getNextDueAtForCompany;
// `execute` captures all writes.
function makeCtx({ companies = [], nextDueByCompany = {}, throwForCompany = null } = {}) {
  const dbCalls = [];
  const jobs = new Map();
  const issuesCreated = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        // Phase 16.1 Plan 16.1-04 — opt-in scope-gate seed: every test company is
        // opted-in so the cron exercises its compile/bootstrap/gate logic (the
        // scope gate itself is proven in the dedicated suites).
        if (/clarity_user_prefs/i.test(sql)) {
          return [{ user_id: 'opted-in-user' }];
        }
        if (/clarity_agent_owners/i.test(sql)) {
          return companies.map((c) => ({ company_id: c.id }));
        }
        if (/next_due_at/i.test(sql) && /SELECT/i.test(sql)) {
          const companyId = params?.[0];
          if (throwForCompany && companyId === throwForCompany) {
            throw new Error('simulated per-company query failure');
          }
          const iso = nextDueByCompany[companyId];
          return iso ? [{ next_due_at: iso }] : [];
        }
        return [];
      },
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        return { rowCount: 1 };
      },
    },
    jobs: {
      register(key, fn) {
        jobs.set(key, fn);
      },
    },
    companies: {
      async list() {
        return companies;
      },
      async get(id) {
        return companies.find((c) => c.id === id) ?? null;
      },
    },
    agents: { async list() { return []; } },
    issues: {
      async create(args) {
        issuesCreated.push(args);
        return { id: 'issue-x', ...args };
      },
      async list() { return []; },
      async get() { return null; },
      async createComment() { return { id: 'comment-x' }; },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, dbCalls, jobs, issuesCreated };
}

const JOB_EVENT = {
  jobKey: 'compile-bulletin',
  runId: 'r1',
  trigger: 'cron',
  scheduledAt: new Date().toISOString(),
};

test('compile-bulletin: registers exactly once under the "compile-bulletin" key', () => {
  const { ctx, jobs } = makeCtx();
  registerCompileBulletinJob(ctx);
  assert.equal(jobs.size, 1);
  assert.equal(typeof jobs.get('compile-bulletin'), 'function');
});

test('compile-bulletin: no-op when now < next_due_at (no INSERT, no issues.create)', async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { ctx, dbCalls, jobs, issuesCreated } = makeCtx({
    companies: [{ id: 'COU' }],
    nextDueByCompany: { COU: future },
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  const inserts = dbCalls.filter((c) => /INSERT INTO/i.test(c.sql ?? ''));
  assert.equal(inserts.length, 0, 'must not INSERT when not yet due');
  assert.equal(issuesCreated.length, 0, 'must not create an issue when not yet due');
});

test('compile-bulletin: bootstraps a pending row when next_due_at is null (first ever compile)', async () => {
  const { ctx, dbCalls, jobs, issuesCreated } = makeCtx({
    companies: [{ id: 'COU' }],
    nextDueByCompany: { COU: null },
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  const inserts = dbCalls.filter((c) => /INSERT INTO/i.test(c.sql ?? ''));
  assert.equal(inserts.length, 1, 'must write exactly one bootstrap row');
  assert.match(inserts[0].sql, /bulletins/i, 'bootstrap row targets the bulletins table');
  assert.equal(
    inserts[0].params?.[0],
    0,
    'bootstrap row must use sentinel cycle_number 0 — the first real compile ' +
      'publishes cycle 1, so a bootstrap row at cycle 1 would collide on the ' +
      'bulletins primary key and the first bulletin could never publish',
  );
  assert.equal(issuesCreated.length, 0, 'bootstrap must NOT compile/publish');
});

test('compile-bulletin: empty company list -> clean no-op (no DB writes)', async () => {
  const { ctx, dbCalls, jobs } = makeCtx({ companies: [] });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  const writes = dbCalls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 0, 'no companies -> no writes');
});

test('compile-bulletin: per-company failure is isolated (one throwing company does not abort the loop)', async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { ctx, jobs } = makeCtx({
    companies: [{ id: 'BAD' }, { id: 'GOOD' }],
    nextDueByCompany: { BAD: future, GOOD: future },
    throwForCompany: 'BAD',
  });
  registerCompileBulletinJob(ctx);
  // Must resolve without throwing — the per-company try/catch swallows BAD.
  await assert.doesNotReject(jobs.get('compile-bulletin')(JOB_EVENT));
});
