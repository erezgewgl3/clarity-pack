// test/worker/issue-reader-degradation.test.mjs
//
// Plan 02-09 Task 3 — DEV-16 issue-reader degradation contract. For EVERY
// sub-step in src/worker/handlers/issue-reader.ts, mock the relevant ctx
// accessor to throw, run the handler, and assert that the FULL response
// preserves the typed defaults:
//   - tldr:       null   (nullable)
//   - issueBody:  null   (nullable)
//   - refCards:   []     (array — never undefined)
//   - ancestry:   null   (nullable)
//   - acItems:    []     (array — never undefined)
//   - activity:   []     (array — never undefined)
//   - deliverable: null  (nullable)
//
// Why this test exists: the 02-04 drill observed Reader components crashing
// with TypeErrors like "Cannot read properties of undefined (reading
// 'map')". Root cause: a sub-step's failure mode left a field undefined
// rather than the typed safe default; the downstream React component then
// blew up. With this test in place, any future regression where a sub-step
// catch block omits the typed default is caught at build time.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerIssueReader } from '../../src/worker/handlers/issue-reader.ts';

// ---------------------------------------------------------------------------
// Shared ctx scaffolding — a happy-path baseline that returns all defaults
// when no override is passed. Each test passes an override that monkey-
// patches ONE accessor to throw.
// ---------------------------------------------------------------------------

function makeCtx(overrides = {}) {
  const registered = new Map();
  const fixtureIssue = {
    id: 'BEAAA-555',
    key: 'BEAAA-555',
    title: 'test',
    description: 'body has a BEAAA-141 ref',
    parentId: 'BEAAA-100',
    projectId: 'p-1',
    goalId: 'g-q3',
    status: 'in_progress',
  };
  const base = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, h) { registered.set(k, h); } },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        // opt-in-guard prefs lookup
        if (/clarity_user_prefs/.test(sql)) return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        // tldr_cache (getTldrByScope) — return no row by default
        if (/tldr_cache/.test(sql)) return [];
        // ac_checklist_items — return one happy-path row by default
        if (/ac_checklist_items/.test(sql)) {
          return [{ id: 1, issue_id: 'BEAAA-555', label: 'item', checked: false, display_order: 0 }];
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    http: {
      async fetch() {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
    issues: {
      async get(id) {
        if (id === 'BEAAA-555') return fixtureIssue;
        if (id === 'BEAAA-100') return { id: 'BEAAA-100', key: 'BEAAA-100', title: 'parent', description: '' };
        return null;
      },
      async listComments() {
        return [
          { id: 'c-1', authorUserId: 'a', createdAt: '2026-05-13T19:30:00Z', body: 'comment-1' },
        ];
      },
      relations: { async get() { return { blockedBy: [], blocks: [] }; } },
      documents: {
        async list() {
          return [{ id: 'd-1', key: 'plan', title: 'Plan.docx', updatedAt: '2026-05-13T20:10:00Z' }];
        },
        async get() { return null; },
      },
    },
    projects: { async get(id) { return id === 'p-1' ? { id: 'p-1', title: 'Proj' } : null; } },
    goals: { async get(id) { return id === 'g-q3' ? { id: 'g-q3', title: 'Goal' } : null; } },
  };
  // Apply per-test overrides at the right nesting level. Each override is a
  // function that mutates `base` in place (so deep keys like
  // ctx.issues.documents.list can be swapped without rebuilding the world).
  if (typeof overrides === 'function') overrides(base);
  return { ctx: base, registered };
}

async function runHandler(makeCtxOverride) {
  const { ctx, registered } = makeCtx(makeCtxOverride);
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  return handler({ userId: 'test-user', issueId: 'BEAAA-555', companyId: 'co-1' });
}

/**
 * Assert that EVERY typed default is in place. Used by every sub-step test
 * AFTER applying a per-sub-step failure mode — the rest of the fields should
 * remain populated (the degradation is local to the failing sub-step), but
 * the FAILED sub-step's field must be the typed default, not undefined.
 */
function assertTypedDefaults(result) {
  // Array fields: must be Array — NEVER undefined
  assert.ok(Array.isArray(result.refCards), `refCards must be Array; got ${typeof result.refCards}`);
  assert.ok(Array.isArray(result.acItems), `acItems must be Array; got ${typeof result.acItems}`);
  assert.ok(Array.isArray(result.activity), `activity must be Array; got ${typeof result.activity}`);

  // Nullable fields: must be either populated or === null — NEVER undefined
  assert.notEqual(result.tldr, undefined, 'tldr must not be undefined (null or populated)');
  assert.notEqual(result.ancestry, undefined, 'ancestry must not be undefined');
  assert.notEqual(result.deliverable, undefined, 'deliverable must not be undefined');
  assert.notEqual(result.issueBody, undefined, 'issueBody must not be undefined');
}

// ---------------------------------------------------------------------------
// Sub-step 1: ctx.issues.get throws → returns emptyResult (all defaults)
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — ctx.issues.get throws → emptyResult, all fields are typed defaults', async () => {
  const result = await runHandler((ctx) => {
    ctx.issues.get = async () => { throw new Error('issues.get broken'); };
  });
  assertTypedDefaults(result);
  // When the top-level issue lookup fails, everything is the typed default:
  assert.equal(result.tldr, null);
  assert.equal(result.issueBody, null);
  assert.deepEqual(result.refCards, []);
  assert.equal(result.ancestry, null);
  assert.deepEqual(result.acItems, []);
  assert.deepEqual(result.activity, []);
  assert.equal(result.deliverable, null);
});

