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

---

## Plan 03-07 closure re-drill — Countermoves Hostinger, 2026-05-16 — DID NOT PASS

**Verdict:** Phase 3 still NOT closed. Option C (the `submit-compile-result` tool channel) did
not fire on the live instance, and the comment+document fallback poll did not publish either.
The drill surfaced a real host-behaviour gap the plan did not account for.

**What was verified GREEN before the failure:**
- Migration `0005_breaker_version_scope.sql` applied — `editor_agent_failures` has the nullable
  `plugin_version text` column.
- The version-scoped breaker fix works as designed: 3 pre-fix rows (`plugin_version IS NULL`)
  did NOT suppress the fresh `0.3.0` install — `isCircuitOpenDurable` ignored them. The
  DURABLE-BREAKER-STALE-HISTORY fix is confirmed.
- The 03-06 scoped-issue architecture still works: `deliverAgentTask` created the operation
  issue, the Editor-Agent ran scoped to it and produced a flawless `BulletinDraft`.

**ROOT CAUSE — manifest `agents[].instructions.content` does NOT propagate to an
already-existing managed agent.** The repo `src/manifest.ts` v0.3.0 ships the correct
tool-directed instructions (lines 276-284: "deliver ... by calling submit-compile-result ...
the JSON object and nothing else"). But the LIVE Editor-Agent's Instructions tab still shows
the original pre-03-06 generic text ("Your job: compile plain-English TL;DRs ... If you cannot
compile a useful summary, output the literal string 'Insufficient context'"). The Editor-Agent
was created in Phase 2 (Plan 02-03); `ctx.agents.managed.reconcile()` evidently sets
`instructions.content` only at agent CREATION and never updates it on plugin upgrade/reinstall.
Consequence: BOTH 03-06's and 03-07's manifest instruction rewrites have been no-ops on the live
agent. 03-06 still appeared to work because the scoped-issue handoff is driven by the host's
generic Paperclip heartbeat skill (`PAPERCLIP_TASK_ID` → checkout that issue), independent of
custom instructions — but 03-07's Option C depends entirely on the agent being told to call the
tool, and that instruction never reached it. The agent did what its real (old) instructions +
generic Paperclip skill imply: produced the draft, then filed it as a document + prose comment.

**SECONDARY — the comment+document fallback poll did not publish.** `editor_agent_failures`
after the drill: `NULL → 3`, `0.3.0 → 3`. The three `0.3.0`-stamped rows mean the v0.3.0
worker's `deliverAgentTask` timed out (or errored) 3× and ran `recordFailure` — so the fallback
poll that is supposed to scan `listComments` + `issues.documents.list/.get` did NOT yield a
schema-valid result from the document the agent filed. Why is open (worker-log not yet read):
candidate causes — the fallback document-scan keys to the wrong operation issue, the SDK
documents API shape differs, or the agent filed the document on a different operation issue than
the one `deliverAgentTask` is polling. The 3 `0.3.0` failures have now TRIPPED the durable
breaker for v0.3.0 — it must be cleared before any re-drill.

**OPEN QUESTION 1 still unresolved.** Because the agent was never instructed to call the tool,
the drill could NOT confirm whether `permissions: { pluginTools: ['clarity-pack'] }` actually
exposes `submit-compile-result` on the agent's tool surface. A gap-closure must resolve this.

**Fix direction for the gap-closure plan (likely 03-08):**
1. Do NOT rely on the static manifest `agents[].instructions.content` — it does not propagate.
   Move the "deliver the result by calling submit-compile-result with {operationIssueId, result}"
   instruction into the OPERATION ISSUE DESCRIPTION, which `deliverAgentTask` creates fresh every
   compile and the agent provably reads (the 03-07 plan deliberately kept that creation path
   "byte-identical to 03-06" — that is the line that must change). Alternatively force an
   instruction refresh via `PATCH /api/agents/{agentId}/instructions-path` or agent recreate.
2. Confirm Open Question 1 — whether the tool is on the agent's surface — before assuming the
   tool call can happen at all.
3. Diagnose why the comment+document fallback poll failed to publish (worker log).
4. Clear the 3 `plugin_version = '0.3.0'` rows from `editor_agent_failures` (breaker tripped).

### Plan 03-07 — live diagnostic follow-up, 2026-05-16 — Open Question 1 ANSWERED: Option C is dead

After the failed drill, the live Editor-Agent's instructions were hand-edited to the v0.3.0
tool-directed text (the Instructions tab IS editable — confirms instruction-propagation can be
forced manually), the 3 `0.3.0` breaker rows were cleared, and a compile was re-triggered. The
agent ran on a FRESH operation issue (COU-11, `plugin:clarity-pack:operation:bulletin-compile`).

**DECISIVE: the `submit-compile-result` tool is NOT on the agent's tool surface.** With the
correct instructions, the agent explicitly tried to call the tool and could not find it.
Verbatim from the run transcript:
- "the submit-compile-result tool wasn't found via ToolSearch"
- "The submit-compile-result tool is not available as a deferred tool"
- "there's no Clarity Pack MCP server listed in the deferred tools"
- "The submit-compile-result tool is a Clarity Pack MCP tool not loaded in this session"

The agent then fell back: composed the `BulletinDraft`, stored it as an issue **document**
keyed `compile-result` on COU-11, posted a comment, and marked the issue `done`.

**CONCLUSION — Option C is not viable for a `claude_local` managed agent.** A plugin's
`tools[]` declaration + `agents[].permissions.pluginTools` does NOT surface the tool into the
agent's Claude Code tool environment. `ctx.tools.register` registers the tool with the worker/
host, but the `claude_local` adapter's agent session never receives it (it would have to be
wired as an MCP server the agent's session connects to — the agent itself diagnosed exactly
this). Plan 03-07's premise (copied from `plugin-llm-wiki`) does not hold here — either
`plugin-llm-wiki`'s tool reaches its agent by a different mechanism, or that pattern was never
exercised end-to-end against a `claude_local` agent.

This is the phase advisory anti-pattern realised exactly: the 03-07 host-faithful e2e faked
`ctx.tools.register` + a fake agent calling the tool. A fake cannot model "the real
`claude_local` agent has no such tool on its surface." Only the live drill caught it.

**THE PATH — Option B (worker reads the agent's issue document).** The agent's reliable,
observed behaviour is: it stores the result as an issue **document** and marks the operation
issue `done`. That is a stable contract the worker CAN consume. Plan 03-08 (gap closure):
1. Abandon the tool channel. `deliverAgentTask`'s readback reads the operation issue's document
   via the issues documents API (`GET /api/issues/{id}/documents/{key}` or list+get), parsing
   the `BulletinDraft` / TL;DR out of it; poll until the operation issue is `done` or the
   document appears.
2. Pin the document key by CONTRACT — instruct the agent (in the operation-issue DESCRIPTION,
   which propagates; not the static manifest, which does not) to store the result as an issue
   document with an exact key (e.g. `compile-result`) and nothing else. The agent already chose
   `compile-result` unprompted — make it deterministic.
3. Diagnose why 03-07's existing comment+document fallback poll did NOT publish despite the
   agent filing a document — that fallback was meant to be exactly this Option-B path. Likely a
   wrong documents-API shape, a key mismatch, or an operation-issue id mismatch. The worker log
   is the artifact to read.
4. The manifest `tools[]` / `agent.tools.register` capability / `permissions.pluginTools` block
   from 03-07 are dead weight — remove or leave inert.
5. Operability: clear stale `editor_agent_failures` rows; the compile loop creates a new
   operation issue per cron fire because the agent marks each one `done` (idempotency search
   skips done issues) — acceptable, but the worker should advance `next_due_at` only on publish.

---

## Plan 03-08 closure re-drill — 2026-05-17 — DID NOT PASS (root cause CONFIRMED)

**Build:** `clarity-pack-0.4.0.tgz` (Option B document-readback). Installed clean on Countermoves.

**What the drill PROVED (Option B agent side works end-to-end):**
- Worker created operation issue **COU-15** (`727112e2-8dca-4a91-af35-13cdc1bad104`),
  `bulletin-compile` cycle 1, assigned to the Editor-Agent.
- The operation-issue DESCRIPTION carried the compile prompt **plus** `RESULT_DELIVERY_INSTRUCTION`
  — the agent transcript shows it read that instruction, explicitly noted `submit-compile-result`
  is unreachable (Option C dead — re-confirmed), and routed to the document channel.
- The agent produced a **flawless `BulletinDraft`** (clean JSON, 6308 chars, `{{NUMBER:key}}`
  placeholders intact) and filed it as an issue **document at the exact key `compile-result`**
  (`public.issue_documents` row: issue COU-15, key `compile-result`, document `61dc402d…`,
  created `2026-05-17 05:14:14Z`). It then marked COU-15 `done`.

**What FAILED:** the worker never published — `bulletins` shows only the bootstrap `cycle_number 0`,
no `Bulletin No. N` issue, one `editor_agent_failures` row stamped `plugin_version='0.4.0'`
(a `deliverAgentTask` 300s timeout). `/COU/bulletin` correctly shows its empty state.

**ROOT CAUSE — `isResultDocument` rejects every valid draft (a Clarity Pack bug, NOT the host).**
`agent-task-delivery.ts` `isResultDocument` → `isResultComment` calls
`validateDraftSchema(parsed, {})` with an **empty facts table**. But `validateDraftSchema`
(`compile-pass-1.ts:113-119`) does NOT only check structural shape — it loops every
`department.editorialSummary` and runs `replaceSlots(summary, facts)`, which **throws
`UNKNOWN_SLOT:<key>`** (`facts-table.ts:81-83`) for any `{{NUMBER:key}}` placeholder not in
the facts table. With `facts = {}`, EVERY placeholder is unknown → `validateDraftSchema` throws
→ `isResultComment` catch → returns `false`. So `deliverAgentTask`'s `documents.get` correctly
fetched the agent's document on every 5s poll, but `isResultDocument` rejected it ~36×, the
loop ran to the 300s deadline, and the timeout was recorded as a compile failure.

The `agent-task-delivery.ts:200-208` comment asserted calling `validateDraftSchema` with `{}`
was safe ("the readback only needs the structural shape"). That assumption is **false** —
`validateDraftSchema` resolves slots. The Task 3 host-faithful e2e test passed only because its
fixture draft had no `{{NUMBER:key}}` placeholders in any `department.editorialSummary` — the
exact "green local suite ≠ live agent" anti-pattern flagged in `.continue-here.md`.

SDK shapes are all CORRECT — `documents.get(issueId, key, companyId)` arity verified against
`types.d.ts:819`; `IssueDocument.body` is the body field; capability `issue.documents.read`
present. The host and the agent are blameless. This is a one-spot validator-misuse bug.

**THE FIX (Plan 03-09 — Option B readback validation):**
- The readback must validate STRUCTURE ONLY — never resolve `{{NUMBER:key}}` slots. Slot
  resolution against the REAL facts table happens downstream in `compilePass1`; the readback
  only needs "is this a structurally-valid `BulletinDraft` JSON object".
- Split `validateDraftSchema` into a structural core (the object/array checks,
  `compile-pass-1.ts:93-111`) and the slot-resolution pass (`:113-119`), OR add a
  `resolveSlots: boolean` parameter. `isResultComment`/`isResultDocument` call structure-only.
- Regression test MUST use a fixture draft WITH `{{NUMBER:key}}` placeholders in a
  `department.editorialSummary` — the current fixture would not catch this.
- `compile-bulletin.ts` / `compilePass1`'s production validation path is UNCHANGED (it still
  resolves slots with the real facts table — that contract is correct).
- ~15–25 LOC. The architecture (Option B document handoff) is fully proven; this is the last
  byte of the readback. Re-pack 0.4.0→0.5.0, re-drill from the compile step.

**Pre-re-drill cleanup:** `DELETE FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures
WHERE plugin_version='0.4.0';` (the 0.5.0 bump also version-scopes the breaker past it).

---

## Plan 03-09 closure re-drill — 2026-05-17 — DID NOT PASS (readback PROVEN; standing-number schema-drift gap)

**Build:** `clarity-pack-0.5.0.tgz` (sha256 `e687615287c65ab65a43356a64983d949dc4eb69fc4ff3b59aa5dadb4785f113`).
Installed clean on Countermoves Hostinger via `install-helper.sh` —
`pnpm paperclipai plugin list` → `key=clarity-pack status=ready version=0.5.0
id=0d4fc40a-0541-4b67-8979-9d346cb9c07b`.

**Pre-drill:** snapshot `2026-05-17T07-02-14Z` taken (recorded snapshot-only practice — Eric's
explicit choice, matching every Phase 2/3 drill; the full gate+verify bookend was exercised once
at the Phase 1 rehearsal). `postgres.dump` 2.98 MB + `instance-fs.tar.gz` 144 MB, both
sha256-verified — the rollback bookend held intact across the whole drill. v0.4.0 uninstalled
cleanly. NOTE: the plan's cleanup step `DELETE … WHERE plugin_version='0.4.0'` returned
`DELETE 0` — there were ZERO `0.4.0`-stamped `editor_agent_failures` rows. The plan mis-scoped
the stale state; the real prior failure history was elsewhere. Harmless (the 0.5.0 bump
version-scopes the breaker regardless), but noted: the cleanup step was a no-op.

**What the drill PROVED — Plan 03-09's readback fix works end-to-end on the live instance.**
v0.5.0 ran THREE real `compile-bulletin` pipeline runs (07:15, 07:17, 07:19 UTC). The worker log
at 07:19:43 shows the structure-only readback ACCEPTING the agent's placeholder-bearing draft,
verbatim:

> `[plugin] agent-task-delivery: result DOCUMENT received on operation issue`
> `35c023f5-a6c0-4e5e-9ade-ba652d9839fa (key=compile-result)`

`validateDraftStructure` accepted the agent's `BulletinDraft` document **with its
`{{NUMBER:key}}` placeholders intact** — no ~36×-rejection poll loop, no `deliverAgentTask` 300s
timeout. The v0.4.0 readback validator-misuse bug (`validateDraftSchema(parsed, {})` throwing
`UNKNOWN_SLOT` on every placeholder — the entire reason Plan 03-09 existed) is **DEAD**. Plan
03-09's stated objective is met: the readback validates STRUCTURE ONLY and never resolves slots.

**What FAILED — a NEW, UNRELATED gap blocks Phase 3 closure: standing-number schema drift.**
Immediately after the structure-only readback accepted the draft, `verifyDraft` pass-2 ran its 5
standing-number `ctx.db.query` calls — and ALL FIVE failed at the Paperclip host RPC layer
(`ERROR: host handler error {method: "db.query"}`):

| Standing number | `db.query` failure |
|---|---|
| `mrr` | `column "active_subscription_cents" does not exist` |
| `briefs_sent_week` | `column "tags" does not exist` |
| `reply_rate_7d` | `column "tags" does not exist` |
| `discoveries_7d` | `column "tags" does not exist` |
| `refund_rate_30d` | `column "tags" does not exist` |

The standing-number SQL queries (`src/worker/bulletin/standing-numbers.ts`, and almost certainly
`src/worker/bulletin/facts-table.ts`, which runs the same/similar queries) reference columns
that **do not exist in the live Paperclip schema**. `active_subscription_cents` and an
`issues.tags` column are both invented/wrong against Countermoves' actual tables.

**FAILURE ROWS** (`plugin_clarity_pack_cdd6bda4bd.editor_agent_failures`, `plugin_version='0.5.0'`):

| id | consecutive | reason |
|---|---|---|
| 529 | 1 | `draft_schema_invalid: UNKNOWN_SLOT:key` |
| 530 | 2 | `draft_schema_invalid: UNKNOWN_SLOT:key` |
| 531 | 3 | `verifier rejected:` — all 5 slots `"actual":"query_failed"` |

The `UNKNOWN_SLOT:key` runs cascade from the same root: `computeFactsTable` hits the broken
`ctx.db.query`, returns an empty facts table, the prompt then has no real fact keys, and the
agent emits the literal template placeholder `{{NUMBER:key}}`. The breaker tripped at
`consecutive=3`, paused the Editor-Agent; every later cron fire no-op'd with
`"Editor-Agent is paused AND the bulletin-compile circuit breaker is open — not resuming (D-06)"`.

No `Bulletin No. N` issue was published. `bulletins` still holds only the bootstrap
`cycle_number 0` (`compile_status=pending`). Operation issue = COU-20
(uuid `35c023f5-a6c0-4e5e-9ade-ba652d9839fa`).

**Why the local suite missed it.** The 690-test suite is green because the host-faithful fakes
return canned `db.query` results — they never execute the standing-number SQL against a real
Paperclip schema. This is exactly the `.continue-here.md` blocking anti-pattern: "green local
suite ≠ live agent/host behaviour." The same anti-pattern that hid the 03-08 validator-misuse
(fixture had no `{{NUMBER:key}}` placeholders) now hides a SQL-vs-schema mismatch — only a live
drill against the real Postgres schema surfaces it.

**Post-drill:** v0.5.0 uninstalled (no `--purge` — plugin-namespace data + the agent's
`compile-result` document on COU-20 preserved). Box quiet. Bookend snapshot `2026-05-17T07-02-14Z`
intact; no restore needed (the instance was not degraded — the failure was contained to the
plugin's own compile loop, which the breaker correctly halted).

**THE FIX (Plan 03-10 — standing-number / facts-table schema-drift closure):**
1. Correct the standing-number SQL in `src/worker/bulletin/standing-numbers.ts` and the
   facts-table SQL in `src/worker/bulletin/facts-table.ts` to match Paperclip's ACTUAL schema —
   discover the real columns via `\d` on the live Countermoves tables. `active_subscription_cents`
   and an `issues.tags` column are both wrong/invented and must be replaced with whatever the
   live schema actually exposes (or the standing number re-derived from real columns).
2. A `gsd-debugger` pass against the live schema is the natural first step — enumerate the
   queries each of the 5 standing numbers + the facts table issues, run each against the real
   `paperclip_countermoves` schema, and record the correct column mapping.
3. Re-pack (0.5.0 → 0.6.0), re-drill from the compile step. The breaker is version-scoped, so a
   fresh install is not DOA on the three `0.5.0` rows; clear them belt-and-suspenders if desired.
4. The Option B document-handoff + the structure-only readback (Plan 03-08 + 03-09) are FULLY
   PROVEN — do NOT re-open them. Plan 03-10's scope is the standing-number/facts-table SQL only.

**Net Phase 3 status after 03-09:** the readback channel is closed and proven; Phase 3 closure
is blocked solely by the standing-number schema-drift gap. Plan 03-09's Tasks 1-2 are GREEN;
its Task 3 closure drill did not pass; routed to gap-closure Plan 03-10.
