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
  PluginAgentsClient,
  Issue,
  IssueComment,
} from '@paperclipai/plugin-sdk';

import type { RefCardData, TLDR } from '../../shared/types.ts';
// Plan 18 (LEG-02 gap) — the SINGLE LEG-02 vocabulary. The Reader activity
// timeline's comment-author actor must never leak a raw UUID / `agent#<hex>`
// partial-hash into human-facing text (a non-builder reads it). We REUSE these
// constants + the read-time rescrub here — NO parallel scrubber.
import { AGENT_FALLBACK, UUID_RE, PARTIAL_HEX_RE, rescrubPersisted } from '../../shared/scrub-human-action.ts';
import { resolveRefs } from '../../shared/reference-resolver.ts';
import { resolveRefsViaSdk } from './sdk-ref-fetch.ts';
// The Editor-Agent's TL;DR delivery document key — filtered out of the Reader's
// deliverable selection so a (mis)routed compile-result never masquerades as the
// user's deliverable (live BEAAA-4882, 2026-06-15).
import { RESULT_DOCUMENT_KEY } from '../agents/agent-task-delivery.ts';
// 07-04 (D-I31-04) — the worker-side TL;DR refs-to-title rewrite module is
// REMOVED. Client-side titled chips (the ref-aware SafeMarkdown + RefChip,
// 07-04 D-I31-01..03) supply the title, so the worker rewrite was redundant and
// double-rendered ("ID — title" chip + a trailing " — title" text). The TL;DR
// body now reaches the result RAW; the chip is the sole title source.
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

// 17-04 (D-11/D-12) — each segment now declares whether it is safe to LINK.
//   - `url` is a prefix-LESS canonical (the issue IDENTIFIER for the parent);
//     the worker stays INSTANCE-AGNOSTIC and breadcrumb.tsx prepends
//     /<companyPrefix>/issues/ (17-RESEARCH Area 7, Option (b)). `url` may be
//     null for segments with no confirmed host route.
//   - `routable: true` ONLY for the issue/parent segment (the sole confirmed
//     host route). project/goal segments are `routable: false` → the UI renders
//     them as plain, non-clickable text (zero 404, zero dead links).
export type AncestryNode = { id: string; title: string; url: string | null; routable: boolean } | null;
export type Ancestry = { project: AncestryNode; milestone: AncestryNode; parent: AncestryNode };

// 17-04 (D-11) — a goal/project/parent breadcrumb LABEL must be a short nav
// hint, never a paragraph. The root company-mission goal's title IS the whole
// 1k+ char mission (BEAAA-828 pathology); a title past this bound is treated as
// the mission dump and dropped (goal) or truncated (project/parent).
const ANCESTRY_LABEL_MAX = 80;

// A goal whose title runs past the label bound is the company-mission root
// (its `goal.title` is the entire mission paragraph) — never a useful nav
// target. Detected by length only, so it stays instance-agnostic (no company
// name/prefix literal, no goal-kind field which the SDK does not expose).
function isMissionDumpTitle(title: string): boolean {
  return title.trim().length > ANCESTRY_LABEL_MAX;
}

// Truncate any other long label (project/parent) to a short breadcrumb hint.
function shortLabel(title: string): string {
  const t = title.trim();
  return t.length > ANCESTRY_LABEL_MAX ? `${t.slice(0, ANCESTRY_LABEL_MAX - 1)}…` : t;
}

export type ActivityEvent = {
  kind: 'comment';
  actor: string | null;
  at: string;
  detail: string;
};

