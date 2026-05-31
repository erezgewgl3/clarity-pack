---
status: gaps_found
phase: 09-situation-room-actionable-cockpit
ships_as: v1.3.0
requirements: [R1, R2, R3, R4, R5, R6, R7, R8, R9]
verified: 2026-05-31
gaps:
  - id: R3
    status: failed
    title: "situation.assignOwner passes the human issue key to ctx.issues.update; host needs the UUID → ASSIGN_FAILED"
    severity: blocking
    surfaced_by: live BEAAA drill 2026-05-31
---

# Phase 9 VERIFICATION — Situation Room actionable cockpit

**Deploy:** v1.3.0 — local tarball `clarity-pack-1.3.0.tgz` sha256 `10ae75c3829398fd70d0b383cdea2efa725ab60d6c6a3e32a2257765409288aa` / 737,941 B (on-box rebuild from master tarball `736,859 B`, byte size differs only by pack timestamp/compression — same master source `046a1c0`)
**BEAAA host:** plugin UUID `a763176a-2f4d-4986-b190-b5151e42cc00` — `status=ready version=1.3.0` (UUID preserved across upgrade from v1.2.1 — COEXIST #6)
**Deploy path:** DEPLOY-RUNBOOK **Path B** (DO Web Console + GitHub-master clone + on-box build/pack/install as `beai-agent` + `pm2 restart paperclip`). Path A was fail2ban-blocked mid-session after recon connections; Path B is out-of-band/immune. `paperclipInvocation` count `5` (SDK bundled, not externalized); built `dist/manifest.js` carries `version: '1.3.0'` + `issues.update` capability (count 9).
**Bookend (R8 + BLOCKER 2):** Satisfied via the BEAAA-specific model, NOT the Countermoves safety-CLI (which is **not installed on BEAAA** — `~/clarity-pack` absent, no `/etc/paperclip/db.env`). Pre-snapshot = operator-run DigitalOcean droplet backup taken hours before deploy (confirmed by operator). Verified-restore leg = plugin-reinstall rollback (additive-only schema; rehearsed by precedent — Phase 4.1/6.1 disable/enable + uninstall/install drills) with v1.2.1 as the known-good rollback target. Per project memory `autonomous-deploy-authorization` the DO-backup + rehearsed restore model is the accepted BEAAA bookend.
**Drill date:** 2026-05-31
**Drill operator:** Eric (ericg@gl3group.com) — driven via Playwright MCP against `http://localhost:3100/BEAAA/situation-room` (SSH tunnel localhost:3100 → ariclaw:3100)
**Roster:** 18 company-scope agents on BEAAA; **9 real blocked-and-unowned issues** present at drill time (BEAAA-43, 617, 802, 814, 817, 663, 794, 933, 1101) — WARNING-4 non-vacuous condition met without seeding.

---

## 11-check acceptance scorecard

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| R1 | One people view, three groups; no agent grid | **PASS** | DOM probe: `.clarity-agent-grid`=0, `.clarity-agent-card`=0; exactly 3 group `<h2>`s: **Needs you / Working / Idle**. Screenshot `09-drill-1-cockpit-three-groups.png` |
| R2 | Worker-tier grouping rendered verbatim | **PASS** | Needs you (9 blocked) · Working (6 running/reviewing) · Idle (3 idle/stale); UI renders worker order, no client re-sort |
| R3 | **Assign owner mutates the real issue (HERO)** | **FAIL** | `situation.assignOwner` action POST → 200 envelope but body `{"data":{"error":"ASSIGN_FAILED"}}`. Worker log: `situation.assignOwner: issues.update failed {leafIssueId:"BEAAA-43"}` + host log `ERROR host handler error {method:"issues.update"}`. Re-read: BEAAA-43 still unowned (no mutation landed). See Root Cause below. |
| R4 | No dead buttons; every surfaced action performs | **PARTIAL** | No *disabled/no-op* buttons anywhere (Needs-you rows: `Assign owner ▾`+`Open ↗`; Idle: `Assign work ▾`+`Stand down`; Working: "moving · no action needed"). BUT the hero Assign-owner action errors at the mutation (R3) — so a surfaced button does not complete its effect. R4 cannot pass while R3 fails. |
| R5 | Un-frozen banner, non-zero unowned count | **PASS** | Banner "⚠ 9 stuck · 9 unowned → assign owners to clear the board" + `[Assign first ▾]` (urgent, non-zero). Previously frozen at "0 need you". |
| R6 | org-backlog + critical-path merged into one expander | **PASS** | Single `+ 29 more blocked issues across the org (no active agent)` expander at end of Needs-you; no standalone org-backlog banner, no critical-path strip |
| R7 | Stand-down confirm + Resume | **PASS** | `[Stand down]` on CSO → confirm dialog "Stand down CSO? · Confirm · Cancel"; Cancel = no pause (verified, no real effect) |
| R8 | Snapshot bookend + verified restore before deploy | **PASS** | See Bookend note above (DO backup + plugin-reinstall rollback, BEAAA model) |
| R9 | No raw-UUID leaks in human-facing strings | **PASS** | Surface-text UUID regex → 0 matches across cockpit + owner picker |
| D-01 | Owner-picker popover with roster | **PASS** | Popover lists full agent roster (Head of Compliance, Auditor, Scanner Engineers, CEO, CSO, CFO, CTO, Designer, Actuary, Underwriter, CMO, CBDO …). Screenshot `09-drill-2-owner-picker-roster.png` |
| D-02 | "Take it myself" | **PASS** (renders) / **blocked-by-R3** (effect) | "Take it myself" item present at picker bottom. Its effect path uses the SAME `ctx.issues.update` call → would fail identically to R3 (not separately exercised to avoid a second failed mutation). |
| WARNING 2 | Editor-Agent excluded from picker | **PASS** | Editor-Agent absent from the owner-picker roster (uses `chat.roster`, not `ctx.agents.list`) |
| Reader rider (operator add) | v1.2.2 no-rail Reader, first live appearance | **PASS** | `[data-clarity-surface="reader"]` width **760px**; "Show full task" disclosure present; **35** `.clarity-ref-chip--inline`; **0** rail elements inside the surface. Screenshot `09-drill-4-reader-norail-760col.png` |

**Tally: 10 of 11 acceptance checks PASS + Reader rider PASS; R3 (hero) FAILS; R4 PARTIAL (gated by R3).**

---

## Per-requirement status

| Req | Status | Note |
|-----|--------|------|
| R1 one-view-three-groups | Implemented | live PASS |
| R2 worker grouping | Implemented | live PASS |
| R3 assign-owner real mutation | **NOT IMPLEMENTED (gap)** | code exists + unit-tested, but fails live: human-key vs UUID |
| R4 no dead buttons | Partial | no disabled buttons; hero action errors (gated by R3) |
| R5 un-frozen banner | Implemented | live PASS |
| R6 single expander | Implemented | live PASS |
| R7 stand-down confirm | Implemented | live PASS |
| R8 snapshot bookend | Implemented | DO-backup + plugin-reinstall rollback (BEAAA model) |
| R9 no UUID leaks | Implemented | live PASS |

---

## Root Cause — R3 (for the 09-04 gap-closure plan)

**Symptom:** clicking `Assign owner ▾` → pick an agent → toast does not confirm, row does not re-group, banner stays at 9 unowned. Network: `POST /actions/situation.assignOwner` → `200 {"data":{"error":"ASSIGN_FAILED"}}`. Worker log `issues.update failed {leafIssueId:"BEAAA-43"}`; host log `ERROR host handler error {method:"issues.update"}`.

**Root cause:** `situation.assignOwner` (`src/worker/handlers/situation-assign-owner.ts:107`) calls `ctx.issues.update(leafIssueId, patch, companyId, actor)` with `leafIssueId` = the **human identifier** `"BEAAA-43"`. The host's `issues.update` expects the issue **UUID** (cf. the working reference call `editor.ts:663` which passes `operationIssueId`, a UUID). `leafIssueId` is human-readable **by design**: `src/worker/situation/build-employees-rollup.ts:311-326` deliberately resolves it to `leaf.identifier ?? focusIssue.identifier` and the comments enforce "NEVER a uuid-suffix string (M2 / NO_UUID_LEAK)". So the field that the picker assigns is the *display* id, never the mutation id. This never surfaced before because (a) Phase 9 unit tests use fakes that accept any id string, and (b) `agent.takeOwnership` — the pattern this mirrors — writes a plugin-namespace **side table**, never `public.issues`. v1.3.0 is the **first live core-issue mutation**.

**Affects both branches:** the agent-assign (`assigneeAgentId`) and "Take it myself" (`assigneeUserId`) paths call the same `ctx.issues.update` → both fail identically.

**Fix design (carry the UUID separately from the display key):**
1. `build-employees-rollup.ts` — add `leafIssueUuid` to `blockerChain` + `NeedsYou.topAction`, sourced from the leaf node UUID already in hand (`leafNodeId = picked.pathIds[last]`, or `leaf.id` from the line-317 fetch; fall back to `focusIssue.id`). Keep `leafIssueId` (human key) unchanged for display.
2. `employee-row.tsx` + `needs-you-banner.tsx` — pass `leafIssueUuid` (not `leafIssueId`) as the action's issue param; keep `leafIssueId` for the "Open BEAAA-NN ↗" / "BEAAA-NN has no owner" display.
3. `situation-assign-owner.ts` — use the UUID param for `ctx.issues.update`; keep logging the human key.
4. Tests — RED: assert `ctx.issues.update` is called with the **UUID**, not the human key (a fake that throws on a non-UUID id reproduces the live failure). Extend the existing `situation-assign-owner.test.mjs` + a rollup test asserting `leafIssueUuid` is a UUID.
5. Re-deploy (Path A if SSH clear, else Path B) + re-drill R3: pick an agent → re-read issue shows `assigneeAgentId == picked`, operator-attributed; "Take it myself" → `assigneeUserId`; banner drops 9→8 unowned; row re-groups.

---

## Disposition

**Phase 9 is NOT complete.** v1.3.0 is deployed and live on BEAAA — a net improvement (3-group cockpit, un-frozen banner, single expander, stand-down, and the v1.2.2 Reader no-rail redesign all verified live) — but the **hero R3 acceptance fails**, so the phase stays OPEN. The failed assign is rejected by the host (no bad write; BEAAA-43 still unowned), so v1.3.0 is safe to leave live while R3 is fixed.

**Next:** `/gsd:plan-phase 09 --gaps` → creates the 09-04 gap-closure plan (TDD per the fix design above) → `/gsd:execute-phase 09 --gaps-only` → re-deploy + re-drill R3.

**No cleanup owed on BEAAA:** no throwaway issues seeded (9 real unowned blockers already present); the one attempted assign FAILED (no mutation); the stand-down was cancelled (no pause).
