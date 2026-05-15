---
status: fix-implemented — pending Countermoves drill verification
surfaced: 2026-05-15
fix-implemented: 2026-05-15
phase: 3
plan: 03-05
component: src/worker/agents/session-llm-adapter.ts
---

# Bulletin compile — "Session not found" on sendMessage

## Symptom

Live Countermoves drill, 2026-05-15. After fixing five prior compile-path
defects, the bulletin compile job reaches the LLM step and fails:

```
bulletin_compile_failures.reason =
  "pass-1 failed: Session not found: f4585265-c707-4709-890a-931c57987922"
```

`ctx.agents.sessions.create()` returns an `AgentSession`; the immediately
following `ctx.agents.sessions.sendMessage(session.sessionId, …)` rejects with
`Session not found: <that sessionId>`.

## What is verified

- The query/execute repo fix works — the `bulletin_compile_failures` row was
  written, which only the fixed `recordCompileFailure` (execute) can do.
- `session-llm-adapter.ts` matches the SDK `PluginAgentSessionsClient` types
  exactly (create/sendMessage/close signatures, `AgentSessionEvent` shape).
- All four `agent.sessions.*` manifest capabilities are declared.
- The Editor-Agent resolves (correct `EDITOR_AGENT_KEY = 'editor-agent'`) and
  is `idle` (not paused) — the adapter's NON_INVOKABLE guard passes.
- The job runs end-to-end through reconcile → resume → cycle-number →
  reconcileDepartments → lineage → standing-numbers → facts, and only fails at
  the `compilePass1` LLM call.

## Root-cause hypothesis

The reference implementation — Paperclip's own `plugin-llm-wiki`
(`packages/plugins/plugin-llm-wiki/src/wiki/core.ts`, `startWikiQuerySession`,
~line 3882) — uses a fundamentally **asynchronous** session pattern:

1. `create()` the session.
2. `sendMessage(sessionId, companyId, {prompt, onEvent})` — `await`s only the
   `{runId}` (send accepted).
3. The function returns `{status: "running"}` immediately. The `onEvent`
   callback handles the streamed `chunk`/`done`/`error` events later and does
   all persistence itself (fire-and-forget `void`ed calls).
4. It **never calls `ctx.agents.sessions.close()`**.

`session-llm-adapter.ts` does the opposite — a **synchronous blocking** wrap:
it `await new Promise` that only resolves on the terminal `done` event (up to
`SESSION_TIMEOUT_MS = 120s`), then `close()`s the session in a `finally`.

The "Session not found" most likely comes from this mismatch — e.g. a
create→sendMessage race (the wiki happens to do a `ctx.db.execute` INSERT plus
`ctx.streams` calls between create and sendMessage, which our adapter does
not), or the blocking/close model fighting the host's async session lifecycle.

## Recommended fix approach (next session)

Do NOT guess-and-reinstall. Investigate properly:

1. Add create/sendMessage instrumentation: log `session.sessionId` immediately
   after `create()` and again immediately before `sendMessage()`, and confirm
   they are identical and well-formed.
2. Re-examine the sync-vs-async decision from `03-LLM-INVOCATION-RESEARCH.md`.
   The research concluded "wrap the session in a synchronous LlmAdapter so the
   compile pipeline needs no rewrite" — the live failure suggests that
   conclusion was too optimistic. The host's session model is async; the
   compile pipeline may need to adopt the wiki's pattern (sendMessage →
   onEvent persists the verified draft → a later job fire / event publishes).
3. If staying synchronous: reproduce the create→sendMessage race; the wiki's
   incidental delay (a DB write between the two calls) may be load-bearing.
   Consider a `sessions.list()` confirm-loop after create, or retry sendMessage
   on a "not found" rejection.
4. Whatever the fix, do it against a host-faithful fake first (the
   `test/helpers/host-faithful-db.mjs` hardening is the model — extend it with
   a host-faithful `ctx.agents.sessions` fake), then ONE Countermoves drill.

## Drill defects already fixed this session (for context)

| # | Defect | Fix commit |
|---|--------|-----------|
| 1 | Migration apostrophe broke host SQL validator | cc8bf62 |
| 2 | `CREATE INDEX` rejected by host migration validator | db07cef |
| 3 | Bootstrap row PK-collided with first real cycle | (bootstrap cycle-0) |
| 4 | compile-bulletin used wrong Editor-Agent key | 897287e |
| 5 | Error metadata stripped by host — folded into log message | b527d08 |
| 6 | Repo INSERTs via `ctx.db.query` (SELECT-only) | ece2b78 |
| — | Test fakes hardened host-faithful | 94fd6ad |

