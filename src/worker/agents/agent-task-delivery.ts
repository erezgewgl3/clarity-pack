// src/worker/agents/agent-task-delivery.ts
//
// Plan 03-06 — the operation-issue task-delivery layer (Path (d)).
// Plan 03-08 — the readback (steps 4-5) rewritten to Option B: an issue-document
// poll as the PRIMARY readback. Plan 03-07's Option C (tool channel) is dead.
//
// THE GAP THIS CLOSES. Plan 03-05's `sessionLlmAdapter` drove the Editor-Agent
// via `ctx.agents.sessions.sendMessage({prompt})`. The Plan 03-04 Phase 3
// closure drill proved the host SILENTLY DISCARDS the session `prompt` before
// it reaches the agent (upstream PR #3106, open/unmerged). The agent only ever
// sees the `reason` wake label, runs its ordinary org-chart heartbeat, finds an
// empty inbox, and emits prose — which `compilePass1` correctly rejects.
//
// PATH (d) — the scoped-issue handoff (03-AGENT-INVOCATION-GAP-RESEARCH.md).
// The compile prompt becomes the BODY (description) of an operation issue
// ASSIGNED to the Editor-Agent. The agent's heartbeat finds the assigned issue
// via "Step 3 — Get Assignments" (which PR #3106 explicitly leaves unchanged),
// reads the prompt from the issue body, and completes the operation. The
// 2026-05-16 re-drill PROVED this scoped-issue architecture (PAPERCLIP_TASK_ID
// scoping confirmed) — it is NOT re-opened by Plan 03-08. Steps 1-3 stay
// byte-identical to 03-06 except for the one description concatenation below.
//
// THE READBACK (Plan 03-08 — Option B). Plan 03-07 tried Option C: the agent
// delivers its result by CALLING a declared `submit-compile-result` plugin
// tool. The 2026-05-16 closure re-drill LIVE-DISPROVED Option C — a
// `claude_local` managed agent's session never receives a plugin-declared
// tool ("the submit-compile-result tool wasn't found via ToolSearch", "not
// available as a deferred tool", "no Clarity Pack MCP server listed"). The
// agent's reliable, OBSERVED behaviour is: produce the BulletinDraft, store it
// as an issue DOCUMENT keyed `compile-result` (the agent chose this key
// unprompted), post a prose comment, mark the operation issue `done`.
//
// DIAGNOSIS OF THE 03-07 FALLBACK-POLL MISS (debug doc, Plan 03-07 section).
// The 03-07 readback DID code a `documents.list` + `.get` scan against the
// correct `operationIssueId` (the poll and the create share one `issue.id`
// variable — threat-model item 5; no second id was introduced; the SDK
// `list(issueId, companyId)` / `get(issueId, key, companyId)` arity matched
// research Q1 verbatim). The miss was STRUCTURAL, not an API-shape bug: the
// document scan ran only as a NEVER-PRIMARY ~15s belt-and-suspenders backstop
// inside a `Promise.race` whose other branches were the (dead) tool promise and
// a 300s timeout. A slow 15s backstop racing a long compile is fragile — and
// the readback's DESIGNED path was the tool channel that never fired. Option B
// promotes the document poll to the PRIMARY 5s readback. The `Promise.race`
// and the `PENDING_DELIVERIES` tool registry are removed entirely.
//
// HOW THE INSTRUCTION REACHES THE AGENT. The static manifest
// `agents[].instructions.content` provably does NOT propagate to an
// already-existing managed agent (`reconcile()` sets instructions at creation
// only — debug doc ROOT CAUSE). So the "store the result as a document keyed
// compile-result" contract is appended to the operation-issue DESCRIPTION,
// which `deliverAgentTask` creates FRESH every compile and the agent provably
// reads (confirmed on the 03-06 + 03-07 drills).
//
// The raw result string still flows UNCHANGED through the caller's
// `extractJsonObject → JSON.parse → compilePass1 slot-resolving validator →
// verifyDraft → publishBulletin` pipeline — the LlmAdapter contract is
// byte-identical.
//
// Governance parity (Decision #3 / coexistence guarantee #4): the compile runs
// as a real, audited agent run against a real assigned issue — budget caps,
// pause/terminate, and the audit trail all apply. No direct-HTTP LLM call.
//
// Coexistence guarantee #2: operation issues are created with
// `surfaceVisibility:'plugin_operation'` + a `plugin:*` originKind, so they
// stay OFF Eric's classic human issue board.
//
// SDK shapes (verified against @paperclipai/plugin-sdk@2026.512.0 types.d.ts):
//   - PluginIssuesClient.list accepts `includePluginOperations?: boolean`
//     (types.d.ts:1018) — MANDATORY for the idempotency search, see B-1 below.
//   - PluginIssuesClient.create accepts `assigneeAgentId` / `surfaceVisibility`
//     / `originKind` / `originId` / `description`.
//   - PluginIssuesClient.requestWakeup(issueId, companyId, {reason, idempotencyKey}).
//   - PluginIssuesClient.listComments(issueId, companyId) → IssueComment[];
//     IssueComment.authorAgentId is `string | null` (non-optional).
//   - ctx.issues.documents (PluginIssueDocumentsClient) — `list(issueId,
//     companyId)` → IssueDocumentSummary[]; `get(issueId, key, companyId)` →
//     IssueDocument | null (IssueDocument has a `body` string).

