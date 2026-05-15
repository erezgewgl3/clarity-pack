// src/worker/agents/session-llm-adapter.ts
//
// Plan 03-05 — the REAL production LlmAdapter, backed by an agent chat session.
//
// Plan 03-02's bulletin compile (and Phase 2's TL;DR compile) were built
// against an injectable synchronous `LlmAdapter` whose `complete()` was wired
// in production to `ctx.llm` — and `ctx.llm` does not exist on the SDK
// 2026.512.0 `PluginContext`. This file closes that gap.
//
// The production LLM-invocation mechanism the spike identified is
// `ctx.agents.sessions.*` (see 03-LLM-INVOCATION-RESEARCH.md Mechanism 1, and
// the canonical `plugin-llm-wiki/startWikiQuerySession` pattern it cites):
//
//   1. Open a session: `ctx.agents.sessions.create(agentId, companyId, ...)`.
//   2. Send the prompt: `sendMessage(sessionId, companyId, {prompt, onEvent})`.
//      `sendMessage` returns IMMEDIATELY with `{ runId }` — the agent's actual
//      output is delivered asynchronously through the `onEvent` callback as a
//      stream of `chunk` events, terminated by a `done` (or `error`) event.
//   3. Close the session.
//
// `sessionLlmAdapter` wraps that async, event-driven contract behind the
// byte-identical synchronous `LlmAdapter` interface — so `compilePass1`,
// `verifyDraft`, `publishBulletin`, `compileTldr`, and every stub-based test
// are structurally untouched. Only the production implementation is new.
//
// Governance parity (Decision #3 / coexistence guarantee #4): a session runs
// as a real, audited agent run subject to budget caps and pause/terminate. The
// agent must be invokable — a paused/terminated/pending_approval agent rejects
// BEFORE any session is opened, with a tagged AGENT_NOT_INVOKABLE error that
// the compile job's existing recordCompileFailure path surfaces.

import type {
  PluginAgentsClient,
  PluginLogger,
  AgentSessionEvent,
} from '@paperclipai/plugin-sdk';

import type { LlmAdapter } from '../bulletin/compile-pass-1.ts';

/**
 * Default session timeout. A session whose adapter never emits a terminal
 * `done`/`error` event must not hang the compile job forever (research
 * Open-Follow-up #2). 120s comfortably covers a single editorial-prose
 * completion; the compile job's existing recordCompileFailure + 15-min retry
 * handles a timeout the same way it handles any other compile failure.
 */
export const SESSION_TIMEOUT_MS = 120_000;

/**
 * Error-message tag for the paused/terminated/pending_approval/missing-agent
 * failure. Callers (and tests) match on this string to recognise that the
 * compile failed because the Editor-Agent is not invokable — an operator
 * action, not a compile bug.
 */
export const AGENT_NOT_INVOKABLE = 'AGENT_NOT_INVOKABLE';

/** Agent statuses that make a session impossible — guarded BEFORE create. */
const NON_INVOKABLE_STATUSES = new Set(['paused', 'terminated', 'pending_approval']);

/**
 * The narrow ctx slice this adapter needs. Kept deliberately minimal so BOTH
 * the compile-bulletin job ctx and the editor heartbeat ctx structurally
 * satisfy it without a cast.
 */
export type SessionLlmAdapterCtx = {
  agents: Pick<PluginAgentsClient, 'get' | 'sessions'>;
  logger?: PluginLogger;
};

