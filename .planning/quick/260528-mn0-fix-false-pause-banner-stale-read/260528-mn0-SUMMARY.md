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

## Deploy
Brief §5 stable-path to BEAAA `/home/beai-agent/clarity-pack-live/package` (see deploy log below / STATE.md).
