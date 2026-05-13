import { build } from "esbuild";

await build({
  entryPoints: ["src/ui/index.tsx"],
  outfile: "dist/ui/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@paperclipai/plugin-sdk",
    "@paperclipai/plugin-sdk/ui",
    "@paperclipai/plugin-sdk/ui/hooks"
  ],
  logLevel: "info"
});
