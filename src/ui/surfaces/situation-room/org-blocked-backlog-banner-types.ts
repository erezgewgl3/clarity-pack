// src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
//
// Plan 09-02 (R6) — the org-blocked-backlog row/payload TYPES, extracted from
// the deleted org-blocked-backlog-banner.tsx so the new BlockedBacklogExpander
// (which merges org-backlog + critical-path into one drill-down) and index.tsx
// can keep consuming the worker's OrgBlockedBacklog shape without importing the
// deleted banner component.
//
// Mirror of the worker builder's OrgBlockedRow (src/worker/handlers/
// org-blocked-backlog.ts). Kept structural here so the UI bundle does not
// import worker types.

import type { Terminal, BlockerChainResult } from '../../../shared/types.ts';

export type OrgBlockedRow = {
  issueId: string;
  identifier: string;
  title: string;
  humanAction: string;
  // Plan 11-04 (D-05/SC1) — the 8-kind honest taxonomy union, sourced from the
  // shared Terminal type so a 9th kind is a compile error here too. Was a bare
  // `string` (which silently accepted the legacy 4-kind set).
  terminalKind: Terminal['kind'];
  // Plan 12-03 Task 1 (NY-03 / D-09) — the engine verdict affordance mirrored
  // from the worker's OrgBlockedRow so the expander gates the OwnerPickerPopover
  // on `actionAffordance === 'assign'` (the SAME verdict every surface reads).
  // Typed off the shared union so a 6th affordance is a compile error in BOTH
  // the worker emit and this mirror.
  actionAffordance: BlockerChainResult['actionAffordance'];
  ownerName: string | null;
  ownerAgentId: string | null;
  age_ms: number | null;
  // Plan 14-04 Task 2 (BLOCKER 3 / D-02/D-08/D-10) — byte-parallel mirror of the
  // worker's five new OrgBlockedRow fields, so <ReplyInPlace> (14-03) has
  // everything it needs on the backlog surface. A field missing on either side is
  // a compile error at the consumer (T-14-21).
  /** Plan 14-04 — the scrubbed awaited-party DISPLAY string; no raw UUID. */
  awaitedPartyLabel: string;
  /** Plan 14-04 — the awaited AGENT UUID for the reply/nudge mutation;
   *  DISPATCH-ONLY, NEVER rendered (NO_UUID_LEAK). */
  targetAgentUuid: string | null;
  /** Plan 14-04 — conservative-binary chips (Phase 13 D-08); null on the org
   *  backlog this phase (no action card). */
  decisionOptions: string[] | null;
  /** Plan 14-04 — the LEAF issue UUID (the mutation id), DISTINCT from issueId
   *  (the root). DISPATCH-ONLY, NEVER rendered (NO_UUID_LEAK). */
  leafIssueUuid: string | null;
  /** Plan 14-04 — the Shape-B durable-flip signal (leaf node status==='blocked');
   *  passed to <ReplyInPlace>, NEVER rendered. */
  needsDurabilityFlip: boolean;
};

export type OrgBlockedBacklog = {
  rows: OrgBlockedRow[];
  total: number;
  blocked_count: number;
  need_you_count: number;
  overflow: boolean;
};
