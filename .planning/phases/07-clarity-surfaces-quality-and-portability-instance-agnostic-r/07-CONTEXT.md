# Phase 7: Clarity-surfaces quality + portability — Context

**Gathered:** 2026-05-28
**Status:** Ready for planning (prerequisite chunk only)
**Source:** MemPalace discuss drawers + this session's recon + Eric's locked decisions

<domain>
## Phase Boundary

Phase 7 makes the four Clarity Pack surfaces genuinely insightful and **fully instance-agnostic** (must work on any Paperclip instance, not just BEAAA). Five sequenced items (Eric's locked order of pain):

1. **[PREREQUISITE] Ref-resolution fix** — `BEAAA-NNN` cross-reference chips currently render `"BEAAA-807 · unknown"`. Resolve refs via the SDK instead of the SSRF-blocked HTTP path.
2. **[PORTABILITY] De-BEAAA worker ref extraction** + 2 hardcoded UI labels.
3. TL;DR cleanup (markdown render + tighter prompt + refs→titles).
4. Situation Room org-level blocked backlog.
5. Bulletin lineage filter + gloss + clickable.

**THIS PLANNING PASS COVERS ITEMS 1 + 2 ONLY** (the prerequisite chunk). Items 3–5 each have their own discuss gate per the locked "discuss-first" decision and will be planned in later passes. Item 1 is the prerequisite because the SDK ref-resolver it builds also unblocks item 3's TL;DR titles and is the portability fix.

**Hard host constraint:** On paperclipai@2026.525.0 (PR #6547) the scheduled-job + event-handler invocation scopes are DEAD for host calls. All agent-backed and host-reading work must run from valid HTTP-request scopes (data handlers + actions). The ref-resolution fix runs inside the `issue.reader` data handler and the `resolve-refs` data handler — both valid scopes.
</domain>

<decisions>
## Implementation Decisions (LOCKED — do not re-litigate)

### Resolution strategy
- Resolve each ref via **`ctx.issues.get(identifier, companyId)`** in parallel (`Promise.all`), **WITH a cached `ctx.issues.list({companyId})`-and-match-on-`.identifier` fallback** when `get` returns null.
- The fallback also de-risks the single highest-risk unknown: whether the host RPC `issues.get` accepts a human identifier (`'BEAAA-807'`) or only a UUID. SDK signature is `get(issueId, companyId)`; every existing call site passes a UUID; not determinable from types. The live Playwright drill + worker log doubles as the runtime probe for which path fires.
- The pure `resolveRefs()` helper (`src/shared/reference-resolver.ts`) stays UNCHANGED — the fetcher must return `id = the requested identifier` so `byId.get(ref)` hits (otherwise chips still say "unknown").
- Fix BOTH worker paths: the inline fetcher in `issue-reader.ts` AND the standalone `resolve-refs.ts` handler. They do not share code; fixing one leaves the other broken.

### Extraction strategy
- Derive the **EXACT prefix from the current issue's `identifier`** (e.g. `'COU-2486'` → `'COU'`) and narrow the regex to it.
- Broad fallback `/\b[A-Z][A-Z0-9]{1,7}-\d+\b/g` ONLY when `issue.identifier` is null (nullable for plugin-op / fresh issues).
- Mirror the UI's already-portable `prose-with-ref-chips.tsx` pattern.
- **Do NOT** use the host's `extractIssueReferenceIdentifiers` helper or `referencedIssueIdentifiers` field — Eric chose exact-prefix to avoid broad-pattern false positives (e.g. `DAY-90`).

### Labels
- Surface `displayName` (already returned by `companies.resolve-prefix` at `companies-resolve.ts:55`, currently discarded by `useResolvedCompanyId`) into `roster-rail.tsx:105` and `chat/index.tsx:785`.
- Fallback to the URL prefix (`extractCompanyPrefixFromPathname`), NEVER a literal string.
- NOTE: the hook short-circuits on host-context `companyId` BEFORE `resolve-prefix` runs (`use-resolved-company-id.ts:74`) — name plumbing must handle that path; the URL-prefix fallback is acceptable there.

### Open item (resolve during the drill, not a planning blocker)
- The current code gates excerpts on `i._viewer_can_read`, which does NOT exist on the SDK `Issue` type. Confirm whether `ctx.issues.get` enforces viewer permissions server-side (returns null for unreadable) and gate accordingly.

### Process constraints
- **No version bump** — stay `1.0.0` (both `package.json` AND `src/manifest.ts`).
- **Additive-only** — NO migration needed for this chunk.
- **TDD-first.** Existing tests that codify the bugs (the `?ids=` URL + snake_case `key/assignee_user_id/body` mapping + the PRIM-01 "exactly one fetch" assertion) WILL flip red and must be rewritten — intended TDD churn, call it out.
- PRIM-01 "single round-trip" must be **redefined as "one fetcher invocation"** (the pure-resolver boundary), since per-ref `get()` is N calls.

### Claude's Discretion
- Whether to extract a shared `prefixFromIdentifier` helper vs inline derivation (both worker sites need it).
- Whether the `list`-fallback caches at module scope or per-invocation (per-invocation is safer for freshness).
- Exact test fixture identifiers (`COU-`/`ACME-` for the portability tests).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Worker resolution (the fix targets)
- `src/worker/handlers/issue-reader.ts` — REF_PATTERN (line 58), inline fetcher (lines 222-241), stale RawHostIssue (lines 102-109), the root `ctx.issues.get` call (line ~160).
- `src/worker/handlers/resolve-refs.ts` — standalone handler, same 3 bugs (lines 124-228), stale RawHostIssue (lines 38-45).
- `src/shared/reference-resolver.ts` — pure `resolveRefs()` (unchanged; the "unknown" placeholder is lines 38-53).
- `src/worker/agents/editor.ts` — `extractRefsFromBody` hardcoded regex (line 126); `readTldrInputs` (~288) re-extracts and may need the prefix threaded.

### UI (reference pattern + label sites)
- `src/ui/surfaces/reader/prose-with-ref-chips.tsx` — the already-portable extraction pattern to mirror.
- `src/ui/primitives/use-resolved-company-id.ts` — `extractCompanyPrefixFromPathname` + the hook that discards `displayName` (short-circuit at line 74).
- `src/ui/surfaces/chat/roster-rail.tsx:105` + `src/ui/surfaces/chat/index.tsx:785` — the two hardcoded "BEAAA" labels.
- `src/worker/handlers/companies-resolve.ts:55` — already returns `displayName`.
- `src/ui/primitives/ref-chip.tsx` — NO change needed (renders `card.id · card.status`).

### Test harness
- `test/worker/issue-reader.test.mjs` (+ `-integration` + `-degradation`), `test/worker/resolve-refs.test.mjs`, `test/shared/reference-resolver.test.mjs`.

### SDK ground truth
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — `get(issueId, companyId): Promise<Issue|null>`; `list(input)` has no ids/identifier filter.
- `@paperclipai/shared` Issue type — camelCase `identifier/title/status/assigneeUserId/description` (no `key`, no `body`).

### Deploy / verify
- `.planning/DEPLOY-RUNBOOK.md` — Path A to BEAAA.
- Recon source: workflow run `wf_ef5f2db9-be6` (full findings transcribed in 07-RESEARCH.md).
</canonical_refs>

<specifics>
## Specific Ideas

- The visible `"· unknown"` (vs empty chips) means the host responds but `i.key` is null → `byId` map keyed by null → requested identifier misses. Confirms the bug is the stale field mapping + ignored `?ids=`, and that `ctx.http.fetch` may not actually be throwing on this host (open question for the drill).
- `editor.ts:extractRefsFromBody` feeds `issue-reader.ts:196` (TL;DR `inputs.refs`) — so the portability fix touches the TL;DR input path even though TL;DR *rendering* is deferred to item 3.
</specifics>

<deferred>
## Deferred Ideas

- **Items 3–5** (TL;DR markdown/prompt/titles; Situation Room blocked backlog; bulletin lineage) — planned in later passes after their own discuss gates.
- The `_viewer_can_read` excerpt-gate replacement — settled empirically during the drill.
- Consuming the host's `referencedIssueIdentifiers` precompute — explicitly rejected for v1 (false-positive risk).
</deferred>

<scope_fence>
## Scope Fence

IN SCOPE (this plan): worker ref RESOLUTION (both paths) + worker ref EXTRACTION portability (both regexes) + 2 UI label swaps via existing `displayName`. No schema, no migration, no version bump.

OUT OF SCOPE (this plan): TL;DR rendering/prompt changes, Situation Room blocked backlog, bulletin lineage, any UI visual redesign, ref-chip/tldr-strip component changes.
</scope_fence>

---

*Phase: 07-clarity-surfaces-quality-and-portability*
*Context gathered: 2026-05-28*
