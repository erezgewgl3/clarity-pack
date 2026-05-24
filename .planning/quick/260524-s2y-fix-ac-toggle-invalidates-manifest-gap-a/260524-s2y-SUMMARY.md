---
quick_id: 260524-s2y
type: execute
status: complete
completed: 2026-05-24
wave: 1
depends_on: []
files_modified:
  - src/ui/surfaces/reader/index.tsx
  - src/ui/surfaces/reader/ac-checklist.tsx
  - package.json
  - src/manifest.ts
  - test/manifest/chat-capabilities.test.mjs
files_added:
  - test/ui/ac-checklist-refresh-on-toggle.test.mjs
commits:
  - e35cbe6: feat(260524-s2y) wire usePluginData.refresh from ReaderViewReady to AcChecklist via onMutated
  - 82fc847: test(260524-s2y) pin AC toggle -> Reader refresh contract (6 source-grep assertions)
  - bd50484: chore(260524-s2y) version 1.0.0-rc.5 -> 1.0.0-rc.6
tarball:
  filename: clarity-pack-1.0.0-rc.6.tgz
  size_bytes: 146217
  sha256: 063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830
  files_in_pack: 14
suite:
  before: 1380
  after: 1386
  delta: +6
  pass: 1384
  fail: 0
  skip: 2
quality_gates:
  build: PASS
  typecheck: PASS
  suite: PASS
  check_css_scope: PASS (108 selectors, all scoped)
  check_a11y: PASS (65 files, 0 violations)
  npm_pack: PASS
tags: [reader, ac-checklist, sdk-2026.512.0, rc.6, ui-tier-refresh, sdk-gap]
---

# Quick Fix 260524-s2y Summary — AC Manual Toggle → Reader Refetch

## One-liner

**rc.5 → rc.6 — manual AC toggle now refreshes Reader data (UI-tier fix; SDK has no manifest-side invalidates).**

---

## MANIFEST UNCHANGED — SDK GAP DOCUMENTED

The operator's literal request was *"add an `invalidates` declaration to the ac-toggle action in `src/manifest.ts`."* That request **cannot be implemented as written** — the SDK does not expose the surface it presumes:

- `@paperclipai/plugin-sdk@2026.512.0` → `dist/types.d.ts` → `PaperclipPluginManifestV1` has **NO `actions:` field**. Fields are: `id`, `apiVersion`, `version`, `displayName`, `description`, `author`, `categories`, `capabilities`, `entrypoints`, `database`, `ui`, `instanceConfigSchema`, `jobs`, `agents`, `tools`.
- `PluginActionsClient` exposes `register(key, handler)` — **runtime-only** registration via the worker `ctx.actions.register`. No declarative manifest counterpart.
- A grep across the SDK directory for the substring `invalidat` returns **ZERO matches**. There is no invalidation concept anywhere in the SDK type tree.

**Adding a phantom `actions[].invalidates` field would:** (a) fail `tsc` against `PaperclipPluginManifestV1`, (b) be ignored at runtime even if `as any`-cast, (c) not cause `issue.reader` to refetch.

**The SDK does expose the right primitive:** `PluginDataResult<T>.refresh: () => Promise<void>`, returned from every `usePluginData(...)` call (`dist/ui/types.d.ts` lines ~308-329). This is the UI-tier path to a post-mutation refetch. rc.6 ships exactly that wiring.

The rationale is captured in three places so future readers see it on the diff:
1. Header comment block in `src/ui/surfaces/reader/ac-checklist.tsx`.
2. Inline comment above the `usePluginData` calls in `src/ui/surfaces/reader/index.tsx`.
3. Manifest header comment block for the `1.0.0-rc.6` version stripe in `src/manifest.ts`.

Test F in `test/ui/ac-checklist-refresh-on-toggle.test.mjs` greps both source files' raw source for the rationale regex `/no manifest-?side[\s\S]{0,400}invalidat/i` so the comment cannot silently disappear in a future refactor.

