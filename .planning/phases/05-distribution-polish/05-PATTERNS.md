# Phase 5: Distribution & Polish — Pattern Map

**Mapped:** 2026-05-25
**Plans covered:** 05-04, 05-05, 05-06, 05-07, 05-08, 05-09, 05-10
**Plans skipped (CODE-COMPLETE per D-26):** 05-01, 05-02, 05-03
**Files classified:** ~28 new + ~18 modified
**Analogs found:** 28 / 28 (100% — established codebase; every plan has a close analog)

## Trust-model invariants every plan inherits

- **Worker data handlers:** wrap via `wrapDataHandler` from `src/worker/opt-in-guard.ts`. Missing required string params → `{ error: '<KEY>_REQUIRED' }` (never throw). Reference: `src/worker/handlers/chat-open-for-issue.ts` lines 123-138.
- **Worker action handlers:** wrap via `wrapActionHandler`. Missing required string param → `throw new Error('<key> required')`. Wrong-typed boolean → throw. Reference: `src/worker/handlers/chat-topic-archive.ts` lines 37-57.
- **Repo failure recovery:** action handlers catch + return `{ error: '<NAME>_FAILED' }` + `ctx.logger?.warn?.(...)`. Reference: `src/worker/handlers/chat-pin.ts` lines 64-81.
- **UI same-origin trust:** every clickable target uses `useHostNavigation().linkProps(...)` or `nav.navigate(...)`, NEVER raw `<a href>` (SCAF-09 + ESLint `no-raw-anchor`). Reference: `src/ui/primitives/ref-chip.tsx` lines 70-78.
- **No `dangerouslySetInnerHTML`:** every operator-controlled string renders as React text. `react-markdown` (D-03) preserves this; check-a11y R3 stays green.
- **CTT-07 invariant (Plan 04.1-07):** plugin actions NEVER mutate `public.issues.updated_at`. The host issue is read-only from plugin worker code. Pattern: `chat.topic.archive` flips a plugin-side flag only. Reference: `src/worker/handlers/chat-topic-archive.ts` lines 5-18.
- **CSS scope:** every selector is rooted at `[data-clarity-surface="<name>"]`. Reference: `src/ui/primitives/clarity-surface-root.tsx` lines 25-33.
- **Migrations:** plugin-namespace only (`plugin_clarity_pack_cdd6bda4bd.*`), additive (`ADD COLUMN IF NOT EXISTS`), no standalone `CREATE INDEX`, no anonymous `DO` blocks, apostrophe-free comments, file ends on a semicolon-terminated statement. Reference: `migrations/0009_chat_topics_origin_issue.sql` lines 17-34.

---

## File Classification Tables (per plan)

### Plan 05-04 — Full-fidelity previewers + Visual-regression baseline

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `src/worker/handlers/deliverable-preview.ts` | NEW | worker data handler | request-response | `src/worker/handlers/chat-active-tasks.ts` | exact |
| `src/ui/primitives/deliverable-preview.tsx` (or refactor of `src/ui/surfaces/reader/deliverable-preview.tsx`) | NEW or MAJOR-MOD | UI primitive | dispatch-on-kind | `src/ui/surfaces/reader/deliverable-preview.tsx` (current placeholder) | exact (same file) |
| `src/ui/surfaces/reader/index.tsx` (~line 330) | MOD | surface composition | render | (self) | self |
| `test/visual/sketch-regression.test.mjs` | NEW | test | image-snapshot loop | `scripts/build-ui.mjs` (esbuild-only — no test analog exists) | role-only |
| `test/visual/baselines/*.png` | NEW | binary test asset | n/a | (no analog) | n/a |
| `.github/workflows/visual-regression.yml` | NEW | CI workflow | event-driven | `.github/workflows/a11y-check.yml` | exact |
| `package.json` (devDeps + deps) | MOD | config | n/a | (self) | self |

### Plan 05-05 — Zero-rabbit-holes finishers

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `src/ui/primitives/agent-pause-banner.tsx` | NEW | UI primitive | data-consume | `src/ui/surfaces/reader/pause-banner.tsx` (KEEP unchanged) | exact |
| `src/worker/handlers/editor-pause-status.ts` | MOD | worker data handler | request-response | (self — extend return shape to discriminated union) | self |
| `src/ui/primitives/ref-chip.tsx` | MOD | UI primitive | request-response + hover | (self — add hover peek) | self |
| `src/worker/handlers/resolve-refs.ts` | MOD | worker data handler | request-response | (self — add `description_excerpt`) | self |
| `src/ui/surfaces/chat/deep-link.mjs` | MOD | utility | data-encode | (self — add optional `employeeUserId` param) | self |
| `src/ui/surfaces/chat/deep-link.d.mts` | MOD | type declaration | n/a | (self — mirror the .mjs change) | self |
| `src/ui/surfaces/reader/continue-in-chat-button.tsx` (caller audit) | MOD | UI primitive | navigation | (self) | self |
| `src/ui/surfaces/reader/reverse-topics-link.tsx` (caller audit) | MOD | UI primitive | navigation | (self) | self |

### Plan 05-06 — Phase 4.1 surface polish bundle

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `src/worker/handlers/chat-pin.ts` (Pin/Unpin toggle) | MOD | worker action handler | CRUD toggle | `src/worker/handlers/chat-topic-archive.ts` | exact |
| `src/ui/surfaces/chat/message-thread.tsx` (Pin/Unpin UI; pinned-chip click) | MOD | UI surface | CRUD + scroll | `src/ui/surfaces/chat/topic-strip.tsx` (about-chip dismiss pattern) | role-match |
| `src/ui/styles/chat.css` (LIVE indicator sticky + toast `--you` stripe) | MOD | styles | n/a | (self) | self |
| `src/ui/primitives/toast.tsx` (left-edge stripe + ↗ icon prefix) | MOD | UI primitive | event-driven | (self) | self |
| `src/ui/surfaces/chat/true-task/inline-task-card.tsx` (optimistic `status: 'todo'`) | MOD | UI primitive | optimistic render | (self) | self |
| `test/ui/chat-css-live-sticky.test.mjs` | NEW | test | computed-style | `test/ui/chat-url-params.test.mjs` | role-only |

