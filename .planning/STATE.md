---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-14T15:40:00Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 11
  completed_plans: 5  # 02-04 Tasks 1-3 complete; Task 4 awaiting human rehearsal — full plan-close pending
  percent: 30
  phase_1_status: COMPLETE — SAFE-01..05 all green; rehearsal PASS 2026-05-13 against Hostinger Countermoves (hosted Postgres). Plan 01-05 cleanup landed 2026-05-13 — pg-dump-locator with bundled-first discovery + version pre-check + dbUrl auto-derivation + operator-gotchas.md catalog. All 3 Phase 2 spike defects now disposed: defect-1 fixed (mode-detect), defect-2 fixed (locator), defect-3 documented (version-mismatch is inherent to pg_dump; clean error path + runbook workaround shipped). Full safety CLI suite: 122 pass / 0 fail.
  phase_2_status: EXECUTING — Plan 02-04 Tasks 1-3 COMPLETE 2026-05-14T15:39Z (suite 141→266 tests, 6 commits 0eabd63..11d0680, opt-in gate + Situation Room + coexistence CI). Task 4 AWAITING HUMAN — checkpoint:human-verify gate; operator runs manual rehearsal against local Paperclip clone per 02-04-PLAN.md <how-to-verify> sections A-E. On 'approved — phase 2 closed', a continuation agent closes Phase 2. Prior: Plans 02-01 PARTIAL (Check B Linux-deferred), 02-02 COMPLETE 2026-05-13, 02-03+02-03b+02-03c CLOSE TOGETHER 2026-05-14T09:08+ on rehearsal verdict 'approved — reader green'. 3 follow-on plans filed (02-05 React keys, 02-06 LiveBlockerPanel UX, 02-07 ActivityTimeline date) — non-blocking polish.
---

# State: Clarity Pack

**Initialized:** 2026-05-07
**Last updated:** 2026-05-07

## Project Reference

**What:** A Paperclip plugin (`clarity-pack`) that adds four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of an unmodified Paperclip install, for a solo founder running Paperclip's agent-driven org chart on the live BEAAA insurance project.

**Core Value:** Zero rabbit-holes - every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

**Current Focus:** Phase 2 — executing. Plan 02-04 Tasks 1-3 COMPLETE 2026-05-14T15:39Z (suite 141→266; 6 commits 0eabd63..11d0680). Task 4 AWAITING HUMAN — manual rehearsal against local Paperclip clone closes Phase 2 on 'approved — phase 2 closed' verdict. Plans 02-03 + 02-03b + 02-03c CLOSED 2026-05-14 on prior rehearsal verdict 'approved — reader green'.

## Current Position

Phase: 2 (Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In) — **EXECUTING (Plan 02-04 awaiting Task 4 human rehearsal)**
**Plans (post 02-04 Tasks 1-3 close):**
  - 02-01 PARTIAL — smoke spike (Linux Check B deferred — non-blocking, accepted)
  - 02-02 COMPLETE 2026-05-13 — scaffold + 6 primitives + trust-model hardening
  - 02-03 + 02-03b + 02-03c CLOSED TOGETHER 2026-05-14T09:08+ — Editor-Agent + Reader view + companyId resolver + drill APPROVED on Countermoves COU-1
  - 02-04 Tasks 1-3 COMPLETE 2026-05-14T15:39Z — opt-in gate + Situation Room + coexistence CI (16 reqs: OPTIN-01..05 + ROOM-01..08 + COEXIST-06)
  - 02-04 Task 4 AWAITING HUMAN — manual rehearsal against local Paperclip clone closes Phase 2
  - 02-05 + 02-06 + 02-07 DEFERRED follow-ons (React keys / LiveBlockerPanel UX / ActivityTimeline date) — non-blocking, can interleave with Phase 3
**Status:** 02-04 Tasks 1-3 commits 0eabd63 (Task 1 RED) → 3a8a6aa (Task 1 GREEN) → 05dcb88 (Task 2 RED) → 25a4ea7 (Task 2 GREEN) → 81cf2ab (Task 3 RED) → 11d0680 (Task 3 GREEN). Suite 141→266 tests, 0 fail. Typecheck + build + coexistence run-all all clean.
**Progress:** [###       ] 1/5 phases complete; Phase 2 ~71% by plan count (5/7 incl. 02-04 partial; 02-03b superseded)

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

**Last session:** 2026-05-14T15:08-15:39 — Plan 02-04 Tasks 1-3 executed end-to-end with strict TDD discipline (RED→GREEN per task; 6 commits). Task 1 ships the opt-in gate: clarity_user_prefs migrations idempotent guard; wrapDataHandler / wrapActionHandler + EXEMPT_HANDLER_KEYS Set; get-opt-in + set-opt-in + get-instance-config handlers; useOptIn hook; EnableClarityCta + SettingsPage UI; every 02-02/02-03 handler wrapped (OPTIN-04). DEVIATION DEV-01 was the major one: SDK 2026.512.0 PluginContext has NO `host` field, so the plan's `ctx.host.currentUserId` pattern was structurally impossible — followed the 02-03b convention (UI threads userId via useHostContext + params; worker reads params). Task 2 ships the Situation Room: 60s recompute-situation cron job; situation.snapshot + active-viewer-ping handlers; useLeaderElection + usePollWithLeader + createLeaderBroadcast (the revision iteration 2 follower-postMessage-bridge contract is asserted by a two-tab test using a pure in-memory channel bus, no React); useInstanceConfig FALLBACK (per 02-01 Check F LOCKED); AgentCard + CriticalPathStrip + AwaitingYouPill + ArtifactsShippedShelf + Sparkline subcomponents matching the sketches mockup. Task 3 ships the coexistence CI: six COEXIST-01..06 scripts + run-all.mjs + .github/workflows/coexistence.yml; SQL-comment-stripping so doc-comments don't trigger false positives (DEV-02). Suite 141→266 tests. Plan 02-04 Task 4 (manual rehearsal against local Paperclip clone) is the only remaining work for Phase 2 closure.

**Next session resume point:** Operator runs Plan 02-04 Task 4 manual rehearsal — see 02-04-PLAN.md `<how-to-verify>` sections A-E. On 'approved — phase 2 closed' verdict, a continuation agent runs the closure (update STATE.md, ROADMAP.md to phase-2-complete; mark requirements complete). The 3 deferred follow-ons (02-05 React keys, 02-06 LiveBlockerPanel UX, 02-07 ActivityTimeline date) can interleave with Phase 3 — non-blocking.

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
