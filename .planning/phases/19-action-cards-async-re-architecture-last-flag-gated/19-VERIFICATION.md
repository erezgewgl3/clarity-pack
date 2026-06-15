---
phase: 19-action-cards-async-re-architecture-last-flag-gated
verified: 2026-06-15T18:30:00Z
status: passed
score: 4/4 must-haves verified
human_resolution: "2026-06-15 — v1.8.0 deployed live to BEAAA (bookended by confirmed automated DO backups). CARD-01 quiet-verify PASS (ready, no EADDRINUSE, health+snapshot 200, no 502). CARD-03 ON-flip live-proven (flag ON 200, 2-min no-storm, snapshot 200 throughout). Flag steady-state ON = action-cards delivered live. Open rider: CARD-02 visible-prose live-positive deferred (heartbeat-governed, dormant on quiet queue — Phase-17 style; four-surface attach CI-proven 57/57)."
overrides_applied: 0
human_verification:
  - test: "Step-1 — bookended BEAAA reinstall (flag OFF) + quiet verify"
    expected: "v1.8.0 installs clean on BEAAA, snapshot returns 200, worker CPU ~0%, NO 'Someone updated' notification from any action-card op-issue with the flag OFF (A1 CARD-01 live confirmation)"
    why_human: "Requires live SSH session to BEAAA (AriClaw droplet), DO backup bookend, and observation of Editor heartbeat behaviour in production — cannot be verified programmatically from the codebase"
  - test: "Step-2 — monitored ON-flip drill + panic-OFF rehearsal"
    expected: "set-action-cards-flag RPC flips flag ON; wakes stay within governor ceiling (<=6/min), snapshot 200, named-action prose renders on all four surfaces (SR, Reader, Bulletin, Chat) on needs-you rows; panic-OFF via RPC returns room to deterministic floor with no redeploy"
    expected_rider: "This is the KNOWN OPEN RIDER — deferred to the end-of-milestone operator window per D-08 (two-step, never couple unproven re-arch with live enablement)"
    why_human: "Requires live monitored BEAAA session with kill-switch armed; storm/notification observation; four-surface visual inspection — cannot be verified from codebase"
---

# Phase 19: Action-cards Async Re-Architecture Verification Report

**Phase Goal:** Move the Editor-Agent action-card compile OFF the snapshot request path onto the governed non-notifying op-issue/heartbeat path, then re-enable `ACTION_CARDS_ENABLED` behind a runtime flag once proven — grounded named-action prose live on needs-you rows without the snapshot 502 or the BEAAA-2092 notification storm.

**Verified:** 2026-06-15T18:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Action-card compile runs OFF the request path — `driveActionCardsStep` is deleted from `situation.snapshot` handler; only comment references remain | ✓ VERIFIED | `grep driveActionCardsStep src/worker/handlers/situation-room.ts` → 2 comment-only hits at lines 81 and 594; static gate test (`no-on-request-compile.static.test.mjs`) passes 2/2 forbidding any future re-introduction |
| 2 | Runtime kill-switch (`action_cards_flag` table) ships OFF with degrade-to-OFF read; flag reads at all three gate points (compile/attach/SWR serve strip) | ✓ VERIFIED | `migrations/0019_action_cards_flag.sql` is additive plugin-namespace; `action-cards-flag-repo.ts` returns `false` on absent row or error; flag read confirmed at editor.ts:394, situation-room.ts:603, situation-room.ts:709; `action-cards-flag-gate.test.mjs` 6/6 pass proving all three gates |
| 3 | All four surfaces (SR, Reader, Bulletin, Chat) attach the cached card read-only with deterministic floor + NO_UUID_LEAK scrub | ✓ VERIFIED | `flatten-blocker-chain.ts` `attachReaderActionCard`; `bulletin-by-cycle.ts` batch attach; `chat-active-tasks.ts` batch attach; `employee-row.tsx` (SR, already shipped); `no-uuid-leak-surfaces.test.mjs` 25/25 pass; reader/bulletin/chat surface tests 30/30 pass |
| 4 | v1.8.0 ships two-source-consistent (package.json + src/manifest.ts + dist/manifest.js) with clean build; flag ships OFF — behaviorally inert until operator flip | ✓ VERIFIED | `package.json` reads `"version": "1.8.0"`; `src/manifest.ts` reads `version: '1.8.0'`; `dist/manifest.js` built and contains `1.8.0` (commit c56d7cc); `tsc --noEmit` exit 0; full test suite 2938/2940 pass (2 skipped = env-gated build-artifact tests) |

