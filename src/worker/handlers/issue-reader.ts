// src/worker/handlers/issue-reader.ts
//
// Plan 02-03b Task 2 — issue.reader data handler, rewritten against the actual
// @paperclipai/plugin-sdk@2026.512.0 PluginContext surface. The Plan 02-03 draft
// of this handler assumed seven SDK shapes that don't exist; see
// .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md for the full
// diagnosis.
//
// Composes the reader payload:
//   - tldr        from plugin namespace tldr_cache (most-recent for issueId)
//   - issueBody   = Issue.description (NOT Issue.body — that field doesn't exist)
//   - refCards    from BEAAA-NNN extraction → single round-trip via resolveRefs (PRIM-01)
//   - ancestry    derived by walking parentId chain + resolving projectId + goalId
//                 (ctx.issues.ancestry does not exist; we walk ctx.issues.get)
//   - acItems     from plugin namespace ac_checklist_items
//   - activity    from ctx.issues.listComments (ctx.activity.log.read does not
//                 exist; the activity surface in the SDK is write-only at this
//                 version. We map each comment to a comment-kind timeline event.)
//   - deliverable from ctx.issues.documents.list (most-recent summary)
//
// Companies come from PARAMS, not from a fictional ctx.host.currentCompanyId.
// The UI side reads useHostContext() and passes companyId in usePluginData.
//
// Each data slice is wrapped in try/catch so partial-API failures degrade
// gracefully to null/empty rather than blanking the whole tab.

import type {
  PluginIssuesClient,
  PluginHttpClient,
  PluginProjectsClient,
  PluginGoalsClient,
  Issue,
  IssueComment,
} from '@paperclipai/plugin-sdk';

import type { RefCardData, TLDR } from '../../shared/types.ts';
import { resolveRefs } from '../../shared/reference-resolver.ts';
import { getTldrByScope, type TldrCacheCtx } from '../db/tldr-cache.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
// Plan 04.2-01 (RCB-06) — the reverse backlink: chat topics started FROM this
// issue. listChatTopicsByOriginIssue reads the migration-0009 origin_issue_id
// column; ChatTopicByOriginEntry is the camelCase row the Reader consumes.
import {
  listChatTopicsByOriginIssue,
  type ChatTopicsRepoCtx,
  type ChatTopicByOriginEntry,
} from '../db/chat-topics-repo.ts';

const REF_PATTERN = /\bBEAAA-\d+\b/g;
const ACTIVITY_LIMIT = 8; // READER-09
const ANCESTRY_MAX_DEPTH = 8;
const EXCERPT_MAX = 280;
const COMMENT_DETAIL_MAX = 120;

export type AncestryNode = { id: string; title: string; url: string } | null;
export type Ancestry = { project: AncestryNode; milestone: AncestryNode; parent: AncestryNode };

export type ActivityEvent = {
  kind: 'comment';
  actor: string | null;
  at: string;
  detail: string;
};

export type DeliverableSummary = { filename: string; last_write_at: string | null } | null;

export type IssueReaderResult = {
  tldr: TLDR | null;
  refCards: RefCardData[];
  ancestry: Ancestry | null;
  acItems: unknown[];
  activity: ActivityEvent[];
  deliverable: DeliverableSummary;
  issueBody: string | null;
  /** Plan 04.2-01 (RCB-06) — chat topics started FROM this issue (the reverse
   *  backlink). Empty for issues with no Reader-originated chat topics and for
   *  every pre-0009 issue. Feeds the Reader header's `<N> conversations about
   *  this issue` reverse-topics list. */
  topicsForIssue: ChatTopicByOriginEntry[];
};

type RawHostIssue = {
  key: string;
  title: string;
  status: RefCardData['status'];
  assignee_user_id: string | null;
  body?: string;
  _viewer_can_read?: boolean;
};

function truncate(s: string | undefined | null, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…';
}

// Composed from real SDK interface types — no narrow lying-about-the-SDK
// Ctx shape (see 02-03b-API-SHAPES.md Summary + Plan 02-04 critical anti-
// pattern guard). OptInGuardCtx provides `data` + `db` for wrapDataHandler.
export type IssueReaderCtx = OptInGuardDataCtx & {
  http: PluginHttpClient;
  issues: PluginIssuesClient;
  // projects + goals are optional at the local-type level so tests can stub
  // partial ctx without re-implementing every Paperclip client. Production
  // PluginContext always provides them.
  projects?: PluginProjectsClient;
  goals?: PluginGoalsClient;
};

function emptyResult(): IssueReaderResult {
  return {
    tldr: null,
    refCards: [],
    ancestry: null,
    acItems: [],
    activity: [],
    deliverable: null,
    issueBody: null,
    topicsForIssue: [],
  };
}

