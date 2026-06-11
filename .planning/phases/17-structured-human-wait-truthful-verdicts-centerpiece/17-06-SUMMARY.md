---
phase: 17-structured-human-wait-truthful-verdicts-centerpiece
plan: 06
subsystem: deploy
tags: [wait-01, wait-02, wait-03, wait-04, deploy, beaaa, v1.6.0, version-bump, live-drill, no-storm, partial-drill]
requires:
  - "17-01 engine + migration 0018 + clarity-human-wait-repo"
  - "17-02 applyStructuredWait + waitMap merged at all three root-meta sites"
  - "17-03 Editor-Agent producer (human-wait-detect) wired as a governed heartbeat sibling"
  - "17-04 Reader breadcrumb + ref-card legibility fold-ins"
  - "17-05 full 4x8 SC5 anti-regression matrix"
provides:
  - "v1.6.0 shipped to live BEAAA (AriClaw DO droplet), status=ready, migration 0018 accepted"
  - "two-source version bump 1.5.1 -> 1.6.0 (package.json + src/manifest.ts byte-identical; dist/manifest.js carries it)"
  - "live drill verdict: no-storm + no-false-positive + Reader-foldins(worker) PASS; live-positive structured-wait demo DEFERRED (env-gated)"
affects:
  - package.json (version 1.6.0)
  - src/manifest.ts (version literal 1.6.0)
  - live BEAAA instance (plugin reinstalled, embedded PG namespace migration 0018 applied)
tech-stack:
  added: []
  patterns:
    - "single-connection deploy (scp tarball+LF script together, one ssh sed+bash) after fail2ban tripped on the rapid rm/scp/sha burst (runbook gotcha #10)"
    - "no-storm proven by absence: worker 0% CPU, 0 unstable restarts, only compile-bulletin (1/min ~40ms), no wake cascade, no 502 — the 16.1 governance keeps the editor correctly dormant on a quiet queue"
key-files:
  created: []
  modified:
    - package.json
    - src/manifest.ts
decisions:
  - "Task 1 (green gate + bump + rebuild): COMPLETE. 2720 pass / 7 fail; the 7 are pre-existing planning-doc traceability gates (CHAT-/CTT- rows absent from REQUIREMENTS.md at BOTH pre-phase d420706 and HEAD) — not phase-17 regressions. Left untouched; retire those legacy tests separately."
  - "Task 2 (live install): COMPLETE. fail2ban locked SSH+tunnel mid-upload (same source IP killed the established tunnel too); waited out the ban (~15m) and redeployed in a single connection. plugin-loader logged version=1.6.0 status=ready; migration 0018 accepted (a rejected migration blocks ready). Bookend = DO automated daily backup per the autonomous-deploy authorization (no safety-CLI on box)."
  - "Task 3 (live drill): PARTIAL — 4 of 5 checks verified live; the 5th (a live structured-wait reading needs-you across all four surfaces) is environmentally deferred, NOT a code gap."
  - "NO-STORM: PASS (definitive). Worker 0% CPU, 0 unstable restarts, only the 1/min compile-bulletin job (~40ms), no cascade, no 502. The Phase-16.1 governance holds with the new detection path riding the heartbeat."
  - "NO-FALSE-POSITIVE: PASS. Zero structured-wait rows exist; the high-precision detector (D-03 default-false) is correctly silent on a healthy queue."
  - "Reader fold-ins (worker side, D-11/D-12): PASS. issue.reader payload shows the mission-paragraph goal dropped from ancestry; routable flags + prefix-less url emitted (parent routable w/ url, project plain). UI-side render (D-12 link, D-13 plain-word status) needs an opted-in browser session (deferred)."
  - "LIVE-POSITIVE demo DEFERRED: the new structured-wait only lights up when the Editor-Agent heartbeat is woken over a genuinely blocked-on-human issue (16.1-governed wake) AND an opted-in operator views the surfaces. BEAAA-972 (the historical canonical case) is no longer in a blocked-awaiting state (absent from the live blocked backlog — the live agents moved it on). editor.pause-status returns OPT_IN_REQUIRED for the local-board pseudo-user, confirming the surfaces are per-user opt-in gated (coexistence guarantee #1). Backed at code level by the 17-05 4x8 matrix (16/16). Re-drill when Eric points at a current awaiting-decision issue from his opted-in session, or authorizes a seed."
  - "Observed (benign): the pm2 restart bounced the embedded Postgres, producing transient 'database system is shutting down' query errors at the 07:48:46 restart window (reconcileProductivityReviews + routine_triggers). Worker recovered clean at 07:49:03. Not ongoing; consider plugin hot-reload (which install already triggers) sufficient and skip the extra pm2 restart next deploy to avoid the PG bounce."
