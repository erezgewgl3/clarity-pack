// src/ui/primitives/use-host-navigation.ts
//
// Plan 02-02 Task 2 — re-export of the host's navigation hook so Clarity
// surfaces can route via host React Router state instead of raw <a href>.
// `linkProps(href)` returns { href, onClick } — the host router intercepts
// the click but the `href` preserves modifier-click, middle-click, and
// copy-link browser-native behavior (per the SDK docstring).
//
// SDK 2026.512.0 exposes `useHostNavigation` from
// `@paperclipai/plugin-sdk/ui/hooks` directly (verified empirically against
// the dist/ui/hooks.d.ts during the Plan 02-01 Task 2 spike — see
// 02-01-SMOKE-FINDINGS.md "## useInstanceConfig SDK Import Path" for the
// complete list of exported UI hooks). We just re-export so callers can
// import from a stable in-repo path.

export { useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';
