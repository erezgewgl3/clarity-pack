// src/worker/situation/founder-resolution.ts
//
// Phase 17 Plan 17-01 Task 3 (WAIT-02, D-06) — instance-agnostic resolution of
// the company's primary human (the founder), used as the owner of every
// structured human-wait row.
//
// D-06 single-operator simplification (consistent with the v1.5.0 lock —
// "legible-for-non-builders, NOT multi-operator"): the structured-wait owner is
// ALWAYS the company's primary human, ignoring any issue-level human assignee.
// We resolve that human in an instance-agnostic way — no company-prefix string and no operator
// name string are ever hard-coded here; the function stays instance-agnostic
// per the project constraint.
//
// SOURCE OF TRUTH: clarity_agent_owners (migration 0013) is the canonical
// owner<->company mapping the opt-in gate already uses. We REUSE
// listClarityAgentOwnersForCompany — no new SQL query. We deliberately avoid
// the bulletin name-resolution helper, which returns a company NAME string, not
// a user id.
//
// DEGRADE-SAFE: when NO owner row exists for the company, return null. The
// caller (the 17-03 populator) then SKIPS writing the wait, so the issue falls
// to the honest conservative Watch floor rather than fabricating a needs-you.

import {
  listClarityAgentOwnersForCompany,
  type ClarityAgentOwnersRepoCtx,
} from '../db/clarity-agent-owners-repo.ts';

/**
 * Resolve the company's primary human (founder) user id from the claimed-owner
 * rows. Returns null when no owner has been claimed (degrade-safe skip).
 *
 * Tie-break (17-RESEARCH Open Question 1): under the v1.5.0 solo-operator lock
 * there is exactly one distinct owner_user_id per company, so the common path is
 * unambiguous. If MORE than one distinct owner_user_id is present (e.g. a future
 * multi-operator instance, or a stale claim), we pick DETERMINISTICALLY: the
 * lexicographically smallest owner_user_id. The repo's
 * listClarityAgentOwnersForCompany projects only { agent_id, owner_user_id }
 * (no set_at), so an "earliest set_at" tie-break is not available here without a
 * wider query; the lexicographic smallest is stable, query-free, and good
 * enough for the conservative solo-operator default. Determinism matters because
 * this id flows into the persisted wait row read by the pure engine.
 */
export async function resolveFounderUserId(
  ctx: ClarityAgentOwnersRepoCtx,
  companyId: string,
): Promise<string | null> {
  const owners = await listClarityAgentOwnersForCompany(ctx, companyId);

  const distinct = [...new Set(owners.map((o) => o.owner_user_id))].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );

  if (distinct.length === 0) {
    // No owner claimed → degrade-safe skip (caller does not write the wait).
    return null;
  }

  // Deterministic tie-break: lexicographically smallest distinct owner id.
  distinct.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return distinct[0]!;
}
