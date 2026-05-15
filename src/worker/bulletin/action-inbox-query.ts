// src/worker/bulletin/action-inbox-query.ts
//
// Plan 03-03 — BULL-03 "Requires Your Decision" inbox query (D-19 corrected
// mapping). A card surfaces only when an issue is:
//   status === 'blocked'
//   AND  assigneeUserId === viewerUserId   (T-03-15 — server-side viewer filter)
//   AND  blockerAttention.state ∈ {needs_attention, stalled}
//   AND  updatedAt within the last ACTION_INBOX_WINDOW_DAYS days
//
// SDK NOTE: @paperclipai/plugin-sdk@2026.512.0's exported `Issue` type does
// not formally carry `blockerAttention`, `identifier`, or `awaitingSince` —
// Phase 2's flatten-blocker-chain.ts already reads optional Issue fields via
// best-effort casts. We follow that convention: every non-core field is read
// through a narrow cast with a defensive fallback. The host populates these at
// runtime; CI types stay clean.
//
// Department tag joins clarity_department_membership (falls back to 'Builder').
// Age is computed worker-side. ctx.issues.list failure degrades to [] (warn,
// not throw) so the bulletin page never 502s on a transient host hiccup.

import type { PluginIssuesClient, PluginDatabaseClient, PluginLogger } from '@paperclipai/plugin-sdk';
import type { ActionInboxCard } from '../../shared/types.ts';

const ACTION_INBOX_WINDOW_DAYS = 30;
const ACTION_INBOX_MAX = 50;

const NAMESPACE = 'plugin_clarity_pack_cdd6bda4bd';

export type ActionInboxCtx = {
  issues: PluginIssuesClient;
  db: PluginDatabaseClient;
  logger?: PluginLogger;
};

export type ActionInboxArgs = {
  companyId: string;
  viewerUserId: string;
  now?: Date;
};

/** The optional Issue fields we read defensively (not formal on the SDK type). */
type IssueLike = {
  id: string;
  identifier?: string;
  title?: string;
  description?: string;
  status?: string;
  assigneeUserId?: string | null;
  blockerAttention?: { state?: string };
  updatedAt?: string;
  awaitingSince?: string;
};

export async function queryActionInbox(
  ctx: ActionInboxCtx,
  args: ActionInboxArgs,
): Promise<ActionInboxCard[]> {
  const now = args.now ?? new Date();

  let issues: IssueLike[];
  try {
    issues = (await ctx.issues.list({
      companyId: args.companyId,
      status: 'blocked' as never,
    })) as unknown as IssueLike[];
  } catch (e) {
    ctx.logger?.warn?.('action-inbox: ctx.issues.list failed', {
      companyId: args.companyId,
      err: (e as Error).message,
    });
    return [];
  }

  const cutoff = now.getTime() - ACTION_INBOX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Pre-fetch department membership once per call.
  let memberships: Array<{ employee_user_id: string; department: string }> = [];
  try {
    memberships = await ctx.db.query<{ employee_user_id: string; department: string }>(
      `SELECT employee_user_id, department
       FROM ${NAMESPACE}.clarity_department_membership
       WHERE company_id = $1`,
      [args.companyId],
    );
  } catch (e) {
    ctx.logger?.warn?.('action-inbox: department membership lookup failed', {
      companyId: args.companyId,
      err: (e as Error).message,
    });
    memberships = [];
  }
  const deptMap = new Map(memberships.map((m) => [m.employee_user_id, m.department]));

  const out: ActionInboxCard[] = [];
  for (const i of issues ?? []) {
    // T-03-15 — explicit viewer-ownership filter (defence in depth over host ACL).
    if (!i.assigneeUserId || i.assigneeUserId !== args.viewerUserId) continue;

    // D-19 — only needs_attention + stalled blocker-attention states.
    const state = i.blockerAttention?.state;
    if (state !== 'needs_attention' && state !== 'stalled') continue;

    // 30-day window cap.
    const updatedAt = i.updatedAt ?? i.awaitingSince;
    if (updatedAt && new Date(updatedAt).getTime() < cutoff) continue;

    const ageBasis = i.awaitingSince ?? i.updatedAt;
    const ageMs = ageBasis ? Math.max(0, now.getTime() - new Date(ageBasis).getTime()) : 0;

    out.push({
      issueId: i.id,
      identifier: i.identifier ?? i.id,
      title: i.title ?? '(untitled issue)',
      department: deptMap.get(i.assigneeUserId) ?? 'Builder',
      ageMs,
      ageText: formatAge(ageMs),
      summary: truncate(i.description, 280),
    });
    if (out.length >= ACTION_INBOX_MAX) break;
  }
  return out;
}

/** ms → "{N}m" (<1h), "{N}h" (<24h), "{N}d" (≥24h). */
export function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function truncate(s: string | undefined | null, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
