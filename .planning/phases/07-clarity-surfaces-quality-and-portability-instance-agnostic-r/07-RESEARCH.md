# Phase 7 Research — Ref-resolution + portability (prerequisite chunk)

**Source:** 5-agent read-only recon, workflow run `wf_ef5f2db9-be6` (2026-05-28). All claims verified against the live tree; line numbers are at recon time.

## RESEARCH COMPLETE

## 1. The bug surface — TWO worker code paths, identical bugs

### Path A — `issue.reader` inline fetcher (the Reader's own refCards)
`src/worker/handlers/issue-reader.ts` lines 218-241. Extracts refs with the module-level `REF_PATTERN = /\bBEAAA-\d+\b/g` (line 58) from `issue.description`, then calls the pure `resolveRefs(refs, fetcher)` with an INLINE fetcher that:
- builds `apiBase = process.env.PAPERCLIP_API_URL || 'http://localhost:3100'`
- fetches `${apiBase}/api/companies/${companyId}/issues?ids=${ids.join(',')}` via `ctx.http.fetch`
- maps `id: i.key, title: i.title, status: i.status, ownerUserId: i.assignee_user_id, bodyExcerptForViewer: i._viewer_can_read===false ? null : truncate(i.body)`
- **No try/catch around the fetch** → an SSRF throw bubbles to the outer catch (line 243) → `refCards = []` (zero chips).

### Path B — standalone `resolve-refs` handler (UI calls directly)
`src/worker/handlers/resolve-refs.ts` lines 124-228. `ref-chip.tsx` calls it via `usePluginData('resolve-refs')`. Same `?ids=` URL, same `ctx.http.fetch`, same stale `i.key/i.assignee_user_id/i.body` mapping (lines 212-227). It DOES try/catch (degrades to `title: id, status: 'unknown'`). `issue.reader` does NOT delegate to this handler — they are independent. **Both must be fixed.**

### The three resolution bugs (confirmed)
- **(a) SSRF:** `ctx.http.fetch` to `localhost:3100` is blocked on paperclipai@2026.525.0 (private-IP block; the resolve-refs.ts header comment already documents it).
- **(b) Ignored filter:** the `?ids=` batch filter is the host's general-list endpoint — it ignores the filter and returns an unfiltered list.
- **(c) Stale field mapping:** code reads `i.key / i.assignee_user_id / i.body`; the host `Issue` returns `identifier / assigneeUserId / description` and **`i.key` is null**. So even on a successful fetch, `resolveRefs`'s `byId` map (keyed on returned `id = i.key = null`) never matches the requested identifier → the `"unknown"` placeholder at `src/shared/reference-resolver.ts:38-53`.

**Visible symptom decode:** `"BEAAA-807 · unknown"` (not empty chips) ⇒ the host responded but `i.key` was null ⇒ the live failure is bug (c) + (b), and `ctx.http.fetch` may NOT be throwing here. Confirm during the drill.

### Two stale type defs
`RawHostIssue` is declared twice — `issue-reader.ts:102-109` AND `resolve-refs.ts:38-45` — both encode `key/assignee_user_id/body`. Both need updating to `identifier/assigneeUserId/description`.

## 2. The portability bug — TWO hardcoded regexes

- `issue-reader.ts:58` — `const REF_PATTERN = /\bBEAAA-\d+\b/g;` (feeds Reader refCards).
- `editor.ts:126` — `extractRefsFromBody()` uses the identical `/\bBEAAA-\d+\b/g` (feeds TL;DR `inputs.refs` via `issue-reader.ts:196`). **Zero existing unit tests.**
- On any non-BEAAA instance both extract ZERO refs → no chips at all.
- `editor.ts:readTldrInputs` (~288) re-extracts refs and currently takes only `(issues, issueId, companyId)` — if `extractRefsFromBody` gains a prefix param, thread the prefix derived from the re-fetched `issue.identifier` through here too.
- The UI's `prose-with-ref-chips.tsx` is ALREADY portable (lines 48/63-65): derives prefix from the URL pathname, narrows the regex, broad `/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g` fallback. **Mirror this server-side** using `issue.identifier` (the worker has no pathname).

## 3. SDK ground truth (the de-risk)