metrics:
  duration: ~75m (incl. ~30m fail2ban wait + ~15m heartbeat wait)
  tasks_completed: 2.8
  files_created: 0
  files_modified: 2
  tests_passing: 2720
  completed: 2026-06-11
---

# 17-06 SUMMARY — Ship the structured-wait centerpiece to BEAAA (v1.6.0)

## What shipped
v1.6.0 — the structured-human-wait centerpiece (migration 0018, the Editor-Agent
human-wait producer, the priority-0 AWAITING_HUMAN engine branch, the SC5 three-site
merge, the full 4x8 anti-regression matrix) plus the Reader legibility fold-ins —
is **live on BEAAA**, `status=ready`, migration 0018 accepted, version label correct.

## Task-by-task

### Task 1 — green gate + two-source bump + rebuild — COMPLETE (commit a7ead17)
- `tsc --noEmit` clean; `node --test` = **2720 pass / 7 fail** (the 7 are pre-existing
  `04`/`04.1` traceability gates asserting legacy CHAT-/CTT- rows that are absent from
  `REQUIREMENTS.md` at both the pre-phase commit `d420706` and HEAD — identical before
  and after Phase 17; not regressions).
- Version **1.6.0** in BOTH `package.json` and `src/manifest.ts` (byte-identical);
  `dist/manifest.js` carries 1.6.0; SDK inlined (`paperclipInvocation`=5);
  `migrations/0018_structured_human_wait.sql` ships in the package (`files: [dist/, migrations/, README.md]`).

### Task 2 — bookend + live BEAAA reinstall — COMPLETE
- **fail2ban incident:** the runbook's multi-step upload (rm → scp → sha = rapid SSH
  connections) tripped fail2ban; both port 22 AND the forwarded localhost:3100 tunnel
  went dark (same source IP). Waited ~15m for the ban to clear, then redeployed as a
  **single connection** (scp tarball+LF script together, one `ssh "sed -i 's/\r$//' … && bash …"`).
  Nothing had landed on the box during the failed attempt; BEAAA stayed on 1.5.1 untouched.
- Install: `plugin-loader: plugin installed successfully … version:"1.6.0"`,
  `key=clarity-pack status=ready version=1.6.0 id=a763176a-…`. Migration 0018 accepted
  (a rejected migration blocks `ready`). Built from pushed commit `a7ead17` (sha `ca029774…`
  matched on the box). Bookend = DO automated daily backup (autonomous-deploy authorization).

### Task 3 — live drill — PARTIAL (4/5 checks live-verified)
| Check | Verdict | Evidence |
|-------|---------|----------|
| No storm (16.1 holds) | **PASS** | worker 0% CPU, 0 unstable restarts, only compile-bulletin 1/min ~40ms, no cascade, no 502, `situation.snapshot` 200 in 0.22s |
| No false positive (D-03) | **PASS** | zero structured-wait rows; detector correctly silent on a healthy queue |
| Reader fold-ins (worker, D-11/D-12) | **PASS** | `issue.reader` ancestry drops the mission goal; `routable`+prefix-less `url` correct (parent routable, project plain) |
| Engine + SC5 live | **PASS** | snapshot serves consistent AWAITING_HUMAN/AWAITING_AGENT_STUCK across the rollup |
| Live structured-wait reads needs-you on all 4 surfaces | **DEFERRED** | gated on a 16.1-governed editor wake over a real blocked-on-human issue + an opted-in operator session; BEAAA-972 has moved on; `editor.pause-status`→OPT_IN_REQUIRED for the pseudo-user. Code-proven by 17-05 (16/16). |

## Follow-up (handed to Eric)
A targeted positive re-drill when a current issue is genuinely blocked on his decision
(or he authorizes seeding one): from his opted-in browser session, confirm that issue
reads needs-you on Reader / Situation Room / Bulletin / Chat, and that the breadcrumb/
ref-card fold-ins render (D-12 link, D-13 plain-word status). Optional deploy refinement:
skip the extra `pm2 restart` (the plugin install already hot-reloads) to avoid bouncing
embedded Postgres.
