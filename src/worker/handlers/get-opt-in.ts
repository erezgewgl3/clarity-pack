// src/worker/handlers/get-opt-in.ts
//
// Plan 02-04 Task 1 — read the caller's clarity_user_prefs row. Returns the
// default-opted-out shape when no row exists (per OPTIN-01: absence-of-row =
// opted-OUT default).
//
// DEVIATION: reads userId from params (NOT a fictional ctx.host.currentUserId)
// per 02-03b-API-SHAPES.md §5 and SDK PluginContext shape. UI passes via
// useHostContext().userId. EXEMPT from opt-in-guard (users must be able to
// read their own prefs even when opted-out).

import type {
  PluginDataClient,
  PluginDatabaseClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type GetOptInCtx = {
  logger?: PluginLogger;
  data: PluginDataClient;
  db: PluginDatabaseClient;
};

export type GetOptInResult = {
  userId: string;
  optedInAt: string | null;
  defaultLanding: 'classic' | 'clarity';
};

type PrefsRow = {
  user_id: string;
  opted_in_at: string | null;
  default_landing: string | null;
};

export function registerGetOptIn(ctx: GetOptInCtx): void {
  ctx.data.register('get-opt-in', async (params) => {
    const userId = typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!userId) {
      throw new Error('get-opt-in: userId required (UI must pass it via usePluginData params from useHostContext().userId)');
    }
    const rows = await ctx.db.query<PrefsRow>(
      'SELECT user_id, opted_in_at, default_landing FROM plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs WHERE user_id = $1',
      [userId],
    );
    const row = rows[0];
    const defaultLanding: GetOptInResult['defaultLanding'] =
      row?.default_landing === 'clarity' ? 'clarity' : 'classic';
    const result: GetOptInResult = {
      userId,
      optedInAt: row?.opted_in_at ?? null,
      defaultLanding,
    };
    return result;
  });
}
