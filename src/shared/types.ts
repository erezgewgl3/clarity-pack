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
