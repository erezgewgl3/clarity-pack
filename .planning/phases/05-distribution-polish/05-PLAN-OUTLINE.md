# Phase 05 — Plan Outline (chunked)

**Generated:** 2026-05-25
**Phase:** 05 — distribution-polish
**Plans to write:** 7 (05-04 through 05-10)
**Skipped (CODE-COMPLETE per D-26):** 05-01, 05-02, 05-03

## Plans

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|------------|--------------|
| 05-04 | Full-fidelity previewers (xlsx server-side via SheetJS worker handler / pdf native `<embed>` / md react-markdown / png `<img>`) + static-sketch visual-regression baseline (Playwright, every-PR CI cadence). Replaces Phase 2 placeholder. | 1 | — | DIST-04, DIST-05 |
| 05-05 | Zero-rabbit-holes finishers: generic paused-agent banner mounted on chat header + Reader top-of-tab with three pause-cause copies (operator/budget/adapter); ref-chip hover-peek card (title + status + owner + 120-char description excerpt); `buildTopicDeepLink` `employeeUserId` extension + full caller audit (closes GAP-PICKER-ROW-DISPATCH). | 1 | — | (no new REQ — internal polish) |
| 05-06 | Phase 4.1 surface polish bundle (7 small fixes): Pin/Unpin toggle mirror of `chat.topic.archive`; right-rail pinned-chip click → scroll + `.flash-highlight`; auto-scroll thread after Create-Task; pause toast copy fix; LIVE indicator sticky restore; clarity-pack toast left-edge `--you` gold stripe + `↗` icon; inline task-card optimistic `status: 'todo'` default. | 1 | — | (no new REQ — internal polish) |
| 05-07 | Phase 4.2 polish bundle: D8 Browser-Back preserves hash (remove `nav.replace` so chat-state survives Back); 5 React-key fixes (ContextRail / PersistedMessage / TrueTaskDialog / AnchoredToCards / ChatPageBody — one commit per component); 3 forward-defect fixes from rc.7 drill (GAP-D8-LINEAGE-TOOLTIP threading `topicIdentifier?`, GAP-D8-REVERSE-TOOLTIP-FALLBACK, GAP-RCB-05-CHIP-STYLING); cross-employee fall-through drill fixture (D-03). NOTE: GAP-PICKER-ROW-DISPATCH is covered in 05-05, not 05-07. | 1 | — | (no new REQ — internal polish) |
| 05-08 | Phase 4.1 power features (5 items; task templates + smart-prefill DROPPED per `feedback_trust-the-clarification-loop`): archive full-view at NEW route `/<companyPrefix>/archive` (align to `bulletin`/`situation-room` pattern per Pattern Map — CONTEXT.md D-15's `/clarity-pack/archive` is a slip) + bulk-unarchive; cold-task button in shared top-right header on all four clarity-pack surfaces; per-topic diagnostics toggle persisted in localStorage; composer-scoped `?` shortcuts popover (NOT global); storage-pin live wiring via NEW additive migration `migrations/0010_chat_topics_pinned.sql` (`pinned_at timestamptz NULL`). | 2 | 05-05, 05-06 | (no new REQ — internal polish) |
| 05-09 | Tooling + infra cleanup (4 items, independent): `runbook/operator-gotchas.md` VPS `git pull` step entry; CLAUDE.md plugin-route doc correction (`/plugins/clarity-pack/...` → `/<companyPrefix>/<routePath>`); document `paperclipai plugin install` uninstall-then-install upgrade-path workaround; Windows max-path worktree fix — relocate `scripts/safety/test/fixtures/fake-paperclip-clone/` out of the worktreed tree. | 1 | — | (no new REQ — internal polish) |
| 05-10 | v1.0.0 final closure: version bump 1.0.0-rc.N → 1.0.0 (both `package.json` AND `src/manifest.ts` per memory `plugin-version-bump-two-sources`); npm publish (gated on `npm login`); canonical Countermoves ALL-paths drill (bookend snapshot, full Phase 4.2 + 5 fixture sweep, COEXIST #6 byte-identical re-verification); VERIFICATION.md write; ROADMAP/REQUIREMENTS final-state flip to Implemented; MemPalace `clarity_pack/decisions/v1.0.0-shipped` drawer. SCOPE-NOTE: D-23 STRONG DEVIATION — `1.0.0 → rc.7 → 1.0.0` rollback rehearsal is SKIPPED for v1.0.0 final (operator's call; Phase 1 bookend snapshot/restore loop is the SOLE recovery path); forward `rc.7 → 1.0.0` install IS still in the drill. | 3 | 05-04, 05-05, 05-06, 05-07, 05-08, 05-09 | COEXIST-05 (re-verification) |

## Cross-cutting truths (must appear in 2+ plans' must_haves.truths)

- React 19 peer-only; no bundled React; esbuild presets unchanged (PATTERNS.md §"Stack pins")
- Additive-only schema; plugin disable preserves data (coexistence #3 + #6)
- CTT-07: plugin actions never modify `public.issues.updated_at`
- NO_UUID_LEAK: ctx.agents.get / ctx.issues.get for operator-visible names
- `dangerouslySetInnerHTML` forbidden (check-a11y R3)

## Return marker

## OUTLINE COMPLETE
Plan count: 7