**Score:** 4/4 codebase truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0019_action_cards_flag.sql` | Additive plugin-namespace flag table, default OFF, no version-scoping | ✓ VERIFIED | `CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.action_cards_flag`; `UNIQUE(company_id)`; no `plugin_version` column (D-01); zero `public.*` DDL |
| `src/worker/db/action-cards-flag-repo.ts` | `isActionCardsEnabled` (degrade-to-OFF) + `setActionCardsEnabled` (parameterized upsert) | ✓ VERIFIED | Returns `!!rows[0]?.enabled`; catch returns `false`; upsert uses `$1/$2/$3` binds only; NOT version-scoped |
| `src/worker/db/action-cards-repo.ts` | `getActionCardsBySources` batch newest-per-source cached read | ✓ VERIFIED | `DISTINCT ON (source_issue_id)` + `ANY($2::text[])` parameterized; early-returns `{}` for empty input |
| `src/worker/handlers/set-action-cards-flag.ts` | Operator RPC for Step-2 ON-flip + panic-OFF (no psql) | ✓ VERIFIED | Param-guarded; only write is `setActionCardsEnabled`; registered in `src/worker.ts` |
| `src/worker/handlers/situation-room.ts` | On-request compile DELETED; read-cached-only batch attach; SWR serve-path flag strip | ✓ VERIFIED | `driveActionCardsStep` absent from code; `getActionCardsBySources` at line 610; SWR strip at lines 706-715 |
| `src/worker/handlers/flatten-blocker-chain.ts` | Reader flag-gated read-only card attach (`attachReaderActionCard`) | ✓ VERIFIED | `attachReaderActionCard` found; `isActionCardsEnabled` import confirmed; never compiles |
| `src/worker/handlers/bulletin-by-cycle.ts` | Bulletin flag-gated batch card attach | ✓ VERIFIED | `isActionCardsEnabled` at line 151; `rowToCardDisplay` at line 158; degrade-safe |
| `src/worker/handlers/chat-active-tasks.ts` | Chat flag-gated batch card attach | ✓ VERIFIED | `isActionCardsEnabled` at line 165; `rowToCardDisplay` at line 172; degrade-safe |
| `test/worker/db/action-cards-flag-repo.test.mjs` | 8 assertions covering absent-row→OFF, throw→OFF, ON/OFF, no version filter, upsert shape | ✓ VERIFIED | 11/11 pass (flag-repo + 0019-validator combined) |
| `test/migrations/0019-validator.test.mjs` | Migration validator: DDL classification, namespace-only refs, no plugin_version | ✓ VERIFIED | Part of the 11/11 run above |
| `test/worker/handlers/no-on-request-compile.static.test.mjs` | CARD-01 anti-regression gate — comment-aware static scan forbids `driveActionCardsStep` in handler code | ✓ VERIFIED | 2/2 pass; comment-aware self-test proves it cannot be silently defeated |
| `test/loop/storm-safety.test.mjs` | CARD-01 burst: 12 op-issues through governed path, wakes <= ceiling, non-notifying mark-done, provenance-suppressed | ✓ VERIFIED | 3/3 pass including CARD-01 burst and the folded CARD-03 ceiling/bounded-warm assertions |
| `test/worker/agents/action-cards-flag-gate.test.mjs` | CARD-03 OFF-floor at all 3 gates + ON-switch + liveness + flip round-trip | ✓ VERIFIED | 6/6 pass |
| `test/worker/handlers/set-action-cards-flag.test.mjs` | 6 assertions: ON/OFF bindings, setBy default, param guards | ✓ VERIFIED | 6/6 pass |
| `test/ui/surfaces/no-uuid-leak-surfaces.test.mjs` | NO_UUID_LEAK + flag-OFF floor across Reader/Bulletin/Chat + coverage assertion | ✓ VERIFIED | 25/25 pass |
| `test/ui/surfaces/reader-action-card.test.mjs` | Reader card-or-floor render, flag-gate, liveness, rescrub, NO_UUID_LEAK behavioral | ✓ VERIFIED | 12/12 pass (part of 30/30 combined) |
| `test/ui/surfaces/bulletin-action-card.test.mjs` | Bulletin card-or-floor render, NO_UUID_LEAK | ✓ VERIFIED | 9/9 pass |
| `test/ui/surfaces/chat-action-card.test.mjs` | Chat "You owe" card-or-floor render, NO_UUID_LEAK | ✓ VERIFIED | 9/9 pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `editor.ts` heartbeat | `isActionCardsEnabled` | flag read at line 394 then `driveActionCardsStep` | ✓ WIRED | `if (!(await isActionCardsEnabled(ctx, payload.companyId))) return;` — heartbeat is the ONLY compile trigger |
| `situation-room.ts` DATA handler | `getActionCardsBySources` | flag-gated batch read (lines 603–626) | ✓ WIRED | No `driveActionCardsStep` import; only cache read |
| `situation-room.ts` SERVE path | SWR flag strip (lines 706–715) | `cardsOn = await isActionCardsEnabled` | ✓ WIRED | Panic-OFF maps `actionCard: null` over the cached slice before returning |
| `set-action-cards-flag.ts` | `setActionCardsEnabled` | single parameterized UPSERT | ✓ WIRED | `setActionCardsEnabled(ctx, companyId, enabled, setBy)` — the only write |
| `src/worker.ts` | `registerSetActionCardsFlag` | line 287 in exempt-handlers block | ✓ WIRED | Confirmed via grep |
| `flatten-blocker-chain.ts` | `getActionCardsBySources` + `isActionCardsEnabled` | `attachReaderActionCard` | ✓ WIRED | Called after `scrubResultLabel`; never compiles |
| `bulletin-by-cycle.ts` | `getActionCardsBySources` + `isActionCardsEnabled` | per-inbox-item flag-gated attach | ✓ WIRED | `rowToCardDisplay` projection; degrade-safe |
| `chat-active-tasks.ts` | `getActionCardsBySources` + `isActionCardsEnabled` | per-active-task flag-gated attach | ✓ WIRED | `rowToCardDisplay` projection; degrade-safe |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `situation-room.ts` DATA path | `cardsBySource` | `getActionCardsBySources` batch DB read (cached `action_cards` table) | Yes — `DISTINCT ON` SQL query against plugin-namespace table | ✓ FLOWING |
| `situation-room.ts` SERVE path | `servedEmployees.actionCard` | SWR cached slice stripped by live flag read | Yes — live `isActionCardsEnabled` read before serve | ✓ FLOWING |
| `flatten-blocker-chain.ts` | `result.actionCard` | `attachReaderActionCard` → `getActionCardsBySources` | Yes — batch DB read, liveness arm, display projection | ✓ FLOWING |
| `bulletin-by-cycle.ts` | `ActionInboxCard.actionCard` | `getActionCardsBySources` after `queryActionInbox` | Yes — batch read keyed off inbox `issueId` | ✓ FLOWING |
| `chat-active-tasks.ts` | `ActiveTaskEntry.actionCard` | `getActionCardsBySources` per active task | Yes — batch read per task; degrade-safe | ✓ FLOWING |

At flag OFF (default), all data variables resolve to `null`/`{}` — the deterministic floor. Data flows are structurally correct.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CARD-01: no `driveActionCardsStep` in handler code | `node --test test/worker/handlers/no-on-request-compile.static.test.mjs` | 2/2 pass | ✓ PASS |
| Migration 0019 is additive-namespace-only | `node --test test/migrations/0019-validator.test.mjs` | 4/4 pass | ✓ PASS |
| Flag repo degrade-to-OFF + no version-scoping | `node --test test/worker/db/action-cards-flag-repo.test.mjs` | 7/7 pass | ✓ PASS |
| CARD-03: OFF floors at all 3 gates; ON switches; panic-OFF returns | `node --test test/worker/agents/action-cards-flag-gate.test.mjs` | 6/6 pass | ✓ PASS |
| CARD-01 storm burst bounded + non-notifying mark-done | `node --test test/loop/storm-safety.test.mjs` | 3/3 pass (CARD-01 burst included) | ✓ PASS |
| Four-surface NO_UUID_LEAK + flag-OFF floor | `node --test test/ui/surfaces/no-uuid-leak-surfaces.test.mjs` | 25/25 pass | ✓ PASS |
| TypeScript clean | `npx tsc --noEmit -p tsconfig.json` | exit 0 | ✓ PASS |
| Full test suite | `node --test "test/**/*.test.mjs"` | 2938/2940 pass, 0 fail, 2 skipped (env-gated build-artifact tests) | ✓ PASS |
| blocker-chain.ts purity (AI-token + determinism guards) | `node --test test/shared/blocker-chain.test.mjs` | 21/21 pass including `PRIM-03 deterministic-graph-only` | ✓ PASS |
| Two-source version bump in place | `grep '"version"' package.json` + `grep "version: '1.8.0'" src/manifest.ts` + `grep "1.8.0" dist/manifest.js` | All found | ✓ PASS |

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| CARD-01 | 19-02 | Action-card compile runs OFF the request path, non-notifying op-issues | ✓ SATISFIED | On-request compile DELETED from situation-room.ts; static gate + storm burst CI prove it |
| CARD-02 | 19-01, 19-03 | `ACTION_CARDS_ENABLED` re-enabled behind runtime flag; four-surface named-action prose with stale→degrade | ✓ SATISFIED | `action-cards-flag-repo.ts`; four-surface attach (SR/Reader/Bulletin/Chat) with liveness arm + deterministic floor fallback |
| CARD-03 | 19-01, 19-04 | Flag runtime-safe + slip-safe; OFF→deterministic floor; ON→no 502/storm; set-action-cards-flag RPC; both states via BEAAA deploy | PARTIAL — code SATISFIED; live BEAAA deploy + ON-flip PENDING human operator window | CI proves OFF-floor at 3 gates + bounded wakes; live empirical confirm is known open rider (19-05 Tasks 2-3) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/worker/agents/action-cards.ts` | 139 | `export const ACTION_CARDS_ENABLED: boolean = false;` retained as legacy/no-op | ℹ Info | NOT a stub — documented as legacy export pending removal; neither call site imports it (confirmed by grep); no operational impact |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 19 modified file.

