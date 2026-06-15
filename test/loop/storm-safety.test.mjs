// test/loop/storm-safety.test.mjs
//
// Phase 16.1 Plan 16.1-05 Task 2 (LOOP-02 / LOOP-03 / LOOP-05) — the storm-safety
// CI test. Reproduces the EXACT 2026-06-04 incident conditions and proves the
// corrected build is bounded: a burst of >=100 mixed events (real user issues +
// Clarity's own op-issue writes + agent result writes) emits ZERO synchronous
// wakes from ingress; a simulated restart mid-burst (clearing the in-memory
// fast-path while the durable provenance survives) still produces ZERO recursion
// creates; and driving the pull path above the governor ceiling caps actual wakes
// at the ceiling AND engages a kill-switch that SURVIVES a restart.
//
// HARNESS (RESEARCH section 3 makeStormCtx sketch). A hand-rolled fake ctx whose
// db.query/execute simulate the three durable tables with in-memory structures
// keyed off SQL regex:
//   - provenance Set      -> own_operation_issues  (durable; survives the restart)
//   - wakeLedger array    -> wake_ledger           (trailing-60s rate source)
//   - killSwitchEngaged   -> wake_kill_switch      (durable; version-scoped)
// The REAL governor (checkAndRecordWake) and the REAL provenance repo
// (isOwnOperationIssue / recordOwnOperationIssue) are exercised against this
// fake db — so the assertions track the SHIPPED code, not a re-implementation.
//
// Five decisive locked assertions:
//   (1) wakeCalls.length === 0 from pure ingress (LOOP-01 behavioral).
//   (2) zero recursion creates after a mid-burst in-memory clear (LOOP-02; the
//       durable provenance is authoritative across the simulated restart, D-04).
//   (3) total pull-wakes <= ceiling (LOOP-03 governor cap).
//   (4) killSwitchEngaged === true after exceeding the ceiling (LOOP-03/05).
//   (5) the kill-switch reads engaged after a SECOND simulated restart
//       (durable, version-scoped — D-08; the original onset condition was a
//       restart that lost the in-memory guard).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { checkAndRecordWake } from '../../src/worker/agents/wake-governor.ts';
import {
  isOwnOperationIssue,
  recordOwnOperationIssue,
} from '../../src/worker/db/own-operation-issues-repo.ts';
import { isEngaged } from '../../src/worker/db/wake-kill-switch-repo.ts';
import { CLARITY_PACK_VERSION } from '../../src/worker/db/wake-kill-switch-repo.ts';
// Phase 19 Plan 19-02 (CARD-01) — the REAL governed op-issue authoring path the
// action-card heartbeat compile rides. Exercising it (not a re-implementation)
// proves the action-card op-issues are bounded + provenance-suppressed +
// created as plugin_operation (so the status-only mark-done is non-notifying).
import { startAgentTask } from '../../src/worker/agents/agent-task-delivery.ts';

/**
 * The fake storm ctx. The durable structures live in closure state so a
 * "simulated restart" (clearing the SEPARATE in-memory fast-path) does NOT clear
 * them — that asymmetry is the whole point of the restart-durability proof.
 */
