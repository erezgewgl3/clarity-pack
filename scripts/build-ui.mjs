// scripts/build-ui.mjs
//
// Plan 02-08 Task 3 (DEV-08 closure) — defense-in-depth production build.
//
// The Plan 02-04 drill observed WebSocket errors to wss://127.0.0.1:13100/ in
// the browser console at /COU/situation-room. Investigation tracked those to
// the HOST page's own dev-mode Vite client (Paperclip's UI is Vite-served in
// dev mode and the HMR client lives outside the plugin bundle entirely).
// HOWEVER: if any library we import branches on `process.env.NODE_ENV` or
// `import.meta.env.*`, the unset-at-build-time value resolves to undefined at
// runtime, which dev-mode shims interpret as "you're in dev — wire HMR / wire
// React DevTools / etc." Setting these via esbuild's `define` at build time
// dead-code-eliminates the dev branches and keeps the plugin bundle clean
// forever.
//
// The test/build/no-vite-hmr-in-production.test.mjs file asserts these
// defines are present AND that dist/ui/index.js contains zero literal
// references to the Vite HMR client.

import { build } from "esbuild";

await build({
  entryPoints: ["src/ui/index.tsx"],
  outfile: "dist/ui/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  loader: {
    // DEV-14 (drill 2026-05-14): import CSS as a string so the JS bundle can
    // inject it at runtime via a <style> tag. Paperclip's host does NOT
    // auto-load sibling CSS files; without this loader, dist/ui/index.css
    // ships in the tarball but never reaches the page.
    ".css": "text"
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.MODE": JSON.stringify("production"),
  },
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
