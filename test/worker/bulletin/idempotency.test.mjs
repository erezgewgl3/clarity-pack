// test/worker/bulletin/idempotency.test.mjs
//
// Plan 03-04 Task 1 RED — BULL-02 idempotency completion.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { publishBulletin } from '../../../src/worker/bulletin/publish.ts';

function draft(number = 1, title = '') {
  return {
    masthead: {
      volume: 'I',
      number,
      weekday: 'Saturday',
      dateText: '2026-05-16',
      prepareForName: 'Eric G.',
      cycleNumber: number,
    },
    actionInbox: [],
    departments: title ? [{ name: 'Sales', items: [], editorialSummary: title }] : [],
    standingNumbers: [],
    lineageThreads: [],
  };
}

function makeCtx() {
  const rows = [];
  const issuesCreated = [];
  const comments = [];
  return {
    rows,
    issuesCreated,
    comments,
    ctx: {
      logger: { warn() {}, info() {} },
      db: {
        async execute(sql, params) {
          if (/INSERT INTO .*bulletins/i.test(sql)) {
            const nextDueAt = params[2];
            const contentHash = params[4];
            if (rows.find((r) => r.company_id === params[1] && r.next_due_at === nextDueAt && r.content_hash === contentHash)) {
              return { rowCount: 0 };
            }
            rows.push({
              cycle_number: params[0],
              company_id: params[1],
              next_due_at: nextDueAt,
              content_hash: contentHash,
              compile_status: 'attempting',
              published_issue_id: null,
            });
            return { rowCount: 1 };
          }
          if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
            const row = rows.find((r) => r.company_id === params[2] && r.next_due_at === params[3] && r.content_hash === params[4]);
            if (row) {
              row.published_issue_id = params[0];
              row.compile_status = 'published';
            }
            return { rowCount: row ? 1 : 0 };
          }
          if (/UPDATE[\s\S]*bulletin_errata/i.test(sql)) return { rowCount: 1 };
          return { rowCount: 1 };
        },
        async query(sql, params) {
          // Idempotency pre-check — cycle-scoped (v0.6.4 fix): keyed on
          // (company_id, cycle_number), params [companyId, cycleNumber].
          if (/WHERE company_id = \$1 AND cycle_number = \$2 AND compile_status = 'published'/i.test(sql)) {
            const row = rows.find(
              (r) =>
                r.company_id === params[0] &&
                r.cycle_number === params[1] &&
                r.compile_status === 'published',
            );
            return row ? [{ compile_status: row.compile_status, content_hash: row.content_hash }] : [];
          }
          // Post-INSERT owns check — keyed on (next_due_at, content_hash).
          if (/SELECT compile_status/i.test(sql)) {
            const row = rows.find((r) => r.company_id === params[0] && r.next_due_at === params[1] && r.content_hash === params[2]);
            return row ? [{ compile_status: row.compile_status }] : [];
          }
          return [];
        },
      },
      issues: {
        async create(args) {
          issuesCreated.push(args);
          return { id: `issue-${issuesCreated.length}`, ...args };
        },
        async createComment(issueId, body) {
          comments.push({ issueId, body });
          return { id: `comment-${comments.length}` };
        },
      },
    },
  };
}

const BASE = {
  companyId: 'COU',
  cycleNumber: 1,
  nextDueAtIso: '2026-05-16T10:30:00.000Z',
  editorAgentId: 'agent-uuid-1',
  compiledAt: new Date('2026-05-16T10:30:00.000Z'),
};

test('same next_due_at and same content hash publishes exactly once', async () => {
  const { ctx, issuesCreated, rows } = makeCtx();
  const first = await publishBulletin(ctx, { ...BASE, draft: draft() });
  const second = await publishBulletin(ctx, { ...BASE, draft: draft() });
  assert.equal(first.kind, 'published');
  assert.equal(second.kind, 'duplicate');
  assert.equal(issuesCreated.length, 1);
  assert.equal(rows.filter((r) => r.compile_status === 'published').length, 1);
});

test('same next_due_at with different content hash is rejected as a new attempt, not a republish', async () => {
  const { ctx, issuesCreated, rows } = makeCtx();
  const first = await publishBulletin(ctx, { ...BASE, draft: draft(1, 'First body') });
  const second = await publishBulletin(ctx, { ...BASE, draft: draft(1, 'Changed body') });
  assert.equal(first.kind, 'published');
  assert.equal(second.kind, 'failed');
  assert.match(second.reason, /different content_hash/);
  assert.equal(issuesCreated.length, 1);
  assert.equal(rows.length, 1);
});

test('errata snapshot idempotency is driven by erratum ids marked after comment creation', async () => {
  const { ctx, comments } = makeCtx();
  await publishBulletin(ctx, {
    ...BASE,
    cycleNumber: 2,
    nextDueAtIso: '2026-05-17T10:30:00.000Z',
    draft: draft(2),
    priorCycleErratumSnapshot: {
      priorIssueId: 'issue-prior',
      erratumIds: [1],
      erratumBodies: ['One correction.'],
    },
  });
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /One correction/);
});
