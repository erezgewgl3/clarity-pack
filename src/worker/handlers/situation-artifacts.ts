// src/worker/handlers/situation-artifacts.ts
//
// Phase 6.1 Plan 02 (ROOM-10) -- situation.artifacts DATA handler.
//
// Returns the per-agent union of recent artifacts for the Situation Room's
// new inline <ArtifactChipRow>. Two halves:
//
//   (a) Deliverables -- per-agent host-API call to
//       ctx.issues.documents.list(sourceIssueId, companyId), filtered to
//       createdAt > now - window. Bounded by N agents per company
//       (typically < 50 on Eric's instance per RESEARCH.md §A1); the
//       per-agent loop is acceptable for v1.0.
//
//   (b) Chat-attachments -- ONE bulk SQL query (PRIM-01 by construction)
//       joining plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
//       to chat_topics for agent attribution. Covers every agent in one
//       round-trip regardless of company size.
//
// Window is 24h-sliding by default, configurable via
// instanceConfigSchema.situationArtifactsWindow (allowed values
// '24h' / '7d' / '30d'; default '24h'). The window string is enum-validated
// at handler entry and coerced to '24h' on unknown input -- T-06.1-10
// mitigation. The raw config string NEVER reaches SQL; we bind a canonical
// Postgres interval literal ('24 hours' / '7 days' / '30 days') from the
// WINDOW_TO_INTERVAL constant table, via $2::interval cast.
//
// CTT-07 invariant BY CONSTRUCTION: this handler reads only -- it never
// mutates host issue state. Test 11 in situation-artifacts.test.mjs pins
// the invariant at runtime; test/ctt07/situation-artifacts-no-issue-update
// .test.mjs pins it at the source level.
//
// Data-handler convention (mirrors chat-attachment-list.ts):
//   - opted-out caller -> RETURN { error: 'OPT_IN_REQUIRED' } (via
//     wrapDataHandler; T-06.1-13)
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//     (never throw -- data handlers carry structured errors;
//     chat-attachment-list.ts:67-69 template)
//   - SDK / repo failure -> graceful per-agent degrade (warn log + empty
//     array for that agent); whole-response degrade only when the bulk
//     union query throws.

