// src/ui/surfaces/settings/index.tsx
//
// Plan 02-04 Task 1 — OPTIN-01..05 per-user opt-in settings page.
// Replaces the 02-02 stub at src/ui/surfaces/settings-stub.tsx.
//
// Renders a single checkbox bound to the current user's opted-in state.
// Toggle ON writes a clarity_user_prefs row (via useOptIn().toggle → action
// 'set-opt-in'); toggle OFF nulls opted_in_at. Default landing is ALWAYS
// the Paperclip classic dashboard (OPTIN-05) — this is stated in fine print
// directly under the checkbox so the user knows opting in does not redirect
// them.
//
// The page itself never renders the EnableClarityCta — Settings must remain
// reachable for opted-out users (so they can opt IN).

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';

export function SettingsPage(): React.ReactElement {
  const { optedIn, toggle, loading } = useOptIn();
  if (loading) {
    return (
      <ClaritySurfaceRoot name="settings">
        <p className="clarity-settings-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  return (
    <ClaritySurfaceRoot name="settings">
      <div className="clarity-settings" data-clarity-region="settings">
        <h1 className="clarity-settings-heading">Clarity Pack</h1>
        <label className="clarity-settings-toggle">
          <input
            type="checkbox"
            checked={optedIn}
            aria-label="Enable Clarity Pack for me"
            onChange={() => {
              void toggle();
            }}
          />
          <span>Enable Clarity Pack for me</span>
        </label>
        <p className="clarity-settings-fine">
          Default landing is the Paperclip classic dashboard either way (OPTIN-05). Clarity Pack
          surfaces (Reader, Situation Room, Daily Bulletin, Employee Chat) become available as
          opt-in clicks; this toggle never redirects the default landing.
        </p>
        <ErrataComposer />
      </div>
    </ClaritySurfaceRoot>
  );
}

function ErrataComposer(): React.ReactElement {
  const addErratum = usePluginAction('bulletin.errata.add');
  const { companyId } = useResolvedCompanyId();
  const { userId } = useResolvedUserId();
  const [cycle, setCycle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const submit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setMessage(null);
      setError(null);
      try {
        const result = (await addErratum({
          companyId: companyId ?? '',
          userId: userId ?? '',
          cycle: Number(cycle),
          body,
        })) as { ok?: boolean; error?: string };
        if (result?.ok) {
          setBody('');
          setMessage('Erratum added.');
        } else {
          setError(result?.error ?? 'Unable to add erratum.');
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [addErratum, body, companyId, cycle, userId],
  );

  return (
    <section className="clarity-settings-errata" data-clarity-region="settings-errata">
      <h2 className="clarity-settings-subheading">Add Erratum</h2>
      <form onSubmit={submit}>
        <label className="clarity-settings-field">
          <span>Bulletin cycle</span>
          <input
            type="number"
            min="1"
            value={cycle}
            aria-label="Bulletin cycle"
            onChange={(event) => setCycle(event.currentTarget.value)}
            required
          />
        </label>
        <label className="clarity-settings-field">
          <span>Erratum body</span>
          <textarea
            value={body}
            maxLength={2000}
            rows={5}
            aria-label="Erratum body"
            onChange={(event) => setBody(event.currentTarget.value)}
            required
          />
        </label>
        <button
          type="submit"
          className="clarity-settings-button"
          disabled={busy || !companyId || !userId}
        >
          Add Erratum
        </button>
      </form>
      {message ? <p className="clarity-settings-success">{message}</p> : null}
      {error ? <p className="clarity-settings-error">{error}</p> : null}
    </section>
  );
}
