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

// Plan 11-01 (D-05) — the honest blocker taxonomy. The 4-variant union grew to
// exactly 8 kinds: 7 honest classifications + UNCLASSIFIED (the degrade kind).
// The legacy human-action variant was RENAMED to `AWAITING_HUMAN` with no dead
// alias kept — growing the union deliberately fails `tsc` at every downstream
// switch/string match, turning the compile errors into the live migration checklist.
export type Terminal =
  | { kind: 'AWAITING_HUMAN'; userId: string; label: string } // PRIM-05 (renamed from the legacy human-action variant)
  | { kind: 'AWAITING_AGENT_WORKING'; agentId: string; label: string } // Plan 11-01 — chain flattened through a live, progressing agent
  | { kind: 'AWAITING_AGENT_STUCK'; agentId: string; label: string } // Plan 11-01 — chain flattened through an idle/stale agent (Plan 12-01 D-05: assign target)
  | { kind: 'SELF_RESOLVING'; etaIso: string; label: string }
  | { kind: 'EXTERNAL'; label: string }
  | { kind: 'CYCLE'; cycleNodes: string[]; label: string } // PRIM-04
  | { kind: 'UNOWNED'; label: string } // Plan 11-01 (D-11) — genuinely no owner; NO userId. Replaces the unowned-sentinel fallback lie.
  | { kind: 'UNCLASSIFIED'; label: string }; // Plan 11-01 (D-10/D-12) — honest degrade kind when the walk cannot determine the blocker

export type BlockerChainResult = {
  startId: string;
  pathIds: string[]; // BEAAA ids from start to terminal (inclusive)
  terminal: Terminal; // exactly one
  isStale: boolean; // computed against a max-age threshold
  // Plan 11-01 (D-13) — the structured verdict every surface reads instead of
  // re-deriving from terminal.kind or string-matching ownerName.
  /** Plan 11-01 (D-13) — true only when a *person* must act (AWAITING_HUMAN / UNOWNED). */
  needsYou: boolean;
  /** Plan 11-01 (D-13) — which cockpit segment this chain belongs to. */
  tier: 'needs-you' | 'in-motion' | 'watch';
  /** Plan 11-01 (D-13) — the single control the row offers. 'assign' appears on
   *  genuinely-unowned rows (UNOWNED) AND stuck-agent rows (AWAITING_AGENT_STUCK)
   *  per Plan 12-01 (D-05) — re-owning the issue is the honest answer for both.
   *  'nudge' is retained but dormant (D-06); it is reserved for the Phase 14
   *  reply/nudge loop and has no current consumer. */
  actionAffordance: 'reply' | 'nudge' | 'assign' | 'open' | 'none';
  /** Plan 11-01 (D-10) — set only when terminal === UNCLASSIFIED; explains the degrade
   *  (e.g. 'max-depth-exceeded'). Optional so the 7 honest kinds omit it. */
  degradeReason?: string;
  /** Plan 11-01 (D-15) — the ONLY display string for the awaited party; scrubbed in
   *  scrub-human-action.ts to contain zero raw UUIDs for all 8 kinds. */
  awaitedPartyLabel: string;
  /** Plan 11-01 (D-15) — the awaited agent's UUID for the nudge/reply mutation, carried
   *  ONLY as the dispatch target, NEVER rendered as visible text (NO_UUID_LEAK). */
  targetAgentUuid?: string | null;
  /** Plan 11-01 (D-15) — the leaf issue's UUID for the open/assign mutation, carried
   *  ONLY as the dispatch target, NEVER rendered as visible text (NO_UUID_LEAK). */
  targetIssueUuid?: string | null;
  // Phase 19 Plan 19-03 (CARD-02 / D-09) — the Editor-Agent named-action card for
  // this chain's leaf, attached by flatten-blocker-chain ONLY when the runtime
  // flag is ON and a FRESH cached card exists (read-cached-only, never compiled);
  // null/absent when stale, not yet generated, or the flag is OFF → the Reader
  // panel degrades to the deterministic blockerLine(data) line (D-09 floor).
  //
  // DISPLAY fields ONLY (mirrors the SR employee-row mirror). The worker
  // ActionCard's mutation-only sourceIssueUuid is INTENTIONALLY OMITTED — it has
  // no field here, so it cannot be threaded into a render (NO_UUID_LEAK, D-10).
  actionCard?: {
    namedAction: string;
    awaitedParty: string;
    estBucket: 'quick' | 'focused' | 'deep' | (string & {});
    actionKind: 'answer' | 'decide' | 'assign' | 'none' | (string & {});
    decisionOptions: string[] | null;
  } | null;
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

// Plan 13-01 (D-14) — the Editor-Agent named-action card. Split-identity
// discipline mirrors BlockerChainResult (D-15 of Phase 11, NO_UUID_LEAK):
//
//   DISPLAY fields — the ONLY fields a render surface may show:
//     namedAction, awaitedParty, estBucket, actionKind, decisionOptions
//   KEY / DISPATCH-only field — carried but NEVER rendered as visible text:
//     sourceIssueUuid
//
// est_bucket is a COARSE bucket (D-09) — quick ≈ a few minutes / one decision;
// focused ≈ up to ~30-min review; deep ≈ needs a real work block — never a
// manufactured-precise minute count. decisionOptions is null unless the source
// issue poses an explicit binary (D-08 conservative default); an open-ended
// question carries null, not an invented option set.
export type ActionCard = {
  /** DISPLAY — the single plain-English action sentence (Editorial Desk voice). */
  namedAction: string;
  /** DISPLAY — the human-readable awaited party (scrubbed, zero raw UUIDs, D-10). */
  awaitedParty: string;
  /** DISPLAY — coarse time-estimate bucket (D-09); never free-form minutes. */
  estBucket: 'quick' | 'focused' | 'deep';
  /** DISPLAY — the single control the row offers, grounded in the engine affordance. */
  actionKind: 'answer' | 'decide' | 'assign' | 'none';
  /** DISPLAY — yes/no (pick-one) options when the issue poses an explicit binary
   *  (D-08); null otherwise (a free-text answer is expected). Never invented. */
  decisionOptions: string[] | null;
  /** Generation timestamp (ISO) — used for the staleness/liveness signal (D-11). */
  generatedAt: string;
  /** KEY / DISPATCH ONLY — the leaf/source issue UUID the card grounds in
   *  (== verdict.targetIssueUuid / pathIds[last]). Carried as the grounding +
   *  dispatch key, NEVER rendered as visible text (NO_UUID_LEAK, D-03/D-14). */
  sourceIssueUuid: string;
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
  // Phase 19 Plan 19-03 (CARD-02 / D-09) — the Editor-Agent named-action card for
  // this inbox item's leaf, attached read-only by bulletin.byCycle ONLY when the
  // runtime flag is ON and a FRESH cached card exists; null/absent otherwise → the
  // UI floors to the existing `summary` line. DISPLAY fields ONLY — the worker
  // ActionCard's mutation-only sourceIssueUuid is OMITTED (NO_UUID_LEAK, D-10).
  actionCard?: {
    namedAction: string;
    awaitedParty: string;
    estBucket: 'quick' | 'focused' | 'deep' | (string & {});
    actionKind: 'answer' | 'decide' | 'assign' | 'none' | (string & {});
    decisionOptions: string[] | null;
  } | null;
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
