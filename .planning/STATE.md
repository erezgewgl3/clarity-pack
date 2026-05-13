---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-13T23:50:00.000Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 8
  completed_plans: 4
  percent: 20
  phase_1_status: COMPLETE — SAFE-01..05 all green; rehearsal PASS 2026-05-13 against Hostinger
  phase_2_status: PLANNED — 4 plans (02-01..02-04) verified by checker on 2nd iteration; 48/48 reqs covered; ready for /gsd:execute-phase 2
---

# State: Clarity Pack

**Initialized:** 2026-05-07
**Last updated:** 2026-05-07

## Project Reference

**What:** A Paperclip plugin (`clarity-pack`) that adds four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of an unmodified Paperclip install, for a solo founder running Paperclip's agent-driven org chart on the live BEAAA insurance project.

**Core Value:** Zero rabbit-holes - every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

**Current Focus:** Phase 2 — Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In (planned 2026-05-13; ready to execute)

## Current Position

Phase: 2 (Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In) — **PLANNED** (4 PLAN.md files; checker PASSED on 2nd iteration; 48/48 reqs covered).
**Phase:** 2 - Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In
**Plans:** 4 plans written and verified 2026-05-13.
  - 02-01 (Wave 1, autonomous): Smoke spike — minimal manifest + worker + migration + detailTab stub; install rehearsal against fresh local Paperclip clone resolves D-01 + D-02 empirically. Reqs: SCAF-03, COEXIST-03.
  - 02-02 (Wave 2, autonomous): Scaffold + trust-model hardening + 6 shared primitives. Reqs: SCAF-01/02/04..09 + PRIM-01..06 + COEXIST-01 + COEXIST-04 (16).
  - 02-03 (Wave 3, mixed — manual checkpoint for governance parity): Editor-Agent skeleton + Reader view tab. Reqs: EDITOR-01..06 + READER-01..09 + COEXIST-02 (16).
  - 02-04 (Wave 4, mixed — manual checkpoint for visual fidelity + Phase 2 closure): Situation Room + opt-in gate + coexistence CI. Reqs: OPTIN-01..05 + ROOM-01..08 + COEXIST-06 (14).
