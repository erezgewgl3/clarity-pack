// src/worker/agents/circuit-breaker.ts
//
// Plan 02-03 Task 1 — D-06 circuit breaker. After MAX_CONSECUTIVE_FAILURES (3)
// consecutive failures, ctx.agents.pause(agentId, companyId) is invoked
// exactly once. No auto-resume, no exponential backoff — the operator must
// explicitly click Resume in Paperclip's classic agent panel. This is the
// governance-parity property (coexistence #4): the Editor-Agent uses the
// host's standard pause primitive, not a plugin-private mechanism.
//
// Counter is in-memory per worker process and keyed by agentKey. Survives
// the worker, not host restarts. The durable audit log is
// `plugin_clarity_pack_cdd6bda4bd.editor_agent_failures` — every failure
// appends a row regardless of whether pause fires this round. v2 reads the
// last MAX_CONSECUTIVE_FAILURES rows from the DB on worker boot to rebuild
// state (deferred).
//
// IMPORTANT: ctx.agents.pause takes (agentId, companyId) per the SDK
// 2026.512.0 signature — agentId is the resolved UUID from
// ctx.agents.managed.reconcile(), NOT the agentKey. Plan 02-03 originally
// sketched the call as pause(agentKey, reason) but the SDK is the source of
// truth (verified empirically against
// node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1119).

/** D-06 locked: 3 consecutive failures trigger pause. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Plan 03-02 — Separate counter key so bulletin-compile failures track
 * independently from compile-tldr's. A bulletin LLM outage must NOT pause
 * TL;DR compiles (governance parity per D-06): each agentKey owns its own
 * consecutive-failure counter in the per-process map.
 */
export const BULLETIN_COMPILE_AGENT_KEY = 'bulletin-compile';

// Per-worker-process counter. Test code calls resetCircuitBreakerState() to
// isolate tests. Production code lets the map grow naturally — keys are
// short (agentKey strings) so memory pressure is nil.
const counters = new Map<string, number>();

/**
 * Test-only escape hatch. Resets the per-process consecutive-failure counter.
 * In production, counters are reset by recordSuccess() — there is no other
 * reset path on purpose.
 */
export function resetCircuitBreakerState(): void {
  counters.clear();
}

export type CircuitBreakerCtx = {
  agents: {
    pause(agentId: string, companyId: string): Promise<unknown>;
  };
  db: {
    execute(sql: string, params: unknown[]): Promise<unknown>;
  };
};

export type RecordFailureArgs = {
  agentKey: string;
  agentId: string;
  companyId: string;
  reason: string;
};

/**
 * Increment the consecutive-failure counter for `agentKey`. Append a row to
 * the editor_agent_failures audit table. When the counter hits
 * MAX_CONSECUTIVE_FAILURES, invoke ctx.agents.pause(agentId, companyId) ONCE.
 * Returns the new consecutive count.
 */
export async function recordFailure(
  ctx: CircuitBreakerCtx,
  args: RecordFailureArgs,
): Promise<number> {
  const next = (counters.get(args.agentKey) ?? 0) + 1;
  counters.set(args.agentKey, next);

  // Audit row first (durable). Baked namespace per 02-01 SMOKE-FINDINGS Finding #4.
  await ctx.db.execute(
    'INSERT INTO plugin_clarity_pack_cdd6bda4bd.editor_agent_failures (agent_key, reason, consecutive) VALUES ($1, $2, $3)',
    [args.agentKey, args.reason, next],
  );

  if (next >= MAX_CONSECUTIVE_FAILURES) {
    await ctx.agents.pause(args.agentId, args.companyId);
  }

  return next;
}

/**
 * Reset the consecutive-failure counter for `agentKey` (typically called after
 * a successful compile). Does NOT call ctx.agents.resume — un-pause is an
 * operator gesture by design (D-06: no auto-resume).
 */
export function recordSuccess(agentKey: string): void {
  counters.set(agentKey, 0);
}