### Plan 05-07 — Phase 4.2 polish bundle

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `src/ui/surfaces/chat/index.tsx` (remove `nav.replace` on consume) | MOD | UI surface composition | navigation | (self lines 290-400) | self |
| `src/worker/handlers/chat-open-for-issue.ts` (thread `topicIdentifier?` for D8 tooltip) | MOD | worker data handler | request-response | (self) | self |
| `src/ui/surfaces/reader/continue-in-chat-button.tsx` (consume `topicIdentifier`) | MOD | UI primitive | navigation | (self lines 256-269) | self |
| `src/ui/surfaces/chat/topic-strip.tsx` (RCB-05 chip CSS box-model) | MOD | UI primitive | n/a | (self) | self |
| `src/ui/styles/chat.css` (chip-styling D-RCB-05) | MOD | styles | n/a | (self) | self |
| `src/ui/surfaces/chat/context-rail.tsx` + 4 others (React-key fixes) | MOD | UI components | render | `src/ui/surfaces/chat/topic-strip.tsx` lines 261-302 (stable key pattern) | exact |
| `test/visual/sketch-regression-d3-fixture.mjs` (D-03 cross-employee fall-through) | NEW | test fixture | static | (no analog yet) | n/a |

### Plan 05-08 — Phase 4.1 power features

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `src/ui/surfaces/archive/index.tsx` (new route `/<companyPrefix>/clarity-pack/archive`) | NEW | UI page surface | CRUD list | `src/ui/surfaces/bulletin/index.tsx` (page-slot composition) | role-match |
| `src/manifest.ts` (new page-slot for `archive` routePath) | MOD | manifest config | n/a | (self lines 450-469) | self |
| `src/worker/handlers/chat-archived-topics.ts` (bulk-unarchive support) | MOD | worker handler | CRUD | `src/worker/handlers/chat-topic-archive.ts` | exact |
| `src/ui/primitives/clarity-surface-header.tsx` (new shared header — cold-task button on 4 surfaces) | NEW | UI primitive | event-driven | `src/ui/surfaces/chat/actions-row.tsx` | role-match |
| `src/ui/surfaces/reader/index.tsx` + `situation-room/index.tsx` + `bulletin/index.tsx` + `chat/index.tsx` (mount header) | MOD | surfaces | n/a | (self files) | self |
| `src/ui/surfaces/chat/diagnostics-toggle.tsx` (per-topic localStorage) | MOD | UI primitive | persisted-state | `src/ui/surfaces/chat/topic-strip.tsx` lines 199-225 (localStorage dismiss pattern) | exact |
| `src/ui/surfaces/chat/composer.tsx` (`?` keypress in textarea → shortcuts popover) | MOD | UI primitive | event-driven | `src/ui/surfaces/chat/actions-row.tsx` lines 49-72 (single-key handler + editable guards) | exact |
| `src/ui/surfaces/chat/shortcuts-popover.tsx` | NEW | UI primitive | event-driven | `src/ui/surfaces/reader/reverse-topics-link.tsx` (popover pattern) | role-match |
| `src/worker/handlers/chat-topic-pin.ts` (storage-pin toggle) | NEW | worker action handler | CRUD toggle | `src/worker/handlers/chat-topic-archive.ts` | exact |
| `migrations/0010_chat_topics_pinned.sql` | NEW | migration | DDL | `migrations/0009_chat_topics_origin_issue.sql` | exact |
| `src/worker/db/chat-topics-repo.ts` (add `setChatTopicPinned`) | MOD | repo helper | CRUD | (self — `setChatTopicArchived` pattern) | self |
| `src/ui/surfaces/chat/context-rail.tsx` (wire storage-pin card to handler) | MOD | UI component | event-driven | (self — wire to new action like `archive`) | self |

### Plan 05-09 — Tooling + infra cleanup

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `runbook/operator-gotchas.md` (VPS git pull step) | MOD | docs | n/a | (self — `§paperclip-restoring-db-precreate` section pattern) | self |
| `CLAUDE.md` (correct plugin-route documentation) | MOD | docs | n/a | (self) | self |
| `test/fixtures/external/fake-paperclip-clone/` (relocation target) | NEW dir | test fixture | n/a | (current `scripts/safety/test/fixtures/fake-paperclip-clone/`) | self |
| `.gitattributes` (export-ignore entry) | MOD | config | n/a | (no analog) | n/a |

### Plan 05-10 — v1.0.0 final closure

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `package.json` (version `1.0.0-rc.N` → `1.0.0`) | MOD | config | n/a | (self) | self |
| `src/manifest.ts` (`version` literal) | MOD | config | n/a | (self line 337) | self |
| `.planning/phases/05-distribution-polish/05-VERIFICATION.md` | NEW | docs | n/a | `.planning/phases/04.2-reader-chat-bridge/04.2-VERIFICATION.md` | role-match |
| `.planning/REQUIREMENTS.md` (final flips) | MOD | docs | n/a | (self) | self |
| `.planning/ROADMAP.md` (Phase 5 close) | MOD | docs | n/a | (self) | self |

---

## Pattern Assignments

### Plan 05-04 — Full-fidelity previewers + Visual-regression baseline

#### `src/worker/handlers/deliverable-preview.ts` (NEW worker data handler, request-response)

