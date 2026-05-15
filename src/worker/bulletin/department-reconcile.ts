// src/worker/bulletin/department-reconcile.ts
//
// Plan 03-03 — BULL-04 department-membership reconcile (D-20).
//
// reconcileDepartments runs at the start of every compile cycle: it lists the
// company's agents and UPSERTs a department row for each. The UPSERT in
// bulletins-repo.ts uses `ON CONFLICT (company_id, employee_user_id)
// DO NOTHING`, so an existing row — including a manual-source override — is
// never clobbered. Idempotent: running it N times has the same effect as
// running it once.
//
// deriveDepartmentForAgent is a pure role-regex heuristic. v1 mapping:
//   /sales|cold-email|outreach|sdr|prospect/      → Sales
//   /customer|onboarding|refund|support|cs/       → Customer
//   /builder|engineer|developer|dev|eng|infra/    → Builder
//   /writer|producer|scout|qa|classifier|editor/  → Production
//   else                                          → Builder (fallback per D-20)
//
// agents.list failure degrades to a warn + early return (a missing reconcile
// just means the bulletin shows stale department tags — never a crash).

import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';
import { upsertDepartmentMembership, type BulletinsRepoCtx } from '../db/bulletins-repo.ts';

export type ReconcileDepartmentsCtx = BulletinsRepoCtx & {
  agents: PluginAgentsClient;
  logger?: PluginLogger;
};

/**
 * Pure function. Maps an agent's role string to one of the four v1
 * departments. Always returns a non-null department; defaults to 'Builder'.
 */
export function deriveDepartmentForAgent(agent: { role?: string }): string {
  const role = (agent?.role ?? '').toLowerCase();
  if (/\bsales\b|cold[- ]?email|outreach|\bsdr\b|business[- ]?dev|prospect/.test(role)) {
    return 'Sales';
  }
  if (/\bcustomer\b|onboarding|refund|support|\bcs\b|success/.test(role)) {
    return 'Customer';
  }
  if (/\bbuilder\b|engineer|developer|\bdev\b|\beng\b|backend|frontend|infra/.test(role)) {
    return 'Builder';
  }
  if (/writer|producer|scout|\bqa\b|classifier|scorer|editor|publisher|signal/.test(role)) {
    return 'Production';
  }
  return 'Builder'; // D-20 default fallback
}

/**
 * Idempotent reconcile of clarity_department_membership for one company.
 * Called once at the start of each compile cycle.
 */
export async function reconcileDepartments(
  ctx: ReconcileDepartmentsCtx,
  companyId: string,
): Promise<void> {
  let agents: Array<{ userId?: string; role?: string }>;
  try {
    agents = (await ctx.agents.list({ companyId })) as unknown as Array<{
      userId?: string;
      role?: string;
    }>;
  } catch (e) {
    ctx.logger?.warn?.('reconcileDepartments: agents.list failed', {
      companyId,
      err: (e as Error).message,
    });
    return;
  }

  for (const agent of agents ?? []) {
    const userId = agent?.userId;
    if (!userId) continue;
    const department = deriveDepartmentForAgent({ role: agent?.role });
    try {
      await upsertDepartmentMembership(ctx, {
        company_id: companyId,
        employee_user_id: userId,
        department,
        source: 'reconcile',
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      ctx.logger?.warn?.('reconcileDepartments: UPSERT failed', {
        companyId,
        userId,
        err: (e as Error).message,
      });
    }
  }
}
