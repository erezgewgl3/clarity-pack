// test/worker/bulletin/bulletin-content-defects.test.mjs
//
// Regression tests for the FOUR defects surfaced by the Plan 03-10 v0.6.2
// closure re-drill (debug session .planning/debug/bulletin-content-defects.md,
// 2026-05-17). Each defect gets one focused regression test; the live drill
// PUBLISHED Bulletin No. 1 but the rendered /COU/bulletin page showed:
//
//   Defect A — `{{NUMBER:key}}` placeholders never substituted into
//              department prose (validateDraftSchema discarded replaceSlots'
//              return; no write-back). Fixed by `resolveDraftSlots`.
//   Defect B — blank masthead (the masthead was LLM-supplied and the agent
//              left every field empty). Fixed by the deterministic,
//              pipeline-built `buildMasthead`.
//   Defect C — `Editor-Agent compile failed for issue` WARN fired on every
//              cycle, including SUCCESSFUL ones. Fixed: the heartbeat per-issue
//              catch now logs `Editor-Agent: skipped TL;DR compile for issue`
//              at `info` severity.
//   Defect D — the compile-bulletin per-company catch swallowed publish-path
//              exceptions, reporting `job completed successfully` so the D-06
//              circuit breaker never tripped. Fixed: the catch routes an
//              unexpected throw through recordFailure + recordCycleCompileFailure.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  compilePass1,
  resolveDraftSlots,
  buildMasthead,
} from '../../../src/worker/bulletin/compile-pass-1.ts';
import { handleEditorHeartbeat } from '../../../src/worker/agents/editor.ts';
import { registerCompileBulletinJob } from '../../../src/worker/jobs/compile-bulletin.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

/** A real UUID — the shape the host's `agents.pause` requires. */
const EDITOR_UUID = '11111111-1111-4111-8111-111111111111';

// A facts table with the three keys the live drill's prose referenced.
function factsFixture() {
  return {
    completed_7d: { sql: 'x', params: [], value: 2, format: 'count' },
    open_issues: { sql: 'x', params: [], value: 3, format: 'count' },
    blocked_issues: { sql: 'x', params: [], value: 0, format: 'count' },
  };
}

// ===========================================================================
// Defect A — `{{NUMBER:key}}` placeholders substituted into department prose.
// ===========================================================================

