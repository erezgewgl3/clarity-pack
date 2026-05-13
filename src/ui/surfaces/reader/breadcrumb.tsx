// src/ui/surfaces/reader/breadcrumb.tsx
//
// Plan 02-03 Task 2 — READER-06 goal-ancestry breadcrumb. Renders project →
// milestone → parent → this task. Each segment uses useHostNavigation().linkProps
// so the host router intercepts clicks while preserving modifier-click /
// middle-click / copy-link browser-native behavior (SCAF-09 — no raw <a href>).

import * as React from 'react';

import { useHostNavigation } from '../../primitives/use-host-navigation.ts';

export type AncestrySegment = { id: string; title: string; url: string };

export type Ancestry = {
  project: AncestrySegment | null;
  milestone: AncestrySegment | null;
  parent: AncestrySegment | null;
};

export function Breadcrumb({
  ancestry,
}: {
  ancestry: Ancestry | null | undefined;
}): React.ReactElement | null {
  // useHostNavigation must be called unconditionally — early-return after.
  // The hook returns { linkProps(href) } shape (verified against
  // @paperclipai/plugin-sdk/ui/hooks.d.ts in 02-02 spike).
  const nav = useHostNavigation();
  if (!ancestry) return null;
  const segments = [ancestry.project, ancestry.milestone, ancestry.parent].filter(
    (s): s is AncestrySegment => s !== null && s !== undefined,
  );
  return (
    <nav className="clarity-breadcrumb" data-clarity-region="breadcrumb" aria-label="Goal ancestry">
      {segments.map((s, i) => {
        const props = nav.linkProps(s.url);
        return (
          <React.Fragment key={s.id}>
            <a {...props} className="clarity-breadcrumb-segment">
              {s.title}
            </a>
            {i < segments.length - 1 ? <span className="clarity-breadcrumb-sep">·</span> : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
