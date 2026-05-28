// src/ui/primitives/error-boundary.tsx
//
// Overnight 2026-05-28 — defensive per-section ErrorBoundary primitive.
//
// Background: clarity-pack v1.0.0 on BEAAA AriClaw renders the Reader tab
// against issue payloads that the smoke and integration tests never saw
// (BEAAA-828: ancestry.milestone.title >1,000 chars, YAML-shaped issue body
// with many `<UPPER>-<NUM>` tokens, null tldr, defensively-degraded refCards
// returning status='unknown'). ONE sub-component throwing at render
// propagates to the HOST's PluginSlotErrorBoundary, which catches the throw
// and renders a single "Clarity Pack: failed to render" pill — wiping every
// section in the Reader tab even though most sections would have rendered
// fine.
//
// Fix: wrap each Reader section in a SectionErrorBoundary. A throw inside
// one section degrades only THAT section to a small inline fallback caption
// — the rest of the Reader keeps rendering. Closes the wide-blast-radius
// problem the operator surfaced on multiple BEAAA issues (BEAAA-828,
// BEAAA-142, BEAAA-141, …): one bad section no longer takes down the tab.
//
// Design constraints honored:
//   - No new runtime npm dependency (CONTEXT.md: "NO new runtime deps").
//   - React-19-compatible class component (hooks cannot catch render errors;
//     getDerivedStateFromError + componentDidCatch are the only React-built-in
//     mechanism).
//   - Fallback UI carries data-clarity-region="error-boundary" + a
//     data-clarity-section attribute so source-grep tests can pin the wrap
//     and operator screenshots can identify which section degraded.
//   - Caption copy is intentionally terse and uses the locked literal
//     "Section unavailable" so the no-react-key-warnings + source-grep
//     suite can audit the wrap site verbatim.
//   - The boundary forwards the captured error to the host console via
//     console.error("clarity-pack: section <name> threw at render", err, info)
//     so the BEAAA repro surfaces a real stack trace post-deploy instead
//     of vanishing into the void of the host's "failed to render" pill.
//   - Reset semantics: a boundary re-renders its children on any
//     `resetKey` change so the Reader's resolver-driven re-renders
//     (issueId / companyId / userId flipping) can recover from a transient
//     throw on the next data tick. When resetKey is omitted, the boundary
//     stays in error state until unmount — the right default for purely
//     data-shape pathology that does not change between renders.

import * as React from 'react';

export type SectionErrorBoundaryProps = {
  /** Section identifier — used in console.error + data-clarity-section attribute.
   *  Stable strings only (lowercase-kebab, e.g. "breadcrumb", "tldr",
   *  "anchored-to"); the source-grep test pins this for each wrap site. */
  name: string;
  /** Optional reset trigger. When this value changes between renders, the
   *  boundary clears its error state and re-renders children. Omit to keep
   *  the boundary "stuck-on-error" for data-shape pathology that does not
   *  change between renders. */
  resetKey?: string | number | null;
  /** Optional fallback caption override. Defaults to "Section unavailable"
   *  (locked literal pinned by the source-grep test). */
  fallbackCaption?: string;
  children: React.ReactNode;
};

type SectionErrorBoundaryState = {
  errorMessage: string | null;
};

export class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  // Capture-only field. We DO NOT render the raw message — leaking arbitrary
  // error strings into the page is a low-risk but unnecessary attack surface.
  // The caption is a locked, safe literal; the raw error goes to console.
  state: SectionErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): SectionErrorBoundaryState {
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown';
    return { errorMessage };
  }

  componentDidUpdate(prevProps: SectionErrorBoundaryProps): void {
    // Clear the error state when the parent flips the reset key. The Reader's
    // upstream resolvers (issueId / companyId / userId) drive these on a real
    // data-tick boundary — recovering on the next tick is the right default.
    if (
      this.props.resetKey !== undefined &&
      prevProps.resetKey !== this.props.resetKey &&
      this.state.errorMessage !== null
    ) {
      this.setState({ errorMessage: null });
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Surface the throw in operator devtools. Without this line the boundary
    // silently swallows the stack trace and post-mortem diagnosis on BEAAA
    // requires a redeploy with extra logging. The console.error tag prefix
    // matches the host's "Clarity Pack: failed to render" pill so search
    // queries that already locate the host log will land on this log too.
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(
      `clarity-pack: section "${this.props.name}" threw at render — section degraded to fallback`,
      message,
      info?.componentStack ?? '',
    );
  }

  render(): React.ReactNode {
    if (this.state.errorMessage === null) {
      return this.props.children;
    }
    const caption = this.props.fallbackCaption ?? 'Section unavailable';
    return (
      <div
        className="clarity-error-boundary"
        data-clarity-region="error-boundary"
        data-clarity-section={this.props.name}
        role="status"
      >
        {caption}
      </div>
    );
  }
}
