import { build } from "esbuild";

// HOTFIX (Plan 05-10 worker bundler): xlsx@0.18.5 is a CommonJS package that
// invokes `require("stream")` at module-eval time inside its UMD factory. When
// esbuild bundles CJS into an ESM output (`format: "esm"`), it replaces
// `require()` with a throwing `__require` stub. On Node ESM module load,
// `require` is undefined at module scope → the stub throws
// `Error: Dynamic require of "stream" is not supported` and the worker fails
// to activate (host reports `status=error`).
//
// Fix: inject `createRequire(import.meta.url)` at the very top of the bundle so
// SheetJS's `__require("stream")` resolves to Node's native CommonJS require
// (which can load built-in modules from ESM context). This is the canonical
// esbuild + ESM-target + CJS-deps recipe.
//
// Worker externals (react, react-dom, @paperclipai/plugin-sdk) remain
// unchanged; xlsx stays bundled.
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
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  },
  logLevel: "info"
});
