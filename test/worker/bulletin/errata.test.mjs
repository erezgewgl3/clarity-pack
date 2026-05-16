// test/worker/bulletin/errata.test.mjs
//
// Plan 03-04 Task 1 RED — BULL-07 errata first-class behavior:
// append-only worker handlers plus snapshot-as-comment on the next publish.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerBulletinErrata } from '../../../src/worker/handlers/bulletin-errata.ts';
import { publishBulletin } from '../../../src/worker/bulletin/publish.ts';

function wellFormedDraft() {
  return {
    masthead: {
      volume: 'I',
      number: 2,
      weekday: 'Friday',
      dateText: '2026-05-08',
      prepareForName: 'Eric G.',
      cycleNumber: 2,
    },
    actionInbox: [],
    departments: [],
    standingNumbers: [],
    lineageThreads: [],
  };
}

function makeHandlerCtx({ compileStatus = 'published', errata = [] } = {}) {
  const dataHandlers = new Map();
  const actionHandlers = new Map();
  const inserted = [];
  const ctx = {
    data: { register: (key, fn) => dataHandlers.set(key, fn) },
    actions: { register: (key, fn) => actionHandlers.set(key, fn) },
    logger: { warn() {}, info() {} },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) return [{ opted_in_at: '2026-05-16T00:00:00.000Z' }];
        if (/FROM plugin_clarity_pack_cdd6bda4bd\.bulletins/i.test(sql)) {
          return [{
            cycle_number: params?.includes(7) ? 7 : 1,
            company_id: 'COU',
            next_due_at: '2026-05-16T10:30:00.000Z',
            compiled_at: null,
            verified_at: null,
            published_at: compileStatus === 'published' ? '2026-05-16T10:31:00.000Z' : null,
            published_issue_id: compileStatus === 'published' ? 'issue-prior' : null,
            compile_status: compileStatus,
            content_hash: 'hash',
            lineage_thread_json: [],
            draft_json: {},
          }];
        }
        if (/bulletin_errata/i.test(sql)) {
          return errata.length > 0 ? errata : inserted.slice(-1);
        }
        return [];
      },
      async execute(sql, params) {
        if (/INSERT INTO plugin_clarity_pack_cdd6bda4bd\.bulletin_errata/i.test(sql)) {
          inserted.push({
            id: inserted.length + 1,
            bulletin_cycle_number: params[0],
            added_at: '2026-05-16T12:00:00.000Z',
            added_by_user_id: params[1],
            body_md: params[2],
            applied_to_issue_comment_id: params[3],
          });
        }
        return { rowCount: 1 };
      },
    },
  };
  registerBulletinErrata(ctx);
  return { ctx, dataHandlers, actionHandlers, inserted };
}

test('errata handler registers bulletin.errata.byCycle data and bulletin.errata.add action', () => {
  const { dataHandlers, actionHandlers } = makeHandlerCtx();
  assert.equal(typeof dataHandlers.get('bulletin.errata.byCycle'), 'function');
  assert.equal(typeof actionHandlers.get('bulletin.errata.add'), 'function');
});

test('errata byCycle returns camelCase rows scoped to cycle and company', async () => {
  const { dataHandlers } = makeHandlerCtx({
    errata: [{
      id: 10,
      bulletin_cycle_number: 7,
      added_at: '2026-05-16T12:00:00.000Z',
      added_by_user_id: 'user-1',
      body_md: 'Correct the MRR figure.',
      applied_to_issue_comment_id: null,
    }],
  });
  const rows = await dataHandlers.get('bulletin.errata.byCycle')({
    userId: 'user-1',
    companyId: 'COU',
    cycle: 7,
  });
  assert.deepEqual(rows, [{
    id: 10,
    bulletinCycleNumber: 7,
    addedAt: '2026-05-16T12:00:00.000Z',
    addedByUserId: 'user-1',
    bodyMd: 'Correct the MRR figure.',
    appliedToIssueCommentId: null,
  }]);
});

test('errata add rejects unpublished cycles before writing', async () => {
  const { actionHandlers, inserted } = makeHandlerCtx({ compileStatus: 'attempting' });
  const result = await actionHandlers.get('bulletin.errata.add')({
    userId: 'user-1',
    companyId: 'COU',
    cycle: 7,
    body: 'Late correction.',
  });
  assert.deepEqual(result, { error: 'NOT_PUBLISHED' });
  assert.equal(inserted.length, 0);
});

test('errata add writes append-only row for a published cycle', async () => {
  const { actionHandlers, inserted } = makeHandlerCtx({ compileStatus: 'published' });
  const result = await actionHandlers.get('bulletin.errata.add')({
    userId: 'user-1',
    companyId: 'COU',
    cycle: 7,
    body: 'Late correction.',
  });
  assert.deepEqual(result, { ok: true, errataId: 1 });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].added_by_user_id, 'user-1');
  assert.equal(inserted[0].body_md, 'Late correction.');
  assert.equal(inserted[0].applied_to_issue_comment_id, null);
});

