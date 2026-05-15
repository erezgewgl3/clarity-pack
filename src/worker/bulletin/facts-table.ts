// src/worker/bulletin/facts-table.ts
//
// Plan 03-02 — Pure facts-table extraction + slot interpolation.
//
// CONTEXT.md D-14: structured slots, not prose-extracted numbers. The pass-1
// LLM prompt receives the factsTable as DATA, never as instruction; the prose
// it emits uses `{{NUMBER:key}}` placeholders that pure code replaces — the
// LLM never types a number into the prose itself. Pass-2's verifier re-runs
// every slot's SQL so a hallucinated value cannot survive to publish.
//
// Pure functions only: no `ctx`, no SDK imports beyond the FactsTable type.

import type { FactsTable, NumberFormat } from '../../shared/types.ts';

/** Input to computeFactsTable — raw SQL-result rows plus optional slot defs. */
export type FactsInput = {
  /** Slot-name → raw computed value (typically a Standing-Numbers result). */
  rows: Record<string, number | string>;
  /** Optional per-slot SQL + format metadata so the verifier can re-run. */
  slotDefs?: Record<
    string,
    { sql: string; params: unknown[]; format: NumberFormat }
  >;
};

/**
 * Pure function. Maps raw SQL-result rows into a FactsTable shape that the
 * pass-1 LLM prompt and the pass-2 verifier both consume. Every emitted entry
 * carries a `sql` + `format` field; when no slotDef is supplied the `sql`
 * falls back to an empty string and the format defaults to `count`.
 */
export function computeFactsTable(input: FactsInput): FactsTable {
  const out: FactsTable = {};
  for (const [key, value] of Object.entries(input.rows)) {
    const def = input.slotDefs?.[key];
    out[key] = {
      sql: def?.sql ?? '',
      params: def?.params ?? [],
      value,
      format: def?.format ?? 'count',
    };
  }
  return out;
}

/** Format a single fact value per its declared NumberFormat. */
function formatFact(value: number | string, format: NumberFormat): string {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(Number(value));
    case 'pct':
      return `${(Number(value) * 100).toFixed(1)}%`;
    case 'count':
      return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0,
      }).format(Number(value));
    case 'ratio':
      return String(value);
    default:
      return String(value);
  }
}

/**
 * Pure function. Replaces every `{{NUMBER:key}}` placeholder in `prose` with
 * the format-aware value from `facts[key]`.
 *
 * If a placeholder references a key not present in `facts`, throws an Error
 * whose `.slot` property carries the unknown key — pass-1's validateDraftSchema
 * catches this and the verifier downstream converts it to a typed
 * `{ ok: false, kind: 'UNKNOWN_SLOT', slot }` result.
 */
export function replaceSlots(prose: string, facts: FactsTable): string {
  return prose.replace(/\{\{NUMBER:([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const fact = facts[key];
    if (!fact) {
      const err = new Error(`UNKNOWN_SLOT:${key}`) as Error & { slot?: string };
      err.slot = key;
      throw err;
    }
    return formatFact(fact.value, fact.format);
  });
}
