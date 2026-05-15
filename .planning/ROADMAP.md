# Roadmap: Clarity Pack

**Created:** 2026-05-07
**Granularity:** coarse (target 5 phases, 1-3 plans each)
**Coverage:** 79/79 v1 requirements mapped
**Core Value:** Zero rabbit-holes - every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

## Phases

- [x] **Phase 1: Pre-Install Safety** - Snapshot, restore, smoke-test, runbook, and pre-flight gate so any clarity-pack action against live BEAAA has bounded blast radius. **CLOSED 2026-05-13** (rehearsal PASS against Hostinger Countermoves; SAFE-01..05 green).
- [x] **Phase 2: Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In** *(completed 2026-05-15)* - Installable plugin with day-1 trust-model hardening, shared primitives, the two on-demand surfaces, the Editor-Agent skeleton, and the per-user opt-in gate. **Closed APPROVED on Countermoves re-drill 2026-05-15** — 14 of 14 verifiable Phase 2 reqs Implemented (OPTIN-01..05 + ROOM-01..08 + COEXIST-06). 4 polish plans (02-05/02-06/02-07/02-10) deferred to interleave with Phase 3.
- [ ] **Phase 3: Daily Bulletin** - 06:30 ET DST-safe scheduled compile with action inbox, department sections, lineage threads, two-pass verifier, and errata as a first-class type.
- [ ] **Phase 4: Employee Chat** - Hybrid real-time chat persisting as ordinary issue comments with optimistic send, attachment graceful-degrade, and coexistence verified by plugin disable.
- [ ] **Phase 5: Distribution & Polish** - npm publish, README + runbook reference, AC auto-status promotion, full-fidelity previewers, lockfile + a11y + visual-regression in CI.

## Phase Details

### Phase 1: Pre-Install Safety
**Goal**: Eric can install, upgrade, migrate, and uninstall clarity-pack against the live BEAAA Paperclip instance with bounded blast radius - rehearsed restore drill on a clone produces a passing smoke test, and no clarity-pack action runs without a verified recent snapshot.
**Depends on**: Nothing (first phase)
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05
**Success Criteria** (what must be TRUE):
  1. A rehearsed restore drill on a non-production Paperclip clone produces a passing smoke test (Paperclip starts, REST API answers, sample issue listable, agent heartbeat fetch succeeds, employee list renders) before any clarity-pack feature code is written.
  2. The pre-flight gate refuses to run any clarity-pack install / upgrade / migration / agent-registration step when the most recent snapshot is older than 15 minutes or its restore-and-smoke-test has not passed.
  3. The runbook walks Eric end-to-end from `pre-install snapshot` -> `install` -> `post-install verification` -> `rollback if needed` in a single document under `runbook/`, and works even when clarity-pack itself is broken or uninstalled.
  4. One-command snapshot captures Postgres dump + filesystem archive of Paperclip's data directory + current Paperclip version + installed-plugin list into one timestamped archive; one-command restore reverses it byte-for-byte.
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Safety CLI core: package + manifest + paths + mode-detect + snapshot + restore + list + prune (SAFE-01, SAFE-02 Part A). Wave 1, autonomous. **Done 2026-05-07** (48 tests; SUMMARY: `01-01-SUMMARY.md`).
- [x] 01-02-PLAN.md — Smoke + verify: paperclip-api REST client + 5-check smoke + verify (SAFE-03). Wave 1, autonomous. **Done 2026-05-07** (33 tests; SUMMARY: `01-02-SUMMARY.md`).
- [x] 01-03-PLAN.md — Pre-flight gate + runbook + first rehearsal-drill attempt (SAFE-04, SAFE-05). Wave 2, mixed (gate autonomous + runbook autonomous + non-autonomous drill). **Done structurally 2026-05-07** (22 tests; SUMMARY: `01-03-SUMMARY.md`). Drill attempted 2026-05-12 against Countermoves Hostinger — FAILED at Step 5 with two real defects surfaced. SAFE-02 Part B closure deferred to Plan 01-04.
- [x] 01-04-PLAN.md — Safety CLI cleanup: snapshot cache-exclusion (defect 2) + restore symlink-bifurcation tests (defect 1 backfill) + re-rehearsal drill against Hostinger (SAFE-01, SAFE-02). Wave 3, mixed. **Done 2026-05-13** — re-rehearsal PASSED end-to-end against Hostinger Countermoves; SAFE-01..05 all green (SUMMARY: `01-04-SUMMARY.md`).
- [x] 01-05-PLAN.md — Safety CLI embedded-postgres + Windows defect cleanup (from Plan 02-01 Task 2 spike findings): pg_dump locator with bundled-binary-first discovery, server/client version pre-check, dbUrl auto-derivation for embedded-postgres mode, new `runbook/operator-gotchas.md` catalog. Wave 4, mixed (Tasks 1-3 autonomous + Task 4 verification on local Windows clone). **Done 2026-05-13** — 13 new tests; 122/123 safety suite pass; defects 1+2 fixed, defect-3 cleanly documented (inherent pg_dump version-match policy). SUMMARY: `01-05-SUMMARY.md`.