import {
  wrapDataHandler,
  type OptInGuardDataCtx,
} from '../opt-in-guard.ts';
import type {
  PluginAgentsClient,
  PluginIssuesClient,
  PluginConfigClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

const DEFAULT_LIST_LIMIT = 5;
const MAX_LIST_LIMIT = 100;

/** D-05: enum of allowed instanceConfigSchema.situationArtifactsWindow
 *  values. Unknown values coerce to the first entry ('24h') -- T-06.1-10. */
const ALLOWED_WINDOWS = ['24h', '7d', '30d'] as const;
type AllowedWindow = (typeof ALLOWED_WINDOWS)[number];

/** Map the enum to the canonical Postgres interval literal we bind via
 *  $2::interval. NEVER pass the raw config string into SQL -- always
 *  use this lookup so a malicious / misconfigured operator can't inject. */
const WINDOW_TO_INTERVAL: Record<AllowedWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export type SituationArtifactsCtx = OptInGuardDataCtx & {
  agents: PluginAgentsClient;
  issues: PluginIssuesClient;
  config?: PluginConfigClient;
  logger?: PluginLogger;
};

/** A single artifact entry. The discriminated-union `kind` lets the UI
 *  render deliverables vs chat-attachments with the same chip primitive. */
type ArtifactEntry = {
  id: string;
  kind: 'deliverable' | 'chat-attachment';
  documentKey: string;
  mimeType: string;
  originalFilename: string;
  byteSize: number;
  createdAt: string;
  topicIssueId?: string;
  sourceIssueId?: string;
};

/** Row shape returned by the bulk chat-attachments union SQL. */
type ChatAttachmentUnionRow = {
  id: string;
  chat_message_id: string;
  topic_issue_id: string;
  document_key: string;
  mime_type: string;
  original_filename: string;
  byte_size: number | string;
  created_at: string;
  agent_id: string;
};

/**
 * Resolve the artifact window from instance config. Coerces to '24h' on:
 *   - missing key
 *   - non-string value
 *   - any string not in ALLOWED_WINDOWS (T-06.1-10)
 *   - ctx.config.get() throwing
 */
async function resolveWindow(
  ctx: SituationArtifactsCtx,
): Promise<AllowedWindow> {
  try {
    const raw = (await ctx.config?.get?.()) as
      | Record<string, unknown>
      | undefined;
    const rawWindow = raw?.situationArtifactsWindow;
    if (
      typeof rawWindow === 'string' &&
      (ALLOWED_WINDOWS as readonly string[]).includes(rawWindow)
    ) {
      return rawWindow as AllowedWindow;
    }
  } catch (e) {
    ctx.logger?.warn?.('situation.artifacts: config.get failed; defaulting to 24h', {
      err: (e as Error).message,
    });
  }
  return '24h';
}

/** Extract a Document's filename for chip display. Mirrors
 *  issue-reader.ts:366-369 (deliverableFilename) so chips and the Reader
 *  share one naming contract. */
function docFilename(d: unknown): string {
  const anyD = d as { title?: string; key?: string; filename?: string };
  return anyD.filename ?? anyD.title ?? anyD.key ?? 'document';
}

/** Extract a Document's ISO timestamp. Mirrors issue-reader.ts:371-374. */
function docTimestamp(d: unknown): string | null {
  const anyD = d as {
    updatedAt?: string;
    createdAt?: string;
    updated_at?: string;
    created_at?: string;
    last_write_at?: string;
  };
  return (
    anyD.updatedAt ??
    anyD.last_write_at ??
    anyD.updated_at ??
    anyD.createdAt ??
    anyD.created_at ??
    null
  );
}

/** Extract a Document's mime type, with safe fallback. */
function docMimeType(d: unknown): string {
  const anyD = d as { mimeType?: string; mime_type?: string };
  return anyD.mimeType ?? anyD.mime_type ?? 'application/octet-stream';
}

/** Extract a Document's byte size, coercing the SDK's varied numeric shapes. */
function docByteSize(d: unknown): number {
  const anyD = d as { byteSize?: number | string; byte_size?: number | string };
  const raw = anyD.byteSize ?? anyD.byte_size ?? 0;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Extract a Document's key (used as the previewer's dispatch key). */
function docKey(d: unknown): string {
  const anyD = d as { key?: string; documentKey?: string; id?: string };
  return anyD.key ?? anyD.documentKey ?? anyD.id ?? '';
}

/** Extract a Document's id (stable React key for chip rendering). */
function docId(d: unknown): string {
  const anyD = d as { id?: string; key?: string };
  return anyD.id ?? anyD.key ?? '';
}

export function registerSituationArtifacts(ctx: SituationArtifactsCtx): void {
  wrapDataHandler(ctx, 'situation.artifacts', async (params) => {
    // ---- Param validation (return, never throw -- data-handler convention)
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };

    const userId =
      typeof params?.userId === 'string' && params.userId
        ? params.userId
        : null;
    // In practice opt-in-guard returns OPT_IN_REQUIRED before we reach
    // this check (extractUserId at opt-in-guard.ts:137-143 short-circuits
    // when userId is null/empty). Kept as defense-in-depth -- the explicit
    // structured error also self-documents the handler contract for any
    // future caller that bypasses the guard.
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };

    // ---- Resolve window + interval literal -----------------------------
    const windowDuration = await resolveWindow(ctx);
    const intervalLiteral = WINDOW_TO_INTERVAL[windowDuration];

    // ---- Enumerate agents ----------------------------------------------
    let agents;
    try {
      agents = await ctx.agents.list({ companyId });
    } catch (e) {
      ctx.logger?.warn?.('situation.artifacts: agents.list failed', {
        companyId,
        err: (e as Error).message,
      });
      // Whole-response graceful degrade -- empty artifacts payload.
      return {
        kind: 'situation-artifacts' as const,
        windowDuration,
        artifacts: {} as Record<string, ArtifactEntry[]>,
      };
    }

    // ---- PRIM-01 bulk query for chat-attachments half ------------------
    // ONE round-trip covers every agent on the grid. The chat_topics JOIN
    // attributes each attachment to its employee_agent_id; we then group
    // client-side. Company-scoped on BOTH halves of the JOIN
    // (T-06.1-09 mitigation -- no cross-company leak possible).
    //
    // Window value is bound via $2::interval -- the raw config string
    // NEVER reaches SQL; WINDOW_TO_INTERVAL is the only path from
    // config to the bind value (T-06.1-10).
    const byAgent = new Map<string, ArtifactEntry[]>();
    try {
      const rows = await ctx.db.query<ChatAttachmentUnionRow>(
        `SELECT
           cma.id, cma.chat_message_id, cma.topic_issue_id,
           cma.document_key, cma.mime_type, cma.original_filename,
           cma.byte_size, cma.created_at,
           ct.employee_agent_id AS agent_id
         FROM plugin_clarity_pack_cdd6bda4bd.chat_message_attachments cma
         JOIN plugin_clarity_pack_cdd6bda4bd.chat_topics ct
           ON ct.issue_id = cma.topic_issue_id
           AND ct.company_id = cma.company_id
         WHERE cma.company_id = $1
           AND cma.created_at > now() - $2::interval
         ORDER BY cma.created_at DESC`,
        [companyId, intervalLiteral],
      );
      for (const r of rows) {
        const agentId = r.agent_id;
        if (!agentId) continue;
        let bucket = byAgent.get(agentId);
        if (!bucket) {
          bucket = [];
          byAgent.set(agentId, bucket);
        }
        bucket.push({
          id: r.id,
          kind: 'chat-attachment',
          documentKey: r.document_key,
          mimeType: r.mime_type,
          originalFilename: r.original_filename,
          byteSize: typeof r.byte_size === 'string' ? Number(r.byte_size) : r.byte_size,
          createdAt: r.created_at,
          topicIssueId: r.topic_issue_id,
        });
      }
    } catch (e) {
      ctx.logger?.warn?.('situation.artifacts: chat-attachments union failed', {
        companyId,
        err: (e as Error).message,
      });
      // Continue with chat half empty -- the deliverables half may still
      // produce a useful payload. UI handles per-agent empty arrays.
    }

    // ---- Deliverables half: per-agent ctx.issues.documents.list -------
    // Bounded by N agents per company (typically < 50 per RESEARCH.md
    // §A1). Each call is wrapped so one agent's documents.list failure
    // does not break the whole response.
    //
    // Window filter is applied client-side via createdAt comparison
    // against the now()-window cutoff. Computed once outside the loop.
    const windowCutoffMs = Date.now() - intervalToMs(windowDuration);

    for (const agent of agents) {
      const anyAgent = agent as unknown as {
        id?: string;
        user_id?: string;
        current_focus_issue_id?: string;
      };
      const agentId = anyAgent.id ?? anyAgent.user_id ?? '';
      if (!agentId) continue;
      const sourceIssueId = anyAgent.current_focus_issue_id ?? '';
      if (!sourceIssueId) continue;

      let docs: unknown[] = [];
      try {
        docs = (await ctx.issues.documents.list(
          sourceIssueId,
          companyId,
        )) as unknown[];
      } catch (e) {
        ctx.logger?.warn?.('situation.artifacts: documents.list failed for agent', {
          agentId,
          sourceIssueId,
          err: (e as Error).message,
        });
        continue;
      }

      let bucket = byAgent.get(agentId);
      if (!bucket) {
        bucket = [];
        byAgent.set(agentId, bucket);
      }
      for (const d of docs) {
        const ts = docTimestamp(d);
        if (!ts) continue;
        const tsMs = new Date(ts).getTime();
        if (!Number.isFinite(tsMs) || tsMs < windowCutoffMs) continue;
        bucket.push({
          id: docId(d) || `deliverable-${sourceIssueId}-${docKey(d)}`,
          kind: 'deliverable',
          documentKey: docKey(d),
          mimeType: docMimeType(d),
          originalFilename: docFilename(d),
          byteSize: docByteSize(d),
          createdAt: ts,
          sourceIssueId,
        });
      }
    }

    // ---- Merge: sort each agent's array DESC by createdAt + clamp at 100
    const artifacts: Record<string, ArtifactEntry[]> = {};
    for (const [agentId, entries] of byAgent.entries()) {
      const sorted = entries
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      const clamped = sorted.length > MAX_LIST_LIMIT
        ? sorted.slice(0, MAX_LIST_LIMIT)
        : sorted;
      // Skip agents with zero artifacts after the window filter so the UI
      // can rely on "key present in artifacts => non-empty array" semantics.
      if (clamped.length === 0) continue;
      artifacts[agentId] = clamped;
    }

    // Default limit hint (DEFAULT_LIST_LIMIT) is the UI's "+N more"
    // chip-row affordance threshold; the worker returns up to
    // MAX_LIST_LIMIT entries per agent so the UI can mount a per-agent
    // drawer without an extra round-trip. The constants are exported via
    // module-level references so the test suite + future readers can pin
    // both ceilings in one place.
    void DEFAULT_LIST_LIMIT;

    return {
      kind: 'situation-artifacts' as const,
      windowDuration,
      artifacts,
    };
  });
}

/** Convert an allowed window enum to its millisecond span -- used for the
 *  client-side createdAt filter on the deliverables half (the bulk SQL
 *  half is filtered server-side via the $2::interval bind). */
function intervalToMs(w: AllowedWindow): number {
  switch (w) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}
