---
gsd_doc_type: hotfix
phase: 05-distribution-polish
plan: 05-11
hotfix_id: comment-id-and-chip-click
shipped: 2026-05-26
parent_plan: 05-11-PLAN.md
parent_summary: 05-11-SUMMARY.md
prior_hotfix: 05-11-HOTFIX-DOCUMENT-KEY.md
supersedes_tarball:
  size_bytes: 637697
  sha256: 8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6
new_tarball:
  size_bytes: 633787
  sha256: 6e0ce1e9ce20b8600ca4b790fd56279ee1450a19b5bce45a02087de28e6dac9d
version_literal: 1.0.0
quality_gates_status: all-green
commits:
  - cda1dd2 fix(05-11-hotfix-2): backfill comment_id from chat_messages
  - 4069491 fix(05-11-hotfix-2): wire AttachmentChip click -> DeliverablePreview popover
  - af25f81 chore(05-11-hotfix-2): repack clarity-pack-1.0.0.tgz
  - this-commit docs(05-11-hotfix-2): HOTFIX note + STATE update
---

# Plan 05-11 HOTFIX — comment_id backfill + chip-click overflow-clip

## Symptom

Live operator drill on Countermoves VPS (Hostinger; clarity-pack-1.0.0.tgz
sha256 `8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6`),
2026-05-26 16:23 — 18:30:

**Bug A — comment_id never populated.** Database snapshot showed every
`chat_message_attachments` row carrying `comment_id=<empty>`, even when the
parent `chat_messages` row had its host `comment_id` populated:

```
chat_message_attachments: chat_message_id=c08b8337-... comment_id=<empty>
chat_messages:            message_uuid=c08b8337-... comment_id=cb07af10-... sent_at=16:23:50.406
```

The parent `comment_id` existed by the time `chat.attachment.upload`
fired (Option B upload-on-send semantics — `chat.send` commits the
chat_messages row WITH its host comment_id BEFORE the per-file upload
calls). The upload handler simply never looked it up — it hardcoded
`comment_id: null` when inserting the attachment row.

**Bug B — chips not clickable.** Operator clicked attachment chips in
the right-rail Recent Attachments panel; nothing happened. Plan 05-11
Task 7 + Task 8 wired the chip's onClick to a popover-mounting
DeliverablePreview shell, so a click should have opened a preview. The
operator's observation: "clicking chips in the right-rail (and presumably
in-thread, once they render) does nothing."

## Root cause

### Bug A — denormalization gap

`src/worker/handlers/chat-attachment-upload.ts` step 9 (the
`insertChatMessageAttachment` call) hardcoded `comment_id: null`. The
original Plan 05-11 design left the field as a future-friendly
denormalization but never wrote it. The chat.messages handler's
per-bubble attachment projection actually joins via
`chat_message_attachments.chat_message_id → chat_messages.message_uuid`
(NOT via comment_id), so this gap did not block chip-on-bubble rendering;
the denormalization gap was nonetheless wrong-by-construction and would
surface as soon as ANY consumer keyed on comment_id (right-rail
deep-link to comment, retention scrub by comment author, future bulk
read APIs, etc.).

### Bug B — overflow-clip in the right rail

Plan 05-11 Task 7 / Task 8 shipped the preview popover as
`position: absolute` anchored to a per-chip wrapper `<span>`. The chip's
click handler correctly toggled `open=true` and the popover mounted —
but in the right-rail use-case the `.ctx` container has
`overflow-y: auto`:

```css
[data-clarity-surface="chat"] .ctx {
  --ctx-line: #423f32;
  border-left: 1px solid var(--ctx-line);
  background: var(--bg-2);
  overflow-y: auto;   /* <-- the source of the clip */
  padding: 18px 18px 24px;
  min-height: 0;
}
```

An absolutely-positioned popover is positioned relative to its nearest
positioned ancestor — but it is still SUBJECT to the overflow clipping
of every ancestor whose `overflow` is set. The popover was rendered but
invisible / unreachable behind the rail's overflow context. Chip clicks
were toggling state; the user just couldn't see the result.

The bug was latent in the in-thread chip too — every bubble's
`.bubble` lives inside `.messages { overflow-y: auto }`, so the same
clip would surface as soon as in-thread chips landed in a position
near a bubble edge.

## Fix

### Fix A — backfill comment_id (commit cda1dd2)

`src/worker/handlers/chat-attachment-upload.ts`: between the per-message
size check (step 5) and the `chat_message_attachments` INSERT (step 9),
add a new step 8.5 that SELECTs the parent comment_id from
`chat_messages`:

```ts
let resolvedCommentId: string | null = null;
try {
  const chatMsgRows = await ctx.db.query<{ comment_id: string | null }>(
    `SELECT comment_id
     FROM plugin_clarity_pack_cdd6bda4bd.chat_messages
     WHERE message_uuid = $1 AND company_id = $2
     LIMIT 1`,
    [chatMessageId, companyId],
  );
  resolvedCommentId = chatMsgRows[0]?.comment_id ?? null;
} catch (e) {
  ctx.logger?.warn?.('chat.attachment.upload: comment_id lookup failed', {
    chatMessageId,
    err: (e as Error).message,
  });
}
```

