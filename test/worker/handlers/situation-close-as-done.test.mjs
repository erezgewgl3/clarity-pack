// test/worker/handlers/situation-close-as-done.test.mjs
//
// Plan 18-03 Task 3 (LEG-03) — situation.closeAsDone: the confirm-gated close
// mutation behind the "Looks done — close it?" affordance. Mirrors the
// situation-assign-owner.test.mjs harness (fake ctx + an issues.update spy).
//
// Behaviors:
//   1. missing companyId/leafIssueId/leafIssueUuid/userId → THROW "situation.closeAsDone: <key> required"
//   2. opted-out caller → { error: 'OPT_IN_REQUIRED' } (via wrapActionHandler)
//   3. success → ctx.issues.update(leafIssueUuid, {status:'done'}, companyId, actor)
//      with actor.actorUserId === operator userId (audit attribution); returns
//      { ok, leafIssueId } (the HUMAN key echoed, never the UUID)
//   4. the host rejects a non-UUID first arg → the handler must pass the UUID
//      (not the human key) — a strict fake throws on a non-UUID and would trip
//      CLOSE_FAILED if the handler regressed
//   5. ctx.issues.update throws → { error: 'CLOSE_FAILED' }

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerSituationCloseAsDone } from '../../../src/worker/handlers/situation-close-as-done.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function isUuid(id) {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

const LEAF_UUID = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
const HUMAN_KEY = 'BEAAA-43';

function makeCtx({ optedIn = true, updateThrows = false, uuidStrictUpdate = false } = {}) {
  const handlers = new Map();
  const issueUpdateCalls = [];
  const warnLogs = [];

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info() {},
    },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async update(issueId, patch, companyId, actor) {
        issueUpdateCalls.push({ issueId, patch, companyId, actor });
        if (updateThrows) throw new Error('host issues.update 503');
        if (uuidStrictUpdate && !isUuid(issueId)) {
          throw new Error(`host issues.update: invalid id ${issueId}`);
        }
        return { id: issueId, ...patch };
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
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _issueUpdateCalls: issueUpdateCalls,
    _warnLogs: warnLogs,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function params(overrides = {}) {
  return {
    companyId: 'co-1',
    leafIssueId: HUMAN_KEY,
    leafIssueUuid: LEAF_UUID,
    userId: 'user-eric',
    ...overrides,
  };
}

function getHandler(ctx) {
  registerSituationCloseAsDone(ctx);
  const fn = ctx._handlers.get('situation.closeAsDone');
  assert.ok(fn, 'situation.closeAsDone registered');
  return fn;
}

test('closeAsDone — missing required params throw "<key> required" (post opt-in gate)', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  // userId is consumed by the opt-in guard BEFORE the handler body (a missing
  // userId is treated as opted-out → OPT_IN_REQUIRED, covered separately). The
  // body's reqStr throws for the three handler-level required keys.
  for (const key of ['companyId', 'leafIssueId', 'leafIssueUuid']) {
    const p = params();
    delete p[key];
    await assert.rejects(() => fn(p), new RegExp(`situation\\.closeAsDone: ${key} required`));
  }
  assert.equal(ctx._issueUpdateCalls.length, 0, 'no mutation attempted on a bad request');
});

test('closeAsDone — missing userId → OPT_IN_REQUIRED (guard cannot identify the caller), no mutation', async () => {
  const ctx = makeCtx();
  const fn = getHandler(ctx);
  const p = params();
  delete p.userId;
  const res = await fn(p);
  assert.deepEqual(res, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._issueUpdateCalls.length, 0, 'no mutation without an identified caller');
});

test('closeAsDone — opted-out caller → OPT_IN_REQUIRED, no mutation', async () => {
  const ctx = makeCtx({ optedIn: false });
  const fn = getHandler(ctx);
  const res = await fn(params());
  assert.deepEqual(res, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._issueUpdateCalls.length, 0, 'opted-out never mutates');
});

test('closeAsDone — success flips status=done via the UUID, actor carries operator userId, echoes the human key', async () => {
  const ctx = makeCtx({ uuidStrictUpdate: true });
  const fn = getHandler(ctx);
  const res = await fn(params());
  assert.deepEqual(res, { ok: true, leafIssueId: HUMAN_KEY });
  assert.equal(ctx._issueUpdateCalls.length, 1, 'exactly one ctx.issues.update');
  const call = ctx._issueUpdateCalls[0];
  assert.equal(call.issueId, LEAF_UUID, 'mutates via the UUID (not the human key)');
  assert.deepEqual(call.patch, { status: 'done' }, 'flips status to done');
  assert.equal(call.companyId, 'co-1');
  assert.equal(call.actor.actorUserId, 'user-eric', 'audit actor = the operator');
});

test('closeAsDone — issues.update throws → CLOSE_FAILED', async () => {
  const ctx = makeCtx({ updateThrows: true });
  const fn = getHandler(ctx);
  const res = await fn(params());
  assert.deepEqual(res, { error: 'CLOSE_FAILED' });
  assert.equal(ctx._issueUpdateCalls.length, 1, 'attempted exactly once');
});
