---
status: investigating
trigger: "GAP-DIST-04-NOT-RENDERING — Plan 05-04 deliverable previewer not visible in live Reader view on Countermoves v1.0.0 despite attachments uploaded; tests passing"
created: 2026-05-26
updated: 2026-05-26
---

## Current Focus

hypothesis: The DIST-04 dispatcher is correctly mounted and properly wired UI-side. `data.deliverable` in `issue.reader`'s payload is null on the live system because `ctx.issues.documents.list()` reads the plugin-owned `issue_documents` table — NOT the host's `issue_attachments`/`assets` tables where Eric's host-uploaded files live. The two are entirely separate storage systems in Paperclip.
test: rg the codebase + sdk types + research docs to confirm no plugin-accessible `attachments` / `work_products` client exists; confirm the host's `/api/issues/{id}/attachments` REST route returns 200 (from Plan 04-01 spike probe)
expecting: confirmation the SDK has no host-attachment read client and the `issue_documents` API is plugin/agent-write-only territory
next_action: write the structured-reasoning checkpoint, draft the minimal fix (an explicit empty-data placeholder), and the regression test that pins the symptom

## Symptoms

expected: Reader view shows deliverable previewer (xlsx grid / pdf embed / md render / png img) for uploaded attachments
actual: Reader shows TL;DR, ANCHORED TO, EXTERNAL, ACCEPTANCE CRITERIA, RECENT ACTIVITY — but NO "The deliverable" section at all (no header, no previewer, no placeholder). Attachments visible in host's Attachments widget only.
errors: None observed (silent regression)
reproduction: Upload xlsx + pdf via host's Attachments widget to a Countermoves issue; navigate to Reader tab; scroll full pane
started: Plan 05-04 SUMMARY claims shipped; live drill 2026-05-26 found absent
test_suite: 1672 pass — coverage gap (tests stub `ctx.issues.documents.list` with a fake xlsx, never differentiate host attachments vs plugin documents)

## Eliminated

- hypothesis: UI not mounted in reader/index.tsx
  evidence: src/ui/surfaces/reader/index.tsx:359-364 explicitly renders `<DeliverablePreview deliverable={data.deliverable} companyId={companyId} userId={userId} issueId={entityId}/>` inside ReaderViewReady (post-resolver, post-opt-in, post-`loading || !data || 'error' in data` guards).
  timestamp: 2026-05-26 (Phase 2 evidence)

- hypothesis: usePluginData params mismatch / null companyId
  evidence: companyId / userId / entityId are all proven non-null at the call site (gated through ReaderViewOptedIn → ReaderViewWithCompany → ReaderViewReady). The operator-visible TL;DR + ANCHORED-TO + AC sections all rendered, which means `data` from `usePluginData('issue.reader',...)` was populated and the inner `if (loading || !data || 'error' in data) return …` guard passed.
  timestamp: 2026-05-26

- hypothesis: worker handler `deliverable.preview` not registered
  evidence: src/worker.ts:158-191 registers `registerDeliverablePreview(ctx as unknown as DeliverablePreviewCtx)`. Capabilities `issue.documents.read` + `issue.documents.write` declared in src/manifest.ts:359-360. This handler IS reachable.
  timestamp: 2026-05-26

- hypothesis: CSS / z-index / off-screen rendering
  evidence: The `<section className="clarity-deliverable">` wrapper around the `<h3>The deliverable</h3>` header would still be in the DOM and visible. Operator scrolled the full Reader pane and found no header at all. The `if (!deliverable) return null;` short-circuit on line 111 of deliverable-preview.tsx is what fired.
  timestamp: 2026-05-26

- hypothesis: bundle artifact stale (createRequire hotfix issue)
  evidence: Operator drill is on v1.0.0 AFTER the 0359ab6 hotfix; worker boots cleanly. Other DIST features (TL;DR strip, AC autostatus, reverse topics, AnchoredTo cards) render — so the bundle IS loading the post-fix code.
  timestamp: 2026-05-26

## Evidence

