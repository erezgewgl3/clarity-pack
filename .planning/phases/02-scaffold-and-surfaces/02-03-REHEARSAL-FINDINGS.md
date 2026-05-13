# Plan 02-03 Task 3 — Rehearsal Findings

**Drill date:** 2026-05-13 / 14
**Target:** Live Countermoves Hostinger Paperclip (82.29.197.74, db `paperclip_countermoves`)
**Operator:** Eric G. (pair-on-keyboard with Claude)
**Pre-install snapshot:** `2026-05-13T20-27-43Z` (Postgres mode; lives at `/home/eric/clarity-pack/.planning/snapshots/2026-05-13T20-27-43Z`)
**Plugin uuid post-install:** `0d4fc40a-0541-4b67-8979-9d346cb9c07b`
**Final plugin status:** `ready` (installed, activated, all 4 namespace tables present)
**Verdict:** **PARTIAL — Check A partial-fail (Reader renders but with major component gaps), B-F not attempted**

---

## Section 1 — Platform pitfalls (5 fixed in-session)

All 5 surfaced during install attempts. Each is documented in MemPalace `clarity_pack/runbook` as a permanent drawer. Each was patched inline tonight; the patches are committed.

| # | Pitfall | Manifestation | In-session fix | MemPalace drawer |
|---|---|---|---|---|
| 1 | SSH access (memory miss by Claude) | `ssh root@82.29.197.74` → Permission denied (publickey) | Use `ssh -i $HOME\.ssh\countermoves_vps_ed25519 eric@82.29.197.74` per the box's `AllowUsers eric` + non-default key path | `drawer_clarity_pack_runbook_640299868186f1f31e8b4d43` |
| 2 | Missing `ui.page.register` capability | Install reject: "Plugin clarity-pack manifest has inconsistent capabilities" | Added `'ui.page.register'` to manifest.capabilities — one cap per page-bearing slot type | (filed inline in MemPalace summary entry of 02-03) |
| 3 | Apostrophe in SQL comment breaks validator regex | "Plugin migrations may contain DDL statements only" — but every statement starts with CREATE/ALTER/COMMENT | Paperclip's `normaliseSql` strips quoted strings BEFORE comments. A single `'` in `Paperclip's host validator` opened a regex match that swallowed CREATE TABLE body. Fix: rephrase comment without apostrophes. | `drawer_clarity_pack_runbook_b3523ba851b2c94afd7e2321` |
| 4 | CREATE INDEX rejected as "not qualified" | Validator's `extractQualifiedRefs` regex only matches keyword list (from/join/references/into/update + alter/create/drop table/view); CREATE INDEX with ON namespace.table doesn't match | Dropped 3 non-unique indexes from migration. UNIQUE constraint inline in CREATE TABLE still produces the idempotency-key index. Other indexes deferred to worker startup hook in a future cleanup plan. | `drawer_clarity_pack_runbook_8ad721b5411610ee419e818e` |
| 5 | Worker can't find `@paperclipai/plugin-sdk` | Worker init fails: ERR_MODULE_NOT_FOUND. Local-path install does NOT symlink the host's node_modules into the extracted plugin dir. | `npm install --no-fund --no-audit` inside the extracted plugin dir to materialize a local node_modules with the SDK. devDependencies includes the SDK so this pulls it down. | (folded into Plan 02-03b Task 2's install-helper.sh) |

Cumulative pitfall lesson: **The plugin manifest, migration, and install path were unit-tested but never installed end-to-end against a real Paperclip before Plan 02-03 Task 3.** Plan 02-03b adds an integration test layer that stubs Paperclip's actual API shapes (Task 2).

---

## Section 2 — Implementation defects (NOT fixed tonight — Plan 02-03b scope)

The plugin INSTALLS, ACTIVATES, and the Reader tab APPEARS — but the rendered output is far from the sketch. Drill stopped at Check A (visual fidelity) with the following defects.

### Defect #1 — `issue.reader` handler returns thin data shape

**Symptom:** Reader tab renders. Visible: TldrStrip placeholder ("Compiling TL;DR..."), AnchoredToCards empty-state ("No upstream references in this task"), AcChecklist empty-state, ActivityTimeline empty-state. Missing entirely: Breadcrumb, ProseWithRefChips (body prose with chips), DeliverablePreview, LiveBlockerPanel (right rail).

**Root cause hypothesis:** Plan 02-03 Task 2's handler at `src/worker/handlers/issue-reader.ts` makes assumptions about Paperclip's API shapes that don't match the actual SDK on this Paperclip version:
- `ctx.issues.get(issueId)` — likely returns body in a field other than `body` (could be `description` or `markdown_body`)
- `ctx.issues.ancestry(issueId)` — may not exist as a method
- `ctx.issue.documents.read(issueId, opts)` — may not exist
- `ctx.activity.log.read({issueId, limit})` — may not exist

When these fail (silently or via thrown error), the handler likely returns a fallback shape with all fields null/empty. UI components that have hard null guards (Breadcrumb, ProseWithRefChips, DeliverablePreview) bail out and render nothing.

**Evidence:** Browser-DOM inspection on the live Reader tab confirms `<div data-clarity-surface="reader">` wraps the rendered children. The components that DID render are AnchoredToCards (empty), AcChecklist (empty), ActivityTimeline (empty). The components that DID NOT render are exactly the ones that have early-return-on-null guards. Components that render with a placeholder for null data (TldrStrip's "Compiling TL;DR...") still appear. This matches a "handler returns sparse data" pattern, not a "handler throws unhandled error" pattern.

**Plan 02-03b Task 1** captures the actual SDK shapes by reading `~/paperclip/node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` on Countermoves. **Task 2** rewrites the handler against those shapes with try/catch per data-slice so partial-API failures degrade gracefully.

### Defect #2 — `flatten-blocker-chain` worker handler returns 502

**Symptom:** Browser console shows 502 errors on `/api/plugins/0d4fc40a-.../...ten-blocker-chain` URLs. The Reader tab's right-rail LiveBlockerPanel is therefore not rendered.

**Root cause hypothesis:** the handler does some Paperclip API access (likely `ctx.issues.relations.get` or similar) that either does not exist on this SDK version or requires a capability we have not declared. The 502 implies the worker request reached the host but the host couldn't fulfill it — possibly because the worker process threw an unhandled exception.

**Plan 02-03b Task 1** identifies the actual exception by tailing `public.plugin_logs` filtered by plugin uuid. **Task 2** fixes the cause and adds a graceful "No active blockers" fallback.

### Defect #3 — React key warnings

**Symptom:** Browser console shows warnings:
- "Each child in a list should have a unique 'key' prop. Check the render method of `ClaritySurfaceRoot`. It was passed a child from ReaderView."
- "Each child in a list should have a unique 'key' prop. Check the render method of `AnchoredToCards`."

**Root cause:** likely `ProseWithRefChips` emits a mix of text nodes and `<RefChip>` elements via plain array push without wrapping fragments. The siblings need stable keys.

**Plan 02-03b Task 2** wraps text-node siblings in `<React.Fragment key="...">` or explicit `<span key="...">`.

### Defect #4 — npm install kludge for local-path plugin install

**Symptom:** Plan 02-03 Task 2's tarball did not include node_modules; Paperclip's local-path install does not symlink the host's SDK into the extracted dir; worker init failed with ERR_MODULE_NOT_FOUND. Workaround: manually run `npm install` inside the extracted dir before invoking `paperclipai plugin install`.

**Plan 02-03b Task 2** ships `scripts/install-helper.sh` that wraps extract + npm install + plugin install. This becomes the canonical local-install path going forward; the runbook is updated.

---

## Section 3 — What did pass (record for the SUMMARY when Plan 02-03 ultimately closes)

These passed implicitly during the drill — capture them so we don't redo:

- COEXIST-01 (additive — classic tabs visible alongside Reader): ✓ visually confirmed
- COEXIST-02 (no DDL on public.*): ✓ confirmed via `\dt public.*` baseline diff (82 rows before; 82 rows after install)
- Plugin namespace tables created: ✓ all 4 (`clarity_user_prefs`, `tldr_cache`, `editor_agent_failures`, `ac_checklist_items`)
- Plugin manifest validation: ✓ passes after platform pitfall #2 fix
- Migration application: ✓ both 0001 and 0002 applied successfully
- Plugin activation: ✓ status `ready` after platform pitfall #5 fix
- Reader tab mount: ✓ `<div data-clarity-surface="reader">` present in DOM
- TldrStrip + AnchoredToCards + AcChecklist + ActivityTimeline components: ✓ render their empty-state placeholders correctly

---

## Section 4 — Verification artifact pointers

- Browser console screenshots captured tonight: see chat transcript 2026-05-13 / 14.
- Network tab filter on `0d4fc40` showed only the UI bundle (`index.js`) — plugin data calls do NOT use HTTP fetch and don't show up in standard Network panel. Use `psql` plugin_logs instead for debugging worker handlers.
- Test issue used: COU-4 "test issue", body contains `Resolves BEAAA-141 and depends on BEAAA-203. See BEAAA-417 for the upstream spec. The deliverable goes in the shared drive. Send me the results by tomorrow.` (4 lines, ≥3 BEAAA refs, comments added).

---

## Section 5 — Resume signal

**This drill row is recorded as PARTIAL.** Plan 02-03 does NOT close yet. Plan 02-03b is the gap-closure plan that addresses defects #1-#4 from Section 2. After 02-03b's Task 3 returns "approved — reader green", Plan 02-03 closes (ROADMAP.md flip + STATE.md counter advance).
