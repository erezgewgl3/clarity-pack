// src/worker/agents/op-issue-set.ts
//
// Debug editor-heartbeat-db-churn (v1.4.4) — Fix 2: a zero-DB recursion guard.
//
// THE PROBLEM. Every operation issue the plugin creates (tldr-compile,
// bulletin-compile, …) is itself an `issue.created` host event that re-enters
// the heartbeat dispatcher. The durable guard (`isOwnOperationIssue`, which
// inspects `originKind`) only fires AFTER a `reconcileEditorAgent` round-trip
// AND a `ctx.issues.get` — so each of the plugin's own writes still costs two
// host/DB calls before being dropped. On BEAAA that was ~3.8 self-triggered
// heartbeats/sec, all of which bottomed out in "skipped own operation issue".
//
// THE FIX. When `startAgentTask` creates (or reuses) an operation issue we
// remember its id in a bounded in-memory set. The worker's event dispatcher
// consults this set FIRST and drops the matching `issue.created` /
// `issue.updated` events BEFORE any reconcile or DB call — a zero-DB short
// circuit for the dominant recursion source.
//
// DURABILITY. The set is in-memory only, so it is EMPTY after a worker
// restart. That is intentional and safe: the durable `isOwnOperationIssue`
// originKind guard remains the restart backstop (it still drops a self-event,
// just one reconcile+get later). The set is a fast-path optimization layered
// ON TOP of that backstop, never a replacement for it.
//
// BOUNDING. A plain unbounded Set would leak one entry per operation issue for
// the worker's lifetime. We bound it two ways:
//   - a hard size cap (LRU-evict the oldest on overflow), and
//   - a TTL (an entry older than the window is treated as absent).
// The window is generous (a few delivery timeouts) — long enough that a freshly
// created op issue's self-events are still suppressed while it is in flight,
// short enough that the set stays tiny in steady state.
//
// NOTE (Node strip-only TS): this module is imported by `.mjs` tests that run
// under Node's type-stripping loader, which does NOT support TS parameter
// properties or other emit-requiring syntax. Constructor fields are therefore
// declared + assigned explicitly (no `private readonly x` shorthand).

/**
 * TTL for a remembered operation-issue id. After this window the entry is
 * treated as absent (and lazily evicted). Sized at 4× the agent-task delivery
 * timeout (~20 min) — comfortably longer than the in-flight life of any single
 * operation issue, so a self-event arriving while the op is live is always
 * suppressed, yet short enough that the set self-drains in steady state.
 */
export const OP_ISSUE_TTL_MS = 20 * 60 * 1000;

/**
 * Hard cap on remembered ids. A burst of activity creates at most a handful of
 * operation issues per company per minute; 2000 entries is far above any
 * realistic in-flight count and keeps the worst-case memory trivially small.
 * On overflow the oldest entry is evicted (insertion-order LRU via Map).
 */
export const OP_ISSUE_SET_MAX = 2000;

/**
 * A bounded, TTL'd set of operation-issue ids the plugin created. Backed by a
 * `Map<id, insertedAtMs>` so insertion order gives us cheap LRU eviction and the
 * timestamp gives us per-entry TTL.
 */
export class OwnOperationIssueSet {
  private readonly entries: Map<string, number>;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    ttlMs: number = OP_ISSUE_TTL_MS,
    maxEntries: number = OP_ISSUE_SET_MAX,
    now: () => number = () => Date.now(),
  ) {
    this.entries = new Map<string, number>();
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  /** Remember an operation-issue id as plugin-created (idempotent; refreshes TTL). */
  add(id: string): void {
    if (!id) return;
    // Refresh insertion order on re-add: delete then set moves it to the tail.
    this.entries.delete(id);
    this.entries.set(id, this.now());
    // Enforce the hard cap — evict oldest (head) entries until under the cap.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * True when `id` is a still-live plugin-created operation issue. A TTL-expired
   * entry is lazily evicted and reported as absent.
   */
  has(id: string): boolean {
    if (!id) return false;
    const insertedAt = this.entries.get(id);
    if (insertedAt === undefined) return false;
    if (this.now() - insertedAt > this.ttlMs) {
      this.entries.delete(id);
      return false;
    }
    return true;
  }

  /** Current entry count. Test/observability only. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * The single process-wide instance the worker shares between the delivery layer
 * (writer, via {@link rememberOwnOperationIssue}) and the event dispatcher
 * (reader, via {@link isRememberedOwnOperationIssue}). A module-level singleton
 * is the right scope: the worker is one Node process, and the recursion this
 * guards is entirely within that process's own host calls.
 */
export const ownOperationIssueIds = new OwnOperationIssueSet();

/** Remember an operation-issue id on the shared worker set. */
export function rememberOwnOperationIssue(id: string): void {
  ownOperationIssueIds.add(id);
}

/** True when an id is a still-live plugin-created operation issue (shared set). */
export function isRememberedOwnOperationIssue(id: string | null | undefined): boolean {
  return !!id && ownOperationIssueIds.has(id);
}