### Human Verification Required

#### 1. Step-1 — Bookended BEAAA Reinstall (flag OFF) + Quiet Verify

**Test:** Deploy v1.8.0 to BEAAA via the local-tarball extract-dir path (ariclaw SSH, beai-agent). Take the DO backup bookend BEFORE touching the live plugin. Reinstall with `action_cards_flag` absent (default OFF). Open the Situation Room and leave it open through at least one Editor heartbeat.

**Expected:**
- Plugin-list version label reads 1.8.0
- UI is NOT blank (ui-contributions 200 AND index.js 200; no EADDRINUSE crash)
- Snapshot returns 200, room shows deterministic floor (no named-action prose — expected, flag OFF)
- Worker CPU ~0%
- NO 'Someone updated' notification referencing an action-card op-issue fires (the A1 CARD-01 live confirmation — the heartbeat should return early with the flag OFF)

**Why human:** Requires live BEAAA SSH session (AriClaw droplet), DO backup bookend, and observation of Editor heartbeat behaviour in production. The A1 non-notifying claim is proven in CI but requires live empirical confirmation that no notification fires.

#### 2. Step-2 — Monitored ON-Flip Drill + Panic-OFF Rehearsal (KNOWN OPEN RIDER)

**Test:** In a monitored window with the kill-switch armed, invoke `set-action-cards-flag` ON for the BEAAA company via the RPC (no psql on box). Watch worker CPU + governor wake ceiling for several Editor heartbeats. Confirm snapshot 200. On a needs-you row, confirm the Editor named-action prose renders across all four surfaces. Invoke panic-OFF via `set-action-cards-flag` OFF and confirm the room returns to the deterministic floor with no redeploy.

