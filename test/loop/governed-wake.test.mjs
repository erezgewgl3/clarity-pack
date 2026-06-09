// test/loop/governed-wake.test.mjs
//
// Phase 16.1 Plan 16.1-07 (LOOP-07) — the GOVERNED creation-time wake test.
//
// WHY THIS EXISTS. D-05 (Plan 16.1-02) DELETED `requestWakeup` from the delivery
// path on the assumption the Editor-Agent's native heartbeat would pull op-issues.
// It does not — undispatched op-issues fall to Paperclip's recovery sweep, which
// dispatches them under recoveryAssigneeAdapterOverrides("status_only")
// (modelProfile:cheap, allowDocumentUpdates:false, resumeRequiresNormalModel:true),
// and routes/issues.js then HARD-REJECTS any document write from such runs. The
// Editor-Agent computes correct TL;DRs but can never persist them. LOOP-07
// re-introduces a SINGLE GOVERNED requestWakeup at op-issue CREATION (gated by the
// already-shipped wake-governor checkAndRecordWake) to restore write-capable
// normal_model dispatch — WITHOUT reopening the storm.
//
// HARNESS. Modeled on storm-safety.test.mjs's makeStormCtx: a fake ctx whose
// db.query/execute simulate the three durable tables (own_operation_issues Set,
// wake_ledger array, wake_kill_switch Map) by SQL regex, and whose ctx.issues
// provides create (push to opIssueCreates, return { id }), list (return [] so
// every call CREATES), requestWakeup (push the id to wakeCalls), plus
// documents/listComments stubs the delivery ctx type wants. The REAL startAgentTask
// is driven against this fake db so the test exercises the REAL governor +
// provenance repos, not a re-implementation.
//
// Three locked tests:
//   (1) governed-wake-fires-once: one create -> wakeCalls.length === 1 + one
//       wake_ledger row.
//   (2) kill-switch-degrade-still-creates: pre-engage the switch -> the op-issue
//       is STILL created (opIssueCreates.length === 1) AND wakeCalls.length === 0.
//   (3) over-ceiling-degrade: >ceiling creates in well under 60s caps wakeCalls at
//       the ceiling (default 6) and engages the kill-switch — but EVERY call still
//       creates its op-issue.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { startAgentTask } from '../../src/worker/agents/agent-task-delivery.ts';
import { engage, isEngaged } from '../../src/worker/db/wake-kill-switch-repo.ts';

const COMPANY_ID = 'c1';
const AGENT_ID = 'editor-agent-uuid';

const BASE_OPTS = {
  agentId: AGENT_ID,
  companyId: COMPANY_ID,
  operationKind: 'tldr-compile',
  operationId: 'tldr-BEAAA-1',
  title: 'Compile TL;DR — BEAAA-1',
  prompt: 'You are the Editorial Desk. Compile a TL;DR.',
};

/**
 * The fake governed-wake ctx. The three durable structures live in closure state
 * (own_operation_issues Set, wake_ledger array, wake_kill_switch Map), simulated
 * by SQL regex exactly as storm-safety.test.mjs does. Each call to this factory
 * gets FRESH durable structures — no shared module state across tests.
 */
function makeGovernedWakeCtx() {
  const wakeCalls = []; // every requestWakeup the delivery path attempts
  const opIssueCreates = []; // every op-issue create
  const provenance = new Set(); // durable own_operation_issues (company|issue keys)
  const wakeLedger = []; // durable wake_ledger row timestamps (ms)
  const killSwitch = new Map(); // companyId -> { engaged, plugin_version }

  function pkey(companyId, issueId) {
    return `${companyId}|${issueId}`;
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/own_operation_issues/.test(sql)) {
          return provenance.has(pkey(params[0], params[1])) ? [{ '?column?': 1 }] : [];
        }
        if (/count\(\*\)\s+AS\s+n/i.test(sql) && /wake_ledger/.test(sql)) {
          // countTrailingWakes: params = [companyId, windowSeconds]
          const cutoff = Date.now() - 60_000;
          const n = wakeLedger.filter((row) => row.companyId === params[0] && row.t > cutoff).length;
          return [{ n }];
        }
        if (/wake_kill_switch/.test(sql)) {
          // isEngaged: WHERE company_id=$1 AND plugin_version=$2
          const row = killSwitch.get(params[0]);
          if (row && row.engaged && row.plugin_version === params[1]) {
            return [{ engaged: true }];
          }
          return [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/INSERT INTO[\s\S]*own_operation_issues/i.test(sql)) {
          provenance.add(pkey(params[0], params[1]));
          return { rowCount: 1 };
        }
        if (/INSERT INTO[\s\S]*wake_ledger/i.test(sql)) {
          wakeLedger.push({ companyId: params[0], t: Date.now() });
          return { rowCount: 1 };
        }
        if (/DELETE FROM[\s\S]*wake_ledger/i.test(sql)) {
          // pruneOldWakes — params[0] = windowSeconds
          const cutoff = Date.now() - Number(params[0]) * 1000;
          for (let i = wakeLedger.length - 1; i >= 0; i--) {
            if (wakeLedger[i].t < cutoff) wakeLedger.splice(i, 1);
          }
          return { rowCount: 0 };
        }
        if (/INSERT INTO[\s\S]*wake_kill_switch/i.test(sql)) {
          // engage: params = [companyId, reason, plugin_version]
          killSwitch.set(params[0], { engaged: true, plugin_version: params[2] });
          return { rowCount: 1 };
        }
        if (/UPDATE[\s\S]*wake_kill_switch[\s\S]*engaged\s*=\s*false/i.test(sql)) {
          const row = killSwitch.get(params[0]);
          if (row) row.engaged = false;
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      },
    },
    issues: {
      async list() {
        // Always empty so every startAgentTask CREATES (no reuse).
        return [];
      },
      async create(input) {
        opIssueCreates.push(input);
        return { id: `op-${opIssueCreates.length}` };
      },
      async requestWakeup(issueId, companyId, options) {
        wakeCalls.push({ issueId, companyId, options });
        return { queued: true };
      },
      async listComments() {
        return [];
      },
      documents: {
        async list() {
          return [];
        },
        async get() {
          return null;
        },
      },
    },
  };

  return { ctx, wakeCalls, opIssueCreates, provenance, wakeLedger, killSwitch };
}

