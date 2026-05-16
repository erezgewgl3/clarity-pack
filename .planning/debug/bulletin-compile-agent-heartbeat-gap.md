# Debug — Bulletin compile: Editor-Agent runs heartbeat logic, never processes the compile prompt

**Status:** OPEN — architecture-level gap. Routed to research → Plan 03-06 gap-closure.
**Surfaced:** 2026-05-16, Plan 03-04 Task 3 Phase 3 closure drill on Countermoves Hostinger.
**Supersedes the framing of:** DEFECT-B ("compilePass1: LLM output was not valid JSON").

---

## Symptom

On the live Countermoves instance, the `compile-bulletin` job loops every `*/1` minute and
every attempt fails pass-1. `bulletin_compile_failures` shows two eras:

| Era | `failed_at` | `reason` | Build |
|---|---|---|---|
| Pre-reinstall | 13:56–14:01 UTC, `attempt_n=1` | `invalid input syntax for type uuid: "clarity-pack-editor-agent"` | old (pre-03-04) |
| Post-reinstall | 14:02–14:06+ UTC, `attempt_n` 466→470 | `pass-1 failed: compilePass1: LLM output was not valid JSON` | v0.2.0 (03-04 build) |

The UUID-syntax error is **fixed** by the v0.2.0 build (commit `76bd28a` — passes the resolved
agent UUID, not the `clarity-pack-editor-agent` attribution tag). The post-reinstall era is the
real open defect. `next_due_at` never advances (`2020-01-01` bootstrap value) because publish
never succeeds → infinite retry loop. `bulletins` has only the `cycle_number=0` bootstrap row.

## Root cause — confirmed from the Editor-Agent dashboard

The Editor-Agent's "Latest Run" (status **succeeded**, run `e968ef64`, wake reason `compile pass`)
output, verbatim:

> "No assignments in my inbox and no tasks assigned to me (todo, in_progress, in_review,
> blocked all empty). The wake reason was `compile pass` with no `PAPERCLIP_TASK_ID`, so there
> is no scoped issue to act on and no mention handoff…"

The agent is **not failing to format JSON. It never processed the compile prompt at all.** When
the compile pipeline wakes it via `ctx.agents.sessions.sendMessage`, the Editor-Agent runs its
ordinary org-chart-employee heartbeat — inventory inbox, look for assigned issues — finds
nothing, and emits a plain-English "nothing to do" status report. `sessionLlmAdapter` accumulates
that prose and hands it to `compilePass1`, which correctly rejects it: it is not JSON and never
could be. Paperclip marks the run **succeeded** — from the host's view the agent did its job.

## Why this was not caught earlier

- Plan 03-05's `sessionLlmAdapter` (Mechanism 1 from `03-LLM-INVOCATION-RESEARCH.md`) assumed
  `ctx.agents.sessions.*` is a prompt→completion channel — call it like `llm.complete(prompt)`,
  get the answer back. A Paperclip **managed agent is an autonomous employee**: woken via a
  session it runs its own inbox/task loop and does not treat the message body as a directive.
  The agent itself states the requirement — *"no scoped issue to act on"* — it is issue-driven.
