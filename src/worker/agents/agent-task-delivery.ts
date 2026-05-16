// src/worker/agents/agent-task-delivery.ts
//
// Plan 03-06 — the operation-issue task-delivery layer (Path (d)).
// Plan 03-07 — the readback (steps 4-5) rewritten to the Option-C tool channel.
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
// scoping confirmed) — it is NOT re-opened by Plan 03-07.
//
// THE READBACK (Plan 03-07 — Option C). The 03-06 re-drill found a contained
// output-channel gap: the agent filed the BulletinDraft as an issue DOCUMENT
// and posted prose as the COMMENT, while the 03-06 readback polled
// `listComments` for a JSON comment — so nothing published. Plan 03-07 rewrites
// the readback (steps 4-5 ONLY): the agent now delivers its result by CALLING
// the declared `submit-compile-result` plugin tool. `deliverAgentTask`
// registers a `{resolve, reject}` entry in the shared `PENDING_DELIVERIES` Map
// (compile-result-tool.ts) keyed by the operation issue id BEFORE waking the
// agent; the tool handler resolves it directly. A slow ~15s comment+document
// fallback poll is kept as belt-and-suspenders — the first of {tool-call,
// result comment, result document} to yield a schema-valid result wins. The
// operation-issue CREATION path (steps 1-3) is byte-identical to 03-06.
//
// The raw result string still flows UNCHANGED through the caller's
// `extractJsonObject → JSON.parse → validateDraftSchema → verifyDraft →
// publishBulletin` pipeline — the LlmAdapter contract is byte-identical.
//
// Governance parity STRENGTHENED (Decision #3 / coexistence guarantee #4): the
// compile runs as a real, audited agent run against a real assigned issue —
// budget caps, pause/terminate, and the audit trail all apply; the tool call
// is itself visible in the agent's run history. No direct-HTTP LLM call.
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
//     IssueComment.authorAgentId is `string | null` (non-optional);
//     IssueComment.createdAt is a `Date` object (not a string).
//   - ctx.issues.documents (PluginIssueDocumentsClient) — `list(issueId,
//     companyId)` → IssueDocumentSummary[]; `get(issueId, key, companyId)` →
//     IssueDocument | null (IssueDocument has a `body` string).

import type { PluginIssuesClient, PluginLogger, IssueComment } from '@paperclipai/plugin-sdk';

// PluginIssueDocumentsClient is not re-exported from the SDK's index barrel
// (only `PluginIssuesClient` is) — reach it through the `documents` member of
// PluginIssuesClient, which is typed `PluginIssueDocumentsClient`.
type PluginIssueDocumentsClient = PluginIssuesClient['documents'];

import { extractJsonObject, validateDraftSchema } from '../bulletin/compile-pass-1.ts';
import type { LlmAdapter } from '../bulletin/compile-pass-1.ts';
import { PENDING_DELIVERIES } from './compile-result-tool.ts';

/** The operation-issue originKind namespace. The agent matches on this prefix. */
export const OPERATION_ORIGIN_KIND_PREFIX = 'plugin:clarity-pack:operation:';

/** The two operation kinds Clarity Pack delivers to the Editor-Agent. */
export type OperationKind = 'bulletin-compile' | 'tldr-compile';

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
 * slower than a session stream (research Open-Follow-up #2 — drill the real
 * number on Countermoves), so 5 minutes is a generous v1 ceiling. A timeout
 * routes through the caller's existing `recordCompileFailure` + 15-min retry,
 * exactly like any other compile failure.
 */
export const AGENT_TASK_DELIVERY_TIMEOUT = 300_000;

/** Default poll cadence for the result-comment readback loop (legacy alias). */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Plan 03-07 — the slow fallback-poll cadence. The `submit-compile-result` tool
 * is the DESIGNED delivery path; the comment+document fallback poll is a
 * belt-and-suspenders backstop, so it runs slowly (~15s) — it does not need to
 * be fast because the tool channel resolves immediately when the agent calls it.
 */
export const FALLBACK_POLL_INTERVAL_MS = 15_000;

/** Issue statuses that mean an operation issue is finished — never reuse one. */
const TERMINAL_STATUSES = new Set(['done', 'cancelled']);