**Analog:** `src/worker/handlers/chat-active-tasks.ts` (data handler + ctx.issues.get enrichment, bounded RPC fan-out, per-row failure skip)

**Imports + Ctx-composition pattern** (`chat-active-tasks.ts` lines 33-44):
```typescript
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  listChatTopicTasksForTopic,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';

export type ChatActiveTasksCtx = OptInGuardDataCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };
```
For Plan 05-04: compose `DeliverablePreviewCtx = OptInGuardDataCtx & { issues: PluginIssuesClient; logger?: PluginLogger }`. SheetJS (`xlsx`) is imported at module top with a defensive try/catch comment — worker-side only, NEVER from UI files.

**Data-handler param validation pattern** (`chat-open-for-issue.ts` lines 123-138):
```typescript
wrapDataHandler(ctx, 'chat.openForIssue', async (params) => {
  const companyId =
    typeof params?.companyId === 'string' && params.companyId
      ? params.companyId
      : null;
  // ... more guards ...
  if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
  if (!userId) return { error: 'USER_ID_REQUIRED' as const };
  if (!issueId) return { error: 'ISSUE_ID_REQUIRED' as const };
```
For Plan 05-04: validate `{ companyId, userId, issueId, documentKey }`. Required → structured error.

**File-size guard chokepoint pattern** (worker-side budget, mirrors `resolve-refs.ts` line 30 `EXCERPT_MAX = 280` central constant):
```typescript
// New constant in deliverable-preview.ts:
const XLSX_MAX_BYTES = 5_000_000; // 5MB — bounded budget
// Reject ABOVE the limit with { error: 'DELIVERABLE_TOO_LARGE', sizeBytes }
```

**Return-shape discriminator pattern** (mirror `ChatOpenForIssueResult` in `chat-open-for-issue.ts` lines 71-101):
```typescript
export type DeliverablePreviewResult =
  | { kind: 'xlsx-grid'; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: 'pdf-embed'; url: string }
  | { kind: 'md'; body: string }
  | { kind: 'img'; url: string }
  | { kind: 'placeholder'; reason: string }
  | { error: string };
```

---

#### `src/ui/surfaces/reader/deliverable-preview.tsx` (REWRITE — replace placeholder)

**Analog:** itself at current shape (lines 1-47). Same export name; same prop shape extended.

**Required commit:** the literal "Phase 5 (DIST-04)" string at line 43 is locked by `test/ui/reader-view.test.mjs`. Updating the placeholder MUST update the test in the same commit (D-24).

**Dispatch-on-kind pattern** (mirror `ChatTopic` consumer in `topic-strip.tsx` line 193: `const aboutIssueId = activeTopic && ... ? identifier : null;`):
```typescript
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';
import ReactMarkdown from 'react-markdown';

export function DeliverablePreview({ deliverable, issueId, companyId, userId }: Props): React.ReactElement | null {
  if (!deliverable) return null;
  const { data, loading } = usePluginData<DeliverablePreviewResult>(
    'deliverable.preview',
    { companyId, userId, issueId, documentKey: deliverable.filename },
  );
  if (loading || !data) return <section>… loading preview …</section>;
  if ('error' in data) return <section><p>Preview unavailable — open in classic Paperclip.</p></section>;

  switch (data.kind) {
    case 'xlsx-grid':   return <XlsxGrid sheets={data.sheets} />;
    case 'pdf-embed':   return <embed type="application/pdf" src={data.url} />;
    case 'md':          return <ReactMarkdown>{data.body}</ReactMarkdown>;
    case 'img':         return <img src={data.url} alt={deliverable.filename} />;
    case 'placeholder': return <section><p>{data.reason}</p></section>;
  }
}
```

`<img>` MUST carry `alt=` (check-a11y R1 — `.github/workflows/a11y-check.yml` line 6).

---

#### `.github/workflows/visual-regression.yml` (NEW CI workflow)

**Analog:** `.github/workflows/a11y-check.yml` lines 1-32 (exact shape; copy and adapt)

**Trigger + Node-setup pattern** (verbatim lines 13-29):
```yaml
on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install Playwright deps
        run: npx playwright install --with-deps chromium
      - name: Visual-regression
        run: node --test test/visual/sketch-regression.test.mjs
      - name: Upload diffs on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: visual-regression-diffs
          path: test/visual/diffs/
```

---

### Plan 05-05 — Zero-rabbit-holes finishers

#### `src/ui/primitives/agent-pause-banner.tsx` (NEW UI primitive, generic — mounted on BOTH Reader top-of-tab AND chat header)

**Analog:** `src/ui/surfaces/reader/pause-banner.tsx` (KEEP UNCHANGED — its literal "Editorial Desk paused — last compile failed at" is locked by reader-view.test.mjs; D-06 + canonical_refs).

**Imports + resolver-sourced userId pattern** (verbatim `pause-banner.tsx` lines 19-22):
```typescript
import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
```

**Discriminated-cause render switch** (NEW pattern for D-07 — three distinct copies):
```typescript
type PauseStatus =
  | { paused: true; cause: 'operator'; agentName: string }
  | { paused: true; cause: 'budget'; agentName: string }
  | { paused: true; cause: 'adapter'; agentName: string; detail: string }
  | { paused: false };

export function AgentPauseBanner({ agentId }: { agentId: string }): React.ReactElement | null {
  const { userId, loading } = useResolvedUserId();
  const { data } = usePluginData<PauseStatus | { error: string }>(
    'editor.pause-status', // or new generic 'agent.pause-status'
    !loading && userId ? { userId, agentId } : {},
  );
  if (loading || !data || 'error' in data || !data.paused) return null;
  const copy =
    data.cause === 'operator' ? `${data.agentName} paused by operator — ▶ Resume heartbeat`
    : data.cause === 'budget' ? `${data.agentName} stopped — budget exhausted; check budget caps — ▶ Resume heartbeat`
    : `${data.agentName} stopped — codex adapter error ${data.detail}; ▶ Retry heartbeat`;
  return (
    <div className="clarity-agent-pause-banner" role="status" data-clarity-region="agent-pause-banner">
      {copy}
    </div>
  );
}
```