---

## What Changed

### Behavior

- When a manual AC checkbox toggle resolves with `{ok: true}` from the worker, `AcChecklist` now calls its `onMutated` prop exactly once.
- The Reader's `ReaderViewReady` passes an `onMutated` callback that fires **both** `usePluginData('issue.reader').refresh()` AND `usePluginData('reader.ac.autostatus').refresh()`. Both are refreshed because the auto-status caption (DIST-03, shipped in rc.5) derives from the same row state — refreshing only `issue.reader` would leave the auto-status caption stale.
- When the toggle resolves with `{ok: false, error: 'invalid_id'}`, `onMutated` is **NOT** called. The runtime gate is `(res as { ok?: boolean })?.ok === true` inside the `.then(...)` continuation.
- Backward compatibility: the `onMutated` prop is optional. Existing call sites (loading branch, prior cached payloads, the test harness) that don't pass it continue to compile + render unchanged — the toggle still calls the worker; just no refetch.
- NO_UUID_LEAK regression-pin from Plan 05-03 preserved — no change to the auto-status caption JSX.

### Files

| File | Change |
|------|--------|
| `src/ui/surfaces/reader/ac-checklist.tsx` | Added `onMutated?: () => void` prop; rewired `<input onChange>` to gate `onMutated?.()` on `(res as {ok?: boolean})?.ok === true` inside a `.then(...)` continuation; expanded header comment with the SDK-gap rationale. |
| `src/ui/surfaces/reader/index.tsx` | Added `refresh` to the `usePluginData('issue.reader', ...)` destructure; added `refresh: refreshAcAuto` to the `usePluginData('reader.ac.autostatus', ...)` destructure; added `onMutated={() => { void refresh(); void refreshAcAuto(); }}` to the `<AcChecklist .../>` JSX; added a 9-line comment block above the destructures naming the SDK gap. |
| `test/ui/ac-checklist-refresh-on-toggle.test.mjs` | **NEW** — 6 source-grep assertions (A: prop declaration / B: conditional invocation on `.ok === true` / C: no unconditional call / D: reader wiring destructures / E: onMutated passthrough / F: SDK gap rationale comment). |
| `package.json` | Version `1.0.0-rc.5` → `1.0.0-rc.6`. |
| `src/manifest.ts` | Version literal `'1.0.0-rc.5'` → `'1.0.0-rc.6'`; prepended `1.0.0-rc.6` header comment block above the `0.8.3` stripe naming the SDK gap. |
| `test/manifest/chat-capabilities.test.mjs` | Bumped the version-pin assertion from `1.0.0-rc.5` to `1.0.0-rc.6` (the only test in `test/manifest/` that pins the literal string). |

### What was deliberately NOT changed

- **`src/manifest.ts` capabilities / actions / agents / jobs / schema / database / instanceConfigSchema / ui.slots / apiVersion / id** — all untouched. The only manifest delta is the `version:` literal + the header comment block.
- **`src/worker/handlers/ac-checklist.ts`** — its discriminated `{ok:true} / {ok:false, error}` shape is the runtime contract the new UI wiring keys on. No shape change needed.
- **Schema / migration** — none. This is a pure UI-tier wiring change.

---

## Tarball

| Property | Value |
|----------|-------|
| Filename | `clarity-pack-1.0.0-rc.6.tgz` |
| Size | **146,217 bytes** (rc.5 was 145,380 — +837 bytes for the new test + comments) |
| sha256 | `063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830` |
| Files in pack | 14 |
| Location | repo root (`./clarity-pack-1.0.0-rc.6.tgz`) |

---

## Suite Delta

- **Before:** 1380 tests (Plan 05-03 baseline at rc.5).
- **After:** 1386 tests (+6 net from the new `ac-checklist-refresh-on-toggle.test.mjs` file).
- **1384 pass / 0 fail / 2 pre-existing skip.**
- Within the plan's predicted range (1383-1390 pass).
- The 2 skips are pre-existing and unrelated to this fix.

