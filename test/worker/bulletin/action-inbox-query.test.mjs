// test/worker/bulletin/action-inbox-query.test.mjs
//
// Plan 03-03 Task 1 RED — BULL-03 Action Inbox query. Locks the D-19
// corrected mapping: a card surfaces only when an issue is
//   status='blocked'  AND  assigneeUserId === viewerUserId
//   AND  blockerAttention.state ∈ {needs_attention, stalled}
//   AND  updatedAt within the last 30 days.
//
// queryActionInbox joins clarity_department_membership for the dept tag,
// computes ageMs + ageText worker-side, and degrades to [] (warn, not throw)
// when ctx.issues.list fails.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { queryActionInbox } from '../../../src/worker/bulletin/action-inbox-query.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Build a fake ctx. `issues` is the list returned by ctx.issues.list; `memberships`
// is the clarity_department_membership rows; `listThrows` makes issues.list reject.
function makeCtx({ issues = [], memberships = [], listThrows = false } = {}) {
  const warnCalls = [];
  return {
    logger: { warn: (...a) => warnCalls.push(a) },
    issues: {
      async list() {
        if (listThrows) throw new Error('issues.list down');
        return issues;
      },
    },
    db: {
      async query(sql) {
        if (/clarity_department_membership/i.test(sql)) return memberships;
        return [];
      },
    },
    _warnCalls: warnCalls,
  };
}

const NOW = new Date('2026-05-15T12:00:00.000Z');

function issue(over = {}) {
  return {
    id: 'i-1',
    identifier: 'COU-1',
    title: 'A blocked issue',
    description: 'Some description body',
    status: 'blocked',
    assigneeUserId: 'user-eric',
    blockerAttention: { state: 'needs_attention' },
    updatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    ...over,
  };
}

test('action-inbox: only blocked + viewer-owned + needs_attention/stalled issues are returned', async () => {
  const issues = [
    issue({ id: 'a', assigneeUserId: 'user-eric', blockerAttention: { state: 'needs_attention' } }),
    issue({ id: 'b', assigneeUserId: 'user-other', blockerAttention: { state: 'needs_attention' } }),
    issue({ id: 'c', assigneeUserId: 'user-eric', blockerAttention: { state: 'stalled' } }),
    issue({ id: 'd', assigneeUserId: 'user-eric', blockerAttention: { state: 'covered' } }),
    issue({ id: 'e', assigneeUserId: 'user-eric', blockerAttention: { state: 'none' } }),
  ];
  const cards = await queryActionInbox(makeCtx({ issues }), {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  const ids = cards.map((c) => c.issueId).sort();
  assert.deepEqual(ids, ['a', 'c']);
});

test('action-inbox: each card has the ActionInboxCard shape', async () => {
  const cards = await queryActionInbox(makeCtx({ issues: [issue()] }), {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  assert.equal(cards.length, 1);
  const c = cards[0];
  for (const k of ['issueId', 'identifier', 'title', 'department', 'ageMs', 'ageText', 'summary']) {
    assert.ok(k in c, `card missing ${k}`);
  }
  assert.equal(typeof c.ageMs, 'number');
  assert.equal(typeof c.ageText, 'string');
});

test('action-inbox: ageText buckets — minutes / hours / days', async () => {
  const issues = [
    issue({ id: 'm', updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString() }),
    issue({ id: 'h', updatedAt: new Date(NOW.getTime() - 5 * HOUR).toISOString() }),
    issue({ id: 'd', updatedAt: new Date(NOW.getTime() - 3 * DAY).toISOString() }),
  ];
  const cards = await queryActionInbox(makeCtx({ issues }), {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  const byId = Object.fromEntries(cards.map((c) => [c.issueId, c.ageText]));
  assert.match(byId.m, /^\d+m$/);
  assert.match(byId.h, /^\d+h$/);
  assert.match(byId.d, /^\d+d$/);
});

test('action-inbox: department joins clarity_department_membership, falls back to Builder', async () => {
  const issues = [
    issue({ id: 'sales', assigneeUserId: 'user-sales' }),
    issue({ id: 'unknown', assigneeUserId: 'user-unmapped' }),
  ];
  const memberships = [{ employee_user_id: 'user-sales', department: 'Sales' }];
  const cards = await queryActionInbox(makeCtx({ issues, memberships }), {
    companyId: 'co-1',
    viewerUserId: (id) => id, // not used — viewer filter below handled per-issue
    now: NOW,
  });
  // viewer filter uses a single id; rerun with explicit viewer for each
  const salesCards = await queryActionInbox(makeCtx({ issues, memberships }), {
    companyId: 'co-1',
    viewerUserId: 'user-sales',
    now: NOW,
  });
  assert.equal(salesCards[0].department, 'Sales');
  const unmapped = await queryActionInbox(makeCtx({ issues, memberships }), {
    companyId: 'co-1',
    viewerUserId: 'user-unmapped',
    now: NOW,
  });
  assert.equal(unmapped[0].department, 'Builder');
  void cards;
});

test('action-inbox: issues older than the 30-day window are filtered out', async () => {
  const issues = [
    issue({ id: 'recent', updatedAt: new Date(NOW.getTime() - 10 * DAY).toISOString() }),
    issue({ id: 'stale', updatedAt: new Date(NOW.getTime() - 45 * DAY).toISOString() }),
  ];
  const cards = await queryActionInbox(makeCtx({ issues }), {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  assert.deepEqual(cards.map((c) => c.issueId), ['recent']);
});

test('action-inbox: ctx.issues.list failure returns [] and warns once', async () => {
  const ctx = makeCtx({ listThrows: true });
  const cards = await queryActionInbox(ctx, {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  assert.deepEqual(cards, []);
  assert.equal(ctx._warnCalls.length, 1);
});

test('action-inbox: an issue with no assigneeUserId is excluded (defensive null-check)', async () => {
  const issues = [issue({ id: 'noassignee', assigneeUserId: undefined })];
  const cards = await queryActionInbox(makeCtx({ issues }), {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  assert.deepEqual(cards, []);
});

test('action-inbox: blockerAttention.state covered/none excluded — only needs_attention + stalled match D-19', async () => {
  const issues = [
    issue({ id: 'covered', blockerAttention: { state: 'covered' } }),
    issue({ id: 'none', blockerAttention: { state: 'none' } }),
    issue({ id: 'missing', blockerAttention: undefined }),
  ];
  const cards = await queryActionInbox(makeCtx({ issues }), {
    companyId: 'co-1',
    viewerUserId: 'user-eric',
    now: NOW,
  });
  assert.deepEqual(cards, []);
});
