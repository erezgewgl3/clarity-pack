// test/worker/agents/session-llm-adapter.test.mjs
//
// Plan 03-05 Task 1 RED — failing spec for the session-backed LlmAdapter.
//
// `sessionLlmAdapter(ctx, opts)` returns an object satisfying the existing
// `LlmAdapter` interface `{ complete({maxTokens, prompt}): Promise<string> }`,
// but instead of a stub it opens a real agent chat session via
// `ctx.agents.sessions.*` (the production LLM-invocation mechanism — see
// 03-LLM-INVOCATION-RESEARCH.md Mechanism 1).
//
// These tests use a fake ctx whose `agents.get` returns a scripted Agent and
// whose `agents.sessions` is a fake with `create`/`sendMessage`/`close`.
// `sendMessage` replays a scripted sequence of AgentSessionEvents through the
// supplied `onEvent` (asynchronously, via setImmediate, so the adapter's
// Promise-wrapping is genuinely exercised), then resolves `{ runId }`.
//
// RED expectation: `src/worker/agents/session-llm-adapter.ts` does not exist
// yet — the import fails with ERR_MODULE_NOT_FOUND.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  sessionLlmAdapter,
  AGENT_NOT_INVOKABLE,
  SESSION_TIMEOUT_MS,
} from '../../../src/worker/agents/session-llm-adapter.ts';

/**
 * Build a fake SessionLlmAdapterCtx.
 *
 * @param {object}   opts
 * @param {string}   opts.agentStatus  — status the fake `agents.get` returns.
 * @param {boolean}  opts.agentNull    — when true, `agents.get` returns null.
 * @param {Array}    opts.events       — scripted AgentSessionEvents `sendMessage` replays.
 * @param {boolean}  opts.replayNone   — when true, `sendMessage` replays NO events (timeout path).
 */
function makeFakeCtx({ agentStatus = 'idle', agentNull = false, events = [], replayNone = false } = {}) {
  const calls = {
    get: [],
    create: [],
    sendMessage: [],
    close: [],
  };
  let sessionSeq = 0;

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    agents: {
      async get(agentId, companyId) {
        calls.get.push({ agentId, companyId });
        if (agentNull) return null;
        return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' };
      },
      sessions: {
        async create(agentId, companyId, createOpts) {
          sessionSeq += 1;
          const sessionId = `sess-${sessionSeq}`;
          calls.create.push({ agentId, companyId, opts: createOpts, sessionId });
          return { sessionId, agentId, companyId, status: 'active', createdAt: new Date().toISOString() };
        },
        async sendMessage(sessionId, companyId, sendOpts) {
          calls.sendMessage.push({ sessionId, companyId, opts: sendOpts });
          if (!replayNone) {
            // Replay scripted events asynchronously — exercises the adapter's
            // Promise-wrapping (terminal event drives resolve/reject, NOT the
            // sendMessage Promise resolving).
            let seq = 0;
            for (const ev of events) {
              const e = { sessionId, runId: 'run-test', seq: (seq += 1), ...ev };
              setImmediate(() => {
                if (typeof sendOpts.onEvent === 'function') sendOpts.onEvent(e);
              });
            }
          }
          return { runId: 'run-test' };
        },
        async close(sessionId, companyId) {
          calls.close.push({ sessionId, companyId });
        },
      },
    },
  };

  return { ctx, calls };
}

/** chunk event helper. */
function chunk(message, stream = 'stdout') {
  return { eventType: 'chunk', stream, message, payload: null };
}
const DONE = { eventType: 'done', stream: 'system', message: null, payload: null };
function errorEvent(message) {
  return { eventType: 'error', stream: 'stderr', message, payload: null };
}

const BASE_OPTS = { agentId: 'editor-agent-uuid', companyId: 'COU' };

test('session-llm-adapter: exports the AGENT_NOT_INVOKABLE tag and SESSION_TIMEOUT_MS constant', () => {
  assert.equal(typeof AGENT_NOT_INVOKABLE, 'string');
  assert.ok(AGENT_NOT_INVOKABLE.length > 0);
  assert.equal(typeof SESSION_TIMEOUT_MS, 'number');
  assert.ok(SESSION_TIMEOUT_MS > 0);
});

// ---- Test 1 — happy path: chunk + chunk + done resolves accumulated text ----
test('session-llm-adapter: happy path — chunk("Hello ") + chunk("world") + done resolves "Hello world"', async () => {
  const { ctx } = makeFakeCtx({
    events: [chunk('Hello '), chunk('world'), DONE],
  });
  const llm = sessionLlmAdapter(ctx, BASE_OPTS);
  const out = await llm.complete({ maxTokens: 6000, prompt: 'compile the bulletin' });
  assert.equal(out, 'Hello world');
});

// ---- Test 2 — stderr chunks excluded from accumulation ----
test('session-llm-adapter: stderr chunk excluded — only stdout text accumulates', async () => {
  const { ctx } = makeFakeCtx({
    events: [chunk('good', 'stdout'), chunk('BAD', 'stderr'), DONE],
  });
  const llm = sessionLlmAdapter(ctx, BASE_OPTS);
  const out = await llm.complete({ maxTokens: 6000, prompt: 'p' });
  assert.equal(out, 'good');
});