/**
 * The narrow ctx slice this layer needs. Kept deliberately minimal so BOTH the
 * compile-bulletin job ctx and the editor heartbeat ctx structurally satisfy it
 * without a cast. Plan 03-07 widens `issues` with a `documents` member for the
 * Option-B document fallback scan.
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
   * Override the fallback comment+document poll cadence. Default
   * FALLBACK_POLL_INTERVAL_MS. `pollIntervalMs` is accepted as a backward-compat
   * alias (Plan 03-06 callers / tests).
   */
  fallbackPollIntervalMs?: number;
  /** Backward-compat alias for `fallbackPollIntervalMs` (Plan 03-06 option name). */
  pollIntervalMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * True when an IssueComment body is the agent's RESULT for this operation —
 * i.e. it parses as a JSON object AND passes the per-operationKind schema gate.
 *
 * A comment with a stray `{` that fails parse, or a JSON object that fails the
 * schema, is a progress / status comment and is NOT the result (W-4 — the
 * worker must resolve on a schema-valid object, never a bare brace test).
 *
 * - `bulletin-compile`: `validateDraftSchema` (the BulletinDraft validator).
 *   It is called with an EMPTY facts table — the readback only needs the
 *   structural shape; the numerics get re-verified downstream by `verifyDraft`,
 *   and the real per-slot `{{NUMBER:key}}` resolution runs in `compilePass1`
 *   with the real facts table.
 * - `tldr-compile`: a TL;DR is a plain non-empty string, not a JSON object —
 *   so the result gate for `tldr-compile` is simply "the comment body is a
 *   non-empty string under the 8000-char ceiling `compileTldr` enforces". A
 *   `tldr-compile` result comment is ANY non-empty agent comment.
 */
function isResultComment(body: string, operationKind: OperationKind): boolean {
  if (operationKind === 'tldr-compile') {
    // compileTldr's own validateLlmOutput enforces the real bound downstream;
    // here we only need "the agent posted a usable, non-empty completion".
    return body.trim().length > 0 && body.length <= 8000;
  }
  // bulletin-compile — the body must be a schema-valid BulletinDraft JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(body));
  } catch {
    return false;
  }
  try {
    validateDraftSchema(parsed, {});
  } catch {
    return false;
  }
  return true;
}

/**
 * Deliver a task to an agent as an assigned operation issue, then read the
 * agent's result back through the Option-C tool channel.
 *
 *   1. Idempotency search — `ctx.issues.list` with `includePluginOperations:
 *      true` (B-1 — MANDATORY: the operation issue is created off the default
 *      surface, so a `list` without the flag finds nothing and step 2 spawns a
 *      DUPLICATE on every job re-fire — defeats the per-cycle idempotency
 *      contract, threat T-03-45). A non-terminal match is REUSED.
 *   2. Create the operation issue (only if no reusable one) — the prompt is the
 *      issue `description`, assigned to the Editor-Agent, off the human board.
 *   3. Wake the agent now via `requestWakeup` (non-fatal — the next scheduled
 *      heartbeat picks the issue up anyway).
 *   4. Plan 03-07 — the readback is now a TYPED tool boundary, not a poll race:
 *      - 4a. Register a `{resolve, reject}` entry in the shared
 *            `PENDING_DELIVERIES` Map keyed by the operation issue id BEFORE
 *            requestWakeup, so the entry exists when the agent calls the
 *            `submit-compile-result` tool.
 *      - 4b. `Promise.race` that pending promise against (i) the `timeoutMs`
 *            deadline and (ii) a SLOW (~15s) belt-and-suspenders fallback poll
 *            that scans BOTH `listComments` (Option A) AND `documents.list` +
 *            `.get` (Option B) for a schema-valid result. The first of
 *            {tool-call, result comment, result document} to yield a
 *            schema-valid result wins.
 *   5. Always delete the Map entry in a `finally` — a resolved, fallback-won,
 *      or timed-out delivery never leaks an entry. The raw result string flows
 *      UNCHANGED through the caller's `extractJsonObject` + parse + validate,
 *      so the LlmAdapter contract ("a completion string") is byte-identical
 *      and the downstream pipeline is structurally untouched.
 */
