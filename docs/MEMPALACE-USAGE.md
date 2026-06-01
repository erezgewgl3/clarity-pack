# MemPalace — Usage Guide (drop into each project's knowledge area)

> **Canonical source:** `~/.mempalace/MEMPALACE-USAGE.md`. Re-paste from here when it
> changes — do not hand-edit per-project copies (they drift).
> **For repair/operator procedures** (corruption, rebuilds, swaps) see the separate
> `~/.mempalace/MEMPALACE-RUNBOOK.md`. Everyday agents should NOT attempt repairs — see §5.

MemPalace gives the assistant a persistent, searchable memory across sessions and
projects (an embedded vector + full-text store). This guide is how to **use** it well.

---

## 1. The core protocol (do this, always)
1. **On wake-up:** call `mempalace_status` to load the palace overview.
2. **Before answering about any person, project, past event, decision, or defect:**
   call `mempalace_search` (or `mempalace_kg_query`) FIRST. **Never guess from memory of
   the conversation — verify.** Wrong is worse than slow.
3. **If unsure of a fact** (name, id, date, status): say "let me check" and query.
4. **At end of substantive work:** file what was decided/learned (see §3).
5. **When facts change:** `mempalace_kg_invalidate` the old fact, then `mempalace_kg_add`
   the new one — don't just file a contradiction.

Recalled memories are background context reflecting what was true *when written* — if one
names a file/flag/id, verify it still exists before acting on it.

---

## 2. Searching
- `mempalace_search query="…"` — hybrid vector + BM25.
- Add `wing="<project>"` and/or `room="<aspect>"` to scope (e.g. `wing="clarity_pack"`,
  `room="decisions"`).
- If a scoped search errors or returns nothing surprising, retry **unscoped** and put the
  wing/topic in the query text — then tell the operator (see §5). Unscoped almost always works.

---

## 3. Filing (writing memories)
- **`mempalace_check_duplicate` BEFORE every `mempalace_add_drawer`.** Don't create
  near-duplicates.
- File **verbatim** content (exact decisions, quotes, ids, commands) — not summaries.
- Put it in the right **wing** (project) and **room** (aspect: `decisions`, `runbook`,
  `technical`, `research`, `general`, dated `session-YYYY-MM-DD`, …).
- **Never store secret VALUES** (API keys, tokens, passwords). Store *facts about* them
  (where it lives, how to rotate, which env var) — never the secret itself.

### Knowledge-graph (KG) writes
- `mempalace_kg_add` for new facts; **`mempalace_kg_invalidate`** (with an end date) for facts
  that are no longer true — superseding, not contradicting.
- Keep KG object values **short (< ~128 chars)** and specific.
- One entity per subject (e.g. an agent layer, a component); attach many facts to it over time.

---

## 4. Multi-window / multi-agent safety
- Multiple Claude/Codex windows can use MemPalace **safely as of v3.3.6** — it has an
  automatic cross-process lock that serializes writes (no corruption, no hangs).
- **Requirement:** every window/agent must be on **MemPalace ≥ 3.3.6** and use the same
  palace + the `minilm` embedding model. Check with `mempalace --version` (must say 3.3.6+).
  A window started before an upgrade still runs old code — restart it. When unsure, restart.
- **Only ever write through MemPalace** (its MCP tools / `mempalace` CLI). Never write the
  store with a raw `chromadb`/SQLite client — that bypasses the lock and can corrupt it.
- Don't run heavy `mempalace mine` in several windows at once — one is enough; the others
  just back off.

---

## 5. If MemPalace looks broken — DO NOT self-repair
Symptoms: `mempalace_status` shows `vector_disabled: true`; scoped search throws
`Error finding id`; "malformed inverted index" errors; or search returns nothing it should.

Do this (all read-only / safe):
1. `mempalace repair-status` — read-only health (SQLite vs HNSW counts). Never opens a writer.
2. `mempalace_reconnect` — sometimes clears a transient post-write state.
3. If still broken: **keep using unscoped search + BM25/room filters as a fallback**, and
   **tell the operator (Eric) that a repair may be needed** — point them at
   `~/.mempalace/MEMPALACE-RUNBOOK.md`.

**Do NOT** run `mempalace repair`, rebuild the index, delete segments, or open the store
with a raw chromadb client to "fix" it. Repairs here have sharp edges (segfaults on large
`.get()`, quarantine traps) and a botched attempt can make corruption worse. Repair is an
operator task with a rehearsed procedure — escalate instead.

---

## 6. Quick reference
| Need | Call |
|---|---|
| Load overview | `mempalace_status` |
| Search | `mempalace_search query=… [wing=… room=…]` |
| Check before filing | `mempalace_check_duplicate` |
| File a memory | `mempalace_add_drawer wing=… room=… content=…` |
| New / changed fact | `mempalace_kg_add` / `mempalace_kg_invalidate` |
| Health (read-only) | `mempalace repair-status` |
| Reconnect | `mempalace_reconnect` |
| Version | `mempalace --version` (want ≥ 3.3.6) |
