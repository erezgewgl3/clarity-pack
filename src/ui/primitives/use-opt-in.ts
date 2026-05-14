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
  const { data, loading } = usePluginData<OptInData>('get-opt-in', { userId: userId ?? '' });
  const setOptIn = usePluginAction('set-opt-in');
  const optedIn = data?.optedInAt != null;
  const toggle = async (): Promise<void> => {
    const nextValue = optedIn ? null : new Date().toISOString();
    await setOptIn({ userId: userId ?? '', optedInAt: nextValue });
  };
  return { optedIn, loading, toggle };
}