// `documentKey` is the REAL host document key (e.g. "gap-closure-plan"), carried
// separately from `filename` (the human title, e.g. "Gap-Closure Plan"). The
// deliverable previewer must dispatch documents.get on the KEY — sending the
// title 404s the host → READ_FAILED (the live BEAAA-4882 "Couldn't load this
// deliverable" bug). Optional so older cached rows / callers that omit it fall
// back to filename (deliverable-preview.tsx: `documentKey ?? filename`).
export type DeliverableSummary = {
  filename: string;
  last_write_at: string | null;
  documentKey?: string;
} | null;

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
  // Plan 18 (LEG-02 gap) — `agents` resolves a comment-author UUID to a real
  // name/role for the activity timeline. Optional so existing test fixtures
  // type-check; the handler narrows via `typeof ctx.agents?.get === 'function'`
  // and degrades to AGENT_FALLBACK when absent.
  agents?: Pick<PluginAgentsClient, 'get'>;
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

    // ---- 07-04 (D-I31-04): the worker TL;DR refs→title rewrite is REMOVED ----
    // The client-side ref-aware SafeMarkdown + RefChip now render each in-prose
    // `<PREFIX>-NNN` token as a clickable titled chip (`ID — title`). Keeping the
    // old worker text-rewrite would DOUBLE-RENDER ("ID — title" chip + a trailing
    // " — title" text). The TL;DR body reaches the result RAW; the chip is the
    // sole title source.

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
    //
    // Plan 18 (LEG-02 gap) — the comment author is the raw camelCase
    // authorUserId/authorAgentId, which on BEAAA is frequently a raw agent/user
    // UUID the host does NOT pre-resolve (confirmed live). Rendering it verbatim
    // leaks a machine token into human-facing text (LEG-02 violation). Resolve
    // every UUID author to a real name via ctx.agents.get — batched/deduped over
    // the UNIQUE author ids visible in this window (O(unique authors), no N+1) —
    // and pass the final string through a read-time floor (rescrubPersisted) so
    // even an unresolved author can never reach the UI as a UUID/partial-hash.
    const windowComments = commentsRaw.slice(-ACTIVITY_LIMIT);
    const authorNameByUuid = await resolveActivityAuthorNames(ctx, windowComments, companyId);
    const activity: ActivityEvent[] = windowComments
      .map((c) => commentToActivity(c, authorNameByUuid))
      .reverse(); // newest first

    // ---- Deliverable (most-recent IssueDocumentSummary) ---------------------
    let deliverable: DeliverableSummary = null;
    try {
      const docs = await ctx.issues.documents.list(issueId, companyId);
      // Skip clarity-pack INTERNAL documents. The Editor-Agent files its TL;DR
      // delivery as a document keyed `compile-result` (RESULT_DOCUMENT_KEY) — a
      // bookkeeping artifact, NOT the user's deliverable. When one lands on a task
      // (incl. a misrouted compile-result, as seen live on BEAAA-4882) the newest-
      // doc heuristic below would otherwise surface it as "The deliverable" over
      // the real one. Filter it out so the genuine deliverable wins (or the honest
      // empty-state shows).
      const userDocs = docs.filter((d) => !isInternalClarityDocument(d));
      const sorted = [...userDocs].sort((a, b) => docTimestamp(b) - docTimestamp(a));
      const top = sorted[0];
      if (top) {
        deliverable = {
          filename: deliverableFilename(top),
          last_write_at: deliverableTimestamp(top),
          // The REAL host key (not the display title) — the previewer dispatches
          // documents.get on this; sending the title 404s → READ_FAILED.
          documentKey: deliverableDocumentKey(top),
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
          title: shortLabel(p.title),
          // 17-04 (D-12) — prefix-LESS canonical: the issue IDENTIFIER only.
          // breadcrumb.tsx prepends /<companyPrefix>/issues/ at render time so
          // the worker stays instance-agnostic. This is the ONLY routable
          // segment (confirmed host route /<companyPrefix>/issues/<identifier>).
          url: parentKey,
          routable: true,
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
          title: shortLabel(p.title ?? p.name ?? projectId),
          // 17-04 (D-12) — no confirmed /projects/<id> host route → not
          // routable. The UI renders this as plain non-clickable text (no 404).
          url: null,
          routable: false,
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
        const goalTitle = g.title ?? goalId;
        // 17-04 (D-11) — DROP the root company-mission goal entirely: its title
        // is the whole 1k+ char mission paragraph (BEAAA-828 pathology), never
        // a useful nav target ("I know what the company does"). Leave
        // ancestry.milestone null so it never reaches the breadcrumb. Any OTHER
        // (non-root) goal renders as a short, plain-text (non-routable) label —
        // there is no confirmed /goals/<id> host route.
        if (!isMissionDumpTitle(goalTitle)) {
          ancestry.milestone = {
            id: g.id,
            title: shortLabel(goalTitle),
            url: null,
            routable: false,
          };
        }
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

// Plan 18 (LEG-02 gap) — the comment-author shape. We read a possible
// pre-resolved display name FIRST (the cheapest correct path: if the host
// already carries a readable name on the comment, no ctx.agents.get is needed),
// then fall back to the raw author id. Field names are duck-typed because the
// SDK IssueComment type does not expose these at 2026.512.0.
type CommentAuthorFields = {
  authorAgentId?: string | null;
  authorUserId?: string | null;
  authorName?: string | null;
  authorDisplayName?: string | null;
  body?: string | null;
  createdAt?: string;
  created_at?: string;
};

// A bare author id is "UUID-shaped" (or a legacy `agent#<hex>` partial-hash)
// when it would leak a machine token into prose. A readable label like
// "local-board" or "carrier-ops" matches neither and is preserved verbatim.
function isLeakyAuthorId(actor: string): boolean {
  return UUID_RE.test(actor) || PARTIAL_HEX_RE.test(actor);
}

// Read the raw author id off a comment (user id preferred over agent id, to
// match the prior precedence). Null when neither is present.
function rawCommentAuthorId(c: IssueComment): string | null {
  const anyC = c as unknown as CommentAuthorFields;
  return anyC.authorUserId ?? anyC.authorAgentId ?? null;
}

// A pre-resolved readable name carried directly on the comment, if any. This is
// the cheapest correct path — when present we never spend a ctx.agents.get.
function commentCarriedName(c: IssueComment): string | null {
  const anyC = c as unknown as CommentAuthorFields;
  const name = anyC.authorName ?? anyC.authorDisplayName ?? null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * Plan 18 (LEG-02 gap) — resolve the UNIQUE UUID-shaped comment authors in this
 * window to real names via ctx.agents.get, batched + deduped (O(unique authors),
 * never N+1 per comment). Degrade-safe: a missing ctx.agents client OR any throw
 * yields an empty/partial map (the caller then applies AGENT_FALLBACK). NEVER
 * throws — the activity timeline is non-essential and must not blank the Reader.
 */
async function resolveActivityAuthorNames(
  ctx: IssueReaderCtx,
  comments: IssueComment[],
  companyId: string,
): Promise<Map<string, string | null>> {
  const nameByUuid = new Map<string, string | null>();
  if (typeof ctx.agents?.get !== 'function') return nameByUuid;

  // Only resolve authors that (a) are not already carried as a readable name on
  // the comment, and (b) are UUID/partial-hash-shaped (a plain readable id like
  // "local-board" needs no lookup and is preserved as-is downstream).
  const distinctLeakyIds = Array.from(
    new Set(
      comments
        .filter((c) => commentCarriedName(c) === null)
        .map((c) => rawCommentAuthorId(c))
        .filter((a): a is string => a !== null && isLeakyAuthorId(a)),
    ),
  );

  for (const uuid of distinctLeakyIds) {
    try {
      const agent = await ctx.agents.get(uuid, companyId);
      const name =
        agent && typeof (agent as { name?: unknown }).name === 'string'
          ? (agent as { name: string }).name.trim()
          : '';
      nameByUuid.set(uuid, name || null);
    } catch (e) {
      // Degrade silently to null — NEVER fall back to the UUID. The caller's
      // AGENT_FALLBACK floor takes over. (Mirrors the resolve-refs D-09 pattern.)
      ctx.logger?.warn?.('issue.reader: activity author agents.get failed', {
        companyId,
        uuid,
        err: (e as Error).message,
      });
      nameByUuid.set(uuid, null);
    }
  }
  return nameByUuid;
}

function commentToActivity(
  c: IssueComment,
  authorNameByUuid: Map<string, string | null>,
): ActivityEvent {
  const anyC = c as unknown as CommentAuthorFields;
  const at = anyC.createdAt ?? anyC.created_at ?? new Date(0).toISOString();
  const detail = truncate(anyC.body, COMMENT_DETAIL_MAX);

  // Plan 18 (LEG-02 gap) — actor resolution, cheapest-correct-first:
  //   1. a readable name carried on the comment → use it (no lookup spent).
  //   2. a UUID/partial-hash-shaped id → its resolved name, else AGENT_FALLBACK.
  //   3. a plain readable id (e.g. "local-board") → preserved verbatim.
  //   4. no author at all → null (the UI renders nothing).
  let actor: string | null;
  const carried = commentCarriedName(c);
  const rawId = rawCommentAuthorId(c);
  if (carried !== null) {
    actor = carried;
  } else if (rawId === null) {
    actor = null;
  } else if (isLeakyAuthorId(rawId)) {
    actor = authorNameByUuid.get(rawId) ?? AGENT_FALLBACK;
  } else {
    actor = rawId; // already readable — preserve as-is.
  }

  // Read-time floor (the LEG-02 NO_UUID_LEAK guarantee): even if resolution
  // missed or a name itself embeds an id, no raw UUID / `agent#<hex>` can reach
  // the UI — rescrubPersisted rewrites any residual to AGENT_FALLBACK. Idempotent
  // over already-clean strings (a no-op for "local-board" / a resolved name).
  if (actor !== null) actor = rescrubPersisted(actor);

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

/** The REAL host document key (what documents.get needs), distinct from the
 *  display title. Falls back to the title only if no key is present. */
function deliverableDocumentKey(d: unknown): string | undefined {
  const key = (d as { key?: unknown }).key;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/** True for clarity-pack INTERNAL documents that must never surface as a user
 *  deliverable. Today that is the Editor-Agent's TL;DR delivery channel (the
 *  `compile-result` document, RESULT_DOCUMENT_KEY) and any suffixed variant. */
function isInternalClarityDocument(d: unknown): boolean {
  const key = (d as { key?: unknown }).key;
  if (typeof key !== 'string') return false;
  return key === RESULT_DOCUMENT_KEY || key.startsWith(`${RESULT_DOCUMENT_KEY}-`);
}

function deliverableTimestamp(d: unknown): string | null {
  const anyD = d as { updatedAt?: string; createdAt?: string; updated_at?: string; created_at?: string; last_write_at?: string };
  return anyD.updatedAt ?? anyD.last_write_at ?? anyD.updated_at ?? anyD.createdAt ?? anyD.created_at ?? null;
}
