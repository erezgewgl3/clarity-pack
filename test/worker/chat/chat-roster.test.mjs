// test/worker/chat/chat-roster.test.mjs
//
// Plan 04-04 Task A RED — chat.roster data handler.
//
// chat.roster returns the company's employee list for the chat roster rail:
//   - ctx.agents.list({ companyId }) is the source.
//   - The Editor-Agent is excluded by id (D-03 — an infra agent, not a chat
//     correspondent). Its id is resolved via
//     ctx.agents.managed.get('editor-agent', companyId).
//   - Each employee is shaped { id, name, role, status } for the rail.
//   - A missing companyId / userId returns the structured data-handler error
//     ({ error: 'COMPANY_ID_REQUIRED' } / { error: 'USER_ID_REQUIRED' }) — data
//     handlers RETURN errors, never throw.
//   - An opted-out caller gets { error: 'OPT_IN_REQUIRED' } from the wrapper.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatRoster } from '../../../src/worker/handlers/chat-roster.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  agents = [
    { id: 'agent-editor', name: 'Editor-Agent', role: 'editor', status: 'idle' },
    { id: 'agent-sdr', name: 'Cold Outreach', role: 'sdr', status: 'running' },
    { id: 'agent-dev', name: 'Backend Dev', role: 'engineer', status: 'idle' },
  ],
  editorAgentId = 'agent-editor',
  agentsListThrows = false,
  managedGetThrows = false,
} = {}) {
  const handlers = new Map();

  const ctx = {
    logger: { warn() {}, info() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    agents: {
      async list({ companyId }) {
        void companyId;
        if (agentsListThrows) throw new Error('host agents.list 503');
        return agents;
      },
      managed: {
        async get(agentKey, companyId) {
          void agentKey;
          void companyId;
          if (managedGetThrows) throw new Error('host managed.get 503');
          return { agentId: editorAgentId };
        },
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function rosterParams(overrides = {}) {
  return { companyId: 'co-1', userId: 'user-eric', ...overrides };
}

test('chat.roster: handler registers under key chat.roster', () => {
  const ctx = makeCtx();
  registerChatRoster(ctx);
  assert.ok(ctx._handlers.has('chat.roster'));
});

test('chat.roster: returns the agent list with the Editor-Agent excluded by id (D-03)', async () => {
  const ctx = makeCtx();
  registerChatRoster(ctx);
  const result = await ctx._handlers.get('chat.roster')(rosterParams());

  assert.equal(result.kind, 'roster');
  assert.equal(result.employees.length, 2);
  const ids = result.employees.map((e) => e.id);
  assert.ok(!ids.includes('agent-editor'), 'Editor-Agent must not appear in the roster');
  assert.ok(ids.includes('agent-sdr'));
  assert.ok(ids.includes('agent-dev'));
});

test('chat.roster: each employee is shaped { id, name, role, status }', async () => {
  const ctx = makeCtx();
  registerChatRoster(ctx);
  const result = await ctx._handlers.get('chat.roster')(rosterParams());
  const sdr = result.employees.find((e) => e.id === 'agent-sdr');
  assert.equal(sdr.name, 'Cold Outreach');
  assert.equal(sdr.role, 'sdr');
  assert.equal(sdr.status, 'running');
});

test('chat.roster: missing companyId → { error: COMPANY_ID_REQUIRED } (data handler returns, never throws)', async () => {
  const ctx = makeCtx();
  registerChatRoster(ctx);
  const params = rosterParams();
  delete params.companyId;
  const result = await ctx._handlers.get('chat.roster')(params);
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.roster: missing userId → { error: OPT_IN_REQUIRED } (guard short-circuit)', async () => {
  const ctx = makeCtx();
  registerChatRoster(ctx);
  const params = rosterParams();
  delete params.userId;
  const result = await ctx._handlers.get('chat.roster')(params);
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

test('chat.roster: opted-out caller → OPT_IN_REQUIRED (T-04-15)', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatRoster(ctx);
  const result = await ctx._handlers.get('chat.roster')(rosterParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

test('chat.roster: managed.get failure degrades — roster still returned, Editor not filtered', async () => {
  const ctx = makeCtx({ managedGetThrows: true });
  registerChatRoster(ctx);
  const result = await ctx._handlers.get('chat.roster')(rosterParams());
  // The handler must not crash on a managed.get failure — it returns the full
  // list (the Editor-Agent id is simply unknown). A degraded roster beats a
  // 500.
  assert.equal(result.kind, 'roster');
  assert.equal(result.employees.length, 3);
});

test('chat.roster: agents.list failure → { error: ROSTER_FAILED }', async () => {
  const ctx = makeCtx({ agentsListThrows: true });
  registerChatRoster(ctx);
  const result = await ctx._handlers.get('chat.roster')(rosterParams());
  assert.equal(result.error, 'ROSTER_FAILED');
});
