---
slug: tldr-heartbeat-recursion
status: investigating
trigger: v0.6.4 cycle-2 drill — the editor TL;DR heartbeat infinite-recurses on its own operation issues + a malformed-array-literal db.execute error
created: 2026-05-17
updated: 2026-05-17
phase: 03-daily-bulletin
related_sessions:
  - cycle2-publish-and-tldr-typo.md (v0.6.4 — its bug-2 fix un-crashed the TL;DR heartbeat and unleashed this recursion)
note: root causes pinned by direct source read; fix pending — this is the v0.6.5 work
---

# Debug: tldr-heartbeat-recursion

## Symptoms

The v0.6.4 cycle-2 re-drill (live Countermoves, 2026-05-17 ~12:53) PUBLISHED
Bulletin No. 2 successfully (`compile-bulletin: publishBulletin result …
kind:"published"`, cycle_number=2, issue c29d5ef7) — the cycle-2 publish fix is
proven. But two new failures appeared:

1. **Infinite TL;DR recursion.** The worker log fills with
   `agent-task-delivery: created operation issue … kind=tldr-compile
   originId=tldr-<previous-operation-issue-id>` — an unbounded chain. Editor-Agent
   ran 17+ concurrent runs; the cascade kept producing operation issues even
   after the compile-bulletin job succeeded. Halted only by uninstalling the
   plugin (~12:56) — and the Editor-Agent still has a large assigned-issue
   backlog (operator must Pause the agent).

2. **`ERROR: host handler error {method:"db.execute"}`** paired with
   `Editor-Agent: skipped TL;DR compile … reason: "malformed array literal:
   \"<64-hex-char hash>\""` — every TL;DR write fails at the host db layer.

## Root causes (pinned from source — fix pending)

### Bug 1 — editor heartbeat recurses on its own operation issues

`handleEditorHeartbeat` (src/worker/agents/editor.ts) buckets `issue.created` /
`issue.updated` events and calls `compileTldr` for EVERY issue. `compileTldr`
goes through `deliveryLlmAdapter` → `deliverAgentTask`, which CREATES a
`tldr-compile` operation issue. That operation issue is itself an
`issue.created` event → the next heartbeat TL;DR-compiles IT → creates another
`tldr-compile` operation issue → unbounded. The log's `originId=tldr-<prev-id>`
chain is the proof.

This was LATENT — until v0.6.4 the heartbeat crashed instantly on the
`ctx.issue` typo (the accidental circuit breaker). The v0.6.4 bug-2 fix
(`cycle2-publish-and-tldr-typo.md`) un-crashed the path WITHOUT adding a guard
to skip the plugin's own operation issues — so the recursion was unleashed.

FIX DIRECTION (v0.6.5):
- In `handleEditorHeartbeat`, after `ctx.issues.get(issueId)`, SKIP any issue
  whose `originKind` starts with `OPERATION_ORIGIN_KIND_PREFIX`
  (`plugin:clarity-pack:operation:`) — the plugin must never TL;DR-compile its
  own plumbing. (`OPERATION_ORIGIN_KIND_PREFIX` lives in
  src/worker/agents/agent-task-delivery.ts. Confirm the SDK `Issue` type exposes
  the persisted `originKind` field — 03-10-SCHEMA-FINDINGS confirmed the
  `origin_kind` column exists; check the SDK Issue shape for the camelCase
  accessor.)
- Belt-and-suspenders HARD GUARD: a `tldr-compile` operation issue must never
  trigger another `tldr-compile`. Consider also filtering in
  `filterSelfLoopEvents` or at the `deliverAgentTask` level.
- The same exclusion the standing-number SQL already uses
  (`origin_kind NOT LIKE 'plugin:clarity-pack:operation:%'`).

### Bug 2 — TL;DR write: scalar hash into an array column

`malformed array literal: "<hex hash>"` from `db.execute`. The `tldr_cache`
table has a `source_revisions[]` array column (per CLAUDE.md sketch:
`tldrs(issue_id, summary, generated_at, source_revisions[],
compiled_by_agent_id)`). The TL;DR write path (likely `upsertTldr` in a
tldr-cache repo, or `compileTldr` in src/worker/agents/compile-tldr.ts) passes a
single content-hash STRING where Postgres expects an array literal.

FIX DIRECTION (v0.6.5): grep `source_revisions` — find the INSERT/UPSERT — and
pass the hash as a single-element array (`['<hash>']` / a proper `text[]`
parameter), not a bare string. Add a regression test.

## Verification plan (v0.6.5)

- Regression test: a `tldr-compile` (or any `plugin:clarity-pack:operation:*`)
  operation issue passed to `handleEditorHeartbeat` is SKIPPED — no `compileTldr`,
  no `deliverAgentTask` call.
- Regression test: the TL;DR write stores `source_revisions` as a valid array.
- Full suite green + tsc clean.
- Drill reset: RESTORE snapshot `2026-05-17T12-52-04Z` (pre-cascade) so the
  v0.6.5 drill runs on a clean board, then install v0.6.5 and re-drill.

## Process note

This is the 5th fix round on Phase 3 closure on 2026-05-17. The v0.6.4 round
fixed the cycle-2 publish bug (proven live) but its bug-2 fix unleashed this
recursion — fixing a crash without realising the crash was load-bearing. The
host-faithful local suite never exercises the live editor-heartbeat →
operation-issue → heartbeat loop. A faithful integration test of that loop is a
standing open recommendation before further drills.
