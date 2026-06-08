// src/worker/handlers/set-opt-in.ts
//
// Plan 02-04 Task 1 — write ONLY the caller's clarity_user_prefs row.
//
// SECURITY (OPTIN-03 attack model): the row's user_id is derived from
// params.userId — which the UI populates from useHostContext().userId. The
// handler accepts NO other userId-like field (targetUserId / forUser /
// user_id / etc. are silently ignored). Pleading `useHostContext().userId`
// over `ctx.host.currentUserId` is structural: SDK 2026.512.0 has no
// `host` field on PluginContext (see 02-03b-API-SHAPES.md §5).
//
// The trust boundary that prevents user-A spoofing user-B is the host's
// bridge: useHostContext() returns the *host's* authenticated user, not a
// value the plugin's UI code can fake without same-origin attacker access
// — and even with same-origin access, the worker only ever reads from a
// single param field whose semantics are pinned by this file. Future PRs
// MUST NOT add a "as user" parameter.
//
// EXEMPT from opt-in-guard (users must be able to toggle ON when currently
// opted-out — the whole point of opt-in).

import type {
  PluginActionsClient,
  PluginDatabaseClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';
// Phase 16.1 Plan 16.1-03 (D-12): an opt-in toggle changes who is opted in, so
// the lazy-seeded opted-in-company set must be refreshed. Invalidate it after a
// successful write so the next ingress invocation re-seeds (rather than waiting
// out the TTL).
import { invalidateOptedInCache } from '../opted-in-company-set.ts';

export type SetOptInCtx = {
  logger?: PluginLogger;
  actions: PluginActionsClient;
  db: PluginDatabaseClient;
};

export type SetOptInResult = {
  userId: string;
  optedInAt: string | null;
};

export function registerSetOptIn(ctx: SetOptInCtx): void {
  ctx.actions.register('set-opt-in', async (params) => {
    const userId = typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!userId) {
      throw new Error('set-opt-in: userId required (UI must pass it via usePluginAction params from useHostContext().userId)');
    }
    const optedInAtRaw = (params as Record<string, unknown>).optedInAt;
    if (optedInAtRaw !== null && typeof optedInAtRaw !== 'string') {
      throw new Error('set-opt-in: optedInAt must be ISO string or null');
    }
    const optedInAt = optedInAtRaw as string | null;
    await ctx.db.execute(
      'INSERT INTO plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs (user_id, opted_in_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET opted_in_at = EXCLUDED.opted_in_at',
      [userId, optedInAt],
    );
    // D-12 — the opt-in set just changed; force a re-seed on the next ingress.
    invalidateOptedInCache();
    const result: SetOptInResult = { userId, optedInAt };
    return result;
  });
}