The INSERT then writes `comment_id: resolvedCommentId`. Empty lookup or
thrown lookup gracefully degrades to `null` — the attachment is still
addressable via the right-rail Recent Attachments listing (which keys
on topic_issue_id, not comment_id).

Three new regression tests pin the behaviour:
- happy path: comment_id is resolved + written into the INSERT
- empty lookup: degrades to null without failing the upload
- lookup throws: degrades to null + emits a warn log

### Fix B — fixed-inset backdrop shell (commit 4069491)

`src/ui/surfaces/chat/attachment-chip-with-preview.tsx`: replace the
`position: absolute` popover with a fixed-inset backdrop + centered
body pair, matching the canonical `true-task-dialog` pattern
(`chat.css` line 1343 ff., Plan 04.1-09). The shell ESCAPES every
parent overflow context — the preview is reachable from any caller.

Dismissal protocol now covers three affordances:
- **Escape** closes (keydown listener)
- **Backdrop click** closes (onClick on the backdrop overlay)
- **Close button** in the popover's top-right (aria-labelled "Close preview")

Clicks inside the popover body `stopPropagation` so the operator can
scroll + interact with the preview without bubbling up to the
backdrop's close handler.

`src/ui/styles/chat.css`: three new selectors (all scoped under
`[data-clarity-surface="chat"]`):

```css
.attachment-popover-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(8, 7, 5, 0.75);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.attachment-popover {
  position: relative;     /* was: absolute -- the clip-vector */
  background: var(--bg-1);
  border: 1px solid var(--line-bright, var(--line));
  border-radius: 8px;
  padding: 16px 18px 18px;
  max-width: 720px;
  width: min(720px, 92vw);
  max-height: 80vh;
  overflow: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.attachment-popover-close { /* top-right close affordance */ }
```

Eight new regression tests pin the overflow-clip fix:
- backdrop wrapper exists
- backdrop click closes
- popover body click stops propagation
- close button affordance + aria-label
- role="dialog" + aria-modal="true"
- `.attachment-popover-backdrop` is `position: fixed + inset: 0`
- `.attachment-popover` is NOT `position: absolute` (regression guard)
- backdrop `z-index >= 50`

## Deviations from the requested fix spec

### Deviation 1 — Bug B was wired BUT BROKEN, not unwired

The hotfix-2 spec assumed Bug B was "Plan 05-11 Task 7 was supposed to
make the AttachmentChip clickable... clicking chips in the right-rail
does nothing." The spec then read:

> Likely fix:
> - Add a state hook in the parent component (`<MessageThread>` for in-thread chips, `<ContextRail>` for right-rail chips) that tracks "which chip is open for preview"
> - Chip's onClick toggles this state with its own documentKey

Investigation confirmed onClick **was already wired** — the chip is a
`<button>` when `onClick` is provided (chat-attachment-chip.test.mjs
already pins this), and `AttachmentChipWithPreview` already managed
popover state via `useState` and mounted `<DeliverablePreview>` on
click. The bug was that the popover was getting **clipped behind
`.ctx { overflow-y: auto }`** — the operator's clicks WERE toggling
state but the popover was invisible.

The fix is therefore a CSS / shell rework, not new state-management
plumbing. Rule 1 (auto-fix bug): apply the actual fix, not the
proposed one.

### Deviation 2 — Migration 0012 SKIPPED (validator structural block)

The hotfix-2 spec proposed Fix C as a migration:

```
migrations/0012_chat_attachments_backfill_comment_id.sql
UPDATE chat_message_attachments SET comment_id = (SELECT comment_id FROM
chat_messages WHERE message_uuid = chat_message_attachments.chat_message_id)
WHERE comment_id IS NULL
```

**This is structurally rejected by the host validator.** Per
`test/migrations/ddl-prefix-validator.test.mjs` (line 137):

```js
const DDL_PREFIX = /^(create|alter|comment)\b/;
```

The host's `validatePluginMigrationStatement` rejects ANY statement
whose normalized form does not begin with `create`, `alter`, or
`comment` with API error 400 *"Plugin migrations may contain DDL
statements only"*. `UPDATE` is DML, not DDL, and would fail at
install. This is the same constraint that forced Plan 03-03 to remove
the four `CREATE INDEX` statements during the 2026-05-15 Countermoves
drill.

**Alternative chosen**: Skip the migration entirely. Document the
backfill as a manual SQL block the operator runs ONCE on Countermoves
(see "Manual backfill block" below). The orphan rows are NOT blocking:
- The chat.messages handler joins by `message_uuid`, not `comment_id`,
  so chip-on-bubble rendering already works for them.
- The right-rail Recent Attachments listing keys on `topic_issue_id`,
  so the orphan files are still discoverable + previewable.
- Eric can re-upload to test the comment_id field is now populated; OR
  he can run the one-shot SQL block to backfill the historical rows.

The single-operator, single-tenant deployment makes the manual SQL
block low-risk: Eric runs it once after upgrading; future uploads
through the fixed handler are correct.