### Phase 2: Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In
**Goal**: An installable clarity-pack plugin where Eric can opt himself in via a profile toggle, see Reader view as an additional tab on issue pages with TL;DRs and inline reference resolution, see the Situation Room route with live agent state and transitively-flattened blocker chains, and watch the Editor-Agent compile under standard Paperclip governance - all hardened against the same-origin trust model from day 1.
**Depends on**: Phase 1
**Requirements**: SCAF-01, SCAF-02, SCAF-03, SCAF-04, SCAF-05, SCAF-06, SCAF-07, SCAF-08, SCAF-09, OPTIN-01, OPTIN-02, OPTIN-03, OPTIN-04, OPTIN-05, PRIM-01, PRIM-02, PRIM-03, PRIM-04, PRIM-05, PRIM-06, EDITOR-01, EDITOR-02, EDITOR-03, EDITOR-04, EDITOR-05, EDITOR-06, READER-01, READER-02, READER-03, READER-04, READER-05, READER-06, READER-07, READER-08, READER-09, ROOM-01, ROOM-02, ROOM-03, ROOM-04, ROOM-05, ROOM-06, ROOM-07, ROOM-08, COEXIST-01, COEXIST-02, COEXIST-03, COEXIST-04, COEXIST-06
**Success Criteria** (what must be TRUE):
  1. `pnpm paperclipai plugin install clarity-pack` installs end-to-end against a local Paperclip clone, the smoke spike has resolved the `detailTab` vs `taskDetailView` slot conflict and the plugin-owned-migrations conflict in Phase 2 SPEC.md, and the install completes without any direct or transitive `postinstall` script firing.
  2. An opted-in user opens any issue page and sees an additional Reader view tab (classic tabs unchanged) with a TL;DR strip, inline `BEAAA-NNN` reference chips that resolve in one round-trip, an "Anchored to" section with substantive quote excerpts, a goal-ancestry breadcrumb, a manual acceptance-criteria checklist, an activity timeline, and a right-rail "Live blocker - on you" panel whose chain terminal renders as a single typed `HUMAN_ACTION_ON(user)` / `SELF_RESOLVING` / `EXTERNAL` / `CYCLE` step.
  3. An opted-in user navigates to the Situation Room route and sees one card per Paperclip employee with state pill + age + plain-English "now-doing" + transitively-flattened blocker chain + latest-artifact preview + 7-day velocity sparkline, plus a "Critical Path" strip of up to three chains and an "Artifacts shipped today" shelf - all served from a 60-second worker-materialized snapshot, with polling paused on hidden tabs and one-leader election across multiple open Situation Room tabs.
  4. The Editor-Agent runs as a standard Paperclip employee declared in `agents[]` and reconciled per-company via `ctx.agents.managed.reconcile()`, inherits Paperclip's heartbeat / budget caps / pause-terminate / audit log automatically (verified by pausing it in classic UI and observing compile output halt), filters its own writes from its own triggers to prevent self-loops, enforces a hard `max_tokens` cap per LLM call, and pauses behind a banner after 3 consecutive failures.
  5. A user with no `clarity_user_prefs` row sees the Paperclip classic dashboard as the default landing surface and an "Enable Clarity Pack" inline CTA on each Clarity surface; toggling on writes only the current user's row, and every `getData` / `performAction` handler enforces the opt-in check server-side under the same-origin trust model.
  6. The coexistence verification checklist runs in CI on every PR and fails the build if any of: original UI replaced, any DDL touches `public.*`, plugin-disable destroys data, Editor-Agent has special privileges, or visual-regression detects CSS bleed-through into host UI.
