// src/worker/bulletin/publish.ts
//
// Plan 03-02 — Two-phase publish of a verified BulletinDraft (BULL-09, D-16).
//
// Write order (T-03-12, RESEARCH.md Pattern 2):
//   1. INSERT bulletins (compile_status='attempting', content_hash,
//      next_due_at, draft_json = the verified BulletinDraft per W3/W4)
//      — UNIQUE(next_due_at, content_hash) enforces idempotency (D-13).
//   2. ctx.issues.create(...) — the canonical body lands in public.issues.
//   3. UPDATE bulletins SET published_issue_id, published_at,
//      compile_status='published'.
//
// On ANY failure after step 1, the bulletins row stays at 'attempting' — the
// retry loop reconciles it; there are no half-published rows. A concurrent
// fire whose INSERT hits ON CONFLICT DO NOTHING re-reads the row; if it is
// already 'published' the publish is reported as a duplicate and no second
// issue is created.

import crypto from 'node:crypto';

import type { PluginIssuesClient, PluginDatabaseClient } from '@paperclipai/plugin-sdk';
import { formatInTimeZone } from 'date-fns-tz';

import { BULLETIN_TZ } from './next-due-at.ts';
import { renderBulletinIssueBody } from '../../shared/bulletin-rendering.ts';
import type { BulletinDraft } from '../../shared/types.ts';

export type PublishBulletinCtx = {
  db: Pick<PluginDatabaseClient, 'query' | 'execute'>;
  issues: Pick<PluginIssuesClient, 'create'> & Partial<Pick<PluginIssuesClient, 'createComment'>>;
  logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void };
};

export type PublishBulletinArgs = {
  companyId: string;
  cycleNumber: number;
  nextDueAtIso: string;
  editorAgentId: string;
  draft: BulletinDraft;
  compiledAt: Date;
  priorCycleErratumSnapshot?: {
    priorIssueId: string;
    erratumIds: number[];
    erratumBodies: string[];
  };
};

export type PublishResult =
  | { kind: 'published'; cycleNumber: number; publishedIssueId: string; publishedAt: string }
  | { kind: 'duplicate'; cycleNumber: number }
  | { kind: 'failed'; reason: string };

/** Deterministic 16-hex content hash over the rendered body. */
function syncHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

const BULLETINS_TABLE = 'plugin_clarity_pack_cdd6bda4bd.bulletins';
const ERRATA_TABLE = 'plugin_clarity_pack_cdd6bda4bd.bulletin_errata';

function renderErrataSnapshotBody(erratumBodies: string[]): string {
  const items = erratumBodies.map((body) => `- ${body}`);
  return ['**Errata appended after publish:**', '', ...items].join('\n');
}

async function appendPriorCycleErrataSnapshot(
  ctx: PublishBulletinCtx,
  args: PublishBulletinArgs,
): Promise<void> {
  const snapshot = args.priorCycleErratumSnapshot;
  if (!snapshot || snapshot.erratumIds.length === 0 || snapshot.erratumBodies.length === 0) {
    return;
  }
  if (!ctx.issues.createComment) {
    ctx.logger?.warn?.('publishBulletin: errata snapshot skipped; createComment unavailable', {
      priorIssueId: snapshot.priorIssueId,
    });
    return;
  }

  try {
    const comment = await ctx.issues.createComment(
      snapshot.priorIssueId,
      renderErrataSnapshotBody(snapshot.erratumBodies),
      args.companyId,
      {},
    );
    const commentId = (comment as { id?: string } | null)?.id ?? null;
    if (!commentId) return;
    for (const erratumId of snapshot.erratumIds) {
      await ctx.db.execute(
        `UPDATE ${ERRATA_TABLE}
           SET applied_to_issue_comment_id = $1
         WHERE id = $2 AND applied_to_issue_comment_id IS NULL`,
        [commentId, erratumId],
      );
    }
  } catch (e) {
    ctx.logger?.warn?.('publishBulletin: errata snapshot comment failed', {
      priorIssueId: snapshot.priorIssueId,
      err: (e as Error).message,
    });
  }
}

/**
 * Publish a verified bulletin draft via the two-phase write. Returns a typed
 * PublishResult; never throws on an expected failure path.
 */
