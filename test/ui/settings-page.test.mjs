// test/ui/settings-page.test.mjs
//
// Plan 02-04 Task 1 RED — Settings page source contract. SOURCE-GREP test
// (Node 24 doesn't load .tsx through the test runtime). Verifies:
//   - SettingsPage component lives at src/ui/surfaces/settings/index.tsx
//     (the old stub at settings-stub.tsx is replaced)
//   - Wraps in <ClaritySurfaceRoot name="settings"> (SCAF-06)
//   - Uses useOptIn() hook (not direct usePluginData)
//   - Has an enable checkbox bound to optedIn / toggle
//   - Contains the OPTIN-05 literal "default landing" copy
//
// Also verifies:
//   - src/ui/components/enable-clarity-cta.tsx exists
//   - EnableClarityCta uses useOptIn().toggle
//   - The CTA contains the literal "Enable Clarity Pack" button text

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_INDEX = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'settings', 'index.tsx');
const CTA_PATH = path.resolve(HERE, '..', '..', 'src', 'ui', 'components', 'enable-clarity-cta.tsx');

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

test('Settings: src/ui/surfaces/settings/index.tsx exists (replaces settings-stub.tsx)', () => {
  assert.ok(existsSync(SETTINGS_INDEX), `expected ${SETTINGS_INDEX} to exist`);
});

test('Settings: exports SettingsPage named export', () => {
  const src = readFileSync(SETTINGS_INDEX, 'utf8');
  assert.match(src, /export function SettingsPage/);
});

test('Settings: wraps in <ClaritySurfaceRoot name="settings"> (SCAF-06)', () => {
  const src = readFileSync(SETTINGS_INDEX, 'utf8');
  assert.match(src, /<ClaritySurfaceRoot[\s\S]*name=["']settings["']/);
});

test('Settings: uses the useOptIn() hook (not direct usePluginData)', () => {
  const src = readFileSync(SETTINGS_INDEX, 'utf8');
  assert.match(src, /useOptIn\b/);
});

test('Settings: renders a checkbox bound to optedIn', () => {
  const src = readFileSync(SETTINGS_INDEX, 'utf8');
  assert.match(src, /<input[^>]*type=["']checkbox["']/);
  assert.match(src, /checked={[^}]*optedIn/);
});

test('Settings: mentions "default landing" copy for OPTIN-05', () => {
  const src = readFileSync(SETTINGS_INDEX, 'utf8');
  assert.match(src, /default landing/i);
});

// ---------------------------------------------------------------------------
// EnableClarityCta
// ---------------------------------------------------------------------------

test('CTA: src/ui/components/enable-clarity-cta.tsx exists', () => {
  assert.ok(existsSync(CTA_PATH), `expected ${CTA_PATH} to exist`);
});

test('CTA: exports EnableClarityCta named export', () => {
  const src = readFileSync(CTA_PATH, 'utf8');
  assert.match(src, /export function EnableClarityCta/);
});

test('CTA: uses useOptIn().toggle', () => {
  const src = readFileSync(CTA_PATH, 'utf8');
  assert.match(src, /useOptIn\b/);
  assert.match(src, /toggle\b/);
});

test('CTA: includes literal "Enable Clarity Pack" button text', () => {
  const src = readFileSync(CTA_PATH, 'utf8');
  assert.match(src, /Enable Clarity Pack/);
});

test('CTA: accepts surfaceName prop and renders it (so "Enable to see Reader" / "Situation Room" work)', () => {
  const src = readFileSync(CTA_PATH, 'utf8');
  assert.match(src, /surfaceName/);
});

// ---------------------------------------------------------------------------
// Reader integration — useOptIn gate at top of ReaderView (OPTIN-02)
// ---------------------------------------------------------------------------

const READER_INDEX = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader', 'index.tsx');

test('Reader: ReaderView calls useOptIn() to gate the surface render (OPTIN-02)', () => {
  const src = readFileSync(READER_INDEX, 'utf8');
  assert.match(src, /useOptIn\b/);
});

test('Reader: when opted-out, ReaderView renders <EnableClarityCta /> (OPTIN-02)', () => {
  const src = readFileSync(READER_INDEX, 'utf8');
  assert.match(src, /EnableClarityCta\b/);
});

// ---------------------------------------------------------------------------
// UI barrel promotion
// ---------------------------------------------------------------------------

const UI_INDEX = path.resolve(HERE, '..', '..', 'src', 'ui', 'index.tsx');

test('UI barrel: SettingsPage now imported from surfaces/settings/index.tsx (not the stub)', () => {
  const src = readFileSync(UI_INDEX, 'utf8');
  assert.match(src, /SettingsPage[\s\S]*from\s+['"]\.\/surfaces\/settings/);
});