test('Defect A: resolveDraftSlots writes resolved `{{NUMBER:key}}` prose back into the draft', () => {
  const draft = {
    masthead: {},
    actionInbox: [],
    departments: [
      {
        name: 'Production',
        items: [],
        editorialSummary:
          'Retiring {{NUMBER:completed_7d}} issues. With {{NUMBER:open_issues}} still open and {{NUMBER:blocked_issues}} blocked.',
      },
    ],
    standingNumbers: [],
    lineageThreads: [],
  };

  const resolved = resolveDraftSlots(draft, factsFixture());

  // The resolved object is the SAME draft, mutated in place.
  assert.equal(resolved, draft, 'resolveDraftSlots returns the mutated draft');
  const summary = draft.departments[0].editorialSummary;
  assert.equal(
    summary,
    'Retiring 2 issues. With 3 still open and 0 blocked.',
    'every {{NUMBER:key}} placeholder must be replaced with its formatted value',
  );
  assert.ok(
    !/\{\{NUMBER:/.test(summary),
    'no raw {{NUMBER:...}} placeholder may survive into department prose',
  );
});

test('Defect A: resolveDraftSlots also resolves placeholders in actionInbox card summaries', () => {
  const draft = {
    masthead: {},
    actionInbox: [
      {
        issueId: 'i1',
        identifier: 'COU-1',
        title: 'Decision',
        department: 'Sales',
        ageMs: 0,
        ageText: '0m',
        summary: 'There are {{NUMBER:blocked_issues}} blocked issues awaiting you.',
      },
    ],
    departments: [],
    standingNumbers: [],
    lineageThreads: [],
  };

  resolveDraftSlots(draft, factsFixture());

  assert.equal(draft.actionInbox[0].summary, 'There are 0 blocked issues awaiting you.');
});

test('Defect A: compilePass1 returns a draft whose department prose carries NO raw placeholders', async () => {
  resetCircuitBreakerState();
  const failures = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: { async pause() {} },
    db: wrapHostFaithfulDb({
      async execute(sql) {
        if (/editor_agent_failures/i.test(sql)) failures.push(sql);
        return { rowCount: 1 };
      },
    }),
  };
  // The agent emits prose with raw placeholders — exactly the live drill shape.
  const agentDraft = {
    masthead: {},
    actionInbox: [],
    departments: [
      { name: 'Builder', items: [], editorialSummary: 'Closed {{NUMBER:completed_7d}} this week.' },
    ],
    standingNumbers: [],
    lineageThreads: [],
  };

  const draft = await compilePass1(ctx, {
    companyId: 'company-1',
    cycleNumber: 1,
    factsTable: factsFixture(),
    standingNumbers: [],
    departments: ['Builder'],
    editorAgentId: EDITOR_UUID,
    llm: { async complete() { return JSON.stringify(agentDraft); } },
  });

  assert.equal(failures.length, 0, 'a draft with known slots must not record a failure');
  assert.equal(draft.departments[0].editorialSummary, 'Closed 2 this week.');
  assert.ok(
    !/\{\{NUMBER:/.test(JSON.stringify(draft)),
    'the returned draft must carry zero raw {{NUMBER:...}} placeholders anywhere',
  );
});

// ===========================================================================
// Defect B — deterministic, pipeline-built masthead (never LLM-invented).
// ===========================================================================

test('Defect B: buildMasthead populates every field deterministically from pipeline facts', () => {
  // 2026-05-07 is a Thursday; 06:30 ET is still 2026-05-07 in New York.
  const m = buildMasthead({
    cycleNumber: 47,
    compiledAt: new Date('2026-05-07T10:30:00.000Z'),
    companyName: 'Countermoves',
  });
  assert.equal(m.volume, 'I', 'v1 ships a single volume locked to I');
  assert.equal(m.number, 47);
  assert.equal(m.weekday, 'Thursday');
  assert.equal(m.dateText, '2026-05-07');
  assert.equal(m.prepareForName, 'Countermoves');
  assert.equal(m.cycleNumber, 47);
});

test('Defect B: buildMasthead falls back to "Operations" when no company name is supplied', () => {
  const m = buildMasthead({ cycleNumber: 1, compiledAt: new Date('2026-05-07T10:30:00.000Z') });
  assert.equal(m.prepareForName, 'Operations');
});

test('Defect B: compilePass1 OVERWRITES a blank agent-supplied masthead with the pipeline-built one', async () => {
  resetCircuitBreakerState();
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: { async pause() {} },
    db: wrapHostFaithfulDb({ async execute() { return { rowCount: 1 }; } }),
  };
  // The agent leaves the masthead blank — the exact live-drill failure.
  const agentDraft = {
    masthead: { volume: '', number: 0, weekday: '', dateText: '', prepareForName: '', cycleNumber: 0 },
    actionInbox: [],
    departments: [],
    standingNumbers: [],
    lineageThreads: [],
  };

  const draft = await compilePass1(ctx, {
    companyId: 'company-1',
    cycleNumber: 9,
    factsTable: {},
    standingNumbers: [],
    departments: [],
    editorAgentId: EDITOR_UUID,
    llm: { async complete() { return JSON.stringify(agentDraft); } },
    compiledAt: new Date('2026-05-07T10:30:00.000Z'),
    companyName: 'Countermoves',
  });

  assert.equal(draft.masthead.volume, 'I', 'a blank agent masthead must be replaced');
  assert.equal(draft.masthead.number, 9);
  assert.equal(draft.masthead.weekday, 'Thursday');
  assert.equal(draft.masthead.dateText, '2026-05-07');
  assert.equal(draft.masthead.prepareForName, 'Countermoves');
  assert.equal(draft.masthead.cycleNumber, 9);
});

// ===========================================================================
// Defect C — the heartbeat per-issue skip is logged as a benign info skip,
// never as `Editor-Agent compile failed for issue`.
// ===========================================================================

test('Defect C: a per-issue heartbeat skip logs an info "skipped" line, not a "compile failed" warn', async () => {
  const infoLogs = [];
  const warnLogs = [];
  const ctx = {
    logger: {
      info: (msg, meta) => infoLogs.push({ msg, meta }),
      warn: (msg, meta) => warnLogs.push({ msg, meta }),
      error() {},
    },
    // ctx.issues.get throws → the per-issue catch fires.
    issues: {
      async get() { throw new Error('host hiccup'); },
      async create() { return { id: 'x' }; },
      async list() { return []; },
      async requestWakeup() { return { queued: true }; },
      async listComments() { return []; },
    },
  };

  await handleEditorHeartbeat(ctx, {
    companyId: 'company-1',
    agentId: EDITOR_UUID,
    events: [{ entity_type: 'issue', entity_id: 'issue-77', author_id: 'someone-else' }],
  });

  assert.equal(
    warnLogs.filter((l) => /compile failed/i.test(l.msg)).length,
    0,
    'no log line may say "compile failed" for a benign per-issue skip',
  );
  const skipLine = infoLogs.find((l) => /skipped TL;DR compile/i.test(l.msg));
  assert.ok(skipLine, 'the per-issue skip must log an info "skipped TL;DR compile" line');
  assert.equal(skipLine.meta.issueId, 'issue-77', 'the skip line names the issue id it skipped');
});

test('v0.6.3-drill regression: handleEditorHeartbeat reads comments via ctx.issues.listComments — the ctx.issue typo crash is gone', async () => {
  // editor.ts read comments via `ctx.issue.comments.read` — `ctx.issue`
  // (singular) is undefined on the host PluginContext, so every heartbeat
  // TL;DR compile threw `Cannot read properties of undefined (reading
  // 'comments')`. The v0.6.3 defect-C "fix" mislabeled that crash as a benign
  // skip and only quieted the log. The real API is `ctx.issues.listComments`.
  const infoLogs = [];
  const listCommentsCalls = [];
  const ctx = {
    logger: { info: (msg, meta) => infoLogs.push({ msg, meta }), warn() {}, error() {} },
    issues: {
      async get(id) { return { id, description: 'issue body' }; },
      async listComments(issueId, companyId) {
        listCommentsCalls.push({ issueId, companyId });
        return [{ body: 'a comment body' }];
      },
      // create throws so compileTldr fails fast — no 300s LLM delivery poll.
      async create() { throw new Error('compile short-circuit'); },
      async list() { return []; },
      async requestWakeup() { return { queued: true }; },
    },
  };

  await handleEditorHeartbeat(ctx, {
    companyId: 'company-1',
    agentId: EDITOR_UUID,
    events: [{ entity_type: 'issue', entity_id: 'issue-88', author_id: 'someone-else' }],
  });

  assert.equal(listCommentsCalls.length, 1, 'comments must be read via ctx.issues.listComments');
  assert.deepEqual(listCommentsCalls[0], { issueId: 'issue-88', companyId: 'company-1' });
  const undefinedCrash = infoLogs.find((l) =>
    /Cannot read properties of undefined.*comments/i.test(l.meta?.reason ?? ''),
  );
  assert.ok(!undefinedCrash, 'the ctx.issue undefined-crash must be gone');
});

// ===========================================================================
// Defect D — an unexpected throw in the per-company compile iteration routes
// through recordFailure (D-06 breaker) instead of being swallowed as success.
// ===========================================================================

const JOB_EVENT = {
  jobKey: 'compile-bulletin',
  runId: 'r1',
  trigger: 'cron',
  scheduledAt: new Date().toISOString(),
};
const PAST = '2026-05-07T00:00:00.000Z';

// A ctx whose per-company body throws an UNEXPECTED TypeError — modelling a
// render/publish-path crash. Two injection points, both un-try-wrapped in the
// job so the throw reaches the per-company catch-all:
//
//   throwAt: 'next_due_at' — the final `UPDATE ... SET next_due_at` execute,
//       which runs AFTER `cycleNumber` is set AND after a successful publish.
//       Exercises BOTH catch-all record paths: recordFailure (D-06 breaker)
//       AND recordCycleCompileFailure (D-22 banner).
//
//   throwAt: 'max_cycle' — the `SELECT ... MAX(cycle_number)` query, the first
//       un-try-wrapped statement of the per-company body. It throws on EVERY
//       fire identically (no published row is ever written, so nothing blocks
//       the next fire) — the deterministic path for the 3-consecutive-throws
//       breaker-trip test. `cycleNumber` is still null here, so only the
//       recordFailure path fires; the breaker is what this scenario asserts.
//
// Before the Defect D fix the catch only warn-logged (→ the job reported
// `job completed successfully` and the breaker never advanced).
function makeThrowingCtx({ throwAt = 'next_due_at' } = {}) {
  const failures = [];
  const cycleFailures = [];
  const jobs = new Map();
  const bulletins = [];
  const operationIssues = [];

  function cannedDraft() {
    return {
      masthead: {},
      actionInbox: [],
      departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
      // empty standingNumbers → verifyDraft returns {ok:true} with no SQL.
      standingNumbers: [],
      lineageThreads: [],
    };
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: wrapHostFaithfulDb({
      async query(sql, params) {
        if (/SELECT next_due_at/i.test(sql)) {
          return params?.[0] === 'COU' ? [{ next_due_at: PAST }] : [];
        }
        if (/MAX\(cycle_number\)/i.test(sql)) {
          if (throwAt === 'max_cycle') {
            throw new TypeError("Cannot read properties of undefined (reading 'length')");
          }
          const max = bulletins.reduce((m, b) => Math.max(m, b.cycle_number), 0);
          return [{ max_cycle: max, max }];
        }
        if (/SELECT compile_status/i.test(sql)) {
          const row = bulletins.find(
            (b) => b.next_due_at === params?.[0] && b.content_hash === params?.[1],
          );
          return row ? [{ compile_status: row.compile_status }] : [];
        }
        if (/editor_agent_failures/i.test(sql)) return [];
        if (/bulletin_compile_failures/i.test(sql)) return [{ failure_count: 0 }];
        return [{ value: 0 }];
      },
      async execute(sql, params) {
        if (/editor_agent_failures/i.test(sql)) {
          failures.push({ agentKey: params?.[0] });
          return { rowCount: 1 };
        }
        if (/bulletin_compile_failures/i.test(sql)) {
          cycleFailures.push({ sql });
          return { rowCount: 1 };
        }
        if (/INSERT INTO .*bulletins/i.test(sql)) {
          bulletins.push({
            cycle_number: params[0],
            company_id: params[1],
            next_due_at: params[2],
            content_hash: params[4],
            compile_status: 'attempting',
          });
          return { rowCount: 1 };
        }
        if (/UPDATE[\s\S]*bulletins[\s\S]*published_issue_id/i.test(sql)) {
          const row = bulletins.find(
            (b) => b.next_due_at === params[2] && b.content_hash === params[3],
          );
          if (row) row.compile_status = 'published';
          return { rowCount: row ? 1 : 0 };
        }
        // Injection point — the final next_due_at advance throws an unexpected
        // TypeError, modelling a publish-path crash AFTER a clean publish.
        if (/UPDATE[\s\S]*bulletins[\s\S]*SET next_due_at/i.test(sql)) {
          if (throwAt === 'next_due_at') {
            throw new TypeError("Cannot read properties of undefined (reading 'length')");
          }
          return { rowCount: 1 };
        }
        return { rowCount: 1 };
      },
    }),
    jobs: { register(key, fn) { jobs.set(key, fn); } },
    companies: { async list() { return [{ id: 'COU' }]; } },
    agents: {
      async list() { return []; },
      async pause() {},
      async get(agentId, companyId) {
        return { id: agentId, agentId, companyId, status: 'idle' };
      },
      async resume() {},
      managed: {
        async reconcile() {
          return { agentId: EDITOR_UUID, agent: { id: EDITOR_UUID }, status: 'resolved' };
        },
      },
    },
    issues: {
      async create(args) {
        const created = { id: `issue-${operationIssues.length + 1}`, ...args };
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
      async requestWakeup() { return { queued: true, runId: 'run-op' }; },
      async listComments() {
        return [
          {
            id: 'op-comment',
            authorType: 'agent',
            authorAgentId: EDITOR_UUID,
            body: JSON.stringify(cannedDraft()),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
      },
      async createComment() { return { id: 'c' }; },
    },
  };
  return { ctx, failures, cycleFailures, jobs };
}

test('Defect D: an unexpected throw in the per-company iteration records a circuit-breaker failure', async () => {
  resetCircuitBreakerState();
  // throwAt 'next_due_at' — the crash lands after a clean publish, so the
  // catch-all exercises BOTH the recordFailure and the recordCycleCompileFailure
  // paths.
  const { ctx, failures, cycleFailures, jobs } = makeThrowingCtx({ throwAt: 'next_due_at' });
  registerCompileBulletinJob(ctx);

  // The job must NOT throw (per-company isolation) — but it must also NOT
  // swallow the failure silently.
  await jobs.get('compile-bulletin')(JOB_EVENT);

  assert.ok(
    failures.length >= 1,
    'an unexpected per-company throw must append a recordFailure audit row',
  );
  assert.equal(
    failures[0].agentKey,
    'bulletin-compile',
    'the failure must be tagged with the bulletin-compile circuit-breaker key',
  );
  assert.ok(
    cycleFailures.length >= 1,
    'the throw must also record a cycle compile failure for the D-22 banner',
  );
});

test('Defect D: 3 consecutive unexpected throws trip the D-06 circuit breaker (agents.pause fires)', async () => {
  resetCircuitBreakerState();
  // throwAt 'max_cycle' — every fire throws identically at the same un-wrapped
  // seam, with no published row written, so three fires deliver three clean
  // catch-all failures. Before the Defect D fix all three were swallowed as
  // success and `paused` stayed 0.
  const { ctx, jobs } = makeThrowingCtx({ throwAt: 'max_cycle' });
  let paused = 0;
  ctx.agents.pause = async () => { paused += 1; };
  registerCompileBulletinJob(ctx);
  const fn = jobs.get('compile-bulletin');

  await fn(JOB_EVENT);
  await fn(JOB_EVENT);
  await fn(JOB_EVENT);

  assert.equal(
    paused,
    1,
    'three consecutive swallowed-before-this-fix throws must now trip the breaker exactly once',
  );
});
