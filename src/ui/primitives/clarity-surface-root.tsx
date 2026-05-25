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
//
// Plan 05-08 (D-15 + D-17) — TWO extensions:
//
//   (D-15) ClaritySurfaceName grows the `'archive'` member so the new
//   ArchivePage page-slot (route `/<companyPrefix>/archive`) can pass its
//   surface name to this root.
//
//   (D-17 — checker BLOCKER 4) ToastProvider is HOISTED into the root so
//   every surface (Reader / Situation Room / Bulletin / Chat / Archive /
//   Settings) gets `useToast()` in scope without per-surface wrapping. This
//   is the prerequisite for ClaritySurfaceHeader's cross-surface
//   `Task created` toast (Task 5). The chat surface's in-body
//   <ToastProvider> wrapper is REMOVED in Task 5 to avoid nested providers
//   (Plan 04.2-04's wrap is now redundant — the root provides the same
//   primitive one level up).

import * as React from 'react';
import { ToastProvider } from './toast.tsx';

export type ClaritySurfaceName =
  | 'reader'
  | 'situation-room'
  | 'bulletin'
  | 'chat'
  | 'settings'
  | 'archive';

export function ClaritySurfaceRoot({
  name,
  children,
}: {
  name: ClaritySurfaceName;
  children: React.ReactNode;
}): React.ReactElement {
  // Plan 05-08 D-17 — ToastProvider hoist. One source of `useToast()` for
  // every clarity-pack surface. ClaritySurfaceHeader's `Task created` toast
  // (Task 5) relies on this; per-surface ChatPage / BulletinPage / etc no
  // longer need their own provider wrap.
  return (
    <div data-clarity-surface={name}>
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
