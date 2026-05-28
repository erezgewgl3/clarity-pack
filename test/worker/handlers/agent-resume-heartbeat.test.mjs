// test/worker/handlers/agent-resume-heartbeat.test.mjs
//
// Quick task 260528-mn0 (2026-05-28) — agents.resumeHeartbeat ACTION handler.
//
// Both the paused-agent banner (Reader + chat header) and the chat Quick
// Action row call usePluginAction('agents.resumeHeartbeat'); the key was never
// registered → the host returned 502. This handler registers it.
//
// Behaviors:
//   1. opt-in gate — opted-out caller → { error: 'OPT_IN_REQUIRED' }, no resume.
//   2. missing companyId → THROW (canonical "agents.resumeHeartbeat: companyId required").
//   3. explicit agentId wins — resume(agentId, companyId); NO reconcile.
//   4. no agentId → resolve Editor-Agent via reconcile(EDITOR_AGENT_KEY) then
//      resume(resolvedUuid).
//   5. resume throws → handler RE-THROWS (callers branch on throw to degrade).
//   6. reconcile throws → handler RE-THROWS.
//   7. reconcile resolves null agentId → handler THROWS.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerAgentResumeHeartbeat } from '../../../src/worker/handlers/agent-resume-heartbeat.ts';
import { EDITOR_AGENT_KEY } from '../../../src/worker/agents/editor.ts';

const EDITOR_AGENT_UUID = 'b2a22e50-00ed-itor-aaaa-aaaaaaaaaaaa';

function makeCtx({
  optedIn = true,
  resolvedAgentId = EDITOR_AGENT_UUID,
  reconcileThrows = false,
  resumeThrows = false,
} = {}) {
  const handlers = new Map();
  const reconcileCalls = [];
  const resumeCalls = [];
  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    agents: {
      managed: {
        async reconcile(key, companyId) {
          reconcileCalls.push({ key, companyId });
          if (reconcileThrows) throw new Error('reconcile failure');
          return { agentId: resolvedAgentId, agent: resolvedAgentId ? { id: resolvedAgentId } : null, status: 'paused' };
        },
      },
      async resume(agentId, companyId) {
        resumeCalls.push({ agentId, companyId });
        if (resumeThrows) throw new Error('host resume 409');
        return { id: agentId, status: 'idle' };
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
  };
  registerAgentResumeHeartbeat(ctx);
  const handler = handlers.get('agents.resumeHeartbeat');
  assert.ok(handler, 'agents.resumeHeartbeat was registered');
  return { ctx, handler, reconcileCalls, resumeCalls };
}

test('agents.resumeHeartbeat — opted-out caller → OPT_IN_REQUIRED, no resume', async () => {
  const { handler, resumeCalls } = makeCtx({ optedIn: false });
  const result = await handler({ companyId: 'co-1', agentId: 'a-1' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(resumeCalls.length, 0, 'opted-out → resume never called');
});

test('agents.resumeHeartbeat — missing companyId → throws', async () => {
  const { handler } = makeCtx();
  await assert.rejects(
    () => handler({ userId: 'eric', agentId: 'a-1' }),
    /companyId required/,
  );
});

test('agents.resumeHeartbeat — explicit agentId wins (no reconcile)', async () => {
  const { handler, reconcileCalls, resumeCalls } = makeCtx();
  const result = await handler({ userId: 'eric', companyId: 'co-1', agentId: 'ceo-uuid-123' });
  assert.deepEqual(result, { ok: true, agentId: 'ceo-uuid-123' });
  assert.equal(reconcileCalls.length, 0, 'explicit agentId → no reconcile');
  assert.deepEqual(resumeCalls, [{ agentId: 'ceo-uuid-123', companyId: 'co-1' }]);
});

test('agents.resumeHeartbeat — no agentId → resolve Editor-Agent then resume resolved UUID', async () => {
  const { handler, reconcileCalls, resumeCalls } = makeCtx();
  const result = await handler({ userId: 'eric', companyId: 'co-1' });
  assert.deepEqual(result, { ok: true, agentId: EDITOR_AGENT_UUID });
  assert.equal(reconcileCalls.length, 1);
  assert.equal(reconcileCalls[0].key, EDITOR_AGENT_KEY, 'reconcile uses the Editor-Agent key');
  assert.deepEqual(resumeCalls, [{ agentId: EDITOR_AGENT_UUID, companyId: 'co-1' }]);
});

test('agents.resumeHeartbeat — resume throws → handler re-throws (callers degrade)', async () => {
  const { handler } = makeCtx({ resumeThrows: true });
  await assert.rejects(() => handler({ userId: 'eric', companyId: 'co-1', agentId: 'a-1' }), /host resume 409/);
});

test('agents.resumeHeartbeat — reconcile throws → handler re-throws', async () => {
  const { handler, resumeCalls } = makeCtx({ reconcileThrows: true });
  await assert.rejects(() => handler({ userId: 'eric', companyId: 'co-1' }), /reconcile failure/);
  assert.equal(resumeCalls.length, 0, 'reconcile failure → resume never reached');
});

test('agents.resumeHeartbeat — reconcile resolves null agentId → throws', async () => {
  const { handler, resumeCalls } = makeCtx({ resolvedAgentId: null });
  await assert.rejects(() => handler({ userId: 'eric', companyId: 'co-1' }), /could not resolve agent id/);
  assert.equal(resumeCalls.length, 0);
});
