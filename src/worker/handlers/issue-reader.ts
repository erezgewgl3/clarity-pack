// src/worker/handlers/issue-reader.ts
//
// Plan 02-03 Task 2 — registers the 'issue.reader' data handler. Composes:
//   - tldr from plugin_clarity_pack_cdd6bda4bd.tldr_cache (most-recent row)
//   - refCards by extracting BEAAA-NNN from body + resolving in ONE round-trip
//     (PRIM-01)
//   - ancestry (project → milestone → parent) via ctx.issues.ancestry
//   - acItems from plugin_clarity_pack_cdd6bda4bd.ac_checklist_items
//   - activity distilled to <= 8 items (READER-09: only state_change, comment,
//     work_product_write — drops label_change / title_edit / etc.)
//   - deliverable via ctx.issue.documents.read({ latest: true }), normalized
//
// All SQL targets the baked plugin namespace (Finding #4). Opt-in check is
// NOT enforced here (Plan 02-04 adds the opt-in-guard wrapper); for 02-03
// the assumption is "viewer is opted in" and a follow-up plan flips the
// switch.

import type { RefCardData, TLDR } from '../../shared/types.ts';
import { resolveRefs } from '../../shared/reference-resolver.ts';
import { getTldrByScope, type TldrCacheCtx } from '../db/tldr-cache.ts';

const REF_PATTERN = /\bBEAAA-\d+\b/g;
const ACTIVITY_KEEP_KINDS = new Set(['state_change', 'comment', 'work_product_write']);
const ACTIVITY_LIMIT = 8; // READER-09
const RAW_ACTIVITY_FETCH = 50;
const EXCERPT_MAX = 280;

export type IssueReaderResult = {
  tldr: TLDR | null;
  refCards: RefCardData[];
  ancestry: { project: unknown; milestone: unknown; parent: unknown } | null;
  acItems: unknown[];
  activity: unknown[];
  deliverable: { filename: string; last_write_at: string } | null;
  issueBody: string | null;
};

type RawHostIssue = {
  key: string;
  title: string;
  status: RefCardData['status'];
  assignee_user_id: string | null;
  body?: string;
  _viewer_can_read?: boolean;
};

function truncateExcerpt(body: string | undefined, max = EXCERPT_MAX): string {
  if (!body) return '';
  if (body.length <= max) return body;
  const slice = body.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…';
}

export type IssueReaderCtx = {
  logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void; error?(...a: unknown[]): void };
  host?: { currentCompanyId?: string };
  data: {
    register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  };
  db: {
    execute(sql: string, params: unknown[]): Promise<unknown>;
    query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  };
  http: {
    fetch(url: string, init?: { method?: string }): Promise<{ json(): Promise<unknown> }>;
  };
  issues: {
    get(issueId: string): Promise<{ id: string; body: string }>;
    ancestry?(issueId: string): Promise<{ project: unknown; milestone: unknown; parent: unknown }>;
  };
  issue: {
    documents: { read(issueId: string, opts?: { latest?: boolean }): Promise<{ filename: string; last_write_at: string } | null> };
  };
  activity: {
    log: { read(opts: { issueId: string; limit?: number }): Promise<Array<{ kind: string; actor: string; at: string; detail?: string }>> };
  };
};

export function registerIssueReader(ctx: IssueReaderCtx): void {
  ctx.data.register('issue.reader', async (params) => {
    const issueId = String(params.issueId ?? '');
    if (!issueId) {
      const empty: IssueReaderResult = {
        tldr: null,
        refCards: [],
        ancestry: null,
        acItems: [],
        activity: [],
        deliverable: null,
        issueBody: null,
      };
      return empty;
    }

    const issue = await ctx.issues.get(issueId);

    // Extract refs (dedupe inside resolveRefs already; we dedupe at this layer
    // too so the fetch URL is short).
    const refs = Array.from(
      new Set([...(issue.body || '').matchAll(REF_PATTERN)].map((m) => m[0])),
    );

    // TL;DR — most recent for (surface=issue, scope_id=issueId). Cast the ctx
    // through TldrCacheCtx because IssueReaderCtx's db.query returns unknown[]
    // (handler-bridge generic shape) while getTldrByScope expects TldrRow[].
    const tldrRow = await getTldrByScope(ctx as unknown as TldrCacheCtx, 'issue', issueId);
    // Map DB row shape → TLDR type. Both are compatible; the type cast is
    // safe because the schema enforces all required fields.
    const tldr = (tldrRow as unknown as TLDR | null);

    // Single round-trip ref resolution (PRIM-01). resolveRefs internally
    // dedupes, then calls our fetcher with the unique-id list.
    const companyId = ctx.host?.currentCompanyId;
    const refCards =
      refs.length === 0 || !companyId
        ? []
        : await resolveRefs(refs, async (uniqueIds) => {
            const url = `/api/companies/${encodeURIComponent(companyId)}/issues?ids=${uniqueIds.map(encodeURIComponent).join(',')}`;
            const resp = await ctx.http.fetch(url, { method: 'GET' });
            const items = (await resp.json()) as RawHostIssue[];
            return items.map((i) => ({
              id: i.key,
              title: i.title,
              status: i.status,
              ownerUserId: i.assignee_user_id,
              bodyExcerptForViewer: i._viewer_can_read === false ? null : truncateExcerpt(i.body),
              url: `/issues/${i.key}`,
            }));
          });

    const ancestry = ctx.issues.ancestry
      ? await ctx.issues.ancestry(issueId).catch(() => null)
      : null;

    const acItemsResult = await ctx.db.query(
      'SELECT id, issue_id, label, checked, display_order FROM plugin_clarity_pack_cdd6bda4bd.ac_checklist_items WHERE issue_id = $1 ORDER BY display_order ASC',
      [issueId],
    );

    const rawActivity = await ctx.activity.log.read({ issueId, limit: RAW_ACTIVITY_FETCH }).catch(() => []);
    const distilled = rawActivity.filter((e) => ACTIVITY_KEEP_KINDS.has(e.kind)).slice(0, ACTIVITY_LIMIT);

    const deliverable = await ctx.issue.documents.read(issueId, { latest: true }).catch(() => null);

    const result: IssueReaderResult = {
      tldr,
      refCards,
      ancestry,
      acItems: acItemsResult.rows,
      activity: distilled,
      deliverable,
      issueBody: issue.body ?? null,
    };
    return result;
  });
}
