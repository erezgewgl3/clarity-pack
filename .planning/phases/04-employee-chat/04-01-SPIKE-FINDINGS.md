# Plan 04-01 Spike Findings

**Date:** 2026-05-18 (probe run completed 2026-05-18T20:48:12Z)
**Target:** live Countermoves Paperclip instance (`http://127.0.0.1:3100`, company `62b33a78-4f4a-4ab7-9977-a27be86f9853`)
**Operator:** Eric
**Probe:** `scripts/spike/chat-spike-probe.mjs` (throwaway harness; commits b91d887, route fix d36c81c)
**Probe output:** `.planning/phases/04-employee-chat/04-01-probe-output.txt` (run 2, lines 479-613, is the valid result)
**Spike employee-agent:** CEO agent `b2a22e50-d772-4b70-bb50-4f4e93c2e984` (NOT the Editor-Agent)
**Snapshot bookend:** verified pre-run snapshot `2026-05-18T20-15-56Z` taken before the probe (CLAUDE.md bookended-by-snapshots rule).

This is a falsify-first spike. It builds ZERO chat code. It probes the four load-bearing
assumptions of Phase 4 against the live host and records an empirical verdict per question.
Plans 04-02..04-06 are gated on the verdict at the bottom of this doc.

---

## D-01 / OQ-4 — Native agent wake + reply form

**VERDICT: PASS** — the employee-agent woke on a posted comment and replied with a comment.

### Evidence

The probe created a parent issue `Chat -- CEO [SPIKE]` (`eba2ed7a-8ebe-4a85-b0bf-bf7f3f6817f8`)
and a child topic issue `Spike topic [SPIKE]` (`fc1a0339-c9f8-4910-9675-1fc74a2b51aa`), assigned
the child to the CEO employee-agent, and gave the child issue description the literal instruction
"Reply to comments on this issue by posting a COMMENT on this issue (not a document)." The probe
posted a prompt comment ("What is 2 + 2? Reply with a comment.") and polled `listComments` for
up to 8 minutes.

The CEO employee-agent woke on the native `issue_commented` heartbeat and replied within the
poll window. The reply landed as an `issue_comments` row, NOT a document:

```json
{
  "id": "97d84be4-698d-4def-a98a-0ba9f137f9c4",
  "issueId": "fc1a0339-c9f8-4910-9675-1fc74a2b51aa",
  "authorAgentId": "b2a22e50-d772-4b70-bb50-4f4e93c2e984",
  "authorUserId": null,
  "authorType": "agent",
  "createdByRunId": "c2fab5c9-531f-4c10-a9f1-7ee1565b861c",
  "body": "2 + 2 = **4**.",
  "createdAt": "2026-05-18T20:46:35.439Z"
}
```

- Reply form: **comment** (an `issue_comments` row).
- Reply author field: **`author_agent_id`** is set; `author_user_id` is null; `author_type` is `"agent"`.
- Documents filed by the agent during the same run: **0** — the agent did not also file a document.

### Significance

The `issue_commented` native heartbeat wake — implementation-ahead-of-spec, only MEDIUM
confidence in 04-RESEARCH.md (Pitfall 5, Assumption A4) — is **proven on the host version
installed on Countermoves**. Phase 4 builds ZERO agent-delivery code; the entire chat reply
loop rests on this native behaviour, and it holds.

The Phase 3 surprise (the Editor-Agent filed documents instead of comments — 04-RESEARCH.md
Assumption A5) did NOT recur: a plain employee-agent, given the reply-channel instruction in
the topic issue description, replied with a comment as instructed.

### Design input for downstream plans

- **04-03** must put an explicit "reply by posting a comment on this issue (not a document)"
  instruction in every NEW topic issue's description. D-14 already plans a reasoning-block
  instruction in the topic description — fold the reply-channel instruction into the same
  description block. The probe used this instruction and the agent complied; do not ship a
  topic-creation path without it.

## OQ-2 — issue.comment.created payload / comment row shape

**Recorded.** The probe runs outside the worker process, so it cannot subscribe to `ctx.events`
and cannot observe the raw `issue.comment.created` event payload directly. It recorded the
`listComments` re-fetch shape instead — which is the shape the 04-03 stream bridge will work
with regardless.

### Evidence

The comment row returned by `listComments` carries these keys:

```
id, companyId, issueId, authorAgentId, authorUserId, authorType,
createdByRunId, body, presentation, metadata, createdAt, updatedAt
```

The row carries both `issueId` and the full `body`. `presentation` and `metadata` were both
null on the agent reply.

### Design decision for 04-03

The stream bridge in 04-03 derives the comment from `event.entityId` (the issue id) plus a
`listComments` re-fetch — the safe default per 04-RESEARCH.md Pattern 2 and Assumption A1.
The comment row carries `issueId` + full `body`, so once re-fetched the bridge has everything
it needs: the new comment id, its body, its author fields, and its `createdAt` for ordering.

If a future direct event-payload inspection inside the worker proves the `issue.comment.created`
payload already carries the comment id and body, that is an optimization — not a redesign. The
re-fetch path is correct either way and is the planned default.

## OQ-3 — auto-reopen re-wake

**VERDICT: STATUS-FLIP-NOT-NEEDED** — a comment posted on a `done` topic alone re-wakes the
assigned agent. No status flip and no `requestWakeup` call are required to wake the agent.

### Evidence

