---
phase: 15-cockpit-ia-redesign
reviewed: 2026-06-03T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/worker/situation/build-pulse-summary.ts
  - src/worker/handlers/situation-room.ts
  - src/ui/surfaces/situation-room/pulse-header.tsx
  - src/ui/surfaces/situation-room/pulse-sentence.ts
  - src/ui/surfaces/situation-room/tier-strip.tsx
  - src/ui/surfaces/situation-room/index.tsx
  - src/ui/surfaces/situation-room/employee-row.tsx
  - src/ui/primitives/theme.css (Phase-15 sections only)
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: resolved
---

# Phase 15: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** standard
**Files Reviewed:** 7 (+ theme.css Phase-15 sections)
**Status:** resolved (WR-01, WR-02, IN-01, IN-02 fixed 2026-06-03; IN-03 false alarm, no change)

## Summary

Phase 15 delivers the Cockpit IA Redesign (verdict-tier layout + Pulse vital-sign
header) as a view-layer capstone over an unmodified worker engine. The core
invariants checked by the focused review are largely sound:

- Tier partition correctness: `visualTierOf` in `tier-strip.tsx` and the inline
  `visualTier` in `employee-row.tsx` are structurally identical; the defensive
  fall-through lands every unmatched row in Watch.
- Pulse count correctness: the `inMotion` filter is guard-identical to
  `visualTierOf`'s in-motion branch (no double-count), and `needYou` is verbatim
  from `needsYou.count`.
- SC3 is preserved: neither the view nor the pulse aggregation re-derives
  ownership or tier from raw fields.
- NO_UUID_LEAK: `PulseHeader` renders counts + static labels only; no uuid/prefix
  fields are threaded into any JSX text node.
- Needs-you preserved: the full Phase-13/14 action card + reply-in-place + assign
  cluster is still gated on `visualTier === 'needs-you'`, unchanged.
- React keys are stable (`row.agentId`).
- All new CSS is correctly scoped under `[data-clarity-surface='situation-room']`.

Two warnings and three info items found; no correctness blockers.

## Warnings

### WR-01: Watch-tier chain annotation keeps the loud red left-border (CSS gap)

**File:** `src/ui/primitives/theme.css:797` and `:1225`

**Issue:** `.clarity-employee-chain` sets `border-left: 2px solid var(--clarity-state-blocked)` (red) for all chain annotations. The Watch-tier modifier class `.clarity-employee-chain-watch` (theme.css:1225) only overrides `color` — it does not reset the border-left. Watch-tier chain-backed rows (AWAITING_AGENT_STUCK, SELF_RESOLVING, EXTERNAL, CYCLE) therefore render with a loud red left-border, contradicting the D-06 "quiet stalled awareness" design intent that Watch rows should be muted amber. The `clarity-employee-chain-owned` modifier (theme.css:1279-1281) makes the same override for owned chains (amber idle color) but `chain-watch` was missed.

**Fix:**
```css
[data-clarity-surface='situation-room'] .clarity-employee-chain-watch {
  border-left-color: color-mix(in oklch, var(--clarity-state-stale, #d6b15e), transparent 55%);
  color: var(--clarity-ink-2, #cdc5b6);
}
```

---

### WR-02: `visualTierOf` logic duplicated between `tier-strip.tsx` and `employee-row.tsx` — silent divergence risk

**File:** `src/ui/surfaces/situation-room/tier-strip.tsx:91-103` and `src/ui/surfaces/situation-room/employee-row.tsx:226-233`

**Issue:** The locked D-05 partition rule is implemented twice — once as the exported `visualTierOf` function in `tier-strip.tsx`, and again as the inline `visualTier` computed constant in `employee-row.tsx`. Both are currently structurally identical, but there is no shared source of truth. A future change to one (e.g., adding a new tier value or adjusting the chainless fallback) that misses the other produces a split-brain render: a row lands in tier X in `TierStrip` but its internal body renders as tier Y. The tests in `tier-strip.test.mjs` simulate the partition using their own third copy of the same logic, so a copy-paste divergence could pass tests.

