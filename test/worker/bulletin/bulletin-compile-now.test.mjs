// test/worker/bulletin/bulletin-compile-now.test.mjs
//
// Delivery-layer rework (2026-05-28) — on-demand "Generate bulletin now".
//
// The action can no longer run the ~50s agent compile inside its own invocation
// (paperclipai@2026.525.0 expires the scope mid-poll — PR #6547). It now ENQUEUES
// the request: writes a `force-requested` marker in ctx.state and returns
// { kind:'queued' } immediately. The every-minute `compile-bulletin` job honors
// the marker on its next tick — running the force compile via the cross-tick
// state machine — and clears it (so it does not force every tick).
//
// This file pins BOTH halves:
//   - the ACTION enqueues (marker written, { kind:'queued' }, NO synchronous
//     compile) + opt-in guard + missing-param throw + state-unavailable error.
//   - the JOB honors the marker (force compile runs, marker cleared, daily
//     next_due_at left untouched) and does nothing extra when no marker is set.
//
// The synchronous published / no-change / dedupe / paused-agent assertions the
// prior version made now live in compile-bulletin-cross-tick.test.mjs (force
// path) and compile-bulletin-end-to-end.test.mjs (the resume/skip paths).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerBulletinCompileNow } from '../../../src/worker/handlers/bulletin-compile-now.ts';
import { registerCompileBulletinJob, forceRequestScope } from '../../../src/worker/jobs/compile-bulletin.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const CID = 'COU';
const FUTURE = '2999-01-01T03:30:00.000Z'; // daily pointer well in the future (cron not due)

function cannedDraft({ spend = 2475 } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Thursday', dateText: '2026-05-28', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: spend, format: 'currency' }],
    lineageThreads: [],
  };
}

function makeFakeCtx({ sqlMrr = 2475, agentStatus = 'idle', optedIn = true, seedNextDue = FUTURE, withState = true } = {}) {
  const bulletins = [];
  const issuesCreated = [];
  const operationIssues = [];
  const actions = new Map();
  const jobs = new Map();
  const stateStore = new Map();
  const k = (s) => `${s.scopeKind}:${s.scopeId}:${s.namespace ?? 'default'}:${s.stateKey}`;

  if (seedNextDue) {
    bulletins.push({ cycle_number: 0, company_id: CID, next_due_at: seedNextDue, content_hash: '__bootstrap__', compile_status: 'pending', published_issue_id: null, published_at: null });
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    state: withState
      ? {
          async get(s) { return stateStore.has(k(s)) ? stateStore.get(k(s)) : null; },
          async set(s, v) { stateStore.set(k(s), JSON.parse(JSON.stringify(v))); },
          async delete(s) { stateStore.delete(k(s)); },
        }
      : undefined,
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00Z' }] : [];
        if (/SELECT next_due_at/i.test(sql)) {
          const cid = params?.[0];
          const live = bulletins.filter((b) => b.company_id === cid).sort((a, b) => b.cycle_number - a.cycle_number);
          return live.length ? [{ next_due_at: live[0].next_due_at }] : [];
        }
        if (/MAX\(cycle_number\)/i.test(sql)) {
          const cid = params?.[0];
          const publishedOnly = /compile_status/i.test(sql);
          const max = bulletins.filter((b) => b.company_id === cid && (!publishedOnly || b.compile_status === 'published')).reduce((m, b) => Math.max(m, b.cycle_number), 0);
          return [{ max_cycle: max, max }];
        }
        if (/compile_status\s*=\s*'published'/i.test(sql) && /ORDER BY cycle_number DESC/i.test(sql)) {
          const cid = params?.[0];
          const pub = bulletins.filter((b) => b.company_id === cid && b.compile_status === 'published').sort((a, b) => b.cycle_number - a.cycle_number);
          return pub.length ? [pub[0]] : [];
        }
        if (/SELECT compile_status/i.test(sql)) {
          const row = bulletins.find((b) => b.company_id === params?.[0] && b.next_due_at === params?.[1] && b.content_hash === params?.[2]);
          return row ? [{ compile_status: row.compile_status }] : [];
        }
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) return [];
        return [{ value: sqlMrr }];
      },
      async execute(sql, params) {
        if (/INSERT INTO .*bulletins/i.test(sql)) {
          const isBootstrap = /verified_at/i.test(sql);
          const nextDueAt = params[2];
          const contentHash = isBootstrap ? params[8] : params[4];
          const draftJson = isBootstrap ? params[10] : params[6];
          const compileStatus = isBootstrap ? params[7] : 'attempting';
          const dup = bulletins.find((b) => b.company_id === params[1] && b.next_due_at === nextDueAt && b.content_hash === contentHash);
          if (dup) return { rowCount: 0 };
          bulletins.push({ cycle_number: params[0], company_id: params[1], next_due_at: nextDueAt, compiled_at: params[3], compile_status: compileStatus, content_hash: contentHash, draft_json: draftJson, published_issue_id: null, published_at: null });
          return { rowCount: 1 };
        }
        if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
          const row = bulletins.find((b) => b.company_id === params[2] && b.next_due_at === params[3] && b.content_hash === params[4]);
          if (row) { row.published_issue_id = params[0]; row.published_at = params[1]; row.compile_status = 'published'; }
          return { rowCount: row ? 1 : 0 };
        }
        if (/UPDATE[\s\S]*bulletins[\s\S]*SET next_due_at/i.test(sql)) {
          const cid = params[1];
          const matched = bulletins.filter((b) => b.company_id === cid);
          for (const r of matched) r.next_due_at = params[0];
          return { rowCount: matched.length };
        }
        return { rowCount: 1 };
      },
    },
    actions: { register(key, fn) { actions.set(key, fn); } },
    jobs: { register(key, fn) { jobs.set(key, fn); } },
    companies: { async list() { return [{ id: CID, name: 'Countermoves' }]; } },
    config: { async get() { return {}; } },
    agents: {
      async list() { return []; },
      async pause() {},
      async get(agentId, companyId) { return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' }; },
      async resume(agentId) { return { id: agentId, status: 'idle' }; },
      managed: { async reconcile() { return { agentId: 'editor-agent-uuid', agent: { id: 'editor-agent-uuid' }, status: 'resolved' }; } },
    },
    issues: {
      async create(args) {
        issuesCreated.push(args);
        const created = { id: `issue-${issuesCreated.length}`, identifier: `COU-${issuesCreated.length}`, createdAt: new Date(), updatedAt: new Date(), ...args };
        if (typeof args.originKind === 'string' && args.originKind.startsWith('plugin:clarity-pack:operation:')) operationIssues.push(created);
        return created;
      },
      async list(input = {}) {
        if (input.originKindPrefix) {
          if (!input.includePluginOperations) return [];
          return operationIssues.filter((oi) => oi.originKind && oi.originKind.startsWith(input.originKindPrefix) && (input.originId === undefined || oi.originId === input.originId));
        }
        return [];
      },
      async get() { return null; },
      async requestWakeup() { return { queued: true, runId: 'run-op' }; },
      // Warm agent — the result document is available on the immediate poll.
      documents: {
        async list(issueId) { return [{ id: 'doc-1', issueId, key: 'compile-result', format: 'markdown', createdAt: new Date(), updatedAt: new Date() }]; },
        async get(issueId, key) { return key === 'compile-result' ? { id: 'd', issueId, key, format: 'markdown', createdAt: new Date(), updatedAt: new Date(), body: JSON.stringify(cannedDraft()) } : null; },
      },
      async listComments() { return []; },
      async createComment() { return { id: 'comment-x' }; },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  registerBulletinCompileNow(ctx);
  registerCompileBulletinJob(ctx);
  return { ctx, action: actions.get('bulletin.compileNow'), job: jobs.get('compile-bulletin'), bulletins, issuesCreated, operationIssues, stateStore, forceKey: k(forceRequestScope(CID)) };
}

const bulletinIssuesOf = (created) => created.filter((i) => /^Bulletin No\. /.test(i.title ?? ''));

test('bulletin.compileNow — action is registered', () => {
  const { action } = makeFakeCtx();
  assert.ok(action, 'bulletin.compileNow registered via wrapActionHandler');
});

test('bulletin.compileNow — opted-in caller ENQUEUES: writes the force-request marker + returns { kind:queued } + does NOT compile synchronously', async () => {
  const { action, stateStore, forceKey, operationIssues, issuesCreated } = makeFakeCtx();
  const res = await action({ companyId: CID, userId: 'eric' });
  assert.deepEqual(res, { kind: 'queued' }, `expected queued, got ${JSON.stringify(res)}`);
  assert.ok(stateStore.has(forceKey), 'a force-requested marker is written to ctx.state');
  assert.equal(operationIssues.length, 0, 'the action must NOT start a compile in its own invocation');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'the action must NOT publish synchronously');
});

