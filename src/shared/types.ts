// src/shared/types.ts
//
// Canonical type contracts shared between the worker and the UI bundle. This is
// the "interfaces" block from 02-02-PLAN.md verbatim — no deviation.
// Consumers: src/worker/handlers/* (worker side) + src/ui/primitives/* + src/ui/surfaces/* (UI side).

export type RefCardData = {
  id: string; // e.g. "BEAAA-141"
  title: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'unknown';
  ownerUserId: string | null;
  excerpt: string | null; // null = viewer lacks permission (PRIM-02)
  url: string; // host route; opened via useHostNavigation, never raw <a>
};

export type Terminal =
  | { kind: 'HUMAN_ACTION_ON'; userId: string; label: string } // PRIM-05
  | { kind: 'SELF_RESOLVING'; etaIso: string; label: string }
  | { kind: 'EXTERNAL'; label: string }
  | { kind: 'CYCLE'; cycleNodes: string[]; label: string }; // PRIM-04

export type BlockerChainResult = {
  startId: string;
  pathIds: string[]; // BEAAA ids from start to terminal (inclusive)
  terminal: Terminal; // exactly one
  isStale: boolean; // computed against a max-age threshold
};

export type TLDR = {
  surface: 'issue' | 'situation' | 'bulletin';
  scopeId: string; // issueId, "global", or "bulletin-YYYY-MM-DD"
  contentHash: string; // deterministic — used for EDITOR-03 idempotency
  body: string; // plain text
  generatedAt: string; // ISO
  sourceRevisions: string[]; // EDITOR-04 self-loop filter input
  compiledByAgentId: string; // governance parity audit field
};

export type OptInPrefs = {
  userId: string;
  optedInAt: string | null; // null = opted-OUT (OPTIN-01 absence-of-row semantics)
  defaultLanding: 'classic' | 'clarity';
};

// ---------------------------------------------------------------------------
// Phase 3 — Daily Bulletin type contracts (Plan 03-01 ships the shapes;
// Plans 03-02/03-03/03-04 implement against them). These are TYPE-ONLY
// exports — no runtime code.
// ---------------------------------------------------------------------------

/** Display format for a numeric slot. */
export type NumberFormat = 'currency' | 'count' | 'pct' | 'ratio';

/**
 * Facts table — the pure-code pre-render step (D-14). Every numeric claim the
 * LLM may reference in prose is keyed here with the SQL that produced it, so
 * pass-2 can re-run the query and verify.
 */
export type FactsTable = Record<
  string,
  { sql: string; params: unknown[]; value: number | string; format: NumberFormat }
>;

/** A Standing-Numbers slot definition — the SQL contract before execution. */
export type StandingNumberSlot = {
  key: string;
  sql: string;
  params: unknown[];
  format: NumberFormat;
  displayName: string;
};

/** A computed Standing-Numbers row — what the right rail renders. */
export type StandingNumberRow = {
  key: string;
  displayName: string;
  value: number;
  format: NumberFormat;
};

/** One card in the "Requires Your Decision" inbox (D-19). */
export type ActionInboxCard = {
  issueId: string;
  identifier: string;
  title: string;
  department: string;
  ageMs: number;
  ageText: string;
  summary: string;
};

/** A lineage thread — the agent-handoff DAG approximated for one cycle (D-21). */
export type LineageThread = {
  id: string;
  entityId: string;
  nodes: Array<{ time: string; name: string; detail: string; isTerminal: boolean }>;
  truncatedCount: number;
};

/** Pass-1 structured draft (D-14). The verified version is persisted as draft_json. */
export type BulletinDraft = {
  masthead: {
    volume: string;
    number: number;
    weekday: string;
    dateText: string;
    prepareForName: string;
    cycleNumber: number;
  };
  actionInbox: ActionInboxCard[];
  departments: Array<{
    name: string;
    items: Array<{
      title: string;
      timeText: string;
      bylineHtml: string;
      lineageInline: string;
      note: string;
    }>;
    editorialSummary: string;
  }>;
  standingNumbers: StandingNumberRow[];
  lineageThreads: LineageThread[];
};

/** A published bulletin — the verified draft plus persistence metadata (D-16/D-17). */
export type BulletinPublished = BulletinDraft & {
  cycleNumber: number;
  publishedIssueId: string;
  publishedAt: string;
};

/** Pass-2 deterministic verifier result (D-15). */
export type VerifierResult =
  | { ok: true }
  | {
      ok: false;
      mismatches: Array<{
        slot: string;
        claimed: unknown;
        actual: unknown;
        tolerance: number;
      }>;
    }
  | { ok: false; kind: 'UNKNOWN_SLOT'; slot: string };

/** A first-class erratum entry (D-18). */
export type ErratumEntry = {
  id: number;
  bulletinCycleNumber: number;
  addedAt: string;
  addedByUserId: string;
  bodyMd: string;
};

/** Failed-compile banner state machine (D-22). */
export type CompileFailureStatus =
  | { kind: 'ok' }
  | {
      kind: 'failed';
      attemptAt: string;
      nextRetryAt: string;
      reason: string;
      attemptN: number;
    };
