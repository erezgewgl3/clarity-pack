---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: "Phase 3 EXECUTING. Plan 03-04 (Errata + Failed-Compile Banner + DST CI + Coexistence) auto tasks COMPLETE — RED ec9c08c + GREEN e65088a; errata first-class, failed-compile banner, 4-day DST CI matrix, 7th coexistence check all wired. 03-04-SUMMARY.md filed (status AWAITING-CHECKPOINT). Suite 660 / 658 pass / 0 fail / 2 skip; typecheck clean; 7/7 coexistence checks pass; worker+UI+manifest builds clean. All Phase 3 auto work is done. NEXT: Plan 03-04 Task 3 — Eric's Phase 3 closure drill on Countermoves (errata composer + failed-compile banner + plugin-disable coexistence). On 'approved — phase 3 closed', Phase 3 closes and the milestone advances to Phase 4 (Employee Chat)."
last_updated: "2026-05-16T14:00:00.000Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 21
  completed_plans: 14
  percent: 67
---

# State: Clarity Pack

**Initialized:** 2026-05-07
**Last updated:** 2026-05-07

## Project Reference

**What:** A Paperclip plugin (`clarity-pack`) that adds four user-facing surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) and one Editor-Agent on top of an unmodified Paperclip install, for a solo founder running Paperclip's agent-driven org chart on the live BEAAA insurance project.

**Core Value:** Zero rabbit-holes - every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

**Current Focus:** Phase 3 (Daily Bulletin) — **EXECUTING** — all 5 plans built (03-01/02/03/04/05). Every Phase 3 auto/TDD task is complete and green; session-not-found + Defect A + Defect B all RESOLVED. The only remaining Phase 3 work is **Plan 03-04 Task 3 — Eric's Phase 3 closure drill on Countermoves** (a blocking `checkpoint:human-verify`): errata composer + failed-compile banner + plugin-disable coexistence, end-to-end on the live Hostinger instance. On `approved — phase 3 closed`, Phase 3 closes and the milestone advances to Phase 4.

## Current Position

