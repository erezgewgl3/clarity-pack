---
phase: 14-do-it-here-action-loop
plan: 04
subsystem: situation-room-data-model
tags: [needsDurabilityFlip, terminalKind, OrgBlockedRow, ReplyInPlace, NO_UUID_LEAK, additive-projection]
requires:
  - src/shared/types.ts (Terminal / BlockerChainResult — read-only)
  - src/shared/blocker-chain.ts (classifyVerdict / flattenBlockerChain — untouched)
provides:
  - "needsDurabilityFlip (real leaf-status boolean) + terminalKind on the employee rollup blockerChain"
  - "awaitedPartyLabel/targetAgentUuid/decisionOptions/leafIssueUuid/needsDurabilityFlip on OrgBlockedRow (worker + UI mirror)"
affects:
  - 14-02 (isReplyReachable reads terminalKind directly)
  - 14-03 (<ReplyInPlace> reads needsDurabilityFlip + the OrgBlockedRow fields)
  - 14-01 (the durable flip fires off the worker-emitted needsDurabilityFlip)
tech-stack:
  added: []
  patterns: [additive-projection-only, leaf-status-derived-flip, byte-parallel-ui-mirror]
key-files:
  created: []
  modified:
    - src/worker/situation/build-employees-rollup.ts
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/worker/handlers/org-blocked-backlog.ts
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
    - test/worker/situation/build-employees-rollup.test.mjs
    - test/worker/org-blocked-backlog.test.mjs
decisions:
  - "needsDurabilityFlip is derived from the LEAF issue status==='blocked' (resolved leaf.status / nodeMeta[leaf].status / focusIssue.status), NOT a terminal.kind proxy — the BLOCKER 2+4 correctness rule."
  - "terminalKind is the leaf Terminal['kind'] STRING (so isReplyReachable(terminalKind) + 14-03 call sites compile), never the full Terminal union."
  - "leafIssueUuid (= chain.targetIssueUuid) is distinct from issueId (the ROOT issue UUID) and is dispatch-only (NO_UUID_LEAK)."
metrics:
  duration: ~1 session
  completed: 2026-06-03
  tasks: 2
  files: 6
---

# Phase 14 Plan 04: Action-Loop Data-Model Foundation Summary

Threaded the two Shape-B signals waves 2-3 depend on — a REAL worker-emitted `needsDurabilityFlip` boolean (derived from the leaf issue's `status==='blocked'`, NOT a `terminal.kind` proxy) and the leaf `terminalKind` string — onto the employee rollup blockerChain, and widened `OrgBlockedRow` with the five `<ReplyInPlace>` fields (`awaitedPartyLabel`, `targetAgentUuid`, `decisionOptions`, `leafIssueUuid`, `needsDurabilityFlip`). Pure additive projection: no engine change, no schema change, no new host fetch.

## What shipped

### Task 1 — rollup `needsDurabilityFlip` + `terminalKind` (commit bb0862e)
- `build-employees-rollup.ts`: captured `leafStatus` alongside the existing leaf resolution (single-hop = `focusIssue.status`; multi-hop = the resolved `leaf.status` from the SAME `ctx.issues.get` already made for `leafIssueId`/`leafIssueUuid` — **no new fetch**). Computed `needsDurabilityFlip = leafStatus === 'blocked'`. Added `terminalKind: terminal.kind` + `needsDurabilityFlip` to the happy-path emit. The UNCLASSIFIED degrade row sets `terminalKind: 'UNCLASSIFIED'` and `needsDurabilityFlip: focusIssue.status === 'blocked'` (honest off the real status, not hardcoded).
- `employee-row.tsx`: byte-parallel mirror of the two fields (`terminalKind`, `needsDurabilityFlip`) with dispatch-only doc discipline.
- Tests: blocked single-hop leaf → flip `true` + `terminalKind` carried; AWAITING_HUMAN leaf whose resolved status ≠ blocked → flip `false` (proves off leaf status, not terminal.kind); multi-hop resolved-leaf blocked → `true`; UNCLASSIFIED degrade carries `terminalKind === 'UNCLASSIFIED'`.

### Task 2 — `OrgBlockedRow` widening (commit 9e4cb75)
- `org-blocked-backlog.ts`: extended `OrgBlockedRow` with the five fields. Threaded each issue's `nodeMeta` into the `Paired` type + a `chainToNodeMeta` map; computed `needsDurabilityFlip` off `nodeMeta[chain.targetIssueUuid]?.status === 'blocked'` (falling back to `'blocked'` only when the leaf IS the root). Emitted `awaitedPartyLabel` (= scrubbed humanAction), `targetAgentUuid` (= `chain.targetAgentUuid`), `decisionOptions: null`, `leafIssueUuid` (= `chain.targetIssueUuid`, distinct from `issueId`).
- `org-blocked-backlog-banner-types.ts`: byte-parallel mirror of the five fields.
- Tests: leaf-distinct `leafIssueUuid` on a multi-hop chain; leaf-status flip (blocked→true / awaiting→false); `targetAgentUuid` on AWAITING_AGENT_STUCK; `decisionOptions === null`; UNCLASSIFIED degrade carries all five.

## Verification (all green)

| Command | Result |
|---|---|
| `node --test test/worker/situation/build-employees-rollup.test.mjs` | pass 28 / fail 0 |
| `node --test test/worker/org-blocked-backlog.test.mjs` | pass 33 / fail 0 |
| `node --test test/worker/situation/build-employees-rollup-needsyou.test.mjs build-employees-rollup-viewer-single-source.test.mjs` | pass 15 / fail 0 |
| `node --test test/shared/blocker-chain.test.mjs` (engine purity) | pass 21 / fail 0 |
| `node --test "test/worker/**/*.test.mjs"` (full worker suite) | pass 1116 / fail 0 |
| `npx tsc --noEmit` | exit 0 |
| `node scripts/build-worker.mjs && node scripts/build-ui.mjs` | both Done (worker 2.5mb, ui 724.8kb) |

## Deviations from Plan

### Path correction
- The plan frontmatter listed the org-backlog test at `test/worker/handlers/org-blocked-backlog.test.mjs`; the file actually lives at `test/worker/org-blocked-backlog.test.mjs`. Used the real location (matches the instructions' run command). No behavior impact — projection-only edit to the existing harness.

Otherwise: plan executed as written.

## NO_UUID_LEAK preservation
- `leafIssueUuid` / `targetAgentUuid` are typed + documented dispatch-only; `identifier` / `awaitedPartyLabel` stay the only displayed keys. All `humanAction` + `awaitedPartyLabel` UUID-scan tests still pass (no raw UUID in any rendered field).

## Self-Check: PASSED
- Files modified verified present (all 6).
- Commits verified: bb0862e (Task 1), 9e4cb75 (Task 2).
