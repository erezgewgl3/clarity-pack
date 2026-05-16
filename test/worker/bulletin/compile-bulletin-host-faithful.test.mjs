// test/worker/bulletin/compile-bulletin-host-faithful.test.mjs
//
// Quick task 260516-gx4 Task 2 — the host-contract net for the bulletin
// compile path.
//
// `compile-bulletin-end-to-end.test.mjs` is the BEHAVIORAL regression suite
// (does the pipeline produce the right output?). This file is a different
// kind of test: it runs `registerCompileBulletinJob` against a ctx assembled
// entirely from host-faithful fakes — `wrapHostFaithfulDb` (catalogue item 1),
// host-faithful-sessions (items 2 + 4), host-faithful-agents (items 3 + 8) —
// and asserts that each host-contract trap makes the job fail OBSERVABLY
// (recordCompileFailure / no publish) rather than silently passing and only
// blowing up on a Countermoves VPS reinstall.
//
// The whole point: every assertion below corresponds to a real 2026-05-15/16
// live-drill defect. If a future change re-introduces a host-contract
// violation, THIS file goes red in `node --test`.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerCompileBulletinJob } from '../../../src/worker/jobs/compile-bulletin.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { makeHostFaithfulCompileCtx } from '../../helpers/host-faithful-ctx.mjs';

const JOB_EVENT = {
  jobKey: 'compile-bulletin',
  runId: 'r1',
  trigger: 'cron',
  scheduledAt: new Date().toISOString(),
};

const PAST = '2026-05-07T00:00:00.000Z'; // well in the past => due

// ---- Case 1 — happy path against the fully host-faithful ctx ---------------

test('host-faithful: due company + scripted valid session -> one issues.create, status published, cycle 1', async () => {
  resetCircuitBreakerState();
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(h.ctx);
  await h.jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(h.issuesCreated.length, 1, 'exactly one bulletin issue created');
  const published = h.bulletins.find((b) => b.compile_status === 'published');
  assert.ok(published, 'a bulletins row must end at compile_status=published');
  assert.equal(published.cycle_number, 1, 'first real publish is cycle 1');
});

// ---- Case 2 — bootstrap sentinel (catalogue item 7) ------------------------

test('host-faithful: a company with no prior bulletin bootstraps at cycle 0 and does NOT publish', async () => {
  resetCircuitBreakerState();
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: {}, // no prior row => bootstrap path
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(h.ctx);
  await h.jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(h.issuesCreated.length, 0, 'bootstrap fire must NOT publish');
  const bootstrap = h.bulletins.find((b) => b.cycle_number === 0);
  assert.ok(bootstrap, 'a cycle_number 0 sentinel row must be written');
  assert.equal(bootstrap.compile_status, 'pending', 'the sentinel row is pending');
  assert.equal(
    h.bulletins.filter((b) => b.compile_status === 'published').length,
    0,
    'no published row on the bootstrap fire',
  );
});

test('host-faithful: bootstrap then a due fire publishes at cycle 1 (item 7 end-to-end)', async () => {
  resetCircuitBreakerState();
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: {}, // bootstrap on the first fire
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(h.ctx);
  const fn = h.jobs.get('compile-bulletin');
  // First fire bootstraps with a far-future next_due_at — force it past-due so
  // the second fire actually compiles.
  await fn(JOB_EVENT);
  const sentinel = h.bulletins.find((b) => b.cycle_number === 0);
  sentinel.next_due_at = PAST;
  await fn(JOB_EVENT);

  const published = h.bulletins.find((b) => b.compile_status === 'published');
  assert.ok(published, 'second fire publishes');
  assert.equal(published.cycle_number, 1, 'first real publish is cycle 1, not 0');
});

// ---- Case 3 — non-UUID pause trap (catalogue item 3) -----------------------

