// test/worker/situation/build-employees-rollup-viewer-single-source.test.mjs
//
// Plan 11-06 Task 3 — WR-06 single-source viewer-scoping (SC5).
//
// build-employees-rollup previously had TWO independent viewer-targeting
// computations that could desync: the inline __targetsViewer flag
// (terminal.kind==='AWAITING_HUMAN' && terminal.userId===viewerUserId at
// :399-401) plus the needs-you count read off the verdict. This plan routes the
// viewer-targeting decision through the SINGLE exported pure predicate
// rowTargetsViewer(terminal, viewerUserId). The flag and the count partition can
// no longer derive the same fact two different ways.
//
// FALLBACK path (per the plan): the predicate is unit-pinned, and the integration
// behavior (the needs-you count) is asserted to agree with it on the same fixture.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  buildEmployeesRollup,
  rowTargetsViewer,
} from '../../../src/worker/situation/build-employees-rollup.ts';

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

function makeCtx({ agents = [], issuesByAgent = {}, relations = {}, agentsByUuid = {} } = {}) {
  return {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    issues: {
      async list(input) {
        return issuesByAgent[input?.assigneeAgentId ?? ''] ?? [];
      },
      async get() {
        return null;
      },
      relations: {
        async get(id) {
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
    agents: {
      async list() {
        return agents;
      },
      async get(uuid) {
        return agentsByUuid[uuid] ?? null;
      },
    },
  };
}

const agent = ({ id, lastHeartbeatMs = null }) => ({
  id,
  name: `Agent ${id}`,
  role: 'general',
  title: null,
  lastHeartbeatAt: lastHeartbeatMs != null ? iso(lastHeartbeatMs) : null,
});
const issue = ({ id, identifier, assigneeAgentId = null, lastActivityMs = null }) => ({
  id,
  identifier,
  title: `Title ${identifier}`,
  status: 'blocked',
  assigneeAgentId,
  lastActivityAt: lastActivityMs != null ? iso(lastActivityMs) : null,
});

// ---------------------------------------------------------------------------
// The single-source predicate is the ONLY viewer-targeting decision.
// ---------------------------------------------------------------------------
test('rowTargetsViewer — true only for a viewer-owned AWAITING_HUMAN terminal', () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  // Viewer-owned AWAITING_HUMAN → true.
  assert.equal(rowTargetsViewer({ kind: 'AWAITING_HUMAN', userId: viewer, label: 'x' }, viewer), true);
  // Different owner → false.
  assert.equal(rowTargetsViewer({ kind: 'AWAITING_HUMAN', userId: 'other', label: 'x' }, viewer), false);
  // UNOWNED (org-wide, no userId) → false.
  assert.equal(rowTargetsViewer({ kind: 'UNOWNED', label: 'x' }, viewer), false);
  // A non-human kind → false.
  assert.equal(rowTargetsViewer({ kind: 'EXTERNAL', label: 'x' }, viewer), false);
  // A null/undefined terminal → false (degrade-safe).
  assert.equal(rowTargetsViewer(null, viewer), false);
});

// ---------------------------------------------------------------------------
// WR-06 agreement: a viewer-owned AWAITING_HUMAN row is counted in needs-you.
// ---------------------------------------------------------------------------
test('WR-06 — a viewer-owned AWAITING_HUMAN row counts in needs-you (flag + count agree)', async () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const a = agent({ id: 'ag-me', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-me', identifier: 'COU-700', assigneeAgentId: 'ag-me', lastActivityMs: NOW - 3 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-me': [blocked] },
    relations: { 'i-me': { blockedBy: [{ id: 'i-me-x', assigneeUserId: viewer, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [viewer]: { name: 'You' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', viewer);
  const row = out.employees.find((r) => r.agentId === 'ag-me');
  assert.equal(row.blockerChain.needsYou, true);
  // The same predicate that sets __targetsViewer agrees this row targets viewer.
  assert.equal(rowTargetsViewer({ kind: 'AWAITING_HUMAN', userId: viewer, label: 'x' }, viewer), true);
  assert.ok(out.needsYou.count >= 1, `viewer-targeted row must count, got ${out.needsYou.count}`);
});

test('WR-06 — an UNOWNED needs-you row counts via "assign" but is NOT viewer-targeted', async () => {
  const a = agent({ id: 'ag-un', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-un', identifier: 'COU-800', assigneeAgentId: 'ag-un', lastActivityMs: NOW - 5 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-un': [blocked] },
    relations: { 'i-un': { blockedBy: [{ id: 'i-un-x', assigneeUserId: null, status: 'blocked', etaIso: null }], blocks: [] } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer');
  const row = out.employees.find((r) => r.agentId === 'ag-un');
  assert.equal(row.blockerChain.actionAffordance, 'assign');
  assert.equal(rowTargetsViewer({ kind: 'UNOWNED', label: 'x' }, 'u-viewer'), false);
  assert.ok(out.needsYou.count >= 1, 'unowned row counts via the assign partition');
});

test('WR-06 — a non-viewer AWAITING_HUMAN row is neither viewer-targeted nor counted', async () => {
  const someoneElse = 'dddddddd-eeee-ffff-0000-111111111111';
  const a = agent({ id: 'ag-other', lastHeartbeatMs: NOW - 30 * MIN });
  const blocked = issue({ id: 'i-other', identifier: 'COU-900', assigneeAgentId: 'ag-other', lastActivityMs: NOW - 2 * HOUR });
  const ctx = makeCtx({
    agents: [a],
    issuesByAgent: { 'ag-other': [blocked] },
    relations: { 'i-other': { blockedBy: [{ id: 'i-other-x', assigneeUserId: someoneElse, status: 'awaiting', etaIso: null }], blocks: [] } },
    agentsByUuid: { [someoneElse]: { name: 'Someone Else' } },
  });
  const out = await buildEmployeesRollup(ctx, 'co-1', 'u-viewer-not-owner');
  assert.equal(rowTargetsViewer({ kind: 'AWAITING_HUMAN', userId: someoneElse, label: 'x' }, 'u-viewer-not-owner'), false);
  assert.equal(out.needsYou.count, 0, 'owned-by-others is neither unowned nor viewer-targeted');
});