export async function publishBulletin(
  ctx: PublishBulletinCtx,
  args: PublishBulletinArgs,
): Promise<PublishResult> {
  const body = renderBulletinIssueBody(args.draft);
  const contentHash = syncHash(body);
  const weekday = formatInTimeZone(args.compiledAt, BULLETIN_TZ, 'EEEE');
  const dateText = formatInTimeZone(args.compiledAt, BULLETIN_TZ, 'yyyy-MM-dd');
  const title = `Bulletin No. ${args.cycleNumber} — ${weekday}, ${dateText}`;

  const existingForDue = await ctx.db.query<{ compile_status: string; content_hash?: string }>(
    `SELECT compile_status, content_hash
     FROM ${BULLETINS_TABLE}
     WHERE next_due_at = $1 AND compile_status = 'published'
     LIMIT 1`,
    [args.nextDueAtIso],
  );
  if (existingForDue[0]?.compile_status === 'published') {
    const existingHash = existingForDue[0].content_hash;
    if (existingHash && existingHash !== contentHash) {
      return {
        kind: 'failed',
        reason: 'published bulletin already exists for next_due_at with a different content_hash',
      };
    }
    return { kind: 'duplicate', cycleNumber: args.cycleNumber };
  }

  // ---- Phase 1: INSERT attempting (idempotency via UNIQUE constraint) ----
  try {
    await ctx.db.execute(
      `INSERT INTO ${BULLETINS_TABLE}
         (cycle_number, company_id, next_due_at, compiled_at, compile_status,
          content_hash, lineage_thread_json, draft_json)
       VALUES ($1, $2, $3, $4, 'attempting', $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (next_due_at, content_hash) DO NOTHING`,
      // W3/W4: draft_json stores the full verified BulletinDraft so Plan
      // 03-03's bulletin-by-cycle handler returns typed props with NO
      // markdown re-parser.
      [
        args.cycleNumber,
        args.companyId,
        args.nextDueAtIso,
        args.compiledAt.toISOString(),
        contentHash,
        JSON.stringify(args.draft.lineageThreads),
        JSON.stringify(args.draft),
      ],
    );
  } catch (e) {
    ctx.logger?.warn?.('publishBulletin: phase 1 INSERT failed', {
      err: (e as Error).message,
    });
    return { kind: 'failed', reason: `bulletins INSERT failed: ${(e as Error).message}` };
  }

  // Idempotency check: if a concurrent fire already published this exact
  // (next_due_at, content_hash) row, our INSERT was a no-op — report duplicate.
  const owns = await ctx.db.query<{ compile_status: string }>(
    `SELECT compile_status FROM ${BULLETINS_TABLE} WHERE next_due_at = $1 AND content_hash = $2`,
    [args.nextDueAtIso, contentHash],
  );
  if (owns[0]?.compile_status === 'published') {
    return { kind: 'duplicate', cycleNumber: args.cycleNumber };
  }

  // ---- Phase 2: ctx.issues.create ----
  let issue: { id: string } | null;
  try {
    issue = (await ctx.issues.create({
      companyId: args.companyId,
      title,
      description: body,
      tags: ['clarity:bulletin', 'clarity:bulletin-issue', `cycle:${args.cycleNumber}`],
      authorAgentId: args.editorAgentId,
    } as Parameters<PluginIssuesClient['create']>[0])) as { id: string } | null;
  } catch (e) {
    ctx.logger?.warn?.('publishBulletin: ctx.issues.create threw', {
      err: (e as Error).message,
    });
    // Leave bulletins.compile_status='attempting' for the retry loop.
    return { kind: 'failed', reason: `ctx.issues.create threw: ${(e as Error).message}` };
  }

  if (!issue || !issue.id) {
    return { kind: 'failed', reason: 'ctx.issues.create returned null' };
  }

  // ---- Phase 3: UPDATE bulletins SET compile_status='published' ----
  const publishedAtIso = new Date().toISOString();
  try {
    await ctx.db.execute(
      `UPDATE ${BULLETINS_TABLE}
         SET published_issue_id = $1, published_at = $2, verified_at = $2,
             compile_status = 'published'
       WHERE next_due_at = $3 AND content_hash = $4`,
      [issue.id, publishedAtIso, args.nextDueAtIso, contentHash],
    );
  } catch (e) {
    ctx.logger?.warn?.('publishBulletin: phase 3 UPDATE failed', {
      err: (e as Error).message,
    });
    // Issue exists but metadata didn't flip — next cycle's compile resolves the orphan.
    return { kind: 'failed', reason: `UPDATE published failed: ${(e as Error).message}` };
  }

  await appendPriorCycleErrataSnapshot(ctx, args);

  return {
    kind: 'published',
    cycleNumber: args.cycleNumber,
    publishedIssueId: issue.id,
    publishedAt: publishedAtIso,
  };
}