test('host-faithful: 3 verifier rejections trip the breaker; pause receives a real UUID, not the name tag', async () => {
  resetCircuitBreakerState();
  // sqlMrr 9999 vs the canned draft's 2475 => verifier rejects every cycle.
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999,
  });
  registerCompileBulletinJob(h.ctx);
  const fn = h.jobs.get('compile-bulletin');
  // Three consecutive verifier rejections trip the D-06 breaker. The breaker
  // calls ctx.agents.pause(agentId, …). host-faithful-agents enforces item 3:
  // a non-UUID agentId would throw 'invalid input syntax for type uuid'. The
  // job MUST thread the resolved reconcile UUID — so pause does NOT throw.
  await fn(JOB_EVENT);
  await fn(JOB_EVENT);
  await fn(JOB_EVENT);

  const pauseCalls = h.agentCalls.pause;
  assert.equal(pauseCalls.length, 1, 'breaker pauses exactly once on the 3rd rejection');
  // host-faithful-agents already throws on a non-UUID — reaching here proves
  // the agentId was a UUID. Assert it explicitly for a decisive failure msg.
  assert.match(
    pauseCalls[0].agentId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'pause must receive the resolved Editor-Agent UUID, never the EDITOR_AGENT_ID_TAG',
  );
  assert.equal(
    h.agentCalls.pause[0].agentId,
    h.resolvedAgentId,
    'the paused id is exactly the UUID managed.reconcile resolved',
  );
});

// ---- Case 4 — heartbeat-policy trap (catalogue item 4) ---------------------

test('host-faithful: sendMessage heartbeat-policy skip -> recordCompileFailure, no publish, no hang', async () => {
  resetCircuitBreakerState();
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
    sessionOpts: { heartbeatPolicySkip: true },
  });
  registerCompileBulletinJob(h.ctx);
  // Must COMPLETE — a heartbeat-policy rejection is non-transient, the adapter
  // must fail fast, not retry into a timeout/hang.
  await h.jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(h.issuesCreated.length, 0, 'a heartbeat-policy skip must block publish');
  assert.ok(
    h.compileFailures.length >= 1,
    'a bulletin_compile_failures row must be recorded',
  );
  assert.ok(
    h.compileFailures.some((f) => /heartbeat policy/i.test(f.reason)),
    'the recorded failure reason must carry the heartbeat-policy message',
  );
});

// ---- Case 5 — logger-metadata drop (catalogue item 5) ----------------------

test('host-faithful: diagnostic evidence is IN the log MESSAGE string, not dropped metadata', async () => {
  resetCircuitBreakerState();
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: {}, // bootstrap → emits the "bootstrapped next_due_at" info log
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(h.ctx);
  await h.jobs.get('compile-bulletin')(JOB_EVENT);

  // The host-faithful logger DROPS any 2nd-arg metadata object — loggedMessages
  // holds ONLY message strings. The bootstrap log currently passes companyId
  // as metadata; this asserts SOME logged message records the bootstrap event
  // so the evidence survives the host's metadata drop.
  const bootstrapLog = h.loggedMessages.find((m) => /bootstrap/i.test(m));
  assert.ok(bootstrapLog, 'a bootstrap event must be logged as a message string');
  // Every entry in loggedMessages must be a plain string — proves the fake
  // really drops metadata and the test is meaningful.
  for (const m of h.loggedMessages) {
    assert.equal(typeof m, 'string', 'loggedMessages holds only message strings');
  }
});

test('host-faithful: verifier-rejection failure reason is recorded as a string (survives metadata drop)', async () => {
  resetCircuitBreakerState();
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 9999, // mismatch → verifier rejects
  });
  registerCompileBulletinJob(h.ctx);
  await h.jobs.get('compile-bulletin')(JOB_EVENT);

  assert.equal(h.issuesCreated.length, 0, 'verifier rejection blocks publish');
  assert.ok(h.compileFailures.length >= 1, 'a compile-failure row is recorded');
  assert.ok(
    typeof h.compileFailures[0].reason === 'string' && h.compileFailures[0].reason.length > 0,
    'the failure reason is a non-empty string',
  );
});

// ---- Case — write-via-query trap (catalogue item 1, regression net) --------

test('host-faithful: every bulletins write goes through ctx.db.execute (no INSERT-via-query)', async () => {
  resetCircuitBreakerState();
  // wrapHostFaithfulDb throws on a write-via-query. A clean happy-path run
  // proves the whole compile path keeps writes on ctx.db.execute — the
  // 2026-05-15 INSERT-via-query defect would fail this test here.
  const h = makeHostFaithfulCompileCtx({
    companies: [{ id: 'COU' }],
    nextDue: { COU: PAST },
    sqlMrr: 2475,
  });
  registerCompileBulletinJob(h.ctx);
  await assert.doesNotReject(
    h.jobs.get('compile-bulletin')(JOB_EVENT),
    'no host-contract db violation during a clean compile',
  );
  assert.equal(h.issuesCreated.length, 1);
});
