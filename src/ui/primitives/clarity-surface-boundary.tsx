// src/ui/primitives/clarity-surface-boundary.tsx
//
// T1-D (no-rabbit-holes self-health, 2026-06-15) — a TOP-LEVEL error boundary
// wrapped around every Clarity surface export. Background: on BEAAA the entire
// Clarity UI rendered BLANK for days with no signal (a fail2ban-interrupted
// v1.6.0 deploy left the worker crashed + the UI bundle 404'ing). The
// per-section SectionErrorBoundary (error-boundary.tsx) only protects sections
// INSIDE a surface that already mounted; a throw in a surface's own render/hook
// body bubbles past it to the host's generic "Clarity Pack: failed to render"
// pill — opaque, and in the degenerate case the operator just saw nothing.
//
// This boundary sits OUTSIDE the surface component (the host renders
// <ClaritySurfaceBoundary><Surface/></ClaritySurfaceBoundary> via the HOC
// below), so it catches ANY render-time throw in the surface tree — including
// the top-level hook/render throws SectionErrorBoundary cannot reach — and
// renders an explicit, honest "Clarity is unavailable" banner. The operator
// NEVER sees a blank frame for a catchable failure; they see what happened and
// what to do (hard refresh).
//
// SCOPE (honest about limits): a React boundary can only catch failures of code
// that RAN. The original incident's root cause — the UI bundle itself 404'ing
// (no Clarity JS loaded at all) — is NOT catchable here; that class needs an
// ops/host-level liveness probe (see the worker `clarity-pack/health` handler).
//
// Design constraints (mirror error-boundary.tsx):
//   - No new runtime npm dependency.
//   - React-19 class component (hooks cannot catch render errors).
//   - Forwards the captured error to console.error so post-deploy diagnosis on
//     BEAAA gets a real stack instead of a silent blank.
//   - The fallback is wrapped in a [data-clarity-surface] element so theme.css
//     scoping applies and source-grep / screenshots can pin it.

import * as React from 'react';

export type ClaritySurfaceBoundaryProps = {
  /** Human-readable surface label shown in the banner (e.g. "Situation Room"). */
  label: string;
  children: React.ReactNode;
};

type ClaritySurfaceBoundaryState = { failed: boolean };

export class ClaritySurfaceBoundary extends React.Component<
  ClaritySurfaceBoundaryProps,
  ClaritySurfaceBoundaryState
> {
  state: ClaritySurfaceBoundaryState = { failed: false };

  static getDerivedStateFromError(): ClaritySurfaceBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    // Tag prefix matches the host's "Clarity Pack: failed to render" pill so a
    // log search that already finds the host log lands on this richer one too.
    console.error(
      `clarity-pack: surface "${this.props.label}" threw at render — showing the honest unavailable banner instead of a blank frame`,
      message,
      info?.componentStack ?? '',
    );
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-clarity-surface="unavailable">
        <div
          className="clarity-surface-unavailable"
          data-clarity-region="surface-unavailable"
          role="status"
        >
          <strong className="clarity-surface-unavailable-title">
            Clarity is unavailable right now.
          </strong>
          <span className="clarity-surface-unavailable-body">
            {`The ${this.props.label} couldn’t load. Try a hard refresh (Ctrl+Shift+R). If it persists, the plugin may be reloading — Paperclip’s own UI is unaffected.`}
          </span>
        </div>
      </div>
    );
  }
}

/**
 * Wrap a surface component in a top-level ClaritySurfaceBoundary. The host
 * mounts the returned component directly; a render throw anywhere in
 * `Component`'s tree degrades to the honest banner instead of bubbling to the
 * host's generic pill (or, in the worst case, a blank frame).
 */
// The host mounts every surface via createElement(component, { slot, context })
// with surface-specific prop shapes (PluginPageProps / PluginDetailTabProps /
// …). The HOC is intentionally prop-shape-agnostic: it forwards whatever the
// host passes, unchanged, into a boundary. Typing the bridge boundary as
// ComponentType<any> mirrors that dynamic mount contract (the inner surface
// keeps its own precise prop types).
export function withClarityBoundary(
  Component: React.ComponentType<any>,
  label: string,
): React.ComponentType<any> {
  function ClarityBoundaryWrapper(props: any): React.ReactElement {
    return (
      <ClaritySurfaceBoundary label={label}>
        <Component {...props} />
      </ClaritySurfaceBoundary>
    );
  }
  ClarityBoundaryWrapper.displayName = `withClarityBoundary(${label})`;
  return ClarityBoundaryWrapper;
}
