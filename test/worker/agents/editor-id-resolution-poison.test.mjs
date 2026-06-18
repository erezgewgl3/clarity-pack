// test/worker/agents/editor-id-resolution-poison.test.mjs
//
// Debug: tldr-compile-op-misassigned-agent (2026-06-18) — tldr-compile (and
// every clarity-pack) operation issue is assigned to the WRONG agent (the
// triggering / source-issue owner, e.g. the CTO; the CEO under recovery) instead
// of the dedicated managed Editor-Agent. The misassigned agent has no Clarity
// execution path → the op never terminalizes → the Reader wedges on "Compiling…"
// forever + Paperclip's terminal-run-recovery churns the wrong agents.
//
// ROOT CAUSE (b) — pinned at src/worker/agents/editor.ts:717-743
// (resolveEditorAgentId). Its PRIMARY strategy lists the newest plugin operation
// issues via ctx.issues.list({originKindPrefix, includePluginOperations}) WITHOUT
// an assigneeAgentId filter (the SDK list filter is optional — types.d.ts:1061),
// then returns ops[0].assigneeAgentId as "the Editor-Agent" (editor.ts:728-731).
// This is a self-referential resolution: once a host-side terminal-run-recovery
// reassignment lands a NON-editor assignee (CTO/CEO) on ANY clarity op, the
// resolver reads it back and returns that wrong id, and every NEW op is then
// created with the same wrong assignee (startAgentTask → create assigneeAgentId,
// agent-task-delivery.ts:471) — a permanent, self-propagating misassignment.
//
// THE FIX — resolve the editor id from the AUTHORITATIVE managed-agent registry
// (ctx.agents.managed.get/reconcile by the stable EDITOR_AGENT_KEY — the same
// source compile-bulletin.ts:854 already trusts) and STOP trusting op-issue
// assignees as the source of truth. reconcile resolves by resourceKey →
// PluginManagedAgentResolution.agentId (shared plugin.d.ts:230), which cannot be
// poisoned by a reassigned op.
//
// These tests model the poison with PER-FIELD fidelity: the newest op is assigned
// to the CTO, and ctx.agents.managed.reconcile returns the editor. The ONLY way
// to return the editor id is to consult the registry, not the op assignee.
//
// RED (current code): resolveEditorAgentId returns the CTO; the Reader driver
// creates the next op assigned to the CTO.
// GREEN (after fix):   both return / assign the EDITOR.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  resolveEditorAgentId,
  driveTldrCompileStep,
} from '../../../src/worker/agents/editor.ts';
import {
  operationOriginKind,
  OPERATION_ORIGIN_KIND_PREFIX,
} from '../../../src/worker/agents/agent-task-delivery.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';

const CID = 'co-1';
// The live CounterMoves UUIDs from the debug session (verbatim, for fidelity).
const EDITOR_UUID = 'd385f16a-e2d3-409c-bed7-b4e06eecc30d'; // role=editor — the ONLY correct assignee
const CTO_UUID = 'fe557a0e-54f4-437d-b009-5dccd5a8dd54'; // source-issue owner — the poison
const ISSUE = 'COU-592';

const inputs = { body: 'a normal-length task body', comments: [], refs: ['COU-1'] };

