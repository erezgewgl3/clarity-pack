// src/ui/primitives/ref-chip.tsx
//
// Plan 02-02 Task 2 — inline reference card. Renders an issue id with status
// badge inline (e.g. "BEAAA-141 · in_progress"). Calls the worker handler
// 'resolve-refs' via the plugin bridge; that handler enforces the PRIM-01
// single-round-trip contract — for batches of refs in the same render, the
// caller is expected to gather ids into one usePluginData call (Plan 02-03
// Reader view does this).
//
// Plan 02-09 Task 2 — DEV-15-STRUCTURAL: viewer identity must come from
// useResolvedUserId() (the Better-Auth-backed resolver) so detail-tab slots
// where useHostContext().userId is null still identify the caller correctly.
// Prior to this change we destructured `userId` from useHostContext() and
// passed `userId ?? ''` — which fail-closed every wrapped handler in
// detail-tab slots during the host's session-loading window.
//
// Plan 04.2-05 D3 — once resolved, the chip is a clickable anchor pointing
// at `/<companyPrefix>/issues/<identifier>` (the canonical Paperclip issue
// URL pattern — see MemPalace runbook `paperclip-issue-url-pattern`). The
// 2026-05-24 drill captured the operator typing issue URLs by hand because
// the chip + rail row + inline TASK CREATED card were not clickable to the
// issue's Reader. Pre-resolve (or when companyPrefix is unavailable) the
// chip stays a span — never a broken anchor target.
//
// Plan 05-05 Task 2 (D-08 + D-09) — hover peek card. The chip now sits inside
// a positioning wrap span; on hover (mouseEnter / mouseLeave) AND on touch
// long-press (500ms) a peek popover renders with title + status + owner
// display name + first-line description excerpt (≤120 chars, viewer-gated).
// CLICK navigation is UNCHANGED — anchor still routes to /<prefix>/issues/<id>
// via useHostNavigation.linkProps (the D-08 lock). When ownerName degraded
// server-side OR ownerUserId is null, the peek shows the LITERAL 'unassigned'
// — NEVER the UUID (NO_UUID_LEAK).

import * as React from 'react';
import { useHostLocation, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RefCardData } from '../../shared/types.ts';
import { useResolvedUserId } from './use-resolved-user-id.ts';
import { useHostNavigation } from './use-host-navigation.ts';
import { extractCompanyPrefixFromPathname } from './use-resolved-company-id.ts';

const LONG_PRESS_MS = 500;

export function RefChip({ refId }: { refId: string }): React.ReactElement {
  // Plan 02-09 Task 2 — resolver sources the viewer id even when host bridge
  // is still null in detail-tab slots. While the resolver is in flight we
  // pass an empty params object — opt-in-guard's extractUserId returns null,
  // the guard returns OPT_IN_REQUIRED, and the chip stays in its loading
  // pill state until the resolver lands. This is the structurally-correct
  // bootstrap: no fake identity, no race, no crash.
  const { userId, loading: userIdLoading } = useResolvedUserId();
  const ready = !userIdLoading && !!userId;
  const { data, loading } = usePluginData<RefCardData[] | { error: string }>(
    'resolve-refs',
    ready ? { ids: [refId], userId } : {},
  );
  // Plan 04.2-05 D3 — derive the company URL prefix from the current
  // pathname (the same source-of-truth Reader/Chat surfaces use) so the
  // resolved anchor can target /<prefix>/issues/<identifier>.
  const nav = useHostNavigation();
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';

  // Plan 05-05 Task 2 (D-08) — hover peek state. Open on mouseEnter; close
  // on mouseLeave / focusOut / tap-elsewhere. Touch long-press fallback
  // schedules a 500ms timer in onTouchStart and cancels in onTouchEnd /
  // onTouchMove.
  const [peekOpen, setPeekOpen] = React.useState(false);
  const longPressTimerRef = React.useRef<number | null>(null);

  const cancelLongPress = React.useCallback((): void => {
    if (longPressTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const onTouchStart = React.useCallback((): void => {
    cancelLongPress();
    if (typeof window === 'undefined') return;
    longPressTimerRef.current = window.setTimeout(() => {
      setPeekOpen(true);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  }, [cancelLongPress]);

  const onTouchEnd = React.useCallback((): void => {
    cancelLongPress();
  }, [cancelLongPress]);

  // Cleanup any pending long-press timer when the component unmounts.
  React.useEffect(() => {
    return () => cancelLongPress();
  }, [cancelLongPress]);

  const card = Array.isArray(data) ? data[0] : undefined;
  const showPeek = peekOpen && card && !loading && !userIdLoading;

  // Plan 05-05 D-09 — peek content. Owner fallback is the LITERAL 'unassigned'
  // string when card.ownerName is null/missing — NEVER the UUID. Description
  // excerpt is conditionally rendered on presence so the PRIM-02 viewer-
  // permission-denied case (descriptionExcerpt === null) hides the section.
  const peek = showPeek && card ? (
    <div
      className="clarity-ref-chip-peek"
      role="tooltip"
      data-clarity-region="ref-chip-peek"
    >
      <div className="clarity-ref-chip-peek-title">{card.title}</div>
      <div className="clarity-ref-chip-peek-meta">
        {card.status} · {card.ownerName ?? 'unassigned'}
      </div>
      {card.descriptionExcerpt ? (
        <div className="clarity-ref-chip-peek-excerpt">{card.descriptionExcerpt}</div>
      ) : null}
    </div>
  ) : null;

  // Plan 05-05 D-08 — every render path (loading / no-prefix / anchor) is
  // wrapped in the SAME positioning span so the hover-peek behaviour is
  // consistent. Even pre-resolve the operator gets the peek affordance when
  // the card eventually loads.
  const wrapProps = {
    className: 'clarity-ref-chip-wrap',
    'data-clarity-region': 'ref-chip-wrap',
    style: { position: 'relative' as const, display: 'inline-block' as const },
    onMouseEnter: () => setPeekOpen(true),
    onMouseLeave: () => setPeekOpen(false),
    onTouchStart,
    onTouchEnd,
    onTouchMove: onTouchEnd,
    onBlur: () => setPeekOpen(false),
  };

  if (loading || userIdLoading || !card) {
    return (
      <span {...wrapProps}>
        <span className="clarity-ref-chip clarity-ref-chip--loading">{refId}</span>
        {peek}
      </span>
    );
  }
  // Plan 04.2-05 D3 — once resolved AND companyPrefix is available, render
  // as a host-routed anchor (nav.linkProps — NEVER raw <a href>; SCAF-09 +
  // ESLint no-raw-anchor rule). Without a prefix the chip stays a span so
  // there's no broken `/undefined/issues/...` link.
  if (!companyPrefix) {
    return (
      <span {...wrapProps}>
        <span className="clarity-ref-chip" data-status={card.status}>
          {card.id} · {card.status}
        </span>
        {peek}
      </span>
    );
  }
  return (
    <span {...wrapProps}>
      <a
        {...nav.linkProps(`/${companyPrefix}/issues/${card.id}`)}
        className="clarity-ref-chip"
        data-status={card.status}
      >
        {card.id} · {card.status}
      </a>
      {peek}
    </span>
  );
}