import type { PluginIssuesClient, PluginLogger, IssueComment } from '@paperclipai/plugin-sdk';

// PluginIssueDocumentsClient is not re-exported from the SDK's index barrel
// (only `PluginIssuesClient` is) — reach it through the `documents` member of
// PluginIssuesClient, which is typed `PluginIssueDocumentsClient`.
type PluginIssueDocumentsClient = PluginIssuesClient['documents'];

import { extractJsonObject, validateDraftStructure } from '../bulletin/compile-pass-1.ts';
import type { LlmAdapter } from '../bulletin/compile-pass-1.ts';

/** The operation-issue originKind namespace. The agent matches on this prefix. */
export const OPERATION_ORIGIN_KIND_PREFIX = 'plugin:clarity-pack:operation:';

/** The two operation kinds Clarity Pack delivers to the Editor-Agent. */
export type OperationKind = 'bulletin-compile' | 'tldr-compile';

/**
 * The EXACT issue-document key the agent is instructed to file its result
 * under. The live Editor-Agent already chose `compile-result` unprompted on
 * the 2026-05-16 diagnostic — Plan 03-08 makes it a deterministic contract.
 * `deliverAgentTask`'s PRIMARY readback is `documents.get(issueId, this key,
 * companyId)`.
 */
export const RESULT_DOCUMENT_KEY = 'compile-result';

/**
 * The agent-facing result-delivery instruction. Appended to the operation-issue
 * DESCRIPTION (the channel that propagates to the live agent — the static
 * manifest `agents[].instructions.content` provably does NOT). The agent reads
 * the issue description, produces the result, and files it as an issue document
 * keyed `compile-result`.
 */
export const RESULT_DELIVERY_INSTRUCTION =
  '\n\n---\n' +
  'WHEN COMPLETE — RESULT DELIVERY (Clarity Pack):\n' +
  'Store your finished result as an issue DOCUMENT on THIS operation issue, ' +
  'using the EXACT document key "compile-result". The document body must be ' +
  'the raw result and nothing else — for a bulletin-compile operation that is ' +
  'the raw BulletinDraft JSON object (no prose preamble, no markdown code ' +
  'fences, no sign-off); for a tldr-compile operation that is the raw TL;DR ' +
  'text. Then mark this operation issue done. Do NOT put the result only in a ' +
  'comment — the document keyed "compile-result" is the delivery channel the ' +
  'Clarity Pack worker reads.';

/**
 * Build the full operation originKind for a kind. `PluginIssueOriginKind` is
 * the template literal type `` `plugin:${string}` `` — any `plugin:`-prefixed
 * literal satisfies it, so the cast is sound.
 */
export function operationOriginKind(kind: OperationKind): `plugin:${string}` {
  return `${OPERATION_ORIGIN_KIND_PREFIX}${kind}` as `plugin:${string}`;
}

/**
 * Default result-readback timeout. A `claude_local` compile run end-to-end is
 * slower than a session stream, so 5 minutes is a generous v1 ceiling. A
 * timeout routes through the caller's existing `recordCompileFailure` + 15-min
 * retry, exactly like any other compile failure.
 */
export const AGENT_TASK_DELIVERY_TIMEOUT = 300_000;

