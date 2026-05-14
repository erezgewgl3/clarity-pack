# 02-03b-API-SHAPES — Empirical Paperclip SDK Shapes

**Date:** 2026-05-14
**Source of truth:** `@paperclipai/plugin-sdk@2026.512.0` — local `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` (byte-identical to the version installed on Countermoves, confirmed by package.json version + identical `dist/` file list).
**SSH to Countermoves:** blocked by fail2ban during Task 1; SDK types are pinned + reproducible so local read suffices for sections 1–7. Section 8 (plugin_logs for the 502 cause) is **DEFERRED** until SSH unblocks or operator pastes the log row.

## Summary — what Plan 02-03 got wrong

The Plan 02-03 handlers were written against **assumed** SDK shapes that diverge from the actual `2026.512.0` surface in **eight** ways:

| # | Assumed (Plan 02-03 handler) | Actual (SDK 2026.512.0) | Defect impact |
|---|---|---|---|
| 1 | `issue.body` | `issue.description` | issueBody returned null → ProseWithRefChips renders nothing |
| 2 | `ctx.issues.get(issueId)` | `ctx.issues.get(issueId, companyId)` | likely throws or returns null → cascades |
| 3 | `ctx.issues.ancestry(issueId)` | **does not exist** — must walk `parentId` and call `ctx.projects.get` | Breadcrumb renders nothing |
| 4 | `ctx.issue.documents.read(issueId, opts)` | `ctx.issues.documents.list(issueId, companyId)` + `.get(issueId, key, companyId)` | DeliverablePreview renders nothing |
| 5 | `ctx.activity.log.read({issueId, limit})` | **does not exist** — only `.log(entry)` (write) | ActivityTimeline empty |
| 6 | `ctx.host.currentCompanyId` | **does not exist on PluginContext** — companyId comes from `params` (UI passes via `useHostContext`) | every Paperclip core call missing/wrong companyId |
| 7 | `ctx.db.query(sql, params): Promise<{rows: T[]}>` (node-postgres shape) | `ctx.db.query<T>(sql, params): Promise<T[]>` (rows returned directly) | AC checklist empty; distilled activity empty |
| 8 | `flatten-blocker-chain` calls `/api/companies/{id}/issues/{id}/blockers` via `ctx.http.fetch` | The SDK exposes `ctx.issues.relations.get(issueId, companyId)` returning typed `{ blockedBy, blocks }`; the HTTP path likely 404s or routes to plugin-bridge which then throws → 502 | LiveBlockerPanel 502 |

