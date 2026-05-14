---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-14T23:00:00Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 12
  completed_plans: 5  # 02-04 PARTIAL still pending Plan 02-08 re-drill closure
  percent: 32
  phase_1_status: COMPLETE — SAFE-01..05 all green; rehearsal PASS 2026-05-13 against Hostinger Countermoves (hosted Postgres). Plan 01-05 cleanup landed 2026-05-13 — pg-dump-locator with bundled-first discovery + version pre-check + dbUrl auto-derivation + operator-gotchas.md catalog. All 3 Phase 2 spike defects now disposed: defect-1 fixed (mode-detect), defect-2 fixed (locator), defect-3 documented (version-mismatch is inherent to pg_dump; clean error path + runbook workaround shipped). Full safety CLI suite: 122 pass / 0 fail.
  phase_2_status: EXECUTING (Plans 02-04 + 02-08 CLOSED PARTIAL 2026-05-15) — Countermoves drill 2026-05-14 / 2026-05-15 proved 12 of 14 Phase 2 reqs (OPTIN-01..05 + ROOM-01..08 + COEXIST-06 modulo Reader detail-tab gap). Situation Room visual fidelity APPROVED side-by-side with sketch. Reader tab fails on /COU/issues/COU-4 because DEV-15-STRUCTURAL: useHostContext().userId returns null in detail-tab slots (exact-shape replay of 02-03c's companyId issue), opt-in-guard fails closed for every wrapped Reader handler. Plan 02-09 FILED for useResolvedUserId resolver hook (same pattern as 02-03c's useResolvedCompanyId) + DEV-16 issue-reader degradation contract tightening. On Plan 02-09 re-drill approval, Phase 2 closes COMPLETE. Drill artifacts: 12 mid-drill defect-fix commits aa70e82..f1d911d landed in-session (DEV-04 migration validator, DEV-06 CSS chrome 402 lines, DEV-07..14 polish cluster, DEV-15 partial UI defense-in-depth). Test count 269→365 (+96, 363 pass / 0 fail / 2 skipped). Tarball deployed sha256 7b8ecc3f, plugin id 0d4fc40a-... (same uuid preserved across all reinstalls — COEXIST-#6 reconfirmed). Prior: 02-01 PARTIAL (Check B Linux-deferred), 02-02 COMPLETE 2026-05-13, 02-03+02-03b+02-03c CLOSED 2026-05-14T09:08+ ('approved — reader green'), 02-04 Tasks 1-3 COMPLETE 2026-05-14T15:39Z but drill 2026-05-14T19:15Z found 8 gap defects (DEV-06..DEV-13) → spawned 02-08; 02-08 Tasks 1-3 COMPLETE 2026-05-14T23:00Z but drill 2026-05-15T00:00+ found DEV-14 (host doesn't auto-load plugin CSS) + DEV-15-STRUCTURAL (detail-tab userId null). Three Phase 3-interleave follow-ons remain non-blocking (02-05/02-06/02-07).
---

# State: Clarity Pack

**Initialized:** 2026-05-07
**Last updated:** 2026-05-07

## Project Reference

**What:** A Paperclip plugin (`clarity-pack`) that adds four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of an unmodified Paperclip install, for a solo founder running Paperclip's agent-driven org chart on the live BEAAA insurance project.

**Core Value:** Zero rabbit-holes - every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

**Current Focus:** Phase 2 — executing. Plan 02-08 Tasks 1-3 COMPLETE 2026-05-14T23:00Z (suite 269→361; 6 commits 2898696..bcfc471) — gap-closure for Plan 02-04 PARTIAL. Task 4 AWAITING HUMAN — Eric re-drills against Countermoves per 02-08-PLAN.md <how-to-verify>. On 'approved — phase 2 closed' verdict, Plan 02-04 flips PARTIAL→APPROVED and Phase 2 closes.

## Current Position

Phase: 2 (Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In) — **EXECUTING (Plan 02-08 awaiting Task 4 Countermoves re-drill)**
**Plans:**
  - 02-01 PARTIAL — smoke spike (Linux Check B deferred — non-blocking, accepted)
  - 02-02 COMPLETE 2026-05-13 — scaffold + 6 primitives + trust-model hardening
  - 02-03 + 02-03b + 02-03c CLOSED TOGETHER 2026-05-14T09:08+ — Editor-Agent + Reader view + companyId resolver + drill APPROVED on Countermoves COU-1
  - 02-04 PARTIAL — Tasks 1-3 COMPLETE 2026-05-14T15:39Z, Task 4 drill 2026-05-14T19:15Z found 8 gap defects DEV-06..DEV-13 → spawned 02-08
  - 02-08 Tasks 1-3 COMPLETE 2026-05-14T23:00Z — gap-closure for 02-04 (CSS chrome + UUID-narration humanization + useOptIn refresh + production esbuild + awaiting-you semantics)
  - 02-08 Task 4 AWAITING HUMAN — Countermoves re-drill closes Plan 02-04 + Phase 2 on 'approved — phase 2 closed' verdict
  - 02-05 + 02-06 + 02-07 DEFERRED follow-ons (React keys / LiveBlockerPanel UX / ActivityTimeline date) — non-blocking, can interleave with Phase 3
**Status:** 02-08 commits 2898696 (Task 1 RED) → dafec55 (Task 1 GREEN) → ef254ab (Task 2 RED) → 30bf4bc (Task 2 GREEN) → 54c2634 (Task 3 RED) → bcfc471 (Task 3 GREEN). Suite 269→361 pass / 0 fail / 1 skip. Typecheck + build + coexistence run-all all clean. dist/ui/index.css grew from 8.2 KB to 17.5 KB.
**Progress:** [###       ] 1/5 phases complete; Phase 2 ~85% by plan count (6/7 incl. 02-04+02-08 partial pairing)

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

**Last session:** 2026-05-14T21:00-23:00 — Plan 02-08 Tasks 1-3 executed end-to-end with strict TDD discipline (RED→GREEN per task; 6 commits 2898696..bcfc471). Closes 8 defects (DEV-06 through DEV-13) surfaced by the 2026-05-14 drill against Countermoves. Task 1 ships ~310 lines of substantive CSS — palette extension, CTA cluster, page chrome (responsive @media at 1180/760px), agent card + terminal-kind variants, critical path, awaiting-you pill, artifacts shelf, sparkline; theme.css 353→755 lines; dist/ui/index.css 8.2 KB→17.5 KB; new test/ui/clarity-pack-css-rules.test.mjs uses parse-based assertion (Node 24 can't reliably evaluate oklch + color-mix via JSDOM). Task 2 ships humanizeChain pure helper: scrubs UUIDs from terminal.label, three-pass rewrite (__unowned__ form + UUID substitution + belt-and-suspenders); shipped agent-only per DEV-11-AGENT-ONLY deviation (SDK 2026.512.0 has no PluginUsersClient — verified by grep on dist/types.d.ts); wired into situation-snapshot job's per-company loop; agent-card.tsx now has nowDoingFallback() for DEV-12. Task 3 ships useOptIn refresh wiring (Path A — SDK exposes refresh() on PluginDataResult), production-mode esbuild define block as defense-in-depth for DEV-08, react-key static analysis catches future regressions; DEV-13 awaitingYouCount fix landed in Task 2's coordinated edit to situation-snapshot.ts. Suite 269→361 pass / 0 fail / 1 skip. Typecheck + build + coexistence run-all all clean.

**Last session (extended):** 2026-05-14 evening through 2026-05-15 early morning — Plan 02-08 Task 4 drill against Countermoves Hostinger. 12 of 14 Phase 2 reqs proven; Situation Room visual fidelity APPROVED on /COU/situation-room (side-by-side with sketches/paperclip-fix-situation-room.html); OPTIN-01..05 all proven. Reader tab on /COU/issues/COU-4 stays stuck in loading state — DEV-15-STRUCTURAL diagnosed: `useHostContext().userId` returns null in detail-tab slots, exact-shape replay of the 02-03c companyId issue. opt-in-guard fails closed for every wrapped Reader handler (issue.reader / flatten-blocker-chain / editor.pause-status / resolve-refs) when params.userId is missing → bridge returns `{error:'OPT_IN_REQUIRED'}` → Reader can't render its data branch. 12 mid-drill defect-fix commits landed (aa70e82 → f1d911d): DEV-04 migration validator + regression test, DEV-06 CSS chrome (theme.css 353→755 lines), DEV-07/08/10/13 polish cluster, DEV-11 humanizeChain helper, DEV-12 now_doing fallback, DEV-14 runtime CSS injection (host doesn't auto-load sibling CSS), DEV-15 partial UI defense-in-depth (AnchoredToCards/AcChecklist/ActivityTimeline null-safety) and structural opt-in-guard accepts viewerUserId fallback + Reader threads userId. Test count 269→365 (+96; 363 pass / 0 fail / 2 skipped). Tarball shasum 7b8ecc3f at 30.7 KB. Plan 02-09 FILED with full Task 1-4 breakdown for useResolvedUserId resolver hook + DEV-16 issue-reader degradation contract tightening.

**Next session resume point:** `/gsd:execute-phase 2 --plan 02-09`. Plan 02-09 has 3 auto-TDD tasks + 1 checkpoint:human-verify (re-drill against Countermoves COU-4). Pre-conditions for executor: ctx.users.* or equivalent identity accessor MUST be verified against `node_modules/@paperclipai/plugin-sdk/dist/ui/types.d.ts` BEFORE coding get-viewer — if the SDK has no path to get the authenticated session's userId from inside a plugin worker, executor must STOP and surface as structural blocker (may require upstream Paperclip change). On Plan 02-09 re-drill approval `approved — phase 2 closed`: continuation agent flips Plans 02-04 + 02-08 + 02-09 SUMMARY statuses → APPROVED, marks 14 Phase 2 reqs Implemented, updates STATE.md (phase_2_status: COMPLETE, completed_phases: 2, percent: 40), updates ROADMAP.md, appends 02-03b-API-SHAPES.md Finding #11 (detail-tab useHostContext userId-null semantics — DEV-15), files MemPalace drawer in clarity_pack/decisions. The 3 Phase 3-interleave follow-ons (02-05/02-06/02-07) remain non-blocking. CLAUDE.md bookended-by-snapshots rule continues to scope to BEAAA only; Countermoves drills omit the bookend with documented rationale per the REHEARSAL.md row.

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
