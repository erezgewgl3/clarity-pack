# 02-03c-HOST-CONTEXT — Empirical `useHostContext()` Behavior Per Slot Type

**Date:** 2026-05-14
**Paperclip version:** `ui/package.json` and `server/package.json` both `0.3.1` on Countermoves at `~/paperclip` (cloned 2026-05-08 14:44, last pulled 2026-05-13 21:12 per dir mtime). SDK installed in plugin: `@paperclipai/plugin-sdk@2026.512.0`.
**SDK source-of-truth (LOCAL):** `node_modules/@paperclipai/plugin-sdk/dist/ui/{hooks.d.ts,types.d.ts}` — byte-identical to Countermoves per pinned npm version.
**Host source-of-truth (SSH probes):** `/home/eric/paperclip/ui/src/plugins/slots.tsx` + `/home/eric/paperclip/ui/src/pages/IssueDetail.tsx` — captured via `scripts/diag/02-03c-host-context-probe-2.sh`, output at `scripts/diag/02-03c-host-context-output-2.utf8.txt`.

This document supersedes assumption-based reasoning about `useHostContext()` with evidence from the host's actual source code. It is a durable reference for every future Clarity Pack surface (Phases 3-5).

---

## How `useHostContext()` is fed (the universal pipeline)

Every slot type goes through the same two-step process inside the host:

1. **Slot mounting site builds a `PluginSlotContext`** — a partial shape with whichever fields it has on hand. Different mount sites pass different subsets. Source: `slots.tsx` `PluginSlotContext` type definition.

2. **`slotContextToHostContext()` in `slots.tsx` maps it to `PluginHostContext`** — the value that `useHostContext()` returns to plugin code. Exact mapping (verbatim from `~/paperclip/ui/src/plugins/slots.tsx`):

   ```ts
   function slotContextToHostContext(
     pluginSlotContext: PluginSlotContext,
     userId: string | null,
   ): PluginHostContext {
     return {
       companyId: pluginSlotContext.companyId ?? null,
       companyPrefix: pluginSlotContext.companyPrefix ?? null,
       projectId: pluginSlotContext.projectId
                  ?? (pluginSlotContext.entityType === "project"
                       ? pluginSlotContext.entityId ?? null
                       : null),
       entityId: pluginSlotContext.entityId ?? null,
       entityType: pluginSlotContext.entityType ?? null,
       parentEntityId: pluginSlotContext.parentEntityId ?? null,
       userId,                          // <-- always set from auth session, NOT from slot context
       renderEnvironment: null,         // <-- always null for slots (only set for launchers)
     };
   }
   ```

   Then `PluginBridgeScope` wraps the slot's React subtree with `<PluginBridgeContext.Provider value={{pluginId, hostContext}}>`, and `useHostContext()` reads from that context.

**Universal rules independent of slot type:**
- `userId` is read from the host's auth session (`authApi.getSession()`), NOT from the slot context. It's **always non-null** when a logged-in user sees the plugin UI.
- `renderEnvironment` is **always null for slot renders**. It's only populated for launcher renders (modals, drawers, popovers) — see `launchers.tsx` `buildLauncherHostContext()`.
- All other fields default to `null` if the mounting site doesn't pass them.
- The only fallback logic is `projectId`: if the mount site doesn't pass `projectId` AND `entityType === "project"`, the host derives `projectId` from `entityId`.

**The mounting site is the source of truth for what `useHostContext()` returns.** The rest of this document analyzes each slot type's mounting site.

---

## Section 1 — `detailTab` slot (Reader View, LiveBlockerPanel)

**Mounting site (PRIMARY for v1):** `/home/eric/paperclip/ui/src/pages/IssueDetail.tsx`
**SDK type contract:** `PluginDetailTabProps.context: PluginHostContext & { entityId: string; entityType: string }` (types.d.ts:197-203). The SDK STATICALLY GUARANTEES `entityId` + `entityType` are non-null; everything else stays `string | null`.

### What IssueDetail.tsx passes into the slot context

Three `<PluginSlotMount context={{...}}>` blocks rendered in IssueDetail.tsx (grep output, lines 3513-3541, 3874-3875):

```tsx
<PluginSlotMount
  context={{
    companyId: issue.companyId,
    entityId: issue.id,
    entityType: "issue",
  }}
  slot={...}
/>
```

**Key observation:** `companyPrefix` is **NEVER passed** in any IssueDetail.tsx `PluginSlotMount` context block. Confirmed by zero occurrences of `companyPrefix` in `grep -nE 'PluginHostContext|companyPrefix|detailTab|companyId|<HostContext|context=|hostContext=|buildContext|HostContext\.Provider' IssueDetail.tsx` (probe-2 Section G).

### Empirical field shape for `detailTab` slot

