// test/worker/issue-reader.test.mjs
//
// Plan 02-03b Task 2 — rewritten against the real SDK 2026.512.0 surface.
// The Plan 02-03 version of this test mocked a ctx shape that did NOT match
// the actual @paperclipai/plugin-sdk PluginContext: it asserted on
// ctx.host.currentCompanyId, ctx.issue.documents.read (singular + .read), and
// {rows: T[]} return shapes — none of which exist on the SDK. The handler
// passed those mocks locally but every call against real Paperclip on
// Countermoves returned empty data, which is what the 2026-05-13 drill caught.
//
// This file now mocks the ACTUAL SDK shapes. See
// .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md for the
// full diagnosis. The integration-suite at
// test/worker/issue-reader-integration.test.mjs adds further shape contracts.
//
// Tests pinned by this file:
//   - assembles {tldr, refCards, ancestry, acItems, activity, deliverable, issueBody}
//   - calls resolveRefs ONCE per render (PRIM-01 single round-trip)
//   - activity timeline derived from ctx.issues.listComments (READER-09 vacuous —
//     state_change/work_product_write events not exposed at SDK 2026.512.0)
//   - SQL targets the baked plugin namespace (Finding #4)

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { registerIssueReader } from '../../src/worker/handlers/issue-reader.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(path.resolve(HERE, '..', 'fixtures', 'sample-issue.json'), 'utf8'),
);

