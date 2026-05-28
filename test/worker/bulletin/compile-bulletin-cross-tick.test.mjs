// test/worker/bulletin/compile-bulletin-cross-tick.test.mjs
//
// Delivery-layer rework (2026-05-28) — §9.1 cross-tick compile state machine.
//
// `compileBulletinForCompany` no longer holds ONE host invocation across the
// whole agent round-trip (paperclipai@2026.525.0 expires the scope mid-poll —
// PR #6547). Instead it STARTs the agent task in one tick (and does a single
// immediate poll to catch a warm agent), persists a `pending-compile` record in
// ctx.state, and CONSUMES the result on a LATER tick (a fresh, valid
// invocation). These tests pin that behaviour:
//
//   - START with the agent not-yet-ready → { kind:'started' } + a pending
//     record written + NO publish + exactly ONE operation issue + schedule NOT
//     advanced.
//   - a later RESUME tick once the agent is ready → consumes the result +
//     publishes + clears pending + advances the schedule.
//   - two consecutive not-ready ticks → exactly ONE operation issue, schedule
//     still not advanced (the runaway guard, preserves v0.6.6).
//   - pending past its deadline → failure (cron records the breaker failure;
//     force does NOT) + clears pending.
//   - force dedupe fires on the resume tick (no new bulletin when the substance
//     is unchanged since the last published cycle).
//
// The fake ctx adds a minimal in-memory `ctx.state` (the host KV store) keyed
// `${scopeKind}:${scopeId}:${namespace}:${stateKey}`, JSON-round-tripping every
// value the way the host persists it. Readiness is driven by the
// `issues.documents` channel (Option B) — not-ready returns null/[], ready
// serves the `compile-result` document.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { compileBulletinForCompany, resumePendingCompile } from '../../../src/worker/jobs/compile-bulletin.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { AGENT_TASK_DELIVERY_TIMEOUT } from '../../../src/worker/agents/agent-task-delivery.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const CID = 'COU';
const PAST = '2026-05-07T00:00:00.000Z'; // due
const T0 = new Date('2026-05-28T03:30:00.000Z');

function cannedDraft({ spend = 2475 } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Thursday', dateText: '2026-05-28', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: spend, format: 'currency' }],
    lineageThreads: [],
  };
}

const PENDING_SCOPE = { scopeKind: 'company', scopeId: CID, namespace: 'bulletin', stateKey: 'pending-compile' };

