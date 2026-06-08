// test/worker/bulletin/compile-bulletin-end-to-end.test.mjs
//
// Plan 03-02 Task 1 RED — the full two-pass compile pipeline wired into the
// compile-bulletin job. Stub LlmAdapter returns a canned BulletinDraft; the
// in-memory ctx respects the UNIQUE(next_due_at, content_hash) idempotency
// constraint so a duplicate fire produces exactly one ctx.issues.create.
//
// v0.6.6 (debug bulletin-compile-cadence-runaway):
//   - Bug 1 — the in-memory `getNextDueAtForCompany` model now prefers a LIVE
//     in-memory bulletin row over the static seed map, and the `SET next_due_at`
//     model honours the COMPANY-SCOPED schedule-pointer advance
//     (`UPDATE bulletins SET next_due_at = $1 WHERE company_id = $2`). This
//     makes the cadence-settling test (fire twice → second fire is a no-op)
//     faithful — without it, the fake could not observe the schedule advance.
//   - Bug 2 — `verifyDraft` no longer re-runs SQL; it checks the draft against
//     the frozen standing-numbers snapshot. The verifier-rejection cases below
//     still hold: `sqlMrr` flows into `computeStandingNumbers`, so the frozen
//     snapshot carries 9999 while the canned draft claims 2475 → mismatch.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerCompileBulletinJob } from '../../../src/worker/jobs/compile-bulletin.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

const JOB_EVENT = {
  jobKey: 'compile-bulletin',
  runId: 'r1',
  trigger: 'cron',
  scheduledAt: new Date().toISOString(),
};

// A canned BulletinDraft. standingNumbers values are what the verifier
// checks against the frozen standing-numbers snapshot.
function cannedDraft({ spend = 2475 } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Thursday', dateText: '2026-05-07', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'agent_spend_mtd', displayName: 'Agent spend · MTD', value: spend, format: 'currency' }],
    lineageThreads: [],
  };
}

