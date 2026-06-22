# Phase 23: Task-anchoring & native conversation lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 23-task-anchoring-native-conversation-lifecycle
**Areas discussed:** Operator-message attribution (REPLY-01), Existing-task chat entry (ANCHOR-02), Per-employee grouping view (ANCHOR-03)

Areas offered but not selected: New-conversation anchor shape (ANCHOR-01) — taken at Claude's discretion.

---

## Operator-message attribution (REPLY-01)

| Option | Description | Selected |
|--------|-------------|----------|
| UI-direct under operator session | Plugin UI posts the comment to Paperclip's HTTP comment API under the operator's own logged-in session → host attributes `authorType:user` natively; opt-in/dedup relocate off the worker. | ✓ |
| Worker with attribution override | Keep the write in `chat-send.ts`; research a host/SDK option to post as the operator's userId. Risk: spike found the worker path stamps `system`; may not exist. | |
| Research decides, I'll review | Lock only the requirement (operator messages MUST be user-attributed), not the mechanism. | |

**User's choice:** UI-direct under operator session.
**Notes:** Consistent with the same-origin trust model — plugin UI is trusted same-origin JS that can call Paperclip HTTP APIs directly. Opt-in gate + dedup relocation flagged as a planner detail (D-02), not a re-decision. Agent self-comment suppression already handled natively by the host (Phase 22 SC2).

---

## Existing-task chat entry (ANCHOR-02)

### Entry points (multi-select)
| Option | Description | Selected |
|--------|-------------|----------|
| From the Reader view | Reuse Phase 4.2-07 Reader→Chat continuation routing (`origin_issue_id` + assignee reverse-lookup). | ✓ |
| From a chat-side task picker | Pick an existing task within the Chat surface. | ✓ |
| From Situation Room rows | Start a conversation about a task from an action-card / row. | ✓ |

### Done-task chat behavior (single)
| Option | Description | Selected |
|--------|-------------|----------|
| Yes — reopen is intended | A question on a finished deliverable natively reopens it + re-wakes the assignee. The native loop we want. | ✓ |
| Steer terminal tasks to a conversation | Route chat on a DONE work-task to a separate linked conversation anchor instead. | |

**User's choice:** All three entry points; reopen-on-chat is the intended native behavior.
**Notes:** Comments attach directly to the existing task issue (design spec §5.1, D-04) — not a separate linked conversation.

---

## Per-employee grouping view (ANCHOR-03)

### Roster model (single)
| Option | Description | Selected |
|--------|-------------|----------|
| Keep employee-grouped, re-source from query | Visually identical roster; grouping computed from query-by-assignee instead of a "Chat — X" container issue. | ✓ |
| Unified recency inbox | Flat conversation list sorted by activity; employee = label/filter. | |
| Two-pane messenger | Employee list left, selected employee's conversation(s) right. | |

### Multiple conversations per employee (single)
| Option | Description | Selected |
|--------|-------------|----------|
| Explicit '+ New conversation' per employee | Show open anchors; deliberate continue-or-new. | ✓ |
| One active conversation per employee | Single 'current' anchor; new messages continue/reopen it. | |

**User's choice:** Keep employee-grouped roster re-sourced from an assignee query; explicit "+ New conversation" per employee.
**Notes:** Least UX churn; matches existing mockups / sketch-findings. Intersects ANCHOR-01 → lazy anchor creation on first message (D-09).

---

## Claude's Discretion

- New-conversation anchor shape (ANCHOR-01): lazy creation on first message (no empty garbage), assigned to the chatted employee; title/`goalId`/initial-status convention left to research/planning (D-09).
- Exact UI-direct attribution wiring, dedup/idempotency after the write moves, and where the opt-in gate re-lands (D-02).
- The read-only stale/lingering-conversation detector (design §7) — include or defer is a planner call; must be read-only if included (CONV-03).

## Deferred Ideas

- Visual Conversation-vs-work distinction + exclusion from active-tasks rails (CONV-04) — Phase 25.
- Delete topic-watchdog + stop creating Chat-X containers + clean stranded artifacts (BEAAA-6704/7027) — CLEAN-01/02, Phase 25.
- Propose→confirm→delegate, cross-agent child-issue delegation, in-thread status, convert-to-task backstop (DELEG-01..05/REPLY-02) — Phase 24.
- Full conversation-brief rewrite (design §8.5) — Phase 24; Phase 23 needs only the lifecycle half (take conversation `done` when concluded — CONV-01).