**Expected:**
- Wakes stay within governor ceiling (≤6/min), no CPU storm, no multi-agent cascade
- Snapshot 200 under the ON state
- Named-action prose renders on needs-you rows on all four surfaces (SR, Reader, Bulletin, Chat) where a fresh card exists; brand-new rows may show the deterministic floor until next heartbeat (D-06 — expected and degrade-safe)
- NO 'Someone updated' notification storm from action-card op-issues under the ON state
- Panic-OFF returns room to deterministic floor across all surfaces with NO redeploy

**Why human:** Requires live monitored BEAAA session; storm/notification observation over multiple Editor heartbeats; four-surface visual inspection of named-action prose rendering. This is the live positive verification that cannot be simulated from the codebase.

**Rider classification:** This is the KNOWN OPEN RIDER — deferred to the end-of-milestone operator window exactly as Phase 17's deferred live-positive demo (per D-08: the two steps are SEPARATE, the unproven re-arch must not be coupled with live enablement).

---

## Gaps Summary

No code gaps. All four codebase success criteria are VERIFIED:

1. CARD-01: The on-request compile (`driveActionCardsStep`) is structurally absent from all handler files. The static anti-regression gate forbids its return. Storm-safety CI proves the bounded-warm heartbeat path stays within the governor ceiling and op-issue writes are non-notifying.

2. CARD-02: The runtime flag is fully wired (migrate→repo→editor→situation-room→four-surface attach). All four surfaces attach the cached card read-only with deterministic floor fallback and NO_UUID_LEAK scrub. The `rowToCardDisplay` projection drops `sourceIssueUuid` at a single source.

3. CARD-03 (code half): The flag is runtime-safe — OFF floors at all three gate points (compile/attach/SWR serve strip), ON yields bounded wakes, the `set-action-cards-flag` RPC is the redeploy-free flip for Step-2 and panic-OFF. All proven in CI.

4. Version invariant: Both sources read v1.8.0; dist/manifest.js is rebuilt; `tsc --noEmit` is clean; full suite 2938/2940 (0 fail, 2 env-gated skips).

The only open item is the live-BEAAA Step-1 quiet verify + Step-2 ON-flip drill (19-05 Tasks 2-3), which are operator-gated human-verify checkpoints by design. These constitute the `human_needed` status — identical in kind to Phase 17's deferred live-positive demo rider.

---

_Verified: 2026-06-15T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
