---
name: fix-false-pause-banner-stale-read
quick_id: 260528-mn0
date: 2026-05-28
status: complete
---

# Quick Task 260528-mn0 — SUMMARY

Fixed the false "paused by operator" banner (NEXT-SESSION-BRIEF.md §2 #1). clarity-pack stays **v1.0.0** — no version bump, no migration, no manifest capability change.

## What changed

**(a)+(b) — `src/worker/handlers/editor-pause-status.ts`**
- `paused` is now derived from the agent's REAL status, not the stale `editor_agent_failures.consecutive >= MAX` heuristic. The handler resolves the Editor-Agent UUID via `ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId)`, then `ctx.agents.get(resolvedUuid, companyId)` (was wrongly called with the `'editor-agent'` KEY → uuid-cast throw → null name), and sets `paused = agent.status === 'paused' || agent.pausedAt != null`. `agentName` comes from `agent.name`.
- Whole authoritative block is try/catch-wrapped; on ANY failure (no companyId, no agents client, reconcile/get throws) it falls back to the OLD failure-table heuristic with `agentName: null` — never worse than before.
- Failure-table read retained for legacy footer fields (`lastFailureAt`/`reason`), cause derivation, and the fallback. `EditorPauseStatusCtx.agents` widened to `Pick<PluginAgentsClient,'get'|'managed'>`.

**(c) — `src/worker/handlers/agent-resume-heartbeat.ts` (new) + `src/worker.ts`**
- Registers the previously-missing `agents.resumeHeartbeat` action (host returned 502 because it was unregistered). Honors an explicit `agentId` (chat Quick Action's chatted employee) or resolves the Editor-Agent (pause-banner), then `ctx.agents.resume(uuid, companyId)`. **Throws on failure** so both UI callers' catch fires their graceful-degrade copy. Opt-in-guard wrapped. Capabilities `agents.resume`/`agents.managed` already declared.

**`src/ui/primitives/agent-pause-banner.tsx`**
- `onResumeClick` now passes `{ userId, companyId }` (was `{ companyId }`) so the opt-in-guard-wrapped action accepts opted-in callers. No locked-literal change. Editor-only `src/ui/surfaces/reader/pause-banner.tsx` untouched.

## Tests
- Rewrote `test/worker/editor-pause-status.test.mjs` (16 tests) for authoritative-status behavior incl. the core regression: active agent + stale `consecutive>=MAX` row → **paused:false**; fix-(b) UUID-not-KEY assertion; reconcile/get-throw + companyId-less + no-agents fallbacks.
- New `test/worker/handlers/agent-resume-heartbeat.test.mjs` (7 tests): opt-in gate, explicit-agentId vs Editor-Agent-resolution, throw-on-failure.

## Verification
- `npx tsc --noEmit` → 0; `tsc --project tsconfig.manifest.json` → 0.
- `node scripts/check-css-scope.mjs` → 0; `node scripts/check-ui-bundle-size.mjs` → OK (679.3 kB / 696320 ceiling).
- Builds: `dist/worker.js` 2.4mb, `dist/ui/index.js` 679.3kb. `grep -c paperclipInvocation dist/worker.js` = **5** (SDK bundled ✓). `agents.resumeHeartbeat` present in `dist/worker.js`.
- Full suite: 1970 pass / 2 fail. Both fails are pre-existing/flaky and unrelated: `situation.artifacts ... sorted DESC` (brief-documented pre-existing) and `U7 WATCHDOG ...` (timing-sensitive chat.messages test — passes 17/17 in isolation; chat-messages not touched). All 113 tests across changed surfaces (agent-pause-banner, chat-context-rail, reader-view, reader-userid-threading, handlers-wrapped, issue-reader-integration, editor-agent-key-consistency) pass + 23/23 new/changed handler tests.

## Limitation
- `ctx.agents.get`/`reconcile`/`resume` are host APIs flagged flaky on BEAAA; the try/catch fallback is mandatory and present. Authoritative status cannot be exercised against the live agent from local tests — verify on the box that the banner reflects `agent list --json` reality (gone when active).

## Deploy — LIVE + VERIFIED on BEAAA (2026-05-28 ~13:52 UTC)
Stable-path install to `/home/beai-agent/clarity-pack-live/package`; commit `38c149c` (pushed master). Result:
- `✓ Installed clarity-pack v1.0.0 (ready)`; pm2 `paperclip` restarted (PID 408090, ↺ 12→13); health=200; clean worker boot "clarity-pack worker started … registered", plugin activated (worker:true, jobs:2, 5 event subs), no errors/crash/invocation issues. Installed `dist/worker.js` `agents.resumeHeartbeat` count = 5 (new bundle confirmed live).
- **Behavioral proof of the fix:** Editor-Agent real status `status:idle pausedAt:null` (active, id 618eec58-…); the live `editor.pause-status` handler returns `{paused:false, lastFailureAt:null, reason:null}` for the active agent — the false banner is gone at the data source. Fix (b) confirmed (reconcile→get(uuid) resolved with no uuid-cast throw). Remaining: operator hard-refresh of Reader/chat to confirm banner UI gone + Resume button (brief §5.7 UAT).

### Deploy incident (process lesson)
First Path-A attempt got fail2ban-dropped mid-heredoc (10+ rapid SSH connections — see DEPLOY-RUNBOOK gotcha #10); the box was UP the whole time (11d uptime), deploy simply didn't take effect. Recovery: stopped hammering, let fail2ban cool, re-ran the install **detached on the box** (`setsid … >log 2>&1 </dev/null &`) so a connection drop can't corrupt mid-install, then verified via a single long-lived connection that waits on-box for `DEPLOY_DONE`. Lesson: read `.planning/DEPLOY-RUNBOOK.md` first and batch BEAAA work into as few SSH connections as possible.
