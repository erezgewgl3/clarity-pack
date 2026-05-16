// test/helpers/host-faithful-sessions.mjs
//
// Host-faithful `ctx.agents` fake for agent-chat-session tests.
//
// Models the ONE contract that the 2026-05-15/16 Countermoves "Session not
// found" defect turned on — and that the SDK's own permissive testing fake
// does NOT enforce.
//
// THE HOST taskKey CONTRACT (verified against Paperclip host source
// `server/src/services/plugin-host-services.ts`, `agentSessions` service):
//
//   - `create(agentId, companyId, { taskKey?, reason? })` (host L1944-1973):
//       taskKey = params.taskKey ?? `plugin:<pluginKey>:session:<randomUUID()>`
//     A caller-supplied taskKey is stored VERBATIM — no prefix added, no
//     validation. `create` always returns a real, persisted, status:"active"
//     session.
//   - `sendMessage` (L2008-2019), `list` (L1985), `close` (L2115) all look the
//     session up with `... AND taskKey LIKE 'plugin:<pluginKey>:session:%'`.
//
// So a session created with a taskKey that does NOT start with
// `plugin:<pluginKey>:session:` is inserted, hands back an "active" session,
// and is then PERMANENTLY invisible to sendMessage/close/list — a phantom.
// That is exactly the live defect: the adapter passed
// `taskKey: "clarity-pack:bulletin:cycle-1:<ts>"`, every lookup filtered it
// out, and 4 retries over 720ms could not change a static taskKey string.
//
// The fix is to OMIT taskKey so the host generates a conforming one. This fake
// models the contract so that bug reproduces locally (RED) — the SDK's
// `testing.js` fake looks sessions up by id alone and never catches it.
//
// `notFoundForFirstNSends` additionally simulates a GENUINE transient (host
// hiccup) for exercising the adapter's defensive retry.

import { randomUUID } from 'node:crypto';

/**
 * The host's installed pluginKey for Clarity Pack is the manifest `id`
 * (`src/manifest.ts` → `id: 'clarity-pack'`). The host generates and filters
 * session taskKeys against this exact prefix.
 */
export const SESSION_TASKKEY_PREFIX = 'plugin:clarity-pack:session:';

/**
 * Build a host-faithful fake `ctx.agents` (the `get` + `sessions` slice the
 * session-LLM adapter needs).
 *
 * @param {object}  opts
 * @param {string}  opts.agentStatus            — status `agents.get` reports (default 'idle').
 * @param {boolean} opts.agentNull              — when true, `agents.get` returns null.
 * @param {number}  opts.notFoundForFirstNSends — transient sim: the first N
 *                                                sendMessage attempts (per
 *                                                session) reject `Session not
 *                                                found` before succeeding.
 * @param {string|null} opts.sendMessageRejection — when set, EVERY sendMessage
 *                                                rejects with this (non-transient)
 *                                                message — for asserting the
 *                                                adapter does NOT retry a
 *                                                non-"not found" failure.
 * @param {boolean} opts.heartbeatPolicySkip     — catalogue item 4: when true,
 *                                                EVERY sendMessage throws the
 *                                                verbatim host string
 *                                                'Agent wakeup was skipped by
 *                                                heartbeat policy' — a
 *                                                DISTINCT, non-transient
 *                                                failure (≠ "Session not
 *                                                found") the host raises when
 *                                                the agent is not invokable.
 *                                                isTransientSessionNotFound
 *                                                returns false for it, so the
 *                                                adapter must NOT retry it.
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
  heartbeatPolicySkip = false,
  events = [],
  replayNone = false,
} = {}) {
  /** sessionId -> AgentSession row (carries the stored taskKey). */
  const sessions = new Map();
  /** sessionId -> count of sendMessage attempts seen so far. */
  const sendAttempts = new Map();
  const calls = { get: [], create: [], list: [], sendMessage: [], close: [] };

  /** Host-faithful lookup: a session is reachable only when its stored taskKey
   *  conforms to the host's `plugin:<pluginKey>:session:%` filter. */
  const isReachable = (session, companyId) =>
    Boolean(
      session &&
        session.status === 'active' &&
        session.companyId === companyId &&
        session.taskKey.startsWith(SESSION_TASKKEY_PREFIX),
    );

  const agents = {
    async get(agentId, companyId) {
      calls.get.push({ agentId, companyId });
      if (agentNull) return null;
      return { id: agentId, agentId, companyId, status: agentStatus, displayName: 'Editor-Agent' };
    },
    sessions: {
      async create(agentId, companyId, createOpts) {
        // Host L1949: a caller taskKey is stored verbatim; otherwise the host
        // generates a conforming `plugin:<pluginKey>:session:<uuid>`.
        const taskKey =
          createOpts?.taskKey ?? `${SESSION_TASKKEY_PREFIX}${randomUUID()}`;
        const session = {
          sessionId: randomUUID(),
          agentId,
          companyId,
          taskKey,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        sessions.set(session.sessionId, session);
        calls.create.push({ agentId, companyId, opts: createOpts, sessionId: session.sessionId });
        // `create` ALWAYS returns an active session — even when taskKey is
        // non-conforming. That is the trap: the phantom only surfaces on the
        // next call.
        return {
          sessionId: session.sessionId,
          agentId,
          companyId,
          status: 'active',
          createdAt: session.createdAt,
        };
      },

      async list(agentId, companyId) {
        calls.list.push({ agentId, companyId });
        return [...sessions.values()]
          .filter((s) => s.agentId === agentId && isReachable(s, companyId))
          .map((s) => ({
            sessionId: s.sessionId,
            agentId: s.agentId,
            companyId: s.companyId,
            status: s.status,
            createdAt: s.createdAt,
          }));
      },

      async sendMessage(sessionId, companyId, sendOpts) {
        const attempt = (sendAttempts.get(sessionId) ?? 0) + 1;
        sendAttempts.set(sessionId, attempt);
        calls.sendMessage.push({ sessionId, companyId, attempt, opts: sendOpts });

        // Catalogue item 4 — heartbeat-policy rejection. The host raises this
        // verbatim string when the agent is not invokable at wakeup time. It
        // is a DISTINCT failure from 'Session not found': isTransientSessionNot
        // Found in session-llm-adapter.ts matches only /session not found/i, so
        // this is non-transient and the adapter must NOT retry it.
        if (heartbeatPolicySkip) {
          throw new Error('Agent wakeup was skipped by heartbeat policy');
        }

        // Permanent, non-transient rejection — must NOT be retried.
        if (sendMessageRejection) {
          throw new Error(sendMessageRejection);
        }

        // Genuine-transient simulation — the first N attempts reject before
        // the session becomes messageable (host hiccup, not the taskKey bug).
        if (attempt <= notFoundForFirstNSends) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        // Host-faithful lookup. The real host ANDs id + companyId + the
        // taskKey-prefix LIKE into one SELECT; a miss on ANY of them yields a
        // bare `Session not found: <id>` (host plugin-host-services.ts L2019).
        if (!isReachable(sessions.get(sessionId), companyId)) {
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
        // close applies the SAME taskKey-prefix filter (host L2115); a
        // non-conforming session is unreachable here too.
        if (!session || session.companyId !== companyId || !session.taskKey.startsWith(SESSION_TASKKEY_PREFIX)) {
          throw new Error(`Session not found: ${sessionId}`);
        }
        session.status = 'closed';
      },
    },
  };

  return { agents, calls, sessions };
}