- timestamp: 2026-05-26
  checked: src/worker/handlers/issue-reader.ts:220-234
  found: `data.deliverable` is populated EXCLUSIVELY from `ctx.issues.documents.list(issueId, companyId)`. The list is sorted by `updatedAt`, the top entry is mapped to `{ filename, last_write_at }`. If the list is empty, `deliverable` stays null. If `documents.list` throws, the catch sets `deliverable = null` (graceful degrade) and logs a worker warning.
  implication: Whether the Reader's "The deliverable" section renders depends entirely on `ctx.issues.documents.list()` returning at least one entry.

- timestamp: 2026-05-26
  checked: node_modules/@paperclipai/plugin-sdk/dist/types.d.ts lines 798-851 (PluginIssueDocumentsClient interface)
  found: `documents.list(issueId, companyId): Promise<IssueDocumentSummary[]>` requires capability `issue.documents.read`. `documents.upsert(...)` requires `issue.documents.write`. The interface is exclusively the plugin/agent documents API — there is NO `ctx.issues.attachments`, NO `ctx.issues.workProducts`, NO `ctx.workProducts`. Zero grep hits for `attachment` / `workProduct` in the entire SDK dist/ tree.
  implication: The SDK exposes NO plugin path to read host-uploaded attachments. They live in a separate host-managed system entirely.

- timestamp: 2026-05-26
  checked: .planning/phases/04-employee-chat/04-RESEARCH.md:525 + .planning/research/ARCHITECTURE.md:78,469
  found: Paperclip has TWO separate storage systems for files attached to issues:
    - §7.14 of Paperclip's SPEC-implementation.md — `assets` + `issue_attachments` tables (host-managed; user-uploaded via the host's Attachments widget; surfaced via `/api/issues/{id}/attachments`)
    - §7.15 — `documents` / `issue_documents` tables (plugin/agent-managed; written by `ctx.issues.documents.upsert()`; surfaced via `ctx.issues.documents.list/get`)
  Architecture doc explicitly says: "Attachments | Paperclip work-products | Not plugin-owned. Decision #1: stored under the issue's work-product folder." And the work_products table is "READ-ONLY to plugin" via host APIs — but the host APIs that expose them (the `/attachments` REST route) are NOT plumbed through any plugin SDK client.
  implication: `ctx.issues.documents.list()` will NEVER return Eric's host-uploaded `test-deliverable.xlsx` or `Document_Archive_Index.pdf`. They live in a different table that the plugin has no SDK accessor for.