---

## Quality Gates (all 5 PASS)

| Gate | Result |
|------|--------|
| `pnpm build` (worker + UI + manifest) | PASS — `dist/worker.js` 248.6kB, `dist/ui/index.js` 294.9kB, `dist/manifest.js` rebuilt and reports `version: '1.0.0-rc.6'` |
| `pnpm typecheck` (`tsc --noEmit`) | PASS — clean |
| `node --test "test/**/*.test.mjs"` | PASS — 1386 tests / 1384 pass / 0 fail / 2 skip |
| `node scripts/check-css-scope.mjs` | PASS — 108 top-level selectors, all scoped under `[data-clarity-surface]` |
| `node scripts/check-a11y.mjs` | PASS — 65 files scanned, 0 violations |
| `npm pack` | PASS — `clarity-pack-1.0.0-rc.6.tgz` produced |

---

## Commits

| Hash | Task | Type | Message |
|------|------|------|---------|
| `e35cbe6` | Task 1 | `feat` | wire usePluginData.refresh from ReaderViewReady to AcChecklist via onMutated |
| `82fc847` | Task 2 | `test` | pin AC toggle -> Reader refresh contract (6 source-grep assertions) |
| `bd50484` | Task 3 | `chore` | version 1.0.0-rc.5 -> 1.0.0-rc.6 |

Task 4 was verification + artifact production only — no source changes, no commit needed. The tarball is gitignored.

---

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's `<sdk_gap_evidence>` block already did the SDK-shape analysis; the `<interfaces>` block named the exact lines to edit. All four tasks landed on the first attempt. All five quality gates returned exit 0 on the first run. The bonus version-pin update in `test/manifest/chat-capabilities.test.mjs` was anticipated by the plan's Task 3 action note (*"check `test/manifest/` for any version assertion"*).

---

## Operator Next Steps (deferred per plan)

- `npm publish` and live VPS install are **NOT** in scope for this quick fix. Plan explicitly: *"local artifact only; the operator drill (snapshot-bookended install) is deferred to Eric's post-quick-fix sweep, exactly like Plan 05-03's rc.5 drill was deferred."*
- The tarball sits at `./clarity-pack-1.0.0-rc.6.tgz` ready for SCP to the Countermoves VPS when Eric runs his next sweep. The snapshot-bookended upgrade pattern (uninstall → snapshot → `scripts/install-helper.sh /home/eric/clarity-pack-1.0.0-rc.6.tgz`) carries forward from rc.5.

---

## Self-Check: PASSED

Verified by direct filesystem + git inspection:

- `src/ui/surfaces/reader/ac-checklist.tsx` — modified (verified: contains `onMutated?: () => void` prop + `.then((res) =>` + `?.ok === true` + `onMutated?.()`).
- `src/ui/surfaces/reader/index.tsx` — modified (verified: contains `{ data, loading, refresh } = usePluginData` + `refresh: refreshAcAuto` + `onMutated={() => { void refresh(); void refreshAcAuto(); }}`).
- `test/ui/ac-checklist-refresh-on-toggle.test.mjs` — new file, 6 tests, all passing.
- `package.json` — version `1.0.0-rc.6`.
- `src/manifest.ts` — version literal `'1.0.0-rc.6'` + new header comment block.
- `test/manifest/chat-capabilities.test.mjs` — pin updated to `1.0.0-rc.6`.
- `dist/manifest.js` — verified `m.default.version === '1.0.0-rc.6'`.
- `clarity-pack-1.0.0-rc.6.tgz` — exists at repo root, 146,217 bytes, sha256 `063ee70808331142699c6d4ff2655ff4d192ecf5c1d000629ecdfc5504bde830`.
- Commits `e35cbe6`, `82fc847`, `bd50484` — all present in `git log`.
