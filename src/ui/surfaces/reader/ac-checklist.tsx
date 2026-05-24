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
//   - A4 affordance: each AC row gets a small "Copy marker" button that
//     copies the exact `AC: <id>: ✓` string the scanner expects, reducing
//     operator discipline cost. Falls back to a textarea+execCommand path
//     when navigator.clipboard is unavailable.
//
// Quick fix 260524-s2y (rc.6) — onMutated post-toggle refresh callback.
//   The `onMutated` callback exists because @paperclipai/plugin-sdk@2026.512.0
//   has NO manifest-side `actions[].invalidates` declaration — verified by
//   reading dist/types.d.ts (PaperclipPluginManifestV1 has no `actions:`
//   field) and grepping the SDK type tree (zero `invalidat*` occurrences).
//   Data invalidation is a UI-side concern via `PluginDataResult.refresh()`
//   returned from `usePluginData`. ReaderViewReady threads its two
//   `refresh` handles (issue.reader + reader.ac.autostatus) down as an
//   `onMutated` callback that this component fires ONLY when the
//   `usePluginAction('ac-toggle')` promise resolves to `{ok:true}` — a
//   worker-side validation failure (`{ok:false, error:'invalid_id'}`)
//   must NOT trigger an unnecessary refetch.

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

/**
 * Plan 05-03 A4 — copy the exact marker string the scanner expects. Tries
 * navigator.clipboard.writeText first (modern, async); falls back to a
 * transient textarea + execCommand('copy') for older / restricted contexts.
 * Returns true on a clean copy. No throws — failure is silent (the button
 * just doesn't flash on success).
 */
async function copyMarkerToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') === true;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function AcChecklist({
  issueId,
  items,
  userId,
  autoStatus,
  onMutated,
}: {
  issueId: string;
  items: AcItem[] | undefined;
  userId?: string | null;
  // Plan 05-03 — optional so every existing call site that did not pass it
  // (the loading branch, the legacy test harness, prior cached payloads) keeps
  // compiling unchanged. `null` means "no auto-status data" (loading or
  // degraded); a non-null map drives per-row indicators.
  autoStatus?: AcAutoStatusMap | null;
  // Quick fix 260524-s2y (rc.6) — fired ONLY when the worker handler resolves
  // with `{ok:true}`. Optional so existing call sites + tests that do not
  // pass it continue to compile + render unchanged (toggle still calls the
  // worker, just no refetch). See header comment for SDK-gap rationale.
  onMutated?: () => void;
}): React.ReactElement {
  const toggleAc = usePluginAction('ac-toggle');
  // A4 — track which row was just copied so the button can flash a brief
  // "✓ copied" confirmation. Keyed by AcItem.id so multiple rows can each
  // hold their own transient flash without conflict.
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
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
                      // Quick fix 260524-s2y (rc.6) — gate the post-toggle
                      // refresh on the worker's discriminated `{ok:true}`
                      // shape. `usePluginAction` is typed `Promise<unknown>`
                      // (the SDK does not narrow action return shapes), so
                      // the runtime cast is the single-point-of-truth gate.
                      // The `?.ok === true` check refuses to call onMutated
                      // on `{ok:false, error:'invalid_id'}` — a worker-side
                      // validation failure must NOT cause a refetch.
                      void toggleAc({ id: it.id, checked: e.target.checked, userId: userId ?? null }).then((res) => {
                        if ((res as { ok?: boolean } | null | undefined)?.ok === true) {
                          onMutated?.();
                        }
                      });
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
                {/* Plan 05-03 A4 — copy the exact marker string the scanner
                    expects. Reduces operator discipline cost A1 introduced. */}
                <button
                  type="button"
                  className="clarity-ac-copy-marker"
                  data-clarity-region="ac-copy-marker"
                  data-ac-id={String(it.id)}
                  aria-label={`Copy AC marker for: ${it.label}`}
                  title={`Copy "AC: ${String(it.id)}: ✓" to clipboard`}
                  onClick={() => {
                    const marker = `AC: ${String(it.id)}: ✓`;
                    void copyMarkerToClipboard(marker).then((ok) => {
                      if (!ok) return;
                      setCopiedId(it.id);
                      setTimeout(() => {
                        setCopiedId((prev) => (prev === it.id ? null : prev));
                      }, 1500);
                    });
                  }}
                >
                  {copiedId === it.id ? '✓ copied' : 'Copy marker'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
