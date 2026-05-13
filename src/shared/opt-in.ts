// src/shared/opt-in.ts
//
// Plan 02-02 Task 1 — OPTIN-01 semantics in pure helper form. Absence of a
// clarity_user_prefs row for a user means "opted OUT, default landing classic"
// — i.e., the OFF state is the absence of data, not an explicit row with
// optedInAt=null. (Plan 02-04 worker handlers persist this contract against
// the plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs table per 02-01
// SMOKE-FINDINGS Finding #4.)

import type { OptInPrefs } from './types.ts';

/**
 * Look up the OptInPrefs for a user; if no row exists, return the OFF default
 * (optedInAt=null + defaultLanding='classic'). The input map is a snapshot of
 * the clarity_user_prefs table (or a subset for the current viewer); the
 * caller is responsible for populating it.
 */
export function getOptIn(
  userId: string,
  prefs: Map<string, OptInPrefs>,
): OptInPrefs {
  const row = prefs.get(userId);
  if (row) return row;
  return { userId, optedInAt: null, defaultLanding: 'classic' };
}

/**
 * Pure predicate: is this user opted in? True iff optedInAt is a non-null
 * ISO string. Used by opt-in-guard (Plan 02-04) to gate handler invocations.
 */
export function isOptedIn(prefs: OptInPrefs): boolean {
  return typeof prefs.optedInAt === 'string' && prefs.optedInAt.length > 0;
}
