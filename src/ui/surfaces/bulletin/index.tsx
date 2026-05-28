// src/ui/surfaces/bulletin/index.tsx
//
// Plan 03-03 — BULL-03 + BULL-04 Daily Bulletin page. Mirrors
// situation-room/index.tsx EXACTLY for the opt-in + resolver composition.
//
// Gate order (Plan 02-09 pattern):
//   useOptIn          → opted-out renders <EnableClarityCta surfaceName="Bulletin">
//   useResolvedCompanyId → unresolved renders the error fallback
//   useResolvedUserId    → unresolved renders the error fallback
// then usePluginData<BulletinByCycleResult>('bulletin.byCycle',
//   {cycle:'latest', companyId, userId}).
//
// Page states:
//   {error:'OPT_IN_REQUIRED'}   → <EnableClarityCta> (belt-and-suspenders)
//   {kind:'not-yet-published'}  → "First Edition" empty state
//   {kind:'published'}          → all 6 child components
//
// Visual fidelity target: sketches/paperclip-fix-bulletin.html.

import * as React from 'react';
import { usePluginData, usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { ClaritySurfaceHeader } from '../../primitives/clarity-surface-header.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

import { Masthead } from './masthead.tsx';
import { ActionInbox } from './action-inbox.tsx';
import { DepartmentSection, type DepartmentItem } from './department-section.tsx';
import { StandingNumbersPanel } from './standing-numbers-panel.tsx';
import { LineageFooter } from './lineage-footer.tsx';
import { FailedCompileBanner } from './failed-compile-banner.tsx';
import { ErrataFooter } from './errata-footer.tsx';

import type {
  ActionInboxCard,
  ErratumEntry,
  LineageThread,
  StandingNumberRow,
} from '../../../shared/types.ts';

type MastheadData = {
  volume: string;
  number: number;
  weekday: string;
  dateText: string;
  prepareForName: string;
  cycleNumber: number;
};

type DepartmentData = {
  name: string;
  items: DepartmentItem[];
  editorialSummary: string;
};

type BulletinByCycleResult =
  | { error: 'OPT_IN_REQUIRED' | 'COMPANY_ID_REQUIRED' | 'USER_ID_REQUIRED' }
  | { kind: 'not-yet-published' }
  | {
      kind: 'published';
      cycleNumber: number;
      body: string | null;
      publishedIssueId: string;
      publishedAt: string | null;
      masthead: MastheadData | null;
      departments: DepartmentData[];
      standingNumbers: StandingNumberRow[];
      lineageThreads: LineageThread[];
      actionInbox: ActionInboxCard[];
      errata: ErratumEntry[];
    }
  | null;

export function BulletinPage(_props?: PluginPageProps): React.ReactElement {
  // OPTIN — gate BEFORE resolution.
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="bulletin">
        <p className="clarity-bulletin-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="bulletin">
        <EnableClarityCta surfaceName="Bulletin" />
      </ClaritySurfaceRoot>
    );
  }
  return <BulletinPageOptedIn />;
}