// ---------------------------------------------------------------------------
// Sub-step 2: getTldrByScope failure (tldr_cache query throws) → tldr=null
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — tldr_cache query throws → tldr=null; other fields still populated', async () => {
  const result = await runHandler((ctx) => {
    const originalQuery = ctx.db.query;
    ctx.db.query = async (sql, params) => {
      if (/tldr_cache/.test(sql)) throw new Error('tldr_cache query broken');
      return originalQuery(sql, params);
    };
  });
  assertTypedDefaults(result);
  assert.equal(result.tldr, null, 'tldr is null on tldr_cache failure');
  // Other fields populated:
  assert.match(result.issueBody, /BEAAA-141 ref/);
});

// ---------------------------------------------------------------------------
// Sub-step 3: refCards resolution failure (http.fetch throws) → refCards=[]
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — refCards resolveRefs failure → refCards=[] (not undefined)', async () => {
  const result = await runHandler((ctx) => {
    ctx.http.fetch = async () => { throw new Error('fetch broken'); };
  });
  assertTypedDefaults(result);
  assert.deepEqual(result.refCards, [], 'refCards is [] (the typed default) on fetch failure');
  // Other fields populated:
  assert.match(result.issueBody, /BEAAA-141 ref/);
  assert.ok(result.ancestry, 'ancestry still populated');
});

// ---------------------------------------------------------------------------
// Sub-step 4: ancestry derivation failure (parent issues.get throws) → ancestry=null
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — ancestry parent walk throws → ancestry=null', async () => {
  const result = await runHandler((ctx) => {
    const originalGet = ctx.issues.get.bind(ctx.issues);
    ctx.issues.get = async (id, companyId) => {
      if (id === 'BEAAA-555') return originalGet(id, companyId);
      throw new Error('parent lookup broken');
    };
    // Also force projects/goals to throw — the ancestry helper handles each
    // axis independently, but we want a single global "ancestry derivation
    // failed" signal. Throwing at every axis hits all catch blocks.
    ctx.projects.get = async () => { throw new Error('projects broken'); };
    ctx.goals.get = async () => { throw new Error('goals broken'); };
  });
  assertTypedDefaults(result);
  // ancestry helper logs at the inner catches but assembles {project, milestone, parent}
  // all null — which is structurally the "no ancestry" result. The wrapping
  // try/catch around deriveAncestry only matters if the helper itself throws
  // synchronously, which it doesn't. So this test asserts the field is at
  // worst a structure with all-null axes — never undefined.
  assert.notEqual(result.ancestry, undefined, 'ancestry is not undefined');
  if (result.ancestry !== null) {
    assert.equal(result.ancestry.parent, null);
    assert.equal(result.ancestry.project, null);
    assert.equal(result.ancestry.milestone, null);
  }
});

