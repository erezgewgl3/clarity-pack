# Overnight Reader-Crash Fix — Report

**Status:** SHIPPED
**Cycles spent:** 9 (out of 10 cap)
**Time elapsed:** ~1.5h
**Commit:** `92d855d` on `origin/master`
**Tarball:** `clarity-pack-1.0.0.tgz` (699.7 kB)
**Tarball sha256:** `bc80945625fd6d60b90bc317475df042e9cc7820d9f4c23210584ae4976866f2`

## Diagnosis

Two compounding defects produced the widespread "Clarity Pack: failed to
render" pill on BEAAA AriClaw across BEAAA-828, BEAAA-142, BEAAA-141,
BEAAA-125, BEAAA-138, BEAAA-682, and BEAAA-79.

**(1) ROOT CAUSE — `b64encode` threw on non-Latin1 Unicode.**
`src/ui/surfaces/chat/deep-link.mjs::b64encode` called raw `btoa(s)` on
the JSON payload built from `chat.openForIssue`'s `seedTitle` /
`seedBody`. Per the WHATWG spec, `btoa` throws `InvalidCharacterError`
on any character outside Latin-1 (0x00–0xFF). BEAAA operator-typed
issue titles routinely contain em-dashes (—, U+2014), smart quotes
(“ ” ‘ ’), en-dashes, accented characters, CJK, and emoji — all
outside Latin-1. The worker handler ships the verbatim issue title
into `seedTitle: title` and `seedBody: \`Continuing from ${id}: ${title}\``
(`src/worker/handlers/chat-open-for-issue.ts:413-414`), so any
non-Latin1 character in the title appeared at least twice in the
encoder input.

The throw landed synchronously inside `ContinueInChatButton`'s render
path — `usePluginData → buildChatNav → buildChatDeepLink → appendHash →
b64encode → btoa` — and propagated up through React's render phase
into the HOST's `PluginSlotErrorBoundary` (the
`rounded-md border border-destructive/30 …` shadcn pill). The host
boundary replaces the entire surface with the pill, so a single
sub-component throwing wiped the whole Reader tab — explaining why
"every section" appeared blank even though sub-components like the
Breadcrumb / TLDR / AnchoredToCards were defensively guarded.

The post-overnight `test/ui/deep-link-utf8.test.mjs` includes a literal
RED proof — `assert.throws(() => btoa(emDashPayload))` succeeds (raw
btoa does throw the documented `InvalidCharacterError`).

**(2) WIDE BLAST RADIUS — no internal containment between sections.**
Before this overnight, the Reader's populated render mounted every
sub-component as a sibling of `<ClaritySurfaceRoot>`. A render-time
throw inside ANY sibling propagated up to the host boundary, wiping
the entire tab. The brief identified the wide blast radius as the
operator-visible symptom — the actual data-shape pathology was
secondary to the wide containment failure.

## Fix

Two atomic, mutually reinforcing changes in commit `92d855d`:

| File | Change |
|---|---|
| `src/ui/surfaces/chat/deep-link.mjs` | `b64encode` rewritten to use the canonical UTF-8-via-binary-string pattern (`TextEncoder` → bytes → binary string → `btoa`). `b64decode` symmetrized via `atob` → bytes → `TextDecoder`. Both wrapped in try/catch returning `''` so an unexpected encoding failure degrades to "not navigable" instead of throwing. **Round-trip is bit-exact for any Unicode input** — verified against em-dash, smart quotes, en-dash, apostrophe, emoji, latin extended, CJK, and mixed payloads. |
| `src/ui/primitives/error-boundary.tsx` *(new)* | `SectionErrorBoundary` React class component using `getDerivedStateFromError` + `componentDidCatch` (the only React-built-in mechanism that catches render throws). Renders the locked fallback caption `Section unavailable` with a scoped CSS class `clarity-error-boundary` + a `data-clarity-section` attribute for operator devtools forensics. `componentDidCatch` surfaces the stack trace via `console.error("clarity-pack: section <name> threw at render", …)` so post-deploy diagnosis on BEAAA yields a real stack instead of vanishing into the host boundary's pill. `resetKey` prop clears error state on next render — Reader passes `entityId` so navigation to a different issue recovers automatically. |
| `src/ui/surfaces/reader/index.tsx` | Wrapped every Reader sub-component in its own `<SectionErrorBoundary>` — surface-header, agent-pause-banner, continue-in-chat, reverse-topics, breadcrumb, tldr, prose, anchored-to, deliverable, ac-checklist, activity, live-blocker, pause-banner. A future render throw inside any single section now degrades to "Section unavailable" while every other section renders normally. |
| `src/ui/primitives/theme.css` | Added the scoped `[data-clarity-surface] .clarity-error-boundary` selector for fallback styling (muted ink, dashed border, inline padding). Stays scoped per the CSS-scope guard. |

## Regression test

Two new test files in commit `92d855d`:

