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

import * as React from 'react';
import { useHostLocation, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RefCardData } from '../../shared/types.ts';
import { useResolvedUserId } from './use-resolved-user-id.ts';
import { useHostNavigation } from './use-host-navigation.ts';
import { extractCompanyPrefixFromPathname } from './use-resolved-company-id.ts';

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

  const card = Array.isArray(data) ? data[0] : undefined;
  if (loading || userIdLoading || !card) {
    return (
      <span className="clarity-ref-chip clarity-ref-chip--loading">{refId}</span>
    );
  }
  // Plan 04.2-05 D3 — once resolved AND companyPrefix is available, render
  // as a host-routed anchor (nav.linkProps — NEVER raw <a href>; SCAF-09 +
  // ESLint no-raw-anchor rule). Without a prefix the chip stays a span so
  // there's no broken `/undefined/issues/...` link.
  if (!companyPrefix) {
    return (
      <span className="clarity-ref-chip" data-status={card.status}>
        {card.id} · {card.status}
      </span>
    );
  }
  return (
    <a
      {...nav.linkProps(`/${companyPrefix}/issues/${card.id}`)}
      className="clarity-ref-chip"
      data-status={card.status}
    >
      {card.id} · {card.status}
    </a>
  );
}
