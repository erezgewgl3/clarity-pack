---
phase: 02-scaffold-and-surfaces
plan: 03c
parent_plans: [02-03, 02-03b]
type: gap-closure
subsystem: detail-tab-context-resolver
tags: [companyId, useResolvedCompanyId, plugin-detail-tab-props, prop-shape, resolver-hook, drill-closeout, fail-loud-vs-graceful]
requires:
  - Plan 02-03 (Editor-Agent + Reader view structure — all 10 components, Editor-Agent reconcile, 3 worker handlers)
  - Plan 02-03b (SDK shape drift fixes — issues.relations.get, issues.get(id, companyId), .description vs .body, query() returns T[])
  - SDK 2026.512.0 (PluginDetailTabProps shape locked at types.d.ts:197-203 — context.entityId / context.entityType statically non-null)
  - Empirical Countermoves Paperclip (~/paperclip @ 0.3.1) host-side source code probes (slots.tsx, IssueDetail.tsx) capturing the slot-mount calling convention
provides:
  - "02-03c-HOST-CONTEXT.md — empirical reference for what useHostContext() returns per slot type, derived from reading ~/paperclip/ui/src/plugins/slots.tsx slotContextToHostContext + IssueDetail.tsx PluginSlotMount wiring on Countermoves. 7 H2 sections. Durable reference for Phases 3-5 (every future plugin surface should consult this before assuming any field is populated)."
  - "useResolvedCompanyId() hook (src/ui/primitives/use-resolved-company-id.ts) — fallback chain useHostContext().companyId → URL-parse pathname → companies.resolve-prefix worker handler → cached UUID. Returns discriminated union {companyId, loading, error}. Pure URL-parse helper (extractCompanyPrefixFromPathname) is exported for unit testing."
  - "companies.resolve-prefix worker handler (src/worker/handlers/companies-resolve.ts) — Company.issuePrefix → Company.id resolution via ctx.companies.list + filter. Capability companies.read (already declared). Empty-prefix is a graceful no-op (returns null) to avoid 502 noise from the React-rules-of-hooks unconditional invocation pattern."
  - "ReaderView retrofit — reads context.entityId per PluginDetailTabProps shape (statically non-null per SDK). Splits into outer ReaderView (gating wrapper) + inner ReaderViewWithCompany (real work) so usePluginData's params shape stays stable across renders. Defect-class structurally impossible: companyId ?? '' to worker can never happen."
  - "LiveBlockerPanel retrofit — same outer/inner gating split. Returns null during resolver loading (right-rail panel non-essential during the loading window). Inner LiveBlockerPanelWithCompany only mounts with non-null companyId."
  - "Operator gotchas codified in MemPalace runbook room: (1) manual `pnpm paperclipai ...` MUST be run from `~/paperclip` (not just install-helper.sh; manual uninstall/list also subject); (2) safety CLI `verify` requires `--company-id` (not documented in --help)."
affects:
  - "Plan 02-04 (Situation Room + opt-in gate + coexistence CI). Inherits the useResolvedCompanyId hook for any company-scoped data. Plan 02-04 must verify PluginPage.tsx slot-mount construction (probe-2 captured the file location; per 02-03c-HOST-CONTEXT.md Section 2 it remains MEDIUM-confidence inferred until grepped before Situation Room ships)."
  - "Phase 3 (Daily Bulletin). Same — page slot type. PluginSettings.tsx grep also pending (Section 3 of HOST-CONTEXT.md, LOW-confidence inferred for settings page slot)."
  - "Phase 4 (Employee Chat). commentAnnotation slot type uses parentEntityId — must add a Section 4 to HOST-CONTEXT.md before chat data fetches assume context shape."
  - "Plan 02-05 (NEW, deferred follow-on) — React key warnings cleanup. 4 components affected (ClaritySurfaceRoot, Breadcrumb, AnchoredToCards, ActivityTimeline). Hypothesized root cause: host plugin-loader applyJsxRuntimeKey shim interaction with our esbuild jsx-runtime emit. Investigation spec at 02-03c-REACT-KEYS.md."
  - "Plan 02-06 (NEW, deferred follow-on) — LiveBlockerPanel UX cleanup. Worker uses 'EXTERNAL' kind for both fail-loud AND graceful 'No active blockers' cases; UI must differentiate so 'EXTERNAL' is never shown for graceful states."
  - "Plan 02-07 (NEW, deferred follow-on) — ActivityTimeline date formatting bug. Comment UUID leaks into the formatted-timestamp slot (`commentb2a22e50-…ago`). Pre-existing, masked until populated data arrived."