function BulletinPageOptedIn(): React.ReactElement {
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();
  const { userId, loading: userLoading, error: userError } = useResolvedUserId();

  if (companyLoading || userLoading) {
    return (
      <ClaritySurfaceRoot name="bulletin">
        <p className="clarity-bulletin-loading">Resolving context…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (companyError || !companyId) {
    return (
      <ClaritySurfaceRoot name="bulletin">
        <p className="clarity-bulletin-error" data-clarity-error="no-company-context">
          Bulletin unavailable — could not identify the active company.
        </p>
      </ClaritySurfaceRoot>
    );
  }
  if (userError || !userId) {
    return (
      <ClaritySurfaceRoot name="bulletin">
        <p className="clarity-bulletin-error" data-clarity-error="no-user-context">
          Bulletin unavailable — could not identify the current user.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ClaritySurfaceRoot name="bulletin">
      <BulletinPageBody companyId={companyId} userId={userId} />
    </ClaritySurfaceRoot>
  );
}

// Quick task 260528-nns — the on-demand "Generate bulletin now" control.
// Runs the same compile pipeline as the daily 06:30 cron via the
// `bulletin.compileNow` action (force + content dedupe; the daily schedule is
// left untouched). Three result states dispatch on the action's discriminated
// return; on a fresh publish it refreshes the byCycle data so the new edition
// renders without a manual reload.
type CompileNowResult =
  | { kind: 'published'; cycleNumber: number; publishedAt?: string | null }
  | { kind: 'no-change'; cycleNumber: number; publishedAt?: string | null }
  | { kind: 'error'; reason: string }
  | { error: string };

const COMPILE_UNAVAILABLE = 'Editorial Desk unavailable — resume it in the Agents panel.';

function GenerateBulletinNow({
  companyId,
  userId,
  onPublished,
}: {
  companyId: string;
  userId: string;
  onPublished: () => void;
}): React.ReactElement {
  const compileNow = usePluginAction('bulletin.compileNow');
  const [compiling, setCompiling] = React.useState(false);
  const [resultMsg, setResultMsg] = React.useState<string | null>(null);

  const onClick = React.useCallback(async () => {
    setCompiling(true);
    setResultMsg(null);
    try {
      const r = (await compileNow({ companyId, userId })) as CompileNowResult;
      if (r && 'kind' in r && r.kind === 'published') {
        setResultMsg(`Published Bulletin No. ${r.cycleNumber}`);
        onPublished();
      } else if (r && 'kind' in r && r.kind === 'no-change') {
        setResultMsg(`No changes since Bulletin No. ${r.cycleNumber}`);
      } else if (r && 'kind' in r && r.kind === 'error') {
        setResultMsg(r.reason || COMPILE_UNAVAILABLE);
      } else {
        // {error:'OPT_IN_REQUIRED'} or an unexpected shape.
        setResultMsg(COMPILE_UNAVAILABLE);
      }
    } catch {
      setResultMsg(COMPILE_UNAVAILABLE);
    } finally {
      setCompiling(false);
    }
  }, [compileNow, companyId, userId, onPublished]);

  return (
    <div className="clarity-bulletin-compile-now" data-clarity-region="bulletin-compile-now">
      <button
        type="button"
        className="clarity-bulletin-compile-now-btn"
        onClick={() => void onClick()}
        disabled={compiling}
        title="Compile a bulletin from the current state without waiting for the 06:30 cycle"
      >
        {compiling ? 'Compiling…' : 'Generate bulletin now'}
      </button>
      {resultMsg ? (
        <span className="clarity-bulletin-compile-now-result" role="status">
          {resultMsg}
        </span>
      ) : null}
    </div>
  );
}

function BulletinPageBody({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}): React.ReactElement {
  const { data, loading, refresh } = usePluginData<BulletinByCycleResult>('bulletin.byCycle', {
    cycle: 'latest',
    companyId,
    userId,
  });

  // Plan 05-08 (D-17) — shared `+ Create task` header for cross-surface
  // cold-task creation. Mounted at the top of every BulletinPageBody return.
  // Quick task 260528-nns — the "Generate bulletin now" control rides alongside
  // it so it shows in every page state (loading / first-edition / published).
  const header = (
    <>
      <ClaritySurfaceHeader
        companyId={companyId}
        userId={userId}
        surface="bulletin"
      />
      <GenerateBulletinNow companyId={companyId} userId={userId} onPublished={refresh} />
    </>
  );

  if (loading && !data) {
    return (
      <>
        {header}
        <FailedCompileBanner />
        <p className="clarity-bulletin-loading">Loading the morning bulletin…</p>
      </>
    );
  }

  // Belt-and-suspenders: opt-in error from the worker.
  if (data && typeof data === 'object' && 'error' in data && data.error === 'OPT_IN_REQUIRED') {
    return <EnableClarityCta surfaceName="Bulletin" />;
  }

  if (!data || ('kind' in data && data.kind === 'not-yet-published')) {
    return (
      <>
        {header}
        <FailedCompileBanner />
        <div className="clarity-bulletin-first-edition">
          <p className="clarity-bulletin-quiet">
            First Edition — the Editorial Desk has not compiled a bulletin yet. The next cycle
            runs at 06:30 Israel time.
          </p>
        </div>
      </>
    );
  }

  if (!('kind' in data) || data.kind !== 'published') {
    return (
      <p className="clarity-bulletin-error" data-clarity-error="unexpected-payload">
        Bulletin unavailable — unexpected response shape.
      </p>
    );
  }

  const masthead: MastheadData = data.masthead ?? {
    volume: 'I',
    number: data.cycleNumber,
    weekday: '',
    dateText: '',
    prepareForName: 'Eric G.',
    cycleNumber: data.cycleNumber,
  };

  return (
    <>
      {header}
      <FailedCompileBanner />
      <Masthead
        volume={masthead.volume}
        number={masthead.number}
        weekday={masthead.weekday}
        dateText={masthead.dateText}
        prepareForName={masthead.prepareForName}
        cycleNumber={masthead.cycleNumber}
      />
      <ActionInbox cards={data.actionInbox ?? []} companyId={companyId} userId={userId} />
      <div className="clarity-bulletin-main">
        <main className="clarity-bulletin-ops-col">
          {(data.departments ?? []).map((dept, i) => (
            <DepartmentSection
              key={dept.name}
              name={dept.name}
              items={dept.items ?? []}
              editorialSummary={dept.editorialSummary ?? ''}
              isFirst={i === 0}
            />
          ))}
        </main>
        <aside className="clarity-bulletin-rail">
          <StandingNumbersPanel rows={data.standingNumbers ?? []} />
        </aside>
      </div>
      <LineageFooter threads={data.lineageThreads ?? []} />
      <ErrataFooter errata={data.errata ?? []} />
      <div className="clarity-bulletin-colophon">
        <div>End of Bulletin · No. {data.cycleNumber}</div>
        <em>Compiled by the Editorial Desk · Auto-compiled</em>
      </div>
    </>
  );
}