- The gx4 quick-task "Defect B fix" (`extractJsonObject`, commit `4ed04b1`) hardened the compile
  path against **host-faithful fakes** whose fake LLM returns canned `BulletinDraft` drafts. A
  fake cannot model "the real agent ignores your prompt and runs heartbeat logic." The
  hypothesised cause (agent wraps JSON in ```` ```json ```` fences) was wrong; the extraction fix
  addressed a problem that was not the live one. **This is the failure mode the live drill exists
  to catch.**

## Blast radius

- BULL-05 / BULL-06 / BULL-09 (bulletin compile pipeline) are **not deliverable** as architected.
- Phase 2 Reader TL;DR (`compileTldr`) rides the **same `sessionLlmAdapter`** — same gap likely
  applies; needs verification.
- The circuit-breaker does not hold: it pauses the Editor-Agent after 3 failures, but the
  `compile-bulletin` job resumes the agent before each fire → resume-defeats-breaker loop.
  Secondary to the root cause but must be addressed in the gap-closure plan.

## Open research questions (→ Plan 03-06 research)

1. Why does `ctx.agents.sessions.sendMessage` to *our* Editor-Agent run heartbeat logic, when
   `plugin-llm-wiki`'s `startWikiQuerySession` to *its* Wiki Maintainer agent reportedly returns
   the answer? Compare the two agents' manifest declarations + **instructions**.
2. Is the fix (a) the Editor-Agent's manifest instructions (tell it to treat a `compile pass`
   session message as its task), (b) how `sendMessage` / `reason` / `prompt` are passed, or
   (c) a mechanism switch to Mechanism 2 (plugin `tools[]` the agent calls) or a scoped-issue
   handoff (Mechanism 3)?
3. What does a session `sendMessage` actually deliver into the agent's run input? Does the agent
   see `prompt` as its turn input, or only `reason` as a wake label?
4. Re-evaluate Mechanism 4 (direct `ctx.http.fetch`) as break-glass given Mechanism 1 is proven
   non-functional for org-chart agents — weigh against Decision #3 / coexistence guarantee #4.
5. Fix the resume-defeats-circuit-breaker loop.

## Halt state

Plugin uninstalled on Countermoves (`pnpm paperclipai plugin uninstall clarity-pack`) to stop the
retry loop. Data preserved (no `--purge`). Reinstall once Plan 03-06 ships.

---

## Plan 03-06 closure re-drill — 2026-05-16 (Countermoves)

Plan 03-06 (scoped-issue task delivery) was built and installed (v0.2.0, the 03-06 build). The
re-drill outcome:

**The architecture fix WORKS — primary-risk gate PASSED.** `deliverAgentTask` created an
off-board operation issue (`Compile Daily Bulletin — cycle 1`,
`origin_kind = plugin:clarity-pack:operation:bulletin-compile`, assigned to the Editor-Agent
UUID). The Editor-Agent's heartbeat picked it up **scoped to that issue**, read the compile
prompt from the issue body, produced a flawless `BulletinDraft` (all 5 keys, verified-numerics
contract perfectly honored — `{{NUMBER:key}}` placeholders, standing numbers as-is), and marked
the operation issue `done`. `PAPERCLIP_TASK_ID` run-scoping — the plan's stated primary risk — is
confirmed working. The original heartbeat-blind defect is closed.

**One contained gap remains — output-channel mismatch.** The agent stored the `BulletinDraft`
JSON in a Paperclip **issue document** ("bulletin", rev 1) and posted a **prose summary** as the
issue comment. `deliverAgentTask`'s readback polls `listComments` for a comment that parses as
JSON + schema-validates — it finds only prose, so no bulletin publishes. The 03-06 manifest
instruction ("output the requested JSON") was ambiguous; the agent reasonably put a multi-KB
structured artifact in a versioned document rather than a chat comment.

**Two pre-drill setup notes (operability findings, not the defect):**
- The new `isCircuitOpenDurable` read the old build's 518 stale `editor_agent_failures` rows as
  an open circuit and silently suppressed the compile on a fresh install. Cleared the stale rows
  by hand (`DELETE` 518 + 482) to drill. A fresh post-fix install should not be DOA on pre-fix
  failure history — a durable-breaker reset-on-install (or version-scoped failure counting) is a
  follow-up worth filing.
- The `public.issues` table has no `surface_visibility` column — the host does not persist
  `surfaceVisibility` as a queryable column (the off-board behaviour works regardless).

**Routing:** the output-channel mismatch → `03-RESULT-READBACK-RESEARCH.md` (research the SDK
document-read surface — Option A: instruct agent to comment raw JSON; Option B: worker reads the
document) → a small follow-up plan → re-drill. This is a contained fix, not a re-architecture.
