// src/ui/index.tsx — Plan 02-02 Task 3 UI barrel.
//
// Re-exports every named component the manifest's ui.slots[].exportName field
// declares. The host loads this bundle once per surface mount and looks up
// the export by name.

export { ReaderView } from './surfaces/reader-view-stub.tsx';
export { SituationRoom } from './surfaces/situation-room-stub.tsx';
export { BulletinPage } from './surfaces/bulletin-stub.tsx';
export { ChatPage } from './surfaces/chat-stub.tsx';
export { SettingsPage } from './surfaces/settings-stub.tsx';