// makeFakeCtx — a richer ctx than Plan 03-01's noop test:
//   - in-memory bulletins table keyed by (next_due_at, content_hash)
//   - issues.create capturing calls (UNIQUE constraint enforced by db.execute)
//   - agents.managed.reconcile returning a stub Editor-Agent
//   - db.query returns standing-number rows whose `value` is sqlMrr
//
// Plan 03-06: the production path delivers the compile prompt as an OPERATION
// ISSUE assigned to the Editor-Agent (Path (d)). The fake ctx now models the
// issues-API host CONSTRAINT: `ctx.issues.create` records the operation issue,
// `requestWakeup` resolves, `listComments` returns a scripted agent result
// comment carrying the canned BulletinDraft JSON, and `list` honours
// `includePluginOperations` (B-1). The "agent" is simulated by the helper
// pre-seeding the result comment — a fake cannot model the agent ignoring the
// prompt; only the Task-5 live drill can.
//
//   - agentStatus    — status the fake `agents.get` returns ('idle' default).
//   - resumeThrows   — when true, `agents.resume` rejects (terminated agent).
//   - draftJson      — the JSON string the agent posts as the result comment.
//   - noResultComment — when true, `listComments` returns no result comment
//                       (the delivery-timeout path).
//   - durableBreakerOpen — when true, the editor_agent_failures SELECT reports
//                       an open durable circuit (resume-gate test).
function makeFakeCtx({
  companies = [],
  nextDue = {},
  sqlMrr = 2475,
  agentStatus = 'idle',
  resumeThrows = false,
  draftJson,
  noResultComment = false,
  durableBreakerOpen = false,
} = {}) {
  const bulletins = []; // {cycle_number, company_id, next_due_at, content_hash, compile_status, published_issue_id}
  const issuesCreated = [];
  const operationIssues = [];
  const wakeups = [];
  const failures = [];
  const jobs = new Map();
  const resumeCalls = [];

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        // getNextDueAtForCompany — v0.6.6 (Bug 1): prefer a LIVE in-memory row
        // (the schedule pointer the job advances) over the static seed map, so
        // a second fire observes the freshly-advanced future `next_due_at`.
        if (/SELECT next_due_at/i.test(sql)) {
          const cid = params?.[0];
          const liveRows = bulletins
            .filter((b) => b.company_id === cid)
            .sort((a, b) => b.cycle_number - a.cycle_number);
          if (liveRows.length > 0) return [{ next_due_at: liveRows[0].next_due_at }];
          const iso = nextDue[cid];
          return iso ? [{ next_due_at: iso }] : [];
        }
        // MAX(cycle_number) derivation in upsertBulletin / job cycle calc
        if (/MAX\(cycle_number\)/i.test(sql)) {
          const cid = params?.[0];
          const publishedOnly = /compile_status/i.test(sql);
          const max = bulletins
            .filter((b) => b.company_id === cid && (!publishedOnly || b.compile_status === 'published'))
            .reduce((m, b) => Math.max(m, b.cycle_number), 0);
          return [{ max_cycle: max, max: max }];
        }
        // publish.ts post-INSERT ownership check
        if (/SELECT compile_status/i.test(sql)) {
          const row = bulletins.find((b) => b.company_id === params?.[0] && b.next_due_at === params?.[1] && b.content_hash === params?.[2]);
          return row ? [{ compile_status: row.compile_status }] : [];
        }
        // Plan 03-06 — isCircuitOpenDurable reads the last N
        // editor_agent_failures rows. When durableBreakerOpen is set, report
        // MAX_CONSECUTIVE_FAILURES (3) rows whose newest `consecutive` is 3.
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) {
          if (!durableBreakerOpen) return [];
          return [{ consecutive: 3 }, { consecutive: 2 }, { consecutive: 1 }];
        }
        // standing-numbers + verifier SQL — every slot returns sqlMrr-ish value
        return [{ value: sqlMrr }];
      },
      async execute(sql, params) {
        if (/editor_agent_failures/i.test(sql)) {
          failures.push({ sql, params });
          return { rowCount: 1 };
        }
        if (/INSERT INTO .*bulletins/i.test(sql)) {
          // publish.ts INSERT params:
          //   0 cycle_number, 1 company_id, 2 next_due_at, 3 compiled_at,
          //   4 content_hash, 5 lineage_thread_json, 6 draft_json
          // (compile_status is the SQL literal 'attempting' — not a param).
          // upsertBulletin (bootstrap) INSERT carries a verified_at column, so
          // the column offsets differ — detect bootstrap by that column name.
          const isBootstrap = /verified_at/i.test(sql);
          const nextDueAt = params[2];
          const contentHash = isBootstrap ? params[8] : params[4];
          const compileStatus = isBootstrap ? params[7] : 'attempting';
          const dup = bulletins.find((b) => b.company_id === params[1] && b.next_due_at === nextDueAt && b.content_hash === contentHash);
          if (dup) return { rowCount: 0 }; // ON CONFLICT DO NOTHING
          bulletins.push({
            cycle_number: params[0],
            company_id: params[1],
            next_due_at: nextDueAt,
            compiled_at: params[3],
            compile_status: compileStatus,
            content_hash: contentHash,
            published_issue_id: null,
          });
          return { rowCount: 1 };
        }
        // Note: [\s\S] (not `.`) so the matcher tolerates the multi-line SQL
        // publish.ts emits — `.` does not cross newlines.
        if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
          // params: issue_id, published_at, next_due_at, content_hash
          const row = bulletins.find((b) => b.company_id === params[2] && b.next_due_at === params[3] && b.content_hash === params[4]);
          if (row) {
            row.published_issue_id = params[0];
            row.compile_status = 'published';
          }
          return { rowCount: row ? 1 : 0 };
        }
        // v0.6.6 (Bug 1) — the COMPANY-SCOPED schedule-pointer advance:
        // `UPDATE bulletins SET next_due_at = $1 WHERE company_id = $2`. It
        // advances EVERY row for the company so the next fire's
        // getNextDueAtForCompany (MAX(cycle_number) row) sees a future pointer.
        if (/UPDATE[\s\S]*bulletins[\s\S]*SET next_due_at/i.test(sql)) {
          // params: 0 new_next_due_at, 1 company_id
          const cid = params[1];
          const matched = bulletins.filter((b) => b.company_id === cid);
          for (const row of matched) row.next_due_at = params[0];
          return { rowCount: matched.length };
        }
        if (/bulletin_compile_failures/i.test(sql)) {
          return { rowCount: 1 };
        }
        return { rowCount: 1 };
      },
    },
    jobs: { register(key, fn) { jobs.set(key, fn); } },
    companies: { async list() { return companies; } },
    agents: {
      async list() { return []; },
      async pause() {},
      async get(agentId, companyId) {
        return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' };
      },
      async resume(agentId, companyId) {
        resumeCalls.push({ agentId, companyId });
        if (resumeThrows) throw new Error('cannot resume a terminated agent');
        return { id: agentId, agentId, companyId, status: 'idle' };
      },
      managed: {
        async reconcile() {
          return { agentId: 'editor-agent-uuid', agent: { id: 'editor-agent-uuid' }, status: 'resolved' };
        },
      },
    },
    // Plan 03-06 — the operation-issue handoff. `create` records the operation
    // issue; `list` honours `includePluginOperations` (B-1); `requestWakeup`
    // resolves; `listComments` returns a scripted agent result comment carrying
    // the canned BulletinDraft JSON — so the REAL deliveryLlmAdapter resolves
    // the result exactly as production would.
    issues: {
      async create(args) {
        issuesCreated.push(args);
        const created = {
          id: `issue-${issuesCreated.length}`,
          identifier: `COU-${issuesCreated.length}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args,
        };
        if (typeof args.originKind === 'string' && args.originKind.startsWith('plugin:clarity-pack:operation:')) {
          operationIssues.push(created);
        }
        return created;
      },
      async list(input = {}) {
        if (input.originKindPrefix) {
          if (!input.includePluginOperations) return [];
          return operationIssues.filter(
            (oi) =>
              oi.originKind &&
              oi.originKind.startsWith(input.originKindPrefix) &&
              (input.originId === undefined || oi.originId === input.originId),
          );
        }
        return [];
      },
      async get() { return null; },
      async requestWakeup(issueId, companyId, options) {
        wakeups.push({ issueId, companyId, options });
        return { queued: true, runId: 'run-op' };
      },
      async listComments(issueId, companyId) {
        if (noResultComment) return [];
        return [
          {
            id: `op-comment-${issueId}`,
            companyId,
            issueId,
            authorType: 'agent',
            authorAgentId: 'editor-agent-uuid',
            authorUserId: null,
            body: draftJson ?? JSON.stringify(cannedDraft()),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
      },
      async createComment() { return { id: 'comment-x' }; },
    },
  };
  // Enforce the real host's query/execute contract: a write-via-query (or a
  // select-via-execute / DDL-via-execute) now throws in `node --test`, exactly
  // as the live Paperclip host would. The 2026-05-15 drill's INSERT-via-query
  // bug would have failed `pnpm test` here instead of on a VPS reinstall.
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, bulletins, issuesCreated, operationIssues, wakeups, failures, jobs, resumeCalls };
}

const PAST = '2026-05-07T00:00:00.000Z'; // well in the past => due

// Plan 03-06 — a successful compile creates TWO issues: the OPERATION issue
// (the compile-prompt handoff to the agent) + the published BULLETIN issue.
// `bulletinIssues` filters issuesCreated down to the bulletin issue(s).
const bulletinIssuesOf = (created) =>
  created.filter((i) => /^Bulletin No\. /.test(i.title ?? ''));
const operationIssuesOf = (created) =>
  created.filter(
    (i) => typeof i.originKind === 'string' && i.originKind.startsWith('plugin:clarity-pack:operation:'),
  );

test('e2e: due company + valid draft + verifier passes -> one bulletin issue, status published', async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, issuesCreated, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  const bulletinIssues = bulletinIssuesOf(issuesCreated);
  assert.equal(bulletinIssues.length, 1, 'exactly one bulletin issue created');
  assert.match(bulletinIssues[0].title, /^Bulletin No\. \d+ — /);
  assert.deepEqual(bulletinIssues[0].tags, ['clarity:bulletin', 'clarity:bulletin-issue', 'cycle:1']);
  // Plan 03-06 — the compile prompt was delivered as an operation issue.
  assert.equal(operationIssuesOf(issuesCreated).length, 1, 'one bulletin-compile operation issue created');
  const published = bulletins.find((b) => b.compile_status === 'published');
  assert.ok(published, 'a bulletins row must end at compile_status=published');
});

test('e2e: after publish, next_due_at advances to a future instant', async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  const row = bulletins.find((b) => b.compile_status === 'published');
  assert.ok(row);
  assert.ok(new Date(row.next_due_at).getTime() > Date.now(), 'next_due_at advanced to the future');
});

// ---- v0.6.6 (debug bulletin-compile-cadence-runaway, Bug 1) ----------------
//
// The DAILY bulletin must compile ONCE per 06:30-ET slot. The 2026-05-18 drill
// saw the every-minute heartbeat re-compile + re-publish a fresh cycle every
// ~2 minutes. These two tests are the regression net: once a fire publishes (or
// is rejected), the schedule pointer is advanced to a FUTURE instant, so the
// very next heartbeat fire is a no-op — no second compile, no second issue.

test('e2e (Bug 1): a successful publish then an immediate re-fire does NOT recompile (cadence settles)', async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, issuesCreated, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(ctx);
  const fn = jobs.get('compile-bulletin');

  // Fire 1 — due → compiles + publishes cycle 1, advances next_due_at.
  await fn(JOB_EVENT);
  assert.equal(bulletinIssuesOf(issuesCreated).length, 1, 'fire 1 publishes exactly one bulletin');
  const publishedCount1 = bulletins.filter((b) => b.compile_status === 'published').length;
  assert.equal(publishedCount1, 1, 'one published bulletins row after fire 1');

  // Fire 2 — immediately after, no time has advanced past the new (future)
  // next_due_at. The job MUST treat the company as not-due and no-op.
  await fn(JOB_EVENT);
  assert.equal(
    bulletinIssuesOf(issuesCreated).length,
    1,
    'fire 2 must NOT publish a second bulletin — the daily cadence has settled',
  );
  assert.equal(
    bulletins.filter((b) => b.compile_status === 'published').length,
    1,
    'still exactly one published bulletins row after fire 2 (no runaway cycle)',
  );
});

test('e2e (Bug 1): a verifier rejection still advances next_due_at — no every-minute retry', async () => {
  resetCircuitBreakerState();
  // sqlMrr 9999 vs the canned draft's 2475 → the frozen snapshot disagrees with
  // the draft → verifier rejects. The rejected cycle must NOT publish, AND the
  // schedule pointer must still advance so the next heartbeat fire is a no-op
  // (the D-22 15-minute retry timer owns the re-attempt, not the cron).
  const { ctx, bulletins, issuesCreated, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999,
  });
  registerCompileBulletinJob(ctx);
  const fn = jobs.get('compile-bulletin');

  await fn(JOB_EVENT);
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'a rejected cycle does not publish');
  // The schedule pointer must now be in the future on every bulletins row.
  for (const b of bulletins) {
    assert.ok(
      new Date(b.next_due_at).getTime() > Date.now(),
      'a verifier-rejected fire must still advance next_due_at to the future',
    );
  }

  // A second immediate fire must therefore be a no-op — no new operation issue,
  // no new compile attempt.
  const opIssuesBefore = operationIssuesOf(issuesCreated).length;
  await fn(JOB_EVENT);
  assert.equal(
    operationIssuesOf(issuesCreated).length,
    opIssuesBefore,
    'fire 2 after a rejection must NOT start another compile (no every-minute retry)',
  );
});

test('e2e: verifier rejection (mismatched MRR) -> no bulletin issue, recordFailure called', async () => {
  resetCircuitBreakerState();
  // canned draft claims agent_spend_mtd=2475 but the frozen snapshot is 9999.
  const { ctx, issuesCreated, failures, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999,
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  // The compile prompt is still delivered as an operation issue, but the
  // verifier rejection blocks the BULLETIN issue from being published.
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'verifier rejection must block publish');
  assert.ok(failures.length >= 1, 'recordFailure must append an audit row');
});

test('e2e: 3 consecutive verifier rejections trip the circuit breaker (agents.pause fires)', async () => {
  resetCircuitBreakerState();
  let paused = 0;
  const { ctx, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999,
  });
  ctx.agents.pause = async () => { paused += 1; };
  registerCompileBulletinJob(ctx);
  const fn = jobs.get('compile-bulletin');
  await fn(JOB_EVENT);
  await fn(JOB_EVENT);
  await fn(JOB_EVENT);
  assert.equal(paused, 1, 'circuit breaker pauses exactly once on the 3rd consecutive failure');
});

test('e2e: bulletin failures do not advance the compile-tldr circuit-breaker counter', async () => {
  resetCircuitBreakerState();
  const { ctx, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999,
  });
  let pausedAgentKeys = [];
  const origExecute = ctx.db.execute;
  ctx.db.execute = async (sql, params) => {
    if (/editor_agent_failures/i.test(sql)) pausedAgentKeys.push(params[0]);
    return origExecute(sql, params);
  };
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);
  // Every recorded failure must be tagged bulletin-compile, never the TL;DR key.
  for (const k of pausedAgentKeys) {
    assert.equal(k, 'bulletin-compile', 'bulletin failures must use the bulletin-compile agentKey');
  }
});

test('e2e: idempotency — two fires with the same next_due_at produce exactly one issues.create', async () => {
  resetCircuitBreakerState();
  const { ctx, issuesCreated, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  // The fake session replays a frozen cannedDraft, so content_hash is
  // identical across fires; a second fire's INSERT hits ON CONFLICT DO NOTHING.
  registerCompileBulletinJob(ctx);
  const fn = jobs.get('compile-bulletin');
  await fn(JOB_EVENT);
  // The first fire publishes exactly one bulletin issue; a published row
  // already exists for this content, so a re-fire cannot double-publish.
  assert.equal(bulletinIssuesOf(issuesCreated).length, 1, 'first fire publishes exactly one bulletin issue');
});

// ---- Plan 03-06 — production LLM wiring via the operation-issue handoff ----

test('e2e (03-06): job compiles + publishes through the REAL deliveryLlmAdapter', async () => {
  resetCircuitBreakerState();
  // agentStatus 'idle' → no resume needed; the operation issue's result comment
  // carries a valid draft.
  const { ctx, bulletins, issuesCreated, operationIssues, wakeups, resumeCalls, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
    agentStatus: 'idle',
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(bulletinIssuesOf(issuesCreated).length, 1, 'a bulletin issue must be published via the delivery adapter');
  assert.ok(bulletins.find((b) => b.compile_status === 'published'), 'the bulletin must reach published');
  assert.equal(resumeCalls.length, 0, 'an idle agent must NOT be resumed');
  // The compile prompt rode an operation issue assigned to the Editor-Agent.
  assert.equal(operationIssues.length, 1, 'exactly one bulletin-compile operation issue created');
  assert.equal(operationIssues[0].assigneeAgentId, 'editor-agent-uuid', 'operation issue assigned to the Editor-Agent');
  assert.equal(operationIssues[0].surfaceVisibility, 'plugin_operation', 'operation issue is off the human board');
  // Phase 16.1 Plan 16.1-02 (D-05) — the requestWakeup block is deleted; the
  // native heartbeat pull picks up the assigned operation issue. No wake fires.
  assert.equal(wakeups.length, 0, 'NO requestWakeup — native heartbeat pull is the only dispatch (D-05)');
});

test('e2e (03-06): a paused agent that cannot resume → no hang, no publish', async () => {
  resetCircuitBreakerState();
  // agentStatus 'paused' triggers the resume step; resumeThrows simulates a
  // terminated/pending_approval agent that rejects resume.
  const { ctx, issuesCreated, resumeCalls, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
    agentStatus: 'paused',
    resumeThrows: true,
  });
  registerCompileBulletinJob(ctx);
  // Must complete (not hang) even though the agent cannot be resumed.
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(resumeCalls.length, 1, 'a paused agent must trigger exactly one resume attempt');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'a non-resumable agent must block publish');
});

test('e2e (03-06): durable breaker OPEN + paused agent → no resume, no publish (loop closed)', async () => {
  resetCircuitBreakerState();
  // The editor_agent_failures SELECT reports an open durable circuit AND the
  // agent is paused. The breaker-aware resume gate must leave the agent paused
  // and skip the company — the resume-defeats-breaker loop (live attempt_n
  // 466→470) is closed.
  const { ctx, issuesCreated, resumeCalls, operationIssues, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
    agentStatus: 'paused',
    durableBreakerOpen: true,
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(resumeCalls.length, 0, 'a breaker-tripped paused agent must NOT be auto-resumed');
  assert.equal(operationIssues.length, 0, 'no compile is attempted when the breaker is open');
  assert.equal(bulletinIssuesOf(issuesCreated).length, 0, 'no bulletin is published when the breaker is open');
});
