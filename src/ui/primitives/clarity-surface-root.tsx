// src/ui/primitives/clarity-surface-root.tsx
//
// Plan 02-02 Task 2 — SCAF-06 + COEXIST-01: every Clarity-rendered root
// element carries `data-clarity-surface="<name>"`. The theme.css selectors
// scope all Clarity styles under that attribute, so Clarity CSS cannot bleed
// onto host page elements. Every Phase-2 surface (Reader / Situation Room /
// Bulletin stub / Chat stub / Settings) wraps its top-level component in
// <ClaritySurfaceRoot name="...">.
//
// Importing theme.css here ensures the CSS is bundled wherever the primitive
// is used — surfaces don't have to remember to import it separately.

import * as React from 'react';
import './theme.css';

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
