// test/worker/bulletin/bulletin-compile-now.test.mjs
//
// Quick task 260528-nns — on-demand "Generate bulletin now" action.
//
// `bulletin.compileNow` reuses the SAME per-company compile pipeline as the
// daily cron (the extracted `compileBulletinForCompany`) with `force:true`:
//   - bypasses the `now >= next_due_at` due-gate,
//   - leaves the daily schedule pointer (next_due_at) UNTOUCHED (no advance),
//   - dedupes on content_hash: identical to the last published bulletin →
//     return { kind:'no-change' } and write NO new row,
//   - graceful error when the Editor-Agent is paused/unavailable.
//
// The fake ctx mirrors compile-bulletin-end-to-end.test.mjs (operation-issue
// handoff + host-faithful db) and adds: actions.register, companies.list, and
// the opt-in-guard clarity_user_prefs probe (opted-in).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerBulletinCompileNow } from '../../../src/worker/handlers/bulletin-compile-now.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const CID = 'COU';
const FUTURE = '2999-01-01T03:30:00.000Z'; // schedule pointer well in the future

function cannedDraft({ spend = 2475 } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Thursday', dateText: '2026-05-28', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: spend, format: 'currency' }],
    lineageThreads: [],
  };
}

function makeFakeCtx({
  sqlMrr = 2475,
  agentStatus = 'idle',
  resumeThrows = false,
  draftJson,
  noResultComment = false,
  optedIn = true,
  seedNextDue = FUTURE,
} = {}) {
  const bulletins = []; // {cycle_number, company_id, next_due_at, content_hash, compile_status, published_issue_id, published_at}
  const issuesCreated = [];
  const operationIssues = [];
  const actions = new Map();
  const resumeCalls = [];

  // Seed a schedule pointer row (status 'pending', cycle 0) so getNextDueAt
  // returns a FUTURE pointer — the on-demand compile must NOT move it.
  if (seedNextDue) {
    bulletins.push({
      cycle_number: 0,
      company_id: CID,
      next_due_at: seedNextDue,
      content_hash: '__bootstrap__',
      compile_status: 'pending',
      published_issue_id: null,
      published_at: null,
    });
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00Z' }] : [];
        }
        if (/SELECT next_due_at/i.test(sql)) {
          const cid = params?.[0];
          const live = bulletins.filter((b) => b.company_id === cid).sort((a, b) => b.cycle_number - a.cycle_number);
          return live.length ? [{ next_due_at: live[0].next_due_at }] : [];
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
        // publish.ts post-INSERT ownership check (compile_status + content_hash).
        if (/SELECT compile_status/i.test(sql)) {
          const row = bulletins.find((b) => b.company_id === params?.[0] && b.next_due_at === params?.[1] && b.content_hash === params?.[2]);
          return row ? [{ compile_status: row.compile_status }] : [];
        }
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) {
          return [];
        }
        return [{ value: sqlMrr }];
      },
      async execute(sql, params) {
        if (/INSERT INTO .*bulletins/i.test(sql)) {
          const isBootstrap = /verified_at/i.test(sql);
          const nextDueAt = params[2];
          // publish.ts INSERT cols: 0 cycle,1 company,2 next_due,3 compiled_at,
          // 4 content_hash,5 lineage_json,6 draft_json. Bootstrap (upsertBulletin)
          // carries verified_at so its content_hash is param[8], draft_json param[10].
          const contentHash = isBootstrap ? params[8] : params[4];
          const draftJson = isBootstrap ? params[10] : params[6];
          const compileStatus = isBootstrap ? params[7] : 'attempting';
          const dup = bulletins.find((b) => b.company_id === params[1] && b.next_due_at === nextDueAt && b.content_hash === contentHash);
          if (dup) return { rowCount: 0 };
          bulletins.push({
            cycle_number: params[0],
            company_id: params[1],
            next_due_at: nextDueAt,
            compiled_at: params[3],
            compile_status: compileStatus,
            content_hash: contentHash,
            draft_json: draftJson,
            published_issue_id: null,
            published_at: null,
          });
          return { rowCount: 1 };
        }
        if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
          const row = bulletins.find((b) => b.company_id === params[2] && b.next_due_at === params[3] && b.content_hash === params[4]);
          if (row) { row.published_issue_id = params[0]; row.published_at = params[1]; row.compile_status = 'published'; }
          return { rowCount: row ? 1 : 0 };
        }
        if (/UPDATE[\s\S]*bulletins[\s\S]*SET next_due_at/i.test(sql)) {
          // The schedule-pointer advance. On-demand (force) MUST NEVER hit this.
          const cid = params[1];
          const matched = bulletins.filter((b) => b.company_id === cid);
          for (const r of matched) r.next_due_at = params[0];
          return { rowCount: matched.length };
        }
        if (/bulletin_compile_failures/i.test(sql) || /editor_agent_failures/i.test(sql)) {
          return { rowCount: 1 };
        }
        return { rowCount: 1 };
      },
    },
    actions: { register(key, fn) { actions.set(key, fn); } },
    companies: { async list() { return [{ id: CID, name: 'Countermoves' }]; } },
    config: { async get() { return {}; } },
    agents: {
      async list() { return []; },
      async pause() {},
      async get(agentId, companyId) { return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' }; },
      async resume(agentId, companyId) {
        resumeCalls.push({ agentId, companyId });
        if (resumeThrows) throw new Error('cannot resume a terminated agent');
        return { id: agentId, status: 'idle' };
      },
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
      async listComments(issueId, companyId) {
        if (noResultComment) return [];
        return [{ id: `op-${issueId}`, companyId, issueId, authorType: 'agent', authorAgentId: 'editor-agent-uuid', authorUserId: null, body: draftJson ?? JSON.stringify(cannedDraft()), createdAt: new Date(), updatedAt: new Date() }];
      },
      async createComment() { return { id: 'comment-x' }; },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  registerBulletinCompileNow(ctx);
  const handler = actions.get('bulletin.compileNow');
  return { ctx, handler, bulletins, issuesCreated, operationIssues, resumeCalls };
}

const bulletinIssuesOf = (created) => created.filter((i) => /^Bulletin No\. /.test(i.title ?? ''));

test('bulletin.compileNow — action is registered', () => {
  const { handler } = makeFakeCtx();
  assert.ok(handler, 'bulletin.compileNow registered via wrapActionHandler');
});

test('bulletin.compileNow (a) — fresh content publishes a new cycle (force bypasses the due-gate)', async () => {
  resetCircuitBreakerState();
  const { handler, bulletins, issuesCreated } = makeFakeCtx({ sqlMrr: 2475 });
  const res = await handler({ companyId: CID, userId: 'eric' });
  assert.equal(res.kind, 'published', `expected published, got ${JSON.stringify(res)}`);
  assert.equal(bulletinIssuesOf(issuesCreated).length, 1, 'exactly one bulletin issue created on demand');
  assert.ok(bulletins.find((b) => b.compile_status === 'published'), 'a published bulletins row exists');
  assert.ok(typeof res.cycleNumber === 'number' && res.cycleNumber >= 1);
});

test('bulletin.compileNow (b) — identical content dedupes: no new row, no new issue, kind:no-change', async () => {
  resetCircuitBreakerState();
  const { handler, bulletins, issuesCreated } = makeFakeCtx({ sqlMrr: 2475 });
  const first = await handler({ companyId: CID, userId: 'eric' });
  assert.equal(first.kind, 'published');
  const issuesAfterFirst = bulletinIssuesOf(issuesCreated).length;
  const publishedRowsAfterFirst = bulletins.filter((b) => b.compile_status === 'published').length;

  // Second identical compile → same content_hash as the just-published cycle.
  const second = await handler({ companyId: CID, userId: 'eric' });
  assert.equal(second.kind, 'no-change', `expected no-change, got ${JSON.stringify(second)}`);
  assert.equal(bulletinIssuesOf(issuesCreated).length, issuesAfterFirst, 'no second bulletin issue on identical content');
  assert.equal(bulletins.filter((b) => b.compile_status === 'published').length, publishedRowsAfterFirst, 'no new published row on dedupe');
  assert.ok(typeof second.cycleNumber === 'number', 'no-change carries the existing cycle number');
});

test('bulletin.compileNow (c) — paused, non-resumable agent → graceful error, no publish', async () => {
  resetCircuitBreakerState();
  const { handler, issuesCreated, resumeCalls } = makeFakeCtx({ agentStatus: 'paused', resumeThrows: true });
  const res = await handler({ companyId: CID, userId: 'eric' });
  assert.equal(res.kind, 'error', `expected error, got ${JSON.stringify(res)}`);
  assert.ok(typeof res.reason === 'string' && res.reason.length > 0, 'error carries a reason for the UI');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'no bulletin published when the agent cannot run');
  assert.equal(resumeCalls.length, 1, 'a paused agent triggers exactly one resume attempt');
});