tech-stack:
  added: []
  patterns:
    - "PluginDetailTabProps shape — slot components MUST destructure {context} from props, not assume top-level fields. The SDK type contract guarantees context.entityId + context.entityType are non-null for detail-tab slots; everything else is string | null."
    - "Outer/inner gating-wrapper split — for any UI hook that returns a discriminated {value, loading, error} union, split the consumer into outer (state machine + early returns) + inner (real work, value-as-prop). Keeps usePluginData params shape stable across renders, makes 'empty-string-passthrough' bugs structurally impossible."
    - "Resolver hook calls usePluginData unconditionally per React rules-of-hooks; passes empty params when no resolution needed. Worker handlers must handle empty-params gracefully (return null) rather than throw, to avoid 502 console noise."
    - "Source-of-truth-from-host pattern — when SDK docs are ambiguous about how a host pipes data into a hook, read the host's actual source via SSH probe (single batched bash session per fail2ban rule). Higher confidence than spec, lower cost than browser instrumentation. Pattern: scripts/diag/<topic>-probe.sh for the probe + scripts/diag/<topic>-output.txt for the verbatim output."
    - "Drill verdict shape: 'approved — reader green WITH N polish items deferred'. Drill closes when blocking defects are gone; cosmetic / pre-existing items get filed as numbered follow-on plans (02-05/06/07) rather than blocking the main plan close."
key-files:
  created:
    - .planning/phases/02-scaffold-and-surfaces/02-03c-PLAN.md
    - .planning/phases/02-scaffold-and-surfaces/02-03c-HOST-CONTEXT.md
    - .planning/phases/02-scaffold-and-surfaces/02-03c-REACT-KEYS.md
    - .planning/phases/02-scaffold-and-surfaces/02-03c-SUMMARY.md
    - src/ui/primitives/use-resolved-company-id.ts
    - src/worker/handlers/companies-resolve.ts
    - test/ui/use-resolved-company-id.test.mjs
    - test/ui/reader-view-null-context.test.mjs
    - test/ui/live-blocker-panel-null-context.test.mjs
    - test/worker/companies-resolve.test.mjs
    - scripts/diag/02-03c-host-context-probe.sh
    - scripts/diag/02-03c-host-context-probe-2.sh
    - scripts/diag/02-03c-company-shape-probe.sh
    - scripts/diag/02-03c-host-context-output.txt
    - scripts/diag/02-03c-host-context-output-2.utf8.txt
    - scripts/diag/02-03c-company-shape-output.utf8.txt
    - scripts/diag/02-03c-company-ts.txt
  modified:
    - src/ui/surfaces/reader/index.tsx (PluginDetailTabProps shape fix + resolver retrofit + outer/inner gating split)
    - src/ui/surfaces/reader/live-blocker-panel.tsx (resolver retrofit + outer/inner gating split)
    - src/worker.ts (registers companies.resolve-prefix handler)
    - runbook/REHEARSAL.md (Phase 2 Reader-tab visual rehearsals — APPROVED row 2026-05-14T09:08+ + 5 anchors + 3 deferred items + 2 operator gotchas)
tests:
  added: 41  # net new tests across Tasks 2.1-2.4 + 2.5/2.6 (count includes URL-parse helper unit tests + source-grep structural contract tests + worker handler unit tests)
  passing: 125
  baseline: 84
commits:
  - "1d424b2 — docs(02-03c): Task 1 — empirical useHostContext() per-slot reference"
  - "76f6538 — feat(02-03c): Task 2.1 — companies.resolve-prefix worker handler"
  - "516477f — feat(02-03c): Task 2.2 — useResolvedCompanyId hook + URL-parse fallback"
  - "23b34a8 — feat(02-03c): Task 2.3 — retrofit ReaderView to use the resolver hook"
  - "8cdf1f1 — feat(02-03c): Task 2.4 — retrofit LiveBlockerPanel to use the resolver hook"
  - "cf3084f — fix(02-03c): Task 2.5+2.6 — drill gap fixes from Task 4 attempt #1 (PluginDetailTabProps shape + handler graceful-empty)"
drill_verdict:
  date: "2026-05-14T09:08+"
  result: "approved — reader green WITH 3 polish items deferred"
  test_issue: "COU-1 (Smoke test — confirm CEO agent is operational)"
  pre_snapshot: "2026-05-14T08-58-29Z"
  post_snapshot: "2026-05-14T09-50-17Z"
  closes: ["02-03", "02-03b", "02-03c"]
