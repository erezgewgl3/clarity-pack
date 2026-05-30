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

// The flattener's locked sentinel for an unowned HUMAN_ACTION_ON terminal
// (src/shared/blocker-chain.ts:178). Such rows must NOT count toward
// need_you_count (they need an OWNER first, not the viewer specifically).
export const UNOWNED_SENTINEL = '__unowned__';

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
 *   1. __unowned__ HUMAN_ACTION_ON → clean "{name} — assign an owner first" if
 *      the label's embedded UUID resolves to a name, else
 *      "Owner unknown — assign an owner first". No raw UUID either way.
 *   2. Any other terminal → replace EVERY UUID with its resolved name, else
 *      `agent#<first-8-hex>` (humanize-snapshot.ts step-2 fallback).
 *   3. Non-__unowned__ HUMAN_ACTION_ON whose userId is the viewer → substitute
 *      that id with "You" (humanize-snapshot.ts step 3).
 *   4. Belt-and-suspenders: any UUID that somehow survived → short form.
 */
export function scrubHumanAction(
  terminal: Terminal,
  viewerUserId: string,
  nameByUuid: Map<string, string | null>,
): string {
  const nameOf = (uuid: string): string | null => nameByUuid.get(uuid) ?? null;

  if (terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId === UNOWNED_SENTINEL) {
    const m = terminal.label.match(UUID_RE);
    const name = m ? nameOf(m[0]) : null;
    return name ? `${name} — assign an owner first` : 'Owner unknown — assign an owner first';
  }

  // Step 2 — substitute every embedded UUID with a name or short-form.
  let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);

  // Step 3 — viewer userId → "You" for a non-__unowned__ human action. Run
  // AFTER step 2 because the userId is itself a UUID that step 2 would have
  // already rewritten to a name; substitute against the resolved fragment too.
  if (terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId !== UNOWNED_SENTINEL) {
    if (terminal.label.includes(terminal.userId)) {
      const resolved = nameOf(terminal.userId) ?? `agent#${terminal.userId.slice(0, 8)}`;
      if (terminal.userId === viewerUserId) {
        label = label.split(resolved).join('You');
      }
    }
  }

  // Step 4 — belt-and-suspenders: no UUID may survive.
  return label.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
}
