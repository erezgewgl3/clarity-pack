// src/ui/surfaces/reader/tldr-strip.tsx
//
// Plan 02-03 Task 2 — READER-02 TL;DR strip. Renders the TL;DR body + a
// freshness stamp ("Regenerated when the task body changes • Generated
// YYYY-MM-DD HH:MM").
//
// 2026-05-28 UX fix — the empty state previously showed "Compiling TL;DR…"
// whenever `tldr` was null. That was misleading: TL;DRs compile REACTIVELY
// (the Editor-Agent compiles one only when an issue is created / updated /
// commented — see src/worker/agents/editor.ts handleEditorHeartbeat), so a
// task that simply hasn't been touched since the pipeline came online has no
// TL;DR and none queued — yet the UI claimed it was actively "Compiling…"
// forever. Operator-reported confusion (BEAAA, 2026-05-28). The empty state
// now states the honest truth ("No TL;DR yet") and explains WHEN one appears,
// rather than asserting a compile that isn't running.

import * as React from 'react';

import type { TLDR } from '../../../shared/types.ts';

export type TldrStripProps = {
  tldr: TLDR | { body: string; generated_at?: string; generatedAt?: string } | null | undefined;
  /** View-driven rework — 'compiling' shows a live "Compiling…" state (the Reader
   *  polls for the result); 'paused' shows a resume-the-agent note; 'unavailable'
   *  shows the honest empty state. */
  status?: 'cached' | 'compiling' | 'paused' | 'unavailable';
  /** True when the TL;DR summarized a truncated (very long) task — shows a note. */
  truncated?: boolean;
};

function formatStamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DD HH:MM
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TldrStrip({ tldr, status, truncated }: TldrStripProps): React.ReactElement {
  if (!tldr || !tldr.body) {
    // View-driven rework — opening the Reader kicks off the compile. While it
    // runs, show a live "Compiling…" state (the Reader polls for the result);
    // 'unavailable' (no Editor-Agent) or an untouched task shows the honest
    // empty state.
    if (status === 'compiling') {
      return (
        <section
          className="clarity-tldr-strip clarity-tldr-strip--empty clarity-tldr-strip--compiling"
          data-clarity-region="tldr"
          data-clarity-tldr-status="compiling"
        >
          <p className="clarity-tldr-body">Compiling TL;DR…</p>
          <p className="clarity-tldr-stamp">
            The Editorial Desk is summarizing this task — it will appear here in a moment.
          </p>
        </section>
      );
    }
    if (status === 'paused') {
      return (
        <section
          className="clarity-tldr-strip clarity-tldr-strip--empty clarity-tldr-strip--paused"
          data-clarity-region="tldr"
          data-clarity-tldr-status="paused"
        >
          <p className="clarity-tldr-body">No TL;DR yet — the Editorial Desk is paused</p>
          <p className="clarity-tldr-stamp">
            Resume the Editorial Desk in the Agents panel and reopen this task to compile a TL;DR.
          </p>
        </section>
      );
    }
    return (
      <section className="clarity-tldr-strip clarity-tldr-strip--empty" data-clarity-region="tldr">
        <p className="clarity-tldr-body">No TL;DR yet</p>
        <p className="clarity-tldr-stamp">
          Compiled by the Editorial Desk when you open this task.
        </p>
      </section>
    );
  }
  // Handle both DB-row shape (generated_at) and SDK TLDR type (generatedAt).
  const stamp = formatStamp(
    (tldr as { generated_at?: string }).generated_at ?? (tldr as { generatedAt?: string }).generatedAt,
  );
  return (
    <section className="clarity-tldr-strip" data-clarity-region="tldr">
      <p className="clarity-tldr-body">{tldr.body}</p>
      {truncated ? (
        <p className="clarity-tldr-truncated-note" data-clarity-tldr-truncated="true">
          Summarized from a long task — some detail was trimmed to fit.
        </p>
      ) : null}
      <p className="clarity-tldr-stamp">
        Regenerated when the task body changes • Generated {stamp}
        {status === 'compiling' ? ' • refreshing…' : ''}
      </p>
    </section>
  );
}
