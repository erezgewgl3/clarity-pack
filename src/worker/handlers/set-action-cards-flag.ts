// src/worker/handlers/set-action-cards-flag.ts
//
// Phase 19 Plan 19-04 Task 1 (CARD-03 / D-08) — the operator RPC that flips the
// action-cards runtime flag ON/OFF. A near-verbatim clone of set-opt-in.ts: a
// param-guarded action whose ONLY write is the parameterized namespaced UPSERT
// in action-cards-flag-repo.ts (setActionCardsEnabled).
//
// WHY AN RPC (not psql): BEAAA has NO psql on the box (memory
// beaaa-deploy-mechanics). The two-step enablement (D-08) needs both the Step-2
// ON-flip AND the panic-OFF to be redeploy-free runtime gestures. This handler
// is that gesture: flip ONE namespaced DB row and the room is ON (Step-2) or
// back to the known-good deterministic floor (panic-OFF) with zero deploy
// latency. The SWR serve-path strip in situation-room.ts makes the panic-OFF
// floor a FRESH cached slice instantly.
//
// ACCESS SCOPE (Security Domain V4 / T-19-11 Elevation-of-Privilege): this is an
// operator/admin runtime control. It matches set-opt-in's posture exactly — it
// registers as a plain ctx.actions handler (the SDK 2026.512.0 manifest has no
// actions[] field; actions are gated by the host's action-invocation auth, same
// as set-opt-in). It accepts NO escalation parameter and is NOT broadened beyond
// set-opt-in's surface. companyId is a target selector, NOT an identity claim:
// the flag is a per-company operator control, not a per-user pref.
//
// All SQL is parameterized via setActionCardsEnabled — companyId/enabled/setBy
// flow through $1/$2/$3 binds; no identifier interpolation (T-19-13 Tampering
// mitigation).

import type {
  PluginActionsClient,
  PluginDatabaseClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';
import { setActionCardsEnabled } from '../db/action-cards-flag-repo.ts';

export type SetActionCardsFlagCtx = {
  logger?: PluginLogger;
  actions: PluginActionsClient;
  db: PluginDatabaseClient;
};

export type SetActionCardsFlagResult = {
  companyId: string;
  enabled: boolean;
};

export function registerSetActionCardsFlag(ctx: SetActionCardsFlagCtx): void {
  ctx.actions.register('set-action-cards-flag', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) {
      throw new Error(
        'set-action-cards-flag: companyId required (operator must pass the company to flip)',
      );
    }
    const enabledRaw = (params as Record<string, unknown>).enabled;
    if (typeof enabledRaw !== 'boolean') {
      throw new Error('set-action-cards-flag: enabled must be a boolean (true = ON, false = panic-OFF)');
    }
    const enabled = enabledRaw;
    const setByRaw = (params as Record<string, unknown>).setBy;
    const setBy = typeof setByRaw === 'string' && setByRaw ? setByRaw : 'operator';

    // The ONLY write — the parameterized namespaced UPSERT (D-01 / T-19-13).
    await setActionCardsEnabled(ctx, companyId, enabled, setBy);

    const result: SetActionCardsFlagResult = { companyId, enabled };
    return result;
  });
}
