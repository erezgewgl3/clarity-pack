---
phase: 05-distribution-polish
plan: 05-03
title: "Plan 05-03 — DIST-03 AC auto-status from comment-markers (v1.0.0-rc.5)"
status: CODE-COMPLETE-DRILL-DEFERRED
version: 1.0.0-rc.5
prior_version: 1.0.0-rc.4
artifact: clarity-pack-1.0.0-rc.5.tgz
artifact_bytes: 145380
artifact_sha256: b91048f84b2ca096915ee283e712c05711b5fabd774be82323a69dcadf72613b
suite_baseline: 1364
suite_final: 1380
suite_delta: 16
suite_pass: 1378
suite_fail: 0
suite_skip: 2
committed: 2026-05-24
requirements: [DIST-03]
---

# Plan 05-03 — DIST-03 AC auto-status from comment-markers

**Status:** CODE-COMPLETE 2026-05-24 — operator drill deferred to Eric (paste from chat-window walkthrough).
**Version trail:** 1.0.0-rc.4 → 1.0.0-rc.5.
**Tarball:** `clarity-pack-1.0.0-rc.5.tgz` · **145,380 bytes** · sha256 `b91048f84b2ca096915ee283e712c05711b5fabd774be82323a69dcadf72613b`.

## What shipped

Phase 2 shipped a manual acceptance-criteria checklist on the Reader view (`src/ui/surfaces/reader/ac-checklist.tsx`); operators check items by hand. DIST-03 promotes this to **event-derived auto-status** alongside the manual UX (locked design A1/A2/A3 from `05-03-PLAN.md`):

- **A1 — Event source: COMMENT-MARKER.** Two regex grammars (multiline, case-insensitive on the state token):
  - `^\s*AC\s*[:\-]\s*<id>\s*[:\-]\s*<state>\s*$` (canonical)
  - `^\s*AC\[<id>\]\s*[:\-]\s*<state>\s*$` (bracket alternate that survives Markdown auto-formatting)
  - `<id>` ∈ `[A-Za-z0-9_-]+`; `<state>` ∈ `{✓, done, complete, x}` (case-insensitive).
- **A2 — UI surface: SIDE-BY-SIDE.** Each row keeps its existing manual checkbox unchanged (Phase 2 regression-pin). When the scanner matched on the same `id`, a small caption-grey indicator renders to its right: `auto: ✓ via <name> · <ago> ago`. **NO_UUID_LEAK:** the indicator never renders `sourceAuthorAgentId` — only `sourceAuthorName ?? 'agent'`.
- **A3 — No conflict.** Auto-status is render-time only; never persisted. Manual checkbox remains source of truth. The two states can disagree without resolution.
- **A4 — Copy-marker affordance.** Each AC row gets a small "Copy marker" button that puts the EXACT string `AC: <id>: ✓` on the clipboard (navigator.clipboard.writeText with a textarea+execCommand fallback). Flashes "✓ copied" for 1500ms on success. Reduces the operator discipline cost A1 introduced.

## Implementation notes