Five of these (#1, #3, #4, #5, #6) are **silent** at the type level because the existing handler's local `Ctx` types declare these methods themselves (the handler files define their own narrow `IssueReaderCtx` / `FlattenBlockerChainCtx` shapes that lie about what the SDK provides). `tsc --noEmit` passed because the handler doesn't import the SDK's `PluginContext`. **Lesson is captured in Plan 02-03b Task 2: handlers must import the SDK's `PluginContext` directly and stop redeclaring narrow local Ctx types that drift from the real shape.**

---

## Section 1 — `ctx.issues.get`

**SDK signature** (`types.d.ts:1022`):
```ts
get(issueId: string, companyId: string): Promise<Issue | null>
```

**Issue body field:** `description` (string).
- Evidenced indirectly by `update`'s patch type at types.d.ts:1049 — `Pick<Issue, "title" | "description" | "status" | "priority" | "assigneeAgentId" | ...>` — and by `create`'s input shape at types.d.ts:1023-1048 which includes `description?: string`. `Issue` itself is re-exported from `@paperclipai/shared` which is a workspace-internal package not published to npm; we cannot read the bare interface, but the `Pick` enumeration in the public API confirms the field name.

**Plan 02-03 handler bug:** calls `ctx.issues.get(issueId)` with one positional arg, missing companyId. Likely throws at runtime; even if the host bridge is forgiving and returns null, `issue.body` was assumed — Issue uses `description`.

**Fix in 02-03b:**
- Read `companyId` from handler params (UI passes it via `useHostContext()`).
- `const issue = await ctx.issues.get(issueId, companyId);`
- Use `issue?.description` (NOT `issue.body`).

---

## Section 2 — `ctx.issues.ancestry`

**SDK signature:** **DOES NOT EXIST.** `PluginIssuesClient` at types.d.ts:1009-1103 exposes: `list / get / create / update / assertCheckoutOwner / getSubtree / requestWakeup / requestWakeups / listComments / createComment / createInteraction / suggestTasks / askUserQuestions / requestConfirmation / documents / relations / summaries`.

The only "tree" method is `getSubtree` (types.d.ts:1064) — and it goes **downward** (root → descendants), not upward.

**Plan 02-03 handler bug:** the handler at `issue-reader.ts:132-134` checks `ctx.issues.ancestry ? await ctx.issues.ancestry(issueId).catch(() => null) : null` — guards work at runtime (ancestry is undefined, the ternary returns null) so this returns null silently every time.

**Fix in 02-03b:**
- Derive ancestry by walking `issue.parentId` via repeated `ctx.issues.get(parentId, companyId)` until null. Cap at a reasonable depth (say 8) to bound the loop.
- Resolve `issue.projectId` via `ctx.projects.get(projectId, companyId)` for project name.
- Goal/milestone field — `Issue` has `goalId` (per `create()` input). Resolve via `ctx.goals.get(goalId, companyId)` if non-null.
- Returns `{ project: {id, title} | null, milestone: {id, title} | null, parent: {id, title} | null }`.
- The deepest issue with `parentId === null` is the project's root issue; the immediate parent is the one above us. Treat goal as a separate axis (issues can have both `parentId` AND `goalId`).
- Performance: this is up to 3 round-trips for typical issues (parent + project + goal). For drill purposes a 60ms total budget is fine. If perf matters later, add a single "ancestry" entity stored in plugin state cache.

**Capabilities required** (need to verify Reader manifest declares them; if not, add):
- `issues.read` (already declared per Plan 02-03 SUMMARY)
- `projects.read` (need to confirm)
- `goals.read` (need to confirm)

---

## Section 3 — `ctx.issues.documents` (singular `issue.documents` does not exist)

**SDK signature** (types.d.ts:798-851):
```ts
ctx.issues.documents.list(issueId, companyId): Promise<IssueDocumentSummary[]>
ctx.issues.documents.get(issueId, key, companyId): Promise<IssueDocument | null>
ctx.issues.documents.upsert({ issueId, key, body, companyId, title?, format?, changeSummary? }): Promise<IssueDocument>
ctx.issues.documents.delete(issueId, key, companyId): Promise<void>
```

**Plan 02-03 handler bug:** the handler calls `ctx.issue.documents.read(issueId, { latest: true })` — three things wrong: (a) `ctx.issue` is singular vs `ctx.issues` plural; (b) `.read` doesn't exist (methods are `list / get / upsert / delete`); (c) `{latest: true}` is not an accepted options shape; (d) the third arg is `companyId`, not options.

**IssueDocumentSummary fields** (per types.d.ts:800-806 docstring): "summary metadata (id, key, title, format, timestamps) without the full document body". Exact field names not visible without reading `@paperclipai/shared`, but the docstring enumerates: `id, key, title, format`, plus timestamp fields. Our `DeliverablePreview` UI assumes `{filename, last_write_at}` — those names don't match. Likely:
- `filename` → `title` or `key`
- `last_write_at` → `updatedAt` or `last_modified_at`

**Fix in 02-03b:**
- Replace `ctx.issue.documents.read` call with `ctx.issues.documents.list(issueId, companyId)`.
- Sort the returned summaries by timestamp DESC, take the head.
- Map to the shape `DeliverablePreview` expects: `{filename: summary.title ?? summary.key, last_write_at: summary.updatedAt ?? null}`. Adjust field names once the actual IssueDocumentSummary is observed at runtime (Task 3 drill).
- **Capabilities required:** `issue.documents.read` — add to manifest if not present.

---

## Section 4 — `ctx.activity.log.read`

**SDK signature:** **DOES NOT EXIST.** `PluginActivityClient` at types.d.ts:450-460 exposes only `.log(entry: PluginActivityLogEntry): Promise<void>` (write).

There is **no read API for activity entries** at SDK 2026.512.0.

**Plan 02-03 handler bug:** the handler calls `ctx.activity.log.read({issueId, limit: 50})`. At runtime `ctx.activity.log` is the write function — calling `.read` on a function returns undefined → throws on the awaited `.filter()` call. The handler catches with `.catch(() => [])` and silently returns empty.

**Fix options in 02-03b:**

**Option A (chosen):** Use `ctx.issues.listComments(issueId, companyId)` as the timeline source. Comments are the most user-visible activity. Map each `IssueComment` to a synthetic `{ kind: 'comment', actor, at, detail }` record. State-change and work-product events are not available — accept the gap for v1 with a Phase 3 follow-up to either re-spike when Paperclip ships an activity-read API or fold those events into our own `clarity_user_prefs` namespace via event subscriptions (`ctx.events.on('issue.updated', ...)`).

**Option B (deferred):** Subscribe to `issue.updated` / `issue.created` / `issue.comment.created` events in `setup()` and persist a denormalized per-issue activity feed in the plugin namespace. This is what Paperclip itself does internally; we'd duplicate it. Too much work for v1 of the Reader; revisit Phase 3 if v1 ships with only-comments and Eric flags the gap.

**Fix in 02-03b (Option A):**
- Replace `ctx.activity.log.read` call with `ctx.issues.listComments(issueId, companyId)`.
- Take the most recent ACTIVITY_LIMIT=8.
- Each comment becomes `{ kind: 'comment', actor: comment.authorAgentId ?? comment.authorUserId, at: comment.createdAt, detail: truncate(comment.body, 120) }`.
- `READER-09` requirement (drop label_change/title_edit) becomes vacuously true: no such events flow in this path.
- Document the gap in 02-03b-SUMMARY.md and ROADMAP follow-up.

---

## Section 5 — `ctx.host.currentCompanyId`

**SDK signature:** **DOES NOT EXIST.** `PluginContext` (types.d.ts:1292-1345) has no `host` field.

**UI side equivalent:** `useHostContext()` (`dist/ui/hooks.d.ts:80`) returns `PluginHostContext` (`dist/ui/types.d.ts:55`):
```ts
interface PluginHostContext {
  companyId: string | null;
  companyPrefix: string | null;
  projectId: string | null;
  entityId: string | null;
  entityType: string | null;
  parentEntityId?: string | null;
  userId: string | null;
  renderEnvironment?: PluginRenderEnvironmentContext | null;
}
```

**Plan 02-03 handler bug:** the handler reads `ctx.host?.currentCompanyId`. At runtime `ctx.host` is undefined, so it falls back to the optional-chain → `undefined`. The handler's downstream code at issue-reader.ts:114-116 has the guard `if (refs.length === 0 || !companyId) return []` — so refCards always returns empty. Silently. That alone explains why AnchoredToCards rendered empty.

**Fix in 02-03b:**
- UI must pass `companyId` (from `useHostContext()`) in the `usePluginData` params. Update `ReaderView` to read context: `const { companyId } = useHostContext(); usePluginData('issue.reader', { issueId, companyId });`.
- Same for `LiveBlockerPanel` (passes `issueId` only today).
- Handler reads `params.companyId` and uses it for every SDK call.
- Add a top-of-handler guard: `if (!companyId) throw new Error('companyId required')` — fail loud not silent.

---

## Section 6 — `ctx.db.query` return shape

**SDK signature** (types.d.ts:373):
```ts
query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
```
Returns `T[]` **directly** — NOT `{rows: T[]}` (the node-postgres / pg shape).

**Plan 02-03 handler bug:** all three handlers (`issue-reader.ts:136`, `editor-pause-status.ts:38`, `tldr-cache.ts` reads via `getTldrByScope`) access `.rows` on the result. At runtime `result.rows` is undefined → `undefined.filter()` throws OR `undefined.length === 0` is falsy in the ternary, silently returning empty. The handlers' local `Ctx` types redeclare `query(...): Promise<{rows: unknown[]}>`, which is why tsc didn't catch this.

**Fix in 02-03b:**
- `editor-pause-status.ts`: change `result.rows[0]` → `result[0]` (rows ARE the result).
- `issue-reader.ts`: change `acItemsResult.rows` → `acItemsResult` (the array IS the rows).
- Verify `src/worker/db/tldr-cache.ts` `getTldrByScope` and `upsertTldr` — they may have the same defect.
- Update all handler `Ctx` interfaces to import and use the real SDK shape, not lie locally.

---

## Section 7 — `ctx.issues.relations` (for flatten-blocker-chain)

**SDK signature** (types.d.ts:864-873):
```ts
interface PluginIssueRelationsClient {
  get(issueId, companyId): Promise<PluginIssueRelationSummary>;
  setBlockedBy(...);
  addBlockers(...);
  removeBlockers(...);
}

interface PluginIssueRelationSummary {
  blockedBy: IssueRelationIssueSummary[];
  blocks: IssueRelationIssueSummary[];
}
```

**Plan 02-03 handler bug:** the handler calls `ctx.http.fetch('/api/companies/{id}/issues/{id}/blockers')` — an ad-hoc HTTP path that probably doesn't exist on Paperclip's API. The 502 from the browser console matches: either the path 404s (Paperclip returns 404 → bridge wraps as 502) or the worker's fetch throws and the bridge wraps as 502.

**Fix in 02-03b:**
- Replace HTTP fetch with `ctx.issues.relations.get(issueId, companyId)` to get **immediate** blockers (one hop).
- For TRANSITIVE flattening (walk a chain), recursively call `relations.get` on each blocker until reaching leaves. Cap depth at 6 (same MAX_DEPTH the pure flattener uses). Build the `edges + nodeMeta` payload `flattenBlockerChain` expects.
- The pure `flattenBlockerChain` in `src/shared/blocker-chain.ts` does NOT change — only the handler that builds its input shape.
- **Capabilities required:** `issue.relations.read`. Add to manifest if not present.

**DEFERRED — actual 502 cause:** confirming whether the 502 came from the wrong URL (404 inside the bridge) vs the worker throwing on an undefined capability requires reading `plugin_logs` filtered to plugin uuid `0d4fc40a-...`. Will be appended to this doc when SSH to Countermoves unblocks OR when operator pastes the row. The fix in 02-03b Task 2 is correct either way — we replace the HTTP fetch with the typed SDK call.

---

## Section 8 — Plugin manifest capabilities, cross-check

**Currently declared** (per Plan 02-03 SUMMARY):
- `agents.read`, `agents.pause`, `agents.resume`, `companies.read`
- (plus pre-02-03 capabilities: `ui.page.register`, `events.subscribe`, `events.emit`, `agents.managed`)

**New capabilities Plan 02-03b must add to manifest:**
| Capability | Why |
|---|---|
| `issues.read` | `ctx.issues.get`, `ctx.issues.listComments`, `ctx.issues.relations.get` |
| `issue.documents.read` | `ctx.issues.documents.list` for DeliverablePreview |
| `issue.relations.read` | `ctx.issues.relations.get` for flatten-blocker-chain |
| `issue.comments.read` | `ctx.issues.listComments` for activity timeline (Section 4 Option A) |
| `projects.read` | ancestry derivation (Section 2) |
| `goals.read` | ancestry derivation if goal axis included (Section 2) |

If any of these are already declared from 02-02's manifest hardening, they don't need re-adding — Task 2 verifies the manifest.ts file first and adds only the missing entries.

---

## Section 9 — Plugin log lookup (DEFERRED until SSH unblocks)

The most-recent plugin_logs rows filtered to `plugin_id = '0d4fc40a-0541-4b67-8979-9d346cb9c07b'` and `created_at >= '2026-05-13T20:00:00Z'` should reveal:
1. The exception thrown from `flatten-blocker-chain` (the URL fetch failure or the bridge error).
2. Any silent exceptions from `issue.reader` (the ones our handler swallowed with `.catch()`).
3. Any "capability missing" errors if Paperclip enforces capabilities at runtime.

Operator command (when SSH is available):
```bash
ssh -i $HOME/.ssh/countermoves_vps_ed25519 eric@82.29.197.74 \
  "PGPASSWORD=\$DB_PASSWORD psql -U paperclip -d paperclip_countermoves -h localhost -c \"SELECT created_at, level, message FROM plugin_logs WHERE plugin_id = '0d4fc40a-0541-4b67-8979-9d346cb9c07b' AND created_at >= '2026-05-13T20:00:00Z' ORDER BY created_at DESC LIMIT 50\""
```

The Task 2 fixes are correct independent of what these logs say — fixing 7 known systemic defects supersedes the diagnostic. The log row appendix will be filed when convenient and serves as durable evidence for the 02-03b-SUMMARY post-drill.

---

## Resume signal for Task 2

All shapes needed to rewrite `issue-reader.ts`, `flatten-blocker-chain.ts`, and `editor-pause-status.ts` are now empirically captured. Task 2 begins by:
1. Importing `PluginContext` from `@paperclipai/plugin-sdk` and using it as the handler's ctx type (no more local-narrow Ctx redeclarations).
2. Rewriting the three handlers against the actual shapes documented above.
3. Updating the UI side (`ReaderView`, `LiveBlockerPanel`) to pass `companyId` from `useHostContext()`.
4. Adding the 6 new manifest capabilities listed in Section 8.
5. Writing integration tests in `test/worker/issue-reader-integration.test.mjs` that fake-ctx the SHAPES above (not the spec-assumed shapes), so RED→GREEN runs locally without a live Paperclip.

---

## Finding #11 — `useHostContext().userId` is null in detail-tab slots (Plan 02-09)

**Date observed:** 2026-05-14 (Plan 02-04 drill) and 2026-05-15 (Plan 02-08 drill).
**Surfaced by:** Two consecutive drills against Countermoves COU-4. Every opt-in-guard-wrapped UI call from the Reader tab received `{error: 'OPT_IN_REQUIRED'}` even though the viewer was an opted-in user with a row in `clarity_user_prefs`.

### Root cause

The SDK's `useHostContext().userId` is fed from `slotContextToHostContext()` in `~/paperclip/ui/src/plugins/slots.tsx`, which reads from `authApi.getSession()` inside `PluginBridgeScope`. That session call is a TanStack-Query subscription — during the host's initial query-loading window, `getSession()` returns `null`, and the slot's `userId` is therefore `null`. The window only persists for a few hundred milliseconds in practice, but it is reliably long enough to cause the very first `usePluginData` call from each newly-mounted slot to fire with empty userId.

See `02-03c-HOST-CONTEXT.md` §1 — the universal mapping pipeline confirms the same pipeline feeds `companyId` and `userId`. The 02-03b finding (companyId-null during the issue query loading window) is the same defect class for a different field.

### SDK surface verified to confirm worker-side resolution is not possible

- `PluginContext` (types.d.ts:1292-1345) has NO `users`, `user`, `session`, or `identity` accessor.
- `GetDataParams` (protocol.d.ts:210-217) = `{key, params, renderEnvironment}` — no envelope-level userId. The HTTP-bridge envelope's `companyId` (visible in 02-04 captured payload) is also NOT forwarded to the worker as a separate field; it must be threaded through `params`.
- `ctx.http.fetch` (types.d.ts:386-399) is outbound Node fetch from the worker process — no browser session cookies.

A worker handler called `get-viewer` could not resolve caller identity because the bridge gives it no caller-identity input to read.

### Resolution — Plan 02-09 UI-side fetch resolver

`src/ui/primitives/use-resolved-user-id.ts`. Plugin UI is same-origin trusted JavaScript (PLUGIN_SPEC.md §19) and can call Paperclip's Better Auth `/api/auth/get-session` endpoint directly with `credentials: 'include'`. The host session cookie is sent automatically; the response shape is `{user: {id}, session: {}}` (Better Auth canonical).

Worker handlers continue to read `userId` from params (the convention captured in 02-03b §5 — params, NOT a fictional `ctx.host`). The resolver hook ensures the UI threads a real value, never an empty string.

### Field-shape addendum to Section 5

The Section 5 conclusion that `useHostContext().userId` is "reliable" was correct for **page slots** (verified by the captured set-opt-in payload showing `params.userId: 'E8TMB44X...'`). It is NOT reliable for **detail-tab slots** during the auth-session loading window. Resolver hook required for detail-tab consumers.

This is the same pattern as Plan 02-03c's `useResolvedCompanyId` resolver hook for companyId. Two parallel resolvers now compose (companyId first, then userId) in the Reader's render tree.

### Affected files (Plan 02-09)

- New: `src/ui/primitives/use-resolved-user-id.ts`
- Modified: `src/ui/primitives/ref-chip.tsx`, `src/ui/surfaces/reader/index.tsx`, `src/ui/surfaces/reader/pause-banner.tsx`, `src/ui/surfaces/reader/live-blocker-panel.tsx`

### Re-verification

Closes once the Countermoves re-drill against COU-4 (Plan 02-09 Task 4) confirms (a) Reader tab renders fully, (b) DevTools Network shows real UUIDs in `userId` params for `issue.reader` / `editor.pause-status` / `resolve-refs` and `viewerUserId` for `flatten-blocker-chain`, (c) no React error boundary, (d) no `TypeError: Cannot read properties of undefined` in Console.
