// src/worker/agents/editor.ts
//
// Plan 02-03 Task 1 — Editor-Agent (Editorial Desk) wiring. Declares the
// agentKey constant the manifest agents[] block references, exposes the
// reconcile-per-company helper, and provides the heartbeat handler that runs
// when the host observes issue events.
//
// API CONTRACT — what the SDK actually exposes (verified empirically against
// @paperclipai/plugin-sdk@2026.512.0 types.d.ts):
//   - ctx.agents.managed.reconcile(agentKey, companyId) → PluginManagedAgentResolution
//   - ctx.agents.pause(agentId, companyId) — takes the resolved UUID, not key
//   - ctx.events.on(eventName, handler) — subscribe to host events
//
// The plan's pseudocode referenced a ctx.agents.onHeartbeat() API that does
// not exist at this SDK version. The dispatcher pattern we adopt instead:
// our worker listens for issue.created / issue.updated events, applies the
// self-loop filter to drop the Editor-Agent's own writes, then invokes
// compileTldr() for each affected issue. Plan 02-03 SUMMARY.md flags this for
// 02-04 + Phase 3 (Bulletin's 06:30 ET cron will use a separate
// routine/jobs.schedule path, not this dispatcher).

import { filterSelfLoopEvents, EDITOR_WRITE_TAG } from './self-loop-filter.ts';
import { compileTldr, EDITOR_AGENT_ID_TAG } from './compile-tldr.ts';
// Plan 03-05 — production LLM invocation via ctx.agents.sessions (the same
// adapter the bulletin compile uses; closes research Open-Follow-up #3 — the
// Reader's stuck "Compiling TL;DR…" was the identical ctx.llm fiction).
import { sessionLlmAdapter, type SessionLlmAdapterCtx } from './session-llm-adapter.ts';

// Stable agent key — referenced by manifest agents[] AND every reconcile call.
export const EDITOR_AGENT_KEY = 'editor-agent';

// MCP server version pin per stack contract (date-based npm versioning).
// The Editor-Agent's adapterConfig points at this; Renovate watches for bumps.
export const MCP_SERVER_VERSION = '2026.512.0';

// Re-exported so 02-04 (Situation Room critical-path narrative) and Phase 3
// (Bulletin compile) can stamp the same tag without re-importing from
// self-loop-filter directly.
export { EDITOR_WRITE_TAG, EDITOR_AGENT_ID_TAG };

export type EditorAgentReconcileCtx = {
  agents: {
    managed: {
      reconcile(agentKey: string, companyId: string): Promise<{
        agentId: string | null;
        agent: { id: string } | null;
        status: string;
      }>;
    };
  };
};

/**
 * Reconcile the Editor-Agent for a single company. Idempotent — the SDK
 * handles "already exists" by returning the resolution row with status
 * 'resolved' instead of 'created'. Called once per company at worker boot,
 * then again on the 'company.created' event for new companies that appear
 * after boot.
 */
export async function reconcileEditorAgent(
  ctx: EditorAgentReconcileCtx,
  companyId: string,
): Promise<string | null> {
  const resolution = await ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId);
  return resolution.agentId;
}

export type EditorHeartbeatPayload = {
  companyId: string;
  agentId: string;
  events: Array<{
    author_id?: string | null;
    tags?: string[] | null;
    entity_type?: string;
    entity_id?: string;
  }>;
};

// Plan 03-05: the synthetic `llm?: LlmAdapter` member is GONE — the heartbeat
// path builds a real `sessionLlmAdapter` from the resolved `payload.agentId`
// and passes it to `compileTldr` as an argument. `SessionLlmAdapterCtx`
// (the {agents.get, agents.sessions} slice) is intersected in so the ctx
// structurally satisfies the adapter factory without a cast.
export type EditorHeartbeatCtx = Parameters<typeof compileTldr>[0] &
  SessionLlmAdapterCtx & {
    issues: {
      get(issueId: string): Promise<{ id: string; body: string }>;
    };
    issue: {
      comments: { read(issueId: string): Promise<Array<{ body: string }>> };
    };
  };

/**
 * Extract BEAAA-NNN references from an issue body. Used to build the prompt
 * input set. Pure helper; exported for unit testability.
 */
export function extractRefsFromBody(body: string | undefined): string[] {
  if (!body) return [];
  return Array.from(new Set([...body.matchAll(/\bBEAAA-\d+\b/g)].map((m) => m[0])));
}

/**
 * Per-heartbeat dispatcher. Given a batch of events + the resolved agentId:
 *   1. Drop self-loop events (D-04 belt-and-suspenders).
 *   2. Bucket events by issue id.
 *   3. For each issue, read body + comments, build inputs, call compileTldr().
 *
 * Errors in any one issue do NOT abort the loop — compileTldr's recordFailure
 * path handles the circuit breaker, and subsequent issues still get a
 * chance to compile.
 */
export async function handleEditorHeartbeat(
  ctx: EditorHeartbeatCtx,
  payload: EditorHeartbeatPayload,
): Promise<void> {
  const filtered = filterSelfLoopEvents(payload.events, payload.agentId);
  const issueIds = Array.from(
    new Set(filtered.filter((e) => e.entity_type === 'issue' && e.entity_id).map((e) => e.entity_id as string)),
  );

  // Plan 03-05 — build the real session-backed LlmAdapter once per heartbeat
  // from the resolved agentId. Heartbeat compiles are best-effort: we do NOT
  // resume a paused agent here (the bulletin job owns the resume because the
  // bulletin is the scheduled, must-succeed surface). A paused agent simply
  // yields an AGENT_NOT_INVOKABLE throw from compileTldr that the per-issue
  // catch below logs and skips.
  const llm = sessionLlmAdapter(ctx, {
    agentId: payload.agentId,
    companyId: payload.companyId,
  });

  for (const issueId of issueIds) {
    try {
      const issue = await ctx.issues.get(issueId);
      const comments = await ctx.issue.comments.read(issueId);
      const refs = extractRefsFromBody(issue.body);
      await compileTldr(ctx, {
        surface: 'issue',
        scopeId: issueId,
        inputs: { body: issue.body, comments: comments.map((c) => c.body), refs },
        agentKey: EDITOR_AGENT_KEY,
        agentId: payload.agentId,
        companyId: payload.companyId,
        llm,
      });
    } catch (err) {
      // recordFailure already fired inside compileTldr; log + continue so one
      // broken issue does not deny the rest of the batch.
      ctx.logger?.warn?.('Editor-Agent compile failed for issue', { issueId, err: (err as Error).message });
    }
  }
}