deferred_to_followons:
  - "Plan 02-05 — React key warnings cleanup (per 02-03c-REACT-KEYS.md)"
  - "Plan 02-06 — LiveBlockerPanel UX (graceful-EXTERNAL vs fail-loud differentiation)"
  - "Plan 02-07 — ActivityTimeline date formatting (UUID leaking into timestamp slot)"
---

# Plan 02-03c — Gap Closure Summary

## Goal

Close Plan 02-03b's drill verdict (NOT APPROVED, 2026-05-14) which traced the failure to `useHostContext().companyId` returning null for detail-tab slots. Build a resolver hook that handles the null-context window gracefully, retrofit ReaderView + LiveBlockerPanel, and re-rehearse against Countermoves COU-1.

## Outcome

**APPROVED** with 3 polish items deferred to Plans 02-05/06/07. The blocking 02-03b defects are CLOSED; Reader tab renders populated data on COU-1; the worker fail-loud terminal text from the prior drill is gone. Plans 02-03 + 02-03b + 02-03c all close together on this verdict.

## Most important finding (mid-drill discovery)

The 02-03b root-cause diagnosis was **partially correct but secondary**. The PRIMARY failure was that `ReaderView`'s prop signature was `{ entityId }: { entityId: string }` — but the host invokes slot components with `{ slot, context }` per `PluginSlotComponentProps`. So `entityId` at the top level was ALWAYS undefined; `issue.reader`'s `if (!issueId) return emptyResult()` silently returned empty for every render. The fail-loud surfaced via `flatten-blocker-chain`'s stricter `if (!startId || !companyId) graceful()` guard — exactly the symptom the prior drill correctly captured but mis-attributed.

The companyId-null condition IS real (Plan 02-03c Task 1 captured the empirical contract from host source) — but it's secondary. Both fixes shipped (Task 2 = resolver hook for companyId; Task 2.5 mid-drill = PluginDetailTabProps shape for entityId).

## How we got here (commit timeline)

```
1d424b2 — Task 1: 02-03c-HOST-CONTEXT.md (empirical reference, 7 H2 sections)
76f6538 — Task 2.1: companies.resolve-prefix worker handler (8 tests)
516477f — Task 2.2: useResolvedCompanyId hook + URL-parse helper (19 tests)
23b34a8 — Task 2.3: ReaderView retrofit (7 tests)
8cdf1f1 — Task 2.4: LiveBlockerPanel retrofit (7 tests)
                    [drill attempt #1 — caught prop-shape bug]
cf3084f — Task 2.5+2.6: PluginDetailTabProps shape + handler graceful-empty
                    [drill attempt #2 — APPROVED]
```

Test suite: 84 → 125 (+41 net new tests). tsc clean across all 6 commits.

## Three deferred items (each gets a numbered plan)

1. **Plan 02-05 — React key warnings**: 4 console warnings on ClaritySurfaceRoot, Breadcrumb, AnchoredToCards, ActivityTimeline. Hypothesis lives in `02-03c-REACT-KEYS.md`. Not blocking — cosmetic console noise, invisible to operator.
2. **Plan 02-06 — LiveBlockerPanel UX**: panel renders "EXTERNAL" verbatim even for graceful "No active blockers" terminal. UI must differentiate fail-loud vs graceful-empty.
3. **Plan 02-07 — ActivityTimeline date formatting**: comment UUID leaks into the formatted-timestamp slot. Pre-existing bug, surfaced now that real data flows.

## Operator gotchas codified

- **Manual `pnpm paperclipai ...` MUST be run from `~/paperclip`** — install-helper.sh handles this for install (commit 27c1ef8 from 02-03b); but manual `uninstall` / `list` / `--version` also subject. Will file MemPalace runbook drawer.
- **Safety CLI `verify` requires `--company-id`** — undocumented in --help. Snapshot bytes are sha256-verified at capture time, so `verify` is optional for routine bookend pairs; only needed when actually rehearsing a rollback.

## Files of record

- **Plan**: `02-03c-PLAN.md`
- **Reference doc**: `02-03c-HOST-CONTEXT.md` (durable; consumed by Phases 3-5)
- **Deferred-doc**: `02-03c-REACT-KEYS.md` (drives Plan 02-05)
- **Drill log row**: `runbook/REHEARSAL.md` Phase 2 Reader-tab visual rehearsals — entry dated `2026-05-14T09:08+`
- **Probe scripts**: `scripts/diag/02-03c-*.sh` (re-usable for Phase 3 PluginPage.tsx grep + Plan 02-04 PluginSettings.tsx grep)

## What this unblocks

Plan 02-04 (Situation Room + opt-in gate + coexistence CI) — was gated on Reader green. Now ready to plan + execute.
