// src/worker/agents/heartbeat-dispatcher.ts
//
// Debug editor-heartbeat-db-churn (v1.4.4) — Fix 1 (batch + debounce) and the
// Fix 2 read-side short-circuit, extracted into a testable unit.
//
// THE PROBLEM (RC1). The original worker.ts wired three host events
// (issue.created / issue.updated / issue.comment.created) so that EACH event,
// for the WHOLE instance, synchronously fired:
//   reconcileEditorAgent()  (a host round-trip, no cache)
//   + handleEditorHeartbeat() with a single-event batch.
// On any busy instance this is one reconcile + one issues.get per event — and
// the plugin's OWN operation issues generate events that re-enter this path
// (caught only by isOwnOperationIssue AFTER the reconcile + get). The original
// code comments stated the design INTENT was to "bundle events per
// heartbeat-window" — never implemented. Measured on BEAAA: ~3.8 self-triggered
// heartbeats/sec, each a reconcile + a get.
//
// THE FIX. Accumulate events into a per-company buffer and flush on a debounce
// (with a hard size cap as a safety valve). Per flush:
//   - reconcile the Editor-Agent ONCE for the company (cached per company),
//   - dedupe issueIds across all buffered events,
//   - run ONE batched handleEditorHeartbeat.
// This restores the documented "bundle events per heartbeat-window" intent and
// collapses N events into one reconcile + one batched heartbeat.
//
// THE FIX-2 READ SHORT-CIRCUIT. Before an event is even buffered, drop it if its
// entityId is a remembered plugin-created operation issue (the zero-DB recursion
// guard — see op-issue-set.ts). Also drop plugin-authored events (actorType
// 'plugin') as a cheap belt-and-suspenders. This stops the plugin's own writes
// from ever scheduling a flush.
//
// GOVERNANCE PARITY. Nothing here resumes or invokes an agent; it only batches
// the existing best-effort heartbeat. A paused Editor-Agent still does no LLM
// work (the adapter respects the paused state downstream). The debounce is a
// pure local timer — no new capability, no continuous worker loop (the timer
// only exists while events are pending and clears itself after each flush).
//
// NOTE (Node strip-only TS): imported indirectly by `.mjs` tests under Node's
// type-stripping loader, which does NOT support TS parameter properties. Fields
// are declared + assigned explicitly (no `private readonly x` shorthand).

import { isRememberedOwnOperationIssue } from './op-issue-set.ts';

/** The minimal shape of a host event the dispatcher consumes. */
export type DispatcherHostEvent = {
  entityId?: string;
  entityType?: string;
  companyId?: string;
  actorId?: string;
  actorType?: 'user' | 'agent' | 'system' | 'plugin';
};

/** One buffered event, normalized to the heartbeat payload's per-event shape. */
type BufferedEvent = {
  author_id: string | null;
  // Host PluginEvent carries NO top-level `tags` field (verified against
  // @paperclipai/plugin-sdk@2026.512.0 types.d.ts — only actorId/actorType/
  // entityId/entityType/companyId/payload). The tag-based half of
  // filterSelfLoopEvents therefore has nothing host-carried to match on; tags
  // stay empty here and the real defense is the author_id check + the Fix-2
  // remembered-op-issue short-circuit below. See Fix 4 note in worker.ts.
  tags: string[];
  entity_type: string;
  entity_id: string;
};

/** A per-company pending buffer + its debounce timer handle. */
type CompanyBuffer = {
  events: BufferedEvent[];
  // Dedupe of issue ids already buffered this window (cheap O(1) membership).
  seenIssueIds: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
};

/** What the dispatcher needs to run a flush — supplied by worker.ts. */
export type HeartbeatFlushDeps = {
  /**
   * Resolve (idempotently) the Editor-Agent UUID for a company. Called ONCE per
   * flush — not once per event. Returns null when no agent is resolvable (the
   * flush is then skipped, same as the old per-event guard).
   */
  resolveAgentId(companyId: string): Promise<string | null>;
  /**
   * Run the batched heartbeat for a company with the deduped event batch + the
   * resolved agentId. Wraps the existing handleEditorHeartbeat.
   */
  runHeartbeat(companyId: string, agentId: string, events: BufferedEvent[]): Promise<void>;
  /**
   * Optional logger for non-fatal flush diagnostics. Shape matches the host
   * PluginLogger's (message: string, meta?: Record<string, unknown>) so ctx.logger
   * is assignable directly.
   */
  logger?: {
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
  };
};

export type HeartbeatDispatcherOptions = {
  /** Debounce window — events that arrive within this window flush together. */
  debounceMs?: number;
  /**
   * Hard size cap — if a company's buffer reaches this many distinct issues
   * before the debounce elapses, flush immediately (a safety valve against a
   * burst that would otherwise hold events for the full debounce). The buffer
   * never grows unbounded.
   */
  maxBatch?: number;
};

/** Default debounce window — long enough to coalesce a burst, short enough to feel live. */
export const DEFAULT_HEARTBEAT_DEBOUNCE_MS = 12_000;

/** Default per-company batch size cap (flush early on a burst). */
export const DEFAULT_HEARTBEAT_MAX_BATCH = 50;

/**
 * A per-company batching + debouncing heartbeat dispatcher. Construct ONE per
 * worker; feed it host events via {@link enqueue}. It self-schedules flushes;
 * call {@link flushAll} on shutdown if you want to drain synchronously (tests).
 */
