// Test fixture for Plan 02-02 Task 2 — clean baseline.
// MUST NOT trigger either rule:
//   - no raw fetch / XMLHttpRequest / axios import
//   - no <a href> targeting a host path
//
// Used to assert that the lint rules don't false-positive on benign UI code.

import * as React from 'react';

export function Clean() {
  return React.createElement('span', null, 'clean ui');
}
