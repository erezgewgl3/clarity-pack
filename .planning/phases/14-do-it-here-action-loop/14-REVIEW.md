---
phase: 14-do-it-here-action-loop
reviewed: 2026-06-03T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - migrations/0016_reply_resume_dedup.sql
  - src/worker/db/reply-resume-repo.ts
  - src/worker/handlers/situation-reply-and-resume.ts
  - src/worker.ts
  - src/worker/situation/build-employees-rollup.ts
  - src/worker/handlers/org-blocked-backlog.ts
  - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
  - src/shared/reply-reachable.ts
  - src/ui/surfaces/_shared/reply-in-place.tsx
  - src/ui/surfaces/situation-room/employee-row.tsx
  - src/ui/surfaces/reader/live-blocker-panel.tsx
  - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: resolved
resolved: 2026-06-03T00:00:00Z
resolution: all 6 findings fixed (CR-01 3dc4752, WR-02 baf8df3, WR-01+IN-01 63f5106, WR-03 32c6939, IN-02 b62e51a)
---

# Phase 14: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** deep
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 14 implements the Do-It-Here Action Loop — the first UI path that writes to the live Paperclip model via operator-initiated reply-and-resume. The core implementation is structurally sound: the TOCTOU concern is correctly mitigated by the Postgres `ON CONFLICT DO NOTHING` (not a read-then-write race in the dedup path), the dedup row is correctly inserted AFTER a confirmed comment (so a failed comment leaves no orphan that would permanently block a retry), the Shape-B flip is non-fatal (comment already triggers native resume), the messageUuid is correctly reused on Retry via `pendingMessageUuid.current`, and the await-confirm state machine is honest throughout.

