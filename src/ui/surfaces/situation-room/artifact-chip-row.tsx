// src/ui/surfaces/situation-room/artifact-chip-row.tsx
//
// Plan 06.1-03 Task 1 (ROOM-10 UI tier) — per-agent inline artifact chip row.
//
// Replaces the Phase 2 bottom <ArtifactsShippedShelf /> (D-02 — DELETED in
// this same commit). Each AgentCard mounts a horizontal flex-wrap of
// <AttachmentChipWithPreview /> chips sourced from the Plan 06.1-02 worker
// handler `situation.artifacts`. Empty windows render NOTHING (no
// placeholder; no skeleton — D-02 + UI-SPEC §Copywriting Contract
// "ArtifactChipRow empty window").
//
// Chip click → DeliverablePreview popover via the canonical
// AttachmentChipWithPreview shell (D-11; Plan 05-11 hotfix-2). Single
// source of truth for chip+popover behaviour across Reader / Chat /
// Situation Room.
//
// > 5 chips: render the first 5 + a `+{N-5} more` mono-styled chip (D-10).
// Clicking the more-chip toggles a per-agent drawer that re-uses the
// same AttachmentChipWithPreview shell to render the remaining chips.
//
// SECURITY (T-04-18 / T-06.1-18): every visible string renders as React
// text. No dangerouslySetInnerHTML, no raw HTML. CSS scope is owned by
// theme.css under [data-clarity-surface='situation-room'] (SCAF-06).

import * as React from 'react';

import {
  AttachmentChipWithPreview,
  type AttachmentChipEntry,
} from '../chat/attachment-chip-with-preview.tsx';

/**
 * Shape of one entry in the worker's situation.artifacts payload
 * (Plan 06.1-02 SUMMARY §Return shape). The discriminator `kind`
 * distinguishes deliverables (sourceIssueId present) from
 * chat-attachments (topicIssueId present); for the popover anchor we
 * pass whichever issueId is present so DeliverablePreview can scope
 * its host-side document fetch correctly.
 */
export type Artifact = {
  id: string;
  kind: 'deliverable' | 'chat-attachment';
  documentKey: string;
  mimeType: string;
  originalFilename: string;
  byteSize: number;
  createdAt: string;
  topicIssueId?: string;
  sourceIssueId?: string;
};

const VISIBLE_CHIP_COUNT = 5;

/**
 * Convert an Artifact to the AttachmentChipEntry shape consumed by
 * AttachmentChipWithPreview. The two shapes are structurally identical
 * for the chip-displayed fields; we copy through the canonical subset.
 */
function toChipEntry(a: Artifact): AttachmentChipEntry {
  return {
    id: a.id,
    documentKey: a.documentKey,
    mimeType: a.mimeType,
    originalFilename: a.originalFilename,
    byteSize: a.byteSize,
    createdAt: a.createdAt,
  };
}

/**
 * Anchor issue id for the preview popover. Deliverables anchor on the
 * source issue (the agent's current_focus_issue_id); chat-attachments
 * anchor on the topic issue. Empty string for safety if neither is
 * present (the host's documents.list call short-circuits gracefully).
 */
function anchorIssueId(a: Artifact): string {
  return a.kind === 'chat-attachment'
    ? a.topicIssueId ?? a.sourceIssueId ?? ''
    : a.sourceIssueId ?? a.topicIssueId ?? '';
}

export function ArtifactChipRow({
  artifacts,
  companyId,
  userId,
}: {
  artifacts: Artifact[];
  /** Agent role name — surfaced only via aria-label for the drawer toggle. */
  agentRole?: string;
  companyId: string;
  userId: string;
}): React.ReactElement | null {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  if (!artifacts || artifacts.length === 0) {
    // D-02 + UI-SPEC §Edge Cases row 1 — empty windows render nothing.
    // A null return emits no DOM (no wrapper, no skeleton, no copy).
    return null;
  }

  const visible = artifacts.slice(0, VISIBLE_CHIP_COUNT);
  const overflow = Math.max(0, artifacts.length - VISIBLE_CHIP_COUNT);

  return (
    <div
      className="clarity-artifact-chip-row"
      data-testid="clarity-artifact-chip-row"
      data-clarity-region="artifact-chip-row"
    >
      {visible.map((a) => (
        <AttachmentChipWithPreview
          key={`artifact-${a.id}`}
          attachment={toChipEntry(a)}
          companyId={companyId}
          userId={userId}
          topicIssueId={anchorIssueId(a)}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          className="clarity-artifact-chip-row-more"
          onClick={() => setDrawerOpen((p) => !p)}
          aria-label={`Show ${overflow} more artifact${overflow === 1 ? '' : 's'}`}
          aria-expanded={drawerOpen}
        >
          {`+${overflow} more`}
        </button>
      ) : null}
      {drawerOpen && overflow > 0 ? (
        // Per-agent overflow drawer (D-10). Reuses AttachmentChipWithPreview
        // verbatim — no new popover shell. Each chip's own popover continues
        // to dismiss via Escape / backdrop click / close-X (Plan 05-11
        // hotfix-2 3-affordance contract).
        <div
          className="clarity-artifact-chip-row-drawer"
          data-clarity-region="artifact-chip-row-drawer"
        >
          {artifacts.slice(VISIBLE_CHIP_COUNT).map((a) => (
            <AttachmentChipWithPreview
              key={`artifact-drawer-${a.id}`}
              attachment={toChipEntry(a)}
              companyId={companyId}
              userId={userId}
              topicIssueId={anchorIssueId(a)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