test('LOOP-07 governed-wake-fires-once: one op-issue create -> exactly ONE governed requestWakeup + one wake_ledger row', async () => {
  const h = makeGovernedWakeCtx();

  const result = await startAgentTask(h.ctx, BASE_OPTS);

  assert.equal(h.opIssueCreates.length, 1, 'one op-issue was created');
  assert.equal(result.reused, false, 'a fresh op-issue (not reused)');
  assert.equal(h.wakeCalls.length, 1, 'EXACTLY ONE governed requestWakeup fired (LOOP-07)');
  assert.equal(
    h.wakeCalls[0].issueId,
    'op-1',
    'the wake targets the created op-issue id',
  );
  assert.equal(h.wakeCalls[0].companyId, COMPANY_ID, 'the wake carries the company id');
  // The governor recorded exactly one wake in the durable ledger.
  assert.equal(h.wakeLedger.length, 1, 'the wake-governor appended exactly one wake_ledger row');
});

test('LOOP-07 kill-switch-degrade-still-creates: with the kill-switch pre-engaged the op-issue is STILL created and ZERO wakes fire', async () => {
  const h = makeGovernedWakeCtx();

  // Pre-engage the durable kill-switch for this company via the REAL repo — so
  // checkAndRecordWake short-circuits to false (suppress) on the first read.
  await engage(h.ctx, COMPANY_ID, 'test: pre-engaged kill-switch');
  assert.equal(await isEngaged(h.ctx, COMPANY_ID), true, 'the kill-switch reads engaged before the call');

  const result = await startAgentTask(h.ctx, BASE_OPTS);

  // Degrade-safe: the op-issue is created and a valid id returned even though the
  // wake was suppressed — the recovery sweep covers it (no worse than today).
  assert.equal(h.opIssueCreates.length, 1, 'the op-issue is STILL created (degrade-safe)');
  assert.equal(result.operationIssueId, 'op-1', 'a valid operationIssueId is returned');
  assert.equal(result.reused, false, 'a fresh op-issue (not reused)');
  assert.equal(h.wakeCalls.length, 0, 'the governor suppressed the wake — ZERO requestWakeup (degrade-safe)');
  // The suppressed wake records NO ledger row (isEngaged short-circuits before appendWake).
  assert.equal(h.wakeLedger.length, 0, 'a suppressed wake records no wake_ledger row');
});

test('LOOP-07 over-ceiling-degrade: >ceiling creates cap wakes at the ceiling + engage the kill-switch, but EVERY call still creates its op-issue', async () => {
  const h = makeGovernedWakeCtx();
  const CEILING = 6; // DEFAULT_WAKE_CEILING_PER_MIN

  const N = 10;
  for (let i = 0; i < N; i++) {
    // Distinct originId per call so each one CREATES (no reuse path).
    await startAgentTask(h.ctx, {
      ...BASE_OPTS,
      operationId: `tldr-BEAAA-${i}`,
      title: `Compile TL;DR — BEAAA-${i}`,
    });
  }

  // Every call created its op-issue — the governor NEVER skips a creation.
  assert.equal(h.opIssueCreates.length, N, 'every startAgentTask created its op-issue (creation never skipped)');

  // Actual wakes are capped at the ceiling (the governor allows up to and
  // including the ceiling, then engages the kill-switch and suppresses the rest).
  assert.ok(
    h.wakeCalls.length <= CEILING,
    `governed wakes capped at the ceiling ${CEILING} (got ${h.wakeCalls.length}) (LOOP-03/LOOP-07)`,
  );
  assert.ok(h.wakeCalls.length >= 1, 'at least one wake fired before the ceiling tripped');

  // The kill-switch engaged once the ceiling was exceeded — read via the REAL repo.
  assert.equal(
    await isEngaged(h.ctx, COMPANY_ID),
    true,
    'the durable kill-switch engaged after exceeding the ceiling',
  );
});
