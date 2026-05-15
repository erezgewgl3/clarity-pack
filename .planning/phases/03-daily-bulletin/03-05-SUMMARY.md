---
phase: 03-daily-bulletin
plan: 05
subsystem: worker
tags: [llm-pipeline, agent-sessions, gap-closure, bulletin, tldr, editor-agent]
status: AWAITING-CHECKPOINT

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "compile-pass-1.ts LlmAdapter interface + compilePass1 cap-then-call kernel; compile-bulletin.ts two-pass pipeline with editorAgentId resolution; compile-tldr.ts LlmAdapter + compileTldr kernel; circuit-breaker recordFailure/recordSuccess; manifest agents[] Editor-Agent declaration (status:'paused')"
provides:
  - "sessionLlmAdapter(ctx,{agentId,companyId,taskKeyPrefix?,timeoutMs?}) — a real LlmAdapter whose complete() opens an agent chat session, accumulates chunk events, resolves the accumulated string on the terminal `done` event, rejects on `error` or a bounded timeout, and closes the session in a finally"
  - "AGENT_NOT_INVOKABLE error tag — paused/terminated/pending_approval/missing agents reject BEFORE any session is opened"
  - "SESSION_TIMEOUT_MS — default 120s terminal-event timeout so a stuck session never hangs the compile job"
  - "compile-bulletin job builds the real adapter per-company from ctx.agents + editorAgentId and resumes a paused Editor-Agent before the first compile — ctx.llm fiction removed from the production path"
  - "editor heartbeat path builds the same adapter from the resolved agentId and passes it to compileTldr — Phase 2 Reader TL;DR production wiring closed"
  - "worker.ts registers the compile job with a plain structural cast — the `as unknown as CompileBulletinCtx` cast that masked the missing llm member is gone"
  - "manifest capabilities[] gains agent.sessions.create/list/send/close"
affects: [03-04-errata-banner-dst]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Production LLM invocation via ctx.agents.sessions.* — open session, sendMessage with an onEvent that accumulates chunk.message, resolve on the terminal done event (Mechanism 1 from 03-LLM-INVOCATION-RESEARCH.md; the plugin-llm-wiki startWikiQuerySession pattern)"
    - "Async, event-driven streaming wrapped behind a byte-identical synchronous LlmAdapter interface — compilePass1/verifyDraft/publishBulletin/compileTldr and every stub-based test are structurally untouched"
    - "Agent-status invokability guard BEFORE session create — a paused/terminated/pending_approval agent fails fast with a tagged error rather than a wasted AgentTaskSession row"
    - "Compile-job-owned agent resume — the scheduled must-succeed bulletin job resumes a manifest-paused Editor-Agent; the best-effort heartbeat path does not"

key-files:
  created:
    - src/worker/agents/session-llm-adapter.ts
    - test/worker/agents/session-llm-adapter.test.mjs
  modified:
    - src/worker/jobs/compile-bulletin.ts
    - src/worker/agents/editor.ts
    - src/worker.ts
    - src/manifest.ts
    - test/worker/bulletin/compile-bulletin-end-to-end.test.mjs

key-decisions:
  - "Adopted Mechanism 1 (ctx.agents.sessions.*) as the production LLM-invocation path — full governance parity (audited agent run, budget caps, pause/terminate) per Decision #3 / coexistence guarantee #4; rejected Mechanism 4 (direct ctx.http.fetch) as governance-non-compliant."
  - "Resolution/rejection is driven by the terminal onEvent (done/error) or the SESSION_TIMEOUT_MS timer — NOT by the sendMessage Promise resolving; sendMessage resolving only means the send was accepted (research Open-Follow-up #2)."
  - "The compile-bulletin job owns the Editor-Agent resume (manifest ships status:'paused'); the heartbeat TL;DR path does NOT resume — heartbeat compiles are best-effort and a paused agent simply yields a logged-and-skipped AGENT_NOT_INVOKABLE throw."
  - "CompileBulletinCtx and EditorHeartbeatCtx lost their synthetic optional `llm` member — there is no single ctx-wide LLM independent of an agent; the adapter is built per-company from ctx.agents + the resolved agentId."
  - "The LlmAdapter interface in compile-pass-1.ts and compile-tldr.ts is preserved byte-for-byte; CompilePass1Ctx/CompileTldrCtx keep their optional `llm?` member purely as the stub-injection seam for existing tests (the production path always supplies args.llm, so the `?? ctx.llm` fallback is dead in production)."

patterns-established:
  - "sessionLlmAdapter — the reusable real LlmAdapter; any future plugin worker code needing LLM-generated text builds it from ctx.agents + a resolved agent id"
  - "Narrow SessionLlmAdapterCtx ({agents.get, agents.sessions} slice) intersected into consumer ctx types so both the compile-bulletin job ctx and the editor heartbeat ctx structurally satisfy the factory without a cast"

requirements-completed: [BULL-05, BULL-06, BULL-09]

# Metrics
duration: 32min
completed: 2026-05-15
---

