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
  //
  // Plan 05-11 (CHAT-07 gap closure) -- the optional `documentKey` field
  // overrides `filename` as the worker `documentKey` param. Chat-uploaded
  // attachments use this to dispatch against the canonical
  // chat-attach-<uuid>-<safefilename> key while the rendered filename stays
  // human-readable. The Reader's existing call site does NOT pass
  // documentKey so the fallback (`documentKey ?? filename`) preserves
  // back-compat byte-for-byte.
  deliverable:
    | {
        filename: string;
        last_write_at: string | null;
        documentKey?: string;
      }
    | null
    | undefined;
  // Plan 05-04 -- Reader threads these in so the worker handler can resolve
  // the document. When any is missing we pass null params (skip-fetch) so the
  // placeholder still renders sensibly during boot races (mirror the
  // useResolvedUserId skip-fetch idiom from Plan 02-09).
  companyId?: string | null;
  userId?: string | null;
  issueId?: string | null;
};

/**
 * Plan 05-11 (CHAT-07 gap closure) -- shape of one chat-attachment entry
 * returned by `chat.attachment.list`. Used inside DeliverablePreview to
 * detect chat-uploaded attachments and dispatch against the newest one
 * when the issue has no Reader-tracked deliverable.
 */
type ChatAttachmentListResult =
  | {
      kind: 'attachments';
      topicIssueId: string;
      attachments: Array<{
        id: string;
        documentKey: string;
        mimeType: string;
        originalFilename: string;
        byteSize: number;
        createdAt: string;
      }>;
    }
  | { error: string }
  | null;

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
}: DeliverableProps): React.ReactElement {
  // Plan 05-11 (CHAT-07 gap closure 2026-05-26) -- 3-branch empty-state
  // refinement. The 38e6ffa fix (GAP-DIST-04-NOT-RENDERING) made the
  // section header render unconditionally with an explicit empty-state
  // message. Plan 05-11 ADDS: when chat-uploaded attachments exist on the
  // SAME issue (uploaded via the chat composer to ctx.issues.documents.
  // upsert), the previewer dispatches against the NEWEST chat attachment
  // as the de-facto deliverable. The U9 anti-pattern guard
  // (no `if (!deliverable) return null`) is preserved; the U10 literal-
  // copy lock is updated in the SAME commit that adds the 3-branch
  // logic.
  //
  // React hooks rule: hook calls must run unconditionally at the top of
  // the function -- so the parallel chat.attachment.list fetch happens
  // BEFORE any branch.
  const chatAttachReady = Boolean(companyId && userId && issueId);
  const chatAttachParams: Record<string, unknown> | undefined = chatAttachReady
    ? { topicIssueId: issueId, companyId, userId, limit: 1 }
    : undefined;
  const { data: chatAttachData } = usePluginData<ChatAttachmentListResult>(
    'chat.attachment.list',
    chatAttachParams,
  );
  const newestChatAttach =
    chatAttachData &&
    typeof chatAttachData === 'object' &&
    'kind' in chatAttachData &&
    chatAttachData.kind === 'attachments' &&
    chatAttachData.attachments.length > 0
      ? chatAttachData.attachments[0]
      : null;

  // Branch (c): no plugin-tracked deliverable AND no chat attachments
  // -> updated empty-state copy (U10 literal-lock REPLACED in this same
  // commit). U9 anti-pattern guard preserved (section header still
  // renders unconditionally; we do NOT `return null`).
  if (!deliverable && !newestChatAttach) {
    return (
      <section className="clarity-deliverable" data-clarity-region="deliverable">
        <h3>The deliverable</h3>
        <div
          className="clarity-deliverable-fallback"
          data-clarity-deliverable-state="empty"
        >
          No deliverables on this issue yet. Upload via the chat composer
          (Clarity &rarr; Chat tab).
        </div>
      </section>
    );
  }

  // Branch (b): chat attachment exists; treat the newest one as the
  // de-facto deliverable when no plugin-tracked deliverable is set. The
  // dispatcher fires through the SAME Plan 05-04 DIST-04 worker handler
  // because the chat-attach-<uuid>-<safefilename> document_key lives in
  // the SAME plugin-owned issue_documents store the previewer already
  // reads.
  //
  // Branch (a) is the existing happy path: `deliverable` is populated;
  // we render filename + dispatch the worker. The Plan 05-11 contract
  // extension adds optional `documentKey` on DeliverableProps.deliverable
  // -- a chat-attachment caller passes documentKey verbatim so the worker
  // fires against the canonical key; the Reader caller does NOT pass it,
  // so the fallback `documentKey ?? filename` preserves back-compat
  // byte-for-byte.
  const effectiveDeliverable: {
    filename: string;
    last_write_at: string | null;
    documentKey?: string;
  } = deliverable
    ? deliverable
    : {
        filename: newestChatAttach!.originalFilename,
        last_write_at: newestChatAttach!.createdAt,
        documentKey: newestChatAttach!.documentKey,
      };
  const effectiveDocumentKey =
    effectiveDeliverable.documentKey ?? effectiveDeliverable.filename;

  // Skip-fetch when any context piece is missing -- the placeholder still
  // renders the filename + last-write line so the operator sees something
  // useful while the resolver hooks bootstrap upstream. The SDK signature
  // is `Record<string, unknown> | undefined`; `undefined` is the documented
  // skip-fetch sentinel.
  const ready = Boolean(companyId && userId && issueId);
  const params: Record<string, unknown> | undefined = ready
    ? {
        companyId,
        userId,
        issueId,
        documentKey: effectiveDocumentKey,
      }
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
            title={effectiveDeliverable.filename}
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
            alt={effectiveDeliverable.filename}
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
        {effectiveDeliverable.filename} · last write{' '}
        {ago(effectiveDeliverable.last_write_at)}
      </p>
      {body}
    </section>
  );
}