Banner style follows the inline-resume-row pattern from Plan 04.1-10 (see `manifest.ts` lines 66-78 — Resume Heartbeat inline toggle pattern), NOT the editor-only footer pattern.

---

#### `src/worker/handlers/editor-pause-status.ts` MOD — return discriminated union for D-07

**Self-edit.** Extend `EditorPauseStatus` type (current lines 17-21):
```typescript
// Current:
export type EditorPauseStatus = {
  paused: boolean;
  lastFailureAt: string | null;
  reason: string | null;
};

// Target:
export type EditorPauseStatus =
  | { paused: false }
  | { paused: true; cause: 'operator'; agentName: string }
  | { paused: true; cause: 'budget'; agentName: string }
  | { paused: true; cause: 'adapter'; agentName: string; detail: string };
```

Cause derivation lives in the handler (lines 28-51); read from `editor_agent_failures.reason` text + an agent-paused/budget signal from `ctx.agents.get(agentId, companyId)`.

---

#### `src/ui/primitives/ref-chip.tsx` MOD — hover peek card (D-08)

**Self-edit + popover pattern from `reverse-topics-link.tsx`** lines 116-167 (the open/close state + portal/inline popover pattern):

```typescript
// Add to RefChip (after line 78):
const [peekOpen, setPeekOpen] = React.useState(false);
// ... wrap the existing anchor in:
return (
  <span
    onMouseEnter={() => setPeekOpen(true)}
    onMouseLeave={() => setPeekOpen(false)}
    style={{ position: 'relative' }}
  >
    <a {...nav.linkProps(`/${companyPrefix}/issues/${card.id}`)}
       className="clarity-ref-chip" data-status={card.status}>
      {card.id} · {card.status}
    </a>
    {peekOpen ? (
      <div className="clarity-ref-chip-peek" role="tooltip" data-clarity-region="ref-chip-peek">
        <div className="title">{card.title}</div>
        <div className="meta">{card.status} · {card.ownerName ?? 'unassigned'}</div>
        {card.excerpt ? <div className="excerpt">{card.excerpt}</div> : null}
      </div>
    ) : null}
  </span>
);
```

Click navigation (lines 70-78) UNCHANGED — preserves D-08 "click still navigates to `/<companyPrefix>/issues/<identifier>`".

Mobile long-press fallback: add `onTouchStart` with a 500ms timeout → setPeekOpen(true); operator can long-press to peek then tap-outside to dismiss.

---

#### `src/worker/handlers/resolve-refs.ts` MOD — add `description_excerpt` (D-09)

**Self-edit.** Resolve assignee display name server-side (mirror `chat-open-for-issue.ts` lines 200-214 `ctx.agents.get` pattern):
```typescript
// Already truncates body (lines 30-39). Reuse the same EXCERPT_MAX pattern with a tighter cap for D-09:
const DESC_EXCERPT_MAX = 120; // D-09 — first line, ≤120 chars

function firstLineExcerpt(body: string | undefined): string | null {
  if (!body) return null;
  const firstLine = body.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return null;
  return firstLine.length <= DESC_EXCERPT_MAX
    ? firstLine
    : firstLine.slice(0, DESC_EXCERPT_MAX - 1) + '…';
}

// In the .map() (lines 87-95), add description_excerpt:
return issues.map((i) => ({
  id: i.key,
  title: i.title,
  status: i.status,
  ownerUserId: i.assignee_user_id,
  ownerName, // NEW — resolved via ctx.agents.get per distinct assignee
  bodyExcerptForViewer: i._viewer_can_read === false ? null : truncateExcerpt(i.body),
  descriptionExcerpt: i._viewer_can_read === false ? null : firstLineExcerpt(i.body),
  url: `/issues/${i.key}`,
}));
```

`ownerName` resolution mirrors the D9 fix in `chat-open-for-issue.ts` lines 200-214 — NEVER falls back to UUID.

---

#### `src/ui/surfaces/chat/deep-link.mjs` MOD — add optional `employeeUserId` param (D-10)

**Self-edit.** Extend `buildTopicDeepLink` (lines 149-155) — current signature `(companyPrefix, topicIssueId)`. Target:
```javascript
export function buildTopicDeepLink(companyPrefix, topicIssueId, employeeUserId) {
  return buildChatDeepLink({
    route: 'existing-topic',
    companyPrefix,
    topicIssueId,
    assigneeAgentId: typeof employeeUserId === 'string' ? employeeUserId : undefined,
  });
}
```

Mirror in `.d.mts` lines 65-69:
```typescript
export function buildTopicDeepLink(
  companyPrefix: string,
  topicIssueId: string,
  employeeUserId?: string,
): ChatDeepLinkNav | null;
```

**Audit ALL `buildTopicDeepLink` callers (D-10 load-bearing work):**
- `src/ui/surfaces/reader/reverse-topics-link.tsx` line 152 — pass `t.employeeAgentId`
- `src/ui/surfaces/reader/continue-in-chat-button.tsx` — currently uses `buildChatDeepLink` (already carries `assigneeAgentId`), but verify the ambiguous-route picker dispatch covers the gap
- picker row dispatch in `reverse-topics-link.tsx` lines 137-156 — pass `t.employeeAgentId`
- chat-side `parseChatDeepLink` consumers already read `link.employee` (no change needed; `index.tsx` lines 382-385 already set employee before topic)

---

### Plan 05-06 — Phase 4.1 surface polish bundle