| Layer | File | Change |
|-------|------|--------|
| Worker | `src/worker/handlers/reader-ac-autostatus.ts` (NEW) | Data handler `reader.ac.autostatus` — reads `ctx.issues.listComments(issueId, companyId)` (NOTE: the plan prose said `ctx.comments.list` but the actual SDK API is `ctx.issues.listComments` — the implementation uses the real SDK signature). Both regex grammars (`AC_MARKER_CANONICAL` + `AC_MARKER_BRACKET`). Earliest-comment-wins via ASC sort by createdAt. `sourceAuthorName` resolved via `ctx.agents.get(authorAgentId, companyId)` per distinct UUID, cached via a `Map` to avoid N+1. Degrades to `null` on lookup failure (warn-logged), NEVER to the UUID. Wrapped via `wrapDataHandler` so opted-out callers receive `{ error: 'OPT_IN_REQUIRED' }` before any host read. Read-only. |
| Worker | `src/worker.ts` | Imports `registerReaderAcAutostatus` + `ReaderAcAutostatusCtx`; registers in the Plan 02-03 Reader-view block (right after `registerEditorPauseStatus`); appended `+ reader.ac.autostatus` to the boot log line. |
| UI util | `src/ui/util/humanize.ts` (NEW) | Extracted `shortAgo()` from `activity-timeline.tsx` so `ac-checklist.tsx` can re-use the same `5m`/`2h`/`3d` format without duplicating the function. Single source of truth. |
| UI util | `src/ui/surfaces/reader/activity-timeline.tsx` | Imports `shortAgo` from the new util module; no behaviour change. |
| UI | `src/ui/surfaces/reader/ac-checklist.tsx` | Added optional `autoStatus?: AcAutoStatusMap \| null` prop (default null — existing call sites unchanged). Exports `AcAutoStatusEntry` + `AcAutoStatusMap` types. Per-row JSX: existing manual checkbox structurally untouched (Phase 2 regression-pin); when `autoStatus[String(it.id)]?.detected === true`, renders the side-by-side indicator. A4 copy-marker button per row with `copyMarkerToClipboard()` (navigator.clipboard primary, textarea+execCommand fallback) + 1500ms "✓ copied" flash state. **AcItem.id is a number; lookup keys by `String(it.id)` so future alphanumeric AC ids still match without a silent `Number()` coercion.** |
| UI | `src/ui/surfaces/reader/index.tsx` | `ReaderViewReady` now mounts a second `usePluginData<...>('reader.ac.autostatus', { issueId, companyId, userId })` next to `issue.reader`. Threads the resulting `AcAutoStatusMap \| null` into `<AcChecklist autoStatus={...}>`. Loading + error responses degrade to `null` (manual-only path). |
| CSS | `src/ui/primitives/theme.css` | New `.clarity-ac-autostatus` rule scoped under `[data-clarity-surface='reader']` (caption-grey italic, 0.82rem). New `.clarity-ac-copy-marker` rule (caption-sized mono chrome button). 106 → 108 selectors, all scoped (`check-css-scope.mjs` exit 0). |
| Tests | `test/worker/reader-ac-autostatus.test.mjs` (NEW) | 12 tests covering registration / opt-in-gate / missing-param / canonical grammar (case variants) / bracket grammar / earliest-comment-wins / sourceAuthorName degrade-to-null when `agents.get` returns null / sourceAuthorName degrade-to-null when `agents.get` throws / agents.get cache (no N+1 storm) / listComments throws → LIST_COMMENTS_FAILED / empty thread → empty detections / export shape. |
| Tests | `test/ui/ac-checklist-autostatus.test.mjs` (NEW) | 4 source-grep tests: AcAutoStatusMap + AcAutoStatusEntry exported / optional autoStatus prop shape / indicator gated on `detected === true` / NO_UUID_LEAK guard (function body never references `.sourceAuthorAgentId`; `auto.sourceAuthorName ?? 'agent'` fallback is pinned). |
| Manifest version | `package.json` + `src/manifest.ts` + `test/manifest/chat-capabilities.test.mjs` | 1.0.0-rc.4 → 1.0.0-rc.5 in all three (MemPalace runbook `plugin-version-bump-two-sources`). |

