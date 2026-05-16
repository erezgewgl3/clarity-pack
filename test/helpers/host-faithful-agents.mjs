// test/helpers/host-faithful-agents.mjs
//
// Host-faithful `ctx.agents` fake — the richer sibling of
// host-faithful-sessions.mjs. Where host-faithful-sessions.mjs models the
// `sessions` slice (the taskKey namespace contract — catalogue item 2), this
// file models the agent-lifecycle slice (`get`/`resume`/`pause` +
// `managed.reconcile`) and encodes two more host-constraint catalogue items,
// each a real 2026-05-15/16 Countermoves drill defect:
//
//   Item 3 — `ctx.agents.get(agentId, companyId)`, `resume(...)`, `pause(...)`
//     require `agentId` to be a real Postgres UUID. The live host stores the
//     agent table's PK as `uuid`; passing the non-UUID `EDITOR_AGENT_ID_TAG`
//     name tag makes Postgres reject the query with
//     `invalid input syntax for type uuid: "<tag>"`. That was Defect A — the
//     compile path passed the tag to a breaker-triggered `pause`. A permissive
//     fake never catches it because a JS object map is happy with any key.
//
//   Item 8 — the manifest `agents[]` key is `editor-agent` (the value the
//     host's `managed.reconcile` is keyed on). `clarity-pack-editor-agent` is
//     a TEXT *attribution tag* only — it tags work-products and audit rows; it
//     is NEVER a UUID and NEVER an agent id. Conflating the two produced both
//     Defect A (tag → pause) and the earlier reconcile-fails defect.
//
// `managed.reconcile` ALWAYS resolves an agentKey to a real UUID `agentId` —
// modelling that the resolved id threaded into `pause`/`get`/`resume`
// downstream is, by construction, a valid UUID.
//
// The `sessions` slice is COMPOSED, not duplicated: by default it delegates to
// host-faithful-sessions.mjs's `makeHostFaithfulAgents`, so an assembled ctx
// gets ONE coherent `ctx.agents` whose `sessions` surface still enforces the
// taskKey contract (item 2) and the heartbeat-policy rejection (item 4).

import { randomUUID } from 'node:crypto';

import { makeHostFaithfulAgents as makeHostFaithfulSessions } from './host-faithful-sessions.mjs';

/**
 * The manifest `agents[]` key for the Editor-Agent — the SINGLE source of
 * truth in production is `src/worker/agents/editor.ts` (`EDITOR_AGENT_KEY`).
 * `managed.reconcile` is keyed on this exact string.
 */
export const EDITOR_AGENT_KEY = 'editor-agent';

/**
 * The Editor-Agent attribution TAG. A TEXT label only — it tags work-products
 * and audit rows. It is NOT a UUID and NOT an agent id. Passing it where the
 * host expects a UUID agentId is Defect A.
 */
export const EDITOR_AGENT_ID_TAG = 'clarity-pack-editor-agent';

/**
 * Postgres UUID v1-5 syntax. The live host's agent table PK is `uuid`; any
 * `agentId` that does not match this is rejected as `invalid input syntax for
 * type uuid` BEFORE the row is even looked up.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when `value` is a host-acceptable UUID agentId. */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Throw exactly as Postgres does for a non-UUID where a `uuid` is expected. */
function assertUuid(agentId) {
  if (!isUuid(agentId)) {
    throw new Error(`invalid input syntax for type uuid: "${agentId}"`);
  }
}

/**
 * Build a host-faithful fake `ctx.agents` covering the agent-lifecycle slice
 * (`get`/`resume`/`pause` + `managed.reconcile`) AND a composed `sessions`
 * slice.
 *
 * @param {object}  opts
 * @param {string}  opts.agentStatus  — status `get` reports (default 'idle').
 * @param {boolean} opts.agentNull    — when true, `get` returns null.
 * @param {string}  opts.reconcileAgentId — pin the UUID `managed.reconcile`
 *                                          resolves to (default: a fresh one).
 * @param {object}  opts.sessions     — an optional pre-built sessions slice +
 *                                      its `calls`. When omitted, this builds
 *                                      one via host-faithful-sessions.mjs so
 *                                      the taskKey contract (item 2) and the
 *                                      heartbeat-policy rejection (item 4)
 *                                      still hold. Pass the result of
 *                                      `makeHostFaithfulAgents` from
 *                                      host-faithful-sessions.mjs (it returns
 *                                      `{ agents: { sessions }, calls }`).
 * @param {object}  opts.sessionOpts  — opts forwarded to the composed
 *                                      host-faithful-sessions fake when this
 *                                      builds the sessions slice itself.
 * @returns {{ agents: object, calls: object }}
 */
export function makeHostFaithfulAgents({
  agentStatus = 'idle',
  agentNull = false,
  reconcileAgentId,
  sessions,
  sessionOpts = {},
} = {}) {
  // The resolved Editor-Agent UUID. `managed.reconcile` always returns this —
  // and it is, by construction, a valid UUID, so the id threaded downstream
  // into pause/get/resume is host-acceptable.
  const resolvedAgentId =
    reconcileAgentId && isUuid(reconcileAgentId) ? reconcileAgentId : randomUUID();

  // Compose the sessions slice. Delegating to host-faithful-sessions.mjs keeps
  // ONE implementation of the taskKey + heartbeat-policy contracts.
  const sessionsSlice = sessions ?? makeHostFaithfulSessions(sessionOpts);
  const sessionsApi = sessionsSlice.agents
    ? sessionsSlice.agents.sessions
    : sessionsSlice.sessions ?? sessionsSlice;
  const sessionCalls = sessionsSlice.calls ?? {};

  const calls = {
    get: [],
    resume: [],
    pause: [],
    reconcile: [],
    sessions: sessionCalls,
  };

  const agents = {
    async get(agentId, companyId) {
      // Item 3: classify BEFORE any lookup — Postgres rejects the cast first.
      assertUuid(agentId);
      calls.get.push({ agentId, companyId });
      if (agentNull) return null;
      return {
        id: agentId,
        agentId,
        companyId,
        status: agentStatus,
        displayName: 'Editor-Agent',
      };
    },

    async resume(agentId, companyId) {
      assertUuid(agentId);
      calls.resume.push({ agentId, companyId });
      return { id: agentId, agentId, companyId, status: 'idle' };
    },

    async pause(agentId, companyId) {
      assertUuid(agentId);
      calls.pause.push({ agentId, companyId });
      return { id: agentId, agentId, companyId, status: 'paused' };
    },

    managed: {
      // `reconcile` resolves a manifest agentKey to a managed agent. The
      // resolved `agentId` is ALWAYS a real UUID — never the agentKey string.
      async reconcile(agentKey, companyId) {
        calls.reconcile.push({ agentKey, companyId });
        return {
          agentId: resolvedAgentId,
          agent: {
            id: resolvedAgentId,
            agentKey,
            companyId,
            status: 'resolved',
            displayName: 'Editor-Agent',
          },
          status: 'resolved',
        };
      },
    },

    sessions: sessionsApi,
  };

  return { agents, calls, resolvedAgentId };
}