**Plans**: 4 plans
**UI hint**: yes

Plans:
- [ ] 02-01-PLAN.md — Smoke spike: minimal manifest + worker + migration + detailTab stub; install rehearsal against fresh local Paperclip clone resolves D-01 (slot identity) and D-02 (migrations approach) empirically. Wave 1, autonomous.
- [x] 02-02-PLAN.md — Scaffold + trust-model hardening + shared primitives: full four-surface manifest, ESLint no-raw-fetch + no-raw-anchor rules, CSS scope enforcement, usePoll primitive, reference resolver, blocker chain flattener, state pill, ref chip, lockfile + postinstall audit. Wave 2, autonomous. **Done 2026-05-13** — 34 new tests (156/157 total suite pass); SUMMARY: `02-02-SUMMARY.md`.
- [ ] 02-03-PLAN.md — Editor-Agent skeleton + Reader view tab: agents[] manifest declaration, ctx.agents.managed.reconcile, compile-tldr with idempotency + self-loop filter + token cap + circuit breaker + pause banner; Reader tab renders TL;DR strip + ref chips + Anchored-to ref cards + breadcrumb + AC checklist + activity timeline + right-rail Live blocker panel. Wave 3, mixed (manual checkpoint for visual fidelity + governance parity verification).
- [x] 02-04-PLAN.md — Situation Room + opt-in gate + coexistence CI. Tasks 1-3 COMPLETE 2026-05-14T15:39Z (suite 141→266 tests). Task 4 drill 2026-05-14T19:15Z = PARTIAL → spawned 02-08. **APPROVED 2026-05-15** via Plan 02-09 re-drill (`approved — phase 2 closed`); SUMMARY: `02-04-SUMMARY.md`.
- [x] 02-08-PLAN.md — Gap-closure for 02-04 PARTIAL: CSS chrome (DEV-06) + UUID-narration humanization (DEV-11/12) + polish cluster (DEV-07/08/10/13). **APPROVED 2026-05-15** via Plan 02-09 re-drill; SUMMARY: `02-08-SUMMARY.md`.
- [x] 02-09-PLAN.md — DEV-15-STRUCTURAL closure (useResolvedUserId UI-side resolver — DEVIATION from plan text; worker `get-viewer` infeasible per SDK gap analysis, plan's explicit "STOP" escape hatch authorized) + DEV-16 issue-reader degradation contract locked with 8 per-sub-step tests. **APPROVED 2026-05-15** (Countermoves COU-4 re-drill PASS; suite 365→422); SUMMARY: `02-09-SUMMARY.md`. **Closes Phase 2.**
- [ ] 02-10-PLAN.md — Deferred polish bundle: DEV-07 React key warnings (root-cause now that components actually render) + DEV-08 Vite HMR WebSocket noise (02-08 Task 3 esbuild `define` block didn't fully close on host side). Non-blocking — can interleave with Phase 3.

### Phase 3: Daily Bulletin
**Goal**: A 06:30 ET editorial digest auto-compiles each morning - DST-safe across both transitions, idempotent, with a "Requires Your Decision" inbox at the top, department sections with lineage threads, a Standing Numbers panel sourced from SQL (never LLM-generated), a two-pass verifier that rejects on number mismatch, errata as a first-class append-only item type, and an explicit failed-compile banner. The bulletin renders inside Paperclip via the page slot and persists as an ordinary Paperclip issue ("Bulletin No. N") so it survives plugin disable.
**Depends on**: Phase 2
**Requirements**: BULL-01, BULL-02, BULL-03, BULL-04, BULL-05, BULL-06, BULL-07, BULL-08, BULL-09
**Success Criteria** (what must be TRUE):
  1. The bulletin compiles at 06:30 America/New_York via a worker-managed `next_due_at` timestamp computed with `date-fns-tz` or `luxon` (never bare cron interpreted as UTC), and CI tests covering both spring-forward and fall-back DST transitions verify exactly one bulletin compiles per day at the right wall-clock time.
  2. An opted-in user opens the Bulletin route on any morning after 06:30 ET and sees a "Requires Your Decision" inbox at the top with one card per outstanding decision (dept tag + age + summary + Approve/Open/Decline affordances), department sections (Production, Sales, Customer, Builder for v1) with item rows + lineage threads, and a Standing Numbers panel where every number is grep-able to a SQL query against Paperclip core tables.
  3. Re-firing the same `next_due_at` is a no-op (no partially-published bulletins), and a failed compile renders an explicit "Bulletin compile failed at HH:MM - retrying at NN" banner with no silent failures.
  4. Pass-1 generates a draft and pass-2 cross-checks every numeric claim against SQL; only verified output publishes, and adding an erratum to a published bulletin appends rather than rewrites (errata footer visible on next view).
  5. Each bulletin persists as a Paperclip issue named "Bulletin No. N" - disabling the plugin leaves every prior bulletin searchable in classic Paperclip.
**Plans**: 4 plans
**UI hint**: yes

Plans:
- [x] 03-01-PLAN.md — Foundation: 0004_bulletin.sql migration + computeNextDueAt pure-fn (date-fns-tz) + bulletins-repo + extend self-loop-filter for BULLETIN_TAG_PREFIX + manifest extensions (jobs[] compile-bulletin + capabilities issues.create + issue.comments.create + instanceConfigSchema bulletinDepartments+bulletinTimezone) + worker.ts registration + 4 DST CI fixture tests (kernel) + compile-bulletin job no-op skeleton. Wave 1, autonomous. (BULL-01, BULL-02) **COMPLETE 2026-05-15** — 3 TDD commits ab217b0..e059d8b; suite 455/453-pass/0-fail; SUMMARY: `03-01-SUMMARY.md`.
- [x] 03-02-PLAN.md — Compile pipeline: facts-table extractor + STANDING_NUMBER_SLOTS registry + LLM pass-1 (structured BulletinDraft) + deterministic pass-2 verifier + two-phase publish (bulletins INSERT attempting → ctx.issues.create → UPDATE published) + shared/bulletin-rendering markdown renderer + circuit-breaker BULLETIN_COMPILE_AGENT_KEY isolation. Wave 2, autonomous. (BULL-05, BULL-06, BULL-09) **COMPLETE 2026-05-15** — 4 TDD commits 9fe85b2..85c84fb; suite 504/502-pass/0-fail/2-skip; SUMMARY: `03-02-SUMMARY.md`.
- [ ] 03-03-PLAN.md — Bulletin UI page + Action Inbox + Department reconcile + Lineage grouper: 6 React components (Masthead + ActionInbox + DepartmentSection + StandingNumbersPanel + LineageFooter + index page) matching sketches/paperclip-fix-bulletin.html line-by-line; scoped bulletin.css (warm-paper palette, Fraunces+Newsreader+JetBrains Mono fonts); action-inbox-query with D-19 corrected mapping; bulletin.action.approve/decline handlers with viewer-ownership re-verification; department-reconcile role-regex heuristic; lineage-grouper temporal+actor proximity (Δt≤300sec). Wave 3, mixed (Eric drill on Countermoves). (BULL-03, BULL-04)
- [ ] 03-04-PLAN.md — Errata + Failed-compile banner + DST CI matrix + Coexistence: bulletin-errata combined data+action handler with  server-side gate (T-03-22); bulletin-latest-status handler + FailedCompileBanner UI + 3-retry × 15-min spacing + circuit-breaker integration; ErrataFooter UI + settings-page errata composer form; full 4-fixture DST CI matrix (end-to-end pipeline simulation, not just pure-helper); idempotency tests (UNIQUE constraint, content_hash dedup, concurrent fires); new scripts/coexistence-checks/07-bulletin-disable.mjs + extension of Phase 2 coexistence-checklist test. Wave 4, mixed (Eric closure drill on Countermoves). (BULL-01 matrix completion, BULL-02 idempotency completion, BULL-07, BULL-08)

### Phase 4: Employee Chat
**Goal**: A hybrid real-time chat surface where Eric talks per-employee on per-topic threads, every message persists immediately as an ordinary `public.issue_comments` row (canonical) with attachments stored as Paperclip work-products, real-time updates flow via `usePluginStream`, edits are append-with-supersedes, sends are optimistic with rollback-on-failure (idempotent by client `message_uuid`), and disabling the plugin leaves every chat message visible as ordinary threaded comments in classic Paperclip.
**Depends on**: Phase 2 (primitives, opt-in, Editor-Agent), Phase 3 (validates Editor-Agent routine cadence under load)
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09, CHAT-10, CHAT-11
**Success Criteria** (what must be TRUE):
  1. An opted-in user opens the Chat route, sees a left rail of employees + per-employee topic strip + central message thread + right context rail, sends a message that round-trips to `public.issue_comments` (with optimistic render and rollback on failure - never silent loss), and receives near-real-time updates via `usePluginStream` subscribed to `issue.comment.created` filtered by chat-issue ID.
  2. A `chat_topics` table maps each `CHT-NN` topic to exactly one Paperclip issue ID and holds metadata only - message content lives only in `public.issue_comments`; edits are modeled as new comments with a `supersedes`-link to the prior comment.
  3. An attempt to attach a file when the work-products service is unavailable disables the attach button with an explicit "Attachments are temporarily unavailable" message - never silently lost; when available, attachments persist as Paperclip work-products.
  4. Each agent message exposes `Promote to task` and `Pin` affordances, "decision recorded" messages render as a distinct typeform, and the reasoning panel (collapsed by default) shows sources + reasoning bullets when expanded.
  5. Disabling the plugin in Paperclip's classic plugin-admin UI leaves every chat message intact and visible as ordinary threaded comments in classic Paperclip - verified by an automated coexistence test, plus per-employee linear timeline + global search across visible threads work for the current user.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Distribution & Polish
**Goal**: clarity-pack ships as a public npm package installable via `pnpm paperclipai plugin install clarity-pack` with a documented runbook, AC auto-status promoted from Phase 2's manual checklist to event-derived without breaking the manual UX, full-fidelity previewers replacing Phase 2's placeholder (xlsx -> grid, pdf -> embed, md -> rendered, png -> img), and lockfile audit + a11y pass + visual-regression baseline locked into CI.
**Depends on**: Phase 4 (all four surfaces shipped, coexistence proven across each)
**Requirements**: DIST-01, DIST-02, DIST-03, DIST-04, DIST-05, COEXIST-05
**Success Criteria** (what must be TRUE):
  1. `pnpm paperclipai plugin install clarity-pack` installs the published npm package and the `paperclipPlugin` field in `package.json` correctly points the host at `dist/manifest.js`, `dist/worker.js`, and `dist/ui/`.
  2. Acceptance-criteria status on Reader view promotes from manual checklist (Phase 2) to event-derived auto-status without removing or regressing the manual UX path; both modes coexist in v1.
  3. Reader view's "The deliverable" inline preview renders xlsx as a grid, pdf as an embed, md as rendered HTML, and png as an inline image - replacing Phase 2's placeholder for these four file types.
  4. CI runs lockfile audit + accessibility pass (axe-core or equivalent) + visual-regression baseline on every PR; results are recorded in the milestone audit.
  5. A clean uninstall preserves all data (verified end-to-end), the `--purge` flag is opt-in only and is documented in the runbook with explicit pre-flight snapshot guidance, and the README documents install + opt-in toggle + rollback flow + the runbook reference.
**Plans**: TBD
**UI hint**: yes

## Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Pre-Install Safety | 4/4 | COMPLETE ✓ — rehearsal PASS landed | 2026-05-13 |
| 2. Scaffold + Primitives + Reader + Room + Editor + Opt-In | 4/5 (02-04+02-08 PARTIAL paired) | Plan 02-08 Tasks 1-3 complete 2026-05-14T23:00Z; Task 4 re-drill awaiting Eric on Countermoves | - |
| 3. Daily Bulletin | 2/4 | Plans 03-01+03-02 COMPLETE 2026-05-15 (foundation + two-pass compile pipeline: facts-table + verifier + two-phase publish); 03-03..03-04 pending | - |
| 4. Employee Chat | 0/0 | Not started | - |
| 5. Distribution & Polish | 0/0 | Not started | - |

## Coverage Summary

**v1 requirement totals by category:**
- SAFE: 5 (Phase 1)
- SCAF: 9 (Phase 2)
- OPTIN: 5 (Phase 2)
- PRIM: 6 (Phase 2)
- EDITOR: 6 (Phase 2)
- READER: 9 (Phase 2)
- ROOM: 8 (Phase 2)
- BULL: 9 (Phase 3)
- CHAT: 11 (Phase 4)
- COEXIST: 6 (5 in Phase 2, 1 in Phase 5)
- DIST: 5 (Phase 5)

**Total mapped: 79/79 v1 requirements**

**Phase loadings:**
- Phase 1: 5 requirements
- Phase 2: 48 requirements (heaviest by design - 12 of 18 pitfalls land here, all four shared primitives ship here, two surfaces share the primitives, opt-in gate + governance parity verified here)
- Phase 3: 9 requirements
- Phase 4: 11 requirements
- Phase 5: 6 requirements

Phase 2 is intentionally large because the research synthesis ordered the build inside-out (scaffold -> trust-model lint/CSS rules -> primitives -> Editor-Agent skeleton -> Reader view -> Situation Room -> opt-in gate). Splitting it would break shared-primitive validation under two rendering contexts and weaken the day-1 hardening posture.

## Conflicts to Resolve in Phase 2 SPEC.md

Per the research synthesis, three conflicts must be resolved before Phase 2 code is written:

1. **Reader view slot identity** - `detailTab` vs `taskDetailView` (test on a live Paperclip instance; default to `detailTab` per PLUGIN_SPEC §10.1).
2. **Plugin-owned migrations vs `plugin_state` only** - PLUGIN_AUTHORING_GUIDE + working SDK code support `database.migrationsDir` + plugin namespace; PLUGIN_SPEC §21.5 says out of scope. Verify in Phase 2.0 with a minimal `001_init.sql` against a fresh local Paperclip clone before any feature work.
3. **Situation Room auto-refresh cadence** - PROJECT.md says 60s, mockup says 30s. Recommended: 60s default exposed via `instanceConfigSchema`.

## Notes

- **Granularity calibration:** coarse (target 3-5 phases). Final count = 5. Phase 2 is heavy because requirement clustering forces it; compressing into 3 phases would couple primitive validation to Bulletin compilation in a way that violates the goal-backward "what must be TRUE" test for Phase 2.
- **Phase 1 ordering rule:** "Bookended-by-snapshots" - every clarity-pack install / upgrade / schema migration / agent registration that runs against live BEAAA must be bookended by a verified snapshot taken immediately before, and a working rollback path verified at least once before any feature work ships. Phase 1 is non-negotiable and ships before any code in Phase 2 touches BEAAA.
- **COEXIST-06 (CI checklist) lands in Phase 2** since that is where CI is first wired up; later phases extend the checklist as new surfaces ship rather than creating new coexist requirements.

---
*Roadmap defined: 2026-05-07*
*Last updated: 2026-05-07 after initialization (5-phase coarse roadmap; Phase 1 = pre-install safety as hard prerequisite)*