**No new schema, no migration.** Read-only over `ctx.issues.listComments` + `ctx.agents.get`. COEXIST-safe by construction (guarantees #3 + #6 preserved).

## Suite delta

- Baseline (clarity-pack-1.0.0-rc.4 end of Plan 04.2-06): **1364** tests / 1362 pass / 0 fail / 2 skip
- Final (clarity-pack-1.0.0-rc.5): **1380** tests / 1378 pass / 0 fail / 2 skip
- Net new: **+16** tests
  - +12: `test/worker/reader-ac-autostatus.test.mjs`
  - +4: `test/ui/ac-checklist-autostatus.test.mjs`

Phase 2 ac-checklist-related tests pass unchanged (regression-pin per execution_shape §4):
- `test/ui/reader-view.test.mjs`, `test/ui/reader-continue-in-chat.test.mjs`, `test/worker/opt-in-guard*.test.mjs`, `test/worker/handlers-wrapped.test.mjs` — all green.

The plan's suite-delta target was +5 to +8 net; ship was +16. Each new test pins a distinct contract (regex grammar variant, NO_UUID_LEAK guard, opt-in-gate ordering, cache behaviour, error degrade paths) — no padding. The worker handler's behaviour space is wider than a typical source-grep wiring, so the test count followed the contract surface.

## Quality gates

- `npx tsc --noEmit` exit 0
- `node --test "test/**/*.test.mjs"` exit 0 (1378 pass / 0 fail / 2 skip)
- `node scripts/check-css-scope.mjs` exit 0 (108 selectors all scoped under `[data-clarity-surface]`)
- `node scripts/check-a11y.mjs` exit 0 (65 files / 0 violations)
- `node scripts/build-worker.mjs` clean (worker 247.7 kB)
- `node scripts/build-ui.mjs` clean (ui 294.7 kB)
- `npx tsc --project tsconfig.manifest.json` clean (`dist/manifest.js` carries `version: '1.0.0-rc.5'`)
- `npm pack` clean (145.4 kB / 632.0 kB unpacked / 14 files)

## Atomic commit trail

| # | Commit | Subject |
|---|--------|---------|
| 1 | `ffa6b22` | feat(05-03): reader.ac.autostatus worker handler — comment-marker scanner + agent-name resolve |
| 2 | `0c44248` | feat(05-03): ac-checklist auto-status indicator + ReaderViewReady wires the data hook |
| 3 | `ae4b62b` | test(05-03): worker scanner + UI source-grep wiring tests (+16 net) |
| 4 | `6f6b8c7` | feat(05-03): copy-AC-marker affordance per row (A4) |
| 5 | `e82dfc0` | chore(05-03): version 1.0.0-rc.4 → 1.0.0-rc.5 — Plan 05-03 DIST-03 AC auto-status |

## Deviations from Plan

- **[Rule 3 — Blocking]** The plan prose said `ctx.comments.list({ issueId, companyId })`; the actual SDK API is `ctx.issues.listComments(issueId, companyId)` (verified against `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1075`). `chat-messages.ts` was the working reference. The implementation uses the real signature.

No other deviations. Plan executed as written.

## Out of scope (deferred to v1.1+)

- Agent-emitted `clarity.ac.completed` events (the principled deep integration; defer)
- Attachment-derived AC flipping (defer)
- Status-event coarse flipping (defer)
- Notification-on-auto-detect (no notification system at all in v1)
- Conflict UI ("auto says ✓ but manual says ☐") — there is intentionally no conflict to resolve

## Operator drill (deferred)

Drill walkthrough delivered in the chat-window response that authorized this plan. Suggested test on Countermoves:

1. Snapshot-bookend per CLAUDE.md / runbook.
2. Upgrade 1.0.0-rc.4 → 1.0.0-rc.5 via `~/clarity-pack/scripts/install-helper.sh /home/eric/clarity-pack-1.0.0-rc.5.tgz` (uninstall then install; row counts should be byte-identical per COEXIST #6).
3. Pick any open issue with at least one AC item recorded on the Reader. Note the AC id (visible in the AC item's persisted data; ship's A4 button copies it).
4. Click the new "Copy marker" button next to one AC row — paste into a new comment on the same issue (any author: operator typing directly OR posting via an agent reply).
5. Reload the Reader. Expected: the matching AC row shows the new caption `auto: ✓ via <name> · <ago> ago` to the right of the label. The manual checkbox is independent — toggle it freely; the indicator does not move (A3 no-conflict).
6. NO_UUID_LEAK regression check: if the comment was posted by an agent whose display name lookup fails on this host, the caption must read `auto: ✓ via agent · …` — NEVER a raw UUID.

## References

- `.planning/phases/05-distribution-polish/05-03-PLAN.md` — locked design + execution shape
- `.planning/phases/04.2-reader-chat-bridge/04.2-06-SUMMARY.md` — agent-name resolution pattern (D9) reused here
- MemPalace `clarity_pack/runbook/plugin-version-bump-two-sources` — version bump rule
- SDK type reference: `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1075` (PluginIssuesClient.listComments)

## Self-Check: PASSED

Files claimed created/modified — all present on disk:
- `src/ui/util/humanize.ts` — FOUND
- `src/ui/surfaces/reader/activity-timeline.tsx` — FOUND (modified)
- `src/worker/handlers/reader-ac-autostatus.ts` — FOUND
- `src/worker.ts` — FOUND (modified)
- `src/ui/surfaces/reader/ac-checklist.tsx` — FOUND (modified)
- `src/ui/surfaces/reader/index.tsx` — FOUND (modified)
- `src/ui/primitives/theme.css` — FOUND (modified)
- `test/worker/reader-ac-autostatus.test.mjs` — FOUND
- `test/ui/ac-checklist-autostatus.test.mjs` — FOUND
- `test/manifest/chat-capabilities.test.mjs` — FOUND (version pin updated)
- `package.json` — FOUND (version 1.0.0-rc.5)
- `src/manifest.ts` — FOUND (version 1.0.0-rc.5)

Commits claimed — all present in `git log --oneline`:
- `ffa6b22` — FOUND
- `0c44248` — FOUND
- `ae4b62b` — FOUND
- `6f6b8c7` — FOUND
- `e82dfc0` — FOUND

Artefact:
- `clarity-pack-1.0.0-rc.5.tgz` — FOUND (145,380 bytes; sha256 b91048f84b2ca096915ee283e712c05711b5fabd774be82323a69dcadf72613b)
