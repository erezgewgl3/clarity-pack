---
name: on-demand-generate-bulletin-now-button-w
quick_id: 260528-nns
date: 2026-05-28
status: complete
---

# Quick Task 260528-nns — SUMMARY

On-demand "Generate bulletin now" button + content dedupe (`.planning/ON-DEMAND-BULLETIN-SPEC.md`). clarity-pack stays **v1.0.0**, no migration, no new capability. TDD-first. Commit `d15d19f` (code) on master.

## What shipped
- **Shared pipeline (no fork):** extracted the per-company compile body from `registerCompileBulletinJob` into exported `compileBulletinForCompany(ctx, company, { now, bulletinTz, force })` (compile-bulletin.ts). Cron calls it with `force:false` → byte-identical behaviour (same due-gate, bootstrap, `advanceScheduleForCompany`, breaker recording, per-company catch). **Regression net: the full bulletin worker suite stays 212/212 green.**
- **force:true (on-demand):** bypasses the `now>=next_due_at` gate AND the bootstrap early-return; skips `advanceScheduleForCompany` (daily 06:30 schedule pointer untouched); skips breaker failure-table recording (operator action must not trip the auto-pause breaker); dedupes before publish.
- **Dedupe:** `bulletinDedupeHash(draft)` (publish.ts) — a SUBSTANCE hash (action inbox + departments + standing numbers + lineage; **masthead excluded**). The full `content_hash` bakes in the ever-incrementing `No. <n>` / `Operations Cycle <n>` / date (bulletin-rendering.ts:52-55), so a content_hash-equality dedupe could never match. Compared against the last published bulletin's `draft_json` via new `getLatestPublishedBulletin(ctx, companyId)` (bulletins-repo.ts). Equal substance → `{ kind:'no-change' }`, **writes no row**.
- **Action:** `bulletin.compileNow` (bulletin-compile-now.ts, opt-in-guard wrapped, mirrors bulletin-action-approve.ts) → resolves the company, calls `compileBulletinForCompany(force:true)`, maps to `{ published | no-change | error }`. Paused/unavailable agent → graceful `error`. Wired in worker.ts.
- **UI:** "Generate bulletin now" button on the Bulletin page (`GenerateBulletinNow` in bulletin/index.tsx) — states idle / "Compiling…" (disabled) / "Published Bulletin No. N" / "No changes since Bulletin No. N" / "Editorial Desk unavailable — resume it in the Agents panel." Refreshes `bulletin.byCycle` (`usePluginData(...).refresh()`) on a fresh publish. Scoped CSS `.clarity-bulletin-compile-now`.
- UI bundle ceiling 680→684 kB (check-ui-bundle-size.mjs) — legitimate ~3 kB feature delta (695,615→698,689 B), no SheetJS.

## Design note (divergence from spec, documented)
The spec said "dedupe on content_hash." The shipped dedupe uses a masthead-excluded SUBSTANCE hash compared against the last published `draft_json`, because the stored `content_hash` includes the auto-incrementing cycle number/date and would never match between two compiles. This is the faithful implementation of the spec's intent ("no new bulletin when nothing changed").

## Verification (TDD)
- New `test/worker/bulletin/bulletin-compile-now.test.mjs` (7): (a) fresh→publishes cycle N; (b) identical content→no-change + NO new row/issue; (c) paused non-resumable agent→graceful error; (d) daily `next_due_at` pointer UNCHANGED after on-demand; + opt-in gate + missing-companyId throw. All pass.
- New `test/ui/bulletin-compile-now.test.mjs` (7, source-grep): button label, `usePluginAction('bulletin.compileNow')`, three states, Compiling…, refresh, scoped class. All pass.
- Gates: `tsc --noEmit` 0; `check-css-scope` pass (all scoped); full suite **1985 pass / 1 fail** (the brief-documented pre-existing `situation.artifacts ... sorted DESC`); builds clean; `grep -c paperclipInvocation dist/worker.js` = 5; `bulletin.compileNow` present in dist/worker.js (2) + dist/ui/index.js (1); bulletin worker+UI tests **212/212**.

## Deploy — LIVE + VERIFIED on BEAAA (2026-05-28 ~14:27 UTC)
Detached stable-path install to `/home/beai-agent/clarity-pack-live/package`; commit `d15d19f` (pushed master). Result:
- `✓ Installed clarity-pack v1.0.0 (ready)`; pm2 `paperclip` restarted (PID 409069, ↺ 13→14); health=200; clean worker boot "clarity-pack worker started … registered", plugin activated (worker:true, jobs:2, 5 event subs), no errors/crash. Installed `dist/worker.js` `bulletin.compileNow` count = 2 (new bundle live).
- **Action verified live:** `POST /api/plugins/a763176a-.../actions/bulletin.compileNow` with no userId → `{"data":{"error":"OPT_IN_REQUIRED"}}` at **http=200** (registered + reachable — a missing action would 502/404; opt-in guard short-circuited with no compile/publish triggered).
- Used the fail2ban-safe flow from the #1 incident: fresh tgz name (no /tmp overwrite), detached `setsid` install, single on-box `DEPLOY_DONE` wait connection. No SSH lockout this time.
- **Remaining UAT (operator):** click "Generate bulletin now" on the Bulletin page — it triggers a real LLM compile and either publishes a fresh "Bulletin No. N" or returns "No changes since Bulletin No. N" (the dedupe). This is the operator-driven "see a bulletin now" use case the feature was built for; I did not trigger a production compile autonomously.
