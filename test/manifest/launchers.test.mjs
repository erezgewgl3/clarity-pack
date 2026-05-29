// test/manifest/launchers.test.mjs
//
// Plan 250529 Task 3 — pin the launcher nav entries.
//
// The four surfaces are declared as ui.slots (page routes), but slots ship NO
// nav affordance — pre-1.1.0 the only way to reach Situation Room / Bulletin /
// Chat was a direct URL. v1.1.0 adds ui.launchers so they appear as left-nav
// entries.
//
// Verified against paperclipai/paperclip@master (2026-05-29):
//   - placementZone 'sidebar' is the only zone rendered in the persistent left
//     <nav> (Sidebar.tsx mounts <PluginLauncherOutlet placementZones={['sidebar']}/>),
//     and requires the 'ui.sidebar.register' capability.
//   - a 'navigate' action.target is the BARE routePath; the host prepends
//     /<companyPrefix>/ (launchers.tsx resolveLauncherNavigationTarget). A
//     leading '/' would skip the prefix and land on the wrong company.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import manifest from '../../src/manifest.ts';

// id -> the page slot routePath each launcher must navigate to.
const EXPECTED = {
  'clarity-launch-situation-room': 'situation-room',
  'clarity-launch-bulletin': 'bulletin',
  'clarity-launch-chat': 'chat',
};

test('ML1: manifest.ui.launchers is an array with the three launcher ids', () => {
  const launchers = manifest.ui?.launchers;
  assert.ok(Array.isArray(launchers), 'ui.launchers must be an array');
  const ids = launchers.map((l) => l.id);
  for (const id of Object.keys(EXPECTED)) {
    assert.ok(ids.includes(id), `ui.launchers must include ${id}`);
  }
});

test('ML2: every launcher is a navigate action whose target is the BARE page routePath', () => {
  const launchers = manifest.ui?.launchers ?? [];
  for (const [id, routePath] of Object.entries(EXPECTED)) {
    const launcher = launchers.find((l) => l.id === id);
    assert.ok(launcher, `${id} must be declared`);
    assert.equal(launcher.action?.type, 'navigate', `${id}.action.type must be 'navigate'`);
    assert.equal(
      launcher.action?.target,
      routePath,
      `${id}.action.target must be the bare routePath '${routePath}'`,
    );
    // A leading slash would be treated as already-absolute and skip the
    // /<companyPrefix>/ prefix the host adds — landing on the wrong company.
    assert.doesNotMatch(
      launcher.action.target,
      /^\//,
      `${id}.action.target must NOT start with '/' (host prepends companyPrefix)`,
    );
  }
});

test('ML3: each navigate target matches an existing page slot routePath', () => {
  const slots = manifest.ui?.slots ?? [];
  const launchers = manifest.ui?.launchers ?? [];
  for (const id of Object.keys(EXPECTED)) {
    const launcher = launchers.find((l) => l.id === id);
    const slot = slots.find(
      (s) => s.type === 'page' && s.routePath === launcher.action.target,
    );
    assert.ok(
      slot,
      `${id} navigates to '${launcher.action.target}', which must be a declared page slot routePath`,
    );
  }
});

test('ML4: every launcher uses placementZone "sidebar" (the persistent left-nav zone)', () => {
  const launchers = manifest.ui?.launchers ?? [];
  for (const id of Object.keys(EXPECTED)) {
    const launcher = launchers.find((l) => l.id === id);
    assert.equal(launcher.placementZone, 'sidebar', `${id}.placementZone must be 'sidebar'`);
  }
});

test('ML5: the ui.sidebar.register capability is declared (required for sidebar launchers)', () => {
  assert.ok(
    manifest.capabilities.includes('ui.sidebar.register'),
    'sidebar-zone launchers require the ui.sidebar.register capability or install fails',
  );
});
