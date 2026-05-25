// src/ui/primitives/agent-pause-banner.tsx
//
// Plan 05-05 Task 1 (D-06 + D-07) — generic paused-agent banner shared by
// Reader top-of-tab AND chat header. Three distinct copies dispatch on the
// `cause` field returned by the editor.pause-status worker handler.
//
// EXISTING editor-only `src/ui/surfaces/reader/pause-banner.tsx` STAYS — its
// locked literal "Editorial Desk paused — last compile failed at <HH:MM>.
// Resume in agent panel." is pinned by reader-view.test.mjs. That banner
// mounts in the Reader FOOTER; THIS new banner mounts at the TOP of the
// Reader surface AND at the top of the chat ChatPageBody (above the
// `.clarity-chat-shell`).
//
// D-07 LOCKED COPIES (cause discriminator → copy template):
//   - operator → `${agentName} paused by operator — ▶ Resume heartbeat`
//   - budget   → `${agentName} stopped — budget exhausted; check budget caps — ▶ Resume heartbeat`
//   - adapter  → `${agentName} stopped — codex adapter error ${detail}; ▶ Retry heartbeat`
//
// NO_UUID_LEAK: agentName comes from ctx.agents.get server-side; when the
// lookup degrades the worker returns null and this component falls back to
// the LITERAL string 'this employee' — NEVER the UUID. Source-grep test pins
// the literal at test/ui/agent-pause-banner.test.mjs.
//
// Plan 02-09 Task 2 pattern — viewer identity uses useResolvedUserId() (the
// Better-Auth-backed resolver). While the resolver is in flight we pass an
// empty params object so the opt-in-guard short-circuits to OPT_IN_REQUIRED
// — the banner stays null (right default; we don't want a pause banner racing
// a not-yet-resolved render).
//
// SECURITY: every dynamic field (agentName, detail) renders as untrusted
// React text only — NEVER the inner-HTML escape hatch. Source-grep banned
// at test time (the R3 invariant).
//
// Plan 04.1-10 pattern reuse — the ▶ Resume heartbeat / ▶ Retry heartbeat
// inline action wires through usePluginAction('agents.resumeHeartbeat') with
// graceful-degrade copy on failure (the host action key may not be wired on
// every Paperclip host today; toast tells the operator the agent page is
// the canonical resume path).

import * as React from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { useResolvedUserId } from './use-resolved-user-id.ts';

/** Plan 05-05 D-07 — pause cause variants. */
export type AgentPauseCause = 'operator' | 'budget' | 'adapter';

/** Plan 05-05 D-07 — discriminated payload from the editor.pause-status worker
 *  handler. Legacy fields (lastFailureAt + reason) coexist so the editor-only
 *  `pause-banner.tsx` keeps reading them; this component reads ONLY the new
 *  cause / agentName / detail fields. */
export type AgentPauseStatus =
  | { paused: false }
  | {
      paused: true;
      cause: AgentPauseCause;
      agentName: string | null;
      detail?: string;
    };

export type AgentPauseBannerProps = {
  /** Plan 05-05 — companyId from the parent surface (Reader: useResolvedCompanyId;
   *  Chat: companyId prop drilled into ChatPageBody). Required because the
   *  worker uses it to resolve agentName via ctx.agents.get. */
  companyId: string;
  /** Optional — when set, future plans can key the banner on a specific
   *  employee-agent. Plan 05-05 implicitly targets the Editor-Agent via the
   *  worker handler's hard-coded EDITOR_AGENT_KEY; the prop is plumbed for
   *  forward-compat (handler-side keying lands in Phase 6+). */
  agentId?: string | null;
};

export function AgentPauseBanner({
  companyId,
  agentId: _agentId,
}: AgentPauseBannerProps): React.ReactElement | null {
  // Plan 02-09 Task 2 — resolver-sourced userId. While resolving we pass
  // empty params; opt-in-guard returns OPT_IN_REQUIRED; the banner stays null.
  const { userId, loading: userIdLoading } = useResolvedUserId();

  const { data } = usePluginData<AgentPauseStatus | { error: string }>(
    'editor.pause-status',
    !userIdLoading && userId ? { userId, companyId } : {},
  );

  const [dismissed, setDismissed] = React.useState(false);

  // Plan 04.1-10 — usePluginAction('agents.resumeHeartbeat'). The host action
  // key may or may not be bound on the current host; the wrapper catches and
  // surfaces a graceful-degrade message inline. The button visual stays
  // active across both paths so the operator's intent is reflected.
  const resumeAction = usePluginAction('agents.resumeHeartbeat');
  const [resumeStatus, setResumeStatus] = React.useState<'idle' | 'pending' | 'done' | 'degraded'>(
    'idle',
  );

  const onResumeClick = React.useCallback(async () => {
    setResumeStatus('pending');
    try {
      await resumeAction({ companyId });
      setResumeStatus('done');
    } catch {
      // The host action key may not be wired on this Paperclip instance —
      // graceful degrade with explicit copy. The operator can still finish
      // the round-trip on the agent page.
      setResumeStatus('degraded');
    }
  }, [resumeAction, companyId]);

  // Render-nothing branches:
  //   - resolver in flight (we don't race a not-yet-resolved render)
  //   - no data yet
  //   - opt-in-guard short-circuit (structured error envelope)
  //   - healthy (paused: false)
  //   - operator dismissed this banner this session
  if (userIdLoading) return null;
  if (!data) return null;
  if ('error' in data) return null;
  if (!data.paused) return null;
  if (dismissed) return null;

  // NO_UUID_LEAK: friendly fallback when agentName degraded.
  const agentName = data.agentName ?? 'this employee';
  const cause = data.cause;
  const detail = ('detail' in data && data.detail) ? data.detail : '—';

  // D-07 locked copies (verbatim — pinned by the source-grep test).
  let copy: string;
  let action: 'resume' | 'retry';
  if (cause === 'operator') {
    copy = `${agentName} paused by operator — ▶ Resume heartbeat`;
    action = 'resume';
  } else if (cause === 'budget') {
    copy = `${agentName} stopped — budget exhausted; check budget caps — ▶ Resume heartbeat`;
    action = 'resume';
  } else {
    // adapter
    copy = `${agentName} stopped — codex adapter error ${detail}; ▶ Retry heartbeat`;
    action = 'retry';
  }

  const actionLabel = action === 'retry' ? '▶ Retry heartbeat' : '▶ Resume heartbeat';

  return (
    <div
      className="clarity-agent-pause-banner"
      role="status"
      data-clarity-region="agent-pause-banner"
      data-clarity-cause={cause}
    >
      <span className="clarity-agent-pause-banner-copy">{copy}</span>
      <button
        type="button"
        className="clarity-agent-pause-banner-action"
        onClick={() => void onResumeClick()}
        disabled={resumeStatus === 'pending'}
        data-clarity-action={action === 'retry' ? 'retry-heartbeat' : 'resume-heartbeat'}
        title={
          resumeStatus === 'degraded'
            ? `${actionLabel} (host call pending — verify on the agent page)`
            : actionLabel
        }
      >
        {resumeStatus === 'pending' ? '…' : actionLabel}
      </button>
      <button
        type="button"
        className="clarity-agent-pause-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss pause banner"
      >
        ×
      </button>
    </div>
  );
}
