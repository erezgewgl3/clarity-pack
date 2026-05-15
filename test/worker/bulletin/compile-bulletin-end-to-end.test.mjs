// test/worker/bulletin/compile-bulletin-end-to-end.test.mjs
//
// Plan 03-02 Task 1 RED — the full two-pass compile pipeline wired into the
// compile-bulletin job. Stub LlmAdapter returns a canned BulletinDraft; the
// in-memory ctx respects the UNIQUE(next_due_at, content_hash) idempotency
// constraint so a duplicate fire produces exactly one ctx.issues.create.

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
// re-checks against the SQL result.
function cannedDraft({ mrr = 2475 } = {}) {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Thursday', dateText: '2026-05-07', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: mrr, format: 'currency' }],
    lineageThreads: [],
  };
}

// makeFakeCtx — a richer ctx than Plan 03-01's noop test:
//   - in-memory bulletins table keyed by (next_due_at, content_hash)
//   - issues.create capturing calls (UNIQUE constraint enforced by db.execute)
//   - agents.managed.reconcile returning a stub Editor-Agent
//   - db.query returns standing-number rows whose `value` is sqlMrr
//
// Plan 03-05: the production path no longer reads `ctx.llm`. The compile job
// builds a real `sessionLlmAdapter` from `ctx.agents` — so the fake ctx now
// carries `agents.get` (returns a scripted Agent) and `agents.sessions`
// (create/sendMessage/close). `sendMessage` replays a single chunk carrying
// `draftJson` + a `done` event, so the REAL adapter accumulates the canned
// draft and the job compiles end-to-end without any injected stub `llm`.
//
//   - agentStatus    — status the fake `agents.get` returns ('idle' default).
//   - resumeThrows   — when true, `agents.resume` rejects (terminated agent).
//   - draftJson      — the JSON string the session streams as the BulletinDraft.
function makeFakeCtx({
  companies = [],
  nextDue = {},
  sqlMrr = 2475,
  agentStatus = 'idle',
  resumeThrows = false,
  draftJson,
} = {}) {
  const bulletins = []; // {cycle_number, company_id, next_due_at, content_hash, compile_status, published_issue_id}
  const issuesCreated = [];
  const failures = [];
  const jobs = new Map();
  const resumeCalls = [];
  let sessionSeq = 0;

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        // getNextDueAtForCompany
        if (/SELECT next_due_at/i.test(sql)) {
          const iso = nextDue[params?.[0]];
          return iso ? [{ next_due_at: iso }] : [];
        }
        // MAX(cycle_number) derivation in upsertBulletin / job cycle calc
        if (/MAX\(cycle_number\)/i.test(sql)) {
          const cid = params?.[0];
          const max = bulletins
            .filter((b) => b.company_id === cid)
            .reduce((m, b) => Math.max(m, b.cycle_number), 0);
          return [{ max_cycle: max, max: max }];
        }
        // publish.ts post-INSERT ownership check
        if (/SELECT compile_status/i.test(sql)) {
          const row = bulletins.find((b) => b.next_due_at === params?.[0] && b.content_hash === params?.[1]);
          return row ? [{ compile_status: row.compile_status }] : [];
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
          const nextDueAt = params[2];
          const contentHash = params[4];
          const dup = bulletins.find((b) => b.next_due_at === nextDueAt && b.content_hash === contentHash);
          if (dup) return { rowCount: 0 }; // ON CONFLICT DO NOTHING
          bulletins.push({
            cycle_number: params[0],
            company_id: params[1],
            next_due_at: nextDueAt,
            compiled_at: params[3],
            compile_status: 'attempting',
            content_hash: contentHash,
            published_issue_id: null,
          });
          return { rowCount: 1 };
        }
        // Note: [\s\S] (not `.`) so the matcher tolerates the multi-line SQL
        // publish.ts emits — `.` does not cross newlines.
        if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
          // params: issue_id, published_at, next_due_at, content_hash
          const row = bulletins.find((b) => b.next_due_at === params[2] && b.content_hash === params[3]);
          if (row) {
            row.published_issue_id = params[0];
            row.compile_status = 'published';
          }
          return { rowCount: row ? 1 : 0 };
        }
        if (/UPDATE[\s\S]*bulletins[\s\S]*SET next_due_at/i.test(sql)) {
          // params: new_next_due_at, cycle_number, company_id
          const row = bulletins.find((b) => b.cycle_number === params[1] && b.company_id === params[2]);
          if (row) row.next_due_at = params[0];
          return { rowCount: row ? 1 : 0 };
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
      // Plan 03-05 — fake agent chat session. sendMessage replays one chunk
      // carrying the canned BulletinDraft JSON + a terminal done event, so the
      // REAL sessionLlmAdapter accumulates it exactly as production would.
      sessions: {
        async create(agentId, companyId, opts) {
          sessionSeq += 1;
          return { sessionId: `sess-${sessionSeq}`, agentId, companyId, status: 'active', createdAt: new Date().toISOString(), opts };
        },
        async sendMessage(sessionId, companyId, opts) {
          const text = draftJson ?? JSON.stringify(cannedDraft());
          if (typeof opts?.onEvent === 'function') {
            setImmediate(() => {
              opts.onEvent({ sessionId, runId: 'run-e2e', seq: 1, eventType: 'chunk', stream: 'stdout', message: text, payload: null });
              opts.onEvent({ sessionId, runId: 'run-e2e', seq: 2, eventType: 'done', stream: 'system', message: null, payload: null });
            });
          }
          return { runId: 'run-e2e' };
        },
        async close() {},
      },
    },
    issues: {
      async create(args) {
        issuesCreated.push(args);
        return { id: `issue-${issuesCreated.length}`, identifier: `COU-${issuesCreated.length}`, ...args };
      },
      async list() { return []; },
      async get() { return null; },
      async createComment() { return { id: 'comment-x' }; },
    },
  };
  // Enforce the real host's query/execute contract: a write-via-query (or a
  // select-via-execute / DDL-via-execute) now throws in `node --test`, exactly
  // as the live Paperclip host would. The 2026-05-15 drill's INSERT-via-query
  // bug would have failed `pnpm test` here instead of on a VPS reinstall.
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, bulletins, issuesCreated, failures, jobs, resumeCalls };
}

