// src/ui/primitives/use-instance-config.ts
//
// Plan 02-04 Task 2 — D-03 instance config (situationRefreshIntervalMs).
//
// LOCKED to FALLBACK pattern per 02-01 SMOKE-FINDINGS.md `## useInstanceConfig
// SDK Import Path` (FALLBACK REQUIRED). Empirically verified against SDK
// 2026.512.0: NO `useInstanceConfig` export exists at any subpath. The SDK
// exposes PluginConfigClient.get() on the WORKER side only; UI must round-trip
// through a worker handler.
//
// Implementation: thin wrapper around usePluginData with the matching worker
// handler at src/worker/handlers/get-instance-config.ts.

import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

export type InstanceConfig = {
  situationRefreshIntervalMs: number;
};

const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
  situationRefreshIntervalMs: 60_000,
};

export function useInstanceConfig(): InstanceConfig {
  const { data } = usePluginData<InstanceConfig>('clarity-pack/get-instance-config');
  return data ?? DEFAULT_INSTANCE_CONFIG;
}