// A ctx whose:
//   - issues.list({originKindPrefix}) returns the seeded operation issues (NO
//     assignee filtering unless the caller passes assigneeAgentId — mirrors the
//     real SDK so a fix that ADDS the filter is observable).
//   - agents.managed.reconcile(agentKey, companyId) returns the AUTHORITATIVE
//     editor id (resolves by stable key, never poisoned).
//   - documents readback is controllable via `ready`.
function makeCtx({
  seedOps = [],
  reconcileEditorId = EDITOR_UUID,
  ready = false,
  resultBody = 'crisp tldr',
  agentStatus = 'idle',
} = {}) {
  const tldrCache = [];
  const operationIssues = [...seedOps]; // {id, originId, originKind, status, assigneeAgentId, createdAt}
  const updates = [];
  const reconcileCalls = [];
  const state = { ready, resultBody };

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: {
      async get() {
        return { status: agentStatus, pausedAt: agentStatus === 'paused' ? new Date().toISOString() : null };
      },
      managed: {
        async reconcile(agentKey, companyId) {
          reconcileCalls.push({ agentKey, companyId });
          return { agentId: reconcileEditorId, agent: reconcileEditorId ? { id: reconcileEditorId } : null, status: 'resolved' };
        },
        async get(agentKey, companyId) {
          reconcileCalls.push({ agentKey, companyId, via: 'get' });
          return { agentId: reconcileEditorId, agent: reconcileEditorId ? { id: reconcileEditorId } : null, status: 'resolved' };
        },
      },
    },
    db: {
      async query(sql, params) {
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scopeId] = params;
          return tldrCache
            .filter((r) => r.surface === surface && r.scope_id === scopeId)
            .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))
            .slice(0, 1);
        }
        if (/SELECT consecutive[\s\S]*editor_agent_failures/i.test(sql)) return [];
        return [];
      },
      async execute(sql, params) {
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scope_id, content_hash, body, generated_at, , , tags] = params;
          tldrCache.push({ surface, scope_id, content_hash, body, generated_at, tags });
        }
        return { rowCount: 1 };
      },
    },
    issues: {
      async list(input = {}) {
        if (input.originKindPrefix) {
          return operationIssues.filter(
            (oi) =>
              oi.originKind &&
              oi.originKind.startsWith(input.originKindPrefix) &&
              (input.originId === undefined || oi.originId === input.originId) &&
              // Mirror the real SDK: assigneeAgentId is an OPTIONAL filter. If the
              // resolver (post-fix) narrows the list to the editor, a CTO-assigned
              // op is correctly excluded here.
              (input.assigneeAgentId === undefined || oi.assigneeAgentId === input.assigneeAgentId),
          );
        }
        return [];
      },
      async create(args) {
        const created = {
          id: `op-${operationIssues.length + 1}`,
          status: 'todo',
          assigneeAgentId: args.assigneeAgentId,
          originId: args.originId,
          originKind: args.originKind,
          createdAt: new Date(),
        };
        operationIssues.push(created);
        return created;
      },
      async update(issueId, patch) {
        updates.push({ issueId, patch });
        const op = operationIssues.find((o) => o.id === issueId);
        if (op && patch.status) op.status = patch.status;
        return { id: issueId };
      },
      async requestWakeup() {
        return { queued: true };
      },
      async listComments() {
        return [];
      },
      documents: {
        async list(issueId) {
          return state.ready
            ? [{ id: 'd', issueId, key: 'compile-result', format: 'markdown', createdAt: new Date(), updatedAt: new Date() }]
            : [];
        },
        async get(issueId, key) {
          return state.ready && key === 'compile-result'
            ? { id: 'd', issueId, key, format: 'markdown', createdAt: new Date(), updatedAt: new Date(), body: state.resultBody }
            : null;
        },
      },
    },
  };
  return { ctx, tldrCache, operationIssues, updates, reconcileCalls, state };
}

// The poison: a host terminal-run-recovery reassigned the newest clarity op to
// the CTO (the source-issue owner). Its originKind is in the clarity operation
// namespace, so the (buggy) read-back resolver picks it up.
function poisonedCtoOp(kind = 'tldr-compile') {
  return {
    id: 'op-poison',
    originId: `tldr-${ISSUE}`,
    originKind: operationOriginKind(kind),
    status: 'in_progress',
    assigneeAgentId: CTO_UUID, // <-- WRONG: a non-editor agent, written by host recovery
    createdAt: new Date(),
  };
}

test('resolveEditorAgentId — a CTO-reassigned op must NOT poison the editor id; returns the managed editor', async () => {
  resetCircuitBreakerState();
  // The newest clarity op is assigned to the CTO (host recovery reassignment).
  // The managed registry still resolves the dedicated editor.
  const { ctx } = makeCtx({ seedOps: [poisonedCtoOp()], reconcileEditorId: EDITOR_UUID });

  const resolved = await resolveEditorAgentId(ctx, CID);

  assert.equal(
    resolved,
    EDITOR_UUID,
    `resolveEditorAgentId must return the dedicated managed Editor-Agent (${EDITOR_UUID}), ` +
      `NOT the agent a host recovery reassigned the op to (${CTO_UUID}). ` +
      `Got ${resolved} — the op-issue assignee poisoned the resolution.`,
  );
  assert.notEqual(resolved, CTO_UUID, 'must never resolve the triggering / source-issue (CTO) agent');
});