All of the above share one root cause: the compile path was only ever
exercised against permissive stub/fake contexts; production never ran it (no
LLM was wired before Plan 03-05), so every host constraint surfaced one live
reinstall at a time. The "Session not found" defect is the last one standing.

## Investigation (2026-05-15, session 2)

Worked the four systematic-debugging phases.

**Phase 1 — the worker side is verified clean.** Read the SDK's worker RPC
client (`@paperclipai/plugin-sdk/dist/worker-rpc-host.js:728-761`):
`sessions.create` → `callHost("agents.sessions.create")`, `sessions.sendMessage`
→ `callHost("agents.sessions.sendMessage", { sessionId, … })`. The `sessionId`
`create` returns is passed verbatim to `sendMessage`; no client-side mangling.
The live error carries a well-formed UUID, so `create` genuinely returned a
real session. The rejection is host-side.

**Company-mismatch is ruled out.** `complete()` passes the *same* `opts.companyId`
variable to `agents.get`, `create`, AND `sendMessage`. `agents.get` returned a
non-null agent (the NON_INVOKABLE guard passed) — which itself proves
`opts.companyId === agent.companyId`. A company mismatch between `create` and
`sendMessage` is therefore structurally impossible.

**Phase 2 — pattern analysis against the real `startWikiQuerySession`.**
Pulled the actual source (`plugin-llm-wiki/src/wiki/core.ts`, GitHub master).
Between `create` and `sendMessage` the wiki performs **three host
round-trips**: a `ctx.db.execute` INSERT into `wiki_query_sessions`, then
`ctx.streams.open`, then `ctx.streams.emit`. `session-llm-adapter.ts` does
**zero** — `sendMessage` is the statement right after `create` resolves.

**Root cause (best-supported hypothesis — host is a black box, not locally
reproducible without the live instance):** the host's `create()` resolves with
a usable `sessionId` *before* that `AgentTaskSession` is consistently
messageable on the worker's RPC channel. Our adapter races that window; the
wiki's three intervening round-trips incidentally let the session settle.

## Fix implemented (pending drill verification)

Commit-pending. `src/worker/agents/session-llm-adapter.ts`:

1. **Bounded retry of a transient `sendMessage` rejection.** A "Session not
   found" rejection within moments of `create` is, by definition, transient — a
   session the host just minted cannot be *permanently* unknown. `complete()`
   now retries `sendMessage` up to `SEND_RETRY_ATTEMPTS` (4 total) with
   exponential backoff from `SEND_RETRY_BASE_DELAY_MS` (100/200/400ms ≈ 0.7s
   worst case — well inside `SESSION_TIMEOUT_MS`). The retry is **scoped** to
   `/session not found/i`; any other rejection (budget, capability, terminated
   agent) still fails fast. This fix is correct regardless of the exact host
   mechanism (commit race, replica lag, async registration).
2. **Instrumentation for the next drill.** The created `AgentSession` is logged
   in full immediately after `create` (inline in the message string — the host
   drops log metadata, defect #5). Each retry logs its attempt. If retries are
   exhausted, the rejection message names the attempt count and session — so a
   still-failing `bulletin_compile_failures.reason` row is decisive evidence
   (race window larger than the backoff, or a different cause entirely).
3. **Host-faithful `ctx.agents.sessions` fake** — `test/helpers/host-faithful-sessions.mjs`,
   modelled on the `host-faithful-db.mjs` precedent. Models the host session
   lifecycle (testing.js semantics) plus a `notFoundForFirstNSends` knob that
   reproduces the create→sendMessage race deterministically.
4. **Tests** — `test/worker/agents/session-llm-adapter-session-race.test.mjs`,
   5 tests (RED-verified before the fix): race recovered, retries bounded,
   non-transient not retried, instrumentation logged, no happy-path regression.
   Full suite 589 tests / 587 pass / 0 fail / 2 skip; typecheck + 3 builds clean.

**Drill verdict still required.** The host is not locally reproducible — the
hypothesis is the strongest available, not proven. Re-drill on Countermoves: if
the bulletin compiles, the race hypothesis holds and the defect closes; if it
still fails, the new instrumentation in the failure row + `paperclip-run.log`
pinpoints whether retries exhausted (race too wide) or it is a different cause.
