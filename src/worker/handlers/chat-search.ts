// src/worker/handlers/chat-search.ts
//
// Plan 04-04 Task B — CHAT-08 — the chat.search data handler.
//
// chat.search ILIKE-matches a free-text term over the canonical comment table
// public.issue_comments (a coreReadTable — SELECT is allowed via ctx.db.query)
// JOINed THROUGH the plugin-namespace chat_topics table. The JOIN does two
// jobs:
//   - T-04-17: only comments on chat-topic issues are reachable — a comment on
//     a non-chat issue is structurally excluded from the result set.
//   - T-04-14: the JOIN predicate t.company_id = $1 company-scopes the search;
//     companyId is the host-resolved value, never a blindly-trusted free param.
//
// Security domain (T-04-13): the user term is a $N bound parameter (no string
// concatenation into SQL — the SQL is a module constant). It is ALSO passed
// through escapeLike(), which backslash-escapes %, _ and \ so a user-supplied
// % or _ matches LITERALLY rather than acting as an ILIKE wildcard.
//
// Wrapped via opt-in-guard's wrapDataHandler — RETURNS structured errors.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginLogger } from '@paperclipai/plugin-sdk';
import type { ChatTopicsRepoCtx } from '../db/chat-topics-repo.ts';

export type ChatSearchCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    logger?: PluginLogger;
  };

/**
 * Escape the three ILIKE meta-characters — backslash, percent, underscore —
 * so a user-supplied term matches them literally. Backslash MUST be escaped
 * first (it is the escape character itself). The result is then wrapped in
 * `%...%` by the caller; those outer percents are the only real wildcards.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Static module-constant SQL — mirrors the T-03-10 invariant (no dynamic SQL
// assembly). The user term reaches the DB only as the $2 bound parameter.
const SEARCH_SQL = `SELECT c.id, c.issue_id, c.body, c.created_at
   FROM public.issue_comments c
   JOIN plugin_clarity_pack_cdd6bda4bd.chat_topics t
     ON t.issue_id = c.issue_id AND t.company_id = $1
   WHERE c.body ILIKE $2
   ORDER BY c.created_at DESC
   LIMIT 50`;

type SearchRow = {
  id: string;
  issue_id: string;
  body: string;
  created_at: string;
};

export function registerChatSearch(ctx: ChatSearchCtx): void {
  wrapDataHandler(ctx, 'chat.search', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const term =
      typeof params?.term === 'string' && params.term ? params.term : null;

    if (!companyId) {
      return { error: 'COMPANY_ID_REQUIRED' };
    }
    if (!userId) {
      return { error: 'USER_ID_REQUIRED' };
    }
    if (!term) {
      return { error: 'TERM_REQUIRED' };
    }

    let rows: SearchRow[];
    try {
      rows = await ctx.db.query<SearchRow>(SEARCH_SQL, [
        companyId,
        `%${escapeLike(term)}%`,
      ]);
    } catch (e) {
      ctx.logger?.warn?.('chat.search: query failed', {
        companyId,
        err: (e as Error).message,
      });
      return { error: 'SEARCH_FAILED' };
    }

    return {
      kind: 'search-results' as const,
      term,
      results: (rows ?? []).map((r) => ({
        commentId: r.id,
        issueId: r.issue_id,
        body: r.body,
        createdAt: r.created_at,
      })),
    };
  });
}
