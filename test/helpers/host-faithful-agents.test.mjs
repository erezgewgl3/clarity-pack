// test/helpers/host-faithful-agents.test.mjs
//
// Quick task 260516-gx4 Task 1 RED — host-faithful `ctx.agents` fake.
//
// These assertions encode three host-constraint catalogue items, each of
// which was a real live-drill defect:
//
//   Item 3 — `ctx.agents.get/resume/pause` require a real UUID `agentId`. A
//     non-UUID makes the live host throw `invalid input syntax for type uuid`.
//   Item 4 — `ctx.agents.sessions.sendMessage` throws `Agent wakeup was
//     skipped by heartbeat policy` (≠ "Session not found") when the agent is
//     not invokable — a distinct, non-transient failure.
//   Item 8 — the manifest agentKey (`editor-agent`) and the TEXT attribution
//     tag (`clarity-pack-editor-agent`) are different strings; the tag fails
//     the UUID regex.
//
// They MUST fail before host-faithful-agents.mjs exists and before
// host-faithful-sessions.mjs gains the `heartbeatPolicySkip` opt.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  makeHostFaithfulAgents as makeHostFaithfulAgentsFull,
  isUuid,
  EDITOR_AGENT_KEY,
  EDITOR_AGENT_ID_TAG,
} from './host-faithful-agents.mjs';
import { makeHostFaithfulAgents as makeHostFaithfulSessions } from './host-faithful-sessions.mjs';

const REAL_UUID = '11111111-1111-4111-8111-111111111111';

// ---- Item 8 — editor-agent key vs attribution tag --------------------------

test('item 8: EDITOR_AGENT_KEY and EDITOR_AGENT_ID_TAG are different strings', () => {
  assert.equal(EDITOR_AGENT_KEY, 'editor-agent');
  assert.equal(EDITOR_AGENT_ID_TAG, 'clarity-pack-editor-agent');
  assert.notEqual(EDITOR_AGENT_KEY, EDITOR_AGENT_ID_TAG);
});

test('item 8: EDITOR_AGENT_ID_TAG fails the UUID regex (it is a TEXT tag, never a UUID)', () => {
  assert.equal(isUuid(EDITOR_AGENT_ID_TAG), false);
  assert.equal(isUuid(EDITOR_AGENT_KEY), false);
  assert.equal(isUuid(REAL_UUID), true);
});

// ---- Item 3 — UUID enforcement on get/resume/pause -------------------------

test('item 3: pause rejects a non-UUID agentId with the host uuid-syntax error', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  await assert.rejects(
    agents.pause(EDITOR_AGENT_ID_TAG, 'COU'),
    /invalid input syntax for type uuid/i,
  );
});

test('item 3: pause resolves for a real UUID agentId', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  await assert.doesNotReject(agents.pause(REAL_UUID, 'COU'));
});

test('item 3: get rejects a non-UUID agentId with the host uuid-syntax error', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  await assert.rejects(
    agents.get('not-a-uuid', 'COU'),
    /invalid input syntax for type uuid/i,
  );
});

test('item 3: get resolves to an Agent for a real UUID', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  const agent = await agents.get(REAL_UUID, 'COU');
  assert.equal(agent.id, REAL_UUID);
  assert.equal(agent.status, 'idle');
});

test('item 3: resume rejects a non-UUID agentId with the host uuid-syntax error', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  await assert.rejects(
    agents.resume('clarity-pack-editor-agent', 'COU'),
    /invalid input syntax for type uuid/i,
  );
});

test('item 3: resume resolves for a real UUID agentId', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  await assert.doesNotReject(agents.resume(REAL_UUID, 'COU'));
});

test('item 3: managed.reconcile always returns a UUID agentId (never the agentKey string)', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  const resolution = await agents.managed.reconcile(EDITOR_AGENT_KEY, 'COU');
  assert.equal(resolution.status, 'resolved');
  assert.equal(isUuid(resolution.agentId), true, 'reconcile must hand back a UUID');
  assert.notEqual(resolution.agentId, EDITOR_AGENT_KEY);
  // The resolved UUID must itself be usable on pause/get/resume.
  await assert.doesNotReject(agents.pause(resolution.agentId, 'COU'));
});

// ---- Item 4 — heartbeat-policy rejection (extends host-faithful-sessions) ---

test('item 4: heartbeatPolicySkip makes sendMessage throw the heartbeat-policy message', async () => {
  const { agents } = makeHostFaithfulSessions({ heartbeatPolicySkip: true });
  const session = await agents.sessions.create(REAL_UUID, 'COU', {});
  await assert.rejects(
    agents.sessions.sendMessage(session.sessionId, 'COU', { prompt: 'x', onEvent() {} }),
    /Agent wakeup was skipped by heartbeat policy/,
  );
});

test('item 4: the heartbeat-policy message is distinct from "Session not found"', async () => {
  const { agents } = makeHostFaithfulSessions({ heartbeatPolicySkip: true });
  const session = await agents.sessions.create(REAL_UUID, 'COU', {});
  await assert.rejects(
    agents.sessions.sendMessage(session.sessionId, 'COU', { prompt: 'x', onEvent() {} }),
    (err) => {
      assert.match(err.message, /heartbeat policy/);
      assert.doesNotMatch(err.message, /session not found/i);
      return true;
    },
  );
});

// ---- composition — agents fake delegates a coherent sessions slice ---------

test('composition: host-faithful-agents exposes a sessions slice that enforces the taskKey contract', async () => {
  const { agents } = makeHostFaithfulAgentsFull();
  // create with a non-conforming taskKey → the session is a phantom; the
  // composed sessions slice must still enforce host-faithful-sessions' rule.
  const phantom = await agents.sessions.create(REAL_UUID, 'COU', {
    taskKey: 'clarity-pack:bulletin:cycle-1:ts',
  });
  await assert.rejects(
    agents.sessions.sendMessage(phantom.sessionId, 'COU', { prompt: 'x', onEvent() {} }),
    /Session not found/i,
  );
});
