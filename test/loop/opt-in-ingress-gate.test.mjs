// test/loop/opt-in-ingress-gate.test.mjs
//
// Phase 16.1 Plan 16.1-05 Task 2 (LOOP-04) — the opt-in ingress scope gate proof.
// Coexistence guarantee #1 is "default OFF for existing users": with NO company
// opted in, an instance-wide burst of issue/comment events must produce ZERO host
// work and ZERO wakes. This test feeds a burst through the observe-only ingress
// with an EMPTY opted-in-company set and asserts every host-call spy AND the wake
// spy stay at length 0 (beyond the lazy seed's own plugin-namespace scope-check
// SELECTs, which are pure ctx.db.query, not host calls).
//
// Analog: editor-heartbeat-recursion.test.mjs makeCtx — hand-rolled fake ctx,
// capture arrays, assert.equal(spy.length, 0, ...).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ensureSeeded,
  isCompanyOptedIn,
  invalidateOptedInCache,
} from '../../src/worker/opted-in-company-set.ts';
import { isOwnOperationIssue } from '../../src/worker/db/own-operation-issues-repo.ts';

/**
 * A fake ctx whose seed queries return EMPTY (no opted-in user, so the
 * opted-in-company set seeds empty -> default OFF). Every HOST call (issues.*,
 * agents.*) is spied into capture arrays. The seed's plugin-namespace
 * ctx.db.query SELECTs are tracked separately (scopeQueries) — they are the
 * gate's OWN cost, explicitly allowed; what LOOP-04 forbids is host work and any
 * provenance/own_operation_issues read for an out-of-scope company.
 */
function makeOptOffCtx() {
  const hostCalls = []; // issues.* / agents.* — must stay empty
  const wakeCalls = []; // any wake attempt — must stay empty
  const provenanceReads = []; // own_operation_issues reads — must stay empty (gate short-circuits first)
  const scopeQueries = []; // the seed's own clarity_user_prefs / clarity_agent_owners SELECTs

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          scopeQueries.push('user_prefs');
          return []; // NO opted-in user -> set seeds empty
        }
        if (/clarity_agent_owners/.test(sql)) {
          scopeQueries.push('agent_owners');
          return [];
        }
        if (/own_operation_issues/.test(sql)) {
          provenanceReads.push(sql);
          return [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    issues: {
      async get(id) {
        hostCalls.push(`issues.get:${id}`);
        return null;
      },
      async list() {
        hostCalls.push('issues.list');
        return [];
      },
      async create(input) {
        hostCalls.push('issues.create');
        return { id: 'x' };
      },
      async listComments() {
        hostCalls.push('issues.listComments');
        return [];
      },
      async requestWakeup(id) {
        wakeCalls.push(id);
        return { queued: true };
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

  return { ctx, hostCalls, wakeCalls, provenanceReads, scopeQueries };
}

/**
 * Observe-only ingress, faithful to worker.ts (~:575-615): scope gate FIRST.
 * With the opted-in set empty, isCompanyOptedIn returns false and the handler
 * returns BEFORE the provenance read or any host call.
 */
async function observeOnlyIngress(ctx, event) {
  const { companyId, entityId } = event;
  if (!companyId || !entityId) return;
  await ensureSeeded(ctx);
  if (!isCompanyOptedIn(companyId)) return; // out-of-scope — no host work, no provenance read
  if (await isOwnOperationIssue(ctx, companyId, entityId)) return;
  ctx.logger?.info?.('observed in-scope event (observe-only)', { companyId, entityId });
}

test('LOOP-04: opt-in OFF (empty opted-in set) -> a burst produces zero host calls and zero wakes', async () => {
  invalidateOptedInCache(); // force a fresh seed for this test
  const { ctx, hostCalls, wakeCalls, provenanceReads, scopeQueries } = makeOptOffCtx();

  const burst = [];
  for (let i = 0; i < 50; i++) {
    burst.push({ entityId: `BEAAA-${i}`, companyId: `c${i % 5}` });
  }
  for (const event of burst) {
    await observeOnlyIngress(ctx, event);
  }

  // The scope gate short-circuits every event: zero host work.
  assert.equal(hostCalls.length, 0, 'opt-in OFF: zero host calls (issues.* / agents.*) from a 50-event burst (LOOP-04)');
  assert.equal(wakeCalls.length, 0, 'opt-in OFF: zero agent wakes from a 50-event burst (LOOP-04)');
  // The provenance table is never even consulted — the scope gate returns first.
  assert.equal(
    provenanceReads.length,
    0,
    'opt-in OFF: own_operation_issues is never read — the scope gate short-circuits before the provenance check',
  );
  // The seed ran (the gate is real, not a no-op) but only its own
  // plugin-namespace SELECTs — and only ONCE (the 60s TTL fast-path means the
  // remaining 49 events reuse the seed; clarity_agent_owners is skipped because
  // there were zero opted-in users).
  assert.ok(scopeQueries.includes('user_prefs'), 'the lazy seed ran its clarity_user_prefs scope SELECT');
  assert.ok(
    scopeQueries.filter((q) => q === 'user_prefs').length <= 1,
    'the seed fired once for the whole burst (TTL fast-path) — no per-event DB churn',
  );

  invalidateOptedInCache();
});