export class HeartbeatDispatcher {
  private readonly buffers: Map<string, CompanyBuffer>;
  private readonly deps: HeartbeatFlushDeps;
  private readonly debounceMs: number;
  private readonly maxBatch: number;
  // Agent-id cache per company. RC1's per-event reconcile is replaced by a
  // per-flush reconcile, and even that is cached across flushes — a company's
  // Editor-Agent id is stable for the worker's life. A miss (null) is NOT cached
  // so a brand-new company retries on its next event.
  private readonly agentIdByCompany: Map<string, string>;

  constructor(deps: HeartbeatFlushDeps, options: HeartbeatDispatcherOptions = {}) {
    this.buffers = new Map<string, CompanyBuffer>();
    this.agentIdByCompany = new Map<string, string>();
    this.deps = deps;
    this.debounceMs = options.debounceMs ?? DEFAULT_HEARTBEAT_DEBOUNCE_MS;
    this.maxBatch = options.maxBatch ?? DEFAULT_HEARTBEAT_MAX_BATCH;
  }

  /**
   * Accept a host event. Applies the Fix-2 zero-DB short-circuit, then buffers
   * the event per company and (re)arms the debounce timer. A burst that fills
   * the batch cap flushes immediately. Never throws.
   */
  enqueue(event: DispatcherHostEvent): void {
    const companyId = event.companyId;
    const entityId = event.entityId;
    if (!companyId || !entityId) return;

    // Fix 2 — zero-DB recursion guard. Drop the plugin's OWN operation-issue
    // events before any reconcile/DB call. Also drop plugin-authored events as a
    // cheap belt-and-suspenders (the Editor-Agent's own writes).
    if (isRememberedOwnOperationIssue(entityId)) return;
    if (event.actorType === 'plugin') return;

    const buf = this.getOrCreateBuffer(companyId);

    // Dedupe issue ids within the window — a single issue touched by many events
    // in the window contributes ONE buffered entry. (Comments on an issue arrive
    // with the issue as entityId for the heartbeat's purposes.)
    if (buf.seenIssueIds.has(entityId)) {
      // Already buffered this issue this window — nothing to add, timer stays.
      return;
    }
    buf.seenIssueIds.add(entityId);
    buf.events.push({
      author_id: event.actorId ?? null,
      tags: [],
      entity_type: event.entityType ?? 'issue',
      entity_id: entityId,
    });

    // Burst safety valve — flush immediately when the batch cap is hit.
    if (buf.events.length >= this.maxBatch) {
      this.flushCompany(companyId);
      return;
    }

    // Arm the debounce: a leading-window debounce — the FIRST event in a window
    // sets the timer; subsequent events join the same window. A steady trickle
    // therefore still flushes debounceMs after the first event (bounded latency).
    if (buf.timer === null) {
      buf.timer = setTimeout(() => {
        this.flushCompany(companyId);
      }, this.debounceMs);
      // Do not keep the event loop alive solely for a pending heartbeat flush.
      const t = buf.timer as { unref?: () => void };
      if (typeof t.unref === 'function') t.unref();
    }
  }

  /** Flush every pending company buffer now (test/shutdown drain). */
  async flushAll(): Promise<void> {
    const companies = Array.from(this.buffers.keys());
    await Promise.all(companies.map((c) => this.runFlush(c)));
  }

  private getOrCreateBuffer(companyId: string): CompanyBuffer {
    let buf = this.buffers.get(companyId);
    if (!buf) {
      buf = { events: [], seenIssueIds: new Set<string>(), timer: null };
      this.buffers.set(companyId, buf);
    }
    return buf;
  }

  /** Fire-and-forget flush trigger (timer/cap path). Errors are swallowed-logged. */
  private flushCompany(companyId: string): void {
    void this.runFlush(companyId).catch((e) => {
      this.deps.logger?.warn?.('heartbeat-dispatcher: flush threw', {
        companyId,
        err: (e as Error).message,
      });
    });
  }

  /**
   * Drain one company's buffer: clear it FIRST (so events arriving during the
   * async flush start a fresh window), then reconcile once + run one batched
   * heartbeat. Resolving the agent id is cached across flushes.
   */
  private async runFlush(companyId: string): Promise<void> {
    const buf = this.buffers.get(companyId);
    if (!buf) return;

    // Snapshot + reset the buffer atomically (synchronous section — no awaits
    // between read and clear, so no event can be lost or double-flushed).
    if (buf.timer !== null) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    const batch = buf.events;
    if (batch.length === 0) return;
    buf.events = [];
    buf.seenIssueIds = new Set<string>();

    // Reconcile ONCE per flush (cached across flushes). RC1 fix: this replaces
    // the per-event reconcile.
    let agentId = this.agentIdByCompany.get(companyId) ?? null;
    if (!agentId) {
      try {
        agentId = await this.deps.resolveAgentId(companyId);
      } catch (e) {
        this.deps.logger?.warn?.('heartbeat-dispatcher: reconcile failed', {
          companyId,
          err: (e as Error).message,
        });
        agentId = null;
      }
      if (agentId) this.agentIdByCompany.set(companyId, agentId);
    }
    if (!agentId) {
      this.deps.logger?.warn?.(
        'heartbeat-dispatcher: Editor-Agent unresolved — skipping batched heartbeat',
        { companyId, dropped: batch.length },
      );
      return;
    }

    try {
      await this.deps.runHeartbeat(companyId, agentId, batch);
    } catch (e) {
      this.deps.logger?.warn?.('heartbeat-dispatcher: batched heartbeat threw', {
        companyId,
        err: (e as Error).message,
      });
    }
  }
}

export type { BufferedEvent };
