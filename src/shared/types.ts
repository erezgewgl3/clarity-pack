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
  // Plan 05-05 Task 2 (D-09) — optional fields the ref-chip hover peek
  // consumes. Optional so pre-05-05 cached payloads + the unknown-fallback
  // placeholder (resolve-refs.ts line ~75) still type-check; new consumers
  // tolerate undefined gracefully.
  /** Plan 05-05 D-09 — first line of issue body, truncated to 120 chars with
   *  ellipsis when truncated. Null when viewer cannot read (PRIM-02 gate
   *  inherited from the legacy excerpt field). */
  descriptionExcerpt?: string | null;
  /** Plan 05-05 D-09 — owner display name resolved via ctx.agents.get
   *  server-side. Null when ownerUserId is null OR when the lookup degraded.
   *  UI fallback is the literal 'unassigned' — NEVER the UUID. */
  ownerName?: string | null;
  /** Plan 250530 v1.1.5 — when true, the Reader's RefChip degrades to a plain
   *  text id (no chip border, no status badge, no clickable anchor). Set by
   *  resolve-refs when the resolved issue's originKind starts with
   *  `plugin:clarity-pack:operation:` — i.e. an internal Editor-Agent
   *  compile-tracking / sign-off issue whose computer-generated title (often
   *  UUID-bearing) is meaningless to the operator and would pollute the TL;DR
   *  with bookkeeping noise. The PARSER still emits a `ref` span; the CHIP
   *  hides itself. Optional + defaulting to false preserves byte-compat for
   *  every other ref. */
  hiddenAsRef?: boolean;
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
  // Plan 07-05 (Phase 7 ITEM 5) — ADDITIVE/optional read-time enrichment fields.
  // Pre-05 persisted draft_json rows lack these and still type-check (all optional).
  /** The Editor-Agent one-line plain-English gloss ("what this means for you").
   *  null = no gloss available / compile pending (a graceful state, NOT an error). */
  gloss?: string | null;
  /** The issue's human identifier (e.g. "COU-42") for the open-issue affordance. */
  identifier?: string | null;
  /** The terminal actor's agent id for the open-chat affordance — carried ONLY as
   *  the chat-deep-link target, NEVER rendered as visible text (NO_UUID_LEAK). */
  ownerAgentId?: string | null;
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
  appliedToIssueCommentId: string | null;
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
