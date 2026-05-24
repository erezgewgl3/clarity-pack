// src/ui/surfaces/reader/ac-checklist.tsx
//
// Plan 02-03 Task 2 — READER-07 manual acceptance-criteria checklist. Each
// row = checkbox + label; toggling calls usePluginAction('ac-toggle'). Auto-
// status (driven by AC text in comment markers) is the Plan 05-03 (DIST-03)
// addition.
//
// Plan 05-03 (DIST-03) — auto-status indicator (locked design A2):
//   - The MANUAL checkbox JSX is structurally untouched (Phase 2 regression-
//     pin). Manual is the source of truth (A3 no-conflict).
//   - When `autoStatus?.[String(item.id)]?.detected === true`, a small caption
//     "auto: ✓ via <name> · <ago> ago" renders to the RIGHT of the label.
//   - NO_UUID_LEAK: the indicator NEVER renders `sourceAuthorAgentId`. The
//     label is `sourceAuthorName ?? 'agent'`.
//   - The new CSS class `.clarity-ac-autostatus` is scoped under
//     `[data-clarity-surface]` (the row sits inside ClaritySurfaceRoot).

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import { shortAgo } from '../../util/humanize.ts';

export type AcItem = {
  id: number;
  issue_id: string;
  label: string;
  checked: boolean;
  display_order: number;
};

// Plan 05-03 — shape produced by `reader.ac.autostatus`. Keyed by string-form
// of AC item id; absent key = no detection. `sourceAuthorAgentId` is exposed
// in the type only because tests + downstream tooling may inspect it — the
// rendered JSX MUST NEVER reference it directly (NO_UUID_LEAK).
export type AcAutoStatusEntry = {
  detected: true;
  sourceCommentId: string;
  sourceAuthorAgentId: string | null;
  sourceAuthorName: string | null;
  sourceCreatedAt: string;
};
export type AcAutoStatusMap = Record<string, AcAutoStatusEntry>;

export function AcChecklist({
  issueId,
  items,
  userId,
  autoStatus,
}: {
  issueId: string;
  items: AcItem[] | undefined;
  userId?: string | null;
  // Plan 05-03 — optional so every existing call site that did not pass it
  // (the loading branch, the legacy test harness, prior cached payloads) keeps
  // compiling unchanged. `null` means "no auto-status data" (loading or
  // degraded); a non-null map drives per-row indicators.
  autoStatus?: AcAutoStatusMap | null;
}): React.ReactElement {
  const toggleAc = usePluginAction('ac-toggle');
  // DEV-15 (drill 2026-05-14): defensive null-safety. Same pattern as
  // AnchoredToCards — the issue-reader worker handler may return acItems
  // as undefined when a sub-handler degrades, and the host's
  // PluginSlotErrorBoundary crashes the whole Reader tab if we read
  // .length on undefined.
  const safe = items ?? [];
  return (
    <section className="clarity-ac-checklist" data-clarity-region="ac-checklist">
      <h3>Acceptance criteria</h3>
      {safe.length === 0 ? (
        <p className="clarity-ac-empty">No acceptance criteria recorded yet.</p>
      ) : (
        <ul>
          {safe.map((it) => {
            // Plan 05-03 — AcItem.id is a NUMBER; the regex captures a string.
            // Key the lookup by String(id) so future AC ids that include
            // letters/hyphens still match without a silent Number() coercion.
            const auto = autoStatus ? autoStatus[String(it.id)] : undefined;
            return (
              <li key={it.id} className="clarity-ac-item">
                <label>
                  <input
                    type="checkbox"
                    checked={it.checked}
                    onChange={(e) => {
                      void toggleAc({ id: it.id, checked: e.target.checked, userId: userId ?? null });
                    }}
                    aria-label={`Toggle: ${it.label}`}
                    data-issue-id={issueId}
                  />
                  {it.label}
                </label>
                {/* Plan 05-03 (DIST-03) — auto-status indicator. Rendered only
                    when `detected === true`. NEVER references
                    sourceAuthorAgentId directly (NO_UUID_LEAK regression-pin
                    in test/ui/ac-checklist-autostatus.test.mjs). */}
                {auto?.detected === true ? (
                  <span
                    className="clarity-ac-autostatus"
                    data-clarity-region="ac-autostatus"
                    data-ac-id={String(it.id)}
                  >
                    {' '}auto: ✓ via {auto.sourceAuthorName ?? 'agent'} · {shortAgo(auto.sourceCreatedAt)} ago
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