## Manual backfill block (operator-runnable on Countermoves)

Run this ONCE on Countermoves after installing the new tarball, via
the existing safety-CLI psql access. The query is idempotent — running
twice is a no-op.

```sql
-- Plan 05-11 Hotfix-2 (comment_id backfill, 2026-05-26)
-- Backfill historical chat_message_attachments rows whose comment_id
-- is NULL because they were inserted before the upload-handler hotfix.
-- Idempotent: WHERE comment_id IS NULL clause makes a re-run a no-op.

UPDATE plugin_clarity_pack_cdd6bda4bd.chat_message_attachments AS a
SET comment_id = m.comment_id
FROM plugin_clarity_pack_cdd6bda4bd.chat_messages AS m
WHERE a.chat_message_id = m.message_uuid
  AND a.company_id = m.company_id
  AND a.comment_id IS NULL
  AND m.comment_id IS NOT NULL;

-- Expected rowCount on Countermoves: 2 (per 2026-05-26 drill database snapshot).
-- Verify via:
SELECT count(*) AS still_null
FROM plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
WHERE comment_id IS NULL;
-- Expected: 0 (or N where N is the count of uploads whose parent
--           chat_messages row also lacks a comment_id -- those stay
--           orphan-safe-degraded per the handler contract).
```

## Verification

Quality gates re-run against the new binary (post-repack):

- `tsc --noEmit` — clean.
- `check-css-scope.mjs` — 121 selectors, all scoped under `[data-clarity-surface]`.
- `check-ui-bundle-size.mjs` — 658.3 kB (under 675 kB ceiling).
- `node --test "test/**/*.test.mjs"` — 1811 pass / 0 fail / 2 skipped (1813 total).
- `dist/worker.js` LOADS OK smoke (no startup crash).

CTT-07 invariant verified (no `ctx.issues.update` added — the
comment_id lookup is a plugin-namespace SELECT only). Test 10 in
`chat-attachment-upload.test.mjs` continues to pin
`issueUpdateCalls.length === 0` across every code path.

## On-VPS rehearsal checklist (operator-runnable)

1. **Snapshot**: `node scripts/safety/cli.mjs snapshot --db-url=...`
   (rehearsed pre-flight; matches the bookended-by-snapshots rule).
2. **Uninstall current**: `cd ~/paperclip && pnpm paperclipai plugin uninstall clarity-pack`
   (preserves data per coexistence guarantee #6 — additive-only migration
   semantics + plugin-namespace lives across reinstalls).
3. **Install new tarball**:
   `cd ~/paperclip && pnpm paperclipai plugin install /path/to/clarity-pack-1.0.0.tgz`
   (verify sha256 = `6e0ce1e9ce20b8600ca4b790fd56279ee1450a19b5bce45a02087de28e6dac9d`).
4. **Run the manual backfill SQL block** above (psql session).
5. **Drill**:
   - Open a chat topic → attach a file → Send. New attachment row should
     land in chat_message_attachments WITH a populated comment_id (verify
     via psql).
   - Click an existing chip in the right-rail Recent Attachments panel.
     A centered modal preview overlay should appear (NOT a clipped
     popover). Escape, backdrop click, OR the top-right × button all
     close.
   - Click a chip on a chat bubble (after sending an attachment in the
     active session). Same modal preview shell — full-fidelity preview
     for pdf / xlsx / md / png.
6. **Spot-check verification SQL**:
   ```sql
   SELECT count(*) AS still_null FROM
     plugin_clarity_pack_cdd6bda4bd.chat_message_attachments
   WHERE comment_id IS NULL;
   ```
   Expected: 0 after the manual backfill + the new upload.

## Files touched

- `src/worker/handlers/chat-attachment-upload.ts` — Fix A (comment_id
  lookup + insertChatMessageAttachment param).
- `src/ui/surfaces/chat/attachment-chip-with-preview.tsx` — Fix B
  (backdrop + body shell; Escape / outside-click / close-button
  dismissal protocol).
- `src/ui/styles/chat.css` — Fix B (new
  `.attachment-popover-backdrop` + reworked `.attachment-popover` +
  `.attachment-popover-close` selectors).
- `test/worker/handlers/chat-attachment-upload.test.mjs` — three new
  regression tests pinning the backfill behaviour.
- `test/ui/chat-message-thread-attachments.test.mjs` — eight new
  regression tests pinning the backdrop shell + CSS-fixed-not-absolute
  invariant.

## Tarball metadata

| Field         | Before (post hotfix-1)                                                | After (this hotfix)                                                  |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| size_bytes    | 637,697                                                               | 633,787                                                              |
| sha256        | `8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6`    | `6e0ce1e9ce20b8600ca4b790fd56279ee1450a19b5bce45a02087de28e6dac9d`   |
| version       | 1.0.0                                                                 | 1.0.0 (unchanged — hotfix policy)                                    |
| UI bundle     | 658.3 kB                                                              | 658.3 kB                                                             |
| worker bundle | 2.1 MB                                                                | 2.1 MB                                                               |
