// src/shared/bulletin-rendering.ts
//
// Plan 03-02 — Pure markdown rendering of a BulletinDraft into the canonical
// body stored in public.issues.description (D-16). The bulletin UI surface
// (Plan 03-03) renders the same draft via React; this markdown is the
// classic-Paperclip-searchable body that survives a plugin disable.
//
// Pure function — no `ctx`, no I/O. Emits plain markdown only (no HTML); any
// HTML in a draft's bylineHtml field is stripped so the issue body stays
// markdown-clean.

import type {
  BulletinDraft,
  StandingNumberRow,
} from './types.ts';

/** Format a standing-number value per its declared NumberFormat. */
function formatStandingValue(sn: StandingNumberRow): string {
  switch (sn.format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(sn.value);
    case 'pct':
      return `${(sn.value * 100).toFixed(1)}%`;
    case 'count':
      return new Intl.NumberFormat('en-US').format(sn.value);
    case 'ratio':
      return String(sn.value);
    default:
      return String(sn.value);
  }
}

/** Strip any HTML tags — the issue body is markdown, never HTML. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/**
 * Render a verified BulletinDraft into the canonical markdown issue body.
 * Sections: masthead → action inbox → department operations → standing
 * numbers → lineage thread.
 */
export function renderBulletinIssueBody(draft: BulletinDraft): string {
  const parts: string[] = [];

  // ----- Masthead -----
  const m = draft.masthead;
  parts.push(`# The Bulletin · Vol. ${m.volume} · No. ${m.number}`);
  parts.push('');
  parts.push(
    `*${m.weekday}, ${m.dateText} · 06:30 ET · prepared for ${m.prepareForName}, Editor-in-Chief · Operations Cycle ${m.cycleNumber} · Auto-compiled*`,
  );
  parts.push('');

  // ----- Action Inbox -----
  if (draft.actionInbox.length > 0) {
    parts.push('## Requires Your Decision');
    parts.push('');
    for (const card of draft.actionInbox) {
      parts.push(`### ${card.title}`);
      parts.push(`*${card.department} · ${card.ageText}*`);
      parts.push('');
      parts.push(card.summary);
      parts.push('');
      parts.push('Actions: Approve · Open · Decline');
      parts.push('');
    }
  }

  // ----- Department sections -----
  parts.push("## Yesterday's Operations");
  parts.push('');
  for (const dept of draft.departments) {
    parts.push(`### ${dept.name}`);
    parts.push('');
    if (dept.items.length === 0) {
      parts.push('*· no items ·*');
      parts.push('');
      continue;
    }
    if (dept.editorialSummary) {
      parts.push(dept.editorialSummary);
      parts.push('');
    }
    for (const item of dept.items) {
      parts.push(`- **${item.title}** — ${item.timeText}`);
      if (item.bylineHtml) parts.push(`  - ${stripHtml(item.bylineHtml)}`);
      if (item.lineageInline) parts.push(`  - Lineage: ${item.lineageInline}`);
      if (item.note) parts.push(`  - ${item.note}`);
    }
    parts.push('');
  }

  // ----- Standing Numbers -----
  parts.push('## Standing Numbers');
  parts.push('');
  for (const sn of draft.standingNumbers) {
    parts.push(`- **${sn.displayName}**: ${formatStandingValue(sn)}`);
  }
  parts.push('');

  // ----- Lineage Threads -----
  if (draft.lineageThreads.length > 0) {
    const featured = draft.lineageThreads[0];
    parts.push(`## One artifact, end-to-end — ${featured.entityId}`);
    parts.push('');
    featured.nodes.forEach((n, i) => {
      const arrow = i > 0 ? '→ ' : '';
      parts.push(
        `${i + 1}. ${arrow}**${n.name}** (${n.time}) — ${n.detail}${n.isTerminal ? ' [TERMINAL]' : ''}`,
      );
    });
    if (featured.truncatedCount > 0) {
      parts.push(`*…and ${featured.truncatedCount} more steps*`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