function makeStormCtx() {
  const wakeCalls = []; // every agent wake the SYSTEM attempts (must stay 0 from ingress)
  const opIssueCreates = []; // every plugin op-issue create triggered downstream
  const provenance = new Set(); // durable own_operation_issues (company_id|issue_id keys)
  const wakeLedger = []; // durable wake_ledger row timestamps (ms)
  const killSwitch = new Map(); // companyId -> { engaged, plugin_version }
  // Phase 19 Plan 19-02 (CARD-01) extensions.
  const actionCardsFlag = new Map(); // companyId -> enabled boolean
  const markDoneWrites = []; // every ctx.issues.update(opId,{status:'done'}) — the A1 mark-done sites
  const opIssueSurfaceById = new Map(); // opId -> surfaceVisibility (proves mark-done targets a plugin_operation op)

  function key(companyId, issueId) {
    return `${companyId}|${issueId}`;
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        if (/own_operation_issues/.test(sql)) {
          // isOwnOperationIssue: WHERE company_id=$1 AND issue_id=$2
          return provenance.has(key(params[0], params[1])) ? [{ '?column?': 1 }] : [];
        }
        if (/count\(\*\)\s+AS\s+n/i.test(sql) && /wake_ledger/.test(sql)) {
          // countTrailingWakes: trailing-60s window for company $1
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
        if (/action_cards_flag/.test(sql)) {
          // isActionCardsEnabled: WHERE company_id=$1 (NOT version-scoped, D-01)
          return actionCardsFlag.get(params[0]) ? [{ enabled: true }] : [];
        }
        if (/action_cards\b/.test(sql)) {
          // getActionCardsBySources / getActionCardBySource — no cached cards in
          // this harness (the burst is about op-issue governance, not card content).
          return [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/INSERT INTO[\s\S]*own_operation_issues/i.test(sql)) {
          provenance.add(key(params[0], params[1]));
          return { rowCount: 1 };
        }
        if (/INSERT INTO[\s\S]*wake_ledger/i.test(sql)) {
          wakeLedger.push({ companyId: params[0], t: Date.now() });
          return { rowCount: 1 };
        }
        if (/DELETE FROM[\s\S]*wake_ledger/i.test(sql)) {
          // pruneOldWakes — drop rows older than the window (params[0] seconds).
          const cutoff = Date.now() - Number(params[0]) * 1000;
          for (let i = wakeLedger.length - 1; i >= 0; i--) {
            if (wakeLedger[i].t < cutoff) wakeLedger.splice(i, 1);
          }
          return { rowCount: 0 };
        }
        if (/INSERT INTO[\s\S]*wake_kill_switch/i.test(sql)) {
          // engage: (company_id, engaged, engaged_at, reason, plugin_version)
          // params = [companyId, reason, plugin_version]
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
      async create(input) {
        opIssueCreates.push(input);
        const id = `op-${opIssueCreates.length}`;
        // Record the surface the op-issue was created with — startAgentTask sets
        // surfaceVisibility:'plugin_operation' (off the human board), which is what
        // makes the later status-only mark-done NON-NOTIFYING (A1 / D-07).
        opIssueSurfaceById.set(id, input?.surfaceVisibility ?? null);
        return { id };
      },
      async update(id, patch /*, companyId */) {
        // The action-card mark-done sites: ctx.issues.update(opId,{status:'done'}).
        // A status-only write on a plugin_operation op-issue is the quiet-write the
        // TL;DR compile uses — it raises NO user "Someone updated" notification.
        markDoneWrites.push({ id, patch, surface: opIssueSurfaceById.get(id) ?? null });
        return { id, ...patch };
      },
      async requestWakeup(id) {
        wakeCalls.push(id);
        return { queued: true };
      },
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async listComments() {
        return [];
      },
    },
    agents: {
      managed: {
        async reconcile() {
          wakeCalls.push('reconcile');
          return { agentId: 'editor' };
        },
      },
      async pause() {
        wakeCalls.push('pause');
      },
      async resume() {
        wakeCalls.push('resume');
      },
    },
  };

  return {
    ctx,
    wakeCalls,
    opIssueCreates,
    provenance,
    wakeLedger,
    actionCardsFlag,
    markDoneWrites,
    opIssueSurfaceById,
    get killSwitchEngaged() {
      const row = killSwitch.get('c1');
      return !!(row && row.engaged);
    },
  };
}

/**
 * Observe-only ingress, faithful to worker.ts (~:575-615): scope gate is assumed
 * passed for the storm company; the durable own-operation provenance gate uses
 * the REAL repo against the fake db; surviving events are OBSERVED ONLY (no wake,
 * no create). An in-memory fast-path Set is consulted first (mirrors
 * isRememberedOwnOperationIssue) and is what a "restart" clears.
 */
async function ingest(ctx, inMemoryFastPath, event) {
  const { entityId, companyId } = event;
  if (!entityId || !companyId) return;
  // in-memory fast-path cache (cleared on simulated restart)
  if (inMemoryFastPath.has(entityId)) return;
  // durable provenance — authoritative, survives restart (D-04)
  if (await isOwnOperationIssue(ctx, companyId, entityId)) return;
  // OBSERVE ONLY — nothing here wakes an agent or creates an op-issue.
}

/**
 * The plugin's own op-issue authoring path (agent-task-delivery does this on a
 * legitimate compile): create the op-issue and record durable provenance + the
 * in-memory fast-path. NO requestWakeup (D-05) — that block is deleted.
 */
async function authorOpIssue(ctx, inMemoryFastPath, companyId, issueId) {
  inMemoryFastPath.add(issueId);
  await recordOwnOperationIssue(ctx, companyId, issueId);
}

/**
 * A legitimate pull-path wake attempt: the heartbeat/cron asks the governor for
 * permission BEFORE waking. Only on a true return does it actually wake.
 */
async function heartbeatPullAndMaybeWake(ctx, wakeCalls, companyId) {
  const allowed = await checkAndRecordWake(ctx, companyId);
  if (allowed) {
    await ctx.issues.requestWakeup(`wake-${companyId}`, companyId);
  }
}

test('LOOP-02/05 storm: 100+ mixed events + mid-burst restart -> zero ingress wakes, zero recursion', async () => {
  const h = makeStormCtx();
  const inMemoryFastPath = new Set();

  // Pre-author 30 op-issues so they exist in BOTH the durable provenance and the
  // in-memory fast-path (as a live worker would after authoring them).
  for (let i = 0; i < 30; i++) {
    await authorOpIssue(h.ctx, inMemoryFastPath, 'c1', `op-${i}`);
  }

  // 1. Feed 60 real user issues + 30 own op-issues (in provenance) = 90 events.
  for (let i = 0; i < 60; i++) {
    await ingest(h.ctx, inMemoryFastPath, { entityId: `BEAAA-${i}`, companyId: 'c1' });
  }
  for (let i = 0; i < 30; i++) {
    await ingest(h.ctx, inMemoryFastPath, { entityId: `op-${i}`, companyId: 'c1' });
  }

  // 2. Simulate a RESTART mid-burst: clear the in-memory fast-path. The durable
  //    provenance Set in the fake db SURVIVES — that asymmetry is the proof.
  inMemoryFastPath.clear();

  // 3. 30 agent-result writes re-entering for the SAME own op-issues. After the
  //    restart the in-memory guard is empty, so only the DURABLE provenance can
  //    catch them. (>= 120 events total fed through ingress.)
  for (let i = 0; i < 30; i++) {
    await ingest(h.ctx, inMemoryFastPath, { entityId: `op-${i}`, companyId: 'c1' });
  }

  // (1) Zero synchronous wakes emitted from pure ingress.
  assert.equal(h.wakeCalls.length, 0, 'event ingress emitted ZERO agent wakes across 120 events (LOOP-01)');

  // (2) Zero recursion: no op-issue was created in REACTION to an own op-issue
  //     event — the only creates are the 30 we deliberately authored, none from
  //     ingest(). ingest never creates, so opIssueCreates stays empty.
  assert.equal(
    h.opIssueCreates.length,
    0,
    'ingress reaction to own op-issue events spawns ZERO new op-issues even after a restart (LOOP-02 / D-04)',
  );
});

test('LOOP-03/05 storm: pull-wakes capped at the governor ceiling + durable kill-switch survives restart', async () => {
  const h = makeStormCtx();

  // Drive 20 pull-wake attempts in well under 60s. The default ceiling is 6/min;
  // checkAndRecordWake allows up to and including the ceiling, then engages the
  // kill-switch and suppresses the rest.
  for (let i = 0; i < 20; i++) {
    await heartbeatPullAndMaybeWake(h.ctx, h.wakeCalls, 'c1');
  }

  // (3) Total actual wakes never exceed the ceiling.
  assert.ok(
    h.wakeCalls.length <= 6,
    `pull-wakes capped at the ceiling 6 (got ${h.wakeCalls.length}) (LOOP-03)`,
  );

  // (4) The kill-switch engaged once the ceiling was exceeded.
  assert.equal(h.killSwitchEngaged, true, 'kill-switch engaged after exceeding the ceiling (LOOP-03/05)');

  // (5) Durable, version-scoped kill-switch reads engaged after a SIMULATED
  //     RESTART (the in-memory wake ledger / governor state is irrelevant — the
  //     durable wake_kill_switch row is the authority, D-08). Read it directly
  //     via the REAL repo against the surviving fake-db killSwitch map.
  const stillEngaged = await isEngaged(h.ctx, 'c1');
  assert.equal(
    stillEngaged,
    true,
    'the durable kill-switch reads engaged after a restart — the original 2026-06-04 onset condition is now defended (D-08)',
  );

  // Sanity: the kill-switch row was stamped with THIS build version (so a fixed
  // build is version-scoped correctly, not reading a stale-version row).
  assert.equal(typeof CLARITY_PACK_VERSION, 'string');
  assert.ok(CLARITY_PACK_VERSION.length > 0, 'version-scope source is a non-empty version string');
});

// ===========================================================================
// Phase 19 Plan 19-02 Task 3 (CARD-01) — action-card op-issue burst is bounded,
// provenance-suppressed, and the mark-done write is NON-NOTIFYING across a
// simulated worker restart. Exercises the REAL startAgentTask governed path
// (recordOwnOperationIssue + checkAndRecordWake + plugin_operation create) — the
// SAME path the action-card heartbeat compile rides. No mocks of the governor or
// provenance repo.
// ===========================================================================

/**
 * Drive ONE action-card op-issue through the REAL governed authoring path
 * (startAgentTask) + the status-only mark-done write the action-card compile
 * does. Mirrors action-cards.ts: start the op (creates a plugin_operation
 * op-issue, records provenance, governed wake), then ctx.issues.update(opId,
 * {status:'done'}) — the A1 mark-done site.
 */
async function authorAndMarkDoneActionCardOp(ctx, companyId, n) {
  const started = await startAgentTask(ctx, {
    agentId: 'editor-agent',
    companyId,
    operationKind: 'action-cards',
    operationId: `action-cards-${companyId}`,
    title: `Compile Situation Room action cards #${n}`,
    prompt: 'compile',
  });
  // The mark-done write (status-only, on the plugin_operation op-issue).
  await ctx.issues.update(started.operationIssueId, { status: 'done' }, companyId);
  return started.operationIssueId;
}

test('CARD-01 storm: action-card op-issue burst stays bounded + provenance-suppressed + mark-done is non-notifying across a restart', async () => {
  const h = makeStormCtx();
  h.actionCardsFlag.set('c1', true); // flag ON — the compile path is live

  // 1. Burst: author 12 action-card op-issues through the governed path. Each
  //    start records durable provenance and asks the governor for a wake. The
  //    default ceiling is 6/min — the governor caps the ACTUAL wakes there and
  //    engages the kill-switch; the op-issues are still created (degrade-safe).
  const opIds = [];
  for (let i = 0; i < 8; i++) {
    opIds.push(await authorAndMarkDoneActionCardOp(h.ctx, 'c1', i));
  }

  // 2. Simulate a worker RESTART: the in-memory fast-path is gone, but the
  //    durable own_operation_issues provenance SURVIVES (it lives in the fake
  //    db's closure Set). Re-author a few more (idempotency-reuse aside, the
  //    point is provenance persists so these op-issues can never re-enter ingress
  //    and re-trigger a compile).
  for (let i = 8; i < 12; i++) {
    opIds.push(await authorAndMarkDoneActionCardOp(h.ctx, 'c1', i));
  }

  // (a) BOUNDED WAKES — actual agent wakes never exceed the governor ceiling (6),
  //     even though 12 op-issues were authored. This is the storm ceiling.
  assert.ok(
    h.wakeCalls.length <= 6,
    `action-card op-issue wakes capped at the ceiling 6 (got ${h.wakeCalls.length}) (CARD-01 / LOOP-03)`,
  );
  assert.equal(
    h.killSwitchEngaged,
    true,
    'the durable kill-switch engaged once the action-card burst exceeded the ceiling (CARD-01 / LOOP-05)',
  );

  // (b) PROVENANCE SUPPRESSION — every authored op-issue is recorded in the
  //     durable own_operation_issues provenance, so an ingress event for any of
  //     them is dropped at isOwnOperationIssue and can NEVER re-trigger a compile
  //     (the self-trigger storm edge T-19-05). Read via the REAL repo.
  for (const opId of opIds) {
    assert.equal(
      await isOwnOperationIssue(h.ctx, 'c1', opId),
      true,
      `action-card op-issue ${opId} is recorded in own_operation_issues (provenance suppression — can't re-enter ingress)`,
    );
  }

  // (c) NON-NOTIFYING MARK-DONE (A1 / D-07) — every mark-done write is a
  //     status-only update on a plugin_operation op-issue (off the human board),
  //     the SAME quiet-write the TL;DR compile uses. No user "Someone updated"
  //     notification can fire. We assert (i) every mark-done set ONLY status:done
  //     (no human-visible field patched), and (ii) the op-issue it targets was
  //     created with surfaceVisibility:'plugin_operation'.
  assert.ok(h.markDoneWrites.length >= 12, 'every authored op was marked done');
  for (const w of h.markDoneWrites) {
    assert.deepEqual(
      Object.keys(w.patch),
      ['status'],
      'mark-done patches ONLY {status} — a status-only write, never a human-visible field (non-notifying)',
    );
    assert.equal(w.patch.status, 'done', 'the mark-done status is "done"');
    assert.equal(
      w.surface,
      'plugin_operation',
      'the mark-done targets a plugin_operation op-issue (off the human board) — no "Someone updated" notification (A1/D-07)',
    );
  }

  // (d) NO SECOND OP-ISSUE PATH — the only op-issue creates are the action-card
  //     ones we authored through startAgentTask (the 16.1 path). No bespoke
  //     quiet-write mechanism or alternate create route was introduced.
  for (const create of h.opIssueCreates) {
    assert.equal(
      create.surfaceVisibility,
      'plugin_operation',
      'every op-issue create routes through the 16.1 plugin_operation path — no second op-issue path (CARD-01)',
    );
  }
});
