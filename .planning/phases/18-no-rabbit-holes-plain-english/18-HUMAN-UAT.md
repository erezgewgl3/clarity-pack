---
status: partial
phase: 18-no-rabbit-holes-plain-english
source: [18-VERIFICATION.md]
started: 2026-06-15
updated: 2026-06-15
---

## Current Test

[awaiting human testing — both items are env-gated deferrals, not defects]

## Tests

### 1. LEG-01 Tier-1 re-probe (optional upgrade vs formal Tier-2 acceptance)
expected: With the Reader now rendering on v1.7.1, run `node scripts/probes/reader-tab-deeplink.mjs` and the live-host carrier check. If the host honors `?tab=clarity-reader` or `#tab=clarity-reader`, enable Tier-1 (one-line change in `src/ui/primitives/reader-href.ts`). If not, record formal Tier-2 acceptance (Open↗ lands on the classic tab absent a host tab-deep-link feature).
result: [pending]

### 2. LEG-03 live-positive affordance demo
expected: When a real BEAAA issue reaches the done-but-blocked state (AI TL;DR reads "done" AND deterministic engine still classifies needs-you), confirm the "Looks done — close it?" affordance appears on BOTH the Reader and the SR needs-you row, and that "Keep blocked" does not close it. (Code-proven by 109/109 phase tests; no live fixture exists on BEAAA today.)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
