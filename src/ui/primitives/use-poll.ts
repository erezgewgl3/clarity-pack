// src/ui/primitives/use-poll.ts
//
// Plan 02-02 Task 2 — lifecycle-aware polling primitive (SCAF-07 +
// PITFALLS.md #1). Distinguishes TRANSIENT failures (WORKER_UNAVAILABLE
// / TIMEOUT / UNKNOWN) from TERMINAL failures (PLUGIN_DISABLED):
//
//   - TRANSIENT → exponential backoff, polling continues
//   - TERMINAL  → setTimeout cleared, no further scheduling for this instance
//
// Also: visibility guard (pauseOnHidden), synchronous content-hash dedupe
// via inline murmur3-32 (NO the Web Crypto async digest API — async hashing races with the
// next poll tick), and isLeader=null sentinel (Plan 02-04 wraps with a
// BroadcastChannel leader-election hook).
//
// The pure tick-loop is exported separately as `createPollLoop` so unit
// tests can exercise the state machine deterministically without React.
// The default `usePoll` export wires the loop into a React hook for UI use.

import * as React from 'react';

export type PollErrorKind =
  | 'WORKER_UNAVAILABLE' // transient 5xx / worker restart → exponential backoff
  | 'PLUGIN_DISABLED' // host 404 OR SDK code 'PLUGIN_DISABLED' → TERMINAL stop
  | 'TIMEOUT' // transient
  | 'UNKNOWN'; // unexpected; treat as transient

export type PollError = {
  kind: PollErrorKind;
  status?: number;
  message?: string;
};

export type UsePollOptions<T> = {
  key: string;
  fetcher: () => Promise<T>;
  intervalMs: number;
  dedupeBy?: 'content-hash' | 'off';
  pauseOnHidden?: boolean; // default true
};

export type UsePollResult<T> = {
  data: T | null;
  error: PollError | null;
  stale: boolean;
  isLeader: boolean | null; // null until 02-04 wraps with leader-election
};