test('errata add rejects empty and overlong bodies', async () => {
  const { actionHandlers } = makeHandlerCtx();
  assert.deepEqual(
    await actionHandlers.get('bulletin.errata.add')({
      userId: 'user-1',
      companyId: 'COU',
      cycle: 7,
      body: '',
    }),
    { error: 'INVALID_BODY' },
  );
  assert.deepEqual(
    await actionHandlers.get('bulletin.errata.add')({
      userId: 'user-1',
      companyId: 'COU',
      cycle: 7,
      body: 'x'.repeat(2001),
    }),
    { error: 'INVALID_BODY' },
  );
});

function makePublishCtx({ createCommentThrows = false } = {}) {
  const callOrder = [];
  const comments = [];
  const updates = [];
  return {
    ctx: {
      logger: { warn() {}, info() {} },
      db: {
        async execute(sql, params) {
          if (/INSERT INTO .*bulletins/i.test(sql)) callOrder.push('insert');
          if (/UPDATE[\s\S]*bulletins[\s\S]*compile_status = 'published'/i.test(sql)) {
            callOrder.push('update-published');
          }
          if (/UPDATE[\s\S]*bulletin_errata[\s\S]*applied_to_issue_comment_id/i.test(sql)) {
            updates.push(params);
            callOrder.push('mark-erratum-applied');
          }
          return { rowCount: 1 };
        },
        async query(sql) {
          if (/SELECT compile_status/i.test(sql)) return [{ compile_status: 'attempting' }];
          return [];
        },
      },
      issues: {
        async create(args) {
          callOrder.push('issues.create');
          return { id: 'issue-current', ...args };
        },
        async createComment(issueId, body, companyId) {
          callOrder.push('createComment');
          comments.push({ issueId, body, companyId });
          if (createCommentThrows) throw new Error('comments down');
          return { id: 'comment-1' };
        },
      },
    },
    callOrder,
    comments,
    updates,
  };
}

test('publish snapshots prior-cycle errata as a comment after the current cycle is published', async () => {
  const { ctx, callOrder, comments, updates } = makePublishCtx();
  const result = await publishBulletin(ctx, {
    companyId: 'COU',
    cycleNumber: 2,
    nextDueAtIso: '2026-05-17T10:30:00.000Z',
    editorAgentId: 'agent-uuid-1',
    draft: wellFormedDraft(),
    compiledAt: new Date('2026-05-17T10:30:00.000Z'),
    priorCycleErratumSnapshot: {
      priorIssueId: 'issue-prior',
      erratumIds: [42],
      erratumBodies: ['Correct the MRR figure.'],
    },
  });
  assert.equal(result.kind, 'published');
  assert.ok(callOrder.indexOf('createComment') > callOrder.indexOf('update-published'));
  assert.deepEqual(comments, [{
    issueId: 'issue-prior',
    body: '**Errata appended after publish:**\n\n- Correct the MRR figure.',
    companyId: 'COU',
  }]);
  assert.deepEqual(updates, [['comment-1', 42]]);
});

test('publish snapshot is append-only and never updates the prior issue body', async () => {
  const { ctx } = makePublishCtx();
  await publishBulletin(ctx, {
    companyId: 'COU',
    cycleNumber: 2,
    nextDueAtIso: '2026-05-17T10:30:00.000Z',
    editorAgentId: 'agent-uuid-1',
    draft: wellFormedDraft(),
    compiledAt: new Date('2026-05-17T10:30:00.000Z'),
    priorCycleErratumSnapshot: {
      priorIssueId: 'issue-prior',
      erratumIds: [42],
      erratumBodies: ['Correct the MRR figure.'],
    },
  });
  assert.equal(typeof ctx.issues.update, 'undefined', 'publish must not mutate prior issue body');
});

test('publish continues when errata comment creation fails', async () => {
  const { ctx, callOrder } = makePublishCtx({ createCommentThrows: true });
  const result = await publishBulletin(ctx, {
    companyId: 'COU',
    cycleNumber: 2,
    nextDueAtIso: '2026-05-17T10:30:00.000Z',
    editorAgentId: 'agent-uuid-1',
    draft: wellFormedDraft(),
    compiledAt: new Date('2026-05-17T10:30:00.000Z'),
    priorCycleErratumSnapshot: {
      priorIssueId: 'issue-prior',
      erratumIds: [42],
      erratumBodies: ['Correct the MRR figure.'],
    },
  });
  assert.equal(result.kind, 'published');
  assert.ok(callOrder.includes('createComment'));
});

