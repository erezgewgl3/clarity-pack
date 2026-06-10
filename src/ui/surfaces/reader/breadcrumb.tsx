// src/ui/surfaces/reader/breadcrumb.tsx
//
// Plan 02-03 Task 2 — READER-06 goal-ancestry breadcrumb. Renders project →
// milestone → parent → this task. Each segment uses useHostNavigation().linkProps
// so the host router intercepts clicks while preserving modifier-click /
// middle-click / copy-link browser-native behavior (SCAF-09 — no raw <a href>).

import * as React from 'react';
import { useHostLocation } from '@paperclipai/plugin-sdk/ui/hooks';

import { useHostNavigation } from '../../primitives/use-host-navigation.ts';
// 17-04 (D-12) — instance-agnostic company-prefix source (same helper used by
// reader/index.tsx and ref-card.tsx) so the routable issue/parent segment links
// to /<companyPrefix>/issues/<identifier>.
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';

// 17-04 (D-12) — `url` is a prefix-LESS issue identifier (routable===true) or
// null (routable===false → plain text). `routable` gates link-vs-span so only
// the confirmed host route is clickable (zero 404, zero dead links).
export type AncestrySegment = { id: string; title: string; url: string | null; routable: boolean };

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
  // Hooks must be called unconditionally — BEFORE the early-return. The nav hook
  // returns { linkProps(href) } (verified against
  // @paperclipai/plugin-sdk/ui/hooks.d.ts in 02-02 spike); the location hook
  // feeds the instance-agnostic company prefix (17-04 D-12).
  const nav = useHostNavigation();
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname);
  if (!ancestry) return null;
  const segments = [ancestry.project, ancestry.milestone, ancestry.parent].filter(
    (s): s is AncestrySegment => s !== null && s !== undefined,
  );
  return (
    <nav className="clarity-breadcrumb" data-clarity-region="breadcrumb" aria-label="Goal ancestry">
      {segments.map((s, i) => {
        // 17-04 (D-12) — branch link-vs-plain-text. Only the routable
        // issue/parent segment (with a confirmed host route) is a clickable
        // <a>; everything else is a non-clickable <span> so there are zero dead
        // links / 404s. Keep useHostNavigation().linkProps — no raw <a href>
        // (SCAF-09). `s.url` is the prefix-less issue identifier; prepend
        // /<companyPrefix>/issues/ here at render time.
        const linkable = s.routable && s.url != null;
        return (
          <React.Fragment key={s.id}>
            {linkable ? (
              <a
                {...nav.linkProps(`/${companyPrefix}/issues/${s.url}`)}
                className="clarity-breadcrumb-segment"
              >
                {s.title}
              </a>
            ) : (
              <span className="clarity-breadcrumb-segment clarity-breadcrumb-segment--plain">
                {s.title}
              </span>
            )}
            {i < segments.length - 1 ? <span className="clarity-breadcrumb-sep">·</span> : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