export async function deliverAgentTask(
  ctx: AgentTaskDeliveryCtx,
  opts: DeliverAgentTaskOpts,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? AGENT_TASK_DELIVERY_TIMEOUT;
  const fallbackPollIntervalMs =
    opts.fallbackPollIntervalMs ?? opts.pollIntervalMs ?? FALLBACK_POLL_INTERVAL_MS;

  // 1. Idempotency search. includePluginOperations:true is MANDATORY (B-1).
  let issue: { id: string } | null = null;
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
      ctx.logger?.info?.(
        `agent-task-delivery: reusing in-flight operation issue ${reusable.id} ` +
          `for ${opts.operationKind}/${opts.operationId} (idempotency — no duplicate created)`,
      );
    }
  } catch (e) {
    // A list failure must not block the compile — fall through to create. A
    // duplicate is the worst case, and the agent's result comment still works.
    ctx.logger?.warn?.(
      `agent-task-delivery: idempotency list failed for ${opts.operationId}: ${
        (e as Error).message
      }`,
    );
  }

  // 2. Create the operation issue (only if no reusable one was found).
  if (!issue) {
    issue = await ctx.issues.create({
      companyId: opts.companyId,
      title: opts.title,
      description: opts.prompt,
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

  // 4. Read the result back. Plan 03-07 — a typed tool boundary, not a poll.
  const operationIssueId = issue.id;

  // 4a. Register the pending promise BEFORE the readback race, so the entry
  //     exists when the agent calls the submit-compile-result tool. (The
  //     requestWakeup above already fired — registering here, immediately
  //     after, is the only ordering nuance touching step 3; it does not change
  //     the create call. The agent's heartbeat run takes far longer than this
  //     synchronous registration, so there is no lost-wakeup race.)
  const resultPromise = new Promise<string>((resolve, reject) => {
    PENDING_DELIVERIES.set(operationIssueId, { resolve, reject });
  });

  // 4b. The timeout — rejects after timeoutMs with the existing tagged error
  //     the caller's recordCompileFailure path handles like any other failure.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<string>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `agent-task-delivery timeout: no result for operation issue ` +
            `${operationIssueId} after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  });

  // 4b (cont). The SLOW belt-and-suspenders fallback poll. The tool channel is
  //     the designed path; this scans BOTH the result comment (Option A) AND
  //     the result document (Option B) for the case where the agent ignores
  //     the tool. Each scan is wrapped in try/catch — a transient list/get
  //     error logs a warn and the loop continues.
  let fallbackStopped = false;
  const fallbackPromise = (async (): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (!fallbackStopped && Date.now() < deadline) {
      await sleep(fallbackPollIntervalMs);
      if (fallbackStopped) break;

      // (i) Option A — scan the agent's comments for a schema-valid result.
      try {
        const comments: IssueComment[] = await ctx.issues.listComments(
          operationIssueId,
          opts.companyId,
        );
        for (const c of comments) {
          // authorAgentId is a non-optional `string | null`; a direct === is
          // safe. null is a non-agent author and simply does not match.
          if (
            c.authorAgentId === opts.agentId &&
            isResultComment(c.body, opts.operationKind)
          ) {
            ctx.logger?.info?.(
              `agent-task-delivery: result COMMENT (fallback) received on ` +
                `operation issue ${operationIssueId}`,
            );
            return c.body;
          }
        }
      } catch (e) {
        ctx.logger?.warn?.(
          `agent-task-delivery: fallback listComments failed for issue ` +
            `${operationIssueId}: ${(e as Error).message}`,
        );
      }

      // (ii) Option B — scan the agent's filed documents for a schema-valid
      //      result. `format` is typed 'markdown' but the agent may file raw
      //      JSON in it — isResultComment parses, so an off-label format is
      //      harmless.
      try {
        const summaries = await ctx.issues.documents.list(
          operationIssueId,
          opts.companyId,
        );
        for (const summary of summaries) {
          const doc = await ctx.issues.documents.get(
            operationIssueId,
            summary.key,
            opts.companyId,
          );
          if (doc && isResultComment(doc.body, opts.operationKind)) {
            ctx.logger?.info?.(
              `agent-task-delivery: result DOCUMENT (fallback) found on ` +
                `operation issue ${operationIssueId} (key=${summary.key})`,
            );
            return doc.body;
          }
        }
      } catch (e) {
        ctx.logger?.warn?.(
          `agent-task-delivery: fallback documents scan failed for issue ` +
            `${operationIssueId}: ${(e as Error).message}`,
        );
      }
    }
    // The fallback loop exhausted the deadline without finding a result — let
    // the timeoutPromise be the one that rejects the race (a single, canonical
    // timeout error). Block here until that happens.
    return new Promise<string>(() => {});
  })();

  // 4c. Race them — first of {tool resolves resultPromise, comment/document
  //     resolves fallbackPromise, deadline rejects timeoutPromise} wins.
  try {
    return await Promise.race([resultPromise, fallbackPromise, timeoutPromise]);
  } finally {
    // 5. Always clean up — no Map entry, timer, or fallback loop leaks.
    PENDING_DELIVERIES.delete(operationIssueId);
    fallbackStopped = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
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