**Fix:** Extract `visualTierOf` to `employee-row.tsx` (or a shared `tier-utils.ts`) and import it from `tier-strip.tsx`:

```typescript
// src/ui/surfaces/situation-room/tier-utils.ts
export type VisualTier = 'needs-you' | 'in-motion' | 'watch';
export function visualTierOf(row: { blockerChain: { tier?: string } | null; group: string }): VisualTier {
  const t = row.blockerChain?.tier;
  if (t === 'needs-you' || t === 'in-motion' || t === 'watch') return t as VisualTier;
  if (row.blockerChain == null) return row.group === 'working' ? 'in-motion' : 'watch';
  return 'watch';
}
```

Then import from both files. The test simulation copies in `tier-strip.test.mjs` / `tier-degrade.test.mjs` can independently verify the contract still holds.

---

## Info

### IN-01: Empty tier prose is redundant — "— none — Nothing needs you — the board is clear."

**File:** `src/ui/surfaces/situation-room/tier-strip.tsx:146`

**Issue:** The empty-state paragraph renders as `"— none — ${meta.emptyNote}"`. For the Needs-you tier this produces the awkward compound: `"— none — Nothing needs you — the board is clear."` — two full sentences merged with a leading separator. The double em-dash reading breaks the "calm scales with control" voice principle.

**Fix:** Either use only `meta.emptyNote` (drop the `— none —` prefix when emptyNote is present), or use the `— none —` prefix without a descriptive note:
```tsx
<p className="clarity-tier-empty">
  {rows.length === 0 && meta.emptyNote ? meta.emptyNote : '— none —'}
</p>
```

---

### IN-02: `stuck` pulse count not tested for cross-tier correctness (future-proof gap)

**File:** `test/worker/situation/build-pulse-summary.test.mjs` (no corresponding source defect)

**Issue:** `buildPulseSummary` counts `stuck` as rows with `blockerChain?.terminalKind === 'AWAITING_AGENT_STUCK'`, regardless of tier. By the current `classifyVerdict` contract `AWAITING_AGENT_STUCK` always yields `tier === 'watch'`, so this is safe today. However, if a future engine change reclassified `AWAITING_AGENT_STUCK` to a different tier (e.g., `needs-you`), the stuck count would continue to capture those rows but they would render in the wrong column relative to what the pulse chip reports as "stuck". There is no test that asserts `AWAITING_AGENT_STUCK` rows always reside in Watch. The tier-level consistency between pulse counts and tier strip is not mechanically locked by a test.

**Fix:** Add a test asserting the engine contract: for any row counted in `pulse.stuck`, `visualTierOf(row) === 'watch'`.

---

### IN-03: `buildPulseSentence` does not handle `NaN` input from a malformed pulse object

**File:** `src/ui/surfaces/situation-room/pulse-sentence.ts:53-57`

**Issue:** The `n()` helper guards `!Number.isFinite(v)` which catches `NaN`, `Infinity`, and non-number types — this is correct. However, the function's first guard is `pulse?.needYou ?? 0`, which means if `pulse` is a non-null object where `pulse.needYou` is `undefined` (missing key, not zero), `v` is `0` and the guard passes correctly. The potential gap is if `pulse.needYou` is `null` — `null ?? 0` is `0` (nullish coalescing handles null), so that's also safe. The `n()` helper also calls `Number.isFinite(v)` — `Number.isFinite(null)` is false (null fails the isFinite check because `Number(null) === 0` but `Number.isFinite(null)` is actually `false`... wait, `Number.isFinite(null) === false`) so `n(null)` returns `0`. Actually `Number.isFinite(null)` is `false` in JavaScript (null is not a number), so `n(null) → 0`. No issue here. This is a false alarm — the code is correct as written. Flagging as info only to document the reasoning.

**Fix:** No code change needed. The chain `n(pulse?.needYou ?? 0)` (where `n` guards `!Number.isFinite`) is correctly degrade-safe for all input shapes including `null`, `undefined`, `NaN`, and strings.

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
