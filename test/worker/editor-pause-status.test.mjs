// test/worker/editor-pause-status.test.mjs
//
// Plan 05-05 Task 1 — D-06 + D-07 cause-discriminated pause status.
//
// The handler `editor.pause-status` now returns a DISCRIMINATED UNION
// instead of an opaque { paused, lastFailureAt, reason }:
//   { paused: false }                                                  — no failures, or below threshold
//   { paused: true, cause: 'operator', agentName, [lastFailureAt, reason] } — operator clicked Pause (default)
//   { paused: true, cause: 'budget',   agentName, [lastFailureAt, reason] } — `reason` contains "budget"
//   { paused: true, cause: 'adapter',  agentName, detail, [lastFailureAt, reason] } — `reason` contains "codex" / "adapter"
//
// agentName comes from ctx.agents.get — never the raw UUID. When degraded,
// agentName is null and the UI surfaces a friendly fallback ('this employee').
//
// LEGACY back-compat: when paused, the handler ALSO returns the original
// `lastFailureAt` + `reason` fields so the editor-only `pause-banner.tsx`
// keeps its locked render. The new `AgentPauseBanner` reads only the new
// cause/agentName/detail fields. One worker call, two consumers (PRIM-01
// spirit).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerEditorPauseStatus,
} from '../../src/worker/handlers/editor-pause-status.ts';
import { MAX_CONSECUTIVE_FAILURES } from '../../src/worker/agents/circuit-breaker.ts';

const EDITOR_AGENT_UUID = 'b2a22e50-00ed-itor-aaaa-aaaaaaaaaaaa';

function makeFakeCtx({ rows = [], throwOnQuery = false, agentName = 'Editorial Desk', agentsGetThrows = false } = {}) {
  const registered = new Map();
  const agentsGetCalls = [];
  const ctx = {
    data: {
      register(key, handler) {
        registered.set(key, handler);
      },
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          // opt-in-guard probe — return opted-in.
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        if (/editor_agent_failures/.test(sql)) {
          if (throwOnQuery) throw new Error('boom');
          return rows;
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    agents: {
      async get(agentUuid, companyId) {
        agentsGetCalls.push({ agentUuid, companyId });
        if (agentsGetThrows) throw new Error('agents.get failure');
        return { id: agentUuid, name: agentName };
      },
    },
    logger: { warn() {}, info() {}, error() {} },
  };
  return { ctx, registered, agentsGetCalls };
}

test('editor.pause-status — returns { paused: false } when there are no failure rows', async () => {
  const { ctx, registered } = makeFakeCtx({ rows: [] });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  assert.ok(handler, 'editor.pause-status was registered');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false, 'no rows → paused:false');
});

test('editor.pause-status — returns { paused: false } when query throws (catch path preserved)', async () => {
  const { ctx, registered } = makeFakeCtx({ throwOnQuery: true });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false, 'query throw → paused:false (catch path)');
});

test('editor.pause-status — returns { paused: false } when most recent row is below MAX_CONSECUTIVE_FAILURES', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T10:00:00Z', reason: 'whatever', consecutive: MAX_CONSECUTIVE_FAILURES - 1 }],
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, false);
});

test('D-07 cause derivation — reason contains "budget" → cause: "budget"', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T10:30:00Z', reason: 'agent budget exhausted (caps hit)', consecutive: MAX_CONSECUTIVE_FAILURES }],
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'budget');
  // back-compat: legacy fields still present so the editor-only banner keeps rendering
  assert.equal(result.lastFailureAt, '2026-05-25T10:30:00Z');
});

test('D-07 cause derivation — reason contains "codex" or "adapter" → cause: "adapter" + detail HH:MM', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T14:07:00Z', reason: 'codex adapter timeout', consecutive: MAX_CONSECUTIVE_FAILURES }],
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'adapter');
  assert.match(result.detail, /^\d{2}:\d{2}$/, 'detail is HH:MM');
});

test('D-07 cause derivation — generic reason → cause: "operator" (operator clicked Pause = default)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'paused by operator', consecutive: MAX_CONSECUTIVE_FAILURES + 2 }],
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.cause, 'operator');
});

test('D-07 agentName — resolved via ctx.agents.get (NEVER the UUID)', async () => {
  const { ctx, registered, agentsGetCalls } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'paused by operator', consecutive: MAX_CONSECUTIVE_FAILURES }],
    agentName: 'Editorial Desk',
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.agentName, 'Editorial Desk', 'agentName is the resolved display name');
  assert.ok(agentsGetCalls.length >= 1, 'ctx.agents.get was invoked at least once when companyId is present');
});

test('D-07 agentName — degrades to null when ctx.agents.get throws (NO UUID leak)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:00:00Z', reason: 'paused by operator', consecutive: MAX_CONSECUTIVE_FAILURES }],
    agentsGetThrows: true,
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.agentName, null, 'agentName is null on ctx.agents.get throw');
  // Make sure the EDITOR_AGENT_UUID-style fallback NEVER landed
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /b2a22e50/, 'serialized result must not contain any UUID fragment as fallback');
});

test('back-compat — legacy fields lastFailureAt + reason still present when paused (editor-only banner consumes them)', async () => {
  const { ctx, registered } = makeFakeCtx({
    rows: [{ failed_at: '2026-05-25T11:23:00Z', reason: 'compile failed', consecutive: MAX_CONSECUTIVE_FAILURES }],
  });
  registerEditorPauseStatus(ctx);
  const handler = registered.get('editor.pause-status');
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.equal(result.paused, true);
  assert.equal(result.lastFailureAt, '2026-05-25T11:23:00Z', 'legacy lastFailureAt preserved');
  assert.equal(result.reason, 'compile failed', 'legacy reason preserved');
});
