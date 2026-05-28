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
import {
  compileTldr,
  prepareTldrCompile,
  finalizeTldr,
  tldrContentHash,
  EDITOR_AGENT_ID_TAG,
  TLDR_TRUNCATED_TAG,
} from './compile-tldr.ts';
import { getTldrByScope, type TldrRow } from '../db/tldr-cache.ts';
// Plan 03-06 — production LLM invocation via the operation-issue handoff (the
// same delivery layer the bulletin compile uses). The TL;DR compile prompt is
// delivered as an operation issue (originKind
// plugin:clarity-pack:operation:tldr-compile).
//
// Delivery-layer rework (2026-05-28) — the synchronous in-invocation 5-min poll
// (deliveryLlmAdapter → compileTldr) is replaced by a cross-tick flow: the
// heartbeat does startAgentTask + ONE immediate pollAgentTaskResult (warm agent
// → finalize now), and a drainer (run from the compile-bulletin job) consumes a
// slow agent's result on a LATER tick. No invocation outlives its host-validity
// window (paperclipai@2026.525.0 expires it mid-poll — PR #6547).
import {
  startAgentTask,
  pollAgentTaskResult,
  AGENT_TASK_DELIVERY_TIMEOUT,
  OPERATION_ORIGIN_KIND_PREFIX,
  operationOriginKind,
  type AgentTaskDeliveryCtx,
} from './agent-task-delivery.ts';

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
// The handler reads comments via `ctx.issues.listComments(issueId, companyId)`
// — the real host API. An earlier revision typed a fictional
// `ctx.issue.comments.read` member that the host PluginContext never provides;
// `ctx.issue` was `undefined` at runtime and every heartbeat TL;DR compile
// threw `Cannot read properties of undefined (reading 'comments')`. Surfaced
// on the 2026-05-17 v0.6.3 drill.
export type EditorHeartbeatCtx = Parameters<typeof compileTldr>[0] &
  AgentTaskDeliveryCtx & {
    issues: PluginIssuesClient;
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
 * True when an issue is one of the plugin's OWN operation issues — i.e. its
 * `originKind` starts with `plugin:clarity-pack:operation:` (the namespace
 * `deliverAgentTask` stamps onto every `tldr-compile` / `bulletin-compile`
 * operation issue).
 *
 * v0.6.5 — Bug 1 (tldr-heartbeat-recursion). The heartbeat dispatcher used to
 * `compileTldr` EVERY observed issue, including the `tldr-compile` operation
 * issues the dispatcher itself spawned. Each such compile created the NEXT
 * `tldr-compile` operation issue → an unbounded `issue.created` cascade
 * (`originId=tldr-<prev-operation-issue-id>` chains in the worker log are the
 * proof). It was LATENT until v0.6.4 — the heartbeat crashed instantly on the
 * `ctx.issue` typo, an accidental circuit breaker. The v0.6.4 typo fix
 * un-crashed the path WITHOUT this guard and unleashed the recursion.
 *
 * The plugin must NEVER TL;DR-compile its own plumbing. This is the same
 * exclusion the standing-number SQL already applies
 * (`origin_kind NOT LIKE 'plugin:clarity-pack:operation:%'`). Coexistence
 * guarantee #2 (operation issues stay off Eric's human board) is preserved —
 * a `plugin_operation`-visibility issue is never a thing the Reader surfaces
 * a TL;DR for anyway.
 */
export function isOwnOperationIssue(issue: {
  originKind?: string | null;
}): boolean {
  const kind = issue.originKind ?? '';
  return kind.startsWith(OPERATION_ORIGIN_KIND_PREFIX);
}

/**
 * Per-heartbeat dispatcher. Given a batch of events + the resolved agentId:
 *   1. Drop self-loop events (D-04 belt-and-suspenders).
 *   2. Bucket events by issue id.
 *   3. For each issue, read body + comments, build inputs, call compileTldr().
 *
 * Bug 1 (v0.6.5) — after `ctx.issues.get`, SKIP any issue whose `originKind`
 * is in the `plugin:clarity-pack:operation:` namespace. The plugin must never
 * TL;DR-compile its own operation issues — doing so spawns the next operation
 * issue and recurses unbounded.
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

      // Bug 1 (v0.6.5) — HARD GUARD against the heartbeat→operation-issue→
      // heartbeat recursion. A `tldr-compile` (or any
      // `plugin:clarity-pack:operation:*`) operation issue must NEVER itself
      // trigger a TL;DR compile: that compile would spawn the next operation
      // issue, which is itself an `issue.created` event, unbounded. Skip the
      // plugin's own plumbing before `deliveryLlmAdapter`/`compileTldr` run.
      if (isOwnOperationIssue(issue)) {
        ctx.logger?.info?.(
          'Editor-Agent: skipped own operation issue (recursion guard)',
          { issueId, originKind: (issue as { originKind?: string | null }).originKind ?? null },
        );
        continue;
      }

      const comments = await ctx.issues.listComments(issueId, payload.companyId);
      const inputs = {
        body: issue.description ?? '',
        comments: comments.map((c) => c.body),
        refs: extractRefsFromBody(issue.description ?? undefined),
      };

      // Delivery-layer rework (2026-05-28) — prepare (EDITOR-03 cache check +
      // EDITOR-05 token cap), then START the operation-issue handoff + ONE
      // immediate poll. A warm agent's result is finalized now; a slow one is
      // LEFT for the compile-bulletin job's drainer (drainTldrOperations) to
      // consume on a later tick. The operationId is unique per TL;DR scope so the
      // idempotency search never collapses two issues' compiles onto one op issue.
      const prep = await prepareTldrCompile(ctx, {
        surface: 'issue',
        scopeId: issueId,
        inputs,
        agentKey: EDITOR_AGENT_KEY,
        agentId: payload.agentId,
        companyId: payload.companyId,
      });
      // cache-hit (a fresh TL;DR is already cached) or capped (recordFailure has
      // already fired) → nothing to deliver this heartbeat.
      if (prep.kind !== 'compile') continue;

      const started = await startAgentTask(ctx, {
        agentId: payload.agentId,
        companyId: payload.companyId,
        operationKind: 'tldr-compile',
        operationId: `tldr-${issueId}`,
        title: `Compile TL;DR — ${issueId}`,
        prompt: prep.prompt,
      });
      const poll = await pollAgentTaskResult(ctx, {
        operationIssueId: started.operationIssueId,
        companyId: payload.companyId,
        operationKind: 'tldr-compile',
        agentId: payload.agentId,
      });
      if (poll.status === 'ready') {
        await finalizeTldr(ctx, {
          surface: 'issue',
          scopeId: issueId,
          contentHash: prep.contentHash,
          body: poll.body,
          agentKey: EDITOR_AGENT_KEY,
          agentId: payload.agentId,
          companyId: payload.companyId,
        });
      }
      // else: not ready in this invocation — drainTldrOperations consumes it later.
    } catch (err) {
      // Defect C (2026-05-17 v0.6.2 re-drill). This catch is the per-ISSUE
      // skip path of the HEARTBEAT TL;DR dispatcher — NOT the bulletin
      // compile, and NOT a genuine compile-failure signal:
      //   - `compileTldr` has ALREADY fired `recordFailure` for a real LLM
      //     failure before it re-throws, so the circuit breaker is handled.
      //   - Best-effort heartbeat compiles legitimately throw a delivery
      //     timeout when the Editor-Agent is paused (see the comment above) —
      //     an EXPECTED skip, not a failure.
      // The prior message `Editor-Agent compile failed for issue` overstated
      // every skip as a failure: it fired with the published bulletin's issue
      // id on a SUCCESSFUL bulletin cycle (the bulletin issue is itself an
      // `issue.created` event the dispatcher then tries to TL;DR-compile) and
      // misled the v0.6.2 drill into reading a healthy cycle as broken.
      // Corrected to name what it actually is — a skipped per-issue TL;DR
      // compile — and logged at `info`, the severity of a benign skip.
      ctx.logger?.info?.('Editor-Agent: skipped TL;DR compile for issue', {
        issueId,
        reason: (err as Error).message,
      });
    }
  }
}

/**
 * Delivery-layer rework (2026-05-28) — read the TL;DR compile inputs for an
 * issue. Shared by the heartbeat (implicitly) and the drainer (which re-reads
 * the inputs to key the cache row by the SAME content hash the heartbeat used).
 * Tolerant: a missing issue / failing listComments degrade to empty.
 */
export async function readTldrInputs(
  issues: Pick<PluginIssuesClient, 'get' | 'listComments'>,
  issueId: string,
  companyId: string,
): Promise<{ body: string; comments: string[]; refs: string[] }> {
  const target = await issues.get(issueId, companyId);
  const body = target?.description ?? '';
  let comments: string[] = [];
  try {
    comments = (await issues.listComments(issueId, companyId)).map((c) => c.body);
  } catch {
    comments = [];
  }
  return { body, comments, refs: extractRefsFromBody(body) };
}

/** The outcome of one view-driven TL;DR compile step (see {@link driveTldrCompileStep}). */
export type TldrCompileStepResult = {
  /** The cached/freshly-consumed TL;DR row, or null while compiling/unavailable. */
  tldr: TldrRow | null;
  /**
   * - `cached`      — a fresh TL;DR is available now (cache hit or just consumed).
   * - `compiling`   — the Editor-Agent is working; poll again shortly.
   * - `paused`      — the Editor-Agent is paused; it won't compile until resumed
   *                   (an explicit operator action — we never auto-resume on a
   *                   passive Reader view). The UI surfaces an honest note.
   * - `unavailable` — no Editor-Agent could be resolved (can't start a compile).
   */
  status: 'cached' | 'compiling' | 'paused' | 'unavailable';
  /** True when the cached/consumed TL;DR summarized a TRUNCATED (very long) task. */
  truncated: boolean;
};

/** ctx the view-driven TL;DR driver needs — satisfied by the issue.reader handler ctx. */
export type TldrViewDriverCtx = Parameters<typeof prepareTldrCompile>[0] &
  AgentTaskDeliveryCtx & {
    issues: Pick<
      PluginIssuesClient,
      'list' | 'create' | 'requestWakeup' | 'listComments' | 'update'
    > & { documents: PluginIssuesClient['documents'] };
    agents?: {
      get?(agentId: string, companyId: string): Promise<{ status?: string; pausedAt?: string | null } | null>;
      managed?: { reconcile(agentKey: string, companyId: string): Promise<{ agentId: string | null }> };
    };
  };

/**
 * Resolve the Editor-Agent UUID for a company WITHOUT a scheduled-job reconcile
 * (whose invocation scope is dead on paperclipai@2026.525.0 — PR #6547). Every
 * clarity-pack operation issue is assigned to the Editor-Agent, so the newest
 * one's `assigneeAgentId` is the id — discovered with the same `ctx.issues.list`
 * the data handler already uses in its valid request scope. Falls back to
 * `ctx.agents.managed.reconcile` (best-effort) only when no operation issue
 * exists yet (a brand-new company).
 */
async function resolveEditorAgentId(
  ctx: TldrViewDriverCtx,
  companyId: string,
): Promise<string | null> {
  try {
    const ops = await ctx.issues.list({
      companyId,
      originKindPrefix: OPERATION_ORIGIN_KIND_PREFIX,
      includePluginOperations: true,
      limit: 5,
    });
    for (const op of ops ?? []) {
      const id = (op as { assigneeAgentId?: string | null }).assigneeAgentId;
      if (id) return id;
    }
  } catch (e) {
    ctx.logger?.warn?.(`tldr-view: op-issue agent discovery failed: ${(e as Error).message}`, {
      companyId,
    });
  }
  try {
    const res = await ctx.agents?.managed?.reconcile(EDITOR_AGENT_KEY, companyId);
    return res?.agentId ?? null;
  } catch {
    return null;
  }
}

/**
 * View-driven rework (2026-05-28) — advance the TL;DR compile for ONE issue by
 * exactly one step, in the CALLER's (valid HTTP-request) invocation scope. This
 * replaces the dead scheduled-job/heartbeat driver: the `issue.reader` data
 * handler calls this on every Reader open/poll, so opening a task BECOMES the
 * compile trigger.
 *
 *   - cache hit (fresh TL;DR, task unchanged) → return it instantly, no compile.
 *   - cache miss → resolve the Editor-Agent, START (or reuse) the operation
 *     issue + ONE immediate poll. If the agent has already answered → finalize +
 *     cache now (and mark the op done so a later task EDIT starts a fresh
 *     compile rather than reusing the stale op). Otherwise → `compiling`.
 *
 * Bounded host calls per request (a handful) — well within a request scope.
 */
export async function driveTldrCompileStep(
  ctx: TldrViewDriverCtx,
  args: { issueId: string; companyId: string; inputs: { body: string; comments: string[]; refs: string[] } },
): Promise<TldrCompileStepResult> {
  const { issueId, companyId, inputs } = args;

  const prep = await prepareTldrCompile(ctx, {
    surface: 'issue',
    scopeId: issueId,
    inputs,
    agentKey: EDITOR_AGENT_KEY,
    agentId: '', // unused by prepare (cache check + truncate only)
    companyId,
  });
  if (prep.kind === 'cache-hit') {
    return {
      tldr: prep.tldr,
      status: 'cached',
      truncated: (prep.tldr.tags ?? []).includes(TLDR_TRUNCATED_TAG),
    };
  }

  // Cache MISS. Fetch the latest cached row (regardless of hash) as a STALE
  // fallback so the Reader shows the existing TL;DR while a fresh one compiles,
  // rather than blanking it.
  let stale: TldrRow | null = null;
  try {
    stale = await getTldrByScope(ctx, 'issue', issueId);
  } catch {
    stale = null;
  }
  const staleTruncated = !!stale && (stale.tags ?? []).includes(TLDR_TRUNCATED_TAG);

  const editorAgentId = await resolveEditorAgentId(ctx, companyId);
  if (!editorAgentId) {
    ctx.logger?.info?.('tldr-view: no Editor-Agent resolvable — cannot start TL;DR compile', {
      issueId,
      companyId,
    });
    // Show the stale TL;DR if we have one; otherwise it's genuinely unavailable.
    return { tldr: stale, status: stale ? 'cached' : 'unavailable', truncated: staleTruncated };
  }

  // A PAUSED agent will never process the compile, and we do NOT auto-resume on
  // a passive Reader view (resume is an explicit operator action — governance
  // decision 2026-05-28). Detect it (best-effort, read-only) and report 'paused'
  // so the Reader shows an honest "resume me" note instead of "Compiling…"
  // forever. (No status read available → fall through and try to compile.)
  try {
    const agent = await ctx.agents?.get?.(editorAgentId, companyId);
    if (agent && (agent.status === 'paused' || agent.pausedAt != null)) {
      ctx.logger?.info?.('tldr-view: Editor-Agent is paused — not starting (no auto-resume on view)', {
        issueId,
        companyId,
      });
      return { tldr: stale, status: 'paused', truncated: staleTruncated };
    }
  } catch {
    /* status unknown — fall through and attempt the compile */
  }

  // START (or reuse the in-flight op via idempotency) + one immediate poll.
  let operationIssueId: string;
  try {
    const started = await startAgentTask(ctx, {
      agentId: editorAgentId,
      companyId,
      operationKind: 'tldr-compile',
      operationId: `tldr-${issueId}`,
      title: `Compile TL;DR — ${issueId}`,
      prompt: prep.prompt,
    });
    operationIssueId = started.operationIssueId;
  } catch (e) {
    ctx.logger?.warn?.(`tldr-view: startAgentTask failed: ${(e as Error).message}`, { issueId, companyId });
    return { tldr: stale, status: 'compiling', truncated: staleTruncated };
  }

  const poll = await pollAgentTaskResult(ctx, {
    operationIssueId,
    companyId,
    operationKind: 'tldr-compile',
    agentId: editorAgentId,
  });
  if (poll.status !== 'ready') {
    return { tldr: stale, status: 'compiling', truncated: staleTruncated };
  }

  const tldr = await finalizeTldr(ctx, {
    surface: 'issue',
    scopeId: issueId,
    contentHash: prep.contentHash,
    body: poll.body,
    agentKey: EDITOR_AGENT_KEY,
    agentId: editorAgentId,
    companyId,
    truncated: prep.truncated,
  });

  // Mark the operation issue done so a later task EDIT (which changes the
  // content hash → cache miss) starts a FRESH compile instead of the
  // idempotency search reusing this now-consumed op. Best-effort.
  try {
    await ctx.issues.update(operationIssueId, { status: 'done' }, companyId);
  } catch (e) {
    ctx.logger?.info?.('tldr-view: could not mark op issue done (non-fatal)', {
      operationIssueId,
      reason: (e as Error).message,
    });
  }

  return { tldr, status: 'cached', truncated: prep.truncated };
}

/** The drainer's recency window — operations older than this are given up on. */
const TLDR_DRAIN_RECENCY_MS = 2 * AGENT_TASK_DELIVERY_TIMEOUT;

/** ctx the TL;DR drainer needs: the heartbeat surface plus agent reconcile. */
export type TldrDrainerCtx = EditorHeartbeatCtx & EditorAgentReconcileCtx;

/**
 * Delivery-layer rework (2026-05-28) — drain in-flight TL;DR operation issues.
 *
 * Driven off the operation ISSUES (raw-text TL;DRs need no ctx.state freezing).
 * Lists the `tldr-compile` operation issues for a company, and for each one
 * within the recency window that is NOT already consumed (no cache row at/after
 * the operation's createdAt), does ONE `pollAgentTaskResult`. On `ready` it
 * re-reads the target issue's inputs (to key the cache by the same content hash
 * the heartbeat computed), validates, and writes the tldr-cache. A still-pending
 * operation is left for the next tick; one older than the recency window is
 * given up. Called per-company from the every-minute compile-bulletin job.
 *
 * Idempotent + safe to re-run: the consumed-check (fresh cache row) prevents a
 * duplicate write, and finalizeTldr's upsert is itself idempotent.
 */
export async function drainTldrOperations(
  ctx: TldrDrainerCtx,
  companyId: string,
  now: Date,
): Promise<void> {
  // Resolve the Editor-Agent (idempotent). Without it the TL;DR machinery is
  // moot; bail rather than record failures against a non-UUID agent id.
  let editorAgentId: string | null = null;
  try {
    editorAgentId = await reconcileEditorAgent(ctx, companyId);
  } catch (e) {
    ctx.logger?.info?.('tldr-drainer: reconcile failed', { companyId, reason: (e as Error).message });
  }
  if (!editorAgentId) return;

  let ops: Array<{ id: string; originId?: string | null; createdAt?: string | Date }>;
  try {
    ops = (await ctx.issues.list({
      companyId,
      originKindPrefix: operationOriginKind('tldr-compile'),
      includePluginOperations: true,
      limit: 50,
    })) as Array<{ id: string; originId?: string | null; createdAt?: string | Date }>;
  } catch (e) {
    ctx.logger?.info?.('tldr-drainer: list failed', { companyId, reason: (e as Error).message });
    return;
  }

  for (const op of ops ?? []) {
    try {
      const createdMs = op.createdAt ? new Date(op.createdAt).getTime() : now.getTime();
      // Aged out of the recency window → give up (the heartbeat re-creates a
      // fresh operation if the issue still needs a TL;DR).
      if (now.getTime() - createdMs > TLDR_DRAIN_RECENCY_MS) continue;

      const originId = op.originId ?? '';
      if (!originId.startsWith('tldr-')) continue;
      const scopeId = originId.slice('tldr-'.length);
      if (!scopeId) continue;

      // Already consumed? A cache row at/after this operation's createdAt means
      // the result was already cached (by the heartbeat or a prior drain tick).
      const cached = await getTldrByScope(ctx, 'issue', scopeId);
      if (cached && new Date(cached.generated_at).getTime() >= createdMs) continue;

      const poll = await pollAgentTaskResult(ctx, {
        operationIssueId: op.id,
        companyId,
        operationKind: 'tldr-compile',
        agentId: editorAgentId,
      });
      if (poll.status !== 'ready') continue; // still in flight — re-poll next tick

      const inputs = await readTldrInputs(ctx.issues, scopeId, companyId);
      const contentHash = tldrContentHash({ surface: 'issue', scopeId, inputs });
      await finalizeTldr(ctx, {
        surface: 'issue',
        scopeId,
        contentHash,
        body: poll.body,
        agentKey: EDITOR_AGENT_KEY,
        agentId: editorAgentId,
        companyId,
      });
      ctx.logger?.info?.('tldr-drainer: consumed result + cached TL;DR', {
        companyId,
        scopeId,
        operationIssueId: op.id,
      });
    } catch (e) {
      ctx.logger?.info?.('tldr-drainer: skipped operation', {
        operationIssueId: op.id,
        reason: (e as Error).message,
      });
    }
  }
}
