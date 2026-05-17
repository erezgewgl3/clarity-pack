---
slug: cycle2-publish-and-tldr-typo
status: resolved
trigger: v0.6.3 cycle-2 drill — cycle 2 silently never publishes + TL;DR compile crashes every heartbeat
created: 2026-05-17
updated: 2026-05-17
phase: 03-daily-bulletin
related_sessions:
  - bulletin-content-defects.md (v0.6.3 — its defect-C "fix" hid bug 2 below)
investigation: direct source read (no debug subagent — operator chose deep investigation after 3 green-suite-but-broken-live rounds)
---

# Debug: cycle2-publish-and-tldr-typo

## Symptoms

The v0.6.3 closure re-drill (live Countermoves, 2026-05-17): the agent compiled
cycle 2 (COU-32 done, compile-result document filed), the worker logged
`agent-task-delivery: result DOCUMENT received`, the compile-bulletin job logged
`job completed successfully` (~70s) — but NO `bulletins` cycle-2 row, NO
`editor_agent_failures` row, NO `ERROR` log. cycle 2 never published; the job
re-created a cycle-2 operation issue every ~2 min forever. Separately, every
heartbeat logged `Editor-Agent: skipped TL;DR compile … Cannot read properties
of undefined (reading 'comments')`.

## Resolution

### Bug 1 — every cycle >= 2 silently fails to publish (latent since Plan 03-02)

ROOT CAUSE: `publishBulletin`'s idempotency pre-check (publish.ts) keyed on
`next_due_at`: `SELECT … WHERE next_due_at = $1 AND compile_status='published'`.
But `next_due_at` is the SCHEDULE POINTER — after a cycle publishes, the
compile-bulletin job (step 7) advances that cycle's OWN row to carry the time
the NEXT cycle is due (and `getNextDueAtForCompany` returns the highest-cycle
row's `next_due_at`). So the prior published cycle's row carries the exact
`next_due_at` value the next cycle publishes under. The pre-check matched the
PRIOR cycle, `existingHash !== contentHash` → returned `{kind:'failed', reason:
'published bulletin already exists for next_due_at with a different
content_hash'}`. compile-bulletin recorded a `bulletin_compile_failures` row and
`continue`d. Every cycle >= 2 fails identically. NOT a v0.6.3 regression —
latent since Plan 03-02; first hit now because no instance had ever reached a
2nd cycle. (The drill's manual `UPDATE next_due_at = now()` faithfully
reproduced what would happen naturally at the next 06:30 ET.)

FIX (commit 2b1419f): re-key the pre-check on the stable per-bulletin identity
`(company_id, cycle_number)` — "has THIS cycle already published?". No
migration: the INSERT `ON CONFLICT (next_due_at, content_hash)` and the phase-3
UPDATE stay keyed on `(next_due_at, content_hash)`, which IS unique across
cycles because `content_hash` differs (the v0.6.3 buildMasthead stamps the date
into every body, so consecutive cycles never share a hash).

### Bug 2 — the Editor-Agent TL;DR compile has never run

ROOT CAUSE: editor.ts `handleEditorHeartbeat` read comments via
`ctx.issue.comments.read(issueId)` — `ctx.issue` (SINGULAR) is undefined on the
host `PluginContext`; the real client is `ctx.issues` (plural). The
`EditorHeartbeatCtx` type even DECLARED a fictional `issue: { comments: { read
} }` member. Every heartbeat threw `Cannot read properties of undefined (reading
'comments')` per issue → no TL;DR ever compiled. The v0.6.3 defect-C "fix"
looked at the per-issue catch, ASSUMED the error was a benign "delivery timeout
when the agent is paused", downgraded the log WARN→info, and never checked what
the error actually was.

FIX (commit 2b1419f): `ctx.issues.listComments(issueId, companyId)` — the real
host API (confirmed against agent-task-delivery.ts + issue-reader.ts usage;
`IssueComment` has `.body`). The fictional `issue` member dropped from
`EditorHeartbeatCtx`.

### Also — compile-bulletin instrumentation

The post-readback path logged NOTHING between `result DOCUMENT received` and the
job ending, so bug 1's silent failure was undiagnosable from the run log.
compile-bulletin now logs the `verifyDraft` verdict, the `publishBulletin`
result kind, and a `warn` on a publish failure.

## Verification

- 2 new regression tests (publish.test.mjs — cycle-2 pre-check keying;
  bulletin-content-defects.test.mjs — heartbeat reads via listComments).
- idempotency.test.mjs DB fake updated to the cycle-scoped pre-check query (its
  assertions — re-publishing the same cycle with changed content → `failed` —
  are unchanged and still valid).
- Suite 712 tests, 710 pass / 0 fail / 2 skip; `tsc --noEmit` clean.
- Packaged clarity-pack-0.6.4.tgz, sha256
  4af8406764f63ea76a1afb0ff5ca979b1aa76d08a7d2d5e118cfff27182da1da (commit
  c375004). NOT yet verified live — awaiting the v0.6.4 closure re-drill.

## Process note

Three prior debug rounds today each shipped a green 700+-test suite that then
broke live in a new way — the host-faithful fakes do not model the live job /
agent control flow ("green suite ≠ live behaviour", the project's own
.continue-here.md anti-pattern). This round was done by direct source reading
instead of a debug subagent, and both root causes were pinned from the code
with no live document needed. A faithful integration test that exercises the
real compile-bulletin job control flow remains an open recommendation before
further drills.
