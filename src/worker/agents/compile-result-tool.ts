// src/worker/agents/compile-result-tool.ts
//
// Plan 03-07 — the submit-compile-result plugin tool (Option C — the canonical
// plugin-llm-wiki result-readback channel).
//
// THE GAP THIS CLOSES. Plan 03-06's scoped-issue task-delivery architecture is
// PROVEN — the Editor-Agent runs scoped to an assigned operation issue, reads
// the compile prompt, and produces a flawless BulletinDraft. But the 2026-05-16
// Countermoves re-drill found an output-channel mismatch: the agent filed the
// JSON as an issue DOCUMENT and posted prose as the COMMENT, while
// `deliverAgentTask` polled `listComments` for a JSON comment — found prose,
// timed out, nothing published.
//
// Option C replaces the comment-poll race with a TYPED tool boundary. The
// Editor-Agent delivers its result by CALLING this declared plugin tool,
// `submit-compile-result`, with `{operationIssueId, result}`. The tool handler
// runs synchronously inside the worker, looks up the in-flight
// `deliverAgentTask` promise in the shared `PENDING_DELIVERIES` Map, and
// resolves it directly with the raw result string — no JSON-from-prose
// extraction on the designed path, no polling.
//
// `deliverAgentTask` (agent-task-delivery.ts) writes a PENDING_DELIVERIES entry
// keyed by the operation issue id BEFORE waking the agent; this handler reads
// it. A slow comment+document fallback poll in `deliverAgentTask` is kept as a
// belt-and-suspenders safety net for the case where the agent ignores the tool.
//
// Governance parity (Decision #3 / coexistence guarantee #4): the tool call
// happens INSIDE the normal audited Editor-Agent run against the assigned
// operation issue — budget caps, pause/terminate, audit trail all apply. The
// tool invocation is itself visible in the agent's run history. No
// direct-HTTP LLM call is introduced.
//
// SDK shapes (verified against @paperclipai/plugin-sdk@2026.512.0 types.d.ts):
//   - ctx.tools.register(name, declaration, fn) — types.d.ts:708-716. The
//     `declaration` arg is Pick<PluginToolDeclaration,
//     'displayName'|'description'|'parametersSchema'> (name is the first arg);
//     passing the full PluginToolDeclaration object is structurally sound.
//   - The handler signature is
//     (params: unknown, runCtx: ToolRunContext) => Promise<ToolResult>.
//   - ToolResult — { content?: string; data?: unknown; error?: string }.

import type { PluginToolDeclaration, PluginLogger, ToolResult } from '@paperclipai/plugin-sdk';

/** The tool name. Host-namespaced to `clarity-pack:submit-compile-result` at runtime. */
export const SUBMIT_COMPILE_RESULT_TOOL_NAME = 'submit-compile-result';

/**
 * The PluginToolDeclaration the worker registers and the manifest mirrors.
 * `src/manifest.ts` carries a structurally-identical `tools[]` entry — a
 * contract test in `compile-result-tool.test.mjs` locks them together so they
 * cannot drift.
 */
export const SUBMIT_COMPILE_RESULT_TOOL: PluginToolDeclaration = {
  name: SUBMIT_COMPILE_RESULT_TOOL_NAME,
  displayName: 'Submit Clarity Pack compile result',
  description:
    'Deliver the completed BulletinDraft JSON or TL;DR text ' +
    'for the current clarity-pack operation issue. Call this exactly once ' +
    'when the operation is complete, passing the operation issue id and ' +
    'the raw result payload.',
  parametersSchema: {
    type: 'object',
    required: ['operationIssueId', 'result'],
    properties: {
      operationIssueId: {
        type: 'string',
        description: 'The id of the plugin:clarity-pack:operation:* issue you are completing.',
      },
      result: {
        type: 'string',
        description:
          'Raw BulletinDraft JSON object, or raw TL;DR text — no prose, no markdown fences.',
      },
    },
  },
};

/**
 * The shared in-process registry of in-flight `deliverAgentTask` deliveries,
 * keyed by operation issue id. `deliverAgentTask` writes a `{resolve, reject}`
 * entry before waking the agent; the `submit-compile-result` tool handler
 * resolves the matching entry. The Map lives at module scope so the worker's
 * single process shares it between the agent-task-delivery layer and the tool
 * handler. `deliverAgentTask` deletes its entry in a `finally`, so the Map
 * never leaks (Plan 03-07 Task-1 Test D).
 */
export const PENDING_DELIVERIES = new Map<
  string,
  { resolve: (r: string) => void; reject: (e: Error) => void }
>();

/** The narrow ctx slice this layer needs — just `ctx.tools.register` + the logger. */
export type CompileResultToolCtx = {
  tools: {
    register(
      name: string,
      declaration: Pick<PluginToolDeclaration, 'displayName' | 'description' | 'parametersSchema'>,
      fn: (params: unknown, runCtx: unknown) => Promise<ToolResult>,
    ): void;
  };
  logger?: PluginLogger;
};

/**
 * Register the `submit-compile-result` plugin tool. Called once in
 * `worker.ts:setup()` before any compile job fires, so the tool exists when the
 * Editor-Agent runs.
 *
 * The handler:
 *   1. Validates `params` — `operationIssueId` must be a non-empty string and
 *      `result` must be a string. Bad params return a `ToolResult.error`
 *      (never throw — a throw would surface as an opaque agent-run failure).
 *   2. Looks up `PENDING_DELIVERIES` by `operationIssueId`. A miss (the worker
 *      timed out or restarted) returns a `ToolResult.error` — non-fatal; the
 *      agent's run still completes and the slow fallback poll is the backstop.
 *   3. Resolves the matching in-flight delivery with the raw `result` string,
 *      then returns `{ content: 'received' }`.
 */
export function registerCompileResultTool(ctx: CompileResultToolCtx): void {
  ctx.tools.register(
    SUBMIT_COMPILE_RESULT_TOOL_NAME,
    SUBMIT_COMPILE_RESULT_TOOL,
    async (params: unknown): Promise<ToolResult> => {
      const p = (params ?? {}) as { operationIssueId?: unknown; result?: unknown };

      if (typeof p.operationIssueId !== 'string' || p.operationIssueId.length === 0) {
        ctx.logger?.warn?.(
          'submit-compile-result: rejected — missing or invalid operationIssueId',
        );
        return {
          error: 'submit-compile-result: missing or invalid operationIssueId/result',
        };
      }
      if (typeof p.result !== 'string') {
        ctx.logger?.warn?.(
          `submit-compile-result: rejected — missing or invalid result for operation issue ${p.operationIssueId}`,
        );
        return {
          error: 'submit-compile-result: missing or invalid operationIssueId/result',
        };
      }

      const pending = PENDING_DELIVERIES.get(p.operationIssueId);
      if (!pending) {
        ctx.logger?.warn?.(
          `submit-compile-result: no in-flight delivery for operation issue ${p.operationIssueId} ` +
            '(the worker may have timed out or restarted — the fallback poll is the other safety net)',
        );
        return {
          error: `submit-compile-result: no in-flight delivery for operation issue ${p.operationIssueId}`,
        };
      }

      pending.resolve(p.result);
      ctx.logger?.info?.(
        `submit-compile-result: result delivered for operation issue ${p.operationIssueId} ` +
          '(typed tool channel — Option C)',
      );
      return { content: 'received' };
    },
  );
}