/**
 * Plan 03-08 — the PRIMARY readback poll cadence. The document poll
 * (`documents.get` at key `compile-result`) is the designed delivery path now,
 * so it runs at a brisk 5s — not the dead 15s Option-C backstop cadence.
 */
export const RESULT_POLL_INTERVAL_MS = 5_000;

/** Backward-compat alias for {@link RESULT_POLL_INTERVAL_MS} (legacy callers). */
export const POLL_INTERVAL_MS = RESULT_POLL_INTERVAL_MS;

/** Issue statuses that mean an operation issue is finished — never reuse one. */
const TERMINAL_STATUSES = new Set(['done', 'cancelled']);

/**
 * The narrow ctx slice this layer needs. Kept deliberately minimal so BOTH the
 * compile-bulletin job ctx and the editor heartbeat ctx structurally satisfy it
 * without a cast. `issues` carries a `documents` member for the Option-B
 * document poll.
 */
export type AgentTaskDeliveryCtx = {
  issues: Pick<PluginIssuesClient, 'list' | 'create' | 'requestWakeup' | 'listComments'> & {
    documents: Pick<PluginIssueDocumentsClient, 'list' | 'get'>;
  };
  logger?: PluginLogger;
};

/** Options for one `deliverAgentTask` call. */
export type DeliverAgentTaskOpts = {
  /** Resolved Editor-Agent UUID for this company (from ctx.agents.managed.reconcile). */
  agentId: string;
  /** Company the operation issue lives under. */
  companyId: string;
  /** Which operation this is — selects the originKind and the result schema gate. */
  operationKind: OperationKind;
  /** The per-cycle / per-scope dedupe key (e.g. `cycle-3`, `tldr-<issueId>`). */
  operationId: string;
  /** Human-readable title for the operation issue. */
  title: string;
  /** The compile prompt — becomes the issue DESCRIPTION the agent reads. */
  prompt: string;
  /** Override the result-readback timeout. Default AGENT_TASK_DELIVERY_TIMEOUT. */
  timeoutMs?: number;
  /**
   * Override the document-poll cadence. Default RESULT_POLL_INTERVAL_MS.
   * `fallbackPollIntervalMs` is accepted as a backward-compat alias (Plan
   * 03-06/03-07 callers / tests passed it under the old backstop name).
   */
  pollIntervalMs?: number;
  /** Backward-compat alias for `pollIntervalMs` (Plan 03-06/03-07 option name). */
  fallbackPollIntervalMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * True when a body (a comment body OR an issue-document body) is the agent's
 * RESULT for this operation — i.e. it parses as a JSON object AND passes the
 * per-operationKind schema gate.
 *
 * A body with a stray `{` that fails parse, or a JSON object that fails the
 * schema, is a progress / status note and is NOT the result (W-4 — the worker
 * must resolve on a schema-valid object, never a bare brace test).
 *
 * - `bulletin-compile`: `validateDraftStructure` (the structure-only
 *   BulletinDraft validator). It checks SHAPE ONLY — the object shape,
 *   masthead, and the four required arrays — and NEVER resolves
 *   `{{NUMBER:key}}` slots. An agent draft is CONTRACTED to emit unresolved
 *   `{{NUMBER:key}}` placeholders in its `editorialSummary` prose, so the
 *   readback must NOT reject on them. Slot resolution against the real facts
 *   table runs downstream in `compilePass1` (which calls the slot-resolving
 *   validator), and `verifyDraft` pass-2 re-verifies every numeric before
 *   publish. Calling that slot-resolving validator here — with an empty facts
 *   table — was the Plan 03-08 readback bug: every real draft's placeholders
 *   threw `UNKNOWN_SLOT` and the readback rejected the agent's flawless
 *   document.
 * - `tldr-compile`: a TL;DR is a plain non-empty string under the 8000-char
 *   ceiling `compileTldr` enforces.
 */
function isResultComment(body: string, operationKind: OperationKind): boolean {
  if (operationKind === 'tldr-compile') {
    // compileTldr's own validateLlmOutput enforces the real bound downstream;
    // here we only need "the agent posted a usable, non-empty completion".
    return body.trim().length > 0 && body.length <= 8000;
  }
  // bulletin-compile — the body must be a STRUCTURALLY-valid BulletinDraft
  // JSON. Structure only: unresolved `{{NUMBER:key}}` placeholders are
  // expected and must NOT fail the readback.
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(body));
  } catch {
    return false;
  }
  try {
    validateDraftStructure(parsed);
  } catch {
    return false;
  }
  return true;
}

