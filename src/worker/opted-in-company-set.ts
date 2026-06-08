// src/worker/opted-in-company-set.ts
//
// Phase 16.1 Plan 16.1-03 Task 1 (D-12 / D-13) — the lazy-seeded in-memory
// opted-in-company set. The membership primitive behind the ingress scope gate
// (LOOP-04): an issue/comment event whose companyId is NOT in this set produces
// zero host work, short-circuiting before any host call.
//
// WHY A SET (not a per-event DB read). The ingress handler runs for EVERY
// instance-wide host event. A per-event SELECT against clarity_user_prefs would
// reintroduce exactly the per-event DB churn the loop fix exists to stop. So the
// gate answers membership from an in-memory Set with ZERO per-event DB call; the
// Set is (re)seeded only at a coarse lazy/TTL boundary.
//
// L-2 (the single biggest unspecified item the SPEC deferred). clarity_user_prefs
// is user_id-keyed and has NO company_id column — opt-in is per USER, but the
// ingress event scope is per COMPANY. We resolve the user -> company mapping via
// the durable clarity_agent_owners table (migration 0013, plugin namespace):
// every operator-claimed Editor-Agent ownership row carries (owner_user_id,
// company_id). The seed therefore runs in two pure plugin-namespace SELECTs:
//   (a) SELECT user_id FROM clarity_user_prefs WHERE opted_in_at IS NOT NULL
//   (b) SELECT DISTINCT company_id FROM clarity_agent_owners
//         WHERE owner_user_id = ANY($1)   -- the opted-in user_id list
// Both are ctx.db.query (SELECT-only); NEITHER is a host call (no ctx.companies
// / ctx.agents / ctx.http). This is invocation-scope-safe — the same query class
// the circuit-breaker / owner-resolver already run in handler scope.
//
// L-3 (boot host calls dead on 2026.525.0). The seed must NOT run at module load
// / worker boot — a call issued outside an active host->worker invocation is
// rejected (PR #6547 invocation-scope). ensureSeeded is therefore called the
// FIRST time an event handler invocation needs the set (lazy), never at import.
// ctx.db.query works in handler scope (proven by the breaker).
//
// W-2 (the behavioral acceptance). An opted-in user U whose company c1 is
// recorded in clarity_agent_owners (owner_user_id=U, company_id=c1) MUST be
// present in the set after a lazy seed — the gate must never silently seed empty
// when a real opted-in mapping exists. A user with no owners row maps to nothing
// (documented limitation: only operator-claimed ownership links a user to a
// company in the plugin namespace).
//
// FAIL-CLOSED. On a seed query error the set is left AS-IS (and a warn is
// logged) — an error is NEVER treated as everyone-opted-in. Default state is an
// empty set (default OFF; coexistence guarantee #1).
//
// NOTE (Node strip-only TS): imported by `.mjs` tests under Node's type-stripping
// loader, which does NOT support TS parameter properties or other emit-requiring
// syntax. Module-level state + plain functions only; no parameter-property
// shorthand on any class field.

import type { PluginDatabaseClient, PluginLogger } from '@paperclipai/plugin-sdk';

/** The ctx subset the seed needs: a SELECT-capable db + an optional logger. */
export type OptedInCompanySetCtx = {
  logger?: PluginLogger;
  db: Pick<PluginDatabaseClient, 'query'>;
};

/**
 * TTL for the seeded set. After this window the next ensureSeeded re-reads so an
 * opt-in change that did NOT come through invalidateOptedInCache (e.g. a direct
 * DB edit, or a multi-process write) is still picked up within the window.
 * Conservative 60s: long enough that a burst of events shares one seed, short
 * enough that opt-in state is never more than a minute stale. (Discretion.)
 */
export const OPTED_IN_SEED_TTL_MS = 60_000;

// Module-level state. `optedInCompanies` is the membership Set; `lastSeededAt`
// is null when unseeded (forces a seed on the next ensureSeeded). `nowFn` is
// injectable for tests but defaults to Date.now.
let optedInCompanies: Set<string> = new Set<string>();
let lastSeededAt: number | null = null;
const nowFn: () => number = () => Date.now();

/**
 * Lazily (re)seed the opted-in-company set. Runs the two-step pure
 * plugin-namespace seed when the set is unseeded OR the TTL has elapsed;
 * otherwise it is a cheap no-op (the fast path — zero DB call). MUST be awaited
 * by an event-handler invocation before isCompanyOptedIn is consulted. NEVER
 * called at module load / boot (L-3).
 */
export async function ensureSeeded(ctx: OptedInCompanySetCtx): Promise<void> {
  const now = nowFn();
  if (lastSeededAt !== null && now - lastSeededAt < OPTED_IN_SEED_TTL_MS) {
    return; // fresh — fast path, no DB
  }
  try {
    // (a) opted-in user_id list — reuse the opt-in-guard SELECT shape.
    const prefRows = await ctx.db.query<{ user_id: string }>(
      `SELECT user_id
       FROM plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs
       WHERE opted_in_at IS NOT NULL`,
      [],
    );
    const userIds = prefRows
      .map((r) => r.user_id)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    const next = new Set<string>();
    if (userIds.length > 0) {
      // (b) map opted-in user_ids -> companies via the durable
      // clarity_agent_owners table (migration 0013). Pure plugin-namespace
      // SELECT, NO host call. This is the concrete W-2 / L-2 mechanism.
      const ownerRows = await ctx.db.query<{ company_id: string }>(
        `SELECT DISTINCT company_id
         FROM plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners
         WHERE owner_user_id = ANY($1)`,
        [userIds],
      );
      for (const row of ownerRows) {
        if (typeof row.company_id === 'string' && row.company_id.length > 0) {
          next.add(row.company_id);
        }
      }
    }
    // Atomic swap — only replace the live set once both queries succeeded.
    optedInCompanies = next;
    lastSeededAt = now;
  } catch (e) {
    // Fail-closed: leave the set AS-IS. An error is NEVER everyone-opted-in.
    // We do NOT advance lastSeededAt, so the next invocation retries the seed.
    ctx.logger?.warn?.('opted-in-company-set: seed failed (fail-closed, set unchanged)', {
      err: (e as Error).message,
    });
  }
}

/**
 * Pure in-memory membership test (zero DB call). The caller MUST have awaited
 * ensureSeeded first. Returns false for any company not in the seeded set
 * (default OFF / out-of-scope).
 */
export function isCompanyOptedIn(companyId: string | null | undefined): boolean {
  if (!companyId) return false;
  return optedInCompanies.has(companyId);
}

/**
 * Clear lastSeededAt so the next ensureSeeded re-reads. Wired to the set-opt-in
 * RPC path so an opt-in change refreshes the set without waiting out the TTL
 * (D-12). Does NOT clear the current membership set — the next seed replaces it
 * atomically (keeps the gate closed-correct between invalidate and re-seed).
 */
export function invalidateOptedInCache(): void {
  lastSeededAt = null;
}
