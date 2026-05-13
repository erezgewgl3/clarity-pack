// src/worker/handlers/flatten-blocker-chain.ts
//
// Plan 02-02 Task 1 — worker handler that exposes flattenBlockerChain (PRIM-03/04/05)
// over the plugin bridge. UI calls usePluginData('flatten-blocker-chain',
// { startId, viewerUserId }); this handler fetches the edge list + node meta
// from Paperclip core, then defers to the pure flattener in src/shared/blocker-chain.ts.
// The terminal selection is owned entirely by the pure code — this handler
// does not modify the result.

import type { BlockerChainResult } from '../../shared/types.ts';
import {
  flattenBlockerChain,
  type BlockerChainInput,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';

type RawBlockerEdges = {
  edges: BlockerEdge[];
  nodeMeta: BlockerChainInput['nodeMeta'];
};

export type FlattenBlockerChainCtx = {
  data: {
    register(
      key: string,
      handler: (params: { startId: string; viewerUserId: string; maxAgeMs?: number }) => Promise<BlockerChainResult>,
    ): void;
  };
  host?: { currentCompanyId?: string };
  http: {
    fetch(url: string, init?: { method?: string }): Promise<{ json(): Promise<RawBlockerEdges> }>;
  };
};

export function registerFlattenBlockerChain(ctx: FlattenBlockerChainCtx): void {
  ctx.data.register('flatten-blocker-chain', async ({ startId, viewerUserId, maxAgeMs }) => {
    const companyId = ctx.host?.currentCompanyId ?? 'unknown';
    const url = `/api/companies/${encodeURIComponent(companyId)}/issues/${encodeURIComponent(startId)}/blockers`;
    const resp = await ctx.http.fetch(url, { method: 'GET' });
    const raw = await resp.json();
    return flattenBlockerChain({
      startId,
      edges: raw.edges ?? [],
      nodeMeta: raw.nodeMeta ?? {},
      viewerUserId,
      maxAgeMs,
    });
  });
}
