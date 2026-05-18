# Phase 4: Employee Chat - Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 21 new/modified files
**Analogs found:** 21 / 21 (every Phase 4 file has a same-plugin analog)

This map is consumed by `gsd-planner`. Every Phase 4 file already has a working
Phase 2/3 analog in this plugin — Phase 4 is "copy the shape, change the table /
handler key / component". No file in this phase is greenfield-without-precedent.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `migrations/0006_chat.sql` | migration | CRUD | `migrations/0004_bulletin.sql` | exact |
| `src/worker/db/chat-topics-repo.ts` | repo (worker DB) | CRUD | `src/worker/db/bulletins-repo.ts` | exact |
| `src/worker/handlers/chat-roster.ts` | handler (data) | request-response | `src/worker/handlers/situation-room.ts` (data-handler half) | role-match |
| `src/worker/handlers/chat-topics.ts` | handler (data + action) | CRUD | `src/worker/handlers/bulletin-by-cycle.ts` + `bulletin-action-approve.ts` | exact |
| `src/worker/handlers/chat-messages.ts` | handler (data) | request-response | `src/worker/handlers/bulletin-by-cycle.ts` | exact |
| `src/worker/handlers/chat-send.ts` | handler (action) | request-response (write) | `src/worker/handlers/bulletin-action-approve.ts` | exact |
| `src/worker/handlers/chat-edit.ts` | handler (action) | request-response (write) | `src/worker/handlers/bulletin-action-approve.ts` | exact |
| `src/worker/handlers/chat-search.ts` | handler (data) | request-response (query) | `src/worker/handlers/bulletin-by-cycle.ts` | role-match |
| `src/worker/handlers/chat-promote.ts` | handler (action) | request-response (write) | `src/worker/handlers/bulletin-action-approve.ts` | exact |
| `src/worker/handlers/chat-pin.ts` | handler (action) | request-response (write) | `src/worker/handlers/active-viewer-ping.ts` | exact |
| `src/worker/streams/chat-stream-bridge.ts` | worker stream bridge | event-driven / pub-sub | `src/worker.ts` `ctx.events.on(...)` block (ll. 158-214) | role-match |
| `src/worker.ts` (MODIFIED) | worker entrypoint | wiring | `src/worker.ts` itself (Plan 03-03 register block) | exact |
| `src/manifest.ts` (MODIFIED) | config / manifest | — | `src/manifest.ts` itself (Plan 03 capability additions) | exact |
| `src/ui/index.tsx` (MODIFIED) | UI barrel + style inject | — | `src/ui/index.tsx` itself (Plan 03-03 bulletin entry) | exact |
| `src/ui/surfaces/chat/index.tsx` (REPLACES `chat-stub.tsx`) | page surface (component) | request-response | `src/ui/surfaces/bulletin/index.tsx` | exact |
| `src/ui/surfaces/chat/roster-rail.tsx` | component | request-response | `src/ui/surfaces/situation-room/agent-card.tsx` | role-match |
| `src/ui/surfaces/chat/topic-strip.tsx` | component | request-response | `src/ui/surfaces/bulletin/action-inbox.tsx` | role-match |
| `src/ui/surfaces/chat/message-thread.tsx` | component | streaming + optimistic | `src/ui/surfaces/situation-room/index.tsx` `SituationRoomBody` (stream/poll compose) | role-match |
| `src/ui/surfaces/chat/composer.tsx` | component | request-response (action) | `src/ui/surfaces/bulletin/action-inbox.tsx` `ActionInboxCardView` (usePluginAction) | role-match |
| `src/ui/surfaces/chat/context-rail.tsx` | component | request-response | `src/ui/surfaces/situation-room/artifacts-shipped-shelf.tsx` | role-match |
| `src/ui/surfaces/chat/reasoning-panel.tsx` | component | transform (parse) | `src/ui/surfaces/reader/prose-with-ref-chips.tsx` | role-match |
| `src/ui/styles/chat.css` | surface stylesheet | — | `src/ui/styles/bulletin.css` | exact |

## Pattern Assignments

### `migrations/0006_chat.sql` (migration, CRUD)