test('bulletin.compileNow — opted-out caller → OPT_IN_REQUIRED, no marker', async () => {
  const { action, stateStore, forceKey } = makeFakeCtx({ optedIn: false });
  const res = await action({ companyId: CID, userId: 'eric' });
  assert.deepEqual(res, { error: 'OPT_IN_REQUIRED' });
  assert.ok(!stateStore.has(forceKey), 'no marker written when opted out');
});

test('bulletin.compileNow — missing companyId → throws', async () => {
  const { action } = makeFakeCtx();
  await assert.rejects(() => action({ userId: 'eric' }), /companyId required/);
});

test('bulletin.compileNow — state capability unavailable → graceful error, no throw', async () => {
  const { action } = makeFakeCtx({ withState: false });
  const res = await action({ companyId: CID, userId: 'eric' });
  assert.equal(res.kind, 'error', `expected graceful error when ctx.state is absent, got ${JSON.stringify(res)}`);
  assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
});

test('compile-bulletin job HONORS a force-request marker: runs a force compile (warm agent publishes) + clears the marker + leaves next_due_at untouched', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { action, job, bulletins, issuesCreated, stateStore, forceKey } = makeFakeCtx({ seedNextDue: FUTURE });

  // Operator enqueues.
  await action({ companyId: CID, userId: 'eric' });
  assert.ok(stateStore.has(forceKey), 'marker set by the action');

  // The next job tick honors it.
  await job({ jobKey: 'compile-bulletin', runId: 'r1', trigger: 'schedule', scheduledAt: new Date().toISOString() });

  assert.equal(bulletinIssuesOf(issuesCreated).length, 1, 'the forced compile published a bulletin on the job tick');
  assert.ok(!stateStore.has(forceKey), 'the marker is cleared after the job honors it (does not force every tick)');
  for (const b of bulletins) {
    assert.equal(b.next_due_at, FUTURE, `a forced compile must NOT advance the daily schedule (row cycle ${b.cycle_number})`);
  }
});

test('compile-bulletin job WITHOUT a marker on a not-due company → no compile (the daily gate holds)', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { job, issuesCreated, operationIssues } = makeFakeCtx({ seedNextDue: FUTURE });
  await job({ jobKey: 'compile-bulletin', runId: 'r1', trigger: 'schedule', scheduledAt: new Date().toISOString() });
  assert.equal(operationIssues.length, 0, 'no compile started when not due and no force marker');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'nothing published when not due');
});
