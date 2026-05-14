// src/worker/handlers/get-instance-config.ts
//
// Plan 02-04 Task 2 step 5 OPTION (b) FALLBACK per 02-01 SMOKE-FINDINGS.md
// `## useInstanceConfig SDK Import Path` (FALLBACK REQUIRED): SDK 2026.512.0
// does NOT export useInstanceConfig from any subpath, so the UI must
// round-trip through this worker handler.
//
// Reads via ctx.config.get() per the SDK's typed PluginConfigClient
// (types.d.ts:219-226). Returns the manifest-validated values; if the
// manifest declares `instanceConfigSchema.situationRefreshIntervalMs` with a
// default of 60_000, the host's validator guarantees the returned value is a
// number in [30_000, 600_000].
//
// EXEMPT from opt-in-guard (boot-time read; UI uses this BEFORE the user can
// opt in — e.g. to know the polling cadence for any surface that needs it).

import type {
  PluginConfigClient,
  PluginDataClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type GetInstanceConfigCtx = {
  logger?: PluginLogger;
  data: PluginDataClient;
  config: PluginConfigClient;
};

export type InstanceConfig = {
  situationRefreshIntervalMs: number;
};

const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
  situationRefreshIntervalMs: 60_000,
};

export function registerGetInstanceConfig(ctx: GetInstanceConfigCtx): void {
  ctx.data.register('clarity-pack/get-instance-config', async () => {
    try {
      const raw = (await ctx.config.get()) as Record<string, unknown>;
      const rawValue = raw?.situationRefreshIntervalMs;
      const situationRefreshIntervalMs =
        typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue >= 30_000
          ? rawValue
          : DEFAULT_INSTANCE_CONFIG.situationRefreshIntervalMs;
      const result: InstanceConfig = { situationRefreshIntervalMs };
      return result;
    } catch (e) {
      ctx.logger?.warn?.('get-instance-config: ctx.config.get failed, returning defaults', {
        err: (e as Error).message,
      });
      return DEFAULT_INSTANCE_CONFIG;
    }
  });
}