**Analog:** `migrations/0004_bulletin.sql`

The validator hazards documented in 0004's header (ll. 1-42) are LOAD-BEARING —
copy that comment block verbatim and adapt. Five hard rules the planner must
carry into 0006:

1. All DDL fully-qualified to `plugin_clarity_pack_cdd6bda4bd.<table>` — no
   template substitution.
2. No standalone `CREATE INDEX` — access paths come from inline `PRIMARY KEY` /
   `UNIQUE` constraints only.
3. No procedural `DO $$ ... $$` blocks — `CREATE TABLE IF NOT EXISTS` is the
   idempotency mechanism.
4. Migration comments must be apostrophe-free (the host validator's greedy
   string-literal regex pairs a stray `'` with the next real literal).
5. File must end on a `;`-terminated statement — no trailing comment block.

**Table-shape excerpt to copy** (`0004_bulletin.sql:58-74`):
```sql
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletins (
  cycle_number          bigint PRIMARY KEY,
  company_id            text NOT NULL,
  next_due_at           timestamptz NOT NULL,
  compile_status        text NOT NULL CHECK (compile_status IN ('pending','attempting','verified','published','failed')),
  content_hash          text NOT NULL,
  draft_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (next_due_at, content_hash)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.bulletins IS
  'D-17 bulletin metadata...';
```

Note the patterns to reuse: `text NOT NULL` for IDs, `timestamptz NOT NULL
DEFAULT now()` for timestamps, `CHECK (... IN (...))` for enums, inline
`UNIQUE (...)` composite constraint, `COMMENT ON TABLE` (the one statement that
MAY be unqualified). The RESEARCH.md "Pattern 1" proposed `0006_chat.sql` shape
(`chat_topics` + `chat_messages`, 04-RESEARCH.md ll. 218-245) already matches
this analog exactly — the `sender_kind` CHECK and `boolean ... DEFAULT false`
for `archived`/`pinned` are the same primitives 0004 uses.

---

### `src/worker/db/chat-topics-repo.ts` (repo, CRUD)

**Analog:** `src/worker/db/bulletins-repo.ts`

This is the exact-match template. Copy the whole shape.

**Ctx + types pattern** (`bulletins-repo.ts:20-65`):
```typescript
import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type BulletinsRepoCtx = {
  db: PluginDatabaseClient;
};

export type BulletinRow = {
  cycle_number: number;
  company_id: string;
  // ... snake_case columns mirroring the SQL exactly
};
```

