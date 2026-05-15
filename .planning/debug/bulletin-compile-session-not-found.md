---
status: open
surfaced: 2026-05-15
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
