# Phase 18: No rabbit-holes & plain-English - Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 14 (11 modify, 3 new) + 3 test files to invert/extend
**Analogs found:** 14 / 14 (every new file has a strong in-repo analog)

This phase is almost entirely MODIFY at identified boundaries (LEG-01 nav re-point, LEG-02 scrub fallback + render-scrub, LEG-03 one new affordance). The verdict pipeline ("one engine → one scrub → one verdict") already exists. Three genuinely NEW files: one shared `buildReaderHref()` helper, one batched `getTldrBodiesByScopeIds` query, one LEG-03 affordance component. Each maps to a concrete existing analog below.

All line numbers below were re-verified against the working tree this session (RESEARCH.md anchors confirmed; a couple drifted by ≤2 lines — corrected here).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/surfaces/reader/live-blocker-panel.tsx` (MOD) | component | request-response (nav) | self / `employee-row.tsx` | exact (re-point) |
| `src/ui/surfaces/situation-room/employee-row.tsx` (MOD) | component | request-response (nav) | self | exact (re-point) |
| `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx` (MOD) | component | request-response (nav) | self | exact (re-point) |
| `src/ui/surfaces/bulletin/lineage-footer.tsx` (MOD) | component | request-response (nav) | self | exact (re-point) |
| `src/ui/surfaces/_shared/reply-in-place.tsx` (MOD) | component | request-response (nav) | self | exact (re-point) |
| `src/ui/primitives/reader-href.ts` (NEW) | utility | transform (string build) | `use-resolved-company-id.ts` (`extractCompanyPrefixFromPathname`) | role-match (co-located helper) |
| `src/shared/scrub-human-action.ts` (MOD) | utility | transform (string scrub) | self | exact |
| `src/ui/surfaces/chat/topic-strip.tsx` (MOD) | component | transform (label render) | `chtLabel()` in same file | exact |
| `src/worker/db/tldr-cache.ts` (MOD: +`getTldrBodiesByScopeIds`) | model/query | CRUD (batched read) | `getTldrByScope` (same file) | exact (mirror with `= ANY`) |
| `src/worker/situation/build-employees-rollup.ts` (MOD) | service | CRUD + transform | self (focusLine area) + `awaiting-you-selector.ts` | exact |
| `src/ui/surfaces/reader/index.tsx` (MOD: lift done-flag to TldrStrip area) | page | request-response | self (`TldrStrip` at :406, `LiveBlockerPanel` at :416) | exact |
| `src/ui/surfaces/.../looks-done-affordance.tsx` (NEW) | component | event-driven (confirm → mutate) | `owner-picker-popover.tsx` | role-match (confirm popover) |
| `scripts/probes/reader-tab-deeplink.mjs` (NEW, task 1) | script/probe | request-response | `scripts/probes/carrier-survival.mjs` | role-match (host probe) |
| `test/shared/scrub-human-action.test.mjs` (MOD: invert) | test | — | self (Tests 4b/5/6) | exact |
| `test/ui/surfaces/.../*-no-uuid-leak.test.mjs` (MOD: extend, anchored) | test | — | `employee-row-no-uuid-leak.test.mjs` | exact |

---

## Pattern Assignments

### LEG-01 — the five Open↗ re-point sites (component, request-response)

**The single most important fact:** all five sites share the **identical** nav shape today:
`navigate(\`/${companyPrefix}/issues/${id}\`)` where `companyPrefix = extractCompanyPrefixFromPathname(useHostLocation().pathname) ?? ''`. The phase introduces ONE shared `buildReaderHref()` helper and re-points all five to call it — so Tier-1 (host deep-link) vs Tier-2 (fallback) is a one-line change in one place.

**Current call shape per site (verified this session):**

| File | Line | Current call |
|------|------|--------------|
| `reader/live-blocker-panel.tsx` | **171** | `nav.navigate(\`/${companyPrefix}/issues/${issueId}\`)` (inside `openIssue` useCallback, :169-172) |
| `situation-room/employee-row.tsx` | **238** | `navigate(\`/${companyPrefix}/issues/${issueId}\`)` (inside one shared `openIssue` useCallback :235-241, called from BOTH Open↗ buttons at :451 and :506) |
| `situation-room/blocked-backlog-expander.tsx` | **62** | `navigate(\`/${companyPrefix}/issues/${identifier}\`)` (inside `openIssue` :60-63) |
| `bulletin/lineage-footer.tsx` | **48** | `navigate(\`/${companyPrefix}/issues/${identifier}\`)` (inside `openIssue` :46-49) |
| `_shared/reply-in-place.tsx` | **227** | `navigate(\`/${companyPrefix}/issues/${leafIssueId}\`)` (inside `openIssue` :224-228, the `!reachable` branch) |

**Note — `employee-row.tsx` has ONE `openIssue` callback, not three.** RESEARCH/SPEC cite :238/453/508; verified — :238 is the single callback body, :453 and :508 are the two JSX `onClick={() => openIssue(chain.leafIssueId)}` buttons that both route through it. Re-pointing the one callback fixes both sites. Do NOT touch `openChatWithOwner` / `assignWork` (they call `buildChatDeepLink` → `/chat#h=...`, a DIFFERENT target — landmine #8).

**Canonical excerpt to pattern-match (live-blocker-panel.tsx:147-172):**
```typescript
const nav = useHostNavigation();
const { pathname } = useHostLocation();
const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';
// ...
const openIssue = React.useCallback(() => {
  if (!companyPrefix) return;
  nav.navigate(`/${companyPrefix}/issues/${issueId}`);  // ← becomes nav.navigate(buildReaderHref(companyPrefix, issueId))
}, [nav, companyPrefix, issueId]);
```

Every site already imports `extractCompanyPrefixFromPathname` from `'../../primitives/use-resolved-company-id.ts'` (or relative variant) — the new helper co-locates with it (below) so the import line gains one symbol.

---

### NEW: `src/ui/primitives/reader-href.ts` (utility, transform)

**Analog:** `src/ui/primitives/use-resolved-company-id.ts` → `extractCompanyPrefixFromPathname` (lines 57-63). Same file family (`src/ui/primitives/`), same shape: a pure exported string helper with no I/O, type-stripping-safe, unit-testable.

**Pattern to copy (the pure-helper shape, use-resolved-company-id.ts:57-63):**
```typescript
export function extractCompanyPrefixFromPathname(pathname: string | null | undefined): string | null {
  if (typeof pathname !== 'string') return null;
  const segments = pathname.split('/').map((s) => s.trim()).filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  return first;
}
```

**New helper signature** (single source of the Open↗ target string):
```typescript
// src/ui/primitives/reader-href.ts
export function buildReaderHref(companyPrefix: string, identifier: string): string {
  // Tier-2 (locked fallback) default: /<prefix>/issues/<id>
  // Tier-1 (if the host probe proves a tab-select param is honored): append ?tab=clarity-reader or #tab=clarity-reader
  return `/${companyPrefix}/issues/${identifier}`;
}
```
The Tier-1 vs Tier-2 decision (the probe outcome) changes ONLY this return line. RESEARCH §1 default = Tier-2. A render-scan test can grep that no surface inlines `/issues/${` directly anymore — mirror the `*-no-uuid-leak.test.mjs` source-grep convention.

**Co-location alternative noted in RESEARCH:** the helper could live inside `use-resolved-company-id.ts` next to `extractCompanyPrefixFromPathname`. Planner's call; a dedicated `reader-href.ts` keeps the LEG-01 surface obvious.

---

### `src/shared/scrub-human-action.ts` (utility, transform) — the LEG-02 core

**Analog:** itself (the existing 4-step scrub). The six `agent#${uuid.slice(0,8)}` fallback emissions are the leak. Verified exact lines this session:

| Line | Current fallback (the leak) | Step |
|------|------------------------------|------|
| **65** | `(uuid) => nameOf(uuid) ?? \`agent#${uuid.slice(0, 8)}\`` | 2 (UNCLASSIFIED, 1st pass) |
| **66** | `(uuid) => \`agent#${uuid.slice(0, 8)}\`` | 2 (UNCLASSIFIED, 2nd pass) |
| **71** | `(uuid) => nameOf(uuid) ?? \`agent#${uuid.slice(0, 8)}\`` | 3 (embedded-UUID substitution) |
| **78** | `nameOf(terminal.userId) ?? \`agent#${terminal.userId.slice(0, 8)}\`` | 4 (AWAITING_HUMAN viewer) |
| **86** | `(uuid) => \`agent#${uuid.slice(0, 8)}\`` | 5 (belt-and-suspenders) |

**Excerpt (steps 2-5, lines 64-87) — the exact emission sites:**
```typescript
  if (terminal.kind === 'UNCLASSIFIED') {
    const scrubbed = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
    return scrubbed.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
  }
  let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
  if (terminal.kind === 'AWAITING_HUMAN') {
    if (terminal.label.includes(terminal.userId)) {
      const resolved = nameOf(terminal.userId) ?? `agent#${terminal.userId.slice(0, 8)}`;
      // ...
    }
  }
  return label.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
```

**Fix pattern (per RESEARCH §3 single-source):** replace every `?? \`agent#${uuid.slice(0,8)}\`` (and the bare `() => \`agent#...\``) with `?? AGENT_FALLBACK` / `() => AGENT_FALLBACK`. The UNCLASSIFIED double-scrub (65-66) collapses to one `.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? AGENT_FALLBACK)`. Add the new exports alongside the existing `UUID_RE`/`UUID_RE_G` (lines 22-23):
```typescript
export const AGENT_FALLBACK = 'an agent';                       // NEW — single literal; tests + scrub import it
export const PARTIAL_HEX_RE = /\bagent#[0-9a-f]{6,}\b/i;        // NEW — guard anchor (NOT a blanket short-hex rule)
export function rescrubPersisted(text: string): string { /* NEW — read-time pass: replace UUID_RE_G + PARTIAL_HEX_RE → AGENT_FALLBACK */ }
```
Also update the doc-comments at lines 33-34, 42, 44 ("`agent#<8>` fallback" → "'an agent' fallback") so the comment no longer documents the removed behavior (landmine #4).