From `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` and `@paperclipai/shared` Issue type:
- `get(issueId: string, companyId: string): Promise<Issue | null>` — single id, NO options object, NO `?ids=` batch, NO get-by-key variant.
- `list(input: { companyId, projectId?, assigneeAgentId?, originKind?, status?, limit?, offset? }): Promise<Issue[]>` — **NO `ids[]` or `identifier` filter.** So `list` cannot batch-resolve identifiers; the fallback must `list` + match on `.identifier` client-side (paginated).
- `Issue` fields (camelCase, confirmed): `id, companyId, projectId, title, description, status, assigneeAgentId, assigneeUserId, issueNumber, identifier (nullable), blockedBy?, blocks?, blockerAttention?, referencedIssueIdentifiers?`. **No `key`, no `assignee_user_id`, no `body`, no `_viewer_can_read`.**
- **CRITICAL UNVERIFIED:** the SDK is a thin JSON-RPC proxy (`host-client-factory.js`: `issues.get` → `issues.read`) that does NOT transform the id. Every existing call site (`topic-watchdog.ts:67`, `chat-topics.ts:120`) passes a **UUID**. Whether the host resolver accepts a human identifier (`'BEAAA-807'`) is NOT determinable from types. The brief's "REST `GET /api/issues/<identifier>` → 200" was the browser REST route, NOT the SDK RPC path. **→ Locked mitigation: per-ref `get` + `list`-and-match fallback; the live worker log during the drill reveals which path fired.**
- `_viewer_can_read` does not exist on the SDK Issue → the excerpt viewer-gate (PRIM-02) loses its signal. Decide replacement during the drill (likely `ctx.issues.get` already returns null for unreadable).

## 4. UI findings

- `companies-resolve.ts:55` already returns `{ companyId, displayName: match.name }`. `useResolvedCompanyId` (`use-resolved-company-id.ts:68-95`) receives `displayName` in `data` but **discards it**, and short-circuits on host-context `companyId` (line 74) BEFORE `resolve-prefix` runs. Plan: extend the hook to return `displayName`; thread a `companyName` prop from `ChatPageOptedIn` down; fallback to `extractCompanyPrefixFromPathname`, never a literal.
- `ref-chip.tsx` (lines 160-165) renders `{card.id} · {card.status}` — **no change needed** once the worker returns the identifier in `id` and a real status.
- Hardcoded labels: `roster-rail.tsx:104-106` (`${employees.length} · BEAAA` / `'BEAAA'`) and `chat/index.tsx:784-787` (placeholder `"Search all chats and tasks across BEAAA…"`).

## 5. Test harness (TDD baseline)

- `test/worker/issue-reader.test.mjs` (8) + `-integration` (10) + `-degradation` (8); `test/worker/resolve-refs.test.mjs` (9); `test/shared/reference-resolver.test.mjs` (7). Runner `node --test "test/**/*.test.mjs"`, `node:assert` strict.
- **A `ctx.issues.get(issueId, companyId)` stub ALREADY exists** in the issue-reader fakes (lines 117-137) returning camelCase `description` and the `(issueId, companyId)` signature — extend it to return the three referenced issues (`identifier/title/status/assigneeUserId`) rather than building a stub from scratch.
- **Tests that codify the bugs and WILL flip red:** `issue-reader.test.mjs:96-115` (returns snake_case `key/assignee_user_id/body` for the `?ids=` URL) + `:213-220` ("invokes fetcher exactly once" PRIM-01); `resolve-refs.test.mjs:33-52` (no `ctx.issues.get` stub at all — must be added); `issue-reader-degradation.test.mjs:164-173` (injects failure via `ctx.http.fetch` throw — must move to `ctx.issues.get` throw for ref ids, keeping the top-level issue.get working).
- `reference-resolver.test.mjs` stays GREEN (fetcher-agnostic) — but redefine PRIM-01 as "one fetcher invocation," not "one HTTP fetch."
- `extractRefsFromBody` has ZERO tests → net-new RED test for prefix-derived extraction (`COU-`/`ACME-` match, `BEAAA-` does not match on a COU issue).
- Opt-in guard: every wrapped data-handler fake's `db.query` must branch `clarity_user_prefs` → opted-in row, and pass `userId` in params, or the inner handler never runs.

## 6. Implementation shape (for the planner)

The fetcher (both paths) becomes: `Promise.all(uniqueIds.map(id => ctx.issues.get(id, companyId)))`; on any null, lazily `ctx.issues.list({companyId})` once (cached per invocation), build an `identifier → Issue` map, resolve the nulls from it. Map each resolved Issue to the resolveRefs row with `id = requestedIdentifier, title: i.title, status: i.status, ownerUserId: i.assigneeUserId, bodyExcerpt: i.description-derived`. Drop `apiBase`/`?ids=`/`ctx.http.fetch` entirely (dead-code the `PAPERCLIP_API_URL` fallback). Extraction (both regexes): `prefixFromIdentifier(issue.identifier)` → narrow regex, broad fallback when null.
