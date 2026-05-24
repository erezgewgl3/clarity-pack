// src/worker/handlers/reader-ac-autostatus.ts
//
// Plan 05-03 (DIST-03) — reader.ac.autostatus DATA handler.
//
// Phase 2 shipped a MANUAL acceptance-criteria checklist (ac-checklist.tsx +
// ac-checklist.ts handler). DIST-03 PROMOTES this to event-derived auto-status
// while preserving the Phase 2 manual UX untouched. Operators (or agents) who
// type a comment-marker on an issue get a small "auto: ✓ via @<agent> · <ago>"
// indicator next to the matching AC row.
//
// Locked design (05-03-PLAN <design_answers_locked>):
//
// A1 — EVENT SOURCE: COMMENT-MARKER. Two regex grammars (multiline, case-
//      insensitive on state):
//        ^ AC: <id>: <state> $        (canonical)
//        ^ AC[<id>]: <state> $        (bracket alternate; survives Markdown
//                                      auto-formatting of `AC:foo:`)
//      <state> ∈ {✓, done, complete, x}. <id> matches the AC item's persisted
//      id field as a string ([A-Za-z0-9_-]+). Single-issue scope — we scan
//      ONLY the comments on the issue passed in, never related issues.
//
// A2 — UI SURFACE: SIDE-BY-SIDE. The UI renders the existing manual checkbox
//      unchanged; this handler's output drives the small auto-status caption
//      next to it. NO_UUID_LEAK: response carries `sourceAuthorName: string |
//      null` resolved via ctx.agents.get — the UI must NEVER fall back to
//      `sourceAuthorAgentId` for visible text. Per-distinct-author resolution
//      is cached across the comment scan (typical N=1..3 distinct authors).
//
// A3 — NO CONFLICT. Auto-status is render-time only; never persisted. The
//      manual checkbox remains source of truth. The two states can disagree
//      without resolution. This handler is READ-ONLY: zero ctx.issues.update,
//      zero ctx.db.execute. SELECT-only via ctx.issues.listComments +
//      ctx.agents.get + the opt-in-guard's prefs probe.
//
// Earliest-comment-wins per ac-id: comments are sorted createdAt ASC before
// the scan; the FIRST match for a given id is kept; later matches for the
// same id are ignored. Indicator timestamp reflects "when the agent first
// claimed it", not "the most recent claim".
//
// Wrapped via wrapDataHandler — opted-out caller -> { error: 'OPT_IN_REQUIRED' }
// BEFORE any host read. Data-handler convention (mirrors chat-open-for-issue.ts):
// missing required params return structured errors; never throw.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type {
  PluginAgentsClient,
  PluginIssuesClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type ReaderAcAutostatusCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
  // Plan 05-03 — resolves comment.authorAgentId UUIDs to human-friendly
  // display names. Degrade-to-null on lookup failure; UI falls back to a
  // friendly generic label ("agent"), NEVER to the UUID (NO_UUID_LEAK,
  // mirrors Plan 04.2-06 D9).
  agents: PluginAgentsClient;
  logger?: PluginLogger;
};

/** Per-AC-item auto-status detection record. */
export type AcAutoStatusEntry = {
  detected: true;
  /** The host comment id whose body matched first (earliest by createdAt). */
  sourceCommentId: string;
  /** The host's authorAgentId on that comment (or null for operator-typed). */
  sourceAuthorAgentId: string | null;
  /** Resolved display name via ctx.agents.get, or null on degrade. NEVER the UUID. */
  sourceAuthorName: string | null;
  /** ISO timestamp of the matching comment. */
  sourceCreatedAt: string;
};

/** Map keyed by the AC item's id (string-form). Absent key -> no detection. */
export type AcAutoStatusMap = Record<string, AcAutoStatusEntry>;

export type AcAutoStatusResult = {
  kind: 'acAutoStatus';
  detections: AcAutoStatusMap;
};

// Canonical form: "AC: <id>: <state>"
// `m` for multiline ^/$; `i` for case-insensitive state ("DONE" / "Done" / etc).
// `g` so a single comment body may match multiple AC rows.
const AC_MARKER_CANONICAL =
  /^\s*AC\s*[:\-]\s*([A-Za-z0-9_\-]+)\s*[:\-]\s*(✓|done|complete|x)\s*$/gim;

// Bracket alternate: "AC[<id>]: <state>" — survives Markdown that auto-renders
// `AC: foo:` as a definition list or strips the leading colon.
const AC_MARKER_BRACKET =
  /^\s*AC\[([A-Za-z0-9_\-]+)\]\s*[:\-]\s*(✓|done|complete|x)\s*$/gim;