However, there is one BLOCKER: the `situation.replyAndResume` handler accepts a caller-supplied `leafIssueUuid` with no server-side validation that the UUID is actually reachable from the company the caller claims. An opted-in user can craft a payload with `companyId=their-company` and `leafIssueUuid=<any-other-company-issue-UUID>` and post a comment on an issue outside their company. The `createComment(leafIssueUuid, body, companyId)` call passes the company scope, but the host SDK may silently succeed if the UUID resolves (the host likely doesn't cross-check the UUID against the company). The assign-owner handler avoids this by calling `ctx.agents.get(assigneeAgentId, companyId)` as an explicit gate — no analogous gate exists here.

Three warnings cover: a stale-closure risk that could cause `needsDurabilityFlip` to flip silently on a Retry, an incorrect `leafIssueId` passed to `OwnerPickerPopover` in the backlog expander (UUID sent where a human key is expected), and a missing `onActed` call on the Reader panel that leaves a stale confirmed-action row without triggering a re-poll.

---

## Critical Issues

### CR-01: No server-side validation that `leafIssueUuid` belongs to the caller's company

**File:** `src/worker/handlers/situation-reply-and-resume.ts:71-106`

**Issue:** The handler reads `leafIssueUuid` entirely from caller-supplied params and passes it directly to `ctx.issues.createComment(leafIssueUuid, body, companyId)` and `ctx.issues.update(leafIssueUuid, ...)`. There is no step that verifies the UUID actually refers to an issue within `companyId`.

`situation.assignOwner` explicitly gates on `ctx.agents.get(assigneeAgentId, companyId)` and returns `NOT_FOUND` if the agent is not in the caller's company. No equivalent gate exists in `replyAndResume`. The opt-in guard only checks that the caller is opted in; it does not validate the mutation target.

The same-origin trust model means plugin UI code can call this action handler directly with arbitrary params — a malicious or curious opted-in user can enumerate issue UUIDs from another context and post comments on them by simply supplying a valid `companyId` (their own) and an arbitrary `leafIssueUuid`.

**Fix:** Add a pre-mutation company-scope gate by fetching the target issue before writing:

```typescript
// After extracting leafIssueUuid and companyId, before createComment:
let targetIssue: unknown;
try {
  targetIssue = await ctx.issues.get(leafIssueUuid, companyId);
} catch (e) {
  return { error: 'NOT_FOUND' as const };
}
if (!targetIssue) {
  return { error: 'NOT_FOUND' as const };
}
// proceed with createComment / update
```

This mirrors situation-assign-owner's `ctx.agents.get` gate. The host SDK's `issues.get(uuid, companyId)` already scopes to the company; a UUID from another company returns null.

---

## Warnings

### WR-01: `needsDurabilityFlip` stale-closure risk on Retry after prop change

**File:** `src/ui/surfaces/_shared/reply-in-place.tsx:130-194`

**Issue:** `pendingMessageUuid.current` is deliberately preserved across renders so a Retry reuses the same dedup key. However, `dispatchReply` is a `useCallback` that closes over `needsDurabilityFlip` as a dependency. If the worker snapshot re-polls between the first failed send and the Retry and the leaf issue's status has changed (e.g., an agent un-blocked the issue and `needsDurabilityFlip` went from `true` to `false`), the user hits Retry and the SAME `messageUuid` is re-submitted — but now with the UPDATED `needsDurabilityFlip` value from the freshly recreated closure.

The server's dedup check sees the `messageUuid` already in the table (from the failed original attempt) and returns the cached result **without** re-executing — which is correct behavior. The real risk is the reverse: if the first attempt SUCCEEDED (comment posted, dedup row inserted, but ACK was lost), the Retry returns the cached `{ ok: true }` response. In this scenario there is no double-post and the stale closure value is irrelevant. The closure risk is real but self-mitigated by the dedup row in the success path.

The actual live risk is narrower: the window between Send click and setSending(true) — if the user double-clicks faster than the `if (sending) return` guard, two concurrent dispatches with different `messageUuid` values could race. But `pendingMessageUuid.current` is set synchronously before the `await`, so both concurrent calls would snapshot the same UUID immediately after the first sets it.

**Assessment:** The self-mitigation is real but the reasoning is load-bearing and non-obvious. The guard is: (a) `if (sending) return` prevents concurrent sends within one component instance, (b) dedup on the server prevents double-posts even if two sends do race through. Document this dependency in the component or add an additional guard (e.g., `setSending` before reading `pendingMessageUuid.current` to eliminate the window).

**Fix:** Move `pendingMessageUuid.current` assignment to before the async boundary and ensure it is atomic with `setSending(true)`:

```typescript
const dispatchReply = React.useCallback(async (replyBody: string) => {
  if (sending) return;
  const text = replyBody.trim();
  if (!text) return;
  // Mint / reuse the UUID BEFORE any await — atomic with the sending guard
  const messageUuid = pendingMessageUuid.current ?? freshMessageUuid();
  pendingMessageUuid.current = messageUuid;
  setSending(true);  // moved AFTER uuid assignment, before await
  // ...rest unchanged
```

The current code sets `pendingMessageUuid.current = messageUuid` after `setSending(true)` — a one-line reorder eliminates the tiny window.

---

### WR-02: `OwnerPickerPopover` in `blocked-backlog-expander.tsx` receives a UUID where a human identifier is expected

**File:** `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx:129-135`

**Issue:** The `OwnerPickerPopover` in the assign branch of the backlog expander is passed `leafIssueId={row.issueId}`, where `row.issueId` is `issue.id ?? issue.identifier ?? ''` (see `org-blocked-backlog.ts:529` and the row emit at line 537). `issue.id` is the Postgres UUID, so on rows where the issue has an `id` field, `issueId` is a UUID, not a human identifier.

`OwnerPickerPopover`'s prop type names this field `leafIssueId` and the JSDoc says "HUMAN display key + the log/echo identifier — NOT the mutation id". The popover dispatches `situation.assignOwner` with `leafIssueUuid: leafIssueUuid ?? leafIssueId` — so when no `leafIssueUuid` is passed (as is the case here, since the backlog expander mount omits `leafIssueUuid`), the fallback is `row.issueId` (the UUID) used AS the mutation id AND as the echo key. The assignment would still work (the handler gets the UUID it needs), but the UI toast would echo the UUID as the "issue id", violating NO_UUID_LEAK.

Additionally, the `OwnerPickerPopover` here does not receive `leafIssueUuid` at all, so the "OPTIONAL" UUID prop comment in owner-picker-popover.tsx line 64 ("the org-backlog mount passes only leafIssueId (already a UUID)") was written when `OrgBlockedRow.issueId` was always a UUID. Now with 14-04 adding `leafIssueUuid` to the row type, the correct fix is to pass the leaf UUID explicitly so the root UUID stays out of the display path.

**Fix:**
```tsx
<OwnerPickerPopover
  leafIssueId={row.identifier}   // human display key (already correct on other mounts)
  leafIssueUuid={row.issueId}    // the root UUID (mutation id for single-hop chains)
  companyId={companyId}
  userId={userId}
  triggerLabel="Assign ▾"
  onAssigned={() => onAssignSuccess()}
/>
```

Note: For multi-hop backlog chains the leaf UUID should ideally be `row.leafIssueUuid` (the chain terminus, not the root). This is the same CR-01 multi-hop ambiguity documented in `live-blocker-panel.tsx:236-256`. Passing `row.leafIssueUuid ?? row.issueId` would be more correct.

---

### WR-03: Reader `LiveBlockerPanel` `onActed={() => {}}` no-op — confirmed reply leaves stale row

**File:** `src/ui/surfaces/reader/live-blocker-panel.tsx:298-313`

**Issue:** The `<ReplyInPlace>` mount in `LiveBlockerPanelWithCompany` passes `onActed={() => {}}` — a deliberate no-op justified by the comment "usePluginData re-polls the panel". The reasoning is that `usePluginData('flatten-blocker-chain', ...)` will re-run on its own poll interval and pick up the now-resolved blocker.

The problem is timing. After a successful reply the `ReplyInPlace` primitive calls `onActed()` (which is a no-op here), clears the input, and shows a success toast. The panel continues displaying the stale "⚑ ON YOU" / AWAITING_HUMAN state until the next `usePluginData` poll fires. There is no force-refetch triggered. Depending on the poll interval, the operator sees a confusing state: the toast says "Replied" but the panel still says the issue is blocked on them.

The Situation Room row passes `onActed={onAssignSuccess}` which calls the parent's snapshot force-refetch. The Reader panel has no equivalent mechanism because `usePluginData` manages its own re-fetch — but it exposes a `refetch` or equivalent if one is available on the hook's return value.

**Fix:** If the `usePluginData` hook returns a `refetch` function, call it from `onActed`:

```tsx
const { data, refetch } = usePluginData<BlockerChainResult>('flatten-blocker-chain', {
  startId: issueId,
  viewerUserId,
  companyId,
});
// ...
<ReplyInPlace
  onActed={() => { refetch?.(); }}
  // ...rest unchanged
/>
```

If `usePluginData` does not expose `refetch`, the only alternative is to track a local `repliedAt` state and key the `usePluginData` call on it to force a re-mount. Either way, a no-op is wrong here — the user deserves an immediate UI update after a confirmed mutation.

---

## Info

### IN-01: `dispatchReply` callback dependency on `sending` state causes closure recreation on every send attempt

**File:** `src/ui/surfaces/_shared/reply-in-place.tsx:182-194`

**Issue:** `sending` is listed as a dependency of the `dispatchReply` useCallback. This means the callback reference changes every time `sending` flips (on Send click and on final `setSending(false)`). Components downstream that receive `dispatchReply` as a prop would re-render. The `if (sending) return` guard could also be achieved without a dependency by reading a ref.

This is a quality issue, not a correctness bug (the guard is sound), but it causes unnecessary callback churn for the lifetime of the component.

**Fix:** Use a ref for the sending guard to remove `sending` from deps:

```typescript
const sendingRef = React.useRef(false);
const dispatchReply = React.useCallback(async (replyBody: string) => {
  if (sendingRef.current) return;
  // ...
  sendingRef.current = true;
  setSending(true);
  try { /* ... */ } finally {
    sendingRef.current = false;
    setSending(false);
  }
}, [reply, companyId, mutationIssueUuid, leafIssueId, userId, needsDurabilityFlip, awaitedPartyLabel, showToast, onActed]);
```

---

### IN-02: `leafStatus` fallback in `org-blocked-backlog.ts` treats `leafId !== rootId && leafId !== null && nodeMeta[leafId]` missing as `needsDurabilityFlip = false` — then sends a comment-only flip signal to an issue that may be status=`blocked`

**File:** `src/worker/handlers/org-blocked-backlog.ts:531-535`

**Issue:** The `leafStatus` derivation is:

```typescript
const leafStatus =
  (leafId && nodeMeta[leafId]?.status) ||
  (leafId === rootId || leafId == null ? 'blocked' : null);
```

When `leafId` is non-null AND `leafId !== rootId` AND `nodeMeta[leafId]` is absent or has no `status`, the expression evaluates to `null`. This means `needsDurabilityFlip = false`.

The scenario: a multi-hop chain where the chain terminus (`targetIssueUuid`) was NOT walked as a `blockedBy` node by `buildEdges` (it appeared only as a terminal node with no outgoing edges). In this case `nodeMeta` would not have an entry for it. The leaf issue could be `status='blocked'` in reality, but the flip flag would be `false`.

The consequence: for multi-hop chains where the leaf node is not in `nodeMeta`, the operator sends a comment-only reply (Shape A), which is the correct spike-safe behavior — the comment alone triggers the native resume. The only cost is missing the durable Shape-B flip. This is the conservative-correct behavior.

Document the intentional conservative fallback explicitly in code to prevent a future reader from "fixing" it to a broader fallback that over-fires the flip.

**Fix (documentation only):**
```typescript
const leafStatus =
  (leafId && nodeMeta[leafId]?.status) ||
  // Conservative fallback: when the leaf node was not walked as a blockedBy
  // node (e.g. it is the terminal of a chain whose edges we didn't traverse),
  // fall back to 'blocked' ONLY when the leaf IS the root (single-hop; root
  // is status=blocked by the list filter). Multi-hop chains with an absent
  // leaf nodeMeta get null → needsDurabilityFlip=false (comment-only, spike-safe).
  (leafId === rootId || leafId == null ? 'blocked' : null);
```

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
