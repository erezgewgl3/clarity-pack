// test/ui/clarity-surface-boundary.test.mjs
//
// T1-D (no-rabbit-holes self-health, 2026-06-15) — the top-level surface
// boundary that renders an HONEST "Clarity is unavailable" banner instead of a
// blank frame / the host's generic pill when a surface throws at render.
//
// Source-grep (Node native --test cannot load .tsx). Asserts: the boundary is a
// React class component with getDerivedStateFromError (the only React mechanism
// that catches render throws), renders an honest banner (never returns
// null/blank in the failed state), and that EVERY surface export in index.tsx
// is wrapped with withClarityBoundary.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const BOUNDARY = readFileSync(
  path.join(REPO_ROOT, 'src', 'ui', 'primitives', 'clarity-surface-boundary.tsx'),
  'utf8',
);
const INDEX = readFileSync(
  path.join(REPO_ROOT, 'src', 'ui', 'index.tsx'),
  'utf8',
);

test('boundary is a React class component with getDerivedStateFromError', () => {
  assert.match(BOUNDARY, /class ClaritySurfaceBoundary extends React\.Component/);
  assert.match(BOUNDARY, /static getDerivedStateFromError/);
  assert.match(BOUNDARY, /componentDidCatch/);
});

test('boundary renders an HONEST banner in the failed state — never a blank frame', () => {
  // The failed branch must render a visible, explicit message (not null / empty).
  assert.match(BOUNDARY, /Clarity is unavailable right now\./);
  assert.match(BOUNDARY, /hard refresh/i);
  assert.match(BOUNDARY, /data-clarity-region="surface-unavailable"/);
  // It must NOT silently return null when failed (the blank-frame anti-pattern).
  const failedBranch = BOUNDARY.slice(BOUNDARY.indexOf('this.state.failed'));
  assert.doesNotMatch(
    failedBranch,
    /failed[\s\S]{0,40}return null/,
    'failed state must render a banner, never null/blank',
  );
});

test('boundary forwards the throw to console.error (post-deploy diagnosis)', () => {
  assert.match(BOUNDARY, /console\.error\(/);
  assert.match(BOUNDARY, /clarity-pack: surface/);
});

test('every surface export in index.tsx is wrapped with withClarityBoundary', () => {
  assert.match(INDEX, /import \{ withClarityBoundary \} from '\.\/primitives\/clarity-surface-boundary\.tsx'/);
  for (const surface of [
    'ReaderView',
    'SituationRoom',
    'BulletinPage',
    'ChatPage',
    'SettingsPage',
    'ArchivePage',
  ]) {
    assert.match(
      INDEX,
      new RegExp(`export const ${surface} = withClarityBoundary\\(`),
      `${surface} must be exported wrapped in withClarityBoundary`,
    );
  }
});
