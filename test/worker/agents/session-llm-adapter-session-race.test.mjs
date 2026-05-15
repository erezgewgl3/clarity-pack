// test/worker/agents/session-llm-adapter-session-race.test.mjs
//
// Plan 03-05 — regression coverage for the 2026-05-15 Countermoves drill
// "Session not found" defect.
//
// The live bulletin compile reached the LLM step and failed:
//   bulletin_compile_failures.reason =
//     "pass-1 failed: Session not found: f4585265-c707-4709-890a-931c57987922"
// `ctx.agents.sessions.sendMessage(session.sessionId, …)` rejected with
// `Session not found` immediately after a `create()` that had resolved with
// that exact, well-formed sessionId — a create→sendMessage visibility race the
// reference plugin (plugin-llm-wiki) never observes because it performs host
// round-trips between the two calls.
//
// These tests drive `sessionLlmAdapter` against the host-faithful
// `ctx.agents.sessions` fake (test/helpers/host-faithful-sessions.mjs), which
// reproduces that race deterministically via `notFoundForFirstNSends`. The
// permissive inline fake in session-llm-adapter.test.mjs cannot — its
// sendMessage always succeeds.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  sessionLlmAdapter,
  SEND_RETRY_ATTEMPTS,
} from '../../../src/worker/agents/session-llm-adapter.ts';
import { makeHostFaithfulAgents } from '../../helpers/host-faithful-sessions.mjs';

function chunk(message, stream = 'stdout') {
  return { eventType: 'chunk', stream, message, payload: null };
}
const DONE = { eventType: 'done', stream: 'system', message: null, payload: null };

const BASE_OPTS = { agentId: 'editor-agent-uuid', companyId: 'COU' };

// ---- Test 1 — the drill defect: a transient "Session not found" must be
//      retried, not surfaced as a compile failure. ----
test('session race: sendMessage rejected "Session not found" twice, then succeeds — complete() resolves', async () => {
  const { agents, calls } = makeHostFaithfulAgents({
    notFoundForFirstNSends: 2,
    events: [chunk('Hello '), chunk('world'), DONE],
  });
  const llm = sessionLlmAdapter({ agents, logger: undefined }, { ...BASE_OPTS, timeoutMs: 5000 });

  const out = await llm.complete({ maxTokens: 6000, prompt: 'compile the bulletin' });

  assert.equal(out, 'Hello world', 'the accumulated LLM text must survive the transient retries');
  assert.equal(
    calls.sendMessage.length,
    3,
    'sendMessage must be attempted 3x: 2 transient not-found rejections + 1 success',
  );
  // All attempts target the SAME freshly-created session.
  const sid = calls.create[0].sessionId;
  assert.ok(
    calls.sendMessage.every((c) => c.sessionId === sid),
    'every retry must target the session create() returned',
  );
  assert.equal(calls.close.length, 1, 'the session is still closed exactly once');
});

// ---- Test 2 — retries are bounded: a session that never settles fails the
//      compile with a message that proves retries were exhausted. ----
test('session race: a session that never becomes messageable rejects after the bounded retries', async () => {
  const { agents, calls } = makeHostFaithfulAgents({
    notFoundForFirstNSends: 999,
    events: [chunk('unreachable'), DONE],
  });
  const llm = sessionLlmAdapter({ agents }, { ...BASE_OPTS, timeoutMs: 5000 });

  await assert.rejects(
    llm.complete({ maxTokens: 6000, prompt: 'p' }),
    (err) => {
      assert.match(err.message, /session not found/i);
      assert.match(
        err.message,
        new RegExp(`${SEND_RETRY_ATTEMPTS}`),
        'the exhausted-retries rejection must report the attempt count for drill evidence',
      );
      return true;
    },
  );
  assert.equal(
    calls.sendMessage.length,
    SEND_RETRY_ATTEMPTS,
    `sendMessage must be attempted exactly SEND_RETRY_ATTEMPTS (${SEND_RETRY_ATTEMPTS}) times`,
  );
});

// ---- Test 3 — the retry is SCOPED to "Session not found": a non-transient
//      sendMessage failure (e.g. budget exhausted) must fail fast, no retry. ----
test('session race: a non-"not found" sendMessage rejection is NOT retried', async () => {
  const { agents, calls } = makeHostFaithfulAgents({
    sendMessageRejection: 'agent budget exhausted for this billing period',
  });
  const llm = sessionLlmAdapter({ agents }, { ...BASE_OPTS, timeoutMs: 5000 });

  await assert.rejects(
    llm.complete({ maxTokens: 6000, prompt: 'p' }),
    /budget exhausted/,
  );
  assert.equal(
    calls.sendMessage.length,
    1,
    'a non-transient failure must NOT be retried — exactly one sendMessage attempt',
  );
});

// ---- Test 4 — instrumentation: the created session is logged so the next
//      live drill has decisive create/sendMessage evidence. ----
test('session race: the created session is logged with its sessionId for drill evidence', async () => {
  const infoLines = [];
  const logger = {
    info: (msg) => infoLines.push(String(msg)),
    warn() {},
    error() {},
    debug() {},
  };
  const { agents, calls } = makeHostFaithfulAgents({ events: [chunk('ok'), DONE] });
  const llm = sessionLlmAdapter({ agents, logger }, { ...BASE_OPTS, timeoutMs: 5000 });

  await llm.complete({ maxTokens: 6000, prompt: 'p' });

  const sid = calls.create[0].sessionId;
  assert.ok(
    infoLines.some((line) => line.includes(sid)),
    'an info log must carry the created sessionId (host drops log metadata — it must be in the message string)',
  );
});

// ---- Test 5 — no regression: the happy path issues exactly one sendMessage. ----
test('session race: happy path with no race issues exactly one sendMessage (no spurious retry)', async () => {
  const { agents, calls } = makeHostFaithfulAgents({ events: [chunk('clean'), DONE] });
  const llm = sessionLlmAdapter({ agents }, { ...BASE_OPTS, timeoutMs: 5000 });

  const out = await llm.complete({ maxTokens: 6000, prompt: 'p' });

  assert.equal(out, 'clean');
  assert.equal(calls.sendMessage.length, 1, 'a clean send must not trigger any retry');
});
