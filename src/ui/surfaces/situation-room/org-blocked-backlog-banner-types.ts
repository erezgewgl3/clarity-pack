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

export type OrgBlockedRow = {
  issueId: string;
  identifier: string;
  title: string;
  humanAction: string;
  terminalKind: string;
  ownerName: string | null;
  ownerAgentId: string | null;
  age_ms: number | null;
};

export type OrgBlockedBacklog = {
  rows: OrgBlockedRow[];
  total: number;
  blocked_count: number;
  need_you_count: number;
  overflow: boolean;
};
