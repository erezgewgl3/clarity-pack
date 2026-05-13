// Test fixture for Plan 02-02 Task 2 eslint-no-raw-fetch.test.mjs.
// MUST trigger clarity/no-raw-fetch-in-ui because:
//   - file path includes /src/ui/ (the rule scope matcher)
//   - line 8 calls fetch() directly

import * as React from 'react';

export function BadFetcher() {
  void fetch('/api/companies/1/issues');
  return React.createElement('div', null, 'bad');
}