**Idempotency note:** `rescrubPersisted` must be a no-op over already-clean text (re-runnable at render with zero side effects).

---

### `src/ui/surfaces/chat/topic-strip.tsx` (component, transform) — LEG-02(d)

**Analog:** the `chtLabel()` function in the same file, lines 78-83. The leak is line **82**: `return id ? id.slice(0, 8).toUpperCase() : 'CHT-—';` — raw hex slice.

**Current excerpt (78-83):**
```typescript
export function chtLabel(topic: ChatTopic): string {
  const id = topic.topicId ?? '';
  if (/^CHT-\d+$/i.test(id)) return id.toUpperCase();   // real ordinal — keep
  if (/^\d+$/.test(id)) return `CHT-${id}`;              // numeric ordinal — keep
  return id ? id.slice(0, 8).toUpperCase() : 'CHT-—';   // ← LEAK: raw hex slice
}
```

**Fix (D-08/D-09):** the payload already carries `topic.title` (ChatTopic type, lines 41-45) and `topic.employeeAgentId` — resolve `CHT-<8>` → `topic.title`; the `run·<8>` chip (in `chat/message-thread.tsx`, per RESEARCH ~:1121) → agent name/role or `AGENT_FALLBACK`. Import `humanizeChatChip` / `AGENT_FALLBACK` from the shared scrub module (UI-safe: `scrub-human-action.ts` is pure, type-only imports). Keep the real-ordinal branches (lines 80-81) — those are legitimate `CHT-NN`. Per A4: verify `message-thread.tsx`'s run-chip payload carries the agent name; if not, that's the ONE allowed worker addition (D-08 escape hatch).