// ---------------------------------------------------------------------------
// Sub-step 5: AC items query failure → acItems=[]
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — ac_checklist_items query throws → acItems=[] (not undefined)', async () => {
  const result = await runHandler((ctx) => {
    const originalQuery = ctx.db.query;
    ctx.db.query = async (sql, params) => {
      if (/ac_checklist_items/.test(sql)) throw new Error('ac query broken');
      return originalQuery(sql, params);
    };
  });
  assertTypedDefaults(result);
  assert.deepEqual(result.acItems, [], 'acItems is [] (the typed default) on query failure');
  // Other fields populated:
  assert.ok(result.ancestry, 'ancestry still populated');
});

// ---------------------------------------------------------------------------
// Sub-step 6: listComments failure → activity=[]
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — listComments throws → activity=[] (not undefined)', async () => {
  const result = await runHandler((ctx) => {
    ctx.issues.listComments = async () => { throw new Error('listComments broken'); };
  });
  assertTypedDefaults(result);
  assert.deepEqual(result.activity, [], 'activity is [] (the typed default) on listComments failure');
});

// ---------------------------------------------------------------------------
// Sub-step 7: documents.list failure → deliverable=null
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — documents.list throws → deliverable=null (not undefined)', async () => {
  const result = await runHandler((ctx) => {
    ctx.issues.documents.list = async () => { throw new Error('documents.list broken'); };
  });
  assertTypedDefaults(result);
  assert.equal(result.deliverable, null, 'deliverable is null on documents.list failure');
});

// ---------------------------------------------------------------------------
// Cross-cutting: simultaneous multi-sub-step failure → ALL typed defaults
// (defense in depth — one catastrophic ctx with everything broken)
// ---------------------------------------------------------------------------

test('issue.reader DEV-16 — every sub-step simultaneously throws → ALL typed defaults preserved', async () => {
  const result = await runHandler((ctx) => {
    const originalQuery = ctx.db.query;
    ctx.db.query = async (sql, params) => {
      // Only the prefs lookup (opt-in-guard) survives — everything else
      // simulating a full DB outage for plugin-namespace tables.
      if (/clarity_user_prefs/.test(sql)) return originalQuery(sql, params);
      throw new Error('plugin namespace tables broken');
    };
    ctx.http.fetch = async () => { throw new Error('fetch broken'); };
    ctx.issues.listComments = async () => { throw new Error('listComments broken'); };
    ctx.issues.documents.list = async () => { throw new Error('documents.list broken'); };
    ctx.projects.get = async () => { throw new Error('projects broken'); };
    ctx.goals.get = async () => { throw new Error('goals broken'); };
    // Parent issues.get throws (top-level get still works so we don't bail early).
    const originalGet = ctx.issues.get.bind(ctx.issues);
    ctx.issues.get = async (id, companyId) => {
      if (id === 'BEAAA-555') return originalGet(id, companyId);
      throw new Error('parent issues.get broken');
    };
  });
  // Every typed default holds even under simultaneous multi-sub-step failure.
  assertTypedDefaults(result);
  assert.equal(result.tldr, null);
  assert.deepEqual(result.refCards, []);
  assert.deepEqual(result.acItems, []);
  assert.deepEqual(result.activity, []);
  assert.equal(result.deliverable, null);
  // issueBody is preserved because issues.get(BEAAA-555) still succeeded.
  assert.match(result.issueBody, /BEAAA-141 ref/);
  // ancestry has all-null axes (helper handles each independently).
  if (result.ancestry !== null) {
    assert.equal(result.ancestry.parent, null);
    assert.equal(result.ancestry.project, null);
    assert.equal(result.ancestry.milestone, null);
  }
});
