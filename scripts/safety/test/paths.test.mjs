// scripts/safety/test/paths.test.mjs
//
// Covers P1 (resolvePaperclipHome — env override + platform default) and
// P2 (isValidSnapshotId — accepts canonical, rejects injection-shaped).

import { strict as assert } from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isValidSnapshotId,
  resolveInstanceDir,
  resolvePaperclipHome,
  resolveSnapshotsDir
} from '../lib/paths.mjs';

test('P1.a — PAPERCLIP_HOME env override is honoured verbatim', () => {
  const got = resolvePaperclipHome({ PAPERCLIP_HOME: '/custom' });
  assert.equal(got, '/custom');
});

test('P1.b — without PAPERCLIP_HOME, default is os.homedir() + .paperclip', () => {
  const got = resolvePaperclipHome({});
  assert.equal(got, path.join(os.homedir(), '.paperclip'));
});

test('P1.c — empty PAPERCLIP_HOME falls back to platform default (treated as unset)', () => {
  const got = resolvePaperclipHome({ PAPERCLIP_HOME: '' });
  assert.equal(got, path.join(os.homedir(), '.paperclip'));
});

test('P1.d — resolveInstanceDir composes home + instances/<id>', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\eric\\.paperclip' : '/home/eric/.paperclip';
  const got = resolveInstanceDir(home, 'default');
  assert.equal(got, path.join(home, 'instances', 'default'));
});

test('P1.e — resolveSnapshotsDir composes repoRoot + .planning/snapshots', () => {
  const got = resolveSnapshotsDir('/repo');
  assert.equal(got, path.join('/repo', '.planning', 'snapshots'));
});

test('P2.a — isValidSnapshotId accepts the canonical ISO-with-dashes format', () => {
  assert.equal(isValidSnapshotId('2026-05-08T14-32-17Z'), true);
});

test('P2.b — isValidSnapshotId rejects path-traversal injection', () => {
  assert.equal(isValidSnapshotId('../etc/passwd'), false);
});

test('P2.c — isValidSnapshotId rejects shell-metacharacter injection', () => {
  assert.equal(isValidSnapshotId('"; rm -rf ~"'), false);
});

test('P2.d — isValidSnapshotId rejects empty string', () => {
  assert.equal(isValidSnapshotId(''), false);
});

test('P2.e — isValidSnapshotId rejects ISO with colons (canonical Date toISOString form)', () => {
  assert.equal(isValidSnapshotId('2026-05-08T14:32:17Z'), false);
});

test('P2.f — isValidSnapshotId accepts format-only (does not validate calendar)', () => {
  // Intentional: format-only validation. Consumers never use these strings
  // for arithmetic; the regex is a security gate, not a date parser.
  assert.equal(isValidSnapshotId('2026-13-99T99-99-99Z'), true);
});

test('P2.g — isValidSnapshotId rejects non-string input', () => {
  assert.equal(isValidSnapshotId(123), false);
  assert.equal(isValidSnapshotId(null), false);
  assert.equal(isValidSnapshotId(undefined), false);
  assert.equal(isValidSnapshotId({ id: '2026-05-08T14-32-17Z' }), false);
});
