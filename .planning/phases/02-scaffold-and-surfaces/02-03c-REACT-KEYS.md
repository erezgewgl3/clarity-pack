# 02-03c-REACT-KEYS — React Key Warnings Investigation (DEFERRED)

**Date:** 2026-05-14
**Status:** **DEFERRED to follow-on plan 02-05** per drill verdict (`approved — reader green WITH 3 polish items deferred`).
**Observed in drill 2026-05-14T08-58-29Z post-Task-2.5/2.6:** 4 warnings — same shape as 02-03b drill plus 2 new ones now visible because populated data exposes the affected components' render paths.

---

## What was observed

Browser console on Countermoves COU-1 Reader tab, plugin v0.2.0 (commit `cf3084f`):

```
[Each child in a list should have a unique "key" prop.]
Check the render method of `ClaritySurfaceRoot`. It was passed a child from
ReaderViewWithCompany. See https://react.dev/link/warning-keys for more information.

[Each child in a list should have a unique "key" prop.]
Check the render method of `Breadcrumb`.
See https://react.dev/link/warning-keys for more information.

[Each child in a list should have a unique "key" prop.]
Check the render method of `AnchoredToCards`.
See https://react.dev/link/warning-keys for more information.

[Each child in a list should have a unique "key" prop.]
Check the render method of `ActivityTimeline`.
See https://react.dev/link/warning-keys for more information.
```

Four affected components. The 02-03b drill saw 2 (`ClaritySurfaceRoot` + `AnchoredToCards`); this drill reveals two more (`Breadcrumb` + `ActivityTimeline`) — they were previously invisible because issue.reader returned `emptyResult()` so those components received `null`/`[]` and didn't render any list children.

## Why the source-grep tests pass

`test/ui/reader-view.test.mjs` and the `ref-card.test.mjs` (built bundle) inspection both confirm:
- `AnchoredToCards.tsx` line ~38: `<RefCard key={c.id} card={c} />` — explicit key
- `prose-with-ref-chips.tsx`: explicit fragment keys
- `breadcrumb.tsx`: explicit key on hop list
- `activity-timeline.tsx`: explicit key on event list

The bundled `dist/ui/index.js` retains these keys at every `.map()` site — verified by grep on the bundle output.

So the warnings are NOT from missing keys at our `.map()` sites. The host's plugin-loader pipeline is the candidate root cause.

## Hypothesized root cause (not yet verified)

The host's `slots.tsx` `PluginSlotMount` wraps our exported component in two layers:

```tsx
<PluginSlotErrorBoundary slot={slot} className={className}>
  <PluginBridgeScope pluginId={slot.pluginId} context={context}>
    {className ? <div className={className}>{node}</div> : node}
  </PluginBridgeScope>
</PluginSlotErrorBoundary>
```

The `node` is `createElement(component.component, { slot, context })` — our `ReaderView`. React tracks keys through component boundaries, so this nesting alone shouldn't strip keys. **But** the `loadPluginModule` path uses `applyJsxRuntimeKey` and a custom JSX runtime shim (`getShimBlobUrl("react/jsx-runtime")`) injected into the dynamically-imported plugin bundle. That shim's `jsx` and `jsxs` functions are:

```js
const withKey = (props, key) => key === undefined ? (props ?? {}) : { ...(props ?? {}), key };
export const jsx = (type, props, key) => R.createElement(type, withKey(props, key));
export const jsxs = (type, props, key) => R.createElement(type, withKey(props, key));
```

The host's `applyJsxRuntimeKey` only forwards `key` when it's defined. esbuild's automatic JSX runtime emits `jsxs(Component, {children: [...]}, key?)` for static-array children — when no explicit `key` is passed, the runtime SHOULD let React derive keys from the array elements' own `key` props.

**But:** if our build emits `jsx` (not `jsxs`) for arrays generated via `.map()`, AND the host's shim's `withKey` re-creates the props object via spread (`{ ...props }`), it's plausible that the array's per-element `key` props get stripped during the spread or get re-assigned by React's normalization.

This is a HYPOTHESIS, not a verified diagnosis. To verify:
1. Read the actual `dist/ui/index.js` bundle and confirm whether `.map()` arrays are emitted as `jsxs(_Component, {children: [...]})` (correct) or as `jsx(_Component, {children: [...]})` (wrong — `jsx` is for single children, `jsxs` for arrays).
2. If `jsx` instead of `jsxs`, the esbuild config needs `jsx: 'automatic'` AND `jsxImportSource` set to a path that emits `jsxs`. Check `scripts/build-ui.mjs`.
3. If both runtimes are correct, the issue is in the host's shim — not fixable from plugin side. File upstream issue against `paperclipai/paperclip` and document the workaround (manually `React.Fragment`-wrap arrays with stable keys).

## Proposed follow-on plan 02-05 (drafted)

Title: **Plan 02-05 — React key warnings cleanup (post-02-03c drill follow-on)**

Tasks:
1. **Diagnose** — verify hypothesis above by inspecting `dist/ui/index.js` bundle output for jsx-runtime emit shape; compare to `paperclipai/paperclip@master` `slots.tsx` `applyJsxRuntimeKey` semantics.
2. **Fix** — depending on diagnosis:
   - If our bundle: adjust esbuild jsx config + reload patterns
   - If host shim: file upstream issue + apply workaround (stable Fragment wrapping with unique keys at every `.map()` site)
3. **Verify** — re-run the rehearsal drill against COU-1; console should show zero key warnings.
4. **Test** — add a unit test that bundles a tiny component with `.map()` and asserts the bundle output uses `jsxs` for arrays.

Estimated effort: 1-2 hours diagnosis + 30 min fix + 15 min retest. Not blocking Plan 02-04 (Situation Room + opt-in gate + coexistence CI) — Plan 02-04 surfaces (page slots) don't have the same hot-path key warnings as detail-tab slots and Plan 02-04 verifications can proceed independently.

## Deferral rationale

The drill verdict (2026-05-14T09:08+) is `approved — reader green WITH 3 polish items deferred`. The deferral was Eric's call after assessing:
- Reader renders all visible mockup elements (ProseWithRefChips, Breadcrumb, AnchoredToCards, AcChecklist, ActivityTimeline, LiveBlockerPanel)
- No fail-loud worker terminal text
- No 502s on the bridge
- Console warnings are ESLint-style noise, not user-facing breakage

The 4 warnings are visible to anyone with DevTools open but invisible to the operator (Eric). Per Plan 02-03c success criteria #3 ("React key warnings are either gone OR formally classified as host-bug-out-of-scope"), this document classifies them as **needs-investigation** with the hypothesis above. Plan 02-05 closes the classification.

## Cross-references

- **Plan 02-03c-PLAN.md** Task 3 — original spec for this investigation
- **02-03c-HOST-CONTEXT.md** — Section "Universal pitfall" mentions the bridge's slot wrapping
- **runbook/REHEARSAL.md** Phase 2 Reader-tab visual rehearsals — drill row 2026-05-14T09:08+
- **`~/paperclip/ui/src/plugins/slots.tsx`** — `applyJsxRuntimeKey` source of truth for the host shim
