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
 * Bounded retry budget for a transient "Session not found" rejection from
 * `sendMessage`.
 *
 * The 2026-05-15 Countermoves drill failed exactly here: `sendMessage` rejected
 * `Session not found: <sessionId>` on a session `create()` had resolved with
 * moments earlier (a well-formed UUID). A session the host just minted and
 * handed back cannot be *permanently* unknown — a not-found this soon after
 * `create` is a create→sendMessage visibility race: the host's `AgentTaskSession`
 * is not yet messageable on the worker's RPC channel. The reference plugin,
 * `plugin-llm-wiki/startWikiQuerySession`, never observes it because it does
 * host round-trips — a `ctx.db.execute` INSERT plus two `ctx.streams` calls —
 * between `create` and `sendMessage`, which incidentally let the session
 * settle. Clarity Pack's adapter goes create→sendMessage with zero intervening
 * round-trips, so it must absorb the race itself.
 *
 * `SEND_RETRY_ATTEMPTS` is the TOTAL sendMessage attempt budget (1 initial +
 * retries). Backoff is exponential from `SEND_RETRY_BASE_DELAY_MS`; the worst
 * case (100+200+400ms ≈ 0.7s of cumulative backoff) sits comfortably inside
 * `SESSION_TIMEOUT_MS`.
 */
export const SEND_RETRY_ATTEMPTS = 4;
export const SEND_RETRY_BASE_DELAY_MS = 100;

/**
 * True when a thrown value is a "Session not found" rejection — the only
 * `sendMessage` failure the adapter retries. A budget/capability/terminated
 * rejection is permanent and must fail fast. Matches both the bare
 * `Session not found` and the `Session not found or closed` host variants.
 */
function isTransientSessionNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /session not found/i.test(msg);
}

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

      // Instrumentation (Plan 03-05 drill): log the created session INLINE in
      // the message string. The Paperclip host forwards only a fixed set of
      // plugin-log fields and drops arbitrary metadata keys, so any evidence
      // for the next Countermoves drill must live in the message itself.
      ctx.logger?.info?.(
        `sessionLlmAdapter: created session=${session.sessionId} ` +
          `agentId=${session.agentId} companyId=${session.companyId} ` +
          `status=${session.status} createdAt=${session.createdAt}`,
      );

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

          // Send the prompt, retrying a transient "Session not found" with
          // bounded exponential backoff (see SEND_RETRY_ATTEMPTS). `sendMessage`
          // RESOLVING only means the send was accepted — the terminal event
          // still drives resolve/reject. `sendMessage` REJECTING means the send
          // was NOT accepted: a "Session not found" this soon after `create` is
          // the create→sendMessage visibility race and is retried; any other
          // rejection is permanent and fails fast.
          const attemptSend = (attempt: number): void => {
            ctx.agents.sessions
              .sendMessage(session.sessionId, opts.companyId, {
                prompt,
                reason: 'compile pass',
                onEvent,
              })
              .catch((err: unknown) => {
                if (settled) return;
                const msg = err instanceof Error ? err.message : String(err);

                if (isTransientSessionNotFound(err)) {
                  if (attempt < SEND_RETRY_ATTEMPTS) {
                    const delay = SEND_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                    ctx.logger?.warn?.(
                      `sessionLlmAdapter: sendMessage attempt ${attempt}/${SEND_RETRY_ATTEMPTS} ` +
                        `rejected "${msg}" for session=${session.sessionId} — ` +
                        `retrying in ${delay}ms (create→sendMessage race)`,
                    );
                    setTimeout(() => {
                      if (!settled) attemptSend(attempt + 1);
                    }, delay);
                    return;
                  }
                  // Retries exhausted — surface a message that proves the retry
                  // ran, so the bulletin_compile_failures row is decisive
                  // evidence for the next drill.
                  finish(() =>
                    reject(
                      new Error(
                        `sendMessage rejected "${msg}" on all ${SEND_RETRY_ATTEMPTS} attempts ` +
                          `for session=${session.sessionId} (created ${session.createdAt}) — ` +
                          `create→sendMessage visibility race did not clear`,
                      ),
                    ),
                  );
                  return;
                }

                // A non-transient send failure (the send was rejected outright
                // — capability, budget, terminated agent) will never produce a
                // terminal event. Fail fast, no retry.
                finish(() => reject(err instanceof Error ? err : new Error(msg)));
              });
          };
          attemptSend(1);
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
