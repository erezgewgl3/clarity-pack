// test/helpers/host-faithful-sessions.mjs
//
// Host-faithful `ctx.agents` fake for agent-chat-session tests.
//
// The 2026-05-15 Countermoves drill failed at the bulletin compile's LLM step:
// `ctx.agents.sessions.sendMessage(session.sessionId, …)` rejected with
// `Session not found: <sessionId>` *immediately* after a `create()` that had
// resolved with that exact, well-formed sessionId.
//
// Permissive inline fakes (test/worker/agents/session-llm-adapter.test.mjs's
// `makeFakeCtx`) never caught it — their `sendMessage` always succeeds, so the
// adapter was only ever exercised against a host that has no create→sendMessage
// gap. This helper is the `ctx.agents.sessions` analogue of
// test/helpers/host-faithful-db.mjs: it models the live host's session
// lifecycle faithfully AND can reproduce the drill failure deterministically.
//
// Faithfulness is verified against:
//   - @paperclipai/plugin-sdk@2026.512.0 `dist/testing.js` session fake
//     (create mints an `active` session; sendMessage/list/close reject an
//     unknown or company-mismatched session with `Session not found: <id>`);
//   - the canonical `plugin-llm-wiki/startWikiQuerySession` reference, which
//     performs host round-trips (`ctx.db.execute` + `ctx.streams`) between
//     `create` and `sendMessage` and therefore never observes the gap.
//
// The `notFoundForFirstNSends` knob reproduces the create→sendMessage
// visibility race: the first N `sendMessage` calls for a freshly-created
// session reject `Session not found: <id>` before the host makes the session
// messageable — exactly the live 2026-05-15 symptom.

import { randomUUID } from 'node:crypto';

/**
 * Build a host-faithful fake `ctx.agents` (the `get` + `sessions` slice the
 * session-LLM adapter needs).
 *
 * @param {object}  opts
 * @param {string}  opts.agentStatus            — status `agents.get` reports (default 'idle').
 * @param {boolean} opts.agentNull              — when true, `agents.get` returns null.
 * @param {number}  opts.notFoundForFirstNSends — race sim: the first N sendMessage
 *                                                attempts (per session) reject
 *                                                `Session not found` before the
 *                                                session becomes messageable.
 * @param {string|null} opts.sendMessageRejection — when set, EVERY sendMessage
 *                                                rejects with this (non-transient)
 *                                                message — for testing that the
 *                                                adapter does NOT retry a
 *                                                non-"not found" failure.
 * @param {Array}   opts.events                 — AgentSessionEvents replayed via
 *                                                onEvent once a send is accepted.
 * @param {boolean} opts.replayNone             — when true, an accepted send
 *                                                replays NO events (timeout path).
 * @returns {{ agents: object, calls: object, sessions: Map }}
 */
export function makeHostFaithfulAgents({
  agentStatus = 'idle',
  agentNull = false,
  notFoundForFirstNSends = 0,
  sendMessageRejection = null,
  events = [],
  replayNone = false,
} = {}) {
  /** sessionId -> AgentSession row. */
  const sessions = new Map();
  /** sessionId -> count of sendMessage attempts seen so far. */
  const sendAttempts = new Map();
  const calls = { get: [], create: [], list: [], sendMessage: [], close: [] };

  const agents = {
    async get(agentId, companyId) {
      calls.get.push({ agentId, companyId });
      if (agentNull) return null;
      return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' };
    },
    sessions: {
      async create(agentId, companyId, createOpts) {
        // The live host mints a real `AgentTaskSession` and returns it with a
        // well-formed UUID — exactly what the drill observed.
        const session = {
          sessionId: randomUUID(),
          agentId,
          companyId,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        sessions.set(session.sessionId, session);
        calls.create.push({ agentId, companyId, opts: createOpts, sessionId: session.sessionId });
        return session;
      },

      async list(agentId, companyId) {
        calls.list.push({ agentId, companyId });
        return [...sessions.values()].filter(
          (s) => s.agentId === agentId && s.companyId === companyId && s.status === 'active',
        );
      },

      async sendMessage(sessionId, companyId, sendOpts) {
        const attempt = (sendAttempts.get(sessionId) ?? 0) + 1;
        sendAttempts.set(sessionId, attempt);
        calls.sendMessage.push({ sessionId, companyId, attempt, opts: sendOpts });

        // Permanent, non-transient rejection — must NOT be retried.
        if (sendMessageRejection) {
          throw new Error(sendMessageRejection);
        }

        // Race simulation — the first N attempts reject exactly as the live
        // host did on 2026-05-15 (bare "Session not found: <id>").
        if (attempt <= notFoundForFirstNSends) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        // Host-faithful lifecycle checks (ported from testing.js semantics).
        const session = sessions.get(sessionId);
        if (!session || session.status !== 'active') {
          throw new Error(`Session not found or closed: ${sessionId}`);
        }
        if (session.companyId !== companyId) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        if (!replayNone && typeof sendOpts.onEvent === 'function') {
          // Events arrive asynchronously — the host streams them as JSON-RPC
          // notifications AFTER sendMessage resolves.
          let seq = 0;
          for (const ev of events) {
            const e = { sessionId, runId: 'run-test', seq: (seq += 1), ...ev };
            setImmediate(() => sendOpts.onEvent(e));
          }
        }
        return { runId: 'run-test' };
      },

      async close(sessionId, companyId) {
        calls.close.push({ sessionId, companyId });
        const session = sessions.get(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }
        if (session.companyId !== companyId) {
          throw new Error(`Session not found: ${sessionId}`);
        }
        session.status = 'closed';
      },
    },
  };

  return { agents, calls, sessions };
}
