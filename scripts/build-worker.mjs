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
// 2026-05-27 SDK-bundling fix: @paperclipai/plugin-sdk REMOVED from externals.
// PR #6547 (Paperclip 2026.525.0) added invocation-scope propagation to the
// worker SDK. When @paperclipai/plugin-sdk was externalized, the host's
// `paperclipai plugin install` flow on BEAAA resolved the SDK to a 2026.512.0
// copy at runtime regardless of what our package.json declared — npm hoisting
// from the host's bundled paperclipai install pulled the older SDK in. The
// older SDK has zero AsyncLocalStorage plumbing for paperclipInvocationId and
// every nested worker→host call (agents.list, issues.get, etc.) was rejected
// with "the worker referenced a missing, expired, or unknown invocation scope"
// on a 2026.525.0 host. Bundling the SDK into worker.js eliminates that
// runtime-resolution surface entirely — the worker carries exactly the SDK
// version we built against. react / react-dom stay externalized (host singleton
// requirement); xlsx stays bundled.
await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: [
    "react",
    "react-dom"
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  },
  logLevel: "info"
});