test('bulletin.compileNow (d) — the daily next_due_at schedule pointer is UNCHANGED after an on-demand compile', async () => {
  resetCircuitBreakerState();
  const { handler, bulletins } = makeFakeCtx({ sqlMrr: 2475, seedNextDue: FUTURE });
  const res = await handler({ companyId: CID, userId: 'eric' });
  assert.equal(res.kind, 'published');
  // Every row's next_due_at must still be the seeded FUTURE pointer — the
  // on-demand path must NOT call advanceScheduleForCompany.
  for (const b of bulletins) {
    assert.equal(b.next_due_at, FUTURE, `on-demand compile must not move next_due_at (row cycle ${b.cycle_number})`);
  }
});

test('bulletin.compileNow — opted-out caller → OPT_IN_REQUIRED, no publish', async () => {
  resetCircuitBreakerState();
  const { handler, issuesCreated } = makeFakeCtx({ optedIn: false });
  const res = await handler({ companyId: CID, userId: 'eric' });
  assert.deepEqual(res, { error: 'OPT_IN_REQUIRED' });
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0);
});

test('bulletin.compileNow — missing companyId → throws', async () => {
  const { handler } = makeFakeCtx();
  await assert.rejects(() => handler({ userId: 'eric' }), /companyId required/);
});