function makeFakeCtx() {
  const fetchCalls = [];
  const dbCalls = [];
  const registered = new Map();

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, h) { registered.set(k, h); } },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        return { rowCount: 0 };
      },
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        // SDK shape: query<T>(...) returns T[] DIRECTLY, NOT {rows: T[]}.
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          return [
            {
              surface: 'issue',
              scope_id: FIXTURE.issueId,
              content_hash: FIXTURE.tldr.content_hash,
              body: FIXTURE.tldr.body,
              generated_at: FIXTURE.tldr.generated_at,
              source_revisions: FIXTURE.tldr.source_revisions,
              compiled_by_agent_id: FIXTURE.tldr.compiled_by_agent_id,
              tags: FIXTURE.tldr.tags,
            },
          ];
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.ac_checklist_items/i.test(sql)) {
          return FIXTURE.acItems;
        }
        return [];
      },
    },
    http: {
      async fetch(url) {
        fetchCalls.push(url);
        if (/\/api\/companies\/.*\/issues\?ids=/.test(url)) {
          return new Response(
            JSON.stringify(
              FIXTURE.refCards.map((r) => ({
                key: r.id,
                title: r.title,
                status: r.status,
                assignee_user_id: r.ownerUserId,
                body: r.excerpt,
                _viewer_can_read: true,
              })),
            ),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
    issues: {
      // SDK signature: get(issueId, companyId) — handler must pass both.
      async get(issueId, _companyId) {
        if (issueId === FIXTURE.issueId) {
          return {
            id: FIXTURE.issueId,
            key: FIXTURE.issueId,
            title: 'test issue',
            description: FIXTURE.body, // SDK Issue field name is `description`
            parentId: 'BEAAA-100',
            projectId: 'p-1',
            goalId: 'g-q3',
            status: 'in_progress',
            priority: 'normal',
          };
        }
        if (issueId === 'BEAAA-100') {
          return { id: 'BEAAA-100', key: 'BEAAA-100', title: 'Q3 underwriting prep', description: '' };
        }
        return null;
      },
      async listComments(_issueId, _companyId) {
        // Stand-in for activity timeline: ctx.activity.log.read doesn't exist
        // at SDK 2026.512.0; the handler derives activity from comments.
        return [
          {
            id: 'c-1',
            authorUserId: 'carrier-ops',
            createdAt: '2026-05-13T19:30:00Z',
            body: 'SOC-2 step added',
          },
          {
            id: 'c-2',
            authorUserId: 'finance-team',
            createdAt: '2026-05-13T20:30:00Z',
            body: 'Holding supplier payment',
          },
        ];
      },
      relations: {
        async get() { return { blockedBy: [], blocks: [] }; },
      },
      documents: {
        async list(_issueId, _companyId) {
          return [
            {
              id: 'd-1',
              key: 'q3-underwriting-plan',
              title: 'Q3-underwriting-plan.xlsx',
              format: 'xlsx',
              updatedAt: '2026-05-13T20:10:00Z',
              createdAt: '2026-05-12T10:00:00Z',
            },
          ];
        },
        async get() { return null; },
      },
    },
    projects: {
      async get(projectId) {
        if (projectId === 'p-1') return { id: 'p-1', title: 'BEAAA Insurance' };
        return null;
      },
    },
    goals: {
      async get(goalId) {
        if (goalId === 'g-q3') return { id: 'g-q3', title: 'Q3 Launch' };
        return null;
      },
    },
  };

  return { ctx, fetchCalls, dbCalls, registered };
}

test('issue.reader handler assembles tldr + refCards + ancestry + acItems + activity + deliverable + issueBody', async () => {
  const { ctx, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  assert.ok(handler, 'issue.reader handler is registered');
  const result = await handler({ issueId: FIXTURE.issueId, companyId: 'co-1' });
  assert.ok(result.tldr, 'tldr returned from cache');
  assert.equal(result.tldr.body.length > 0, true);
  assert.equal(result.refCards.length, 3);
  assert.equal(result.refCards[0].id, 'BEAAA-141');
  assert.ok(result.ancestry, 'ancestry returned');
  assert.ok(result.ancestry.project, 'ancestry.project present');
  assert.equal(result.ancestry.project.title, 'BEAAA Insurance');
  assert.equal(result.ancestry.parent.id, 'BEAAA-100');
  assert.equal(result.ancestry.milestone.title, 'Q3 Launch');
  assert.equal(result.acItems.length, 3);
  assert.equal(result.issueBody, FIXTURE.body);
  assert.ok(result.deliverable, 'deliverable returned');
  assert.equal(result.deliverable.filename, 'Q3-underwriting-plan.xlsx');
});

test('issue.reader invokes the resolveRefs fetcher EXACTLY ONCE per render (PRIM-01 single round-trip)', async () => {
  const { ctx, fetchCalls, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  await handler({ issueId: FIXTURE.issueId, companyId: 'co-1' });
  const issueFetches = fetchCalls.filter((url) => /\/issues\?ids=/.test(url));
  assert.equal(issueFetches.length, 1, `expected 1 issues fetch for ref resolution; got ${issueFetches.length}`);
});

test('issue.reader activity timeline is derived from listComments and capped at 8 (READER-09)', async () => {
  const { ctx, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  const result = await handler({ issueId: FIXTURE.issueId, companyId: 'co-1' });
  assert.ok(Array.isArray(result.activity));
  assert.ok(result.activity.length <= 8, `activity must be <= 8; got ${result.activity.length}`);
  for (const e of result.activity) {
    assert.equal(e.kind, 'comment', `at SDK 2026.512.0 the only timeline kind is 'comment'; got ${e.kind}`);
  }
});

test('issue.reader ac_checklist query targets the baked namespace (Finding #4)', async () => {
  const { ctx, dbCalls, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  await handler({ issueId: FIXTURE.issueId, companyId: 'co-1' });
  const acQuery = dbCalls.find((c) => /ac_checklist_items/.test(c.sql));
  assert.ok(acQuery, 'AC checklist SQL was issued');
  assert.match(acQuery.sql, /plugin_clarity_pack_cdd6bda4bd\.ac_checklist_items/);
});

test('issue.reader returns an empty refCards array when issue description has no BEAAA refs', async () => {
  const { ctx, registered } = makeFakeCtx();
  ctx.issues.get = async (id) => ({ id, key: id, title: 't', description: 'no refs in here', parentId: null, projectId: null, goalId: null });
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  const result = await handler({ issueId: 'BEAAA-NORF', companyId: 'co-1' });
  assert.deepEqual(result.refCards, []);
});

test('issue.reader throws when companyId is missing (loud failure — UI bug surface)', async () => {
  const { ctx, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  await assert.rejects(
    () => handler({ issueId: FIXTURE.issueId }),
    /companyId required/,
  );
});