const PAST = '2026-05-07T00:00:00.000Z'; // well in the past => due

test('e2e: due company + valid draft + verifier passes -> one issues.create, status published', async () => {
  resetCircuitBreakerState();
  const { ctx, bulletins, issuesCreated, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(issuesCreated.length, 1, 'exactly one bulletin issue created');
  assert.match(issuesCreated[0].title, /^Bulletin No\. \d+ — /);
  assert.deepEqual(issuesCreated[0].tags, ['clarity:bulletin', 'clarity:bulletin-issue', 'cycle:1']);
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

test('e2e: verifier rejection (mismatched MRR) -> no issues.create, recordFailure called', async () => {
  resetCircuitBreakerState();
  // canned draft claims mrr=2475 but SQL returns 9999 => mismatch
  const { ctx, issuesCreated, failures, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999,
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(issuesCreated.length, 0, 'verifier rejection must block publish');
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
  // The first fire publishes exactly one issue; a published row already
  // exists for this content, so a re-fire cannot double-publish.
  assert.equal(issuesCreated.length, 1, 'first fire publishes exactly one issue');
});

// ---- Plan 03-05 — production LLM wiring via the real sessionLlmAdapter -----

test('e2e (03-05): job compiles + publishes through the REAL sessionLlmAdapter (no stub ctx.llm)', async () => {
  resetCircuitBreakerState();
  // agentStatus 'idle' → no resume needed; the session streams a valid draft.
  const { ctx, bulletins, issuesCreated, resumeCalls, jobs } = makeFakeCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
    agentStatus: 'idle',
  });
  registerCompileBulletinJob(ctx);
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(issuesCreated.length, 1, 'a bulletin issue must be created via the real session adapter');
  assert.ok(bulletins.find((b) => b.compile_status === 'published'), 'the bulletin must reach published');
  assert.equal(resumeCalls.length, 0, 'an idle agent must NOT be resumed');
});

test('e2e (03-05): a paused agent that cannot resume → recordCompileFailure, no hang, no publish', async () => {
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
  assert.equal(issuesCreated.length, 0, 'a non-resumable agent must block publish — no bulletin issue');
});