function makeCtx({ sqlMrr = 2475, agentStatus = 'idle', ready = false, resultBody } = {}) {
  const bulletins = [];
  const issuesCreated = [];
  const operationIssues = [];
  const failures = []; // editor_agent_failures (breaker)
  const compileFailures = []; // bulletin_compile_failures (D-22)
  const stateStore = new Map();
  // Mutable readiness — flip `agent.ready` between fires to simulate the agent
  // answering on a LATER tick.
  const agent = { ready, body: resultBody ?? JSON.stringify(cannedDraft()) };

  const k = (s) => `${s.scopeKind}:${s.scopeId}:${s.namespace ?? 'default'}:${s.stateKey}`;

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    state: {
      async get(s) { return stateStore.has(k(s)) ? stateStore.get(k(s)) : null; },
      async set(s, v) { stateStore.set(k(s), JSON.parse(JSON.stringify(v))); },
      async delete(s) { stateStore.delete(k(s)); },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/SELECT next_due_at/i.test(sql)) {
          const cid = params?.[0];
          const live = bulletins.filter((b) => b.company_id === cid).sort((a, b) => b.cycle_number - a.cycle_number);
          if (live.length) return [{ next_due_at: live[0].next_due_at }];
          return [{ next_due_at: PAST }];
        }
        if (/MAX\(cycle_number\)/i.test(sql)) {
          const cid = params?.[0];
          const publishedOnly = /compile_status/i.test(sql);
          const max = bulletins
            .filter((b) => b.company_id === cid && (!publishedOnly || b.compile_status === 'published'))
            .reduce((m, b) => Math.max(m, b.cycle_number), 0);
          return [{ max_cycle: max, max }];
        }
        // getLatestPublishedBulletin — full-column read, published only, newest cycle.
        if (/compile_status\s*=\s*'published'/i.test(sql) && /ORDER BY cycle_number DESC/i.test(sql)) {
          const cid = params?.[0];
          const pub = bulletins
            .filter((b) => b.company_id === cid && b.compile_status === 'published')
            .sort((a, b) => b.cycle_number - a.cycle_number);
          return pub.length ? [pub[0]] : [];
        }
        if (/SELECT compile_status/i.test(sql)) {
          const row = bulletins.find((b) => b.company_id === params?.[0] && b.next_due_at === params?.[1] && b.content_hash === params?.[2]);
          return row ? [{ compile_status: row.compile_status }] : [];
        }
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) {
          const agentKey = params?.[0];
          const limit = Number(params?.[1] ?? 3);
          return failures.filter((f) => f.agentKey === agentKey).slice(-limit).reverse().map((f) => ({ consecutive: f.consecutive }));
        }
        return [{ value: sqlMrr }];
      },
      async execute(sql, params) {
        if (/editor_agent_failures/i.test(sql)) {
          failures.push({ agentKey: params?.[0], reason: params?.[1], consecutive: params?.[2] });
          return { rowCount: 1 };
        }
        if (/bulletin_compile_failures/i.test(sql)) {
          compileFailures.push({ cycle_number: params?.[0], reason: params?.[1] });
          return { rowCount: 1 };
        }
        if (/INSERT INTO .*bulletins/i.test(sql)) {
          const isBootstrap = /verified_at/i.test(sql);
          const nextDueAt = params[2];
          const contentHash = isBootstrap ? params[8] : params[4];
          const draftJson = isBootstrap ? params[10] : params[6];
          const compileStatus = isBootstrap ? params[7] : 'attempting';
          const dup = bulletins.find((b) => b.company_id === params[1] && b.next_due_at === nextDueAt && b.content_hash === contentHash);
          if (dup) return { rowCount: 0 };
          bulletins.push({
            cycle_number: params[0], company_id: params[1], next_due_at: nextDueAt,
            compiled_at: params[3], compile_status: compileStatus, content_hash: contentHash,
            draft_json: draftJson, published_issue_id: null, published_at: null,
          });
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
    companies: { async list() { return [{ id: CID, name: 'Countermoves' }]; } },
    config: { async get() { return {}; } },
    agents: {
      async list() { return []; },
      async pause() {},
      async get(agentId, companyId) { return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' }; },
      async resume(agentId, companyId) { return { id: agentId, status: 'idle' }; },
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
      async listComments() { return []; }, // readiness driven by documents, not comments
      async createComment() { return { id: 'comment-x' }; },
      documents: {
        async list(issueId) {
          if (!agent.ready) return [];
          return [{ id: 'doc-1', issueId, key: 'compile-result', title: 'Compiled result', format: 'markdown', latestRevisionNumber: 1, createdByAgentId: 'editor-agent-uuid', createdAt: new Date(), updatedAt: new Date() }];
        },
        async get(issueId, key) {
          if (!agent.ready || key !== 'compile-result') return null;
          return { id: 'doc-compile-result', issueId, key, title: 'Compiled result', format: 'markdown', latestRevisionNumber: 1, createdByAgentId: 'editor-agent-uuid', createdAt: new Date(), updatedAt: new Date(), body: agent.body };
        },
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, bulletins, issuesCreated, operationIssues, failures, compileFailures, stateStore, agent, pendingKey: k(PENDING_SCOPE) };
}

const bulletinIssuesOf = (created) => created.filter((i) => /^Bulletin No\. /.test(i.title ?? ''));

test('cross-tick: START with agent not-ready returns { kind:started }, persists pending, no publish, one op issue, no schedule advance', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, issuesCreated, operationIssues, stateStore, pendingKey } = makeCtx({ ready: false });

  const res = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: false });

  assert.equal(res.kind, 'started', `expected started, got ${JSON.stringify(res)}`);
  assert.equal(operationIssues.length, 1, 'exactly one bulletin-compile operation issue created at START');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'nothing published while the agent is still working');
  assert.ok(stateStore.has(pendingKey), 'a pending-compile record is persisted in ctx.state');
  const pending = stateStore.get(pendingKey);
  assert.equal(pending.operationIssueId, operationIssues[0].id, 'pending record carries the operation issue id');
  assert.ok(Array.isArray(pending.standingNumberRows) && pending.standingNumberRows.length > 0, 'pending freezes the standing-number rows');
  assert.equal(bulletins.filter((b) => b.compile_status === 'published').length, 0, 'no published bulletins row at START');
});

