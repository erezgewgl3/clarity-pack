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

import type { PluginIssuesClient } from '@paperclipai/plugin-sdk';

import { filterSelfLoopEvents, EDITOR_WRITE_TAG } from './self-loop-filter.ts';
import { compileTldr, EDITOR_AGENT_ID_TAG } from './compile-tldr.ts';
// Plan 03-06 — production LLM invocation via the operation-issue handoff (the
// same delivery layer the bulletin compile uses). Plan 03-05's session-backed
// adapter is superseded: the host discards the session prompt (PR #3106), so
// the Reader's stuck "Compiling TL;DR…" was the same broken path. The TL;DR
// compile prompt is now delivered as an operation issue
// (originKind plugin:clarity-pack:operation:tldr-compile).
import { deliveryLlmAdapter, type AgentTaskDeliveryCtx } from './agent-task-delivery.ts';

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

// Plan 03-06: the heartbeat path builds a real `deliveryLlmAdapter` from the
// resolved `payload.agentId` and passes it to `compileTldr` as an argument.
// `AgentTaskDeliveryCtx` (the `{issues: list/create/requestWakeup/listComments,
// logger}` slice) is intersected in so the ctx structurally satisfies the
// adapter factory without a cast. The `issues` member is widened to the full
// `PluginIssuesClient` so it satisfies BOTH the adapter slice AND this
// handler's own `ctx.issues.get` reads.
export type EditorHeartbeatCtx = Parameters<typeof compileTldr>[0] &
  AgentTaskDeliveryCtx & {
    issues: PluginIssuesClient;
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

  // Plan 03-06 — heartbeat compiles are best-effort: we do NOT resume a paused
  // agent here (the bulletin job owns the resume because the bulletin is the
  // scheduled, must-succeed surface). A paused agent simply yields a delivery
  // timeout from compileTldr that the per-issue catch below logs and skips.
  for (const issueId of issueIds) {
    try {
      const issue = await ctx.issues.get(issueId, payload.companyId);
      if (!issue) continue;
      const comments = await ctx.issue.comments.read(issueId);
      const refs = extractRefsFromBody(issue.description ?? undefined);
      // Plan 03-06 — build the operation-issue-backed adapter PER ISSUE: the
      // operationId must be unique per TL;DR scope so the idempotency search
      // never collapses two different issues' compiles onto one operation issue.
      const llm = deliveryLlmAdapter(ctx, {
        agentId: payload.agentId,
        companyId: payload.companyId,
        operationKind: 'tldr-compile',
        operationId: `tldr-${issueId}`,
        title: `Compile TL;DR — ${issueId}`,
      });
      await compileTldr(ctx, {
        surface: 'issue',
        scopeId: issueId,
        inputs: {
          body: issue.description ?? '',
          comments: comments.map((c) => c.body),
          refs,
        },
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
