// test/worker/bulletin/publish.test.mjs
//
// Plan 03-02 Task 1 RED — two-phase publish of a verified BulletinDraft (BULL-09).
// Order: INSERT bulletins (attempting) -> ctx.issues.create -> UPDATE published.
// Idempotency UNIQUE(next_due_at, content_hash) blocks duplicate publishes.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { publishBulletin } from '../../../src/worker/bulletin/publish.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function wellFormedDraft() {
  return {
    masthead: { volume: 'I', number: 47, weekday: 'Thursday', dateText: '2026-05-07', prepareForName: 'Eric G.', cycleNumber: 47 },
    actionInbox: [],
    departments: [],
    standingNumbers: [],
    lineageThreads: [],
  };
}

// makeCtx options:
//   issuesCreateThrows  - ctx.issues.create rejects
//   issuesCreateNull    - ctx.issues.create resolves null
//   duplicate           - the post-INSERT SELECT reports an already-published row
function makeCtx({ issuesCreateThrows = false, issuesCreateNull = false, duplicate = false } = {}) {
  const callOrder = [];
  const issuesArgs = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    db: {
      async execute(sql) {
        if (/INSERT INTO/i.test(sql)) callOrder.push('insert');
        else if (/UPDATE/i.test(sql)) callOrder.push('update');
        return { rowCount: 1 };
      },
      async query(sql) {
        if (/SELECT compile_status/i.test(sql)) {
          return [{ compile_status: duplicate ? 'published' : 'attempting' }];
        }
        return [];
      },
    },
    issues: {
      async create(args) {
        callOrder.push('issues.create');
        issuesArgs.push(args);
        if (issuesCreateThrows) throw new Error('issues.create down');
        if (issuesCreateNull) return null;
        return { id: 'issue-99', identifier: 'COU-99', ...args };
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, callOrder, issuesArgs };
}

const BASE_ARGS = {
  companyId: 'company-1',
  cycleNumber: 47,
  nextDueAtIso: '2026-05-08T10:30:00.000Z',
  editorAgentId: 'agent-uuid-1',
  draft: wellFormedDraft(),
  compiledAt: new Date('2026-05-07T10:30:00.000Z'),
};

test('publish: ctx.issues.create receives companyId, exact title, body, 3 tags, authorAgentId', async () => {
  const { ctx, issuesArgs } = makeCtx();
  await publishBulletin(ctx, BASE_ARGS);
  assert.equal(issuesArgs.length, 1);
  const a = issuesArgs[0];
  assert.equal(a.companyId, 'company-1');
  assert.equal(a.title, 'Bulletin No. 47 — Thursday, 2026-05-07');
  assert.equal(typeof a.description, 'string');
  assert.deepEqual(a.tags, ['clarity:bulletin', 'clarity:bulletin-issue', 'cycle:47']);
  assert.equal(a.authorAgentId, 'agent-uuid-1');
});

test('publish: write order is INSERT bulletins -> issues.create -> UPDATE bulletins', async () => {
  const { ctx, callOrder } = makeCtx();
  await publishBulletin(ctx, BASE_ARGS);
  assert.deepEqual(callOrder, ['insert', 'issues.create', 'update']);
});

test('publish: idempotency — already-published row returns {kind:duplicate} without a 2nd issues.create', async () => {
  const { ctx, issuesArgs } = makeCtx({ duplicate: true });
  const result = await publishBulletin(ctx, BASE_ARGS);
  assert.equal(result.kind, 'duplicate');
  assert.equal(result.cycleNumber, 47);
  assert.equal(issuesArgs.length, 0, 'must not create an issue when a duplicate is detected');
});

test('publish: orphan-safety — issues.create throwing leaves no UPDATE to published', async () => {
  const { ctx, callOrder } = makeCtx({ issuesCreateThrows: true });
  const result = await publishBulletin(ctx, BASE_ARGS);
  assert.equal(result.kind, 'failed');
  assert.ok(!callOrder.includes('update'), 'no UPDATE to published when issues.create fails');
});

test('publish: tags array is exactly the 3 canonical entries in order', async () => {
  const { ctx, issuesArgs } = makeCtx();
  await publishBulletin(ctx, BASE_ARGS);
  assert.deepEqual(issuesArgs[0].tags, ['clarity:bulletin', 'clarity:bulletin-issue', 'cycle:47']);
});

test('publish: description body is the renderBulletinIssueBody output (markdown)', async () => {
  const { ctx, issuesArgs } = makeCtx();
  await publishBulletin(ctx, BASE_ARGS);
  assert.match(issuesArgs[0].description, /# The Bulletin/);
});

test('publish: title strictly matches the Bulletin No. N — Weekday, YYYY-MM-DD regex', async () => {
  const { ctx, issuesArgs } = makeCtx();
  await publishBulletin(ctx, BASE_ARGS);
  assert.match(
    issuesArgs[0].title,
    /^Bulletin No\. \d+ — (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{4}-\d{2}-\d{2}$/,
  );
});

test('publish: success returns {kind:published, cycleNumber, publishedIssueId, publishedAt}', async () => {
  const { ctx } = makeCtx();
  const result = await publishBulletin(ctx, BASE_ARGS);
  assert.equal(result.kind, 'published');
  assert.equal(result.cycleNumber, 47);
  assert.equal(result.publishedIssueId, 'issue-99');
  assert.equal(typeof result.publishedAt, 'string');
});

test('publish: issues.create returning null yields {kind:failed} and no published status', async () => {
  const { ctx, callOrder } = makeCtx({ issuesCreateNull: true });
  const result = await publishBulletin(ctx, BASE_ARGS);
  assert.equal(result.kind, 'failed');
  assert.match(result.reason, /null/i);
  assert.ok(!callOrder.includes('update'));
});

test('publish: cycle-2 idempotency pre-check is keyed on cycle_number, not next_due_at (v0.6.3 drill regression)', async () => {
  // Latent since Plan 03-02, first hit on the 2026-05-17 v0.6.3 cycle-2 drill.
  // After a cycle publishes, the compile-bulletin job advances that cycle's
  // OWN row to carry the next cycle's next_due_at. The pre-check used to query
  // `WHERE next_due_at = $1 AND compile_status='published'` — so it matched the
  // PRIOR cycle, saw a different content_hash, and returned {kind:'failed'};
  // every cycle >= 2 could never publish. The pre-check must key on the stable
  // per-bulletin identity (company_id, cycle_number).
  const seen = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    db: wrapHostFaithfulDb({
      async execute() { return { rowCount: 1 }; },
      async query(sql) {
        seen.push(sql);
        // Idempotency pre-check (cycle-scoped): cycle 2 is not yet published.
        if (/cycle_number = \$2 AND compile_status = 'published'/i.test(sql)) return [];
        // Post-INSERT owns check.
        if (/SELECT compile_status/i.test(sql)) return [{ compile_status: 'attempting' }];
        return [];
      },
    }),
    issues: {
      async create(a) {
        return { id: 'issue-cycle2', identifier: 'COU-200', ...a };
      },
    },
  };
  const result = await publishBulletin(ctx, { ...BASE_ARGS, cycleNumber: 2 });
  assert.equal(result.kind, 'published', 'cycle 2 must publish; the pre-check must not match a prior cycle');

  const preCheck = seen.find(
    (s) => /SELECT compile_status, content_hash/i.test(s) && /compile_status = 'published'/i.test(s),
  );
  assert.ok(preCheck, 'the idempotency pre-check query must run');
  assert.match(preCheck, /cycle_number = \$2/, 'the pre-check must be keyed on cycle_number');
  assert.doesNotMatch(
    preCheck,
    /WHERE next_due_at = \$1\s+AND compile_status = 'published'/i,
    'the pre-check must not be keyed on next_due_at alone',
  );
});
