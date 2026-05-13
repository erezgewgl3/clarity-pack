// test/worker/issue-reader.test.mjs
//
// Plan 02-03 Task 2 — issue.reader data handler:
//   - assembles {tldr, refCards, ancestry, acItems, activity, deliverable, issueBody}
//   - calls resolveRefs ONCE per render (PRIM-01 single round-trip)
//   - activity distilled to <= 8 items (READER-09)
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
    logger: { info() {}, warn() {}, error() {} },
    host: { currentCompanyId: 'co-1' },
    data: { register(k, h) { registered.set(k, h); } },
    db: {
      async execute(sql, params) { dbCalls.push({ kind: 'execute', sql, params }); },
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          return { rows: [FIXTURE.tldr] };
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.ac_checklist_items/i.test(sql)) {
          return { rows: FIXTURE.acItems };
        }
        return { rows: [] };
      },
    },
    http: {
      async fetch(url) {
        fetchCalls.push(url);
        // Match the 02-02 resolve-refs endpoint shape; return refCards as raw issues.
        if (/\/api\/companies\/.*\/issues\?ids=/.test(url)) {
          return {
            async json() {
              return FIXTURE.refCards.map((r) => ({
                key: r.id,
                title: r.title,
                status: r.status,
                assignee_user_id: r.ownerUserId,
                body: r.excerpt,
                _viewer_can_read: true,
              }));
            },
          };
        }
        return { async json() { return {}; } };
      },
    },
    issues: {
      async get(issueId) {
        return { id: issueId, body: FIXTURE.body };
      },
      async ancestry() { return FIXTURE.ancestry; },
    },
    issue: {
      documents: {
        async read() { return FIXTURE.deliverable; },
      },
    },
    activity: {
      log: {
        async read() { return FIXTURE.activityRaw; },
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
  const result = await handler({ issueId: 'BEAAA-555', viewerUserId: 'eric' });
  assert.ok(result.tldr, 'tldr returned from cache');
  assert.equal(result.tldr.body.length > 0, true);
  assert.equal(result.refCards.length, 3);
  assert.equal(result.refCards[0].id, 'BEAAA-141');
  assert.ok(result.ancestry.project, 'ancestry.project present');
  assert.equal(result.acItems.length, 3);
  assert.equal(result.issueBody, FIXTURE.body);
  assert.ok(result.deliverable, 'deliverable returned');
});

test('issue.reader invokes the resolveRefs fetcher EXACTLY ONCE per render (PRIM-01 single round-trip)', async () => {
  const { ctx, fetchCalls, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  await handler({ issueId: 'BEAAA-555', viewerUserId: 'eric' });
  // Count only the issues-by-ids fetch (resolveRefs path)
  const issueFetches = fetchCalls.filter((url) => /\/issues\?ids=/.test(url));
  assert.equal(issueFetches.length, 1, `expected 1 issues fetch for ref resolution; got ${issueFetches.length}`);
});

test('issue.reader activity timeline is distilled to <= 8 items (READER-09)', async () => {
  const { ctx, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  const result = await handler({ issueId: 'BEAAA-555', viewerUserId: 'eric' });
  assert.ok(Array.isArray(result.activity));
  assert.ok(result.activity.length <= 8, `activity must be <= 8; got ${result.activity.length}`);
  // Distillation filters out label_change/title_edit — keep only state_change, comment, work_product_write.
  for (const e of result.activity) {
    assert.ok(
      ['state_change', 'comment', 'work_product_write'].includes(e.kind),
      `distilled activity must not include ${e.kind}`,
    );
  }
});

test('issue.reader ac_checklist query targets the baked namespace (Finding #4)', async () => {
  const { ctx, dbCalls, registered } = makeFakeCtx();
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  await handler({ issueId: 'BEAAA-555', viewerUserId: 'eric' });
  const acQuery = dbCalls.find((c) => /ac_checklist_items/.test(c.sql));
  assert.ok(acQuery, 'AC checklist SQL was issued');
  assert.match(acQuery.sql, /plugin_clarity_pack_cdd6bda4bd\.ac_checklist_items/);
});

test('issue.reader returns an empty refCards array when issue body has no BEAAA refs', async () => {
  const { ctx, registered } = makeFakeCtx();
  ctx.issues.get = async (id) => ({ id, body: 'no refs in here' });
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  const result = await handler({ issueId: 'BEAAA-NORF', viewerUserId: 'eric' });
  assert.deepEqual(result.refCards, []);
});
