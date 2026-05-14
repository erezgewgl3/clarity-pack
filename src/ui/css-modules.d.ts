// src/ui/css-modules.d.ts
//
// DEV-14 (drill 2026-05-14 re-rehearsal): Paperclip's host loads the plugin
// UI JS bundle but does NOT auto-load sibling CSS files. The plugin must
// inject its own stylesheet at runtime. esbuild's `loader: { '.css': 'text' }`
// converts CSS imports into string-typed default exports; this ambient
// declaration tells TypeScript about that shape.

declare module '*.css' {
  const content: string;
  export default content;
}