/**
 * True when an issue-document body is the agent's RESULT for this operation.
 * A document body and a comment body are validated the SAME way — Plan 03-08
 * reuses the single {@link isResultComment} validator so the schema logic is
 * never duplicated. `format` is typed `"markdown"` but the agent files raw
 * JSON in it; `extractJsonObject` peels any incidental fences, so an off-label
 * format is harmless.
 */
function isResultDocument(body: string, operationKind: OperationKind): boolean {
  return isResultComment(body, operationKind);
}

/**
 * Deliver a task to an agent as an assigned operation issue, then read the
 * agent's result back through the Option-B issue-document poll.
 *
 *   1. Idempotency search — `ctx.issues.list` with `includePluginOperations:
 *      true` (B-1 — MANDATORY: the operation issue is created off the default
 *      surface, so a `list` without the flag finds nothing and step 2 spawns a
 *      DUPLICATE on every job re-fire — defeats the per-cycle idempotency
 *      contract, threat T-03-45). A non-terminal match is REUSED.
 *   2. Create the operation issue (only if no reusable one) — the prompt
 *      PLUS the RESULT_DELIVERY_INSTRUCTION is the issue `description`,
 *      assigned to the Editor-Agent, off the human board. The description is
 *      the channel that PROPAGATES to the live agent.
 *   3. Wake the agent now via `requestWakeup` (non-fatal — the next scheduled
 *      heartbeat picks the issue up anyway).
 *   4. Readback — a PRIMARY issue-document poll (Plan 03-08, Option B). Each
 *      iteration, in priority order:
 *        (a) PRIMARY — `documents.get(issueId, 'compile-result', companyId)`.
 *        (b) FALLBACK SCAN — `documents.list` then `.get` on any OTHER key
 *            (covers the agent picking a different key).
 *        (c) COMMENT FALLBACK — the legacy `listComments` + `isResultComment`
 *            scan (Option A belt-and-suspenders for a future agent that
 *            comments raw JSON). Lowest priority.
 *   5. On the deadline with no result, throw the timeout error — routed
 *      through the caller's existing `recordCompileFailure` path. The raw
 *      result string flows UNCHANGED through the caller's pipeline, so the
 *      LlmAdapter contract is byte-identical.
 */
export async function deliverAgentTask(
  ctx: AgentTaskDeliveryCtx,
  opts: DeliverAgentTaskOpts,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? AGENT_TASK_DELIVERY_TIMEOUT;
  const pollIntervalMs =
    opts.pollIntervalMs ?? opts.fallbackPollIntervalMs ?? RESULT_POLL_INTERVAL_MS;

  // Steps 1-3 (create/reuse + wake) in this invocation.
  const { operationIssueId } = await startAgentTask(ctx, opts);

  // 4-5. Read the result back via the in-invocation poll loop. This SYNCHRONOUS
  //      form is retained for tests and any caller that can hold one invocation
  //      for the round-trip; the PRODUCTION cross-tick path
  //      (compile-bulletin.ts / editor.ts) instead calls startAgentTask once and
  //      pollAgentTaskResult on subsequent job ticks, so no single invocation is
  //      held past its host-validity window (delivery-layer rework 2026-05-28).
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const poll = await pollAgentTaskResult(ctx, {
      operationIssueId,
      companyId: opts.companyId,
      operationKind: opts.operationKind,
      agentId: opts.agentId,
    });
    if (poll.status === 'ready') return poll.body;
  }

  // The deadline elapsed with no result on any channel.
  throw new Error(
    `agent-task-delivery timeout: no result document at key "${RESULT_DOCUMENT_KEY}" ` +
      `for operation issue ${operationIssueId} after ${timeoutMs}ms`,
  );
}

/** The result of {@link startAgentTask}. */
export type AgentTaskStartResult = {
  /** The operation issue the agent will deliver its result onto. */
  operationIssueId: string;
  /** True when an in-flight operation issue was reused (no new issue created). */
  reused: boolean;
};