**Status:** All 11 locked decisions (D-01..D-11) honored. Checker found 6 warnings on first pass; all resolved in revision pass; final verdict VERIFICATION PASSED with 0 blockers. Plans ready for `/gsd:execute-phase 2`.
**Progress:** [##        ] 1/5 phases complete; Phase 2 planned (4 plans, 48 reqs covered)

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1 requirements | 79 |
| Phases | 5 |
| Granularity | coarse |
| Plans complete | 3 (all of Phase 1) |
| Phases complete | 0/5 (Phase 1 awaiting rehearsal) |
| Phase 1 tests | 103 (Plan 01: 48, Plan 02: 33, Plan 03: 22) — 103/103 passing |
| Phase 1 commits | 11 (RED + GREEN + docs across 3 plans) |

## Accumulated Context

### Locked Decisions (carry across phases)

1. **Plugin form factor** - one TypeScript package, one manifest, one UI bundle exporting many React components by name, one out-of-process Node worker over JSON-RPC stdio. Not four plugins per surface.
2. **Hybrid chat persistence** - real-time UI but durable as ordinary `public.issue_comments`; attachments as Paperclip work-products. Single source of truth = `issue_comments`.
3. **Editor-Agent governance parity** - declared in manifest `agents[]`, reconciled per-company via `ctx.agents.managed.reconcile()`. Inherits Paperclip heartbeat + budget caps + pause/terminate + audit log automatically. No custom `setInterval` daemon.
4. **Default landing = Paperclip classic dashboard** - Clarity views are opt-in clicks, never overrides.
5. **v1 audience = Eric on BEAAA only** - Clipmart submission deferred; multi-tenant work out of scope.
6. **Bulletin cadence = 06:30 ET scheduled** + Situation Room on-view recompute every 60s (configurable via `instanceConfigSchema`).
7. **Pre-install backup + rollback discipline before any production action** - Phase 1 ships snapshot/restore scripts and a working rollback drill before any feature code touches BEAAA. Bookended-by-snapshots rule applies forever.
8. **Stack pins are forced by the plugin contract** - React 19 (peer-only, never bundled), TypeScript ^5.7.3, esbuild ^0.27.3, ESM-only, Node >=20, shadcn `new-york`/neutral/lucide. Tailwind inherited from host CSS.
9. **Paperclip default branch is `master`, not `main`** - all doc URLs and CI references must use `/blob/master/...`.
10. **Plugin UI runs as same-origin trusted JS** (not iframed) - manifest capabilities gate worker RPC but NOT UI HTTP fetch. Day-1 mitigations (bridge-only, ESLint rule on raw fetch, pinned lockfile, no postinstall scripts) ship in Phase 2.

### Open Todos

- [x] Run `/gsd:plan-phase 1` to decompose Phase 1 into executable plans.
- [x] Plan 01-01 — Safety CLI core (snapshot/restore/list/prune). Done 2026-05-07.
- [x] Plan 01-02 — Smoke + Verify. Done 2026-05-07.
- [x] Plan 01-03 — Pre-flight gate + runbook (Tasks 1 + 2). Done 2026-05-07.
- [x] Plan 01-03 Task 3 — First rehearsal-drill attempt (Eric, 2026-05-12 against Hostinger Countermoves). FAILED at Step 5 with two real defects surfaced (recorded in REHEARSAL.md § Failed Drill Attempts). Defect 1 fixed in commit 9506a91; Plan 01-04 covers defect 2 + re-rehearsal.
- [ ] **Plan 01-04 — Safety CLI cleanup + re-rehearsal (Eric).** Execute Task 1 (snapshot cache-exclusion) + Task 2 (restore symlink-bifurcation tests) autonomously, then Task 3 (re-rehearsal against Hostinger). On `approved — drill clean`, Phase 1 closes.
- [ ] Resolve 3 conflicts in Phase 2 SPEC.md (slot identity, migrations, refresh cadence) before Phase 2 planning.
- [ ] Verify install command form (`pnpm paperclipai plugin install` vs `pnpm paperclipai install`) by running `pnpm paperclipai plugin --help` against a fresh clone in Phase 2.0 smoke spike.
- [ ] Verify `usePluginStream` direct host-event subscription (for `issue.comment.created`) before Phase 4 design is locked.
- [ ] Verify `comment.updated` event existence in PLUGIN_SPEC §16 before Phase 4 (currently absent in documented minimum set; chat edits modeled as append-with-supersedes).
- [ ] Verify cron timezone interpretation in PLUGIN_SPEC §17 before Phase 3 (use worker-managed `next_due_at` regardless).

### Active Blockers

- **SAFE-02 Part B (rehearsed at least once)** — pending Eric's drill against the fresh local Paperclip clone. Not a code blocker; the gate, runbook, and CLI are all green. The acceptance grep `^\| 20[0-9]{2}-` over `runbook/REHEARSAL.md` flips to PASS the moment Eric appends his first dated drill row.

### Phase History

- **Phase 1 — Pre-Install Safety** (2026-05-07, ongoing pending rehearsal):
  - Plan 01-01: 48 tests, 8 lib modules, snapshot+restore+list+prune CLI, CVE-2026-31802 mitigated, sibling-staging restore. Commits: 620ec0b, e93169e, bac5b84, 9c3148d.
  - Plan 01-02: 33 tests, smoke + verify with deadline-AbortSignal composition + atomic manifest write-back. Commits: 2c2b444, a5d413e, d1bc2db, f5e52c4.
  - Plan 01-03: 22 tests, gate refuse-or-run wrapper + 8-file runbook + 2 launchers. Commits: 8eb37bd (RED), 04c3412 (GREEN), d73485a (runbook).

## Session Continuity

**Last session:** 2026-05-13 — Phase 2 planning completed. Four PLAN.md files written into `.planning/phases/02-scaffold-and-surfaces/`. Plan-checker verified PASSED on iteration 2 (6 first-pass warnings — tsconfig.manifest.json file-list, follower postMessage assertion, useInstanceConfig hook origin, sync vs async hash, PLUGIN_DISABLED vs WORKER_UNAVAILABLE, missing prose-with-ref-chips + deliverable-preview entries — all resolved in revision pass). 48/48 phase requirements covered, no gaps, no duplicates. D-01..D-11 honored across all four plans.

**Next session resume point:** Run `/gsd:execute-phase 2` to execute Wave 1 (Plan 02-01 smoke spike) bookended by `clarity-safety snapshot` per Phase 1 protocol. Plan 02-01 acceptance bar gates D-01 (detailTab vs taskDetailView) and D-02 (plugin-namespace migrations) empirically against a fresh local Paperclip clone before Waves 2..4 execute.

**Files of record:**

- `.planning/PROJECT.md` - core value, locked decisions, constraints
- `.planning/REQUIREMENTS.md` - 79 v1 requirements + traceability to phases
- `.planning/ROADMAP.md` - 5-phase roadmap with success criteria
- `.planning/STATE.md` - this file
- `.planning/research/SUMMARY.md` - research synthesis
- `.planning/research/ARCHITECTURE.md` - build order, shared primitives, contribution-point mechanics
- `.planning/research/FEATURES.md` - table-stakes per surface
- `.planning/research/STACK.md` - forced stack pins
- `.planning/research/PITFALLS.md` - 18 pitfalls with phase assignments

---
*State initialized: 2026-05-07*