export function registerIssueReader(ctx: IssueReaderCtx): void {
  wrapDataHandler(ctx, 'issue.reader', async (params) => {
    const issueId = String(params.issueId ?? '');
    const companyId = String(params.companyId ?? '');
    if (!issueId) return emptyResult();
    if (!companyId) {
      // Fail loud so the UI bug (missing companyId in usePluginData) is obvious
      // instead of silently returning empty for every read.
      throw new Error('issue.reader: companyId required (UI must pass it via usePluginData)');
    }

    let issue: Issue | null = null;
    try {
      issue = await ctx.issues.get(issueId, companyId);
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: ctx.issues.get threw', { issueId, err: (e as Error).message });
    }
    if (!issue) {
      ctx.logger?.warn?.('issue.reader: issue not found', { issueId, companyId });
      return emptyResult();
    }

    // issueBody comes from Issue.description (not .body).
    const issueBodyValue = (issue as unknown as { description?: string | null }).description ?? null;

    // ---- TL;DR --------------------------------------------------------------
    let tldr: TLDR | null = null;
    try {
      const tldrRow = await getTldrByScope(ctx as unknown as TldrCacheCtx, 'issue', issueId);
      tldr = (tldrRow as unknown as TLDR | null);
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: tldr lookup failed', { err: (e as Error).message });
    }

    // ---- refCards (PRIM-01 single round-trip) -------------------------------
    let refCards: RefCardData[] = [];
    try {
      const refs = Array.from(
        new Set([...(issueBodyValue ?? '').matchAll(REF_PATTERN)].map((m) => m[0])),
      );
      if (refs.length > 0) {
        refCards = await resolveRefs(refs, async (uniqueIds) => {
          // 2026-05-27 BEAAA hotfix — see resolve-refs.ts. Paperclip
          // 2026.525.0 ctx.http.fetch requires absolute URLs.
          const apiBase = (
            (typeof process !== 'undefined' && process.env?.PAPERCLIP_API_URL) ||
            'http://localhost:3100'
          ).replace(/\/+$/, '');
          const url = `${apiBase}/api/companies/${encodeURIComponent(companyId)}/issues?ids=${uniqueIds.map(encodeURIComponent).join(',')}`;
          const resp = await ctx.http.fetch(url, { method: 'GET' });
          const items = (await resp.json()) as RawHostIssue[];
          return items.map((i) => ({
            id: i.key,
            title: i.title,
            status: i.status,
            ownerUserId: i.assignee_user_id,
            bodyExcerptForViewer:
              i._viewer_can_read === false ? null : truncate(i.body, EXCERPT_MAX),
            url: `/issues/${i.key}`,
          }));
        });
      }
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: refCards resolution failed', { err: (e as Error).message });
      refCards = [];
    }

    // ---- Ancestry (parent walk + project + goal) ----------------------------
    let ancestry: Ancestry | null = null;
    try {
      ancestry = await deriveAncestry(ctx, issue, companyId);
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: ancestry derivation failed', { err: (e as Error).message });
    }

    // ---- AC items from plugin namespace -------------------------------------
    let acItems: unknown[] = [];
    try {
      acItems = await ctx.db.query(
        'SELECT id, issue_id, label, checked, display_order FROM plugin_clarity_pack_cdd6bda4bd.ac_checklist_items WHERE issue_id = $1 ORDER BY display_order ASC',
        [issueId],
      );
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: ac_checklist_items query failed', { err: (e as Error).message });
    }

    // ---- Activity timeline (comments only at SDK 2026.512.0) ----------------
    // ctx.activity.log is WRITE-only at this SDK version. listComments is the
    // closest read API. State-change + work-product events are not exposed;
    // ROADMAP gap captured in 02-03b-SUMMARY.
    let activity: ActivityEvent[] = [];
    try {
      const comments: IssueComment[] = await ctx.issues.listComments(issueId, companyId);
      activity = comments
        .slice(-ACTIVITY_LIMIT)
        .map((c) => commentToActivity(c))
        .reverse(); // newest first
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: listComments failed', { err: (e as Error).message });
    }

    // ---- Deliverable (most-recent IssueDocumentSummary) ---------------------
    let deliverable: DeliverableSummary = null;
    try {
      const docs = await ctx.issues.documents.list(issueId, companyId);
      const sorted = [...docs].sort((a, b) => docTimestamp(b) - docTimestamp(a));
      const top = sorted[0];
      if (top) {
        deliverable = {
          filename: deliverableFilename(top),
          last_write_at: deliverableTimestamp(top),
        };
      }
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: documents.list failed', { err: (e as Error).message });
    }

    // ---- topicsForIssue (RCB-06 reverse backlink) ---------------------------
    // Best-effort, like the TL;DR path: a repo failure logs a warning and
    // yields []. The Reader load NEVER fails on this — a missing migration
    // 0009 or a transient DB error degrades the reverse-topics list to empty
    // (RCB-07 — pre-0009 issues simply have no topics here).
    let topicsForIssue: ChatTopicByOriginEntry[] = [];
    try {
      topicsForIssue = await listChatTopicsByOriginIssue(
        ctx as unknown as ChatTopicsRepoCtx,
        companyId,
        issueId,
      );
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: listChatTopicsByOriginIssue failed', {
        issueId,
        companyId,
        err: (e as Error).message,
      });
      topicsForIssue = [];
    }

    return {
      tldr,
      refCards,
      ancestry,
      acItems,
      activity,
      deliverable,
      issueBody: issueBodyValue,
      topicsForIssue,
    } satisfies IssueReaderResult;
  });
}

