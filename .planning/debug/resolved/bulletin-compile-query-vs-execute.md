---
status: resolved
trigger: "Daily Bulletin compile fails in production — INSERT-via-query bug + masked compilePass1 failure; harden test harness host-faithful"
created: 2026-05-15T00:00:00.000Z
updated: 2026-05-18T00:00:00.000Z
resolved: 2026-05-18
resolution_note: "Resolved in substance — the Resolution block below records the landed fix (INSERT-via-execute in bulletins-repo.ts + wrapHostFaithfulDb helper). The frontmatter status was never flipped at the time; closed during the Phase 3 reconciliation 2026-05-18."
---

## Current Focus

hypothesis: bulletins-repo.ts runs INSERT through ctx.db.query (SELECT-only host contract) in 3 functions; test fakes are too permissive so it was never caught.
test: fix repo to use ctx.db.execute; port host SQL classifier into a shared makeHostFaithfulDb() helper; run full suite.
expecting: hardened fakes surface latent defects; fix each.
next_action: fix bulletins-repo.ts then build shared host-faithful db helper.

## Symptoms

expected: compile-bulletin job compiles + publishes a Daily Bulletin against the real Paperclip host.
actual: recordCompileFailure throws JsonRpcCallError (INSERT via ctx.db.query); masks the real compilePass1 failure.
errors: "ctx.db.query only allows SELECT statements"
reproduction: run compile-bulletin job against real host.
started: Plan 03-02/03-05 compile path; never tested against real host constraints.

## Eliminated

## Evidence

- checked: SDK types.d.ts:369-377 — query=SELECT only, execute=INSERT/UPDATE/DELETE no-DDL returns {rowCount}.
- checked: bulletins-repo.ts — upsertBulletin/appendErratum/recordCompileFailure use ctx.db.query for INSERT.
- checked: tldr-cache.ts — already correct (execute for write).
- checked: appendErratum has ZERO callers in src/ — safe to return void.
- checked: publish.ts — already correct (execute for writes, query for SELECT).

## Resolution

root_cause: INSERT statements routed through ctx.db.query (SELECT-only host contract) in 3 bulletins-repo functions. Permissive test fakes never caught it. The recordCompileFailure crash masked the catch handler in compile-bulletin.ts.
fix: |
  1. bulletins-repo.ts — upsertBulletin/appendErratum/recordCompileFailure now INSERT via ctx.db.execute (no RETURNING); read-back via SELECT where a row is needed; recordCompileFailure returns void.
  2. test/helpers/host-faithful-db.mjs — new wrapHostFaithfulDb() enforces SELECT-only query / DML-only execute / single-statement, ported from the host SQL classifier.
  3. Wired host-faithful db into 10 test files.
  4. compile-pass-1.ts — dropped the ctx.llm fiction (never existed on SDK PluginContext); args.llm now required.
  Audit: session-llm-adapter.ts ctx.agents.sessions.* usage verified byte-correct against SDK types.d.ts — no mismatch.
verification: 584 tests pass (582 pass, 2 pre-existing skips); npx tsc --noEmit clean; worker+UI+manifest builds green.
files_changed:
  - src/worker/db/bulletins-repo.ts
  - src/worker/bulletin/compile-pass-1.ts
  - test/helpers/host-faithful-db.mjs
  - test/worker/bulletin/compile-bulletin-end-to-end.test.mjs
  - test/worker/bulletin/compile-bulletin-noop.test.mjs
  - test/worker/bulletin/publish.test.mjs
  - test/worker/bulletin/bulletin-by-cycle-handler.test.mjs
  - test/worker/bulletin/action-inbox-query.test.mjs
  - test/worker/bulletin/department-reconcile.test.mjs
  - test/worker/bulletin/standing-numbers.test.mjs
  - test/worker/bulletin/bulletin-action-handlers.test.mjs
  - test/worker/bulletin/compile-pass-1.test.mjs
  - test/worker/tldr-cache.test.mjs
  - test/worker/situation-snapshot.test.mjs
  - test/worker/situation-room-handler.test.mjs
