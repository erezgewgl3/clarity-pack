// src/ui/primitives/use-resolved-user-id.ts
//
// Plan 02-09 Task 1 — DEV-15-STRUCTURAL closure. Same shape as Plan 02-03c's
// useResolvedCompanyId; resolves the viewer's userId for opt-in-guard-wrapped
// handler calls in detail-tab slots where useHostContext().userId returns null.
//
// Background: Plan 02-04 + 02-08 drill (2026-05-14 / 2026-05-15) caught the
// detail-tab slot bridge returning userId=null until the host's
// authApi.getSession() resolves (TanStack-Query loading window in
// PluginBridgeScope — see 02-03c-HOST-CONTEXT.md §1 for the universal
// pipeline). When userId=null, every opt-in-guard-wrapped data handler
// returns {error:'OPT_IN_REQUIRED'} and the Reader tab renders nothing.
//
// STRUCTURAL DEVIATION FROM PLAN TEXT — Plan 02-09's literal task description
// proposed a worker-side `get-viewer` handler. We verified the SDK surface:
//   - PluginContext (node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:
//     1292-1345) has NO `users`, `user`, `session`, or `identity` accessor.
//   - GetDataParams (protocol.d.ts:210-217) has no envelope-level userId;
//     companyId at HTTP bridge envelope is NOT forwarded to the worker as
//     a separate field — it must be threaded through `params`. The UI cannot
//     bootstrap a worker `get-viewer` call without already knowing userId
//     (it would be empty in params), creating a circular dependency.
//   - ctx.http.fetch (types.d.ts:386-399) is OUTBOUND from the Node worker
//     process — no browser session cookies, no way to identify the caller.
//
// The plan's escape hatch (Task 1 behavior block) explicitly authorized
// deviation: "If neither path works, the executor must STOP and surface this
// as a structural blocker" AND "Implementation: TBD by handler author".
//
// The correct architectural fit is a UI-side fetch. Plugin UI bundles run as
// SAME-ORIGIN trusted JavaScript inside the main Paperclip app (per
// PROJECT.md and PLUGIN_SPEC.md §19) — they can call Paperclip's auth
// endpoints directly with credentials: 'include' to send the host session
// cookie. Paperclip uses Better Auth (per 02-03c-HOST-CONTEXT.md:44 — the
// userId in slotContextToHostContext is read from authApi.getSession() inside
// PluginBridgeScope). Better Auth's canonical session endpoint is
// /api/auth/get-session.
//
// Resolver chain:
//   1. useHostContext().userId — if non-null AND non-empty, short-circuit
//      (page slots + eventually-resolved detail-tab slots).
//   2. Otherwise, fire ONE-TIME fetch('/api/auth/get-session', {
//        credentials: 'include',
//        headers: { Accept: 'application/json' }
//      }).
//   3. On 200 + valid body → userId. Accept Better-Auth shape `{user: {id}}`
//      AND legacy top-level `{userId}` shape.
//   4. On 401 / non-200 / missing id / fetch reject → 'no-user-context' error.
//
// React hook-rules: hooks called unconditionally; the fetch effect itself is
// gated by a `shouldResolve` flag inside useEffect (not by hook order).

import { useEffect, useState } from 'react';
import { useHostContext } from '@paperclipai/plugin-sdk/ui/hooks';

export type ResolvedUserId =
  | { userId: string; loading: false; error: null }
  | { userId: null; loading: true; error: null }
  | { userId: null; loading: false; error: 'no-user-context' };

/**
 * Internal fetch state for the resolver. Pure-function `decideResolvedUserId`
 * consumes this; the React hook wires it via useState.
 */
export type FetchState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'resolved'; userId: string | null }
  | { kind: 'failed' };

/**
 * Pure resolver decision: given the host context userId and the in-flight
 * fetch state, decide which ResolvedUserId variant to return. Extracted as a
 * pure function so the resolver chain can be unit-tested without JSDOM.
 *
 * Empty-string hostContextUserId is normalized to null (matches the
 * opt-in-guard extractUserId convention — see src/worker/opt-in-guard.ts).
 */
