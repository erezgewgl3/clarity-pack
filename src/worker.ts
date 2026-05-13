import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    // Smoke spike: prove the worker boots and the JSON-RPC stdio loop wires up.
    // No data/action handlers, no agents, no jobs — those land in Plans 02-02..02-04.
    ctx.logger?.info?.("clarity-pack smoke worker started");
  }
});

runWorker(plugin, import.meta.url);
