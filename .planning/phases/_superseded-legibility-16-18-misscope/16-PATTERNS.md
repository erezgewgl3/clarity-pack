# Phase 16: Legibility / No-Raw-Identifiers Pass - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 13 (5 modified source, 1 new shared helper, 7 test files)
**Analogs found:** 13 / 13 (this is in-place surgery — every target IS its own best analog; the new shared helper has a near-exact in-repo precedent)

This phase is codebase surgery at identified boundaries. For most files the "analog" is the file itself (the executor modifies an existing line whose current state is the contract to invert). The ONE genuinely new file (`src/shared/verdict-wording.ts`) has a near-exact precedent in `src/shared/reply-reachable.ts` — same purity boundary, same exhaustive-switch idiom, already cross-imported by BOTH Reader and SR.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/shared/scrub-human-action.ts` | scrub helper (shared, pure) | transform (terminal→string) | itself (invert the 6 `agent#<8>` fallbacks) | self / exact |
| `src/shared/verdict-wording.ts` **(NEW)** | wording helper (shared, pure) | transform (kind→sentence) | `src/shared/reply-reachable.ts` | exact-pattern |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | UI render (Reader) | request-response (render) | itself + `employee-row.tsx` wording (LEG-05 target) | self / parity-target |
| `src/ui/surfaces/situation-room/employee-row.tsx` | UI render (SR) | request-response (render) | itself (LEG-05 wording source/consumer) | self |
| `src/worker/situation/build-employees-rollup.ts` | worker rollup | DB read + transform | itself + `flatten-blocker-chain.ts` resolver | self |
| `src/worker/db/tldr-cache.ts` | DB read (read-only) | request-response (SELECT) | `getTldrByScope` (already exists — consume, don't change) | reuse |
| `src/ui/surfaces/chat/topic-strip.tsx` | UI render (Chat chip) | render | itself (`chtLabel` + `topic.title`) | self |
| `src/ui/surfaces/chat/message-thread.tsx` | UI render (Chat run chip) | render | itself (`run·<8>` + `row.title`) | self |
| `src/ui/surfaces/chat/index.tsx` | UI render (Chat toast) | render | itself (`shortId` toast) | self |
| `src/shared/scrub-human-action.ts` (regex) | guard (regex source) | transform | `UUID_RE`/`UUID_RE_G` (add `PARTIAL_HEX_RE`) | self |
| `test/shared/scrub-human-action.test.mjs` | test (invert) | n/a | itself (lines 94,123,144 — flip) | self |
| `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` | test (invert) | n/a | itself (line 121 — flip) | self |
| `test/ui/surfaces/.../*-no-uuid-leak.test.mjs` (3) | test (extend) | n/a | `employee-row-no-uuid-leak.test.mjs` | exact-pattern |

## Pattern Assignments

### `src/shared/scrub-human-action.ts` (scrub helper — LEG-01/LEG-02 root cause)

**Analog:** itself. The 6 `agent#${uuid.slice(0, 8)}` fallback sites ARE the leak (`agent#04fcac7c` on BEAAA-972).

**Imports / regex source** (lines 14, 22-23 — verbatim, the LEG-02 work surface):
```typescript
import type { Terminal } from './types.ts';
export const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const UUID_RE   = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
```
**LEG-02 add (anchored, per A2 — do NOT add blanket short-hex):** a new exported `PARTIAL_HEX_RE` anchored to the `agent#` prefix, e.g. `/\bagent#[0-9a-f]{6,}\b/i`. The guard tests assert scrub output matches NEITHER `UUID_RE` NOR `PARTIAL_HEX_RE`.

**The 6 leak sites to replace (current state — verbatim):**
```typescript
// :65 (UNCLASSIFIED step-2, first pass)
const scrubbed = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
// :66 (UNCLASSIFIED step-2, belt)
return scrubbed.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
// :71 (step-3 — covers AWAITING_AGENT_STUCK/WORKING agentId — the live BEAAA leak)
let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
// :78 (step-4 AWAITING_HUMAN viewer resolve)
const resolved = nameOf(terminal.userId) ?? `agent#${terminal.userId.slice(0, 8)}`;
// :86 (step-5 belt-and-suspenders final pass)
return label.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
// (:59 UNOWNED branch already uses a plain noun: 'Owner unknown — assign an owner first' — KEEP as model)
```
**A1 fix shape:** every `?? \`agent#${uuid.slice(0,8)}\`` becomes `?? 'an agent'` (lowercase, sentence-fit, per A1). The doc-comments at `:33-34,42,44` that say "NEVER the raw UUID … `agent#<8>` fallback" must be rewritten to "NEVER a raw UUID OR partial hash; last-resort fallback is the noun 'an agent'". **Note the resolution PRECEDENCE A1 mandates:** the COMMON path is `nameOf(uuid)` (real human name) succeeding — `'an agent'` is the last-resort only. The `:59` UNOWNED branch is the existing model for "noun, not hash".

---

### `src/shared/verdict-wording.ts` (NEW — LEG-05 shared wording helper)

**Analog:** `src/shared/reply-reachable.ts` — near-exact precedent. It is a pure, `Terminal['kind']`-keyed, exhaustive-switch-with-`never`-guard helper living in `src/shared/`, imported by BOTH `live-blocker-panel.tsx:33` and `employee-row.tsx:40` (and `blocked-backlog-expander.tsx:22`) with ZERO worker-type leak. Copy its file-header rationale style and switch shape.

**Why `src/shared/` and not `reader/live-blocker-panel.tsx`:** A5 + Open-Question-2 resolution. Confirmed by import audit — `src/shared/reply-reachable.ts` and `src/shared/types.ts` are already imported by all three blocked-surface UIs (Reader, SR row, SR backlog expander). `src/shared/` is the proven cross-surface-safe home; `blockerLine()` currently living inside `live-blocker-panel.tsx:83-113` CANNOT be imported by `employee-row.tsx` without dragging a Reader UI module into the SR. **Relocate the wording into `src/shared/verdict-wording.ts`; have both surfaces import it.** This is the cleaner home A5's "Claude's Discretion" anticipated over reusing the in-Reader `blockerLine()`.

**Precedent excerpt to mirror** (`src/shared/reply-reachable.ts:37,48-76` — verbatim shape):
```typescript
import type { Terminal } from './types.ts';

export function isReplyReachable(terminalKind: Terminal['kind']): boolean {
  switch (terminalKind) {
    case 'AWAITING_HUMAN':         return true;
    case 'AWAITING_AGENT_WORKING': return false;
    case 'AWAITING_AGENT_STUCK':   return false;
    // ... all 8 kinds ...
    default: {
      const _exhaustive: never = terminalKind;
      throw new Error(`isReplyReachable: unhandled terminal kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

**Wording source to lift INTO the new helper** — the existing Reader `blockerLine()` body (`live-blocker-panel.tsx:83-113`) is the already-correct plain-English mapper (8-kind exhaustive, `never` guard). It takes a full `BlockerChainResult` because it interpolates `data.awaitedPartyLabel`. The new helper should expose TWO functions so each surface gets parity wording:
```typescript
// Source: src/ui/surfaces/reader/live-blocker-panel.tsx:83-113 (lift verbatim, generalize input)
case 'AWAITING_AGENT_STUCK': return `${data.awaitedPartyLabel} is stuck`;   // Reader body today
// SR today says: `${chain.leafIssueId ?? 'this issue'} — agent stuck` (employee-row.tsx:482)
```
- A pure `kindHeadline(kind: Terminal['kind']): string` → the plain-English CATEGORY label that REPLACES the Reader's `terminal.kind.replace(/_/g,' ')` leak (LEG-03). e.g. `AWAITING_AGENT_STUCK → "Waiting on an agent"`.
- A `verdictLine(result: BlockerChainResult): string` (or keep `blockerLine`'s exact signature) → the body sentence both surfaces render, so Reader `"X is stuck"` and SR `"agent stuck"` collapse to ONE phrasing. **Pick ONE noun** ("agent stuck" / "is stuck") and use it on both per A5/LEG-05.

---

### `src/ui/surfaces/reader/live-blocker-panel.tsx` (UI render — LEG-03 + LEG-05)

**Analog:** itself; LEG-05 parity target is `employee-row.tsx`.

**THE LEG-03 defect** (line 287 — verbatim, the enum leak):
```tsx
<span className="clarity-blocker-kind">{terminal.kind.replace(/_/g, ' ')}</span>
// → "AWAITING AGENT STUCK"
```
**Fix:** replace `{terminal.kind.replace(/_/g, ' ')}` with `{kindHeadline(terminal.kind)}` from the new `src/shared/verdict-wording.ts`. **Visual-contract note:** confirmed via Grep — there is NO CSS rule for `clarity-blocker-kind` in any `.css` file, so the element is an unstyled inline span. The fix is text-only; no `sketches/` restyle needed (per RESEARCH "check the skill before restyling" — not triggered here).

**Existing correct mapper to relocate, not duplicate** (lines 83-113):
```typescript
function blockerLine(data: BlockerChainResult): string {
  const t = data.terminal;
  switch (t.kind) {
    case 'AWAITING_AGENT_STUCK': return `${data.awaitedPartyLabel} is stuck`;
    // ... 8 kinds, never guard ...
  }
}
```
Move this body into `src/shared/verdict-wording.ts`; import it back here for the `<p className="clarity-blocker-label">{blockerLine(data)}</p>` render at line 295 (unchanged behavior, new import source).

**Imports already present** (lines 32-34 — the shared-import precedent to extend with `verdict-wording.ts`):
```typescript
import type { BlockerChainResult } from '../../../shared/types.ts';
import { isReplyReachable } from '../../../shared/reply-reachable.ts';
import { ReplyInPlace } from '../_shared/reply-in-place.tsx';
```

---

### `src/ui/surfaces/situation-room/employee-row.tsx` (UI render — LEG-05 parity)

**Analog:** itself. Already renders plain English — it is the parity TARGET phrasing, and a CONSUMER of the new shared helper.

**Current plain wording (the phrasing Reader must match)** — verbatim:
```tsx
// :482 (watch tier)
{showAssign ? `${chain.leafIssueId ?? 'this issue'} — agent stuck` : `waiting on ${chain.awaitedPartyLabel}`}
// :379 (needs-you tier)
{showAssign ? `${chain.leafIssueId ?? 'this issue'} has no owner` : `waiting on ${chain.awaitedPartyLabel}`}
```
**LEG-05 action:** route these literal templates through `verdict-wording.ts` so the wording lives in ONE file. Import path mirrors line 40 (`import { isReplyReachable } from '../../../shared/reply-reachable.ts';`). Keep `chain.awaitedPartyLabel` as the already-scrubbed display value (it now reads "the CEO's agent" or "an agent", never a hash, once scrub-human-action lands).

---

### `src/worker/situation/build-employees-rollup.ts` (worker rollup — LEG-04)

**Analog:** itself + its own resolver block (lines 415-430) and `flatten-blocker-chain.ts:189-226`.

**Current focusLine — title only** (lines 344-350, verbatim — LEG-04 target):
```typescript
// h. focusLine — null for idle/stale; else polishTldr(title) truncated ≤80.
let focusLine: string | null = null;
if (state !== 'idle' && state !== 'stale') {
  const rawFocus = focusIssue?.title ?? '';
  const polished = polishTldr(rawFocus);
  focusLine = polished.length > 80 ? `${polished.slice(0, 77)}…` : polished || null;
}
```
**LEG-04 fix:** before the `polishTldr(title)` path, `getTldrByScope(ctx, 'issue', focusIssue.id)`; on a hit use `tldr.body` (truncate ≤80), else fall back to the existing title path. **MUST be degrade-wrapped** (try/catch → title path on throw/miss) per A4 + Pitfall 2; the rollup runs per-agent inside `Promise.all`, cold snapshot is 25.7s (~4s from the 30s cliff). One read per FOCUS issue only — not all open issues.

**The cache read to consume** (`tldr-cache.ts:97-111` — DO NOT modify, read-only reuse):
```typescript
export async function getTldrByScope(ctx, surface, scopeId): Promise<TldrRow | null>
// TldrRow.body (tldr-cache.ts:30) = plain-text summary
```

**Agent-name resolver precedent in THIS file** (lines 415-430, verbatim — the A1 path the Reader stuck-terminal must reuse):
```typescript
const nameByUuid = new Map<string, string | null>();
if (typeof ctx.agents?.get === 'function') {
  await Promise.all([...wanted].map(async (u) => {
    try {
      const ag = (await ctx.agents!.get(u, companyId)) as { name?: unknown } | null;
      const candidate = ag && typeof ag.name === 'string' ? ag.name.trim() : null;
      nameByUuid.set(u, candidate || null);
    } catch { nameByUuid.set(u, null); }   // D-09 degrade-to-null, NEVER the UUID
  }));
}
```

---

### Chat surface (LEG-01 / A3 — humanize CHT-/run· id fragments)

**A3 RESOLVED — exact sites pinned (research could not fully pin; now confirmed by read):**

**1. `CHT-<8>` topic-id chip** — `src/ui/surfaces/chat/topic-strip.tsx`:
```typescript
// :78-83 chtLabel() — the slice-to-hex source (verbatim)
export function chtLabel(topic: ChatTopic): string {
  const id = topic.topicId ?? '';
  if (/^CHT-\d+$/i.test(id)) return id.toUpperCase();
  if (/^\d+$/.test(id)) return `CHT-${id}`;
  return id ? id.slice(0, 8).toUpperCase() : 'CHT-—';   // ← CHT-04FCAC7C leak
}
```
```tsx
// :299-300 the chip render — the human-readable title is ALREADY ADJACENT (verbatim)
<span className="topic-title">{topic.title}</span>
<span className="id">{chtLabel(topic)}</span>
```
**Humanization material is in-hand:** `topic.title` (`ChatTopic.title`, type at topic-strip.tsx:44) is the friendly label, already rendered next to the chip at :299 and used as the hover `title=` at :291. The numeric `CHT-NN` form (when `topicId` is `^CHT-\d+$` or `^\d+$`) is a legitimate human-readable issue identifier and may stay; ONLY the `id.slice(0,8).toUpperCase()` hex-fragment branch (:82) is the leak — swap it for the title (or a friendly fallback), not a hex slug. Also `ChatTopic.originIssueIdentifier` (BEAAA-NNN, :53-59) exists as a server-resolved friendly id where applicable.

**2. `run·<8>` run-id fragment** — `src/ui/surfaces/chat/message-thread.tsx:1116-1124` (verbatim):
```tsx
case 'run_link':
  return (
    <div className="runtime-noise-comment-row">
      <span className="runtime-noise-comment-row-label">{label}</span>
      <span className="clarity-ref-chip" data-clarity-noise-chip="run">
        run · {(row.runId ?? '').slice(0, 8)}        {/* ← run · 04fcac7c leak */}
        {row.title ? ` · ${row.title}` : ''}          {/* ← friendly title already here */}
      </span>
    </div>
  );
```
**Humanization material:** `row.title` is ALREADY interpolated as a suffix. Fix = prefer a friendly run reference (drop the raw 8-hex; use `row.title`, or a label like "latest run" / an ordinal). Compare the sibling `agent_link` case (:1107-1115) which already renders `row.name ?? 'agent'` — a clean noun-fallback model to copy.

**3. Task-created toast `shortId`** — `src/ui/surfaces/chat/index.tsx:759-769` (verbatim):
```typescript
const shortId = result.issueId ? result.issueId.slice(0, 8) : '—';   // ← 8-hex leak in toast text
const employeeName = employee?.name ?? 'employee';
showToast({ message: `↗ Task created — ${shortId}, assigned to ${employeeName}.`, duration: 6000 });
```
**Fix:** the comment at :759-763 already notes the proper `BEAAA-NNN` identifier isn't threaded through the `createTrueTask` success payload yet. Either drop the `shortId` fragment from the toast copy (assignee name carries the meaning) or thread a friendly identifier. `employee?.name ?? 'employee'` at :765 is the existing noun-fallback model.

**Plan note:** these 3 sites bypass `scrubHumanAction` entirely (they're issue/run/topic ids, not agent-verdict labels) — A3 requires a DEDICATED chat task; the scrub-layer fix does NOT reach them.

---

## Shared Patterns

### Agent UUID → human-name resolution (A1 — the common-case path the Reader must reuse)
**Source:** identical 3-producer pattern —
`src/worker/handlers/flatten-blocker-chain.ts:189-226`, `src/worker/situation/build-employees-rollup.ts:415-430`, `org-blocked-backlog.ts:462-503`.
**Apply to:** the Reader stuck-terminal (so `agent#04fcac7c` resolves to "the CEO's agent") and as the input to `scrub-human-action.ts`'s fallback.
```typescript
const agent = await ctx.agents.get(uuid, companyId);  // { name?: string } | null
const name = (agent && typeof agent.name === 'string') ? agent.name.trim() || null : null;
// catch → null (D-09 degrade); NEVER the UUID. scrub then emits the noun 'an agent'.
```
The Reader path already calls this via `scrubResultLabel`→`flatten-blocker-chain.ts:189-226`; the A1 work is ensuring the `nameByUuid` map is POPULATED for the stuck agentId (it is — :197-202 adds `terminal.agentId` for `AWAITING_AGENT_STUCK`), so the live `agent#04fcac7c` is a name-LOOKUP miss, not a wiring gap → the fallback noun fix (`'an agent'`) is what makes the unresolved case legible.

### Plain-English wording (LEG-05)
**Source (new):** `src/shared/verdict-wording.ts` (lifted from `live-blocker-panel.tsx:83-113`).
**Apply to:** `live-blocker-panel.tsx` (headline :287 + body :295) AND `employee-row.tsx` (:379,:482).
**Pattern home precedent:** `src/shared/reply-reachable.ts` (cross-imported by both surfaces today).

### NO_UUID_LEAK guard tests (LEG-02 — invert + extend)
**Inversion targets (currently BLESS `agent#<8>`):**
- `test/shared/scrub-human-action.test.mjs:94` `assert.match(stuck, /agent#eeeeeeee/)`, `:123` `/agent#dddddddd/`, `:144` `/agent#12345678/` → flip to `assert.doesNotMatch(..., PARTIAL_HEX_RE)` + assert the noun.
- `test/worker/handlers/flatten-blocker-chain-scrub.test.mjs:121` `assert.ok(scrubbed.awaitedPartyLabel.includes('agent#'))` → flip to NOT include `agent#`.
**Extension targets (full-UUID scan → add partial-hash):** `test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs`, `.../pulse-header-no-uuid-leak.test.mjs`, `test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs`.
**Render-scan analog to copy** (`employee-row-no-uuid-leak.test.mjs:29-43`): source-grep + `stripComments` + `UUID_RE` — add an anchored `PARTIAL_HEX_RE` scan alongside. (No jsdom in devDeps — these are source-grep + string-render guards.)
**New named LEG-02 regression test:** assert `agent#<8>` AND bare UUIDs FAIL the guard (the inversion of today's contract).

## No Analog Found

None. Every Phase 16 target maps to an existing file/line or an exact in-repo pattern. The single new file (`verdict-wording.ts`) has a direct precedent (`reply-reachable.ts`).

## Persisted-string note (A4 / Open Question 3)

No code analog — a one-line operational check during the drill: `SELECT ... FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache WHERE body LIKE '%agent#%'` (and bulletin bodies) on BEAAA. Likely empty (the live leak was the fresh-render blocker panel, not the cache). If non-empty, re-scrub-on-read per A4 (NO non-additive migration). `tldr-cache.ts` is read-only here.

## Metadata

**Analog search scope:** `src/shared/`, `src/ui/surfaces/{reader,situation-room,chat}/`, `src/worker/{handlers,situation,db}/`, `test/{shared,worker,ui}/`
**Files scanned:** ~18 reads (all targeted/non-overlapping)
**Pattern extraction date:** 2026-06-03
