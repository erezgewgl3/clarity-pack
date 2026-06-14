// src/ui/surfaces/bulletin/department-section.tsx
//
// Plan 03-03 — BULL-04 department section. Mirrors situation-room/agent-card.tsx
// (normalizer helpers + per-row render).
//
// Renders: a section header (artifact count meta), an editorial-prose summary,
// item rows with a dotted-rule between them (sketch ll. 122-125), and the
// per-item inline lineage string + note. The FIRST department on the page gets
// a drop-cap on the editorial prose (sketch ll. 159-163). An empty department
// renders the quiet-day prose (sketch ll. 151-156).

import * as React from 'react';

import { rescrubPersisted } from '../../../shared/scrub-human-action.ts';

export type DepartmentItem = {
  title: string;
  timeText: string;
  bylineHtml: string;
  lineageInline: string;
  note: string;
};

export type DepartmentSectionProps = {
  name: string;
  items: DepartmentItem[];
  editorialSummary: string;
  /** First department on the page gets the drop-cap treatment. */
  isFirst?: boolean;
};

export function DepartmentSection(props: DepartmentSectionProps): React.ReactElement {
  const items = props.items ?? [];
  const isEmpty = items.length === 0;
  // Plan 18-02 (LEG-02e) — read-time re-scrub over the already-fetched editorial
  // prose (the Editor-Agent's persisted bulletin body, e.g. tldr/narrative text
  // that may HISTORICALLY embed a partial hash or bare UUID). Pure regex over an
  // in-memory string — ZERO new DB fetches; idempotent over already-clean prose.
  const editorialSummary = rescrubPersisted(props.editorialSummary ?? '');
  return (
    <section className="clarity-bulletin-department-section" data-clarity-region="department">
      <header className="clarity-bulletin-ops-head">
        <h2 className="clarity-bulletin-ops-head-h2">{props.name}</h2>
        <span className="clarity-bulletin-ops-meta">
          {String(items.length).padStart(2, '0')} {items.length === 1 ? 'artifact' : 'artifacts'}
        </span>
      </header>

      {isEmpty ? (
        <div className="clarity-bulletin-quiet">
          {editorialSummary?.trim()
            ? editorialSummary
            : 'Quiet day. No founder action required.'}
        </div>
      ) : (
        <>
          {editorialSummary?.trim() ? (
            <p
              className={
                props.isFirst
                  ? 'clarity-bulletin-editorial clarity-bulletin-dropcap'
                  : 'clarity-bulletin-editorial'
              }
            >
              {editorialSummary}
            </p>
          ) : null}
          {items.map((item, i) => (
            <DepartmentItemRow key={`${props.name}-${i}`} item={item} />
          ))}
        </>
      )}
    </section>
  );
}

function DepartmentItemRow({ item }: { item: DepartmentItem }): React.ReactElement {
  return (
    <div className="clarity-bulletin-item">
      <h3 className="clarity-bulletin-item-title">{item.title}</h3>
      <span className="clarity-bulletin-item-ts">{item.timeText}</span>
      {item.bylineHtml ? (
        <div className="clarity-bulletin-item-by">{item.bylineHtml}</div>
      ) : null}
      {item.lineageInline ? (
        <div className="clarity-bulletin-item-lineage">{item.lineageInline}</div>
      ) : null}
      {item.note ? <div className="clarity-bulletin-item-note">{item.note}</div> : null}
    </div>
  );
}