test('cross-tick: a later RESUME tick once the agent is ready consumes the result + publishes + clears pending + advances schedule', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, issuesCreated, operationIssues, stateStore, agent, pendingKey } = makeCtx({ ready: false });

  // Tick 1 — START, agent not ready.
  const r1 = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: false });
  assert.equal(r1.kind, 'started');
  assert.ok(stateStore.has(pendingKey));

  // Tick 2 — agent has now answered. RESUME consumes the document.
  agent.ready = true;
  const r2 = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: new Date(T0.getTime() + 60_000), force: false });

  assert.equal(r2.kind, 'published', `expected published on the resume tick, got ${JSON.stringify(r2)}`);
  assert.equal(operationIssues.length, 1, 'the resume tick must NOT create a second operation issue');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 1, 'exactly one bulletin issue published on the resume tick');
  assert.ok(bulletins.find((b) => b.compile_status === 'published'), 'a published bulletins row exists');
  assert.ok(!stateStore.has(pendingKey), 'the pending record is cleared after a terminal publish');
  const published = bulletins.find((b) => b.compile_status === 'published');
  assert.ok(new Date(published.next_due_at).getTime() > new Date(T0).getTime(), 'schedule advanced on the terminal publish');
});

test('cross-tick (runaway guard): two consecutive not-ready ticks create exactly ONE operation issue and never advance the schedule', { timeout: 12000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, operationIssues, bulletins } = makeCtx({ ready: false });

  await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: false });
  const r2 = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: new Date(T0.getTime() + 60_000), force: false });

  assert.equal(r2.kind, 'pending', `second not-ready tick must report pending, got ${JSON.stringify(r2)}`);
  assert.equal(operationIssues.length, 1, 'still exactly ONE operation issue across two not-ready ticks (no duplicate)');
  // No published row, and no bulletins row at all → the seed PAST pointer is
  // untouched (a non-terminal tick must never advance the schedule).
  assert.equal(bulletins.length, 0, 'no bulletins row written while pending — schedule pointer untouched');
});

test('cross-tick: pending past its deadline → failure; cron records the breaker failure + clears pending', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, failures, compileFailures, stateStore, pendingKey } = makeCtx({ ready: false });

  await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: false });
  assert.ok(stateStore.has(pendingKey));

  // A later tick PAST the delivery deadline, agent still not ready.
  const late = new Date(T0.getTime() + AGENT_TASK_DELIVERY_TIMEOUT + 1000);
  const res = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: late, force: false });

  assert.equal(res.kind, 'failed', `expected failed past deadline, got ${JSON.stringify(res)}`);
  assert.match(res.reason, /timeout/i, 'failure reason names the delivery timeout');
  assert.ok(failures.length >= 1, 'cron path records a breaker failure on timeout');
  assert.ok(compileFailures.length >= 1, 'cron path records a cycle compile failure (D-22 banner)');
  assert.ok(!stateStore.has(pendingKey), 'pending is cleared after the timeout');
});