Phase: 3 (Daily Bulletin) — **EXECUTING** — all 5 plans built (03-01/02/03/04/05); session-not-found + Defect A + Defect B all RESOLVED; every auto/TDD task green. Only Plan 03-04 Task 3 (Eric's Phase 3 closure drill on Countermoves) remains.
**Phase 3 plans:**

  - 03-01 — Foundation: **COMPLETE 2026-05-15** — `0004_bulletin.sql` migration (bulletins incl. `draft_json jsonb` + UNIQUE(next_due_at,content_hash) + bulletin_errata + clarity_department_membership + bulletin_compile_failures) + DST-safe `computeNextDueAt` (date-fns-tz) + bulletins repo (8 fns) + manifest `jobs[]`+capabilities+config + self-loop-filter `BULLETIN_TAG_PREFIX` extension + compile-bulletin no-op job. 3 TDD commits ab217b0..e059d8b; suite 455/453-pass/0-fail/2-skip; typecheck+build green. BULL-01, BULL-02 foundation delivered. SUMMARY: `03-01-SUMMARY.md`.
  - 03-02 — Compile Pipeline: **COMPLETE 2026-05-15** — facts-table.ts (computeFactsTable + replaceSlots) + standing-numbers.ts (STANDING_NUMBER_SLOTS 5-slot registry + computeStandingNumbers) + bulletin-verifier.ts (pure-async verifyDraft, typed mismatch/UNKNOWN_SLOT) + compile-pass-1.ts (cap-then-call LLM + validateDraftSchema, MAX_BULLETIN_TOKENS=6000) + bulletin-rendering.ts (renderBulletinIssueBody) + publish.ts (two-phase write, draft_json W3/W4, UNIQUE idempotency) + compile-bulletin.ts real pipeline (Wave-1 stub replaced) + circuit-breaker BULLETIN_COMPILE_AGENT_KEY. 4 TDD commits 9fe85b2..85c84fb; suite 455→504 (+49; 502 pass/0 fail/2 skip); typecheck+build green. BULL-05/06/09 delivered. 2 Rule-1 auto-fixes (pass-1 recordSuccess counter-reset bug; e2e test-fixture INSERT-index + multiline-regex). SUMMARY: `03-02-SUMMARY.md`.
  - 03-03 — UI + Action Inbox + Dept Reconcile + Lineage: **BUILD COMPLETE; drill PARTIAL 2026-05-15** — bulletin page renders cleanly on Countermoves (warm-paper empty state, no regression on Reader/Situation Room). Populated-layout + W2 (Standing Numbers SQL) + W7 (action-inbox mapping) verification deferred — they need a live compiled bulletin, which is blocked on 03-05's session-adapter defect. 3 autonomous build commits a1f24a5..f1cb14b. Task 1 RED: 7 test files (~61 assertions). Task 2 GREEN: `action-inbox-query.ts` (D-19 mapping — blocked + needs_attention/stalled + viewer-scoped + 30d), `department-reconcile.ts` (role-regex + idempotent UPSERT), `lineage-grouper.ts` (pure deterministic Δt≤300s clustering + 8-node truncation + 100-iter byte-equal), `bulletin-by-cycle.ts` (draft_json typed parse W3/W4, live viewer-scoped action inbox), `bulletin-action-approve/decline.ts` (T-03-16 ownership re-verify), worker.ts +3 register calls. Task 3 GREEN: 6 React components (`bulletin/{index,masthead,action-inbox,department-section,standing-numbers-panel,lineage-footer}.tsx`) + `bulletin.css` (warm-paper palette, Fraunces/Newsreader/JetBrains Mono, scoped `[data-clarity-surface="bulletin"]`, 1100px responsive) + `ui/index.tsx` real BulletinPage + bulletin.css runtime inject + compile-bulletin.ts wired with reconcileDepartments + groupLineageThreads. Suite 504→565 (+61; 563 pass / 0 fail / 2 skip). Typecheck + build clean (UI 69.6 KB min/16.3 KB gz, worker 70.9 KB min/21.9 KB gz). 2 SDK-shape deviations auto-resolved: (a) issues.update has no `resolution` field → Approve/Decline use status='done'; (b) Issue.lastActorId not an SDK field → lineage uses confirmed assigneeUserId. **Task 4 = Eric's Countermoves visual-fidelity drill (checkpoint:human-verify) — pending.** BULL-03, BULL-04. SUMMARY: `03-03-SUMMARY.md` (status AWAITING-CHECKPOINT).
  - 03-04 — Errata + Failed-Compile Banner + DST CI + Coexistence: **BUILD COMPLETE — AWAITING CHECKPOINT 2026-05-16** — auto Tasks 1-2 executed RED→GREEN, 2 TDD commits ec9c08c..e65088a. Task 1 RED: 5 test files / 629 insertions (errata 10, failed-compile-banner 9, dst-ci-matrix 10, idempotency 6, coexistence-bulletin-disable 5). Task 2 GREEN: `bulletin-errata.ts` (data `bulletin.errata.byCycle` + action `bulletin.errata.add`, T-03-22 server-side `compile_status='published'` check, append-only), `bulletin-latest-status.ts` (data `bulletin.latestCompileStatus` → `{kind:'ok'|'failed'}`), `publish.ts` extended with `priorCycleErratumSnapshot` (errata-as-comment on prior cycle's issue after a verified publish, non-fatal on failure, sets `applied_to_issue_comment_id`), `compile-bulletin.ts` one-row-per-retry accounting (attempt_n + 15-min next_retry_at; attempt_n≥3 trips circuit-breaker), `FailedCompileBanner`/`ErrataFooter` React components, settings-page errata composer, `bulletin.css` rules, `07-bulletin-disable.mjs` (7th coexistence check — static `0004_bulletin.sql` scan). Suite 626→660 (+34; 658 pass / 0 fail / 2 skip). Typecheck + worker (159.7 KB)/UI (105.1 KB)/manifest builds clean. 7/7 coexistence checks pass. 0 material deviations. **Task 3 = Eric's Countermoves Phase 3 closure drill (checkpoint:human-verify, blocking) — pending.** BULL-01, BULL-02, BULL-07, BULL-08. SUMMARY: `03-04-SUMMARY.md` (status AWAITING-CHECKPOINT).
  - 03-05 — LLM-Adapter Gap Closure: **BUILD COMPLETE — AWAITING CHECKPOINT 2026-05-15** — Wave-3 gap-closure plan filed after the 03-03 Countermoves drill surfaced that the compile pipeline had no production LLM wiring (`ctx.llm` does not exist on SDK 2026.512.0 PluginContext). 3 TDD commits 993b8fe..f6da35c. Task 1 RED: `test/worker/agents/session-llm-adapter.test.mjs` (11 tests, 7 behaviors). Task 2 GREEN: `src/worker/agents/session-llm-adapter.ts` — `sessionLlmAdapter(ctx,{agentId,companyId,taskKeyPrefix?,timeoutMs?})` returns a real LlmAdapter whose `complete()` opens an agent chat session via `ctx.agents.sessions.create`, accumulates `chunk` events (skipping stderr) through `sendMessage`'s `onEvent`, resolves the accumulated string on the terminal `done` event, rejects on `error` or after `SESSION_TIMEOUT_MS` (120s default), closes the session in a `finally`; guards agent status (paused/terminated/pending_approval/null → tagged `AGENT_NOT_INVOKABLE` before any session opens). Task 3: compile-bulletin job builds the adapter per-company from `ctx.agents`+`editorAgentId` and resumes the manifest-`paused` Editor-Agent before the first compile; editor heartbeat path builds the same adapter and passes it to `compileTldr` (Phase 2 Reader TL;DR production wiring closed); `CompileBulletinCtx`/`EditorHeartbeatCtx` lose the synthetic `llm` member; `worker.ts` drops the `as unknown as CompileBulletinCtx` cast; manifest gains `agent.sessions.create/list/send/close`. Suite 565→582 (+17; 580 pass / 0 fail / 2 skip). Typecheck + worker/UI/manifest builds clean. 0 deviations — plan executed exactly as written. **Task 4 — Countermoves production-compile drill RUN 2026-05-15 evening: did NOT pass.** The drill fixed 6 compile-path defects (commits cc8bf62..e8f1a01) and got the job running end-to-end, but the compile fails at the LLM call: `sendMessage` rejects `Session not found`. **OPEN BLOCKER** — see `.planning/debug/bulletin-compile-session-not-found.md`. BULL-05, BULL-06, BULL-09 NOT yet verified live. SUMMARY: `03-05-SUMMARY.md`.

**Compile-path defects fixed during the 2026-05-15 Countermoves drill:**
  1. `cc8bf62` — migration `0004` apostrophe in a `--` comment broke the host's greedy SQL string-stripper (statement misclassified non-DDL). Added `test/migrations/ddl-prefix-validator.test.mjs`.
  2. `db07cef` — host plugin-migration validator has no `extractQualifiedRefs` pattern for `CREATE INDEX` → rejected. Dropped the 4 indexes (PK/UNIQUE constraints cover access paths).
  3. bootstrap row auto-assigned `cycle_number 1`, colliding with the first real compile's cycle-1 publish on the bulletins PK. Bootstrap now uses sentinel `cycle_number 0`.
  4. `897287e` — `compile-bulletin.ts` used a local `EDITOR_AGENT_KEY='clarity-pack-editor-agent'`; the manifest declares `'editor-agent'` → `reconcile` threw every fire. Now imports the key from `editor.ts`; added `editor-agent-key-consistency.test.mjs`.
  5. `b527d08` — the host forwards only fixed plugin-log fields and drops custom metadata (`err`); error text now folded into the log message string.
  6. `ece2b78` — `bulletins-repo.ts` ran INSERTs through `ctx.db.query` (host-restricted to SELECT). All writes → `ctx.db.execute`. `94fd6ad` — test fakes hardened host-faithful.

**Phase 3 artifacts:** `03-CONTEXT.md` (synthesized — no discuss-phase, yolo mode), `03-RESEARCH.md`, `03-PATTERNS.md` (30/30 Phase 2 analog coverage), 4 PLAN.md files. plan-checker VERIFICATION PASSED after revision 1.

---

Phase: 2 (Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In) — **COMPLETE 2026-05-15 ✓**
**Plans:**

  - 02-01 PARTIAL — smoke spike (Linux Check B deferred — non-blocking, accepted)
  - 02-02 COMPLETE 2026-05-13 — scaffold + 6 primitives + trust-model hardening
  - 02-03 + 02-03b + 02-03c CLOSED TOGETHER 2026-05-14T09:08+ — Editor-Agent + Reader view + companyId resolver + drill APPROVED on Countermoves COU-1
  - 02-04 APPROVED 2026-05-15 — Situation Room + Opt-In + Coexistence CI (via 02-08 → 02-09 closure chain)
  - 02-08 APPROVED 2026-05-15 — Situation Room gap-closure polish (CSS chrome + UUID-narration humanization + useOptIn refresh + prod esbuild + awaiting-you semantics)
  - 02-09 APPROVED 2026-05-15 — DEV-15-STRUCTURAL closure via UI-side `useResolvedUserId` resolver (DEVIATION from plan text — worker get-viewer infeasible; SDK has no caller-identity accessor) + DEV-16 issue-reader degradation contract locked
  - 02-05 + 02-06 + 02-07 + 02-10 DEFERRED follow-ons (React keys / LiveBlockerPanel UX / ActivityTimeline date / Vite WS console noise) — non-blocking, can interleave with Phase 3

**Status:** Phase 2 close-out commit chain a49e720..7b5f1be (Plan 02-09 RED→GREEN tasks 1-3 + SUMMARY + Finding #11). Final suite 422 tests / 420 pass / 0 fail / 2 skip. Typecheck + build clean. dist/ui/index.js 67.8 KB; dist/worker.js 38.9 KB.
**Progress:** [###       ] 2/5 phases complete; Phase 3 ~50% by plan count (2/4 — Foundation + Compile Pipeline done)

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
| Plan 03-01 | ~38 min, 3 TDD commits, 13 files (8 created), suite 422→455 (+33; 453 pass / 0 fail / 2 skip) |
| Plan 03-02 | ~42 min, 4 TDD commits, 15 files (13 created), suite 455→504 (+49; 502 pass / 0 fail / 2 skip) |

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
11. **Bulletin scheduling = worker-managed `next_due_at`, not the manifest cron** (Plan 03-01 / D-12) - the `jobs[]` cron string `*/1 * * * *` is a heartbeat hint only; `bulletins.next_due_at` (computed via `date-fns-tz` `computeNextDueAt` in `America/New_York`) is the DST-safe source of truth. The compile-bulletin job fires only when `now >= next_due_at`. date-fns-tz@3.2.0 chosen over luxon (tree-shakeable ESM; 10.34 KB gz worker bundle).
12. **Bulletin-compile circuit-breaker `recordSuccess` is pipeline-scoped, not pass-scoped** (Plan 03-02) - `recordSuccess(BULLETIN_COMPILE_AGENT_KEY)` fires exactly once after a *verified publish*, never after pass-1's parse. A draft that pass-1 accepts but the pass-2 verifier rejects must accumulate toward the 3-rejection circuit-breaker trip; resetting the shared counter on pass-1 success would let verifier-rejected drafts escape the trip wire. `BULLETIN_COMPILE_AGENT_KEY = 'bulletin-compile'` keeps bulletin failures isolated from compile-tldr's counter.

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
- **BULLETIN-COMPILE-SESSION (RESOLVED 2026-05-16)** — root cause was NOT sync-vs-async; it was the host taskKey namespace contract. `sessions.create` stores a caller `taskKey` verbatim, but `sendMessage`/`close`/`list` only find sessions whose taskKey is `LIKE 'plugin:<pluginKey>:session:%'`. The adapter passed `clarity-pack:bulletin:cycle-N:<ts>` → every lookup filtered it out → permanent "Session not found". Fix: omit `taskKey` so the host generates a conforming one (`f0ff821`/`4a904e4`). Confirmed fixed on the 2026-05-16 Countermoves re-drill. Full investigation: `.planning/debug/bulletin-compile-session-not-found.md`.
- **DEFECT-B (RESOLVED 2026-05-16, quick task 260516-gx4)** — `compilePass1` rejected valid `BulletinDraft` JSON as `LLM output was not valid JSON` whenever the Editor-Agent wrapped it in a ```json fence or a prose preamble. Fixed by `extractJsonObject` (pure fenced-block peel → brace-balanced quote-aware scan) wired into `compilePass1` (commit `4ed04b1`); genuinely-non-JSON output still hits `recordFailure` with the identical rejection. 15 TDD tests. A confirming Countermoves drill still pending for BULL-05/06/09 live verification — but it now confirms rather than discovers, since the whole compile path is host-faithful-testable locally.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260516-gx4 | Compile-path host-faithful test-hardening pass + Defect B JSON-extraction fix | 2026-05-16 | 4ed04b1 | [260516-gx4-compile-path-host-faithful-test-hardenin](./quick/260516-gx4-compile-path-host-faithful-test-hardenin/) |

### Phase History

- **Phase 1 — Pre-Install Safety** (2026-05-07, ongoing pending rehearsal):
  - Plan 01-01: 48 tests, 8 lib modules, snapshot+restore+list+prune CLI, CVE-2026-31802 mitigated, sibling-staging restore. Commits: 620ec0b, e93169e, bac5b84, 9c3148d.
  - Plan 01-02: 33 tests, smoke + verify with deadline-AbortSignal composition + atomic manifest write-back. Commits: 2c2b444, a5d413e, d1bc2db, f5e52c4.
  - Plan 01-03: 22 tests, gate refuse-or-run wrapper + 8-file runbook + 2 launchers. Commits: 8eb37bd (RED), 04c3412 (GREEN), d73485a (runbook).

## Session Continuity

**Last session:** 2026-05-14T21:00-23:00 — Plan 02-08 Tasks 1-3 executed end-to-end with strict TDD discipline (RED→GREEN per task; 6 commits 2898696..bcfc471). Closes 8 defects (DEV-06 through DEV-13) surfaced by the 2026-05-14 drill against Countermoves. Task 1 ships ~310 lines of substantive CSS — palette extension, CTA cluster, page chrome (responsive @media at 1180/760px), agent card + terminal-kind variants, critical path, awaiting-you pill, artifacts shelf, sparkline; theme.css 353→755 lines; dist/ui/index.css 8.2 KB→17.5 KB; new test/ui/clarity-pack-css-rules.test.mjs uses parse-based assertion (Node 24 can't reliably evaluate oklch + color-mix via JSDOM). Task 2 ships humanizeChain pure helper: scrubs UUIDs from terminal.label, three-pass rewrite (__unowned__ form + UUID substitution + belt-and-suspenders); shipped agent-only per DEV-11-AGENT-ONLY deviation (SDK 2026.512.0 has no PluginUsersClient — verified by grep on dist/types.d.ts); wired into situation-snapshot job's per-company loop; agent-card.tsx now has nowDoingFallback() for DEV-12. Task 3 ships useOptIn refresh wiring (Path A — SDK exposes refresh() on PluginDataResult), production-mode esbuild define block as defense-in-depth for DEV-08, react-key static analysis catches future regressions; DEV-13 awaitingYouCount fix landed in Task 2's coordinated edit to situation-snapshot.ts. Suite 269→361 pass / 0 fail / 1 skip. Typecheck + build + coexistence run-all all clean.

**Last session (extended):** 2026-05-14 evening through 2026-05-15 early morning — Plan 02-08 Task 4 drill against Countermoves Hostinger. 12 of 14 Phase 2 reqs proven; Situation Room visual fidelity APPROVED on /COU/situation-room (side-by-side with sketches/paperclip-fix-situation-room.html); OPTIN-01..05 all proven. Reader tab on /COU/issues/COU-4 stays stuck in loading state — DEV-15-STRUCTURAL diagnosed: `useHostContext().userId` returns null in detail-tab slots, exact-shape replay of the 02-03c companyId issue. opt-in-guard fails closed for every wrapped Reader handler (issue.reader / flatten-blocker-chain / editor.pause-status / resolve-refs) when params.userId is missing → bridge returns `{error:'OPT_IN_REQUIRED'}` → Reader can't render its data branch. 12 mid-drill defect-fix commits landed (aa70e82 → f1d911d): DEV-04 migration validator + regression test, DEV-06 CSS chrome (theme.css 353→755 lines), DEV-07/08/10/13 polish cluster, DEV-11 humanizeChain helper, DEV-12 now_doing fallback, DEV-14 runtime CSS injection (host doesn't auto-load sibling CSS), DEV-15 partial UI defense-in-depth (AnchoredToCards/AcChecklist/ActivityTimeline null-safety) and structural opt-in-guard accepts viewerUserId fallback + Reader threads userId. Test count 269→365 (+96; 363 pass / 0 fail / 2 skipped). Tarball shasum 7b8ecc3f at 30.7 KB. Plan 02-09 FILED with full Task 1-4 breakdown for useResolvedUserId resolver hook + DEV-16 issue-reader degradation contract tightening.

**Current session:** 2026-05-15 — Plan 02-09 Tasks 1-3 executed end-to-end (orchestrator dispatched gsd-executor). SDK pre-flight verification confirmed the plan's proposed worker `get-viewer` handler is structurally INFEASIBLE: PluginContext has no users/user/session accessor; GetDataParams has no envelope userId; ctx.http.fetch is outbound Node fetch without browser cookies; UI cannot bootstrap a worker get-viewer call without already knowing userId (circular dependency). Per plan's explicit escape hatch ("TBD by handler author"; "STOP if neither path works"), implementation deviated to UI-side fetch of Better Auth's `/api/auth/get-session` (plugin UI is same-origin trusted JS per Decision #10; Better Auth confirmed via 02-03c-HOST-CONTEXT.md:44). 6 commits a49e720..7b5f1be: Task 1 (resolver hook + opt-in-guard empty-string regression test + EXEMPT_HANDLER_KEYS negative-assertion), Task 2 (4 call-site rewires: ref-chip + reader/index + pause-banner + live-blocker-panel), Task 3 (issue-reader.ts degradation contract locked with 8 per-sub-step tests). Suite 365→422 (+57; 420 pass / 0 fail / 2 skip). Typecheck clean. dist/ui/index.js 64.3→67.8 KB. Finding #11 appended to 02-03b-API-SHAPES.md.

**Current session (Phase 3 start):** 2026-05-15 — Plan 03-01 (Daily Bulletin Foundation) executed end-to-end, 3 TDD commits ab217b0..e059d8b. Task 1 RED: 4 new test files (next-due-at 8 DST/determinism tests, self-loop-filter-bulletin 8 tests, 0004-bulletin-schema 11 DDL-contract tests, compile-bulletin-noop 5 tests). Task 2 GREEN: installed date-fns-tz@3.2.0 + date-fns@4.1.0; shipped `src/worker/bulletin/next-due-at.ts` (pure `computeNextDueAt` via toZonedTime/fromZonedTime), `migrations/0004_bulletin.sql` (4 namespace-qualified tables incl. bulletins.draft_json jsonb + UNIQUE(next_due_at,content_hash)), `src/worker/db/bulletins-repo.ts` (8 typed CRUD fns), extended self-loop-filter with `BULLETIN_TAG_PREFIX`, extended `src/shared/types.ts` with 10 bulletin type contracts. Task 3: `src/worker/jobs/compile-bulletin.ts` Wave-1 no-op skeleton + manifest extension (issues.create + issue.comments.create caps, compile-bulletin jobs[] entry, bulletinDepartments + bulletinTimezone config) + worker.ts wiring. 2 Rule-1 auto-fixes (both CI-tooling regex false positives — schema test comment-stripping; COEXIST-02 string-literal reword). Suite 422→455 (+33; 453 pass / 0 fail / 2 skip). Typecheck + build green. Worker bundle 30.6 KB min / 10.34 KB gz (date-fns-tz within budget). SUMMARY: `03-01-SUMMARY.md`.

**Current session (Phase 3 Plan 03-02):** 2026-05-15 — Plan 03-02 (Compile Pipeline) executed end-to-end, 4 TDD commits 9fe85b2..85c84fb. Task 1 RED: 7 new test files / ~49 tests (facts-table 6, standing-numbers 7, verifier 8, compile-pass-1 8, publish 9, end-to-end 6, bulletin-rendering 5). Task 2 GREEN: 3 pure helpers — facts-table.ts (computeFactsTable + format-aware replaceSlots, throws tagged UNKNOWN_SLOT), standing-numbers.ts (STANDING_NUMBER_SLOTS readonly 5-slot registry, static parameterized SQL $1=companyId only, computeStandingNumbers per-slot catch-and-default-0), bulletin-verifier.ts (pure-async verifyDraft, ±0.01 pct/ratio tolerance, typed VerifierResult). Task 3 GREEN: compile-pass-1.ts (cap-then-call LLM kernel mirroring compile-tldr.ts, MAX_BULLETIN_TOKENS=6000, validateDraftSchema), bulletin-rendering.ts (pure renderBulletinIssueBody markdown), publish.ts (two-phase write INSERT attempting → ctx.issues.create → UPDATE published, draft_json persists verified BulletinDraft per W3/W4, UNIQUE(next_due_at,content_hash) idempotency, orphan-safe), circuit-breaker.ts +BULLETIN_COMPILE_AGENT_KEY. Task 4: compile-bulletin.ts Wave-1 stub replaced with the real pipeline (reconcile → cycle number → computeStandingNumbers → computeFactsTable → compilePass1 → verifyDraft → publishBulletin → advance next_due_at; per-company isolation; 3-verifier-rejection circuit-breaker trip). 2 Rule-1 auto-fixes: (a) pass-1 recordSuccess was resetting the shared bulletin-compile counter so verifier rejections couldn't accumulate — moved recordSuccess to the job's post-publish path; (b) e2e test fixture had a wrong INSERT param index + `.`-based UPDATE regex that missed multiline SQL. Suite 455→504 (+49; 502 pass / 0 fail / 2 skip). Typecheck + build green. Worker bundle 136 KB unminified / 63.4 KB min / 19.76 KB gz (gz within RESEARCH.md budget; the `du -k ≤ 60` criterion measures the unminified artifact — measurement-basis note carried from 03-01). BULL-05/06/09 delivered. SUMMARY: `03-02-SUMMARY.md`.

**Current session (Phase 3 Plan 03-05):** 2026-05-15 — Plan 03-05 (LLM-Adapter Gap Closure) Tasks 1-3 executed end-to-end, 3 TDD commits 993b8fe..f6da35c. Closes the production-LLM-wiring gap surfaced by the 03-03 Countermoves drill: the bulletin + TL;DR compile pipelines were built against an injectable synchronous `LlmAdapter` wired in production to `ctx.llm` — which does not exist on SDK 2026.512.0 `PluginContext`. Task 1 RED: `test/worker/agents/session-llm-adapter.test.mjs` (11 tests). Task 2 GREEN: `src/worker/agents/session-llm-adapter.ts` — `sessionLlmAdapter` is a real LlmAdapter over `ctx.agents.sessions.*` (Mechanism 1 from 03-LLM-INVOCATION-RESEARCH.md; the plugin-llm-wiki `startWikiQuerySession` pattern): opens a session, sends the prompt, accumulates `chunk.message` (skip stderr) through `onEvent`, resolves the accumulated string on the terminal `done` event, rejects on `error`, enforces `SESSION_TIMEOUT_MS` (120s) so a stuck session never hangs, closes the session in a `finally`; a paused/terminated/pending_approval/null Editor-Agent rejects with a tagged `AGENT_NOT_INVOKABLE` error BEFORE any session opens. Task 3: compile-bulletin job builds the adapter per-company and resumes the manifest-`paused` Editor-Agent before the first compile; editor heartbeat path builds the same adapter for `compileTldr`; `ctx.llm` fiction + `as unknown as CompileBulletinCtx` cast removed; manifest gains 4 `agent.sessions.*` caps. The synchronous `LlmAdapter` interface is byte-identical so `compilePass1`/`verifyDraft`/`publishBulletin`/`compileTldr` and every stub test are untouched. Suite 565→582 (+17; 580 pass / 0 fail / 2 skip). Typecheck + worker (149.0 KB)/UI (97.5 KB)/manifest builds clean. 0 deviations. SUMMARY: `03-05-SUMMARY.md`.

**Current session (Phase 3 Countermoves production drill):** 2026-05-15 evening — `/gsd:execute-phase 3` ran Waves 1-3 + Plan 03-05; Eric drilled the build on the live Countermoves Hostinger instance. The drill shook out 6 compile-path defects (all the same root cause — the compile path was only stub-tested, so every real host constraint surfaced live), all fixed + committed `cc8bf62..e8f1a01` (see the "Compile-path defects fixed" list under Current Position). Test fakes hardened host-faithful via `test/helpers/host-faithful-db.mjs` (wired into 12 worker test files). The plugin now installs clean on Countermoves and the `compile-bulletin` job runs end-to-end through reconcile → Editor-Agent resume → standing-numbers → facts, failing only at the LLM call. Suite 565→584 (582 pass / 0 fail / 2 skip). One open blocker remains (below). Plan 03-03's visual drill: empty-state PASSED (page renders, no regression); populated verification deferred behind the blocker.

**Current session (Phase 3 Plan 03-04 build):** 2026-05-16 — Plan 03-04 (Errata + Failed-Compile Banner + DST CI + Coexistence) auto Tasks 1-2 executed RED→GREEN, 2 TDD commits ec9c08c..e65088a. Task 1 RED: 5 test files (errata 10, failed-compile-banner 9, dst-ci-matrix 10, idempotency 6, coexistence-bulletin-disable 5). Task 2 GREEN: errata first-class (`bulletin-errata.ts` two-handler file, T-03-22 server-side published-check, append-only), errata-as-comment snapshot in `publish.ts` (non-fatal, `applied_to_issue_comment_id` replay-guard), failed-compile banner (`bulletin-latest-status.ts` + `FailedCompileBanner`/`ErrataFooter` components + settings composer + `bulletin.css`), one-row-per-retry accounting in `compile-bulletin.ts` (attempt_n + 15-min spacing + attempt_n≥3 circuit-breaker), 7th coexistence check `07-bulletin-disable.mjs`. Suite 626→660 (+34; 658 pass / 0 fail / 2 skip). Typecheck + builds clean; 7/7 coexistence. `03-04-SUMMARY.md` filed (status AWAITING-CHECKPOINT) during a `/gsd:resume-work` reconstruction — the executor's auto-checkpoint interrupted before SUMMARY write.

**Next session resume point (set 2026-05-16):** Run `/gsd:resume-work`. Phase 3 has ONE remaining item — **Plan 03-04 Task 3, the Phase 3 closure drill** (`checkpoint:human-verify`, blocking). Eric runs it on the live Countermoves Hostinger instance per `03-04-PLAN.md` Task 3 `<how-to-verify>`: errata composer on the settings page, errata-as-comment on the next cycle, the failed-compile banner (synthetic `bulletin_compile_failures` row), and plugin-disable coexistence. Resume signal: `approved — phase 3 closed` → Phase 3 closes, milestone advances to Phase 4 (Employee Chat); otherwise describe the gap → a 03-06 gap-closure plan (analogous to Phase 2's 02-08/02-09 chain).

**Superseded resume point (2026-05-16 earlier):** The compile-path host-faithful test-hardening pass + Defect B fix — DONE as quick task 260516-gx4 (see Quick Tasks Completed). Kept for history.

Build a comprehensive host-faithful `ctx` fake covering every surface `src/worker/jobs/compile-bulletin.ts` touches (reconcileDepartments → lineage → computeStandingNumbers → computeFactsTable → compilePass1→sessionLlmAdapter → verifyDraft → publishBulletin), plus an end-to-end test that runs `registerCompileBulletinJob` against it and fails locally on any host-contract violation. Extend the two existing precedents — `test/helpers/host-faithful-db.mjs` and `test/helpers/host-faithful-sessions.mjs`. Surfaces to model: `ctx.companies.list`, `ctx.agents.managed.reconcile`, `ctx.agents.get/resume/pause`, `ctx.agents.sessions.*`, `ctx.db.query/execute`, `ctx.issues.list/create/createComment`, `ctx.logger`, `ctx.jobs.register`. Use TDD.

**Host-constraint catalogue the fakes must encode** (each was a live-drill defect):
1. `ctx.db.query` SELECT-only / one statement; `ctx.db.execute` DML-in-namespace-only, returns `{rowCount}`, never rows. *(host-faithful-db.mjs has this.)*
2. `ctx.agents.sessions` — a caller `taskKey` is stored verbatim; `sendMessage`/`close`/`list` only find `taskKey LIKE 'plugin:<pluginKey>:session:%'`; omit `taskKey` → host generates a conforming one. *(host-faithful-sessions.mjs has this.)*
3. `ctx.agents.pause/get/resume` — `agentId` MUST be a real UUID; a non-UUID → host `invalid input syntax for type uuid`. **Not yet in a reusable fake — add it.**
4. `ctx.agents.sessions.sendMessage` throws `Agent wakeup was skipped by heartbeat policy` (≠ "Session not found") if the agent is not invokable. Model it.
5. The host drops arbitrary plugin-log metadata — evidence must be in the message string.
6. Migration SQL validator: apostrophe-in-`--`-comment breaks the string-stripper; `CREATE INDEX` rejected.
7. `bulletins` PK: `cycle_number 0` is the bootstrap sentinel; real cycles start at 1.
8. Editor-Agent: manifest agentKey is `editor-agent`; `EDITOR_AGENT_ID_TAG` (`clarity-pack-editor-agent`) is a TEXT attribution tag only.
9. SDK `Issue` has no `lastActorId`/`lastActorName` — lineage uses `assigneeUserId`.

Then **Defect B** (compilePass1 `LLM output was not valid JSON` — almost certainly the agent wraps JSON in prose/```json fences; TDD a JSON-extraction fix against the host-faithful sessions fake), then **Plan 03-04**, then **Phase 3 verification**.

**Environment:** pnpm is NOT on PATH — build with `node scripts/build-worker.mjs` / `node scripts/build-ui.mjs` / `npx tsc --project tsconfig.manifest.json`; typecheck `npx tsc --noEmit`; suite `node --test "test/**/*.test.mjs"`. Private GitHub backup: `github.com/erezgewgl3/clarity-pack` (remote `origin`, `gh` authed with `workflow` scope — push freely). Plugin page routes are `/<companyPrefix>/<routePath>` (e.g. `/COU/bulletin`). Countermoves psql: `sudo -u postgres psql -d paperclip_countermoves`.

**Phase 2 prior-session note:** Plan 02-09 closed Phase 2 (Countermoves COU-4 re-drill APPROVED 2026-05-15). 14 of 14 verifiable Phase 2 reqs Implemented. Deferred polish plans 02-05/02-06/02-07/02-10 remain non-blocking and can interleave with Phase 3.

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