The probe set the child topic issue status to `done` (HTTP 200), then posted a re-wake comment
("Re-wake test -- reply with a comment.", HTTP 201). The CEO employee-agent replied with the
issue still in `done` status — the comment alone woke it. The probe never had to reach its
fallback steps (status flip, then `requestWakeup`).

This settles 04-RESEARCH.md OQ-3 and Assumption A2: D-06's `resume` flag is not a typed SDK
field, and it is not needed — the native `issue_commented` wake fires regardless of issue status.

### Design input for downstream plans

- **04-03** chat-send auto-reopen path (D-06): the agent wake itself is FREE — posting the
  comment is sufficient to wake the assigned agent even on a `done` topic. 04-03 need NOT call
  `ctx.issues.requestWakeup` purely to get a reply.
- 04-03 SHOULD still flip a `done` topic back to `in_progress` on send for **UX and status
  correctness** (a topic the user is actively messaging should not read as `done` in classic
  Paperclip). That flip is a status-hygiene concern, not a wake mechanism. The `issues.wakeup`
  capability remains declared but is not on the critical reply path.

## OQ-1 — attachment upload path

**VERDICT: NO-PATH** — no plugin-accessible attachment-upload path exists on the live host.
CHAT-07 ships as the steady-state degraded path.

### Evidence

The probe attempted, in order, every plausible upload/write route and recorded the exact
status:

| Attempt | Route | Status | Result |
|---------|-------|--------|--------|
| document upsert with base64 body | `POST /issues/{id}/documents` | 404 | "API route not found" — not stored |
| company-scoped attachments | `GET /api/companies/{id}/attachments` | 404 | route absent |
| per-issue attachments | `GET /api/issues/{id}/attachments` | 200 | **route responds — a read-side lead** |
| company-scoped uploads | `GET /api/companies/{id}/uploads` | 404 | route absent |
| global uploads | `GET /api/uploads` | 404 | route absent |
| assets write | `POST /companies/{id}/assets` | 404 | no assets write route |

- `pathFound`: **false** — no route stored a retrievable file.
- `retrievableFile`: **false**.

This confirms 04-RESEARCH.md Pitfall 2 and OQ-1 against the live host: SDK 2026.512.0 exposes
no `ctx.assets` and no upload method, and the host exposes no plugin-accessible multipart or
asset-write route. PLUGIN_SPEC §8.1's "plugin asset APIs are future-scope" holds on the
running Countermoves version.

### The one lead

`GET /api/issues/{id}/attachments` returned **HTTP 200** — a read-side attachments route exists
on a per-issue basis. It is NOT an upload affordance (the probe found no write path), but it is
a route 04-04 should inspect when building the attachment UI: it may let the chat surface
*display* attachments that arrive through classic Paperclip, even though the chat composer
cannot *create* them.

### Design input for downstream plans

- **CHAT-07 ships degraded as the v1 steady state**, exactly as 04-RESEARCH.md planned: the
  attach button is permanently disabled with an explicit "Attachments are temporarily
  unavailable" message. This is a valid, requirement-satisfying implementation of CHAT-07's
  graceful-degrade clause — not an error fallback.
- **04-04** builds the disabled-attach UI. It should also inspect the `GET /api/issues/{id}/attachments`
  200 route to decide whether a read-only attachment display is cheap to add.
- This is a scope correction to flag at the next phase transition — analogous to D-07's
  "private" correction. No plan in Phase 4 may promise working chat-composer uploads.

## Phase 4 Gate Verdict

**GO** — Plans 04-02, 04-03, 04-04, 04-05, 04-06 are cleared to proceed.

D-01 — the load-bearing assumption that gates the entire phase — is empirically proven on the
live host: an employee-agent wakes on a posted comment and replies as an `issue_comments` row.
Without that, the chat reply loop would be dead and the phase would need re-scoping. With it,
Phase 4 is a thin UI + side-table + worker-handler build over native Paperclip behaviour.

### Design inputs for downstream plans

- **Reply-channel instruction needed: YES.** 04-03 must fold an explicit "reply by posting a
  comment on this issue (not a document)" instruction into every new topic issue's description
  (alongside D-14's reasoning-block instruction). The probe proved the agent obeys it.
- **requestWakeup needed for the reply: NO.** Posting a comment alone wakes the assigned agent,
  even on a `done` topic. 04-03's auto-reopen path flips `done` to `in_progress` for UX/status
  correctness only — it does not need `ctx.issues.requestWakeup` to get a reply.
- **Stream bridge comment derivation: re-fetch.** 04-03's `issue.comment.created` stream bridge
  derives the comment from `event.entityId` + a `listComments` re-fetch. The comment row carries
  `issueId` + full `body` + author fields + `createdAt`, so the re-fetch is sufficient.
- **Attachments degraded: YES.** No plugin-accessible upload path exists. CHAT-07 ships with the
  attach button permanently disabled and an explicit unavailable message. 04-04 builds the
  disabled-attach UI; it should inspect the `GET /api/issues/{id}/attachments` 200 route as a
  possible read-only display affordance. Flag the scope correction at the next phase transition.

### REST route fact (verified live)

Issue and agent COLLECTION routes are company-scoped (`/api/companies/{id}/issues`,
`/api/companies/{id}/agents`). Per-issue SUB-routes are FLAT (`/api/issues/{id}`,
`/api/issues/{id}/comments`, `/api/issues/{id}/wakeup`, `/api/issues/{id}/documents`,
`/api/issues/{id}/attachments`). Discovered during the probe; the route fix is commit d36c81c.
Downstream plans that touch the REST surface directly must honour this split.

## SPIKE COMPLETE
