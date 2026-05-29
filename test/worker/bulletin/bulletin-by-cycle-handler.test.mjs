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
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: 2475, format: 'currency' }],
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
  // Plan 07-05 — lineageThreads now carry ADDITIVE read-time enrichment fields
  // (identifier/ownerAgentId/gloss). The stub thread (empty nodes) is NOT
  // routine and unique → it survives the filter; with no agents/issue metadata
  // the enrichment + gloss degrade gracefully to null (NEVER an error).
  assert.equal(result.lineageThreads.length, 1);
  assert.equal(result.lineageThreads[0].id, 't1');
  assert.equal(result.lineageThreads[0].identifier, null);
  assert.equal(result.lineageThreads[0].ownerAgentId, null);
  assert.equal(result.lineageThreads[0].gloss, null);
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

// ---------------------------------------------------------------------------
// Plan 07-05 (Phase 7 ITEM 5) — lineage filter + gloss + enrichment
// ---------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Three lineage threads: a routine/scheduled output (must be FILTERED), a
// substantive agent-self thread (must SURVIVE + be enriched + glossed), and an
// exact-duplicate of the substantive thread (must be FILTERED). Instance-neutral.
function lineageDraft() {
  return {
    ...stubDraft(),
    lineageThreads: [
      { id: 't-routine', entityId: 'iss-routine', nodes: [{ time: '06:30', name: 'Daily Founder digest', detail: 'Daily Founder digest', isTerminal: true }], truncatedCount: 0 },
      { id: 't-sub', entityId: 'iss-sub', nodes: [{ time: '11:02', name: 'Pricing sheet draft', detail: 'Pricing sheet draft v2', isTerminal: true }], truncatedCount: 0 },
      { id: 't-sub-dup', entityId: 'iss-sub', nodes: [{ time: '11:02', name: 'Pricing sheet draft', detail: 'Pricing sheet draft v2', isTerminal: true }], truncatedCount: 0 },
    ],
  };
}

// A richer ctx that supports the gloss step (agents.get/managed.reconcile,
// issues op-discovery + create/poll) AND the enrichment (issues.get per entity).
function makeGlossCtx({ glossThrows = false, paused = false } = {}) {
  const handlers = new Map();
  const ctx = {
    logger: { warn() {}, info() {} },
    data: { register(key, fn) { handlers.set(key, fn); } },
    issues: {
      async get(id) {
        // The published bulletin issue body + per-thread enrichment both route here.
        if (id === 'iss-sub') return { id, identifier: 'COU-42', assigneeAgentId: 'agent-7' };
        if (id === 'iss-routine') return { id, identifier: 'COU-9', assigneeAgentId: 'agent-3' };
        return { id: 'pub-issue', description: 'Canonical markdown body' };
      },
      async list(args) {
        if (args && args.originId) return []; // idempotency search → no in-flight op
        if (args && args.originKindPrefix) return [{ assigneeAgentId: 'agent-editor' }];
        return []; // action-inbox issue list
      },
      async create() {
        if (glossThrows) throw new Error('gloss start failed');
        return { id: 'op-gloss-1' };
      },
      async requestWakeup() { return undefined; },
      async listComments() { return []; },
      async update() { return undefined; },
      documents: {
        async get() {
          // ready gloss map keyed by the surviving thread id
          return { body: '{"t-sub":"Pricing draft is ready for your review"}', key: 'compile-result' };
        },
        async list() { return []; },
      },
    },
    agents: {
      async pause() { return undefined; },
      async get() { return paused ? { status: 'paused', pausedAt: '2026-05-29T00:00:00Z' } : null; },
      async resume() { return undefined; },
      managed: { async reconcile() { return { agentId: 'agent-editor' }; } },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) return [{ opted_in_at: '2026-01-01T00:00:00.000Z' }];
        if (/FROM plugin_clarity_pack_cdd6bda4bd\.bulletins/i.test(sql)) {
          const row = { ...publishedRow(), draft_json: lineageDraft() };
          if (params && params.length >= 2 && typeof params[1] === 'number') {
            return params[1] === row.cycle_number ? [row] : [];
          }
          return [row];
        }
        if (/FROM plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) return []; // gloss cache MISS
        if (/bulletin_errata/i.test(sql)) return [];
        if (/clarity_department_membership/i.test(sql)) return [];
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    _handlers: handlers,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

test('bulletin.byCycle: lineageThreads are FILTERED (routine + exact-dup dropped)', async () => {
  const ctx = makeGlossCtx();
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({ cycle: 'latest', companyId: 'co-1', userId: 'user-eric' });
  assert.equal(result.kind, 'published');
  const ids = result.lineageThreads.map((t) => t.id);
  assert.ok(!ids.includes('t-routine'), 'routine thread must be filtered out');
  assert.ok(!ids.includes('t-sub-dup'), 'exact-duplicate thread must be filtered out');
  assert.deepEqual(ids, ['t-sub'], 'only the unique substantive thread survives');
});

test('bulletin.byCycle: surviving thread is ENRICHED with identifier + ownerAgentId + gloss', async () => {
  const ctx = makeGlossCtx();
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({ cycle: 'latest', companyId: 'co-1', userId: 'user-eric' });
  const t = result.lineageThreads.find((x) => x.id === 't-sub');
  assert.ok(t, 'surviving thread present');
  assert.equal(t.identifier, 'COU-42');
  assert.equal(t.ownerAgentId, 'agent-7');
  assert.equal(typeof t.gloss, 'string');
  assert.ok(t.gloss.length > 0);
});

test('bulletin.byCycle: NO raw UUID appears in any returned gloss string (NO_UUID_LEAK)', async () => {
  const ctx = makeGlossCtx();
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({ cycle: 'latest', companyId: 'co-1', userId: 'user-eric' });
  for (const t of result.lineageThreads) {
    if (t.gloss) assert.ok(!UUID_RE.test(t.gloss), `gloss must not contain a raw UUID: ${t.gloss}`);
  }
});

test('bulletin.byCycle: a thrown gloss step degrades to gloss:null and the read does NOT fail', async () => {
  const ctx = makeGlossCtx({ glossThrows: true });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({ cycle: 'latest', companyId: 'co-1', userId: 'user-eric' });
  assert.equal(result.kind, 'published');
  const t = result.lineageThreads.find((x) => x.id === 't-sub');
  assert.ok(t, 'surviving thread still returned');
  assert.equal(t.gloss, null, 'a gloss hiccup degrades to null, never an error');
  // enrichment still ran
  assert.equal(t.identifier, 'COU-42');
});

test('bulletin.byCycle: a paused Editor-Agent → threads still returned with gloss:null', async () => {
  const ctx = makeGlossCtx({ paused: true });
  registerBulletinByCycle(ctx);
  const result = await ctx._handlers.get('bulletin.byCycle')({ cycle: 'latest', companyId: 'co-1', userId: 'user-eric' });
  const t = result.lineageThreads.find((x) => x.id === 't-sub');
  assert.ok(t);
  assert.equal(t.gloss, null);
});
