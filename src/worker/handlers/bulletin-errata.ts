// src/worker/handlers/bulletin-errata.ts
//
// Plan 03-04 - BULL-07 errata as a first-class append-only bulletin type.
// Adds:
//   - bulletin.errata.byCycle data handler for footer reads
//   - bulletin.errata.add action handler for Settings-page writes
//
// Errata never mutate a published bulletin issue body. The only UPDATE in the
// whole flow is publish.ts marking applied_to_issue_comment_id after the next
// cycle appends the errata snapshot as an issue comment.

import {
  wrapActionHandler,
  wrapDataHandler,
  type OptInGuardActionCtx,
  type OptInGuardDataCtx,
} from '../opt-in-guard.ts';
import {
  appendErratum,
  getBulletinByCycle,
  listErrataByCycle,
  type BulletinsRepoCtx,
  type ErratumRow,
} from '../db/bulletins-repo.ts';
import type { ErratumEntry } from '../../shared/types.ts';

export type BulletinErrataCtx = OptInGuardDataCtx & OptInGuardActionCtx & BulletinsRepoCtx;

const MAX_ERRATA_BODY_LEN = 2000;

function toCycle(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return n > 0 ? n : null;
  }
  return null;
}

function mapErratum(row: ErratumRow): ErratumEntry {
  return {
    id: row.id,
    bulletinCycleNumber: row.bulletin_cycle_number,
    addedAt: row.added_at,
    addedByUserId: row.added_by_user_id,
    bodyMd: row.body_md,
    appliedToIssueCommentId: row.applied_to_issue_comment_id,
  };
}

export function registerBulletinErrata(ctx: BulletinErrataCtx): void {
  wrapDataHandler(ctx, 'bulletin.errata.byCycle', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const cycle = toCycle(params?.cycle);

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!cycle) return { error: 'CYCLE_REQUIRED' as const };

    const rows = await listErrataByCycle(ctx, companyId, cycle);
    return rows.map(mapErratum);
  });

  wrapActionHandler(ctx, 'bulletin.errata.add', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId = typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const cycle = toCycle(params?.cycle);
    const body = typeof params?.body === 'string' ? params.body.trim() : '';

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!cycle) return { error: 'CYCLE_REQUIRED' as const };
    if (body.length === 0 || body.length > MAX_ERRATA_BODY_LEN) {
      return { error: 'INVALID_BODY' as const };
    }

    const bulletin = await getBulletinByCycle(ctx, companyId, cycle);
    if (!bulletin || bulletin.compile_status !== 'published' || !bulletin.published_issue_id) {
      return { error: 'NOT_PUBLISHED' as const };
    }

    const inserted = await appendErratum(ctx, {
      bulletin_cycle_number: cycle,
      added_by_user_id: userId,
      body_md: body,
      applied_to_issue_comment_id: null,
    });

    return { ok: true as const, errataId: inserted.id };
  });
}
