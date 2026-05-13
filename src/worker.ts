// src/worker.ts — Plan 02-02 Task 3 worker promotion.
//
// Registers the two data handlers from Plan 02-02 Task 1 (resolve-refs +
// flatten-blocker-chain) so the UI primitives + 02-03/02-04 surfaces can
// consume them via the plugin bridge. Editor-Agent reconcile wiring lands
// in Plan 02-03; opt-in handlers + situation-snapshot job land in Plan 02-04.

import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';

import { registerResolveRefs, type ResolveRefsCtx } from './worker/handlers/resolve-refs.ts';
import {
  registerFlattenBlockerChain,
  type FlattenBlockerChainCtx,
} from './worker/handlers/flatten-blocker-chain.ts';

const plugin = definePlugin({
  async setup(ctx) {
    // Both handlers are pure data-providers — no side effects on registration.
    // The host invokes them lazily when the UI calls usePluginData(key, ...).
    registerResolveRefs(ctx as unknown as ResolveRefsCtx);
    registerFlattenBlockerChain(ctx as unknown as FlattenBlockerChainCtx);
    ctx.logger?.info?.('clarity-pack worker started — resolve-refs + flatten-blocker-chain registered');
  },
});

runWorker(plugin, import.meta.url);
