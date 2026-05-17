---
slug: tldr-heartbeat-recursion
status: resolved
trigger: v0.6.4 cycle-2 drill — the editor TL;DR heartbeat infinite-recurses on its own operation issues + a malformed-array-literal db.execute error
created: 2026-05-17
updated: 2026-05-17
phase: 03-daily-bulletin
related_sessions:
  - cycle2-publish-and-tldr-typo.md (v0.6.4 — its bug-2 fix un-crashed the TL;DR heartbeat and unleashed this recursion)
note: root causes pinned by direct source read; FIX SHIPPED in v0.6.5 — full suite green + tsc clean; pending live re-drill
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

## Root causes (pinned from source — FIXED in v0.6.5)

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

**FIX SHIPPED (v0.6.5):** `handleEditorHeartbeat` now calls the new
`isOwnOperationIssue(issue)` predicate immediately after `ctx.issues.get` and
`continue`s — logging `Editor-Agent: skipped own operation issue (recursion
guard)` — for any issue whose `originKind` starts with
`OPERATION_ORIGIN_KIND_PREFIX` (`plugin:clarity-pack:operation:`). The plugin
never TL;DR-compiles its own plumbing, so no operation issue is ever spawned
from a `tldr-compile` / `bulletin-compile` operation issue. This is the same
exclusion the standing-number SQL already applies. The guard runs BEFORE
`deliveryLlmAdapter` / `compileTldr`, so the cascade is dead at its source.

### Bug 2 — TL;DR write: scalar hash into an array column

`malformed array literal: "<hex hash>"` from `db.execute`. The `tldr_cache`
table (migrations/0002_tldrs_and_editor.sql) has TWO `text[]` array columns:
`source_revisions` AND `tags`. `upsertTldr` (src/worker/db/tldr-cache.ts) bound
JS string arrays directly as `$N` parameters. The host's `ctx.db.execute`
parameter bridge does NOT round-trip a JS array as a native Postgres array — it
arrives at Postgres as a scalar, and Postgres then fails to coerce the scalar
into `text[]`.

**FIX SHIPPED (v0.6.5):** the new `toPgTextArrayLiteral(values: string[])`
encodes a JS array as a Postgres array-LITERAL string (`['h']` → `{"h"}`, `[]`
→ `{}`, with per-element quote/backslash escaping). `upsertTldr` binds BOTH
`text[]` columns through it AND adds explicit `$6::text[]` / `$8::text[]` casts
in the INSERT SQL — a cast scalar is unambiguously coerced regardless of how
the host bridge serializes the parameter. `tags` had the identical latent bug
(the debug doc only saw `source_revisions` fail because that placeholder is
earlier in the row); both are fixed.

## Verification (v0.6.5 — DONE)

- **Bug 1 regression** — new file
  `test/worker/agents/editor-heartbeat-recursion.test.mjs` (5 tests): a
  `tldr-compile` / `bulletin-compile` operation issue passed to
  `handleEditorHeartbeat` is SKIPPED with ZERO `issues.create` calls; an
  ordinary issue still proceeds into the compile path; a 5-issue operation-issue
  batch spawns ZERO new operation issues (the cascade is dead);
  `isOwnOperationIssue` truth table.
- **Bug 2 regression** — 3 new tests in `test/worker/tldr-cache.test.mjs`:
  `toPgTextArrayLiteral` encoder contract (incl. 64-hex-char hash + escape
  cases); `upsertTldr` binds `$6::text[]`/`$8::text[]` casts and array-literal
  STRING params; a TL;DR round-trips — `source_revisions`/`tags` stored and read
  back as JS arrays. The host-faithful fakes in `tldr-cache.test.mjs` +
  `editor-agent.test.mjs` decode the array literal on store, mirroring the live
  host's `postgres`-driver round-trip.
- **Full suite green** — 718 pass / 0 fail / 2 pre-existing skips (720 total).
- **tsc clean** — `tsc --noEmit` exits clean.
- **Artifacts rebuilt** — `dist/worker.js` (182.8 kB), `dist/ui/index.js`
  (105.1 kB), `dist/manifest.js` (version `0.6.5`). `npm pack` →
  `clarity-pack-0.6.5.tgz` (72.6 kB, 9 files).
- **Drill reset (PENDING — operator step):** RESTORE snapshot
  `2026-05-17T12-52-04Z` (pre-cascade) so the v0.6.5 drill runs on a clean
  board, then install `clarity-pack-0.6.5.tgz` and re-drill. The live re-drill
  is the final proof — this session's verification is local-suite + tsc only.

## Process note

This is the 5th fix round on Phase 3 closure on 2026-05-17. The v0.6.4 round
fixed the cycle-2 publish bug (proven live) but its bug-2 fix unleashed this
recursion — fixing a crash without realising the crash was load-bearing. The
host-faithful local suite never exercises the live editor-heartbeat →
operation-issue → heartbeat loop. The new
`editor-heartbeat-recursion.test.mjs` closes that gap for the recursion guard
specifically, but a faithful integration test of the FULL live loop (heartbeat
fires → operation issue created → host re-emits issue.created → heartbeat fires
again) is still a standing open recommendation before further drills.