/**
 * Delivery-layer rework (2026-05-28) — STEP 1-3 of {@link deliverAgentTask},
 * callable on its own: idempotency-search + create the operation issue (with the
 * prompt + result-delivery instruction as the description) + wake the agent.
 * Returns the operation issue id so the caller can persist it and poll for the
 * result on a LATER job tick (a fresh, valid host invocation) via
 * {@link pollAgentTaskResult}. This is how the compile pipeline avoids holding
 * one invocation across the whole agent round-trip (paperclipai@2026.525.0
 * expires the scope mid-poll otherwise — PR #6547).
 */
export async function startAgentTask(
  ctx: AgentTaskDeliveryCtx,
  opts: Omit<DeliverAgentTaskOpts, 'timeoutMs' | 'pollIntervalMs' | 'fallbackPollIntervalMs'>,
): Promise<AgentTaskStartResult> {
  // 1. Idempotency search. includePluginOperations:true is MANDATORY (B-1).
  let issue: { id: string } | null = null;
  let reused = false;
  try {
    const existing = await ctx.issues.list({
      companyId: opts.companyId,
      assigneeAgentId: opts.agentId,
      originKindPrefix: OPERATION_ORIGIN_KIND_PREFIX,
      originId: opts.operationId,
      includePluginOperations: true,
    });
    const reusable = existing.find(
      (i) => !TERMINAL_STATUSES.has((i as { status?: string }).status ?? ''),
    );
    if (reusable) {
      issue = { id: reusable.id };
      reused = true;
      ctx.logger?.info?.(
        `agent-task-delivery: reusing in-flight operation issue ${reusable.id} ` +
          `for ${opts.operationKind}/${opts.operationId} (idempotency — no duplicate created)`,
      );
    }
  } catch (e) {
    // A list failure must not block the compile — fall through to create. A
    // duplicate is the worst case, and the agent's result document still works.
    ctx.logger?.warn?.(
      `agent-task-delivery: idempotency list failed for ${opts.operationId}: ${
        (e as Error).message
      }`,
    );
  }

  // 2. Create the operation issue (only if no reusable one was found). The
  //    description is the compile prompt FOLLOWED BY the result-delivery
  //    instruction — the channel that provably propagates to the live agent.
  if (!issue) {
    issue = await ctx.issues.create({
      companyId: opts.companyId,
      title: opts.title,
      description: opts.prompt + RESULT_DELIVERY_INSTRUCTION,
      status: 'todo',
      assigneeAgentId: opts.agentId,
      surfaceVisibility: 'plugin_operation',
      originKind: operationOriginKind(opts.operationKind),
      originId: opts.operationId,
    });
    ctx.logger?.info?.(
      `agent-task-delivery: created operation issue ${issue.id} ` +
        `kind=${opts.operationKind} originId=${opts.operationId} assignee=${opts.agentId}`,
    );
  }

  // 3. Wake the agent now. Non-fatal — the next heartbeat still picks it up.
  try {
    await ctx.issues.requestWakeup(issue.id, opts.companyId, {
      reason: `clarity-pack ${opts.operationKind}`,
      idempotencyKey: opts.operationId,
    });
  } catch (e) {
    ctx.logger?.warn?.(
      `agent-task-delivery: requestWakeup failed for issue ${issue.id} ` +
        `(non-fatal — heartbeat will still pick it up): ${(e as Error).message}`,
    );
  }

  return { operationIssueId: issue.id, reused };
}

/** Arguments for {@link pollAgentTaskResult}. */
export type PollAgentTaskResultArgs = {
  operationIssueId: string;
  companyId: string;
  operationKind: OperationKind;
  /** The Editor-Agent UUID — used to match the comment-fallback author. */
  agentId: string;
};

/** The outcome of a SINGLE {@link pollAgentTaskResult} round. */
export type AgentTaskPollResult =
  | { status: 'ready'; body: string }
  | { status: 'pending' };

/**
 * Delivery-layer rework (2026-05-28) — STEP 4 of {@link deliverAgentTask} as a
 * SINGLE, sleepless round, callable on its own from a job tick. Checks, in
 * priority order: (a) the `compile-result` document, (b) an off-key document
 * scan, (c) the legacy comment scan. Returns `{status:'ready', body}` on the
 * first schema-valid hit, else `{status:'pending'}`. Each host call here runs in
 * the CALLER's (fresh) invocation, so the cross-tick poller never outlives its
 * scope. A host-call rejection (including an expired-scope error) is caught and
 * treated as "pending this round" — the next tick retries in a new invocation.
 */
