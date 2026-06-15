// src/ui/surfaces/bulletin/action-inbox.tsx
//
// Plan 03-03 — BULL-03 "Requires Your Decision" card grid. Mirrors
// situation-room/awaiting-you-pill.tsx (useHostNavigation) + agent-card.tsx.
//
// Each card has Approve / Open / Decline affordances:
//   - Approve / Decline → usePluginAction bridge calls (worker handlers
//     re-verify ownership before mutating — T-03-16).
//   - Open → useHostNavigation().linkProps SPA navigation (SCAF-09 — never a
//     raw <a href>).
//
// Visual contract: sketches/paperclip-fix-bulletin.html ll. 249-288.

import * as React from 'react';
import { usePluginAction, useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';
import type { ActionInboxCard } from '../../../shared/types.ts';
import { rescrubPersisted } from '../../../shared/scrub-human-action.ts';

/** Phase 19 Plan 19-03 (CARD-02 / D-09) — coarse estimate bucket → display words.
 *  Mirrors situation-room/employee-row.tsx:estBucketLabel EXACTLY. Anything else
 *  → null so the await line OMITS the estimate (never a fabricated number). */
function estBucketLabel(bucket: string | null | undefined): string | null {
  switch (bucket) {
    case 'quick':
      return 'quick decision';
    case 'focused':
      return '~30-min review';
    case 'deep':
      return 'deep work';
    default:
      return null;
  }
}

export type ActionInboxProps = {
  cards: ActionInboxCard[];
  companyId: string;
  userId: string;
  onCardActionComplete?: () => void;
};

export function ActionInbox(props: ActionInboxProps): React.ReactElement | null {
  if (!props.cards || props.cards.length === 0) return null;
  const oldestAge = props.cards.reduce((m, c) => Math.max(m, c.ageMs), 0);
  return (
    <section
      className="clarity-bulletin-action-inbox"
      data-clarity-region="action-inbox"
      aria-label="Items requiring your decision"
    >
      <div className="clarity-bulletin-action-head">
        <h2 className="clarity-bulletin-action-head-h2">Requires Your Decision</h2>
        <div className="clarity-bulletin-action-count">
          {String(props.cards.length).padStart(2, '0')} ITEMS · OLDEST {formatOldest(oldestAge)}
        </div>
      </div>
      <div className="clarity-bulletin-action-grid">
        {props.cards.map((card) => (
          <ActionInboxCardView
            key={card.issueId}
            card={card}
            companyId={props.companyId}
            userId={props.userId}
            onActionComplete={props.onCardActionComplete}
          />
        ))}
      </div>
    </section>
  );
}

function ActionInboxCardView({
  card,
  companyId,
  userId,
  onActionComplete,
}: {
  card: ActionInboxCard;
  companyId: string;
  userId: string;
  onActionComplete?: () => void;
}): React.ReactElement {
  const approve = usePluginAction('bulletin.action.approve');
  const decline = usePluginAction('bulletin.action.decline');
  const nav = useHostNavigation();
  const [busy, setBusy] = React.useState(false);
  const issueUrl = `/issues/${card.identifier}`;

  const handleApprove = React.useCallback(async () => {
    setBusy(true);
    try {
      await approve({ issueId: card.issueId, companyId, userId });
      onActionComplete?.();
    } finally {
      setBusy(false);
    }
  }, [approve, card.issueId, companyId, userId, onActionComplete]);

  const handleDecline = React.useCallback(async () => {
    setBusy(true);
    try {
      await decline({ issueId: card.issueId, companyId, userId });
      onActionComplete?.();
    } finally {
      setBusy(false);
    }
  }, [decline, card.issueId, companyId, userId, onActionComplete]);

  return (
    <article className="clarity-bulletin-action-card">
      <div className="clarity-bulletin-action-meta">
        <span className="clarity-bulletin-dept-tag">{card.department}</span>
        <span className="clarity-bulletin-action-time">{card.ageText}</span>
      </div>
      <h3 className="clarity-bulletin-action-card-h3">{card.title}</h3>
      {/* Phase 19 Plan 19-03 (CARD-02 / D-09) — when a FRESH cached Editor action
          card is attached (card.actionCard, read-only by bulletin.byCycle), render
          the named-action prose + "waiting on <party> · <estimate>" line IN PLACE
          OF the deterministic summary floor. When null (stale / absent / flag OFF)
          fall through to the existing card.summary line exactly as today (D-09
          degrade-safe). Every display string is rescrubbed at render and is a
          plain React text node; sourceIssueUuid is not on the mirror, so it can
          never render (NO_UUID_LEAK, D-10). Mirrors employee-row.tsx:374-404. */}
      {(() => {
        const ac = card.actionCard;
        const estWords = ac ? estBucketLabel(ac.estBucket) : null;
        return ac ? (
          <div className="clarity-bulletin-summary clarity-bulletin-action-named">
            <p className="clarity-bulletin-named-action">{rescrubPersisted(ac.namedAction)}</p>
            <p className="clarity-bulletin-await">
              {`waiting on ${rescrubPersisted(ac.awaitedParty)}${estWords ? ` · ${estWords}` : ''}`}
            </p>
          </div>
        ) : (
          <p className="clarity-bulletin-summary">{card.summary}</p>
        );
      })()}
      <div className="clarity-bulletin-actions">
        <button
          type="button"
          className="clarity-bulletin-btn"
          onClick={handleApprove}
          disabled={busy}
        >
          Approve
        </button>
        <a className="clarity-bulletin-btn clarity-bulletin-btn-secondary" {...nav.linkProps(issueUrl)}>
          Open
        </a>
        <button
          type="button"
          className="clarity-bulletin-btn clarity-bulletin-btn-ghost"
          onClick={handleDecline}
          disabled={busy}
        >
          Decline
        </button>
      </div>
    </article>
  );
}

function formatOldest(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
