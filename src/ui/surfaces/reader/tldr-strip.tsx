// src/ui/surfaces/reader/tldr-strip.tsx
//
// Plan 02-03 Task 2 — READER-02 TL;DR strip. Renders the TL;DR body + a
// freshness stamp ("Regenerated when the task body changes • Generated
// YYYY-MM-DD HH:MM"). When tldr is null (cache miss on first visit), shows
// "Compiling TL;DR…" so the Reader never crashes pre-compile.

import * as React from 'react';

import type { TLDR } from '../../../shared/types.ts';

export type TldrStripProps = {
  tldr: TLDR | { body: string; generated_at?: string; generatedAt?: string } | null | undefined;
};

function formatStamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DD HH:MM
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TldrStrip({ tldr }: TldrStripProps): React.ReactElement {
  if (!tldr || !tldr.body) {
    return (
      <section className="clarity-tldr-strip clarity-tldr-strip--loading" data-clarity-region="tldr">
        Compiling TL;DR…
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
      <p className="clarity-tldr-stamp">
        Regenerated when the task body changes • Generated {stamp}
      </p>
    </section>
  );
}