export function decideResolvedUserId(args: {
  hostContextUserId: string | null;
  fetchState: FetchState;
}): ResolvedUserId {
  const normalized =
    typeof args.hostContextUserId === 'string' && args.hostContextUserId.length > 0
      ? args.hostContextUserId
      : null;

  // Path 1 — host context already has a real userId. Short-circuit.
  if (normalized) {
    return { userId: normalized, loading: false, error: null };
  }

  // Path 2 — fetch in flight (or idle waiting to fire). Surface loading.
  if (args.fetchState.kind === 'pending' || args.fetchState.kind === 'idle') {
    return { userId: null, loading: true, error: null };
  }

  // Path 3 — fetch failed (network / non-200 / reject).
  if (args.fetchState.kind === 'failed') {
    return { userId: null, loading: false, error: 'no-user-context' };
  }

  // Path 4 — fetch resolved but userId was missing in the response.
  if (args.fetchState.kind === 'resolved' && !args.fetchState.userId) {
    return { userId: null, loading: false, error: 'no-user-context' };
  }

  // Path 5 — fetch resolved with a real userId.
  return { userId: args.fetchState.userId as string, loading: false, error: null };
}

/**
 * Parse the Better-Auth /api/auth/get-session response body. Accepts:
 *   - Better-Auth canonical: `{user: {id, email, ...}, session: {...}}`
 *   - Legacy top-level: `{userId}`
 *
 * Returns null for any other shape (including empty-string user.id).
 */
export function parseUserIdFromSessionResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { user?: unknown; userId?: unknown };

  // Prefer Better-Auth shape: { user: { id: string } }
  if (b.user && typeof b.user === 'object') {
    const u = b.user as { id?: unknown };
    if (typeof u.id === 'string' && u.id.length > 0) return u.id;
  }

  // Fallback: legacy top-level { userId: string }
  if (typeof b.userId === 'string' && b.userId.length > 0) return b.userId;

  return null;
}

const SESSION_ENDPOINT = '/api/auth/get-session';

/**
 * React hook that resolves the viewer's userId, bridging the detail-tab
 * slot's null-userId loading window. See the file header for the full
 * resolver chain and structural deviation rationale.
 */
export function useResolvedUserId(): ResolvedUserId {
  const { userId: hostContextUserId } = useHostContext();
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'idle' });

  // Normalize the host-context userId once per render. Empty string is treated
  // as null (matches opt-in-guard.extractUserId convention).
  const normalizedHostUserId =
    typeof hostContextUserId === 'string' && hostContextUserId.length > 0
      ? hostContextUserId
      : null;

  useEffect(() => {
    // Short-circuit: host context already has a userId → never fetch.
    if (normalizedHostUserId) {
      // Reset fetch state to idle in case the hostContext flipped from null
      // to populated mid-mount (page slots after auth-session resolves).
      setFetchState({ kind: 'idle' });
      return;
    }

    // Only fire one fetch per mount; if the fetch already settled, do not retry.
    let cancelled = false;
    const controller = new AbortController();

    setFetchState({ kind: 'pending' });

    fetch(SESSION_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (cancelled) return;
        if (!resp.ok) {
          setFetchState({ kind: 'failed' });
          return;
        }
        try {
          const body = (await resp.json()) as unknown;
          if (cancelled) return;
          const userId = parseUserIdFromSessionResponse(body);
          setFetchState({ kind: 'resolved', userId });
        } catch {
          if (cancelled) return;
          setFetchState({ kind: 'failed' });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFetchState({ kind: 'failed' });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Effect re-runs only when the host-context userId flips. If it goes from
    // null to populated, we reset to idle in the short-circuit branch above.
  }, [normalizedHostUserId]);

  return decideResolvedUserId({
    hostContextUserId: normalizedHostUserId,
    fetchState,
  });
}
