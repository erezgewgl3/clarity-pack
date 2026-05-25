// src/ui/surfaces/reader/deliverable-preview.tsx
//
// Plan 05-04 Task 2 (DIST-04) -- UI dispatcher for the "The deliverable"
// section. REPLACES the locked Plan 02-03 "Phase 5 (DIST-04)" placeholder
// (the literal "Phase 5" was pinned by reader-view.test.mjs; this commit
// removes it atomically with the test update per D-24).
//
// The dispatcher consumes the worker handler `deliverable.preview` (Task 1)
// and switches on `data.kind` to mount one of four real previewers + a
// placeholder fallback + a graceful error fallback:
//
//   xlsx-grid   -> inline <table> per sheet
//   pdf-embed   -> native <embed type="application/pdf">
//   md          -> react-markdown (no rehypeRaw -> no raw HTML injection)
//   img         -> lazy <img alt={filename}>
//   placeholder -> "Preview not available for this file type"
//   error       -> "Preview unavailable -- open in classic Paperclip."
//
// Threat-model anchors (T-05-04-05 + a11y):
//   - react-markdown defaults: rehypeRaw NOT enabled -> no raw HTML injection.
//   - check-a11y R1: <img> carries alt={filename}.
//   - check-a11y R3: no dangerouslySetInnerHTML in this file.
//
// Plan 02-03's load-bearing visual context (filename + last-write timestamp)
// is preserved -- the existing `ago()` helper stays.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';
import ReactMarkdown from 'react-markdown';

export type DeliverableProps = {
  // last_write_at is `string | null` because the actual SDK
  // IssueDocumentSummary doesn't always carry an updatedAt; the handler maps
  // it best-effort and may emit null (Plan 02-03b §3).
  deliverable: { filename: string; last_write_at: string | null } | null | undefined;
  // Plan 05-04 -- Reader threads these in so the worker handler can resolve
  // the document. When any is missing we pass null params (skip-fetch) so the
  // placeholder still renders sensibly during boot races (mirror the
  // useResolvedUserId skip-fetch idiom from Plan 02-09).
  companyId?: string | null;
  userId?: string | null;
  issueId?: string | null;
};

// Local mirror of the worker's DeliverablePreviewResult. UI/worker stay
// structurally typed across the JSON-RPC boundary; we don't import the
// worker module from the UI bundle.
type DeliverablePreviewResult =
  | { kind: 'xlsx-grid'; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: 'pdf-embed'; url: string }
  | { kind: 'md'; body: string }
  | { kind: 'img'; url: string }
  | { kind: 'placeholder'; reason: string }
  | { error: string; sizeBytes?: number };

function ago(iso: string | null): string {
  if (!iso) return 'time unknown';
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(then) || then > now) return '';
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? 'yesterday' : `${day}d ago`;
}

function XlsxGrid({
  sheets,
}: {
  sheets: Array<{ name: string; rows: string[][] }>;
}): React.ReactElement {
  return (
    <div className="clarity-deliverable-xlsx" data-clarity-region="deliverable-xlsx">
      {sheets.map((sheet) => (
        <section
          key={sheet.name}
          role="region"
          aria-label={sheet.name}
          className="clarity-deliverable-xlsx-sheet"
        >
          <h4>{sheet.name}</h4>
          <div className="clarity-deliverable-xlsx-scroll">
            <table>
              <tbody>
                {sheet.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{cell ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function DeliverablePreview({
  deliverable,
  companyId,
  userId,
  issueId,
}: DeliverableProps): React.ReactElement | null {
  if (!deliverable) return null;

  // Skip-fetch when any context piece is missing -- the placeholder still
  // renders the filename + last-write line so the operator sees something
  // useful while the resolver hooks bootstrap upstream. The SDK signature
  // is `Record<string, unknown> | undefined`; `undefined` is the documented
  // skip-fetch sentinel.
  const ready = Boolean(companyId && userId && issueId);
  const params: Record<string, unknown> | undefined = ready
    ? { companyId, userId, issueId, documentKey: deliverable.filename }
    : undefined;
  const { data, loading } = usePluginData<DeliverablePreviewResult>(
    'deliverable.preview',
    params,
  );

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <div className="clarity-deliverable-placeholder">
        Awaiting viewer context…
      </div>
    );
  } else if (loading || !data) {
    body = (
      <div className="clarity-deliverable-loading">Loading preview…</div>
    );
  } else if ('error' in data) {
    body = (
      <div className="clarity-deliverable-fallback">
        Preview unavailable — open in classic Paperclip.
      </div>
    );
  } else {
    switch (data.kind) {
      case 'xlsx-grid':
        body = <XlsxGrid sheets={data.sheets} />;
        break;
      case 'pdf-embed':
        body = (
          <embed
            type="application/pdf"
            src={data.url}
            title={deliverable.filename}
            style={{ width: '100%', height: '60vh' }}
          />
        );
        break;
      case 'md':
        // react-markdown v9 default-export usage. rehypeRaw NOT enabled --
        // raw HTML in the markdown body is rendered as text, never injected
        // (T-05-04-05 mitigation). Honors check-a11y R3.
        body = <ReactMarkdown>{data.body}</ReactMarkdown>;
        break;
      case 'img':
        body = (
          <img
            src={data.url}
            alt={deliverable.filename}
            loading="lazy"
            style={{ maxWidth: '100%' }}
          />
        );
        break;
      case 'placeholder':
        body = (
          <div className="clarity-deliverable-placeholder">{data.reason}</div>
        );
        break;
      default: {
        // Exhaustiveness check: if a new kind is added to the worker, the
        // compiler will flag this branch.
        const _exhaustive: never = data;
        void _exhaustive;
        body = (
          <div className="clarity-deliverable-fallback">
            Preview unavailable — open in classic Paperclip.
          </div>
        );
      }
    }
  }

  return (
    <section className="clarity-deliverable" data-clarity-region="deliverable">
      <h3>The deliverable</h3>
      <p>
        {deliverable.filename} · last write {ago(deliverable.last_write_at)}
      </p>
      {body}
    </section>
  );
}
