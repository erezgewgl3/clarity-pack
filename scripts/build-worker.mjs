import { build } from "esbuild";

await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: [
    "@paperclipai/plugin-sdk",
    "react",
    "react-dom"
  ],
  logLevel: "info"
});
