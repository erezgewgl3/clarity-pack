// src/ui/primitives/clarity-surface-root.tsx
//
// Plan 02-02 Task 2 — SCAF-06 + COEXIST-01: every Clarity-rendered root
// element carries `data-clarity-surface="<name>"`. The theme.css selectors
// scope all Clarity styles under that attribute, so Clarity CSS cannot bleed
// onto host page elements. Every Phase-2 surface (Reader / Situation Room /
// Bulletin stub / Chat stub / Settings) wraps its top-level component in
// <ClaritySurfaceRoot name="...">.
//
// Style injection is centralized in src/ui/index.tsx (DEV-14 fix from the
// 2026-05-14 re-rehearsal drill — Paperclip's host does NOT auto-load plugin
// CSS files; the bundle must inject its own <style> at runtime). This
// primitive no longer imports theme.css directly; instead, every entry path
// goes through src/ui/index.tsx which does the one-time injection.

import * as React from 'react';

export type ClaritySurfaceName =
  | 'reader'
  | 'situation-room'
  | 'bulletin'
  | 'chat'
  | 'settings';

export function ClaritySurfaceRoot({
  name,
  children,
}: {
  name: ClaritySurfaceName;
  children: React.ReactNode;
}): React.ReactElement {
  return <div data-clarity-surface={name}>{children}</div>;
}