export async function pollAgentTaskResult(
  ctx: AgentTaskDeliveryCtx,
  args: PollAgentTaskResultArgs,
): Promise<AgentTaskPollResult> {
  const { operationIssueId, companyId, operationKind, agentId } = args;

  // (a) PRIMARY — the document keyed exactly `compile-result`.
  try {
    const doc = await ctx.issues.documents.get(operationIssueId, RESULT_DOCUMENT_KEY, companyId);
    if (doc && isResultDocument(doc.body, operationKind)) {
      ctx.logger?.info?.(
        `agent-task-delivery: result DOCUMENT received on operation issue ` +
          `${operationIssueId} (key=${RESULT_DOCUMENT_KEY})`,
      );
      return { status: 'ready', body: doc.body };
    }
  } catch (e) {
    ctx.logger?.warn?.(
      `agent-task-delivery: documents.get(${RESULT_DOCUMENT_KEY}) failed for ` +
        `issue ${operationIssueId}: ${(e as Error).message}`,
    );
  }

  // (b) FALLBACK SCAN — any OTHER document key. First schema-valid hit wins.
  try {
    const summaries = await ctx.issues.documents.list(operationIssueId, companyId);
    for (const summary of summaries) {
      if (summary.key === RESULT_DOCUMENT_KEY) continue; // already tried in (a)
      const doc = await ctx.issues.documents.get(operationIssueId, summary.key, companyId);
      if (doc && isResultDocument(doc.body, operationKind)) {
        ctx.logger?.info?.(
          `agent-task-delivery: result DOCUMENT (off-key fallback) found on ` +
            `operation issue ${operationIssueId} (key=${summary.key})`,
        );
        return { status: 'ready', body: doc.body };
      }
    }
  } catch (e) {
    ctx.logger?.warn?.(
      `agent-task-delivery: documents.list scan failed for issue ` +
        `${operationIssueId}: ${(e as Error).message}`,
    );
  }

  // (c) COMMENT FALLBACK — the legacy Option-A scan (lowest priority).
  try {
    const comments: IssueComment[] = await ctx.issues.listComments(operationIssueId, companyId);
    for (const c of comments) {
      if (c.authorAgentId === agentId && isResultComment(c.body, operationKind)) {
        ctx.logger?.info?.(
          `agent-task-delivery: result COMMENT (fallback) received on ` +
            `operation issue ${operationIssueId}`,
        );
        return { status: 'ready', body: c.body };
      }
    }
  } catch (e) {
    ctx.logger?.warn?.(
      `agent-task-delivery: fallback listComments failed for issue ` +
        `${operationIssueId}: ${(e as Error).message}`,
    );
  }

  return { status: 'pending' };
}

/** Factory options for `deliveryLlmAdapter` — `prompt` is supplied per call. */
export type DeliveryLlmAdapterOpts = Omit<DeliverAgentTaskOpts, 'prompt' | 'title'> & {
  /** Optional issue title; defaults to a generic per-operation string. */
  title?: string;
};

/**
 * Build a real `LlmAdapter` backed by the operation-issue handoff. The returned
 * object satisfies the existing `{ complete({maxTokens, prompt}): Promise<string> }`
 * contract — so `compilePass1`, `compileTldr`, `verifyDraft`, `publishBulletin`,
 * and every stub-based test are structurally untouched. Only the production
 * implementation behind `complete()` changes.
 */
export function deliveryLlmAdapter(
  ctx: AgentTaskDeliveryCtx,
  opts: DeliveryLlmAdapterOpts,
): LlmAdapter {
  return {
    async complete({ maxTokens, prompt }: { maxTokens: number; prompt: string }): Promise<string> {
      // `maxTokens` is part of the LlmAdapter contract for interface fidelity,
      // but the input-token cap is enforced UPSTREAM by compilePass1/compileTldr
      // BEFORE complete() is ever called — keeping it here is no cap regression
      // (same note as session-llm-adapter.ts).
      void maxTokens;
      return deliverAgentTask(ctx, {
        ...opts,
        prompt,
        title: opts.title ?? `Clarity Pack ${opts.operationKind} — ${opts.operationId}`,
      });
    },
  };
}
