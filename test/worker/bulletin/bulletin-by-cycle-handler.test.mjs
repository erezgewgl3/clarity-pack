// test/worker/bulletin/bulletin-by-cycle-handler.test.mjs
//
// Plan 03-03 Task 1 RED — BULL-03 bulletin.byCycle data handler.
//
// The handler reads a bulletins row, parses bulletins.draft_json into a typed
// BulletinDraft (W3/W4 — NO markdown re-parser), composite-fetches the issue
// body via ctx.issues.get for completeness, and returns a discriminated
// {kind:'published'|...} payload. masthead/departments/standingNumbers/
// lineageThreads come straight from draft_json. Action Inbox is computed live
// (viewer-scoped). The handler is wrapped via opt-in-guard.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerBulletinByCycle } from '../../../src/worker/handlers/bulletin-by-cycle.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function stubDraft() {
  return {
    masthead: { volume: 'I', number: 7, weekday: 'Friday', dateText: '2026-05-15', prepareForName: 'Eric G.', cycleNumber: 7 },
    actionInbox: [],
    departments: [{ name: 'Production', items: [], editorialSummary: 'Quiet.' }],
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' }],
    lineageThreads: [{ id: 't1', entityId: 'i1', nodes: [], truncatedCount: 0 }],
  };
}

// makeCtx: registers handlers into a map; supports a configurable bulletins
// row, an opt-in prefs row, an issue body, and an action-inbox issue list.
function makeCtx({
  bulletinRow = null,
  optedIn = true,
  issueBody = 'Canonical markdown body',
  inboxIssues = [],
} = {}) {
  const handlers = new Map();
  const ctx = {
    logger: { warn() {}, info() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async get() {
        return issueBody === null ? null : { id: 'pub-issue', description: issueBody };
      },
      async list() {
        return inboxIssues;
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/FROM plugin_clarity_pack_cdd6bda4bd\.bulletins/i.test(sql)) {
          if (bulletinRow === null) return [];
          // exact-cycle lookup carries cycle_number param
          if (params && params.length >= 2 && typeof params[1] === 'number') {
            return params[1] === bulletinRow.cycle_number ? [bulletinRow] : [];
          }
          return [bulletinRow];
        }
        if (/bulletin_errata/i.test(sql)) return [];
        if (/clarity_department_membership/i.test(sql)) return [];
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function publishedRow(over = {}) {
  return {
    cycle_number: 7,
    company_id: 'co-1',
    next_due_at: '2026-05-16T10:30:00.000Z',
    compiled_at: '2026-05-15T10:30:00.000Z',
    verified_at: '2026-05-15T10:30:05.000Z',
    published_at: '2026-05-15T10:30:10.000Z',
    published_issue_id: 'pub-issue',
    compile_status: 'published',
    content_hash: 'hash-1',
    lineage_thread_json: [],
    draft_json: stubDraft(),
    ...over,
  };
}

test('bulletin.byCycle: registers under the bulletin.byCycle key', () => {
  const ctx = makeCtx();
  registerBulletinByCycle(ctx);
  assert.ok(ctx._handlers.has('bulletin.byCycle'));
});

test('bulletin.byCycle: cycle=latest + published row → kind=published with draft_json fields', async () => {
  const ctx = makeCtx({ bulletinRow: publishedRow() });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({
    cycle: 'latest',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(result.kind, 'published');
  assert.equal(result.body, 'Canonical markdown body');
  assert.deepEqual(result.masthead, stubDraft().masthead);
  assert.deepEqual(result.departments, stubDraft().departments);
  assert.deepEqual(result.standingNumbers, stubDraft().standingNumbers);
  assert.deepEqual(result.lineageThreads, stubDraft().lineageThreads);
  assert.ok(Array.isArray(result.actionInbox));
  assert.ok(Array.isArray(result.errata));
});

test('bulletin.byCycle: no published bulletin → kind=not-yet-published', async () => {
  const ctx = makeCtx({ bulletinRow: null });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({
    cycle: 'latest',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(result.kind, 'not-yet-published');
});

test('bulletin.byCycle: cycle=5 that exists → returns that cycle', async () => {
  const ctx = makeCtx({ bulletinRow: publishedRow({ cycle_number: 5 }) });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({
    cycle: 5,
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(result.kind, 'published');
  assert.equal(result.cycleNumber, 5);
});

test('bulletin.byCycle: cycle=5 that does not exist → not-yet-published', async () => {
  const ctx = makeCtx({ bulletinRow: publishedRow({ cycle_number: 7 }) });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({
    cycle: 5,
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(result.kind, 'not-yet-published');
});

test('bulletin.byCycle: missing userId → error USER_ID_REQUIRED', async () => {
  const ctx = makeCtx({ bulletinRow: publishedRow() });
  registerBulletinByCycle(ctx);
  // opt-in-guard treats missing userId as opted-out → OPT_IN_REQUIRED before
  // the inner handler runs. Either structured error is acceptable; both signal
  // "no viewer identity". Lock that one of the two fires.
  const result = await ctx._handlers.get('bulletin.byCycle')({
    cycle: 'latest',
    companyId: 'co-1',
  });
  assert.ok(
    result.error === 'USER_ID_REQUIRED' || result.error === 'OPT_IN_REQUIRED',
    `expected USER_ID_REQUIRED or OPT_IN_REQUIRED, got ${JSON.stringify(result)}`,
  );
});

test('bulletin.byCycle: opted-out user → error OPT_IN_REQUIRED (wrap active)', async () => {
  const ctx = makeCtx({ bulletinRow: publishedRow(), optedIn: false });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({
    cycle: 'latest',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});
