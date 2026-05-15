// test/worker/bulletin/bulletin-action-handlers.test.mjs
//
// Plan 03-03 Task 1 RED — BULL-03 Approve / Decline action handlers.
//
// Both wrap via opt-in-guard's wrapActionHandler. Both re-verify viewer
// ownership (ctx.issues.get → assigneeUserId === userId) BEFORE mutating
// (T-03-16 defense). The mutation goes through ctx.issues.update.
//
// SDK NOTE (deviation_protocol #1): @paperclipai/plugin-sdk@2026.512.0's
// PluginIssuesClient.update is `update(issueId, patch, companyId)` and the
// patch type has NO `resolution` field — only `status`. Approve maps to
// status='done'; Decline maps to status='done' as well (the host has no
// distinct declined status). The test asserts ctx.issues.update is called
// with the correct issueId + companyId and that the call happens exactly once.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerBulletinActionApprove } from '../../../src/worker/handlers/bulletin-action-approve.ts';
import { registerBulletinActionDecline } from '../../../src/worker/handlers/bulletin-action-decline.ts';

// makeCtx registers action handlers into a map. `assignee` is the
// assigneeUserId of the issue ctx.issues.get returns; `issueExists` controls
// whether get resolves a row at all.
function makeCtx({ optedIn = true, assignee = 'user-eric', issueExists = true } = {}) {
  const handlers = new Map();
  const updateCalls = [];
  return {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async get(issueId) {
        return issueExists ? { id: issueId, assigneeUserId: assignee } : null;
      },
      async update(issueId, patch, companyId) {
        updateCalls.push({ issueId, patch, companyId });
        return { id: issueId };
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _updateCalls: updateCalls,
  };
}

test('action handlers: keys are bulletin.action.approve and bulletin.action.decline', () => {
  const ctx = makeCtx();
  registerBulletinActionApprove(ctx);
  registerBulletinActionDecline(ctx);
  assert.ok(ctx._handlers.has('bulletin.action.approve'));
  assert.ok(ctx._handlers.has('bulletin.action.decline'));
});

test('action handlers: both wrapped via opt-in-guard — opted-out → OPT_IN_REQUIRED', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerBulletinActionApprove(ctx);
  registerBulletinActionDecline(ctx);
  const a = await ctx._handlers.get('bulletin.action.approve')({
    issueId: 'i-1',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  const d = await ctx._handlers.get('bulletin.action.decline')({
    issueId: 'i-1',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(a.error, 'OPT_IN_REQUIRED');
  assert.equal(d.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._updateCalls.length, 0);
});

test('action handlers: Approve calls ctx.issues.update once with issueId+companyId', async () => {
  const ctx = makeCtx({ assignee: 'user-eric' });
  registerBulletinActionApprove(ctx);
  const result = await ctx._handlers.get('bulletin.action.approve')({
    issueId: 'i-7',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(ctx._updateCalls.length, 1);
  assert.equal(ctx._updateCalls[0].issueId, 'i-7');
  assert.equal(ctx._updateCalls[0].companyId, 'co-1');
  assert.equal(result.ok, true);
});

test('action handlers: Decline calls ctx.issues.update once with issueId+companyId', async () => {
  const ctx = makeCtx({ assignee: 'user-eric' });
  registerBulletinActionDecline(ctx);
  const result = await ctx._handlers.get('bulletin.action.decline')({
    issueId: 'i-9',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(ctx._updateCalls.length, 1);
  assert.equal(ctx._updateCalls[0].issueId, 'i-9');
  assert.equal(ctx._updateCalls[0].companyId, 'co-1');
  assert.equal(result.ok, true);
});

test('action handlers: viewer NOT the assignee → NOT_OWNED, update NOT called (T-03-16)', async () => {
  const ctx = makeCtx({ assignee: 'someone-else' });
  registerBulletinActionApprove(ctx);
  const result = await ctx._handlers.get('bulletin.action.approve')({
    issueId: 'i-1',
    companyId: 'co-1',
    userId: 'user-eric',
  });
  assert.equal(result.error, 'NOT_OWNED');
  assert.equal(ctx._updateCalls.length, 0);
});

test('action handlers: missing issueId → throws', async () => {
  const ctx = makeCtx();
  registerBulletinActionApprove(ctx);
  await assert.rejects(
    () =>
      ctx._handlers.get('bulletin.action.approve')({
        companyId: 'co-1',
        userId: 'user-eric',
      }),
    /issueId/i,
  );
});
