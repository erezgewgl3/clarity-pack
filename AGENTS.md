# Clarity Pack Codex Notes

At the start of a Codex session in this project, use the MemPalace MCP before making assumptions:

- Check MemPalace access with `mempalace_status`.
- Search or read the latest Clarity Pack memories, especially `wing_clarity-pack`.
- Prefer the newest technical/runbook memories for deployment, routing, and debugging context.
- Remember that Codex hooks are configured in `C:/Users/erezg/.codex/hooks.json` for `SessionStart`, `Stop`, and `PreCompact`.
- The user approved the visible `SessionStart` and `Stop` hooks in the Codex `/hooks` UI on 2026-05-16.

Important current routing memory:

- Clarity Pack plugin pages mount directly under `/COU/`.
- Correct routes include `/COU/bulletin`, `/COU/situation-room`, and `/COU/chat`.
- Do not use the stale `/COU/plugins/clarity-pack/...` route pattern unless new evidence says it changed.
