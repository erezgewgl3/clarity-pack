---
phase: 12-needs-you-triage
reviewed: 2026-06-02T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - src/worker/situation/leverage.ts
  - src/worker/handlers/org-blocked-backlog.ts
  - src/worker/situation/build-employees-rollup.ts
  - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
  - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
  - src/ui/surfaces/situation-room/employee-row.tsx
  - src/ui/surfaces/situation-room/needs-you-banner.tsx
  - src/ui/surfaces/reader/live-blocker-panel.tsx
  - src/shared/types.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: resolved
resolution:
  fixed_at: 2026-06-02
  fixed: 6
  skipped: 0
  commits:
    IN-01: dae8412
    IN-02: 9099c7a
    WR-02: db9f248
    WR-01: d9366ee
    WR-03: d9366ee
    CR-01: e8334e1
  notes: >-
    CR-01 fixed as an honest degrade — BlockerChainResult carries no human leaf
    identifier and the leaf UUID cannot enter a URL (NO_UUID_LEAK + the
    paperclip-issue-url-pattern 404 rule), so the Reader 'assign' affordance
    navigates to the leaf only for single-hop chains (pathIds.length <= 1) and
    renders NO button for multi-hop chains (no no-op/404). WR-01 + WR-03 share
    needs-you-banner.tsx and were committed together (WR-03's headline strings
    depend on the same `actions` const). Verification: npx tsc --noEmit clean;
    Phase 12 tests 80/80; build-ui.mjs green; added source-grep tests for CR-01
    (leaf-nav gate) and WR-01 (leverage-ordered fallback) + WR-03 (deduped
    headline).
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-02
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 12 ships three logically distinct changes: (1) the pure `leverage.ts` helper for reverse-counting and deduping the needs-you list by leaf, (2) wiring leverage ranking into `buildEmployeesRollup`, and (3) gating the Assign affordance on `actionAffordance === 'assign'` across three surfaces. The engine purity constraint (PRIM-03) is correctly honoured — `leverage.ts` contains no clock, no I/O, no AI tokens, and `buildEdges` correctly keeps `Date.now()` in the worker tier. The NO_UUID_LEAK invariant holds across all changed surfaces. The `AWAITING_AGENT_STUCK` exclusion from the loud Needs-you count is correctly enforced via the `needsYou === true` guard.

One BLOCKER was found: the Reader panel's `'assign'` affordance navigates to the wrong issue. Three WARNINGs cover a banner topAction mismatch edge case, a stale comment that states a false invariant, and a semantic count divergence in the banner. Two INFO items cover a comment error in `leverage.ts` and a duplicate import.

---

## Critical Issues

### CR-01: Reader `'assign'` affordance always navigates to the *start* issue, not the *leaf*

**File:** `src/ui/surfaces/reader/live-blocker-panel.tsx:235-244`

**Issue:** The `'assign'` case in the `onAction` switch (added by Plan 12-03 Task 2) calls `openIssue`, which is wired at construction time to `/${companyPrefix}/issues/${issueId}` where `issueId` is the outer `LiveBlockerPanel` prop — the issue currently open in the Reader. The comment explicitly states the intent is to "navigate to the leaf issue page where the operator can assign an owner," but for any multi-hop chain (UNOWNED or AWAITING_AGENT_STUCK leaf that is not the start issue itself), `issueId` ≠ the leaf. The operator is sent to the issue they are already reading, which does nothing useful.

Single-hop chains (leaf === start) are unaffected because `issueId` equals the leaf in that case.

**Fix:** Either navigate to the leaf identifier when it is available in the result, or clarify the comment to say "navigates to the current issue (start of the chain)" and accept the single-hop-only behaviour. The cleanest fix uses `data.targetIssueUuid` to construct a `/issues/<uuid>` route or falls back to the start. Because `BlockerChainResult` does not carry a leaf human identifier, the navigation must use the UUID. Paperclip issue pages accept UUIDs as identifiers (the URL pattern memory documents `/<prefix>/issues/<identifier>` but not UUID-only routing; verify before shipping). A safe interim fix:

```typescript
case 'assign': {
  // Navigate to the leaf when it differs from the start; fall back to the
  // start issue (the one open in the Reader).
  const leafTarget = issueDispatchTarget ?? issueId;
  onAction = () => {
    if (!companyPrefix) return;
    nav.navigate(`/${companyPrefix}/issues/${leafTarget}`);
  };
  break;
}
```

If UUID-based routing is not supported, the safest option is to keep the start-issue navigation but update the comment to remove the false "leaf issue page" claim.

---

## Warnings

### WR-01: `needs-you-banner.tsx` topAction lookup can silently fall back to the wrong row

**File:** `src/ui/surfaces/situation-room/needs-you-banner.tsx:100-103`

**Issue:** The banner's `target` resolution for [Assign first] is:

```typescript
const target =
  (needsYou.topAction &&
    unownedBlocked.find((e) => e.agentId === needsYou.topAction?.agentId)) ||
  unownedBlocked[0];
```

After Phase 12-02, `topAction.agentId` is the representative of the highest-leverage action item. The `needsYouRows` set feeding the leverage computation is `[...unowned, ...targeting]`. If the highest-leverage item's representative happens to come from the `targeting` partition (AWAITING_HUMAN rows where the viewer is awaited), it will not be found by `unownedBlocked.find(...)`, and the fallback silently scrolls to `unownedBlocked[0]` — which may not be the highest-leverage unowned row.

