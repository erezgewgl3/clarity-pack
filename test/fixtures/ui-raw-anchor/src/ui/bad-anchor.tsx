// Test fixture for Plan 02-02 Task 2 eslint-no-raw-fetch.test.mjs.
// MUST trigger clarity/no-raw-anchor-to-host-paths because:
//   - file path includes /src/ui/
//   - the JSX <a href> targets a host path under /issues/

export function BadAnchor() {
  return <a href="/issues/BEAAA-1">open</a>;
}
