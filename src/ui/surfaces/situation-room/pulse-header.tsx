// src/ui/surfaces/situation-room/pulse-header.tsx
//
// Plan 15-02 Task 2 (COCK-01 / SC1) — the <PulseHeader>: the always-visible
// "how's the company?" answer that supersedes the Phase-8 needs-you-banner
// (15-CONTEXT D-07). It renders:
//   - a DETERMINISTIC one-sentence status line (buildPulseSentence, the D-02
//     always-on floor — the Editor-Agent prose enrichment is DEFERRED, D-03), and
//   - exactly four labelled vital-sign chips from snapshot.pulse:
//       need-you (gold) · in-motion (green) · stuck (red/amber) · self-clearing.
//
// D-07 (banner fold): the need-you state lives in the Pulse sentence + chip.
// There is NO second standalone status line — the Pulse IS the status surface.
//
// D-08 / SC4 (never blanks): a defensively-absent / undefined / null pulse prop
// renders the all-zero deterministic floor (the chips show 0; the sentence reads
// "The board is clear."). The component never throws and never blanks. The four
// chips ALWAYS render even when a count is 0 — a zero is itself a signal
// (the partition-then-render-empty convention carried from employee-row-strip).
//
// D-10 (instance-agnostic + NO_UUID_LEAK): human labels + integers only. NO
// companyPrefix literal, NO raw id, NO UUID — every visible string is a React
// text node (NO dangerouslySetInnerHTML). The dedicated render-scan guard lives
// in test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs.
//
// The PulseSummary type is a STRUCTURAL mirror of the worker shape (15-01
// build-pulse-summary.ts) — the UI bundle does NOT import worker types.

import * as React from 'react';

import { buildPulseSentence } from './pulse-sentence.ts';

/** STRUCTURAL mirror of the worker-side PulseSummary (15-01). All integers. The
 *  UI bundle does NOT import worker types — this shape is kept in sync by hand. */
export type PulseSummary = {
  /** Per-leaf-deduped human-actionable count (= needsYou.count). */
  needYou: number;
  /** In-motion-tier chains + chainless working-state agents. */
  inMotion: number;
  /** AWAITING_AGENT_STUCK rows (quietly stalled, Watch tier). */
  stuck: number;
  /** SELF_RESOLVING rows (clearing themselves, Watch tier). */
  selfClearing: number;
};

/** The all-zero floor — the SC4 degrade target an absent pulse renders. */
const PULSE_FLOOR: PulseSummary = {
  needYou: 0,
  inMotion: 0,
  stuck: 0,
  selfClearing: 0,
};

type PulseHeaderProps = {
  /** The worker-computed Pulse summary (snapshot.pulse). Absent/null degrades to
   *  the all-zero floor — the Pulse never blanks (SC4). */
  pulse?: PulseSummary | null;
};

/** The four vital signs, in loudest-on-top order. `key` is the PulseSummary
 *  field; `mod` is the CSS tint modifier; `label` is the static English label. */
const VITALS: ReadonlyArray<{
  key: keyof PulseSummary;
  mod: 'you' | 'mov' | 'stk' | 'slf';
  label: string;
}> = [
  { key: 'needYou', mod: 'you', label: 'need you' },
  { key: 'inMotion', mod: 'mov', label: 'in motion' },
  { key: 'stuck', mod: 'stk', label: 'stuck' },
  { key: 'selfClearing', mod: 'slf', label: 'self-clearing' },
];

export function PulseHeader({ pulse }: PulseHeaderProps): React.ReactElement {
  // Defensive floor (SC4): an absent/undefined/null pulse renders the all-zero
  // deterministic floor — never blanks, never throws.
  const counts: PulseSummary = pulse ?? PULSE_FLOOR;
  const sentence = buildPulseSentence(counts);

  return (
    <header className="clarity-pulse">
      <p className="clarity-pulse-sentence">{sentence}</p>
      <div className="clarity-pulse-vitals" role="list">
        {VITALS.map((v) => {
          // Coerce to a safe non-negative integer so a malformed count shows 0,
          // never a UUID-ish / NaN / negative value (NO_UUID_LEAK + honesty).
          const raw = counts[v.key];
          const count = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
          return (
            <span
              key={v.key}
              role="listitem"
              className={`clarity-pulse-vital clarity-pulse-vital-${v.mod}`}
            >
              <span className="clarity-pulse-vital-dot" aria-hidden="true" />
              <span className="clarity-pulse-vital-n">{count}</span>
              <span className="clarity-pulse-vital-label">{v.label}</span>
            </span>
          );
        })}
      </div>
    </header>
  );
}
