// src/ui/index.tsx — Plan 02-04 Task 1+2 UI barrel + Plan 02-08 DEV-14 fix.
//
// Plan 02-04 promotes SettingsPage (Task 1) and SituationRoom (Task 2)
// from stubs to real components. Bulletin and Chat remain stubs (Phase 3 /
// Phase 4 respectively).
//
// DEV-14 (drill 2026-05-14): Paperclip's host loads the plugin UI JS bundle
// but does NOT auto-load a sibling CSS file. The 17.9 KB dist/ui/index.css
// previously shipped in the tarball but never reached the page. Fix: bundle
// the CSS as a string (esbuild loader: { '.css': 'text' }) and inject a
// single <style data-clarity-pack-styles> element on first module load.

import themeCss from './primitives/theme.css';

function injectClarityStyles(css: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-clarity-pack-styles]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-clarity-pack-styles', '');
  style.textContent = css;
  document.head.appendChild(style);
}

injectClarityStyles(themeCss);

export { ReaderView } from './surfaces/reader/index.tsx';
export { SituationRoom } from './surfaces/situation-room/index.tsx';
export { BulletinPage } from './surfaces/bulletin-stub.tsx';
export { ChatPage } from './surfaces/chat-stub.tsx';
export { SettingsPage } from './surfaces/settings/index.tsx';