In practice this fires only when a viewer-targeted row has higher leverage than every unowned row (uncommon), but it is a silent correctness failure: the banner says "acting here frees the most" but scrolls somewhere else.

**Fix:** Guard the topAction lookup against the possibility that `topAction.agentId` belongs to the `targeting` partition:

```typescript
const target =
  (needsYou.topAction &&
    unownedBlocked.find((e) => e.agentId === needsYou.topAction?.agentId)) ??
  (needsYouOrdered first unowned row — use the leverage-ordered employee list)
  unownedBlocked[0];
```

A more robust fix: when `unownedBlocked.length > 0`, always use the first element of the `employees` list that is in `unownedBlocked` (they are returned in leverage-ranked order from the worker), rather than keying off `topAction.agentId`:

```typescript
const target = employees.find(
  (e) => e.group === 'needs_you' && e.blockerChain?.actionAffordance === 'assign'
) ?? unownedBlocked[0];
```

This is safe because `employees` is already leverage-ordered within the needs_you band.

---

### WR-02: Stale comment in `build-employees-rollup.ts` asserts false invariant about `'assign'`

**File:** `src/worker/situation/build-employees-rollup.ts:562-563`

**Issue:** The comment reads:

> `needsYou === true` AND `actionAffordance === 'assign'`
> (the 'assign' affordance fires ONLY for an UNOWNED terminal; AWAITING_HUMAN is 'reply').

After Plan 12-01 (`classifyVerdict` change), `AWAITING_AGENT_STUCK` also maps to `actionAffordance: 'assign'` (with `needsYou: false`, `tier: 'watch'`). The comment's parenthetical is now factually wrong. The `needsYou === true` guard in the filter expression still correctly excludes `AWAITING_AGENT_STUCK` rows, so the code is correct — but the comment will mislead anyone who reads this filter as "assign implies UNOWNED" and tries to derive the same predicate elsewhere without the `needsYou` guard.

**Fix:** Update the comment:

```
// `needsYou === true` AND `actionAffordance === 'assign'`
// After Plan 12-01, 'assign' also fires for AWAITING_AGENT_STUCK (needsYou false,
// tier 'watch'). The `needsYou === true` guard is therefore LOAD-BEARING here:
// it is what keeps stuck-agent rows out of the unowned partition.
```

---

### WR-03: `stuck` count in banner text diverges from the worker's per-leaf `count` after dedup

**File:** `src/ui/surfaces/situation-room/needs-you-banner.tsx:80,121,162-163`

**Issue:** The banner computes its own `stuck` as `unownedBlocked.length + ownedBlocked.length` — a per-agent count. Since Phase 12-02 changed `needsYou.count` to a per-leaf deduped count (one per distinct leaf), these two numbers can differ. Example: 3 agents all blocked on the same unowned leaf → `stuck = 3`, `count = 1`. The banner renders `${stuck}` in the urgent text string ("⚠ 3 stuck · 3 unowned") while the neutral-path branch checks `if (count === 0)`. A user who reads the Situation Room will see "3 stuck" in the banner but the worker tells the rest of the system "1 action needed" — the numbers come from two different models and appear in the same banner without explanation.

This does not cause incorrect branching logic (the neutral/urgent branch is gated on `count`, which is correct), but it means the displayed number is decoupled from the `count` value that drives all downstream decisions and tests (D-07 spec says leverage is an internal sort key only, but the banner's per-agent `stuck` was never updated to reflect that the count semantics changed).

**Fix:** Decide on a canonical count for the banner text. The simplest option aligned with the per-leaf model is to render `count` (deduped actions) rather than `stuck` (raw agent rows):

```typescript
// Replace: `⚠ ${stuck} stuck · ${unownedBlocked.length} unowned → …`
// With:    `⚠ ${count} action${count === 1 ? '' : 's'} needed · ${unownedBlocked.length} unowned → …`
```

Or keep `stuck` but add a clarifying label so the two numbers are coherent. If the per-agent count is the intended UX, document it explicitly and update tests to assert this value independently of `count`.

---

## Info

### IN-01: `leverage.ts` doc comment incorrectly describes representative selection

**File:** `src/worker/situation/leverage.ts:58-59`

**Issue:** The `LeverageActionItem` type comment says the representative is "the one whose leaf key is smallest among the collapsed rows." Since all collapsed rows share the same leaf key (that is the dedup grouping key), the comment makes no sense as written. The actual selection criterion is smallest `agentId` (line 103: `if (row.agentId < existing.representative.agentId)`).

The module header comment (line 18) also says "stable representative id (the smallest leaf key among them)" — same error.

**Fix:** Update both occurrences:

```
/** A representative source row (the one whose agentId sorts smallest among the
 *  collapsed rows) — deterministic without clock input, stable across input order. */
```

---

### IN-02: Duplicate import of `flattenBlockerChain` and `pickTopChains`/`classifyVerdict` from the same module

**File:** `src/worker/situation/build-employees-rollup.ts:22-24`

**Issue:** Three separate `import` statements pull from `'../../shared/blocker-chain.ts'`:

```typescript
import { pickTopChains } from '../../shared/blocker-chain.ts';
import { flattenBlockerChain } from '../../shared/blocker-chain.ts';
import { classifyVerdict } from '../../shared/blocker-chain.ts';
```

These can be collapsed to a single statement.

**Fix:**

```typescript
import {
  flattenBlockerChain,
  pickTopChains,
  classifyVerdict,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
```

---

_Reviewed: 2026-06-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
