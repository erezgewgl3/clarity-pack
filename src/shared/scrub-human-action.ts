// src/shared/scrub-human-action.ts
//
// Plan 08-01 Task 1 — the single source of truth for the NO_UUID_LEAK guard.
//
// EXTRACTED VERBATIM from src/worker/handlers/org-blocked-backlog.ts:50-115
// (Plan 07-03 hotfix 35d4945) so BOTH the ROOM-12 org-blocked-backlog AND the
// ROOM-13..16 per-employee rollup (Plan 08-01 Task 3) consume one definition.
// A future blocker-chain change now fixes the scrub in exactly one place.
//
// REUSE (no re-implementation): the four-step scrub plus the three module-local
// constants travel together. The function signature is byte-identical to the
// prior private function — org-blocked-backlog.ts now imports it.

import type { Terminal } from './types.ts';

// Plan 11-01 (D-11) — the legacy unowned-sentinel userId is GONE. UNOWNED is now
// a first-class terminal kind carrying NO userId, so the scrub branches on
// `terminal.kind === 'UNOWNED'` instead of a magic userId string. No sentinel const.

// Hex UUID (8-4-4-4-12). Mirrors humanize-snapshot.ts:30 so the scrub enforces
// the SAME shape contract the job path enforces.
export const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * 07-03 HOTFIX — produce a human-action label that contains ZERO raw UUIDs,
 * for ANY terminal kind. This is the situation.snapshot DATA HANDLER's OWN
 * humanize step, mirroring src/worker/jobs/humanize-snapshot.ts:103-152 (the
 * JOB path) so the data handler — which does NOT run that job — gets the same
 * NO_UUID_LEAK guarantee.
 *
 * Pure: depends only on the terminal, the viewer id, and the pre-resolved
 * UUID→name map (D-09 degrade-safe — a name is null/absent ⇒ short-form
 * `agent#<8>` fallback, NEVER the raw UUID).
 *
 *   Plan 11-01 (D-11/D-12) — branches for all 8 kinds:
 *   1. UNOWNED (genuine, NO userId) → "{name} — assign an owner first" when the
 *      label's embedded UUID resolves, else "Owner unknown — assign an owner first".
 *   2. UNCLASSIFIED (degrade) → honest "Can't determine blocker — open <leaf> to
 *      investigate", NO assign verb (a walk-failure must never claim assignment).
 *   3. AWAITING_AGENT_WORKING / AWAITING_AGENT_STUCK → scrub the agentId to a name
 *      via nameByUuid, else `agent#<8>` — never the raw UUID.
 *   4. Any terminal → replace EVERY embedded UUID with its resolved name, else
 *      `agent#<first-8-hex>` (humanize-snapshot.ts step-2 fallback).
 *   5. AWAITING_HUMAN whose userId is the viewer → substitute that id with "You".
 *   6. Belt-and-suspenders: any UUID that somehow survived → short form.
 */
export function scrubHumanAction(
  terminal: Terminal,
  viewerUserId: string,
  nameByUuid: Map<string, string | null>,
): string {
  const nameOf = (uuid: string): string | null => nameByUuid.get(uuid) ?? null;

  // Step 1 — genuine UNOWNED (D-11). No userId; the label may embed the leaf id.
  if (terminal.kind === 'UNOWNED') {
    const m = terminal.label.match(UUID_RE);
    const name = m ? nameOf(m[0]) : null;
    return name ? `${name} — assign an owner first` : 'Owner unknown — assign an owner first';
  }

  // Step 2 — UNCLASSIFIED degrade (D-12). Honest, NO assign verb. Still scrub any
  // UUID the label may carry so the open-to-investigate line never leaks an id.
  if (terminal.kind === 'UNCLASSIFIED') {
    const scrubbed = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
    return scrubbed.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
  }

  // Step 3 — substitute every embedded UUID with a name or short-form (covers
  // AWAITING_AGENT_WORKING/STUCK agentId, AWAITING_HUMAN/EXTERNAL/CYCLE labels).
  let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);

  // Step 4 — viewer userId → "You" for an AWAITING_HUMAN action. Run AFTER step 3
  // because the userId is itself a UUID that step 3 would have already rewritten
  // to a name; substitute against the resolved fragment too.
  if (terminal.kind === 'AWAITING_HUMAN') {
    if (terminal.label.includes(terminal.userId)) {
      const resolved = nameOf(terminal.userId) ?? `agent#${terminal.userId.slice(0, 8)}`;
      if (terminal.userId === viewerUserId) {
        label = label.split(resolved).join('You');
      }
    }
  }

  // Step 5 — belt-and-suspenders: no UUID may survive.
  return label.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
}
