// src/worker/opt-in-guard.ts
//
// Plan 02-04 Task 1 — OPTIN-04 server-side enforcement. Wraps every data /
// action handler registration so opted-out callers receive a structured
// {error: 'OPT_IN_REQUIRED'} response BEFORE the inner handler runs. This
// is mandatory under the same-origin trust model: UI gating alone is
// insufficient because any user can call ctx.data.register handlers via the
// host bridge regardless of which UI mounted them (PITFALLS.md #5).
//
// DEVIATION FROM PLAN: The plan text says "ctx.host.currentUserId" — but
// SDK 2026.512.0's PluginContext has NO `host` field (see
// .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md §5 and
// node_modules/@paperclipai/plugin-sdk/dist/types.d.ts lines 1292-1345).
// Following the 02-03b convention, this guard reads `userId` from the
// handler's params; the UI passes it via useHostContext().userId in
// usePluginData / usePluginAction. If userId is missing the caller is
// treated as opted-out (cannot identify them, refuse to serve).
//
// The EXEMPT_HANDLER_KEYS Set is exported so tests can pin its members.
// Three keys MUST stay exempt:
//   - 'get-opt-in'                       — users must read their own prefs even when opted-out
//   - 'set-opt-in'                       — users must toggle ON to leave opted-out state
//   - 'clarity-pack/get-instance-config' — boot-time config read (per 02-01 SMOKE-FINDINGS Check F, FALLBACK pattern)

import type {
  PluginDataClient,
  PluginActionsClient,
  PluginDatabaseClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

/**
 * Subsets of PluginContext that opt-in-guard needs. We compose from real
 * SDK interface types (no local "lying about the SDK" Ctx shapes — see
 * 02-03b-API-SHAPES.md Summary). Split into Data + Action variants so a
 * handler that only registers data can omit `actions` (which it doesn't
 * carry through to anything else).
 */
export type OptInGuardCtxBase = {
  logger?: PluginLogger;
  db: PluginDatabaseClient;
};

export type OptInGuardDataCtx = OptInGuardCtxBase & {
  data: PluginDataClient;
};

export type OptInGuardActionCtx = OptInGuardCtxBase & {
  actions: PluginActionsClient;
};

/** Convenience alias for handlers that register both data and action keys. */
export type OptInGuardCtx = OptInGuardDataCtx & OptInGuardActionCtx;

/**
 * The three keys exempt from opt-in-guard. Exported so tests + the runtime
 * registry can both pin the list.
 */
export const EXEMPT_HANDLER_KEYS: Set<string> = new Set([
  'get-opt-in',
  'set-opt-in',
  'clarity-pack/get-instance-config',
]);

/** Structured error response for opted-out callers (OPTIN-04). */
const OPT_IN_REQUIRED = { error: 'OPT_IN_REQUIRED' as const };

async function isOptedIn(ctx: OptInGuardCtxBase, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const rows = await ctx.db.query<{ opted_in_at: string | null }>(
      'SELECT opted_in_at FROM plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs WHERE user_id = $1',
      [userId],
    );
    const row = rows[0];
    return !!row?.opted_in_at;
  } catch (e) {
    ctx.logger?.warn?.('opt-in-guard: prefs lookup failed', { err: (e as Error).message });
    return false;
  }
}

/**
 * Register a data handler that returns {error:OPT_IN_REQUIRED} for opted-out
 * callers and forwards to `fn` otherwise. Exempt keys bypass the gate.
 */
export function wrapDataHandler(
  ctx: OptInGuardDataCtx,
  key: string,
  fn: (params: Record<string, unknown>) => Promise<unknown>,
): void {
  if (EXEMPT_HANDLER_KEYS.has(key)) {
    ctx.data.register(key, fn);
    return;
  }
  ctx.data.register(key, async (params) => {
    const userId = typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!(await isOptedIn(ctx, userId))) {
      return OPT_IN_REQUIRED;
    }
    return fn(params);
  });
}

/**
 * Register an action handler with the same opt-in gate.
 */
export function wrapActionHandler(
  ctx: OptInGuardActionCtx,
  key: string,
  fn: (params: Record<string, unknown>) => Promise<unknown>,
): void {
  if (EXEMPT_HANDLER_KEYS.has(key)) {
    ctx.actions.register(key, fn);
    return;
  }
  ctx.actions.register(key, async (params) => {
    const userId = typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!(await isOptedIn(ctx, userId))) {
      return OPT_IN_REQUIRED;
    }
    return fn(params);
  });
}