// ---------- helpers --------------------------------------------------------

async function deriveAncestry(
  ctx: IssueReaderCtx,
  issue: Issue,
  companyId: string,
): Promise<Ancestry> {
  const ancestry: Ancestry = { project: null, milestone: null, parent: null };

  // Walk parentId up to MAX_DEPTH; the IMMEDIATE parent is what the breadcrumb
  // shows. We only need the first parent, not the whole chain.
  const parentId = (issue as unknown as { parentId?: string | null }).parentId ?? null;
  if (parentId) {
    try {
      const parent = await ctx.issues.get(parentId, companyId);
      if (parent) {
        const p = parent as unknown as { id: string; key?: string; title: string };
        const parentKey = p.key ?? p.id;
        ancestry.parent = {
          id: p.id,
          title: p.title,
          url: `/issues/${parentKey}`,
        };
      }
    } catch {
      // Parent unreachable — leave null. Walking deeper not useful here.
    }
  }

  // Project resolution (Issue.projectId → ctx.projects.get).
  const projectId = (issue as unknown as { projectId?: string | null }).projectId ?? null;
  if (projectId && ctx.projects) {
    try {
      const project = await ctx.projects.get(projectId, companyId);
      if (project) {
        const p = project as unknown as { id: string; title?: string; name?: string };
        ancestry.project = {
          id: p.id,
          title: p.title ?? p.name ?? projectId,
          url: `/projects/${p.id}`,
        };
      }
    } catch {
      // Project unreachable.
    }
  }

  // Goal resolution (Issue.goalId → ctx.goals.get). We model goals as the
  // "milestone" axis for breadcrumb display — Paperclip doesn't have a separate
  // milestone primitive in the SDK at 2026.512.0.
  const goalId = (issue as unknown as { goalId?: string | null }).goalId ?? null;
  if (goalId && ctx.goals) {
    try {
      const goal = await ctx.goals.get(goalId, companyId);
      if (goal) {
        const g = goal as unknown as { id: string; title?: string };
        ancestry.milestone = {
          id: g.id,
          title: g.title ?? goalId,
          url: `/goals/${g.id}`,
        };
      }
    } catch {
      // Goal unreachable.
    }
  }

  // The depth cap exists so this loop terminates if Paperclip ever ships a
  // parent.parent chain we want to walk for, e.g., a "project root" hop.
  // For 02-03b we only need ONE hop (immediate parent), so MAX_DEPTH is
  // reserved for a future iteration. Reference it to silence unused-const
  // warnings without changing behavior.
  void ANCESTRY_MAX_DEPTH;
  return ancestry;
}

function commentToActivity(c: IssueComment): ActivityEvent {
  const anyC = c as unknown as {
    authorAgentId?: string | null;
    authorUserId?: string | null;
    body?: string | null;
    createdAt?: string;
    created_at?: string;
  };
  const actor = anyC.authorUserId ?? anyC.authorAgentId ?? null;
  const at = anyC.createdAt ?? anyC.created_at ?? new Date(0).toISOString();
  const detail = truncate(anyC.body, COMMENT_DETAIL_MAX);
  return { kind: 'comment', actor, at, detail };
}

function docTimestamp(d: unknown): number {
  const anyD = d as { updatedAt?: string; createdAt?: string; updated_at?: string; created_at?: string };
  const iso = anyD.updatedAt ?? anyD.updated_at ?? anyD.createdAt ?? anyD.created_at ?? null;
  return iso ? new Date(iso).getTime() : 0;
}

function deliverableFilename(d: unknown): string {
  const anyD = d as { title?: string; key?: string; filename?: string };
  return anyD.filename ?? anyD.title ?? anyD.key ?? 'document';
}

function deliverableTimestamp(d: unknown): string | null {
  const anyD = d as { updatedAt?: string; createdAt?: string; updated_at?: string; created_at?: string; last_write_at?: string };
  return anyD.updatedAt ?? anyD.last_write_at ?? anyD.updated_at ?? anyD.createdAt ?? anyD.created_at ?? null;
}