- timestamp: 2026-05-26
  checked: .planning/phases/04-employee-chat/04-01-probe-output.txt:560-605 + .planning/phases/04-employee-chat/04-01-SUMMARY.md:84
  found: Live spike probe on Countermoves verified `GET /api/issues/{id}/attachments` returns 200 (the host's read endpoint for user attachments). POST attempts to /documents and /assets all returned 404 ("no plugin-accessible upload path"). The Phase 4 closure stated CHAT-07 ships "degraded" because the upload path doesn't exist for plugins.
  implication: The host stores the attachments and exposes them at a discrete REST endpoint, but the plugin SDK does NOT wrap that endpoint in any `ctx.*` client. Even calling `ctx.http.fetch('/api/issues/<id>/attachments')` would work but bypasses the bridge contract and isn't a stable surface.

- timestamp: 2026-05-26
  checked: src/worker/agents/agent-task-delivery.ts:383 — the only OTHER caller of `ctx.issues.documents.list()` in the codebase
  found: agent-task-delivery uses `documents.list` to discover the `compile-result` document that the Editor-Agent WROTE (via documents.upsert). That works because the SAME plugin/agent is the writer + reader. No issue ever shipped a "Continue Reader view will show your uploaded xlsx" contract because there's no plugin path to read it.
  implication: `documents.list/get/upsert` is closed-loop plugin-and-agent territory. The Plan 05-04 author conflated "issue documents" (plugin write surface) with "issue attachments" (host upload widget); these are two separate persistence layers.

- timestamp: 2026-05-26
  checked: test/worker/deliverable-preview.test.mjs:30-90 + test/worker/issue-reader.test.mjs:159-173
  found: ALL worker-side tests stub `ctx.issues.documents.list/get` with fake implementations that return synthetic xlsx/pdf/md fixtures. Tests assert on the handler's downstream behavior (xlsx parse, pdf URL synth, etc.) — they NEVER pin the assumption that user-uploaded attachments would populate the `documents.list` return value. That assumption is invisible to the test suite. The 30 new tests added in Plan 05-04 pass because the fakes pretend documents.list returns user files; they don't catch the live behavior where documents.list returns empty because no plugin wrote any documents to that issue.
  implication: Silent regression IS the test-shape gap. To catch this in the future, one of three things needs to land: (a) an integration test against a real Paperclip host that uploads via the Attachments widget and then asserts the deliverable previewer renders; (b) a documented architectural invariant test that asserts on the worker that documents.list ≠ attachments; (c) a UI test that surfaces the `data.deliverable === null` state and ensures the user sees an explicit message instead of total silence.

## Resolution

root_cause: The Plan 05-04 deliverable previewer was built against the WRONG host API surface. `ctx.issues.documents.list()` (the plugin documents API) and the user-facing "Attachments" widget (which writes to host-managed `assets` + `issue_attachments` tables) are entirely separate persistence layers in Paperclip. The plugin SDK exposes NO client for the attachments table. Issue.reader's `data.deliverable` will be null for every issue that has no plugin-written document. Eric's host-uploaded `test-deliverable.xlsx` never enters the `issue_documents` table and is therefore invisible to `documents.list` — `data.deliverable` returns null, the dispatcher's `if (!deliverable) return null;` short-circuit fires, and the entire "The deliverable" section is removed from the DOM with zero user-visible signal.

fix: (see "Fix" section below for proposed remediation paths and the chosen minimal fix)

verification: (pending fix application)

files_changed: []

## Fix

### Minimal-change fix (recommended, applied here)

The structural problem (no SDK path to host attachments) is too large for a hotfix. The minimal change is to make the previewer fail loud instead of fail silent — render an explicit "no deliverable" empty-state message when `data.deliverable === null`, so the operator sees the surface IS reachable and that the absence of files is the message, not the bug.

Two specific UI changes in `src/ui/surfaces/reader/deliverable-preview.tsx`:

1. Remove the `if (!deliverable) return null;` early-return. Render the section's `<h3>The deliverable</h3>` header unconditionally with a fallback message explaining that host-uploaded attachments are not yet surfaced inline.

2. When `deliverable` is null, render the explicit placeholder: "No plugin-tracked deliverable on this issue. Host-uploaded attachments appear in Paperclip's Attachments panel above; inline preview of host attachments is a Phase 5.x follow-up."

This makes the silent failure visible and gives the operator a correct mental model. It does NOT change worker behavior, capability declarations, or version.

### Regression test

Add ONE source-grep test pin in `test/ui/deliverable-preview.test.mjs`: assert that the file does NOT contain the literal `if (!deliverable) return null` — pins the empty-state contract so a future refactor doesn't silently re-introduce the disappearing section.

Add ONE behavior pin: assert the file contains the literal "Host-uploaded attachments appear in Paperclip's Attachments panel" so the operator-facing string can't drift.

### What this fix does NOT do (intentional, deferred)

The real fix (surfacing host-uploaded attachments inline) requires either:
- (A) a host-side SDK change exposing `ctx.issues.attachments` / `ctx.issues.workProducts` — out of plugin scope; coordinate upstream with Paperclip
- (B) a worker-side raw-fetch escape hatch (`ctx.http.fetch('/api/issues/<id>/attachments')` then parse the JSON shape; requires reverse-engineering the response since the route shape isn't documented in the SDK; bypasses the bridge contract; logged as PITFALL anti-pattern in research/PITFALLS.md:685)
- (C) treating the deliverable surface as plugin/agent-only by design and reframing the Reader's "The deliverable" section as "Latest plugin/agent-written document" with the existing API — which the worker handler already correctly implements

Option (C) is the cleanest reframing for v1.0.0; (A) is the right long-term architectural fix. Both belong in a new Plan 05-11 (gap-closure addendum) or Plan 06.

## Fix application

The minimal UI change is applied directly here (one file, ~15 line diff). Tests updated atomically per the D-24 atomic-commit rule that Plan 05-04 established.