#### `src/worker/handlers/chat-pin.ts` MOD — Pin/Unpin already a toggle

**Self-edit.** Current handler already takes `pinned: boolean` (lines 50-72); confirm the UI passes `!currentlyPinned` to toggle. No new handler needed — surface the toggle behavior in `message-thread.tsx`.

#### `.flash-highlight` CSS class — REUSE (do not duplicate)

**Analog:** `src/ui/styles/chat.css` lines 2253-2281 (`@keyframes clarity-flash`; `[data-clarity-surface="chat"] .msg.flash-highlight .bubble`; `@media (prefers-reduced-motion: reduce)`).

For D-12 pinned-chip click: add a `flash-highlight` class to the target message bubble for 1.5s via `setTimeout` (matches Plan 04.2-04's scroll-and-flash usage — see `chat-url-params.test.mjs`).

```typescript
// In message-thread.tsx (or context-rail.tsx where the pinned-chip lives):
const handlePinnedChipClick = (commentId: string) => {
  const el = document.getElementById(`msg-${commentId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash-highlight');
  setTimeout(() => el.classList.remove('flash-highlight'), 1500);
};
```

#### Toast styling — left-edge `--you` (gold) stripe + `↗` icon prefix

**Analog:** `src/ui/primitives/toast.tsx` lines 88-106 (ChatToast render). The CSS lives in `chat.css` (search for `.clarity-toast`). For 05-06 fix (f):

```css
/* in chat.css */
[data-clarity-surface="chat"] .clarity-toast {
  border-left: 3px solid var(--you);
  padding-left: 12px;
}
[data-clarity-surface="chat"] .clarity-toast::before {
  content: '↗ ';
  color: var(--you);
}
```

Disambiguates Clarity toasts from Paperclip host bottom-LEFT toasts. Visual contract referenced in `sketch-findings-clarity-pack` SKILL.md (gold `--you` token).

---

### Plan 05-07 — Phase 4.2 polish bundle

#### `src/ui/surfaces/chat/index.tsx` MOD — D-13 D8 fix (remove `nav.replace` on consume)

**Self-edit.** Search for the `nav.replace(...)` call that fires after `parseChatDeepLink` lands (post-consume, ~lines 400-450 in chat/index.tsx — the "replace navigation" mentioned in lines 311-316). REMOVE that line; hash sits intact in URL; Back-after-deep-link returns to previous Paperclip page; Forward returns to chat with hash intact.

Keep the `consumedDeepLinkRef` guard (lines 336-369) — that prevents the effect from re-firing within the same SPA session even if the hash is still present.

#### React-key fixes (5 components per D-14)

**Analog:** `src/ui/surfaces/chat/topic-strip.tsx` lines 261-302 — stable-key pattern using a domain id (`topic.issueId`), NOT an array index:
```typescript
visible.map((topic) => (
  <button type="button" key={topic.issueId} ...>
```

Target components: ContextRail, PersistedMessage, TrueTaskDialog, AnchoredToCards, ChatPageBody. One commit per component (5 commits per D-14). For each: grep for any `key={index}` or implicit key omissions, replace with the row's domain id (message id, topic id, ref id, etc.). Composite keys like `${type}:${id}` when one id is not unique within the list.

#### `src/worker/handlers/chat-open-for-issue.ts` MOD — thread `topicIdentifier?` for D8 tooltip

**Self-edit.** Add `topicIdentifier?: string` to the `ChatOpenForIssueResult` type (lines 71-101). Set it on the `existing-topic` arm (lines 219-227) and `existing-topic` reverse-lookup arm (lines 308-315). Resolution: when topicIssueId resolves to a CHT-NN via `ctx.issues.get`, surface that as `topicIdentifier`. UI `continue-in-chat-button.tsx` tooltip (lines 256-269) consumes it.

---

### Plan 05-08 — Phase 4.1 power features

#### `migrations/0010_chat_topics_pinned.sql` (NEW migration)

**Analog:** `migrations/0009_chat_topics_origin_issue.sql` (verbatim shape lines 17-34).

```sql
-- 0010_chat_topics_pinned.sql
-- Plan 05-08 (D-20) -- Storage-pin storage. Additive plugin-namespace column;
-- pinned topics SKIP automatic and manual archive (D-20 invariant). Does NOT
-- change sort order.
--
-- Additive-only per CLAUDE.md coexistence guarantee #3. Idempotent.

ALTER TABLE plugin_clarity_pack_cdd6bda4bd.chat_topics
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz DEFAULT NULL;
```

Mirrors `archived_at timestamptz NULL` shape from `0008_chat_topics_archived_at.sql`. NO standalone `CREATE INDEX`, NO `DO` block, apostrophe-free comments.

#### `src/worker/handlers/chat-topic-pin.ts` (NEW worker action handler)

**Analog:** `src/worker/handlers/chat-topic-archive.ts` (entire file — verbatim shape, 72 lines)

Copy + replace `archive` → `pin`, `archived` → `pinned`, `setChatTopicArchived` → `setChatTopicPinned`. Error key: `'PIN_FAILED'`. Pin only flips `chat_topics.pinned_at` (NEVER calls `ctx.issues.update` — same CTT-07 invariant pinned by Test 6 of `chat-topic-archive.test.mjs`).

#### `src/manifest.ts` MOD — new page-slot for archive route

**Self-edit lines 442-475.** Add fourth `type: 'page'` slot:
```typescript
{
  type: 'page',
  id: 'clarity-archive',
  displayName: 'Archive',
  exportName: 'ArchivePage',
  routePath: 'archive',
},
```
Route resolves to `/<companyPrefix>/archive` (NOT `/clarity-pack/archive` — per memory `clarity-pack-plugin-page-routes`). The CONTEXT says `/<companyPrefix>/clarity-pack/archive` which is incorrect per the memory; planner should align with existing pattern (`/COU/bulletin`, `/COU/situation-room`).

#### `src/ui/primitives/clarity-surface-header.tsx` (NEW shared header — cold-task button)

**Analog:** `src/ui/surfaces/chat/actions-row.tsx` (lines 30-108) — single-key shortcut handler + button row pattern.

```typescript
export function ClaritySurfaceHeader({ companyId, userId, surface }: Props): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // No keyboard shortcut here (composer-scoped `?` per D-19; T-key scoped to chat surface).
  return (
    <div className="clarity-surface-header" data-clarity-region="surface-header">
      <button
        type="button"
        className="btn primary"
        onClick={() => setDialogOpen(true)}
        title="Create a task"
        data-clarity-action="create-task-global"
      >
        + Create task
      </button>
      {dialogOpen ? <TrueTaskDialog mode="cold" onClose={() => setDialogOpen(false)} ... /> : null}
    </div>
  );
}
```

Mount on Reader / Situation Room / Bulletin / Chat top-right (per D-17). Plan 05-08 must avoid the keyboard shortcut collision with chat's existing single-key `T` (see `actions-row.tsx` lines 49-72).

#### `src/ui/surfaces/chat/composer.tsx` MOD — `?` key opens shortcuts popover (D-19)

**Analog:** `actions-row.tsx` lines 49-72 (single-key handler with editable-element bail).

DEVIATION FROM analog: scope the listener to the textarea, NOT `window`. Guard against literal `?` typing:
```typescript
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // Existing Enter/Shift+Enter handling stays.
  if (e.key === '?' && !e.shiftKey === false /* shift IS pressed; ? is Shift+/ */) {
    const textarea = e.currentTarget;
    // Only open if the textarea is EMPTY (operator's first press) or the
    // shortcut chord is exact (Shift+? with no other modifier and an empty
    // selection at start of line).
    if (textarea.value.length === 0) {
      e.preventDefault();
      setShortcutsPopoverOpen(true);
    }
  }
};
// Bind to <textarea onKeyDown={handleKeyDown}> — NOT window listener.
```

ESC closes the popover; ANY printable key while popover is open closes it (so the operator can immediately resume typing).

#### `src/ui/surfaces/chat/diagnostics-toggle.tsx` MOD — per-topic localStorage (D-18)

**Analog:** `src/ui/surfaces/chat/topic-strip.tsx` lines 199-225 (the `clarity-about-chip-dismissed:<issueId>` localStorage key pattern; resilient to `privacy-mode` failure with a Set mirror).

```typescript
const storageKey = topicId ? `clarity:diagnostics:${topicId}` : null;
const [armed, setArmed] = React.useState(() => {
  if (!storageKey || typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(storageKey) === '1'; } catch { return false; }
});
React.useEffect(() => {
  if (!storageKey || typeof window === 'undefined') return;
  try { window.localStorage.setItem(storageKey, armed ? '1' : '0'); } catch { /* privacy mode */ }
}, [armed, storageKey]);
```

#### `src/ui/surfaces/archive/index.tsx` (NEW page route)

**Analog:** `src/ui/surfaces/bulletin/index.tsx` (page-slot composition with `ClaritySurfaceRoot`, opt-in gate, three-gate `useOptIn` / `useResolvedCompanyId` / `useResolvedUserId` pattern — verbatim from `src/ui/surfaces/chat/index.tsx` lines 82-143).

```typescript
import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

export function ArchivePage(): React.ReactElement {
  const { optedIn, loading: optInLoading } = useOptIn();
  if (optInLoading) return <ClaritySurfaceRoot name="chat"><p>Loading…</p></ClaritySurfaceRoot>;
  if (!optedIn) return <ClaritySurfaceRoot name="chat"><EnableClarityCta surfaceName="Archive" /></ClaritySurfaceRoot>;
  return <ArchivePageOptedIn />;
}
```

Note: re-use `data-clarity-surface="chat"` (since archive is a chat-feature surface) OR add `'archive'` to the `ClaritySurfaceName` union in `clarity-surface-root.tsx` line 18-24. Planner picks; cleaner is the latter.

Bulk-unarchive: row checkboxes + a `Selected (N) — Unarchive` action button. Confirmation NOT required (D-16: reversible operation). After unarchive succeeds, show a `"${count} topics unarchived"` toast via the existing `useToast` primitive.

---

### Plan 05-09 — Tooling + infra cleanup

#### `runbook/operator-gotchas.md` MOD — VPS git pull step (D-21)

**Self-edit.** Append a new section using the `§<slug>` pattern (verbatim from `runbook/operator-gotchas.md` lines 12-26 `§paperclip-restoring-db-precreate` shape):

```markdown
## §vps-clarity-pack-scripts-sync

**Symptom:** Safety CLI / install-helper.sh exits with an error referencing a script that does not exist on the VPS, OR a partial-clone state where `scripts/safety/` is stale relative to the master branch.

**Discovered:** 2026-05-25 Plan 04.2-07 rc.7 drill (second incident; first was 2026-05-22 Plan 04.2-01 drill).

**Why it happens:** `~/clarity-pack` on Countermoves is a partial git checkout that predates Plan 01-05's `pg-dump-locator.mjs` and several Phase 4 safety updates. New scripts shipped via the repo are not reflected on the VPS until `git pull` runs.

**Resolution:** Before every drill, sync from origin:

\`\`\`bash
cd ~/clarity-pack && git pull
\`\`\`

Long-term remediation: documented operator step (NOT silent auto-sync via install-helper.sh — that would mutate VPS state without operator review).
```

#### `CLAUDE.md` MOD — correct plugin-route documentation

Search for `/plugins/clarity-pack/` in CLAUDE.md and replace with `/<companyPrefix>/<routePath>` (e.g. `/COU/bulletin`). Per memory `clarity-pack-plugin-page-routes`.

#### Windows max-path fixture relocation (D-22)

**Goal:** move `scripts/safety/test/fixtures/fake-paperclip-clone/` out of any worktree-spawned subtree so Windows worktree creation does not blow up on `node_modules/.pnpm/@embedded-postgres+...` paths exceeding MAX_PATH.

Two acceptable mechanisms (per CONTEXT D-22 + Claude's discretion):
1. **Symlink at test setup time** — fixture lives at `test/fixtures/external/fake-paperclip-clone/` (a deeper but stable path), and `scripts/safety/test/setup.mjs` creates a symlink from `scripts/safety/test/fixtures/fake-paperclip-clone` → `../../../../test/fixtures/external/fake-paperclip-clone` on Linux/macOS test runs; Windows CI uses the direct path.
2. **`.gitattributes` export-ignore + worktree skip** — flag the deep path as `export-ignore` AND configure worktree commands to skip it.

Mechanism 1 is preferred (simpler; cleaner for Linux CI). Planner picks; either honors D-22 "doesn't break CI Linux runs" guardrail.

---

### Plan 05-10 — v1.0.0 final closure

#### Version bump

**Two sources** (per memory `plugin-version-bump-two-sources`):
- `package.json` line 3: `"version": "1.0.0-rc.7"` → `"version": "1.0.0"`
- `src/manifest.ts` line 337: `version: '1.0.0-rc.7',` → `version: '1.0.0',`

Both bumped in the same commit. The host reads `dist/manifest.js` (built from `src/manifest.ts`), not `package.json` — bumping only one ships v1.0.0 code with an rc.7 label.

#### `05-VERIFICATION.md`

**Analog:** `.planning/phases/04.2-reader-chat-bridge/04.2-VERIFICATION.md` (verbatim shape — RCB-NN closure baselines, COEXIST #6 row-count tables, plugin UUID preservation evidence, tarball pin sha256).

For 05: list every Phase 5 requirement (DIST-01..DIST-05, COEXIST-05, plus all D-NN from CONTEXT.md), the proof source (test file + closure-drill artifact), and the final pass/fail. Mirror the 04.2 VERIFICATION's per-requirement bullet structure.

Per D-23 (operator deviation): the rollback rehearsal `1.0.0 → rc.7 → 1.0.0` is NOT performed. The VERIFICATION.md `Rollback rehearsal` row records `SKIPPED — operator decision (D-23 power-mode CONTEXT.md). Bookend snapshot/restore from Phase 1 is sole recovery path.` — explicit + future-readable.

---

## Shared Patterns

### Pattern: Worker data handler (request-response)

**Source:** `src/worker/handlers/chat-active-tasks.ts` lines 33-44 (Ctx composition) + `chat-open-for-issue.ts` lines 123-138 (param guards + structured errors)

**Apply to:** Plan 05-04 `deliverable-preview.ts`, Plan 05-05 `editor-pause-status.ts` extension, Plan 05-05 `resolve-refs.ts` extension, Plan 05-07 `chat-open-for-issue.ts` extension

**Excerpt:**
```typescript
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type FooCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

export function registerFoo(ctx: FooCtx): void {
  wrapDataHandler(ctx, 'foo.bar', async (params) => {
    const companyId = typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    // ... happy path returns structured result with a `kind:` discriminator
  });
}
```

### Pattern: Worker action handler (CRUD toggle, plugin-side only)

**Source:** `src/worker/handlers/chat-topic-archive.ts` entire file (CTT-07 invariant — no host issue mutation)

**Apply to:** Plan 05-06 chat-pin extensions, Plan 05-08 chat-topic-pin (storage-pin)

**Excerpt:** (verbatim lines 37-71)
```typescript
export function registerChatTopicArchive(ctx: ChatTopicArchiveCtx): void {
  wrapActionHandler(ctx, 'chat.topic.archive', async (params) => {
    const companyId = typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const topicIssueId = typeof params?.topicIssueId === 'string' && params.topicIssueId ? params.topicIssueId : null;
    const archived = params?.archived;

    if (!companyId) throw new Error('chat.topic.archive: companyId required');
    if (!topicIssueId) throw new Error('chat.topic.archive: topicIssueId required');
    if (typeof archived !== 'boolean') throw new Error('chat.topic.archive: archived (boolean) required');

    try {
      await setChatTopicArchived(ctx, companyId, topicIssueId, archived);
      return { ok: true, topicIssueId, archived };
    } catch (e) {
      ctx.logger?.warn?.('chat.topic.archive: failed', { companyId, topicIssueId, err: (e as Error).message });
      return { error: 'ARCHIVE_FAILED' };
    }
  });
}
```

### Pattern: UI surface page (three-gate composition)

**Source:** `src/ui/surfaces/chat/index.tsx` lines 82-143 (opt-in → companyId → userId, error fallback per gate, `ClaritySurfaceRoot` wrapper)

**Apply to:** Plan 05-08 new ArchivePage; any other future page-slot

**Excerpt:**
```typescript
export function ChatPage(_props?: PluginPageProps): React.ReactElement {
  const { optedIn, loading: optInLoading } = useOptIn();
  if (optInLoading) return <ClaritySurfaceRoot name="chat"><p>Loading…</p></ClaritySurfaceRoot>;
  if (!optedIn) return <ClaritySurfaceRoot name="chat"><EnableClarityCta surfaceName="Chat" /></ClaritySurfaceRoot>;
  return <ChatPageOptedIn />;
}
function ChatPageOptedIn() {
  const { companyId, loading: cL, error: cE } = useResolvedCompanyId();
  const { userId, loading: uL, error: uE } = useResolvedUserId();
  if (cL || uL) return <ClaritySurfaceRoot ...><p>Resolving…</p></ClaritySurfaceRoot>;
  if (cE || !companyId) return <ClaritySurfaceRoot ...><p>... no-company-context</p></ClaritySurfaceRoot>;
  if (uE || !userId) return <ClaritySurfaceRoot ...><p>... no-user-context</p></ClaritySurfaceRoot>;
  return <ClaritySurfaceRoot ...><ToastProvider><ChatPageBody ... /></ToastProvider></ClaritySurfaceRoot>;
}
```

### Pattern: Plugin-namespace migration (additive, validator-conformant)

**Source:** `migrations/0009_chat_topics_origin_issue.sql` entire file

**Apply to:** Plan 05-08 `migrations/0010_chat_topics_pinned.sql`

**Excerpt:** (verbatim lines 1-34) — apostrophe-free comments, `ADD COLUMN IF NOT EXISTS`, no `CREATE INDEX`, ends on semicolon.

### Pattern: CI workflow (a11y / lockfile / visual-regression)

**Source:** `.github/workflows/a11y-check.yml` lines 1-32

**Apply to:** Plan 05-04 `.github/workflows/visual-regression.yml`

**Excerpt:** node 20 setup, `actions/checkout@v4`, `actions/setup-node@v4`, single-step run + a follow-up `node --test` pin.

### Pattern: localStorage per-id persistence with Set mirror

**Source:** `src/ui/surfaces/chat/topic-strip.tsx` lines 199-225 (clarity-about-chip-dismissed key)

**Apply to:** Plan 05-08 D-18 diagnostics per-topic toggle

**Excerpt:** key shape `clarity:<feature>:<id>`; read once on mount; write on toggle; React Set mirror drives re-render without re-reading localStorage; try/catch around localStorage for privacy-mode resilience.

### Pattern: Single-key keyboard shortcut with editable-element bail

**Source:** `src/ui/surfaces/chat/actions-row.tsx` lines 49-72 (T-key for Create Task)

**Apply to:** Plan 05-08 D-19 composer `?` shortcut — DEVIATION: scope to textarea `onKeyDown`, NOT window listener

**Excerpt:** (verbatim core)
```typescript
React.useEffect(() => {
  const handler = (e: KeyboardEvent): void => {
    if (e.key !== 'T' && e.key !== 't') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const ae = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    e.preventDefault();
    onCreateTask();
  };
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [onCreateTask]);
```

### Pattern: Operator-gotchas runbook entry

**Source:** `runbook/operator-gotchas.md` lines 12-26 (`§paperclip-restoring-db-precreate` shape)

**Apply to:** Plan 05-09 D-21 VPS git pull entry

**Excerpt:** anchor `§<slug>`, **Symptom** / **Discovered** / **Why it happens** / **Resolution** with copy-paste commands. Append-only.

### Pattern: Server-side display-name resolution (NEVER UUID fallback)

**Source:** `src/worker/handlers/chat-open-for-issue.ts` lines 200-214 (assignee name via `ctx.agents.get`); also Plan 05-03 `reader-ac-autostatus` follows same.

**Apply to:** Plan 05-05 D-07 (pause cause agent name), D-09 (ref-chip owner name)

**Excerpt:**
```typescript
let assigneeName: string | null = null;
try {
  const agent = await ctx.agents.get(assigneeAgentId, companyId);
  if (agent && typeof (agent as { name?: unknown }).name === 'string') {
    const candidate = (agent as { name: string }).name.trim();
    if (candidate) assigneeName = candidate;
  }
} catch (e) {
  ctx.logger?.warn?.('handler: agents.get failed', { ... });
}
// Caller does: const label = assigneeName ?? 'this employee'; // NEVER UUID
```

---

## No Analog Found

Files in this phase with no close codebase precedent. Planner should use RESEARCH.md / external patterns:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `test/visual/sketch-regression.test.mjs` | visual test | image-snapshot | First Playwright test in the repo — no analog. Use Playwright's `expect(page).toHaveScreenshot()` pattern from upstream docs. Run against `file://` URLs of `sketches/*.html` (per D-04). |
| `test/visual/baselines/*.png` | binary assets | n/a | Generated on first `pnpm visual:update`; tracked via `.gitattributes binary`. |
| `react-markdown` integration | UI dependency | render | First markdown-renderer dep — no existing renderer in the repo. Use the default exports per react-markdown 9.x docs. Bundle delta ~50 kB UI (acceptable per D-03). |
| SheetJS (`xlsx`) integration | worker dependency | parse | First xlsx parser in the repo. WORKER-side only — must NOT appear in any UI bundle imports (UI bundle stays ~288 kB; xlsx adds to worker only). |
| `<embed type="application/pdf">` | UI dispatch element | render | Native HTML element; no analog needed (D-02 explicitly chose zero-JS path). |

---

## Metadata

**Analog search scope:**
- `src/worker/handlers/**/*.ts` (30 handlers scanned)
- `src/ui/primitives/*.tsx` (4 primitives scanned)
- `src/ui/surfaces/**/*.tsx` (47 surface components scanned)
- `migrations/*.sql` (9 migrations scanned)
- `.github/workflows/*.yml` (5 workflows scanned)
- `runbook/operator-gotchas.md` (catalog entries scanned)
- `src/manifest.ts` (page-slot pattern scanned)
- `src/ui/styles/chat.css` (`.flash-highlight` keyframe scanned)
- `src/ui/surfaces/chat/deep-link.mjs` + `.d.mts` (full file scanned for D-10 extension)

**Files scanned:** ~100 files / strict early-stopping at 3-5 strong matches per pattern category

**Pattern extraction date:** 2026-05-25
**Mapper:** gsd-pattern-mapper (PHASE 5)