test('driveTldrCompileStep — with a CTO-poisoned op present, a NEW tldr-compile op is assigned to the EDITOR, not the CTO', async () => {
  resetCircuitBreakerState();
  // Poison present, agent has NOT answered (ready:false) → the driver spawns a
  // fresh op. That op MUST be assigned to the editor, not the CTO. We use a
  // DIFFERENT scope id than the poison op so consume-before-spawn (which matches
  // on originId tldr-<issueId>) does not short-circuit — we want the fresh
  // create path so we can assert its assignee.
  const FRESH_ISSUE = 'COU-777';
  const poison = { ...poisonedCtoOp(), originId: `tldr-${ISSUE}` }; // different originId than FRESH_ISSUE
  const { ctx, operationIssues } = makeCtx({ seedOps: [poison], reconcileEditorId: EDITOR_UUID, ready: false });

  const res = await driveTldrCompileStep(ctx, { issueId: FRESH_ISSUE, companyId: CID, inputs });
  assert.equal(res.status, 'compiling', `cache miss + slow agent → compiling; got ${res.status}`);

  const freshTldrOps = operationIssues.filter(
    (o) => o.originKind.includes('tldr-compile') && o.originId === `tldr-${FRESH_ISSUE}`,
  );
  assert.equal(freshTldrOps.length, 1, 'exactly one fresh tldr-compile op started for the new issue');
  assert.equal(
    freshTldrOps[0].assigneeAgentId,
    EDITOR_UUID,
    `the fresh op must be assigned to the dedicated Editor-Agent (${EDITOR_UUID}); ` +
      `got ${freshTldrOps[0].assigneeAgentId}. A CTO-assigned op is propagating the misassignment.`,
  );
  assert.notEqual(
    freshTldrOps[0].assigneeAgentId,
    CTO_UUID,
    'the fresh op must NEVER be assigned to the triggering / source-issue (CTO) agent',
  );
});

test('resolveEditorAgentId — with NO ops yet (brand-new company), still resolves the managed editor', async () => {
  resetCircuitBreakerState();
  // No seeded ops at all — the resolver must resolve via the managed registry.
  // (This already worked via the fallback; the fix must not regress it.)
  const { ctx } = makeCtx({ seedOps: [], reconcileEditorId: EDITOR_UUID });
  const resolved = await resolveEditorAgentId(ctx, CID);
  assert.equal(resolved, EDITOR_UUID, 'a brand-new company with no ops must resolve the editor via the registry');
});

test('resolveEditorAgentId — an editor-assigned op present + registry agree → still the editor (no behavior change for the healthy case)', async () => {
  resetCircuitBreakerState();
  const healthyEditorOp = {
    id: 'op-ok',
    originId: 'cycle-1',
    originKind: operationOriginKind('bulletin-compile'),
    status: 'done',
    assigneeAgentId: EDITOR_UUID,
    createdAt: new Date(),
  };
  const { ctx } = makeCtx({ seedOps: [healthyEditorOp], reconcileEditorId: EDITOR_UUID });
  const resolved = await resolveEditorAgentId(ctx, CID);
  assert.equal(resolved, EDITOR_UUID, 'the healthy case (op + registry both the editor) is unchanged');
});

// Guard the constant the resolver namespaces on, so a future rename of the
// operation prefix can't silently bypass this regression test.
test('OPERATION_ORIGIN_KIND_PREFIX is the clarity operation namespace the poison op matches', () => {
  assert.ok(
    operationOriginKind('tldr-compile').startsWith(OPERATION_ORIGIN_KIND_PREFIX),
    'tldr-compile origin kind must be under the operation prefix the resolver lists by',
  );
});