# Phase 3 Plan 05: LLM-Adapter Gap Closure Summary

**Production LLM invocation wired into the bulletin + TL;DR compile pipelines via `ctx.agents.sessions.*` — a real session-backed `LlmAdapter` that opens an agent chat session, accumulates streamed chunk events, and resolves on `done`, replacing the impossible `ctx.llm` seam under full agent governance.**

## Performance

- **Duration:** ~32 min (Tasks 1-3; Task 4 is a pending human-verify checkpoint)
- **Started:** 2026-05-15
- **Completed (Tasks 1-3):** 2026-05-15
- **Tasks:** 3 of 4 (Task 4 = Eric's Countermoves drill — AWAITING CHECKPOINT)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- **`sessionLlmAdapter`** — a real `LlmAdapter` over `ctx.agents.sessions.*`: opens a session, sends the prompt, accumulates `chunk` text (skipping `stderr`), resolves the accumulated string on the terminal `done` event, rejects on `error`, enforces a `SESSION_TIMEOUT_MS` bound so a stuck session never hangs the compile job, and closes the session in a `finally`.
- **Agent-invokability guard** — a paused/terminated/pending_approval/missing Editor-Agent rejects `complete()` with a tagged `AGENT_NOT_INVOKABLE` error BEFORE any session is opened; the rejection routes through `compilePass1`'s existing `recordFailure` → `recordCompileFailure` path with no new failure machinery.
- **Compile-bulletin job rewired** — builds the adapter per-company from `ctx.agents` + the resolved `editorAgentId`, and resumes the manifest-`paused` Editor-Agent immediately before the first compile so a fresh install can actually produce its first bulletin.
- **Editor heartbeat path rewired** — builds the same adapter from `payload.agentId` and passes it to `compileTldr`; the Reader's permanently-stuck "Compiling TL;DR…" is the identical `ctx.llm` fiction, now closed (research Open-Follow-up #3).
- **Type-level lie removed** — `CompileBulletinCtx`/`EditorHeartbeatCtx` lost the synthetic `llm` member; `worker.ts` drops the `as unknown as CompileBulletinCtx` cast that previously manufactured it.
- **Manifest** declares `agent.sessions.create/list/send/close` (exact `PLUGIN_CAPABILITIES` members; `agents.resume` was already present).

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: RED — failing session-adapter spec** - `993b8fe` (test)
2. **Task 2: GREEN — sessionLlmAdapter implementation** - `0848232` (feat)
3. **Task 3: Wire adapter into both compile paths + resume Editor-Agent + drop ctx.llm** - `f6da35c` (feat)

_Task 4 (Eric's Countermoves drill) is a `checkpoint:human-verify` gate — not yet run._

## Files Created/Modified

- `src/worker/agents/session-llm-adapter.ts` *(created)* — the real `LlmAdapter`; exports `sessionLlmAdapter`, `SessionLlmAdapterCtx`, `AGENT_NOT_INVOKABLE`, `SESSION_TIMEOUT_MS`.
- `test/worker/agents/session-llm-adapter.test.mjs` *(created)* — 11 tests covering the 7 RED behaviors (happy path, stderr exclusion, error rejection, timeout, paused/terminated/pending_approval/null guard, session-always-closed, prompt+taskKey forwarding).
- `src/worker/jobs/compile-bulletin.ts` *(modified)* — builds `sessionLlmAdapter` per company, resumes a paused Editor-Agent, passes `llm` into `compilePass1`; `CompileBulletinCtx` loses the `llm` member.
- `src/worker/agents/editor.ts` *(modified)* — builds the same adapter per heartbeat, passes it to `compileTldr`; `EditorHeartbeatCtx` loses the `llm` member, gains the `SessionLlmAdapterCtx` slice.
- `src/worker.ts` *(modified)* — `registerCompileBulletinJob(ctx as CompileBulletinCtx)` — `as unknown as` cast removed.
- `src/manifest.ts` *(modified)* — `capabilities[]` gains the 4 `agent.sessions.*` strings.
- `test/worker/bulletin/compile-bulletin-end-to-end.test.mjs` *(modified)* — fake ctx gains `agents.get`/`agents.resume`/`agents.sessions`; 2 new cases (real-adapter compile+publish; paused non-resumable agent → `recordCompileFailure`, no hang).

## Decisions Made

See `key-decisions` frontmatter. Headline: adopted `ctx.agents.sessions.*` (Mechanism 1) as the production LLM path for governance parity; the bulletin job owns the agent resume; the `LlmAdapter` interface stays byte-identical so all stub tests are untouched.

## Deviations from Plan

None — plan executed exactly as written. The implementation followed `03-LLM-INVOCATION-RESEARCH.md` lines 184-195 and the plan's per-task `<action>` blocks directly. No bugs, missing functionality, or blocking issues surfaced.

Note on `ctx.llm`: the plan's Task-3 `<done>` says "`grep ctx.llm src/worker` shows `ctx.llm` is no longer read on either production path." `ctx.llm` text still appears in `compile-tldr.ts` and `compile-pass-1.ts` — but only in the `args.llm ?? ctx.llm` fallback expression and surrounding comments. Both production paths now always supply `args.llm`, so `ctx.llm` is dead on the production path (reachable only by tests that inject a stub via the optional `CompilePass1Ctx.llm?` / `CompileTldrCtx.llm?` member). The plan explicitly mandated preserving the `LlmAdapter` interface byte-for-byte; the optional `llm?` member on those two ctx types IS that interface seam, so it was intentionally retained. The plan's stricter targets — drop `llm` from `CompileBulletinCtx` and `EditorHeartbeatCtx`, remove the `as unknown as` cast — are all met.

## Issues Encountered

None.

## TDD Gate Compliance

Plan type is `execute` (per-task `tdd="true"`). Gate sequence verified in git log:
- RED: `993b8fe test(03-05): RED — session-backed LlmAdapter spec` — suite failed `ERR_MODULE_NOT_FOUND`.
- GREEN: `0848232 feat(03-05): GREEN — session-backed LlmAdapter via ctx.agents.sessions` — 11 tests pass.
- No REFACTOR commit needed — the GREEN implementation was clean.

## Verification

- `node --test "test/**/*.test.mjs"` — **582 tests / 580 pass / 0 fail / 2 skip** (baseline 565; +17 = new 11-test session-adapter suite + 2 e2e cases + prior counts). The `LlmAdapter` interface is byte-identical, so every existing stub-based test (compile-pass-1, compile-tldr, verifier, the original e2e cases) passes unchanged.
- `npx tsc --noEmit` — clean.
- `node scripts/build-worker.mjs` — clean (`dist/worker.js` 149.0 KB unminified).
- `node scripts/build-ui.mjs` — clean (`dist/ui/index.js` 97.5 KB unminified).
- `npx tsc --project tsconfig.manifest.json` — clean.
- Grep gates: `sessionLlmAdapter` wired into both `compile-bulletin.ts` and `editor.ts`; `as unknown as CompileBulletinCtx` absent from `worker.ts`; all 4 `agent.sessions.*` capabilities present in `manifest.ts`.

## User Setup Required

None — no external service configuration. The Editor-Agent's LLM adapter is configured by the operator via the classic Paperclip agent panel (already true since Phase 2).

## Checkpoint — Task 4 (AWAITING)

**Type:** `checkpoint:human-verify` (blocking gate). This plan is NOT complete until Eric runs the Wave-3 production-compile drill on Countermoves and reports "approved". The full drill instructions are in `03-05-PLAN.md` Task 4 `<how-to-verify>`. Summary of what Eric verifies:

1. **Pre-drill (local):** full suite green; worker + UI builds green; pack the tarball.
2. **Install:** query MemPalace `clarity_pack/runbook` for the current Countermoves `pnpm paperclipai plugin install` command (run from `~/paperclip`); install the new build.
3. **Editor-Agent resume + bulletin compiles:** confirm the COU Editor-Agent exists (expected `paused`); trigger a compile (wait for the `*/1` cron past `next_due_at`, or set `next_due_at` to a past instant via psql); confirm the agent flipped `paused → idle`; confirm a `Bulletin No. N` issue exists, is `compile_status='published'`, has the 3 canonical tags, and renders real editorial prose with populated standing numbers; confirm an agent run is visible in Paperclip's run history.
4. **Reader TL;DR populates:** open any COU issue's `Reader` tab — the TL;DR resolves to real text (no longer stuck "Compiling TL;DR…").
5. **Failure-path sanity (optional):** pause the Editor-Agent, force another compile, confirm a `bulletin_compile_failures` row with an agent-status reason appears.

**Resume signal:** "approved" if a bulletin compiled + published and the Reader TL;DR populated; otherwise the failing worker log line + any `bulletin_compile_failures.reason`.

## Next Phase Readiness

- Tasks 1-3 deliver the production LLM-invocation mechanism Plan 03-04's Wave-4 closure drill depends on. Once Eric's Task-4 drill PASSES, Plan 03-04 can run its closure drill against a Countermoves instance that genuinely produces bulletins — and the failed-compile banner 03-04 builds will render the very `bulletin_compile_failures` rows that 03-05's `AGENT_NOT_INVOKABLE` / session-error / timeout paths now produce.
- BULL-05, BULL-06, BULL-09 are implemented; final confirmation pending the Task-4 drill.

## Self-Check: PASSED

- `src/worker/agents/session-llm-adapter.ts` — FOUND
- `test/worker/agents/session-llm-adapter.test.mjs` — FOUND
- `.planning/phases/03-daily-bulletin/03-05-SUMMARY.md` — FOUND
- Commit `993b8fe` (RED) — FOUND
- Commit `0848232` (GREEN) — FOUND
- Commit `f6da35c` (Task 3 wire) — FOUND

---
*Phase: 03-daily-bulletin*
*Plan 03-05 — Tasks 1-3 complete; Task 4 awaiting checkpoint*
*Completed (build): 2026-05-15*