test('cross-tick: force-mode pending past deadline → failure WITHOUT recording the breaker (operator action must not trip auto-pause)', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, failures, stateStore, pendingKey } = makeCtx({ ready: false });

  await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: true });
  const pending = stateStore.get(pendingKey);
  assert.equal(pending.mode, 'force', 'pending record remembers it was a force compile');

  const late = new Date(T0.getTime() + AGENT_TASK_DELIVERY_TIMEOUT + 1000);
  const res = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: late, force: true });

  assert.equal(res.kind, 'failed');
  assert.equal(failures.length, 0, 'a force compile timeout must NOT record a breaker failure');
  assert.ok(!stateStore.has(pendingKey), 'pending is cleared after the force timeout');
});

test('resumePendingCompile: no pending record → { kind:no-pending } no-op (no START, no publish)', async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, operationIssues } = makeCtx({ ready: true });
  const res = await resumePendingCompile(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: false });
  assert.equal(res.kind, 'no-pending', `no pending → no-pending; got ${JSON.stringify(res)}`);
  assert.equal(operationIssues.length, 0, 'resume-only never STARTs a compile');
  assert.equal(bulletins.length, 0, 'resume-only never bootstraps a row');
});

test('resumePendingCompile: a pending record (from a prior START) is resumed → consumes + publishes', { timeout: 8000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, agent, stateStore, pendingKey } = makeCtx({ ready: false });
  // Tick 1 — START via the cron path persists a pending record (agent not ready).
  await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: false });
  assert.ok(stateStore.has(pendingKey), 'a pending record was persisted by START');
  // Agent answers; resumePendingCompile (as byCycle would call it) consumes it.
  agent.ready = true;
  const res = await resumePendingCompile(ctx, { id: CID, name: 'Countermoves' }, { now: new Date(T0.getTime() + 60_000), force: false });
  assert.equal(res.kind, 'published', `resume should publish; got ${JSON.stringify(res)}`);
  assert.ok(bulletins.find((b) => b.compile_status === 'published'), 'a published bulletins row exists after resume');
  assert.ok(!stateStore.has(pendingKey), 'pending cleared after the resume publish');
});

test('cross-tick: force dedupe fires on the resume tick — identical substance since last published → no-change, no new issue', { timeout: 12000 }, async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, issuesCreated, stateStore, agent, pendingKey } = makeCtx({ ready: true });

  // First force compile (immediate-ready) publishes cycle 1.
  const r1 = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: T0, force: true });
  assert.equal(r1.kind, 'published', `first force compile should publish, got ${JSON.stringify(r1)}`);
  const publishedAfterFirst = bulletins.filter((b) => b.compile_status === 'published').length;
  const issuesAfterFirst = bulletinIssuesOf(issuesCreated).length;

  // Second force compile: START with the agent not-ready → pending(force).
  agent.ready = false;
  const r2 = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: new Date(T0.getTime() + 60_000), force: true });
  assert.equal(r2.kind, 'started');
  assert.ok(stateStore.has(pendingKey));

  // Resume tick: the agent answers with IDENTICAL substance → dedupe → no-change.
  agent.ready = true;
  const r3 = await compileBulletinForCompany(ctx, { id: CID, name: 'Countermoves' }, { now: new Date(T0.getTime() + 120_000), force: true });

  assert.equal(r3.kind, 'no-change', `identical substance must dedupe to no-change, got ${JSON.stringify(r3)}`);
  assert.equal(bulletins.filter((b) => b.compile_status === 'published').length, publishedAfterFirst, 'no new published row on dedupe');
  assert.equal(bulletinIssuesOf(issuesCreated).length, issuesAfterFirst, 'no new bulletin issue on dedupe');
  assert.ok(!stateStore.has(pendingKey), 'pending cleared after the dedupe resume');
});