// ---------------------------------------------------------------------------
// Synchronous murmur3-32. Public-domain reference implementation. Returns the
// 32-bit hash as a zero-padded hex string. Inline (no dependency) because:
//   - the Web Crypto async digest API is async; running it inside the poll tick races with the
//     next scheduled tick, so two consecutive ticks can compute hashes out
//     of order and the dedupe predicate becomes unreliable (PITFALLS.md #7).
//   - The hash is used only for "are these two payloads identical" — not
//     cryptographic strength. murmur3 is fine.
// ---------------------------------------------------------------------------
export function murmur3_32(input: string, seed = 0): string {
  let h1 = seed | 0;
  const remainder = input.length & 3;
  const bytes = input.length - remainder;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let i = 0;
  while (i < bytes) {
    let k1 =
      (input.charCodeAt(i) & 0xff) |
      ((input.charCodeAt(i + 1) & 0xff) << 8) |
      ((input.charCodeAt(i + 2) & 0xff) << 16) |
      ((input.charCodeAt(i + 3) & 0xff) << 24);
    i += 4;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }
  let k1 = 0;
  switch (remainder) {
    case 3:
      k1 ^= (input.charCodeAt(i + 2) & 0xff) << 16;
    // falls through
    case 2:
      k1 ^= (input.charCodeAt(i + 1) & 0xff) << 8;
    // falls through
    case 1:
      k1 ^= input.charCodeAt(i) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }
  h1 ^= input.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// classifyFetchError — turns whatever the fetcher threw into a PollError with
// a discriminator. Recognises both the SDK structured-error shape (preferred)
// and HTTP-status fallback. PLUGIN_DISABLED is the only TERMINAL kind.
// ---------------------------------------------------------------------------
export function classifyFetchError(err: unknown): PollError {
  if (err && typeof err === 'object') {
    const errObj = err as { code?: unknown; status?: unknown; message?: unknown; name?: unknown; response?: unknown };
    if (errObj.code === 'PLUGIN_DISABLED') {
      return { kind: 'PLUGIN_DISABLED', message: typeof errObj.message === 'string' ? errObj.message : undefined };
    }
    if (errObj.code === 'WORKER_UNAVAILABLE') {
      return {
        kind: 'WORKER_UNAVAILABLE',
        message: typeof errObj.message === 'string' ? errObj.message : undefined,
      };
    }
    const status =
      (typeof errObj.status === 'number' ? errObj.status : undefined) ??
      (typeof (errObj.response as { status?: unknown } | undefined)?.status === 'number'
        ? ((errObj.response as { status: number }).status)
        : undefined);
    if (status === 404) {
      return {
        kind: 'PLUGIN_DISABLED',
        status,
        message: '404 — plugin disabled or uninstalled',
      };
    }
    if (status === 503 || status === 502) {
      return {
        kind: 'WORKER_UNAVAILABLE',
        status,
        message: `${status} transient`,
      };
    }
    if (errObj.name === 'AbortError' || /timeout/i.test(String(errObj.message ?? ''))) {
      return { kind: 'TIMEOUT', message: typeof errObj.message === 'string' ? errObj.message : undefined };
    }
  }
  return { kind: 'UNKNOWN', message: String((err as { message?: unknown } | null | undefined)?.message ?? err) };
}

// ---------------------------------------------------------------------------
// createPollLoop — the pure state machine. Exposed for unit-testability so
// tests can drive ticks without a real React render. Returns control surfaces
// (`start`, `stop`, `tick`) and a state-snapshot getter.
//
// `setTimeoutImpl` / `clearTimeoutImpl` / `now` / `visibilityState` /
// `onStateChange` are all injectable so tests can mock the timer and the
// visibility API.
// ---------------------------------------------------------------------------
export type CreatePollLoopOptions<T> = UsePollOptions<T> & {
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (h: unknown) => void;
  visibilityState?: () => 'visible' | 'hidden';
  onStateChange?: (state: { data: T | null; error: PollError | null; stale: boolean }) => void;
  maxBackoffMs?: number;
};

export type PollLoop<T> = {
  start: () => void;
  stop: () => void;
  tick: () => Promise<void>;
  snapshot: () => {
    data: T | null;
    error: PollError | null;
    stale: boolean;
    stopped: boolean;
    nextDelayMs: number | null;
  };
};

export function createPollLoop<T>(opts: CreatePollLoopOptions<T>): PollLoop<T> {
  const setTimeoutImpl =
    opts.setTimeoutImpl ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutImpl =
    opts.clearTimeoutImpl ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const visibilityState =
    opts.visibilityState ??
    (() =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 'hidden'
        : 'visible');
  const pauseOnHidden = opts.pauseOnHidden !== false; // default true
  const dedupeBy = opts.dedupeBy ?? 'content-hash';
  const maxBackoff = opts.maxBackoffMs ?? 5 * 60_000;

  let stopped = false;
  let timerHandle: unknown = null;
  let backoffMs = opts.intervalMs;
  let lastHash: string | null = null;
  let data: T | null = null;
  let error: PollError | null = null;
  let nextDelayMs: number | null = null;

  function emit(): void {
    opts.onStateChange?.({ data, error, stale: false });
  }

  function schedule(delay: number): void {
    if (stopped) return;
    nextDelayMs = delay;
    timerHandle = setTimeoutImpl(() => {
      void tick();
    }, delay);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    if (pauseOnHidden && visibilityState() === 'hidden') {
      // Hidden — skip this fetch, requeue at the normal interval.
      schedule(opts.intervalMs);
      return;
    }
    try {
      const next = await opts.fetcher();
      if (dedupeBy === 'content-hash') {
        const hash = murmur3_32(JSON.stringify(next));
        if (hash !== lastHash) {
          lastHash = hash;
          data = next;
          error = null;
          emit();
        }
      } else {
        data = next;
        error = null;
        emit();
      }
      backoffMs = opts.intervalMs; // reset on success
      schedule(opts.intervalMs);
    } catch (e) {
      const pe = classifyFetchError(e);
      error = pe;
      emit();
      if (pe.kind === 'PLUGIN_DISABLED') {
        stopped = true;
        if (timerHandle != null) clearTimeoutImpl(timerHandle);
        timerHandle = null;
        nextDelayMs = null;
        return;
      }
      backoffMs = Math.min(backoffMs * 2, maxBackoff);
      schedule(backoffMs);
    }
  }

  return {
    start() {
      if (stopped || timerHandle != null) return;
      // First tick fires synchronously-ish on the next macrotask; tests can
      // call tick() directly for determinism.
      schedule(0);
    },
    stop() {
      stopped = true;
      if (timerHandle != null) clearTimeoutImpl(timerHandle);
      timerHandle = null;
      nextDelayMs = null;
    },
    tick,
    snapshot() {
      return { data, error, stale: false, stopped, nextDelayMs };
    },
  };
}

// ---------------------------------------------------------------------------
// usePoll — React hook wrapping createPollLoop. Returns the standard
// { data, error, stale, isLeader } shape; isLeader is null (02-04 wraps).
// ---------------------------------------------------------------------------
export function usePoll<T>(opts: UsePollOptions<T>): UsePollResult<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<PollError | null>(null);

  React.useEffect(() => {
    const loop = createPollLoop<T>({
      ...opts,
      onStateChange: (s) => {
        setData(s.data);
        setError(s.error);
      },
    });
    loop.start();
    return () => loop.stop();
    // We intentionally re-create the loop only when the key changes — fetcher
    // / intervalMs changes do NOT restart polling. Callers should memoize.
  }, [opts.key]);

  return { data, error, stale: false, isLeader: null };
}
