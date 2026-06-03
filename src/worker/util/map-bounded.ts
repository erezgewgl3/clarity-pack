// src/worker/util/map-bounded.ts
//
// Plan 16-01 Task 2 — the hand-rolled bounded-concurrency pool + deadline floor.
// This is the ONLY genuinely-new primitive in Phase 16 (no bounded pool exists
// in-repo; the codebase uses raw `Promise.all`). The canonical 15-line shapes
// are copied verbatim from 16-RESEARCH.md Code Examples (lines 311-338) — the
// reviewed, in-contract implementations — adapting only the import/export style
// to the repo's `.ts` ESM convention.
//
// NO `p-limit`, NO new dependency. The bundle has a strict size ceiling enforced
// in CI (`scripts/check-ui-bundle-size.mjs`) and the plugin contract discourages
// new deps (RESEARCH lines 77-82, CLAUDE.md "What NOT to Use"). A ~15-line
// Promise pool is trivial, dependency-free, and fully testable.
//
// WHO IMPORTS THIS: Wave B (16-03, build-employees-rollup.ts) wraps every
// irreducible `ctx.issues.relations.get` walk (no relations table in
// coreReadTables, so the RPC cannot be SQL-ified) with BOTH exports:
//   - mapBounded caps the in-flight fan-out at `limit` (4-6) so the parallel
//     relations walks never stampede the host Postgres (T-16-01 DoS mitigation).
//   - withDeadline floors a hung/slow/rejecting walk to the deterministic
//     UNCLASSIFIED row well under the 30s host RPC default, since the SDK's
//     per-call timeoutMs is NOT reachable through ctx.issues.relations.get
//     (see 16-SCHEMA-VERIFY.md "timeoutMs decision" — T-16-02 DoS mitigation).

/**
 * Run `fn` over `items` with at most `limit` invocations in flight at once.
 * Resolves to an array of results in INPUT order, regardless of per-item
 * completion order (results are written into a pre-sized array by index, and a
 * fixed pool of `min(limit, items.length)` workers pulls from a shared cursor).
 *
 * Caps in-flight host load: this is the bounded replacement for the unbounded
 * `Promise.all(agents.map(...))` fan-out that stampedes Postgres on a large org.
 * An empty `items` resolves to `[]` without ever calling `fn`.
 */
export async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Floor a hung or rejecting promise to a deterministic fallback within a bounded
 * deadline `ms`. Resolves `onTimeout()` if `p` neither resolves nor rejects
 * within `ms`, AND ALSO floors to `onTimeout()` if `p` REJECTS — a thrown
 * `relations.get` must never escape; it floors to the deterministic
 * UNCLASSIFIED row instead. Clears the timer on settle so `onTimeout` never
 * fires after `p` has already won the race.
 *
 * This is the per-call floor Wave B uses because the SDK's per-call `timeoutMs`
 * override is NOT reachable through the typed `ctx.issues.relations.get` surface
 * (16-SCHEMA-VERIFY.md "timeoutMs decision"); `withDeadline` gives an identical
 * deterministic floor with zero host dependency.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(onTimeout());
      },
    );
  });
}
