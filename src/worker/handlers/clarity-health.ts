// src/worker/handlers/clarity-health.ts
//
// T1-D (no-rabbit-holes self-health, 2026-06-15) — a minimal worker LIVENESS
// probe. Background: the BEAAA blank-UI incident was a CRASHED worker (the
// plugin's Node worker died on an EADDRINUSE :3100 bind during a fail2ban-
// interrupted deploy) with no operator-visible signal. The UI ClaritySurface
// boundary (clarity-surface-boundary.tsx) catches render-time throws, but it
// can only run if the bundle loaded AND the worker answers the bridge. This
// handler is the complementary ops signal: a dependency-free, opt-in-EXEMPT,
// zero-DB, zero-host-call data handler an ops probe (or a future host health
// check) can hit to confirm the worker process is alive and answering the
// bridge.
//
//   POST /api/plugins/<id>/data/clarity-pack/health  ->  { ok: true, ts }
//
// Deliberately NOT opt-in gated (a liveness probe must answer regardless of the
// caller's prefs) and deliberately carries NO version literal — version is
// already authoritative via `paperclipai plugin list`, and the project rule is
// that version lives in exactly two byte-identical sources (package.json +
// src/manifest.ts); a third copy here would be a drift hazard. The presence of
// a 200 `{ ok: true }` is the signal; a crashed/not-ready worker yields no
// response (the host bridge errors), which is exactly what an ops probe wants
// to detect.

import type { PluginDataClient } from '@paperclipai/plugin-sdk';

export type ClarityHealthCtx = {
  data: Pick<PluginDataClient, 'register'>;
};

/** The handler key. Exempt from opt-in-guard by registering directly. */
export const CLARITY_HEALTH_KEY = 'clarity-pack/health';

export function registerClarityHealth(ctx: ClarityHealthCtx): void {
  // Registered directly (NOT through wrapDataHandler) so it bypasses the
  // opt-in gate — a liveness probe answers for every caller.
  ctx.data.register(CLARITY_HEALTH_KEY, async () => {
    return { ok: true as const, ts: Date.now() };
  });
}