// ---- Test 3 — session error event rejects complete() ----
test('session-llm-adapter: error event rejects complete() with the error message', async () => {
  const { ctx } = makeFakeCtx({
    events: [chunk('partial'), errorEvent('adapter blew up')],
  });
  const llm = sessionLlmAdapter(ctx, BASE_OPTS);
  await assert.rejects(
    llm.complete({ maxTokens: 6000, prompt: 'p' }),
    /adapter blew up/,
  );
});

// ---- Test 4 — timeout: no terminal event rejects after a short timeout ----
test('session-llm-adapter: no terminal event — complete() rejects on the injected timeout', async () => {
  const { ctx } = makeFakeCtx({ replayNone: true });
  const llm = sessionLlmAdapter(ctx, { ...BASE_OPTS, timeoutMs: 50 });
  await assert.rejects(
    llm.complete({ maxTokens: 6000, prompt: 'p' }),
    /timeout/i,
  );
});

// ---- Test 5 — paused/terminated/pending_approval agent rejects before create ----
test('session-llm-adapter: paused agent — rejects AGENT_NOT_INVOKABLE before sessions.create', async () => {
  for (const status of ['paused', 'terminated', 'pending_approval']) {
    const { ctx, calls } = makeFakeCtx({ agentStatus: status });
    const llm = sessionLlmAdapter(ctx, BASE_OPTS);
    await assert.rejects(
      llm.complete({ maxTokens: 6000, prompt: 'p' }),
      new RegExp(AGENT_NOT_INVOKABLE),
      `status=${status} must reject with the AGENT_NOT_INVOKABLE tag`,
    );
    assert.equal(calls.create.length, 0, `status=${status}: sessions.create must NEVER be called`);
  }
});

test('session-llm-adapter: missing agent (agents.get returns null) — rejects AGENT_NOT_INVOKABLE before create', async () => {
  const { ctx, calls } = makeFakeCtx({ agentNull: true });
  const llm = sessionLlmAdapter(ctx, BASE_OPTS);
  await assert.rejects(
    llm.complete({ maxTokens: 6000, prompt: 'p' }),
    new RegExp(AGENT_NOT_INVOKABLE),
  );
  assert.equal(calls.create.length, 0, 'a null agent must not open a session');
});

// ---- Test 6 — session always closed (happy / error / timeout paths) ----
test('session-llm-adapter: session.close called exactly once on the happy path', async () => {
  const { ctx, calls } = makeFakeCtx({ events: [chunk('x'), DONE] });
  const llm = sessionLlmAdapter(ctx, BASE_OPTS);
  await llm.complete({ maxTokens: 6000, prompt: 'p' });
  assert.equal(calls.close.length, 1);
  assert.equal(calls.close[0].sessionId, calls.create[0].sessionId);
});

test('session-llm-adapter: session.close called exactly once on the error path', async () => {
  const { ctx, calls } = makeFakeCtx({ events: [chunk('partial'), errorEvent('boom')] });
  const llm = sessionLlmAdapter(ctx, BASE_OPTS);
  await assert.rejects(llm.complete({ maxTokens: 6000, prompt: 'p' }));
  assert.equal(calls.close.length, 1);
  assert.equal(calls.close[0].sessionId, calls.create[0].sessionId);
});

test('session-llm-adapter: session.close called exactly once on the timeout path', async () => {
  const { ctx, calls } = makeFakeCtx({ replayNone: true });
  const llm = sessionLlmAdapter(ctx, { ...BASE_OPTS, timeoutMs: 50 });
  await assert.rejects(llm.complete({ maxTokens: 6000, prompt: 'p' }));
  assert.equal(calls.close.length, 1);
  assert.equal(calls.close[0].sessionId, calls.create[0].sessionId);
});

// ---- Test 7 — prompt forwarded to sendMessage; create gets a non-empty taskKey ----
test('session-llm-adapter: prompt forwarded to sendMessage; create gets a non-empty taskKey', async () => {
  const { ctx, calls } = makeFakeCtx({ events: [chunk('ok'), DONE] });
  const llm = sessionLlmAdapter(ctx, { ...BASE_OPTS, taskKeyPrefix: 'clarity-pack:bulletin:cycle-7' });
  const PROMPT = 'compile cycle 7 — facts: {...}';
  await llm.complete({ maxTokens: 6000, prompt: PROMPT });

  assert.equal(calls.sendMessage.length, 1);
  assert.equal(calls.sendMessage[0].opts.prompt, PROMPT, 'the prompt must be forwarded verbatim to sendMessage');

  assert.equal(calls.create.length, 1);
  const taskKey = calls.create[0].opts?.taskKey;
  assert.equal(typeof taskKey, 'string');
  assert.ok(taskKey.length > 0, 'create must receive a non-empty taskKey (idempotency/dedupe key)');
  assert.match(taskKey, /clarity-pack:bulletin:cycle-7/, 'taskKey must carry the supplied prefix');
});