/** The subset of IssueComment this handler reads. */
type CommentLike = {
  id?: string;
  body?: string;
  createdAt?: Date | string;
  authorAgentId?: string | null;
};

/** Coerce a Date | ISO | undefined to epoch ms (NaN-guarded). */
function createdAtMs(raw: Date | string | undefined): number {
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function createdAtIso(raw: Date | string | undefined): string {
  if (!raw) return new Date(0).toISOString();
  if (raw instanceof Date) return raw.toISOString();
  // raw is a string — return as-is (host already serialised it).
  return String(raw);
}

/**
 * Scan one comment body against BOTH regex grammars. Returns the set of AC ids
 * matched (string-form), preserving the first-occurrence order within the body.
 * Each regex is reset (`lastIndex = 0`) at start so a previous handler call
 * does not leak state across invocations (regex `g` flag stickiness).
 */
function extractAcIdsFromBody(body: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const re of [AC_MARKER_CANONICAL, AC_MARKER_BRACKET]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const id = m[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

export function registerReaderAcAutostatus(ctx: ReaderAcAutostatusCtx): void {
  wrapDataHandler(ctx, 'reader.ac.autostatus', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const issueId =
      typeof params?.issueId === 'string' && params.issueId
        ? params.issueId
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!issueId) return { error: 'ISSUE_ID_REQUIRED' as const };

    let comments: CommentLike[];
    try {
      comments = (await ctx.issues.listComments(
        issueId,
        companyId,
      )) as unknown as CommentLike[];
    } catch (e) {
      ctx.logger?.warn?.('reader.ac.autostatus: listComments failed', {
        issueId,
        companyId,
        err: (e as Error).message,
      });
      return { error: 'LIST_COMMENTS_FAILED' as const };
    }

    // Sort comments ASCENDING by createdAt — earliest first — so the first
    // match for a given AC id wins (A1: "when the agent first claimed it").
    const sorted = (comments ?? [])
      .filter((c) => typeof c?.id === 'string' && c.id && typeof c.body === 'string')
      .slice()
      .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt));

    // First-pass: collect detections without agent-name resolution. Earliest
    // -wins is enforced via the `if (!detections[id])` guard.
    type RawDetection = {
      acId: string;
      commentId: string;
      authorAgentId: string | null;
      createdAt: string;
    };
    const raws: RawDetection[] = [];
    const claimedIds = new Set<string>();
    for (const c of sorted) {
      const body = c.body ?? '';
      if (body.length === 0) continue;
      const ids = extractAcIdsFromBody(body);
      for (const id of ids) {
        if (claimedIds.has(id)) continue;
        claimedIds.add(id);
        raws.push({
          acId: id,
          commentId: c.id as string,
          authorAgentId: typeof c.authorAgentId === 'string' && c.authorAgentId ? c.authorAgentId : null,
          createdAt: createdAtIso(c.createdAt),
        });
      }
    }

    // Second pass: resolve agent display names. Cache per distinct
    // authorAgentId — typical N=1..3 distinct authors per scan; we do not want
    // a quadratic ctx.agents.get storm.
    const nameByAgentId = new Map<string, string | null>();
    for (const raw of raws) {
      if (!raw.authorAgentId) continue;
      if (nameByAgentId.has(raw.authorAgentId)) continue;
      try {
        const agent = await ctx.agents.get(raw.authorAgentId, companyId);
        if (agent && typeof (agent as { name?: unknown }).name === 'string') {
          const candidate = (agent as { name: string }).name.trim();
          nameByAgentId.set(raw.authorAgentId, candidate || null);
        } else {
          nameByAgentId.set(raw.authorAgentId, null);
        }
      } catch (e) {
        // Degrade silently to null — NEVER fall back to the UUID. The UI's
        // NO_UUID_LEAK rule depends on this.
        ctx.logger?.warn?.('reader.ac.autostatus: agents.get failed', {
          issueId,
          companyId,
          authorAgentId: raw.authorAgentId,
          err: (e as Error).message,
        });
        nameByAgentId.set(raw.authorAgentId, null);
      }
    }

    const detections: AcAutoStatusMap = {};
    for (const raw of raws) {
      const sourceAuthorName = raw.authorAgentId
        ? nameByAgentId.get(raw.authorAgentId) ?? null
        : null;
      detections[raw.acId] = {
        detected: true,
        sourceCommentId: raw.commentId,
        sourceAuthorAgentId: raw.authorAgentId,
        sourceAuthorName,
        sourceCreatedAt: raw.createdAt,
      };
    }

    return { kind: 'acAutoStatus' as const, detections };
  });
}
