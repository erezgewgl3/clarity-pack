---
name: on-demand-generate-bulletin-now-button-w
quick_id: 260528-nns
date: 2026-05-28
status: in-progress
---

# Quick Task 260528-nns — On-demand "Generate bulletin now" button (+ dedupe)

Source: `.planning/ON-DEMAND-BULLETIN-SPEC.md`. clarity-pack stays **v1.0.0**, no migration (0014 covers schema). TDD-first. Deploy: NEXT-SESSION-BRIEF §5 stable-path to BEAAA.

## Goal
A "Generate bulletin now" button on `/<companyPrefix>/bulletin` that runs the same compile pipeline as the daily cron, for the current company, bypassing the `now>=next_due_at` gate, **deduping on content_hash** (no new bulletin when nothing changed), and **leaving the daily 06:30 schedule pointer untouched**.

## Grounding (verified against source 2026-05-28)
- `compile-bulletin.ts` `registerCompileBulletinJob` has the per-company logic INLINE in the `for (const company of companies)` loop (~lines 313-793). Must extract.
- `publishBulletin` (publish.ts:114-115) computes `content_hash = syncHash(renderBulletinIssueBody(draft))`; `syncHash` is private → export `computeBulletinContentHash`.
- `getBulletinByCycle(...,'latest')` returns MAX-cycle row regardless of status → need a published-only read.
- Cron is covered by an extensive e2e net (`test/worker/bulletin/compile-bulletin-end-to-end.test.mjs` etc.) calling `registerCompileBulletinJob(ctx)` → `jobs.get('compile-bulletin')(JOB_EVENT)`. **This net MUST stay green** — it's the regression guard for the extraction.
- UI surface `src/ui/surfaces/bulletin/index.tsx` `BulletinPageBody` has `{companyId, userId}` + `usePluginData('bulletin.byCycle', {cycle:'latest', companyId, userId})`; use its `.refresh()` on success.
- Action pattern: `wrapActionHandler(ctx, key, fn)` (mirror `bulletin-action-approve.ts`); opt-in gated; throw on missing required params, return structured object otherwise.
- Capabilities already cover everything (issues.create, agents.*, etc.); SDK has no `actions[]` manifest field → no manifest/version change.

## Tasks

### T1 — publish.ts: export `computeBulletinContentHash(draft)`
`export function computeBulletinContentHash(draft: BulletinDraft): string { return syncHash(renderBulletinIssueBody(draft)); }` and have `publishBulletin` use it (DRY). No behavior change.

### T2 — bulletins-repo.ts: `getLatestPublishedBulletin(ctx, companyId)`
`SELECT ${BULLETIN_COLS} ... WHERE company_id=$1 AND compile_status='published' ORDER BY cycle_number DESC LIMIT 1` → `BulletinRow | null`.

### T3 — compile-bulletin.ts: extract `compileBulletinForCompany`
`export async function compileBulletinForCompany(ctx, company, { now, bulletinTz, force }): Promise<CompileForCompanyResult>` containing the current per-company body. `registerCompileBulletinJob` loop becomes `for (...) await compileBulletinForCompany(ctx, company, { now, bulletinTz, force: false })`.
Result union: `{kind:'not-due'} | {kind:'bootstrapped'} | {kind:'published',cycleNumber,publishedIssueId,publishedAt} | {kind:'duplicate',cycleNumber} | {kind:'no-change',cycleNumber,publishedAt} | {kind:'skipped',reason} | {kind:'failed',reason,cycleNumber?}`.
`force` semantics (on-demand only): bypass the due-gate AND the bootstrap early-return (compile even first-ever, computing a next_due_at for the row WITHOUT advancing the pointer); skip every `advanceScheduleForCompany` call; skip `recordFailure`/`recordCycleCompileFailure`; run the dedupe (T4) before publish. With `force:false` the function is byte-for-byte the current cron body (every `continue` → `return {...}` after the same advance call; same catch routing).

### T4 — dedupe (inside compileBulletinForCompany, force only)
After `verifyDraft` passes, before `publishBulletin`: `const hash = computeBulletinContentHash(draftWithLineage); const last = await getLatestPublishedBulletin(ctx, company.id); if (last && last.content_hash === hash) return {kind:'no-change', cycleNumber:last.cycle_number, publishedAt:last.published_at};`

### T5 — bulletin-compile-now.ts action + worker.ts wiring
`registerBulletinCompileNow(ctx)` → `wrapActionHandler(ctx,'bulletin.compileNow', fn)`. Params {companyId, userId} (reqStr companyId; userId via opt-in guard). Resolve the company object (ctx.companies.list → find id, or `{id:companyId}` fallback). `const r = await compileBulletinForCompany(ctx, company, {now:new Date(), bulletinTz:resolveBulletinTz(ctx)?, force:true})`. Map result → UI shape: published→`{kind:'published',cycleNumber,publishedAt}`, no-change/duplicate→`{kind:'no-change',cycleNumber,publishedAt}`, skipped/failed→`{kind:'error', reason}` (incl. paused/unavailable agent). Wire `registerBulletinCompileNow(ctx as unknown as BulletinCompileNowCtx)` in worker.ts.

### T6 — UI button
In `BulletinPageBody`: `const compileNow = usePluginAction('bulletin.compileNow')`; get `refresh` from the byCycle `usePluginData`. Button "Generate bulletin now" → states idle / "Compiling…" (disabled) / "Published Bulletin No. N" / "No changes since Bulletin No. N" / error ("Editorial Desk unavailable — resume it in the Agents panel"). On published → `refresh()`. Place near the header. Scoped CSS class `clarity-bulletin-compile-now`.

## Tests (TDD-first)
- `test/worker/bulletin/bulletin-compile-now.test.mjs` (host-faithful-ctx, mirrors compile-bulletin-end-to-end fake): (a) fresh content → publishes cycle N (issues.create fires, returns kind:'published'); (b) identical content_hash to last published → kind:'no-change', NO new bulletins row / NO issues.create; (c) paused+non-resumable (or unresolved) agent → kind:'error', no publish; (d) the daily `next_due_at` pointer is UNCHANGED after an on-demand compile (no advanceScheduleForCompany).
- `test/ui/bulletin-compile-now.test.mjs` (source-grep): button text present, `usePluginAction('bulletin.compileNow')`, the three result-state literals, `.refresh()` on success.
- Regression: full `test/worker/bulletin/*` (esp. compile-bulletin-end-to-end / host-faithful / idempotency / dst-ci-matrix / failed-compile-banner) stays green.

## Gates / Deploy
`tsc --noEmit`, `check-css-scope`, `check-ui-bundle-size`, `node --test "test/**/*.test.mjs"` (1 pre-existing situation-artifacts fail OK), build worker/ui/manifest, `grep -c paperclipInvocation dist/worker.js`>=5. Deploy: detached stable-path install to `/home/beai-agent/clarity-pack-live` (never /tmp; batch SSH); verify via `bulletin.compileNow` returning published/no-change.

## Out of scope
No version bump. No migration. No change to the daily cron's observable behavior. Dedupe is on-demand-only (force) — cron path unchanged.
