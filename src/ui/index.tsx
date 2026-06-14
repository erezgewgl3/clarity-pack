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
// Plan 03-03 — bulletin surface stylesheet. Same DEV-14 runtime-inject path:
// the host does NOT auto-load sibling CSS, so the bundle injects its own
// <style>. bulletin.css is fully scoped to [data-clarity-surface="bulletin"].
import bulletinCss from './styles/bulletin.css';
// Plan 04-05 — Employee Chat surface stylesheet. Same DEV-14 runtime-inject
// path. chat.css is fully scoped to [data-clarity-surface="chat"].
import chatCss from './styles/chat.css';
// Plan 05-08 (D-15) — Archive full-view surface stylesheet. Same DEV-14
// runtime-inject path. archive.css is fully scoped to
// [data-clarity-surface="archive"].
import archiveCss from './styles/archive.css';

function injectClarityStyles(css: string, marker: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`style[${marker}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(marker, '');
  style.textContent = css;
  document.head.appendChild(style);
}

injectClarityStyles(themeCss, 'data-clarity-pack-styles');
injectClarityStyles(bulletinCss, 'data-clarity-pack-bulletin-styles');
injectClarityStyles(chatCss, 'data-clarity-pack-chat-styles');
injectClarityStyles(archiveCss, 'data-clarity-pack-archive-styles');

// T1-D (no-rabbit-holes self-health, 2026-06-15) — every surface export is
// wrapped in a top-level ClaritySurfaceBoundary so a render-time throw degrades
// to an honest "Clarity is unavailable" banner instead of bubbling to the
// host's generic pill or (in the BEAAA blank-UI incident) showing nothing. The
// host mounts the wrapped component; the inner surface is byte-unchanged.
import { withClarityBoundary } from './primitives/clarity-surface-boundary.tsx';
import { ReaderView as ReaderViewInner } from './surfaces/reader/index.tsx';
import { SituationRoom as SituationRoomInner } from './surfaces/situation-room/index.tsx';
import { BulletinPage as BulletinPageInner } from './surfaces/bulletin/index.tsx';
import { ChatPage as ChatPageInner } from './surfaces/chat/index.tsx';
import { SettingsPage as SettingsPageInner } from './surfaces/settings/index.tsx';
// Plan 05-08 (D-15) — Archive full-view page mounts at /<companyPrefix>/archive
// via the manifest's `clarity-archive` page-slot (exportName: 'ArchivePage').
import { ArchivePage as ArchivePageInner } from './surfaces/archive/archive-page.tsx';

export const ReaderView = withClarityBoundary(ReaderViewInner, 'Reader');
export const SituationRoom = withClarityBoundary(SituationRoomInner, 'Situation Room');
export const BulletinPage = withClarityBoundary(BulletinPageInner, 'Daily Bulletin');
export const ChatPage = withClarityBoundary(ChatPageInner, 'Employee Chat');
export const SettingsPage = withClarityBoundary(SettingsPageInner, 'Clarity settings');
export const ArchivePage = withClarityBoundary(ArchivePageInner, 'Archive');