---

### `src/worker/db/tldr-cache.ts` — NEW `getTldrBodiesByScopeIds` (model/query, CRUD batched)

**Analog:** `getTldrByScope` in the same file, lines 97-111 — the single-row template. The batched variant mirrors it with `scope_id = ANY($2)` for ONE query over the whole needs-you set (landmine #1: O(1), never per-row).

**Template to copy (getTldrByScope, 97-111):**
```typescript
export async function getTldrByScope(
  ctx: TldrCacheCtx,
  surface: TldrRow['surface'],
  scopeId: string,
): Promise<TldrRow | null> {
  const rows = await ctx.db.query<TldrRow>(
    `SELECT surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags
     FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache
     WHERE surface = $1 AND scope_id = $2
     ORDER BY generated_at DESC
     LIMIT 1`,
    [surface, scopeId],
  );
  return rows[0] ?? null;
}
```

**New batched shape** (mirror, swap to `= ANY` + return a Map keyed by scope_id, most-recent-per-scope):
```typescript
export async function getTldrBodiesByScopeIds(
  ctx: TldrCacheCtx,
  surface: TldrRow['surface'],
  scopeIds: string[],
): Promise<Map<string, string>> {
  if (scopeIds.length === 0) return new Map();   // skip the query entirely on empty set
  const rows = await ctx.db.query<{ scope_id: string; body: string; generated_at: string }>(
    `SELECT DISTINCT ON (scope_id) scope_id, body, generated_at
       FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache
      WHERE surface = $1 AND scope_id = ANY($2)
      ORDER BY scope_id, generated_at DESC`,
    [surface, scopeIds],
  );
  // ... → Map<scope_id, body>
}
```
**Caution (per the file header, v0.6.5 Bug 2):** `text[]` params need explicit `$N::text[]` casts through the host bridge. The `= ANY($2)` here binds a `text[]` of scope_ids — verify the host bridge passes a JS string array through to `ANY` correctly, or format via the same `toPgTextArrayLiteral` + `::text[]` pattern the `upsertTldr` function uses (lines 57-62, 77). This is a real bridge gotcha already documented in this exact file.

---

### `src/worker/situation/build-employees-rollup.ts` (service, CRUD+transform) — LEG-03 SR signal

**Analog:** itself — the `focusLine` area (verified lines 384-390) computes `focusLine = polishTldr(focusIssue.title)` and reads NO `tldr_cache` today. LEG-03 adds the first cache read into this Phase-16-hardened hot path.

**Current focusLine excerpt (384-390):**
```typescript
  // h. focusLine — null for idle/stale; else polishTldr(title) truncated ≤80.
  let focusLine: string | null = null;
  if (state !== 'idle' && state !== 'stale') {
    const rawFocus = focusIssue?.title ?? '';
    const polished = polishTldr(rawFocus);
    focusLine = polished.length > 80 ? `${polished.slice(0, 77)}…` : polished || null;
  }
```
**KEEP THIS UNCHANGED** (landmine #10 — do NOT fold the superseded focusLine-from-tldr rewrite into Phase 18). LEG-03 adds a SEPARATE done-flag, not a focusLine source change.

**Batching pattern — pair with the needs-you selector.** `src/worker/situation/awaiting-you-selector.ts` → `selectAwaitingYouIssueIds(rows)` (full read; lines 47-60) is PURE and returns the de-duped needs-you issue UUIDs. Use it as the batch key:
```typescript
export function selectAwaitingYouIssueIds(rows: SituationEmployeeRow[]): string[] {
  // ... filters chain.needsYou === true, picks chain.targetIssueUuid ?? chain.leafIssueUuid, de-dupes
}
```
**Integration recipe (per RESEARCH §LEG-03 + landmines #1/#2):**
1. After the per-employee `Promise.all` rollup, build the needs-you set: `const ids = selectAwaitingYouIssueIds(employees)`.
2. ONE batched read: `const bodies = await getTldrBodiesByScopeIds(ctx, 'issue', ids)` — degrade-wrapped in try/catch; a throw/slow read yields an empty Map (affordance simply absent, `focusLine` untouched, render never blocked/slowed).
3. Run the D-05 done-regex over each matched body; attach a `looksDone: boolean` flag to the row when `chain.needsYou === true` AND the regex fires.

The `needsYou` engine verdict is already on `BlockerChainResult` (`src/shared/types.ts`) — read it, never compute it (no `blocker-chain.ts` edit; landmine #6).

---

### `src/ui/surfaces/reader/index.tsx` (page) — LEG-03 Reader side

**Analog:** itself. The Reader ALREADY has the TL;DR body and the blocked verdict in hand — no new Reader DB read.
- `data.tldr` → `<TldrStrip>` at **:406**: `<TldrStrip tldr={data.tldr} status={data.tldrStatus} truncated={data.tldrTruncated} />` — `data.tldr.body` is available at index level for the done-regex.
- `<LiveBlockerPanel issueId={entityId} />` at **:416** owns its own `flatten-blocker-chain` fetch (which carries `needsYou`).

**Placement (CONTEXT discretion — next to the TL;DR):** lift the `needsYou` signal up to the index level (or pass the done-flag down into the TldrStrip area) so the affordance sits beside the briefing, wrapped in a `SectionErrorBoundary` like its siblings (:405, :415).

---

### NEW: LEG-03 "Looks done — close it?" affordance (component, event-driven confirm)

**Analog:** `src/ui/surfaces/situation-room/owner-picker-popover.tsx` (read 1-90). It is the canonical Clarity confirm-popover: a NORMAL typed React component (NOT a slot-root), open/closed local state, outside-click + Esc close, dispatches a host mutation via `usePluginAction`, fires `onAssigned` + force-refetch on success, and carries the issue UUID as a **dispatch-only** prop (never rendered — NO_UUID_LEAK).

**Patterns to copy from owner-picker-popover.tsx:**
- **Component posture (header :28-29):** "This is a NORMAL typed React component, NOT a plugin slot-root — it takes its props directly. Outside-click + Esc close mirror shortcuts-popover.tsx."
- **State shape (:85-87):** `const [open, setOpen] = React.useState(false); const [assigning, setAssigning] = React.useState(false); const wrapRef = React.useRef(...)`.
- **Mutation dispatch (:89):** `const assignOwner = usePluginAction('situation.assignOwner');` — LEG-03 dispatches the existing host issue-update / close action analogously (A7: SR assign-owner uses `ctx.issues.update`; same privilege boundary).
- **UUID-as-dispatch-only (:59-66):** `leafIssueUuid?: string` prop comment: "Consumed ONLY as a dispatch arg (NO_UUID_LEAK) — never rendered as text." Carry the close target issue UUID the same way.
- **Confirm-gated by construction:** OwnerPicker applies immediately (:22, "no intermediate confirm") — LEG-03 is the OPPOSITE: it MUST gate on an explicit "Close as done" / "Keep blocked" selection and never auto-close. Copy the component scaffolding, NOT the immediate-apply posture.

**Styling (sketch skill):** `Skill("sketch-findings-clarity-pack")` — warm-dark paper-on-ink palette, `--alert`/`--warn` accents for a divergence prompt, Geist Mono for meta labels, "degraded states always name themselves." Any new class passes `check-css-scope.mjs` (scoped under `[data-clarity-surface]`) + the bundle-size gate. The mockup contract is unchanged — text/label + one affordance only.

---

### NEW: `scripts/probes/reader-tab-deeplink.mjs` (script/probe) — LEG-01 task 1

**Analog:** `scripts/probes/carrier-survival.mjs` (the chat deep-link carrier-survival probe referenced throughout RESEARCH §1, run on COU-2215 2026-05-23). Mirror its structure: navigate the live BEAAA host to `/<prefix>/issues/<id>?tab=clarity-reader` and `…#tab=clarity-reader`, observe whether the host lands on the Reader tab. The outcome picks LEG-01 Tier-1 (deep-link works) vs Tier-2 (locked fallback). This MUST be the first task — it is unanswerable from the codebase (host code) and gates the `buildReaderHref` return line.

---

## Shared Patterns

### NO_UUID_LEAK guard (extend, anchored — LEG-02c)
**Source / analog:** `test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs` (read in full). Convention = source-grep + small string-render simulation, NO jsdom. Each file defines `UUID_RE` locally (line 29):
```javascript
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function stripComments(src) { /* strips block + line comments */ }
const ROW_CODE = stripComments(readFileSync(...));
assert.doesNotMatch(ROW_CODE, /\.sourceIssueUuid\b/, ...);
```
**Apply to:** each per-surface `*-no-uuid-leak.test.mjs` (employee-row, pulse-header, reply-in-place). Extend each to ALSO assert no match of `PARTIAL_HEX_RE = /\bagent#[0-9a-f]{6,}\b/i` plus the bare `UUID_RE`. **Anchor to `agent#`** — do NOT add a blanket `/[0-9a-f]{8,}/` (false-positives on git SHAs, hex colors — landmine #5). Import `PARTIAL_HEX_RE` from `scrub-human-action.ts` so the guard and the runtime can never drift.

### Guard-test inversion (LEG-02c — a first-class task, landmine #4)
**Source:** `test/shared/scrub-human-action.test.mjs`. The currently-BLESSING assertions (verified exact lines):
- **:94** `assert.match(stuck, /agent#eeeeeeee/);` (Test 4b, AWAITING_AGENT_STUCK)
- **:123** `assert.match(ext, /agent#dddddddd/);` (Test 5, EXTERNAL)
- **:144** `assert.match(result, /agent#12345678/);` (Test 6, belt-and-suspenders)

These INVERT: assert the output does NOT match `/agent#[0-9a-f]{6,}/i` and DOES contain `'an agent'` (or a resolved name). Also invert `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` (~:121, `includes('agent#')` per 16-RESEARCH). A green suite after only changing runtime code means the inversion was NOT done — it is the proof, not a side-effect.

### Read-time re-scrub (LEG-02e — additive, zero new fetches)
**Pattern:** apply `rescrubPersisted(str)` (new, in `scrub-human-action.ts`) at each surface's render over strings ALREADY in hand — verdict/awaited-party lines, focus lines, bulletin bodies, chat chips. Regex over in-memory strings only; ZERO new DB fetches on the snapshot path (landmine #3). Idempotent.

### Degrade-safe deterministic floor
Every new affordance/scrub renders correctly when the TL;DR cache / Editor-Agent is absent: missing TL;DR or missing engine verdict → LEG-03 affordance simply absent (no false prompt); failed/slow batched read → drop the flag, never block. No AI/LLM token enters `blocker-chain.ts` (determinism + AI-token grep guards stay green — landmine #6).

### Instance-agnostic nav
Every LEG-01 site derives `companyPrefix` via `extractCompanyPrefixFromPathname(useHostLocation().pathname)` — no instance literals. `buildReaderHref` preserves this (takes `companyPrefix` as an arg).

### Two-source version bump (deploy — landmine #9)
Bump BOTH `package.json` AND `src/manifest.ts` (host reads `dist/manifest.js`). Bookend = automated DO backup per `.planning/DEPLOY-RUNBOOK.md`.

---

## No Analog Found

None. Every new file maps to a strong in-repo analog:

| File | Role | Analog | Note |
|------|------|--------|------|
| `reader-href.ts` | utility | `extractCompanyPrefixFromPathname` | pure helper family |
| `getTldrBodiesByScopeIds` | query | `getTldrByScope` | mirror with `= ANY` |
| LEG-03 affordance | component | `owner-picker-popover.tsx` | confirm popover (invert apply→confirm-gate) |
| `reader-tab-deeplink.mjs` probe | script | `scripts/probes/carrier-survival.mjs` | host probe |

---

## Metadata

**Analog search scope:** `src/ui/surfaces/{reader,situation-room,bulletin,chat,_shared}/`, `src/ui/primitives/`, `src/shared/`, `src/worker/{db,situation}/`, `test/{shared,ui,worker}/`, `scripts/probes/`, `.claude/skills/sketch-findings-clarity-pack/`
**Files scanned:** ~18 (11 priority modify targets read at exact ranges; 4 analogs read in full; 3 test files)
**Line numbers:** re-verified against working tree 2026-06-13 (RESEARCH anchors confirmed; minor drift corrected — employee-row Open↗ buttons are :451/:506 via a single :238 callback, reply-in-place nav is :227, reader TldrStrip :406 / LiveBlockerPanel :416)
**Pattern extraction date:** 2026-06-13

## PATTERN MAPPING COMPLETE