**`test/ui/deep-link-utf8.test.mjs`** — 13 runnable tests against the
real `buildChatDeepLink` + `parseChatDeepLink` helpers. Pre-fix shape
(`return btoa(s)`) is asserted-removed and the explicit RED-proof
(`assert.throws(() => btoa(emDashPayload))`) demonstrates that raw
btoa still crashes on the same inputs that took the Reader down.
Post-fix shape (`TextEncoder` path) round-trips em-dash, smart
quotes, en-dash, apostrophe, emoji, accented Latin, CJK, and mixed
payloads byte-for-byte.

**`test/ui/surfaces/reader/reader-yaml-body-render.test.mjs`** — 20
source-grep tests pinning (a) the boundary primitive shape, (b) the
per-section wrap on every Reader sub-component with the correct
`name` literal, (c) `resetKey={entityId}` plumbing on every wrap, (d)
the scoped CSS selector. Source-grep matches the existing Clarity
Pack UI-test convention (per
`test/ui/surfaces/situation-room/artifact-chip-row.test.mjs`: "the
Clarity Pack repo has NO jsdom in devDependencies, NO TSX test
transform, NO test-renderer; adding any of those is an out-of-scope
new-runtime-dep change").

Before-fix RED / after-fix GREEN verified locally:
- `node --test test/ui/deep-link-utf8.test.mjs` → 13/13 pass
- `node --test test/ui/surfaces/reader/reader-yaml-body-render.test.mjs` → 20/20 pass

## Quality gate results

- **tsc**: clean (`npx tsc --noEmit` → exit 0)
- **suite**: 1951 pass / 1 fail / 2 skip — the one failure is the
  pre-existing fixture failure at
  `test/worker/handlers/situation-artifacts.test.mjs:392` explicitly
  excluded by the overnight brief.
- **css-scope**: 140 selectors all scoped under `[data-clarity-surface]`
  (was 139; +1 for the new `.clarity-error-boundary` selector)
- **ui-bundle-size**: 695,372 bytes / 696,320 byte ceiling — OK
  (948 byte headroom)
- **tarball**: `clarity-pack-1.0.0.tgz` (699.7 kB) sha256
  `bc80945625fd6d60b90bc317475df042e9cc7820d9f4c23210584ae4976866f2`

## Commits pushed

- `92d855d` `fix(reader): UTF-8-safe deep-link b64 + per-section ErrorBoundary`

## Deploy plan for the operator

The fix is on `origin/master` at `92d855d` and the rebuilt local
`clarity-pack-1.0.0.tgz` carries it. No version bump — v1.0.0 stays
shipped. To deploy to BEAAA AriClaw via the DO Web Console (same
shape as the session-end Path B):

```bash
# 1. Snapshot first — bookended-by-snapshots rule.
cd ~/paperclip && node scripts/safety/cli.mjs snapshot \
  --db-url=$(sudo grep DATABASE_URL /etc/paperclip/db.env | cut -d= -f2-) \
  --label=pre-overnight-reader-fix-$(date +%Y%m%d-%H%M%S)

# 2. Pull the new tarball from GitHub Releases or scp into ~/clarity-pack/
#    (use whichever channel is established for your install path).
#    Verify sha256:
#      sha256sum clarity-pack-1.0.0.tgz
#      expected: bc80945625fd6d60b90bc317475df042e9cc7820d9f4c23210584ae4976866f2

# 3. Install (no version bump — overwrites the existing v1.0.0 install).
cd ~/paperclip && pnpm paperclipai plugin install ./clarity-pack-1.0.0.tgz

# 4. Verify via the safety CLI's verify check (catches manifest + capability drift).
cd ~/clarity-pack && node scripts/safety/cli.mjs verify \
  --db-url=$(sudo grep DATABASE_URL /etc/paperclip/db.env | cut -d= -f2-) \
  --api-key=$TOKEN \
  --api-url=http://localhost:3100

# 5. Smoke-test on BEAAA-828 — load the Reader tab. Expected:
#    - Reader renders fully (no "Clarity Pack: failed to render" pill)
#    - Continue-in-chat button mounts cleanly even with em-dash titles
#    - If any section legitimately throws on a corrupt payload, it
#      degrades to "Section unavailable" instead of wiping the tab
```

**Rollback path (if anything goes wrong):**
```bash
cd ~/paperclip && node scripts/safety/cli.mjs restore \
  --db-url=$(sudo grep DATABASE_URL /etc/paperclip/db.env | cut -d= -f2-) \
  --label=pre-overnight-reader-fix-<timestamp>
```

## Outstanding / known follow-ups

**Editor-Agent TL;DR compile pipeline silence (SECONDARY task).**
Investigated for one cycle (cycle 9). The heartbeat dispatcher IS
wired correctly:

- `src/worker.ts:395-427` subscribes to `issue.created` /
  `issue.updated` / `issue.comment.created` and calls
  `handleEditorHeartbeat` on each event.
- `src/worker/agents/editor.ts::handleEditorHeartbeat` builds a
  `deliveryLlmAdapter` per issue and calls `compileTldr` with it.
- `deliveryLlmAdapter` is the operation-issue task-delivery layer
  (`src/worker/agents/agent-task-delivery.ts`) — it creates an
  operation issue assigned to the Editor-Agent, then polls
  `ctx.issues.documents.get(operationIssueId, 'compile-result',
  companyId)` for the agent's result. **This path does NOT use
  `ctx.http.fetch`**, so the BEAAA `http.outbound` capability /
  SSRF block is not the cause here.

The most plausible remaining hypothesis is the brief's #1: **the
Editor-Agent has no LLM adapter configured on BEAAA AriClaw at the
Paperclip admin-panel level**. The plugin install registers the
agent definition (`reconcileEditorAgent` calls
`ctx.agents.managed.reconcile`), but the LLM provider (claude_local
/ process / etc.) is operator-configured on the Paperclip side. Without
it, the agent's heartbeat fires but the operation-issue compile
prompt never resolves to a document, the readback poll times out,
and `handleEditorHeartbeat`'s per-issue catch logs at `info`
("Editor-Agent: skipped TL;DR compile for issue") — visible in the
worker log but does not surface to the Reader UI, which stays in
the "Compiling TL;DR…" placeholder forever.

**Operator action required:** in the Paperclip admin panel on BEAAA
AriClaw, verify the Editor-Agent has an LLM adapter configured
(claude_local with a working API key OR codex_local OR process).
If it does, the next issue.created / issue.updated event should
fire a compile cycle that lands a TL;DR row within ~5–60 seconds.
If the operator confirms an LLM adapter IS configured and the
compile still doesn't fire, the next investigation should look at
the operation-issue creation step in
`src/worker/agents/agent-task-delivery.ts::deliverAgentTask` for
host-side rejection of the `assigneeAgentId` / `originKind` shape.

**Hard rule (per brief):** the Editor-Agent manifest declaration
(the `agents[]` field in `src/manifest.ts`) is NOT modified by this
overnight session — it has passed multiple drills; do not regress it.

**Bulletin route empty state.** The brief notes the
`/<companyPrefix>/bulletin` route may show no content even past the
06:30 ET cron time. Not investigated this overnight — the bulletin
cycle has the same upstream dependency on the Editor-Agent LLM
adapter, so the resolution path is identical to the TL;DR case
above. If the LLM adapter is configured but bulletins still fail
to publish, the per-cycle diagnostic lives in
`src/worker/jobs/compile-bulletin.ts`.

**UI artifact (cosmetic).** Reader ref-chips will continue to show
`<KEY> · unknown` (status=unknown, title=key) until the
`resolve-refs` SSRF block on BEAAA is properly worked around via
the architectural refactor to parallel `ctx.issues.get` calls (the
brief's deferred-to-planned-session item). The current defensive
degradation in `src/worker/handlers/resolve-refs.ts` is load-bearing
and was NOT removed.

## Lessons / surprises

Worth filing to MemPalace `clarity_pack/runbook`:

- **The host's `PluginSlotErrorBoundary` is a wide hammer.** ONE
  Clarity-side render throw blanks the entire surface. Per-section
  `SectionErrorBoundary` wrapping is now the convention — when adding
  a new section to ANY clarity-pack surface, wrap it in a
  `<SectionErrorBoundary name="<kebab>">` so future render-time
  pathology stays contained. The reader-yaml-body-render source-grep
  test enforces this for the Reader's existing sections.

- **`btoa` is not UTF-8 safe.** The WHATWG `btoa` / `atob` operate on
  binary strings (one char per byte). Any client-side code that
  base64-encodes operator-typed strings must use the
  `TextEncoder → bytes → binary string → btoa` pattern. The pre-fix
  shape (`btoa(s)`) is a latent crash for any input containing
  characters above U+00FF. Worth a one-time audit pass on other
  client-side base64 usage in the clarity-pack codebase.

- **JSDOM + TSX rendering are explicit non-goals.** The existing
  `test/ui/surfaces/situation-room/artifact-chip-row.test.mjs`
  comment is the canonical reference — adding either is a new-runtime
  -dep change requiring its own plan. The overnight session adapted
  to the constraint by combining a source-grep (the convention) with
  a pure-JS runnable test (against the helper's behaviour, not its
  rendered output). RED-before-fix proof lives in the runnable file;
  GREEN-after-fix verification lives in both.

- **Brief filename guesses can drift from reality.** The brief named
  `anchored-to.tsx` / `reader-view.tsx` / `recent-activity.tsx` as
  suspects; the actual files are `ref-card.tsx` / `index.tsx` /
  `activity-timeline.tsx`. Always survey the directory before
  hunting in the brief's named files.
