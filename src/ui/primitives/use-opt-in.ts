// src/ui/primitives/use-opt-in.ts
//
// Plan 02-04 Task 1 — OPTIN-02 UI gate. useOptIn() returns the caller's
// opt-in state + a toggle that flips it. Every Clarity surface calls this
// hook at the top of its render and short-circuits to <EnableClarityCta />
// when optedIn === false (so opted-out users see an enable button instead
// of a blank surface).
//
// userId is read from useHostContext() (the SDK's typed UI bridge for the
// authenticated host user — see node_modules/@paperclipai/plugin-sdk/dist/
// ui/types.d.ts:55 PluginHostContext). The worker handler uses the same
// value to identify the prefs row owner.
//
// DEVIATION FROM PLAN: plan said the toggle calls action with just
// {optedInAt:...} — but the worker handler requires userId in params (see
// src/worker/handlers/set-opt-in.ts header). We include userId here so the
// 02-03b convention holds: userId always flows through the bridge
// explicitly, never derived from a fictional ctx.host on the worker.
//
// Plan 02-08 Task 3 (DEV-10 closure): toggle() now invalidates the
// get-opt-in cache by calling `refresh()` (Path A, per SDK
// PluginDataResult.d.ts:328 — `refresh(): void`). Without this, the UI
// stays on the CTA branch until a hard refresh because usePluginData's
// internal cache keeps serving the stale `optedInAt: null`. With this,
// the UI flips from CTA to data-bound render within ~1 RTT after click.

import { usePluginData, usePluginAction, useHostContext } from '@paperclipai/plugin-sdk/ui/hooks';

export type OptInData = {
  userId: string;
  optedInAt: string | null;
  defaultLanding: 'classic' | 'clarity';
};

export type UseOptInResult = {
  optedIn: boolean;
  loading: boolean;
  toggle: () => Promise<void>;
};

export function useOptIn(): UseOptInResult {
  const { userId } = useHostContext();
  // Worker handler refuses to serve when userId is missing — we pass an empty
  // string so the bridge still routes the call (vs. usePluginData skipping the
  // round-trip entirely). The handler will throw with a clear message and the
  // caller's catch logs it; the loading flag will resolve to false.
  const { data, loading, refresh } = usePluginData<OptInData>('get-opt-in', { userId: userId ?? '' });
  const setOptIn = usePluginAction('set-opt-in');
  const optedIn = data?.optedInAt != null;
  const toggle = async (): Promise<void> => {
    const nextValue = optedIn ? null : new Date().toISOString();
    await setOptIn({ userId: userId ?? '', optedInAt: nextValue });
    // DEV-10 (Plan 02-08 Task 3) — invalidate the get-opt-in cache after the
    // action resolves. Without this, the SDK's bridge keeps serving stale
    // optedInAt and the UI never flips from the CTA branch without a hard
    // refresh. refresh() is fire-and-forget; the resulting re-render is
    // handled by usePluginData's own state update.
    refresh();
  };
  return { optedIn, loading, toggle };
}