/** Factory options. */
export type SessionLlmAdapterOpts = {
  /** Resolved Editor-Agent UUID for this company (from ctx.agents.managed.reconcile). */
  agentId: string;
  /** Company the session runs under. */
  companyId: string;
  /** Prefix for the session taskKey (idempotency/dedupe). Default 'clarity-pack:compile'. */
  taskKeyPrefix?: string;
  /** Override the terminal-event timeout. Default SESSION_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Build a real `LlmAdapter` backed by an agent chat session.
 *
 * The returned object satisfies the existing `LlmAdapter` interface
 * `{ complete({maxTokens, prompt}): Promise<string> }`. Each `complete()` call
 * opens its own session, sends the prompt, accumulates the streamed `chunk`
 * text, and resolves the accumulated string when the terminal `done` event
 * fires.
 */
export function sessionLlmAdapter(
  ctx: SessionLlmAdapterCtx,
  opts: SessionLlmAdapterOpts,
): LlmAdapter {
  const timeoutMs = opts.timeoutMs ?? SESSION_TIMEOUT_MS;
  const taskKeyPrefix = opts.taskKeyPrefix ?? 'clarity-pack:compile';

  return {
    async complete({ maxTokens, prompt }: { maxTokens: number; prompt: string }): Promise<string> {
      // `maxTokens` is part of the LlmAdapter contract for interface fidelity,
      // but the SDK `sendMessage` signature has no token field — the input-
      // token cap is enforced upstream by compilePass1/compileTldr BEFORE
      // complete() is ever called, so keeping it here is no cap regression.
      void maxTokens;

      // 1. Guard the agent BEFORE opening a session. A paused/terminated/
      //    pending_approval/missing agent would have sessions.create throw
      //    host-side anyway; failing fast here gives a clean tagged error and
      //    avoids a wasted AgentTaskSession row.
      const agent = await ctx.agents.get(opts.agentId, opts.companyId);
      if (!agent || NON_INVOKABLE_STATUSES.has(agent.status)) {
        throw new Error(
          `${AGENT_NOT_INVOKABLE}: editor-agent status=${agent?.status ?? 'not_found'}`,
        );
      }

      // 2. Open the session.
      const session = await ctx.agents.sessions.create(opts.agentId, opts.companyId, {
        taskKey: `${taskKeyPrefix}:${Date.now()}`,
        reason: 'Clarity Pack compile',
      });

      try {
        // 3. Wrap the streaming completion in a Promise. Resolution/rejection
        //    is driven by the TERMINAL onEvent (done/error) or the timeout —
        //    NOT by the `sendMessage` Promise resolving. `await sendMessage()`
        //    resolving only means "the send was accepted"; the Promise-wrap
        //    + timeout handles every ordering (terminal before, with, or after
        //    the sendMessage resolution — research Open-Follow-up #2).
        return await new Promise<string>((resolve, reject) => {
          let out = '';
          let settled = false;

          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(
              new Error(
                `session timeout: no terminal event after ${timeoutMs}ms (session=${session.sessionId})`,
              ),
            );
          }, timeoutMs);

          const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
          };

          const onEvent = (event: AgentSessionEvent): void => {
            if (event.eventType === 'chunk' && event.stream !== 'stderr' && event.message) {
              out += event.message;
              return;
            }
            if (event.eventType === 'done') {
              finish(() => resolve(out));
              return;
            }
            if (event.eventType === 'error') {
              finish(() =>
                reject(new Error(`session error: ${event.message ?? 'unknown'}`)),
              );
            }
          };

          ctx.agents.sessions
            .sendMessage(session.sessionId, opts.companyId, {
              prompt,
              reason: 'compile pass',
              onEvent,
            })
            .catch((err: unknown) => {
              // `sendMessage` itself rejecting (send was NOT accepted) is a
              // hard failure — no terminal event will ever arrive.
              finish(() => reject(err instanceof Error ? err : new Error(String(err))));
            });
        });
      } finally {
        // 4. Always close the session. A close failure must not mask the real
        //    result/error — swallow it with a warn.
        try {
          await ctx.agents.sessions.close(session.sessionId, opts.companyId);
        } catch (closeErr) {
          ctx.logger?.warn?.('sessionLlmAdapter: session close failed', {
            sessionId: session.sessionId,
            err: (closeErr as Error).message,
          });
        }
      }
    },
  };
}