| Field | Value at render time | Why |
|---|---|---|
| `companyId` | `issue.companyId` once the issue query resolves; **`null`** while the issue query is in flight | `<PluginSlotMount context={{companyId: issue.companyId}}>` — if `issue` is `undefined` (loading), `issue.companyId` is `undefined`, mapped to `null` by `slotContextToHostContext`'s `?? null`. |
| `companyPrefix` | **ALWAYS `null`** | IssueDetail.tsx does not pass it. Host's mapping defaults to `null`. |
| `projectId` | **ALWAYS `null`** | IssueDetail.tsx does not pass it. (`issue.projectId` would resolve it, but the mounting site doesn't read or pass it.) |
| `entityId` | issue UUID — non-null (SDK-typed `entityId: string` for detailTab) | `entityId: issue.id` passed by IssueDetail.tsx. |
| `entityType` | `"issue"` — non-null (SDK-typed for detailTab) | Hardcoded by IssueDetail.tsx. |
| `parentEntityId` | `null` for issue detail tabs (only used by `commentAnnotation` slot type) | Not passed. |
| `userId` | Non-null UUID when authenticated | Read from `authApi.getSession()` inside `PluginBridgeScope`, NOT from slot context. |
| `renderEnvironment` | **ALWAYS `null` for slot renders** | Hardcoded in `slotContextToHostContext`. |

### Conclusion — what the Reader View can trust

- **Trust `entityId` and `entityType` immediately** — SDK-typed non-null. Reader View can call `usePluginData('issue.reader', {issueId: entityId})` safely.
- **DO NOT trust `companyId`** — must handle the null window between mount and `issue` query resolution. This is the 02-03b drill defect. Resolver needed.
- **DO NOT use `companyPrefix` as fallback** — it's always null in this slot's context.
- **DO NOT use `projectId`** — always null in this slot's context.
- **`userId` is reliable** — fine for AcChecklist toggle action.
- **Fallback must be URL-parsing** — `useHostLocation().pathname` always starts with `/<companyPrefix>/` because App.tsx's route tree wraps every authenticated page under `<Route path=":companyPrefix" element={<Layout />}>` (App.tsx:1845, full route tree probe-2 Section H).

### Implication for Plan 02-03c Task 2 resolver design

The `useResolvedCompanyId()` hook for detail-tab consumers must:

1. **Prefer `useHostContext().companyId` when non-null.** Once `issue` loads in IssueDetail.tsx, the slot re-renders with the populated context and the resolver short-circuits.
2. **Detect null companyId during the loading window** — render an explicit "Resolving company context…" placeholder, NOT pass empty string to the worker (the 02-03b bug).
3. **Fallback to URL parsing.** `useHostLocation().pathname.split('/').filter(Boolean)[0]` is the active company prefix.
4. **Resolve prefix to UUID via worker handler.** New `companies.resolve-prefix` handler uses `ctx.companies.list()` + filter (`companies.read` capability already declared per `src/manifest.ts:58`).
5. **Cache the resolution per-mount.** Once resolved during the null window, hold the value until unmount — even after `useHostContext().companyId` becomes non-null, returning the cached prefix-resolved UUID is consistent.

---

## Section 2 — `page` slot (Situation Room, Bulletin, Chat)

**Mounting site:** `/home/eric/paperclip/ui/src/pages/PluginPage.tsx`
**Route shape:** `/:companyPrefix/plugins/:pluginId` (PluginPage.tsx file-header comment line 19, confirmed in probe-1 Section 5).
**SDK type contract:** `PluginPageProps.context: PluginHostContext` (types.d.ts:174-177). NO static non-null guarantees; everything is `string | null`.

### Inferred field shape (verification pending until Phase 3 builds Situation Room)

| Field | Expected value | Confidence |
|---|---|---|
| `companyId` | Likely **populated** when issue/project queries upstream have resolved (parent Layout wraps the page in company-scoped data fetches) | MEDIUM — not yet directly grepped from PluginPage.tsx |
| `companyPrefix` | Likely **populated** from `useParams().companyPrefix` — the route literally captures it | HIGH — route shape proves the prefix is available; whether PluginPage.tsx passes it through is the open question |
| `projectId` | **`null`** unless on a project-scoped sub-route — Clarity Pack's page surfaces are company-scoped, not project-scoped | HIGH |
| `entityId` | **`null`** for page slots (not entity-scoped, per `slots.tsx` `requiresEntityType()` definition: detailTab/taskDetailView/contextMenuItem/etc. only) | HIGH — slots.tsx source verifies page slots are NOT entity-scoped |
| `entityType` | **`null`** for page slots | HIGH — same source |
| `parentEntityId` | **`null`** for page slots | HIGH |
| `userId` | Non-null when authenticated | HIGH (same auth-session pipeline as detailTab) |
| `renderEnvironment` | **`null`** for slot renders | HIGH (hardcoded in `slotContextToHostContext`) |

### Implication for future Situation Room / Bulletin / Chat surfaces

- **Same resolver hook applies.** `useResolvedCompanyId()` will fall back to URL parsing the same way — `useHostLocation().pathname` starts with `/<companyPrefix>/plugins/<pluginId>` for page slots, so the URL parse extracts the prefix identically.
- **Verify when Phase 3 starts:** before Situation Room ships, add `grep -nE 'companyPrefix|companyId|<PluginSlotMount|context=\{' /home/eric/paperclip/ui/src/pages/PluginPage.tsx` to confirm exact slot context construction. If `companyPrefix` IS passed by PluginPage.tsx, that becomes the preferred fallback (faster than URL parsing).

---

## Section 3 — `settingsPage` slot (per-user opt-in toggle)

**Mounting site:** `/home/eric/paperclip/ui/src/pages/PluginSettings.tsx`
**SDK type contract:** `PluginSettingsPageProps.context: PluginHostContext` (types.d.ts:303-306). No static non-null guarantees.

### Inferred field shape (verification pending until Plan 02-04 builds opt-in toggle)

| Field | Expected value | Confidence |
|---|---|---|
| `companyId` | Likely **populated** if settings pages are company-scoped, **null** if they're user-scoped | LOW — settings pages may be either; needs grep on PluginSettings.tsx mount site |
| `companyPrefix` | Likely **populated** if company-scoped (route includes `:companyPrefix`), null if user-scoped | LOW |
| `projectId` | **`null`** | HIGH (not entity-scoped) |
| `entityId` | **`null`** | HIGH (not entity-scoped) |
| `entityType` | **`null`** | HIGH |
| `parentEntityId` | **`null`** | HIGH |
| `userId` | **Non-null** — this is the critical field for per-user opt-in (must identify which user is toggling) | HIGH (auth-session pipeline) |
| `renderEnvironment` | **`null`** for slot renders | HIGH |

### Implication for Plan 02-04 (opt-in gate)

- **`userId` is the load-bearing field** for the per-user opt-in toggle — it identifies which user's preference to upsert into the `clarity_user_prefs` table.
- **`companyId` may be null** if settings pages are user-scoped. Plan 02-04 must verify: before writing the opt-in toggle, grep PluginSettings.tsx for its `<PluginSlotMount context={...}>` block and document the actual shape in this file as a "Section 3 — UPDATE" addendum.
- **Resolver hook is NOT applicable** for `clarity_user_prefs` — that table is keyed on `userId` alone (not `companyId`), so a null companyId in settingsPage is acceptable.

---

## Universal pitfall — the `WORKER_UNAVAILABLE` vs null-context confusion

When a plugin handler throws because companyId is empty (the 02-03b fail-loud guard), the bridge returns a `PluginBridgeError` with code `WORKER_ERROR` (handler-thrown), NOT `WORKER_UNAVAILABLE` (plugin not running). The 02-03b drill's `LiveBlockerPanel` rendered the literal terminal text `EXTERNAL / startId and companyId required` because the panel's error-rendering branch composed the error message verbatim from a fail-loud guard.

**Fix from Plan 02-03c Task 2:** UI never sends empty-string companyId. The fail-loud guards in the worker handlers remain (defense in depth), but the UI's resolver hook ensures the guard is never tripped through normal use.

---

## Source-file citations (Countermoves @ 2026-05-14)

| File | Purpose | Probe |
|---|---|---|
| `~/paperclip/ui/src/plugins/slots.tsx` (full file, ~900 LOC) | Slot mounting infrastructure; defines `PluginSlotContext`, `slotContextToHostContext`, `PluginBridgeScope` | probe-2 Section E |
| `~/paperclip/ui/src/plugins/launchers.tsx` (full file, ~830 LOC) | Launcher counterpart; `buildLauncherHostContext` mirrors the slot mapping for launchers | probe-2 Section F |
| `~/paperclip/ui/src/pages/IssueDetail.tsx` (filtered grep) | detailTab mount site — passes `{companyId: issue.companyId, entityId: issue.id, entityType: "issue"}` | probe-2 Section G |
| `~/paperclip/ui/src/App.tsx:1845` | Top-level route: `<Route path=":companyPrefix" element={<Layout />}>` — proves companyPrefix is always in URL for authenticated pages | probe-2 Section H |
| `~/paperclip/ui/src/pages/PluginPage.tsx:19` | Comment confirms `/:companyPrefix/plugins/:pluginId` for page slots | probe-1 Section 5 |
| `~/paperclip/ui/src/pages/PluginSettings.tsx` | Mount site for settingsPage slot — exact context shape NOT YET grepped | probe-1 Section 3 |
| `~/paperclip/ui/src/pages/ProjectDetail.tsx`, `AgentDetail.tsx`, `ProjectWorkspaceDetail.tsx` | Sibling detail-tab mount sites (would receive the same Reader pattern if Clarity Pack expanded entityTypes) | probe-1 Section 3 |
| `~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/ui/{hooks,types}.d.ts` | SDK type surface — byte-identical to local `node_modules` per pinned version | local read |

## Open verifications (deferred to future phases)

- **Phase 3 (Situation Room):** Before locking the Situation Room data flow, grep PluginPage.tsx for its `<PluginSlotMount context={...}>` block. Update Section 2 with the actual fields passed.
- **Plan 02-04 (opt-in gate):** Before writing the opt-in toggle, grep PluginSettings.tsx for its mount block. Update Section 3 with the actual fields passed.
- **Phase 4 (Chat):** Grep IssueDetail.tsx's `commentAnnotation` mount site — `parentEntityId` becomes load-bearing there. Add a Section 4 if a Chat surface uses `commentAnnotation` slots.
