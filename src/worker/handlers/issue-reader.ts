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
import { resolveRefsViaSdk } from './sdk-ref-fetch.ts';
import { getTldrByScope, type TldrCacheCtx } from '../db/tldr-cache.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
// View-driven rework (2026-05-28) — the Reader DRIVES the TL;DR compile in its
// valid request scope (the scheduled-job/heartbeat scope is dead on
// paperclipai@2026.525.0 — PR #6547). Opening a task's Reader is the compile
// trigger; cache hits return instantly (no recompile).
import {
  driveTldrCompileStep,
  extractRefsFromBody,
  type TldrViewDriverCtx,
} from '../agents/editor.ts';
// Plan 04.2-01 (RCB-06) — the reverse backlink: chat topics started FROM this
// issue. listChatTopicsByOriginIssue reads the migration-0009 origin_issue_id
// column; ChatTopicByOriginEntry is the camelCase row the Reader consumes.
import {
  listChatTopicsByOriginIssue,
  type ChatTopicsRepoCtx,
  type ChatTopicByOriginEntry,
} from '../db/chat-topics-repo.ts';

// 07-01 — the module-level BEAAA-only REF_PATTERN is GONE. Both extraction
// sites below derive the EXACT prefix from `issue.identifier` via the shared
// editor.ts `prefixFromIdentifier` (broad fallback when null), so refs resolve
// on ANY instance (COU/ACME/BEAAA), not just BEAAA.
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
  /**
   * View-driven rework — tells the Reader UI whether to show the TL;DR, a
   * "Compiling…" + poll state, or the honest "No TL;DR yet" empty state.
   *   - `cached`      — `tldr` is present + fresh.
   *   - `compiling`   — the Editor-Agent is working; the UI should poll.
   *   - `paused`      — the Editor-Agent is paused; resume it (Agents panel) to compile.
   *   - `unavailable` — no Editor-Agent could be resolved (no compile started).
   */
  tldrStatus: 'cached' | 'compiling' | 'paused' | 'unavailable';
  /** True when the TL;DR summarized a TRUNCATED (very long) task — the UI notes it. */
  tldrTruncated: boolean;
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
  // 07-01 — `http` is no longer used by the ref resolver (the SSRF-blocked
  // batch fetch path was removed). Kept optional for back-compat with callers
  // that still spread the full PluginContext.
  http?: PluginHttpClient;
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
    tldrStatus: 'unavailable',
    tldrTruncated: false,
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

    // Fetch comments ONCE — reused by the TL;DR inputs AND the activity timeline.
    let commentsRaw: IssueComment[] = [];
    try {
      commentsRaw = await ctx.issues.listComments(issueId, companyId);
    } catch (e) {
      ctx.logger?.warn?.('issue.reader: listComments failed', { err: (e as Error).message });
    }

    // ---- TL;DR (VIEW-DRIVEN compile) ----------------------------------------
    // Opening this Reader IS the compile trigger (the scheduled-job/heartbeat
    // scope is dead — PR #6547). Cache hit → instant, no recompile. Cache miss →
    // start the agent compile + consume a ready result, all in this request's
    // valid scope.
    // 07-01 — derive THIS issue's reference prefix once (de-BEAAA'd). Both the
    // TL;DR-input extraction (here) and the refCards extraction (below) narrow
    // to it; broad fallback when issue.identifier is null.
    const issueIdentifier = (issue as unknown as { identifier?: string | null }).identifier ?? null;

    let tldr: TLDR | null = null;
    let tldrStatus: IssueReaderResult['tldrStatus'] = 'unavailable';
    let tldrTruncated = false;
    try {
      const step = await driveTldrCompileStep(ctx as unknown as TldrViewDriverCtx, {
        issueId,
        companyId,
        inputs: {
          body: issueBodyValue ?? '',
          comments: commentsRaw.map((c) => (c as unknown as { body?: string }).body ?? ''),
          // 07-01 — pass the derived identifier so TL;DR inputs extract refs on
          // a non-BEAAA instance too (was a single-arg BEAAA-hardcoded call).
          refs: extractRefsFromBody(issueBodyValue ?? undefined, issueIdentifier),
        },
      });
      tldr = step.tldr as unknown as TLDR | null;
      tldrStatus = step.status;
      tldrTruncated = step.truncated;
    } catch (e) {
      // Degrade to a plain cache read — never fail the whole Reader on the drive.
      ctx.logger?.warn?.('issue.reader: TL;DR drive failed; falling back to cache read', {
        err: (e as Error).message,
      });
      try {
        const tldrRow = await getTldrByScope(ctx as unknown as TldrCacheCtx, 'issue', issueId);
        tldr = tldrRow as unknown as TLDR | null;
        tldrStatus = tldr ? 'cached' : 'unavailable';
      } catch {
        /* leave null/unavailable */
      }
    }

    // ---- refCards (PRIM-01: one fetcher invocation) -------------------------
    // 07-01 — resolution rewritten to the SDK (see sdk-ref-fetch.ts). The old
    // SSRF-blocked HTTP batch path is GONE: Paperclip 2026.525.0 blocks
    // private-IP fetches, ignored the legacy batch filter, and the stale
    // snake_case field mapping read a null host key so the resolver byId map
    // never matched → chips rendered "BEAAA-NNN · unknown". Now: resolve each
    // unique ref via per-ref `ctx.issues.get(identifier, companyId)` in parallel;
    // on any null, fall back to ONE cached `ctx.issues.list({companyId})` matched
    // on `.identifier` (the SDK `get` may only accept a UUID — the live drill is
    // the runtime probe; the list-match is the de-risk). The fetcher echoes
    // `id = the requested identifier` so reference-resolver's byId.get(ref) hits.
    let refCards: RefCardData[] = [];
    try {
      // 07-01 — prefix-narrowed extraction (de-BEAAA'd) from issue.identifier;
      // broad fallback when null. Uses the SAME shared editor.ts helper as the
      // TL;DR-inputs call above so no extraction site keeps BEAAA-hardcoded.
      const refs = extractRefsFromBody(issueBodyValue ?? undefined, issueIdentifier);
      if (refs.length > 0) {
        refCards = await resolveRefs(refs, async (uniqueIds) => {
          const resolved = await resolveRefsViaSdk(ctx.issues, uniqueIds, companyId);
          return resolved.map(({ requestedId, issue: i }) => ({
            // Echo the REQUESTED identifier so reference-resolver's byId.get(ref)
            // hits (NOT the host-returned identifier, NOT the null host key).
            id: requestedId,
            title: i.title,
            status: i.status as RefCardData['status'],
            ownerUserId: i.assigneeUserId ?? null,
            // The SDK Issue has no viewer-readable flag. A non-null
            // `ctx.issues.get` result is treated as readable-by-caller (the SDK
            // proxies the caller's auth context). The live drill confirms whether
            // `get` enforces viewer perms server-side (07-CONTEXT open item); if
            // it does NOT, a follow-up gates excerpts.
            bodyExcerptForViewer: truncate(i.description, EXCERPT_MAX) || null,
            url: `/issues/${requestedId}`,
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
    // Reuse the comments fetched above for the TL;DR inputs (no second round-trip).
    const activity: ActivityEvent[] = commentsRaw
      .slice(-ACTIVITY_LIMIT)
      .map((c) => commentToActivity(c))
      .reverse(); // newest first

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
      tldrStatus,
      tldrTruncated,
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