**Fully-qualified-SQL + column-constant pattern** (`bulletins-repo.ts:76-78`,
`151-175`):
```typescript
const BULLETIN_COLS =
  'cycle_number, company_id, next_due_at, compiled_at, ...';

export async function getBulletinByCycle(
  ctx: BulletinsRepoCtx,
  companyId: string,
  cycle: number | 'latest',
): Promise<BulletinRow | null> {
  const rows = await ctx.db.query<BulletinRow>(
    `SELECT ${BULLETIN_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.bulletins
     WHERE company_id = $1 AND cycle_number = $2
     LIMIT 1`,
    [companyId, cycle],
  );
  return rows[0] ?? null;
}
```

**CRITICAL host-DB contract** (`bulletins-repo.ts:104-137`, comment + code):
`ctx.db.query` is SELECT-only; `ctx.db.execute` returns only `{ rowCount }` — no
`RETURNING`. Every write is `execute` an INSERT/UPDATE, then `query` a SELECT to
read the row back. The dedup-on-send for `chat_messages` (CHAT-06 / D-09) uses
the same idiom as `upsertBulletin`: `ON CONFLICT (...) DO NOTHING` keyed on the
PK (`message_uuid`), then SELECT the row back. The `CHT-NN` allocator copies
`upsertBulletin`'s `MAX(cycle_number) + 1` pattern (`bulletins-repo.ts:94-102`)
— `MAX` over a `company_id`-scoped SELECT.

The repo also holds the `chat_messages` CRUD (idempotency map, supersedes link,
pin flag) per RESEARCH.md Component Responsibilities — one repo file, mirroring
how `bulletins-repo.ts` covers four 0004 tables.

---

### `src/worker/handlers/chat-topics.ts` / `chat-messages.ts` / `chat-roster.ts` / `chat-search.ts` (handler, data)

**Analog:** `src/worker/handlers/bulletin-by-cycle.ts`

All four data handlers follow this exact shape — `wrapDataHandler`, param
validation, repo call, structured-error returns.

**Imports + Ctx-composition pattern** (`bulletin-by-cycle.ts:19-34`):
```typescript
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import {
  getBulletinByCycle,
  type BulletinsRepoCtx,
} from '../db/bulletins-repo.ts';
import type { PluginIssuesClient } from '@paperclipai/plugin-sdk';

export type BulletinByCycleCtx = OptInGuardDataCtx &
  BulletinsRepoCtx & {
    issues: PluginIssuesClient;
  };
```
Ctx types are COMPOSED from real SDK interface types + `OptInGuardDataCtx` —
never a hand-rolled "lying about the SDK" shape.

**Handler body pattern** (`bulletin-by-cycle.ts:47-67`):
```typescript
export function registerBulletinByCycle(ctx: BulletinByCycleCtx): void {
  wrapDataHandler(ctx, 'bulletin.byCycle', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!companyId) {
      return { error: 'COMPANY_ID_REQUIRED' };
    }
    if (!userId) {
      return { error: 'USER_ID_REQUIRED' };
    }
    const row = await getBulletinByCycle(ctx, companyId, cycle);
    // ...
    return { kind: 'published' as const, /* typed fields */ };
  });
}
```
Note: data handlers RETURN structured errors (`{ error: '...' }`); they do not
throw. `params?.companyId` / `params?.userId` are validated with the
`typeof ... === 'string' && x ? x : null` idiom.

**For `chat-search.ts`** — the CHAT-08 ILIKE query goes through `ctx.db.query`
(SELECT-only, `issue_comments` is in `coreReadTables`). RESEARCH.md ll. 405-418
has the exact JOIN-through-`chat_topics` query; the company-scoping-via-JOIN
discipline mirrors `bulletins-repo.ts:238-255` `listErrataByCycle`.

**For `chat-topics.ts`** — the `+ New topic` action half follows the
`bulletin-action-approve.ts` action shape below (one file may register both a
data key and an action key, like the Bulletin handlers do collectively).

---

### `src/worker/handlers/chat-send.ts` / `chat-edit.ts` / `chat-promote.ts` (handler, action)

**Analog:** `src/worker/handlers/bulletin-action-approve.ts`

The action-handler template — `wrapActionHandler`, throw-on-bad-params,
server-side ownership re-verification, structured-error returns on host-call
failure.

**Full pattern** (`bulletin-action-approve.ts:24-77`):
```typescript
import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type BulletinActionApproveCtx = OptInGuardActionCtx & {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

export function registerBulletinActionApprove(ctx: BulletinActionApproveCtx): void {
  wrapActionHandler(ctx, 'bulletin.action.approve', async (params) => {
    const issueId =
      typeof params?.issueId === 'string' && params.issueId ? params.issueId : null;
    if (!issueId) throw new Error('bulletin.action.approve: issueId required');
    // ... companyId, userId same

    // re-verify the viewer owns the issue before mutating (T-03-16)
    let issue: { assigneeUserId?: string | null } | null;
    try {
      issue = (await ctx.issues.get(issueId, companyId)) as { ... } | null;
    } catch (e) {
      ctx.logger?.warn?.('...: issues.get failed', { issueId, err: (e as Error).message });
      return { error: 'NOT_FOUND' };
    }
    if (!issue || issue.assigneeUserId !== userId) {
      return { error: 'NOT_OWNED' };
    }

    try {
      await ctx.issues.update(issueId, { status: 'done' } as Parameters<PluginIssuesClient['update']>[1], companyId);
    } catch (e) {
      ctx.logger?.warn?.('...: issues.update failed', { ... });
      return { error: 'UPDATE_FAILED' };
    }
    return { ok: true };
  });
}
```

Key carry-overs for the chat actions:
- **Action handlers THROW on missing required params** (`throw new Error`), they
  do NOT return `{ error }` for that case — that differs from data handlers.
- The `NOT_OWNED` ownership re-check (V4 / Security Domain in RESEARCH.md) is the
  template for promote / edit / pin re-verifying `userId` server-side before
  mutating someone else's message.
- `ctx.issues.update` patch is cast `as Parameters<PluginIssuesClient['update']>[1]`
  — the SDK patch type is `Pick<Issue,...>`; the auto-reopen `{ status:
  'in_progress' }` flip (D-06) uses this exact cast. There is NO `resume` typed
  field — see RESEARCH OQ-3; verify in Plan 04-01.
- For `chat-send.ts` the write is `ctx.issues.createComment(topicIssueId, body,
  companyId)` (CHAT-02) followed by the `chat_messages` side-table INSERT —
  RESEARCH ll. 374-380 has the exact two-step.

---

### `src/worker/handlers/chat-pin.ts` (handler, action — simple)

**Analog:** `src/worker/handlers/active-viewer-ping.ts`

The minimal action handler — when an action only flips a plugin-namespace flag
and needs no host-issue round-trip, copy this leaner shape instead of the full
`bulletin-action-approve.ts`:

```typescript
import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';

export type ActiveViewerPingCtx = OptInGuardActionCtx;

export function registerActiveViewerPing(ctx: ActiveViewerPingCtx): void {
  wrapActionHandler(ctx, 'situation.active-viewer-ping', async (params) => {
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!userId) throw new Error('active-viewer-ping: userId required');
    await ctx.db.execute(
      "INSERT INTO plugin_clarity_pack_cdd6bda4bd.active_viewers (...) VALUES ($1,...) ON CONFLICT (...) DO UPDATE SET last_seen_at = now()",
      [userId, tabId],
    );
    return { ok: true };
  });
}
```
Pin = an `UPDATE ... SET pinned = ...` on `chat_messages` through
`ctx.db.execute` (or via the repo). Note the `Ctx` is just `OptInGuardActionCtx`
when no extra SDK client is needed.

---

### `src/worker/streams/chat-stream-bridge.ts` (worker stream bridge, event-driven)

**Analog:** `src/worker.ts` `ctx.events.on(...)` block (ll. 158-214)

There is no dedicated `src/worker/streams/` directory yet — this is the one
genuinely new shape. The closest existing pattern is the Editor-Agent heartbeat
event subscription in `worker.ts`. Copy its event-handler discipline:

**Event-subscription pattern** (`worker.ts:182-214`):
```typescript
for (const evt of ['issue.created', 'issue.updated', 'issue.comment.created'] as const) {
  ctx.events.on(evt, async (event) => {
    if (!event.entityId || !event.companyId) return;   // guard nulls FIRST
    try {
      // ... do work
    } catch (err) {
      ctx.logger?.warn?.('... handler threw', {
        event: evt,
        err: (err as Error).message,
      });
    }
  });
}
```
Carry-overs: guard `!event.entityId || !event.companyId` before any work;
wrap the body in `try/catch` and `ctx.logger?.warn?.` — a throwing event handler
must never crash the worker.

The new piece is the re-emit. RESEARCH.md "Pattern 2" (ll. 256-271) has the
target shape — `ctx.events.on('issue.comment.created', ...)` →
`isChatTopicIssue` filter (a `chat_topics` lookup, query the repo) →
`ctx.streams.emit(\`chat:${event.companyId}\`, {...})`. The channel name is
plugin-defined, scoped per company. Register this in `worker.ts:setup()`
alongside the existing `ctx.events.on` registrations. `event.payload` is typed
`unknown` (OQ-2) — if opaque, re-fetch via `ctx.issues.listComments`.

---

### `src/worker.ts` (MODIFIED — wiring)

**Analog:** `src/worker.ts` itself (the Plan 03-03 register block, ll. 124-132)

Phase 4 adds register-calls following the established block:
```typescript
import {
  registerBulletinByCycle,
  type BulletinByCycleCtx,
} from './worker/handlers/bulletin-by-cycle.ts';
// ...
registerBulletinByCycle(ctx as unknown as BulletinByCycleCtx);
registerBulletinActionApprove(ctx as unknown as BulletinActionApproveCtx);
```
Each new chat handler gets a paired `import { registerX, type XCtx }` + a
`registerX(ctx as unknown as XCtx)` call inside `setup()`. The
`ctx as unknown as XCtx` cast is the established structural-narrowing idiom.
The stream bridge registers as an `await registerChatStreamBridge(ctx, ...)` or
inline `ctx.events.on` near the existing event block (ll. 158-214). Exempt-key
handlers register FIRST (ll. 87-93 comment) — chat handlers are all non-exempt,
so they register after, like the Bulletin block.

---

### `src/manifest.ts` (MODIFIED — config)

**Analog:** `src/manifest.ts` itself (the Plan 03-01 / 03-06 capability additions, ll. 137-151)

Phase 3 added capabilities to the existing `capabilities: [...]` array with an
inline comment citing the plan + the reason:
```typescript
    // Plan 03-01 — Daily Bulletin. issues.create lets the compile pipeline
    // persist each bulletin as a canonical Paperclip issue (D-16)...
    'issues.create',
    'issue.comments.create',
    // Plan 03-06 — ctx.issues.requestWakeup wakes the Editor-Agent...
    'issues.wakeup',
```
Most chat capabilities are already declared (`issues.create`,
`issue.comments.create`, `issue.comments.read`, `issues.wakeup`,
`events.subscribe`, `agents.read`, `database.namespace.*`). RESEARCH.md
"Environment Availability" (ll. 478-479) flags what to VERIFY at install:
`issues.update` for D-06, and whether `ctx.streams.emit` needs a distinct
capability string. Add only the missing strings, each with a `// Plan 04-NN —`
comment. Also bump `version` (RESEARCH suggests `0.6.6 → 0.7.0`) — the version
field at l. 83 carries the running changelog comment block; prepend the Phase 4
entry. Note: `instanceConfigSchema` (ll. 238-264) is the home for the
D-04 pending-reply-timeout config if the planner exposes it — copy the
`bulletinTimezone` property shape.

---

### `src/ui/index.tsx` (MODIFIED — UI barrel + style inject)

**Analog:** `src/ui/index.tsx` itself (the Plan 03-03 bulletin entry)

Two edits, both with a precedent in the file:
1. Swap the stub export — `export { ChatPage } from './surfaces/chat-stub.tsx';`
   becomes `export { ChatPage } from './surfaces/chat/index.tsx';` (mirrors how
   `BulletinPage` already points at `./surfaces/bulletin/index.tsx`, l. 33).
2. Add the scoped-stylesheet inject — copy ll. 17 + 29:
```typescript
import bulletinCss from './styles/bulletin.css';
// ...
injectClarityStyles(bulletinCss, 'data-clarity-pack-bulletin-styles');
```
becomes a parallel `chatCss` import + `injectClarityStyles(chatCss,
'data-clarity-pack-chat-styles')`. DEV-14: the host does NOT auto-load sibling
CSS — the bundle must inject its own `<style>`. esbuild's `{ '.css': 'text' }`
loader makes the import a string.

---

### `src/ui/surfaces/chat/index.tsx` (page surface — REPLACES `chat-stub.tsx`)

**Analog:** `src/ui/surfaces/bulletin/index.tsx`

The exact-match page template. The `exportName` MUST stay `ChatPage` (manifest
`clarity-chat` slot, `src/manifest.ts:204`).

**Three-tier gate pattern** (`bulletin/index.tsx:78-134`) — copy verbatim:
```typescript
export function BulletinPage(_props?: PluginPageProps): React.ReactElement {
  const { optedIn, loading: optInLoading } = useOptIn();          // GATE 1: opt-in
  if (optInLoading) return <ClaritySurfaceRoot name="bulletin"><p>Loading…</p></ClaritySurfaceRoot>;
  if (!optedIn) return <ClaritySurfaceRoot name="bulletin"><EnableClarityCta surfaceName="Bulletin" /></ClaritySurfaceRoot>;
  return <BulletinPageOptedIn />;
}

function BulletinPageOptedIn(): React.ReactElement {
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();  // GATE 2
  const { userId, loading: userLoading, error: userError } = useResolvedUserId();              // GATE 3
  // ... loading / error fallbacks per gate
  return (
    <ClaritySurfaceRoot name="bulletin">
      <BulletinPageBody companyId={companyId} userId={userId} />
    </ClaritySurfaceRoot>
  );
}
```
Gate order is LOCKED (Plan 02-09 pattern): `useOptIn` → `useResolvedCompanyId`
→ `useResolvedUserId`. `useResolvedUserId` exists because production hits a
null `userId` on detail-tab/page surfaces (memory: `useHostContext` null-userId
gap). Chat MUST use the resolver, not bare `useHostContext().userId`.

**Data-fetch + belt-and-suspenders pattern** (`bulletin/index.tsx:143-162`):
```typescript
const { data, loading } = usePluginData<BulletinByCycleResult>('bulletin.byCycle', {
  cycle: 'latest', companyId, userId,
});
// belt-and-suspenders: worker also returns OPT_IN_REQUIRED
if (data && typeof data === 'object' && 'error' in data && data.error === 'OPT_IN_REQUIRED') {
  return <EnableClarityCta surfaceName="Bulletin" />;
}
```
The `usePluginData` result type is a discriminated union (`{ error } | { kind:
... } | null`) — copy that typing discipline for the chat data shapes.
`ClaritySurfaceRoot name="chat"` is already a valid `ClaritySurfaceName` member
(`clarity-surface-root.tsx:23`).

---

### `src/ui/surfaces/chat/message-thread.tsx` (component — streaming + optimistic)

**Analog:** `src/ui/surfaces/situation-room/index.tsx` `SituationRoomBody` (ll. 140-217)

The closest stream-primary-with-poll-fallback compose. `SituationRoomBody`
composes `usePluginData` (primary) with `usePollWithLeader` (the
leader-elected fallback) and reconciles which payload to render:
```typescript
const { data: snapshotData } = usePluginData<SituationData | ... | null>('situation.snapshot', { userId, companyId });
const followerBridge = usePollWithLeader<SituationData | null>({
  key: 'situation.snapshot',
  fetcher: async () => (snapshotData as SituationData | null) ?? null,
  intervalMs,
  pauseOnHidden: true,           // visibility-pause is MANDATORY (Pitfall 4)
});
if (followerBridge.error?.kind === 'PLUGIN_DISABLED') { /* terminal */ }
const payload = (snapshotData ?? followerBridge.data ?? null);
```
For chat (D-08): `usePluginStream(\`chat:${companyId}\`)` is PRIMARY (returns
`{events, lastEvent, connecting, connected, error, close}`), `usePoll` /
`usePollWithLeader` is the FALLBACK on stream `error`. The visibility-pause and
`PLUGIN_DISABLED` terminal-stop carry over unchanged. The optimistic-bubble
reconciliation (key by `message_uuid`, order by server `created_at` — RESEARCH
Pattern 3, ll. 275-279) is the new logic layered on top of this compose.

---

### `src/ui/surfaces/chat/composer.tsx` (component — action)

**Analog:** `src/ui/surfaces/bulletin/action-inbox.tsx` `ActionInboxCardView` (ll. 55-123)

The `usePluginAction` + busy-state pattern:
```typescript
const approve = usePluginAction('bulletin.action.approve');
const [busy, setBusy] = React.useState(false);

const handleApprove = React.useCallback(async () => {
  setBusy(true);
  try {
    await approve({ issueId: card.issueId, companyId, userId });
    onActionComplete?.();
  } finally {
    setBusy(false);
  }
}, [approve, card.issueId, companyId, userId, onActionComplete]);
```
The composer's send copies this: `const send = usePluginAction('chat.send')` →
`send({ topicIssueId, body, message_uuid, companyId, userId })`. D-10 differs
from `action-inbox` in failure handling: on a thrown/`{error}` result the
optimistic bubble must STAY with a Retry affordance (not just `finally` clear
busy). For SPA navigation use `useHostNavigation().linkProps` — NEVER a raw
`<a href>` (SCAF-09, `action-inbox.tsx:15,109`).

---

### `src/ui/surfaces/chat/roster-rail.tsx` / `topic-strip.tsx` / `context-rail.tsx` / `reasoning-panel.tsx` (components)

**Analogs:**
- `roster-rail.tsx` → `src/ui/surfaces/situation-room/agent-card.tsx` — a list
  of per-employee cards with status dots; the `AgentEmployee` typed-prop shape
  is the model.
- `topic-strip.tsx` → `src/ui/surfaces/bulletin/action-inbox.tsx` — a horizontal
  strip of selectable cards; copy the `props.items.map(...)` + typed-props +
  `data-clarity-region` shape (`action-inbox.tsx:25-53`).
- `context-rail.tsx` → `src/ui/surfaces/situation-room/artifacts-shipped-shelf.tsx`
  — a right-rail list of artifact/recent items.
- `reasoning-panel.tsx` → `src/ui/surfaces/reader/prose-with-ref-chips.tsx` —
  a pure client-side parse-then-render component (D-14 parses a delimited block
  from the comment body; render as a `<details>` panel). The ref-chip resolver
  (`src/ui/primitives/ref-chip.tsx` + `src/shared/reference-resolver.ts`) is
  reused for inline `BEAAA-NNN` chips — `prose-with-ref-chips.tsx` is the exact
  usage analog.

Common component shape (all): pure presentational, typed `Props` exported next
to the component, named `export function`, `className="clarity-chat-..."`,
`* as React from 'react'`. Render message bodies as UNTRUSTED TEXT — never
`dangerouslySetInnerHTML` (RESEARCH Security Domain V5; chat is a named XSS
vector).

---

### `src/ui/styles/chat.css` (surface stylesheet)

**Analog:** `src/ui/styles/bulletin.css`

Exact-match template. EVERY selector prefixed `[data-clarity-surface="chat"]`
(SCAF-06 / COEXIST-01 / Pitfall 6 — CSS bleed). The scope-root rule carries the
palette CSS variables + base typography:
```css
[data-clarity-surface="chat"] {
  --paper: ...;  /* warm-dark editorial palette per the sketch */
  font-family: ...;
  /* ... */
}
[data-clarity-surface="chat"] * { box-sizing: border-box; }
```
A leading `@import url("https://fonts.googleapis.com/...")` is acceptable for
font loading (the chat sketch uses Geist + Geist Mono + Instrument Serif) — it
is a font load, not host-CSS coupling (`bulletin.css:13` comment). Cite
`sketches/paperclip-fix-employee-chat.html` line numbers for the 3-column shell
(`264px 1fr 340px`), `.messages` scroller, `.msg`/`.bubble`, `.reasoning`
`<details>`, `.attach` chip, `.decision-msg`, composer — same sketch-line-citation
discipline `bulletin.css` followed.

## Shared Patterns

### Opt-in gate (server-side — MANDATORY on every chat handler)

**Source:** `src/worker/opt-in-guard.ts`
**Apply to:** ALL chat data + action handlers (`chat-roster`, `chat-topics`,
`chat-messages`, `chat-send`, `chat-edit`, `chat-search`, `chat-promote`,
`chat-pin`). NONE are exempt — the `EXEMPT_HANDLER_KEYS` set
(`opt-in-guard.ts:59-63`) is `get-opt-in` / `set-opt-in` /
`clarity-pack/get-instance-config` only; do not add chat keys.

Every chat handler registers via `wrapDataHandler(ctx, key, fn)` or
`wrapActionHandler(ctx, key, fn)` — never `ctx.data.register` / `ctx.actions.register`
directly. The wrapper extracts the viewer id (accepts BOTH `userId` and
`viewerUserId`, `opt-in-guard.ts:137-143` — DEV-15-STRUCTURAL), checks
`clarity_user_prefs.opted_in_at`, and returns `{ error: 'OPT_IN_REQUIRED' }` for
opted-out callers BEFORE the inner handler runs. The handler `Ctx` type extends
`OptInGuardDataCtx` or `OptInGuardActionCtx`.

### UI opt-in / context resolver gate

**Source:** `src/ui/primitives/use-opt-in.ts`, `use-resolved-company-id.ts`,
`use-resolved-user-id.ts`
**Apply to:** `src/ui/surfaces/chat/index.tsx`
Three-gate order LOCKED: `useOptIn` → `useResolvedCompanyId` →
`useResolvedUserId`. Opted-out renders `<EnableClarityCta surfaceName="Chat" />`.
`userId` MUST come from `useResolvedUserId`, not bare `useHostContext().userId`
(production null-userId gap — `bulletin/index.tsx:99-127` is the verbatim
template). `companyId` + `userId` are then threaded into every `usePluginData` /
`usePluginAction` params object.

### Bridge-only host RPC

**Source:** ESLint rule `no-raw-fetch-in-ui`; SDK `usePluginData` /
`usePluginAction` / `usePluginStream` (`@paperclipai/plugin-sdk/ui/hooks`)
**Apply to:** all `src/ui/surfaces/chat/*` files
UI calls the host ONLY via the three bridge hooks — no `fetch`, no raw HTTP.
The worker is the only tier that touches `ctx.issues` / `ctx.db` / `ctx.events`
/ `ctx.streams`. SPA navigation via `useHostNavigation().linkProps`, never raw
`<a href>` (SCAF-09).

### Fully-qualified plugin-namespace SQL

**Source:** `src/worker/db/bulletins-repo.ts`, `migrations/0004_bulletin.sql`
**Apply to:** `migrations/0006_chat.sql`, `src/worker/db/chat-topics-repo.ts`,
any `ctx.db.execute` in handlers
Every table reference is literally `plugin_clarity_pack_cdd6bda4bd.<table>` —
no template substitution. `ctx.db.query` is SELECT-only; writes go through
`ctx.db.execute` (no `RETURNING`) then a read-back SELECT. Company scoping is
enforced in every query (`WHERE company_id = $1` or a JOIN through a
company-scoped table). Conceptual `chat` sub-namespace discipline: no chat
handler touches `bulletins` / `situation_snapshots` / `tldrs` tables and vice
versa (Pitfall — namespace divergence).

### Scoped surface stylesheet + runtime inject

**Source:** `src/ui/styles/bulletin.css`, `src/ui/primitives/clarity-surface-root.tsx`,
`src/ui/index.tsx`
**Apply to:** `src/ui/styles/chat.css`, `src/ui/surfaces/chat/index.tsx`,
`src/ui/index.tsx`
Surface root wraps in `<ClaritySurfaceRoot name="chat">`; every CSS rule is
prefixed `[data-clarity-surface="chat"]`; `chat.css` is imported as a string and
injected via `injectClarityStyles(chatCss, 'data-clarity-pack-chat-styles')` in
`src/ui/index.tsx` (DEV-14 — the host does not auto-load sibling CSS).

## No Analog Found

None. Every Phase 4 file maps to a Phase 2/3 analog in this plugin. The only
file whose directory (`src/worker/streams/`) does not yet exist —
`chat-stream-bridge.ts` — still has a clear pattern analog in the `worker.ts`
`ctx.events.on` block; only the `ctx.streams.emit` re-emit line is new, and
RESEARCH.md "Pattern 2" already specifies its shape.

## Metadata

**Analog search scope:** `src/worker/handlers/`, `src/worker/db/`,
`src/worker/streams/` (absent), `src/worker.ts`, `src/manifest.ts`,
`src/ui/surfaces/` (reader, situation-room, bulletin, chat-stub),
`src/ui/primitives/`, `src/ui/styles/`, `src/ui/index.tsx`, `migrations/`
**Files scanned:** 16 read in full (handlers, repo, opt-in-guard, manifest,
worker, two migrations' worth of shape, four UI surfaces, two stylesheets,
clarity-surface-root, index barrel)
**Pattern extraction date:** 2026-05-18

## PATTERN MAPPING COMPLETE
