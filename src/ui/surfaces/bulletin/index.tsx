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

// Quick task 260528-nns + delivery-layer rework (2026-05-28) — the on-demand
// "Generate bulletin now" control.
//
// The agent compile (~50s) cannot run inside a single host invocation
// (paperclipai@2026.525.0 expires the scope mid-poll — PR #6547), so the
// `bulletin.compileNow` action ENQUEUES the request (returns { kind:'queued' })
// and the every-minute compile-bulletin job runs the force compile across ticks.
// The button therefore can't read a synchronous published/no-change result;
// instead it shows "Compiling…", polls `bulletin.byCycle` (via the parent's
// refresh) for a newer edition for ~90s, then settles to a calm "still
// compiling" note (Decision #4). The job finishes in the background regardless.
type CompileNowResult =
  | { kind: 'queued' }
  | { kind: 'error'; reason: string }
  | { error: string };

const COMPILE_UNAVAILABLE = 'Editorial Desk unavailable — resume it in the Agents panel.';
// Decision #4 — the calm, non-error settle copy after the UI poll window.
const STILL_COMPILING_NOTE =
  'Still compiling — the Editorial Desk can take a minute or two; your bulletin will appear here when it’s ready.';
// Poll the latest edition every 8s, for up to ~90s, while a compile is queued.
const COMPILE_POLL_INTERVAL_MS = 8_000;
const COMPILE_POLL_WINDOW_MS = 90_000;

function GenerateBulletinNow({
  companyId,
  userId,
  currentCycleNumber,
  currentPublishedAt,
  refresh,
}: {
  companyId: string;
  userId: string;
  currentCycleNumber: number | null;
  currentPublishedAt: string | null;
  refresh: () => void;
}): React.ReactElement {
  const compileNow = usePluginAction('bulletin.compileNow');
  const [status, setStatus] = React.useState<'idle' | 'compiling' | 'done'>('idle');
  const [resultMsg, setResultMsg] = React.useState<string | null>(null);

  // Baseline edition captured at click time + the poll deadline + a stable
  // refresh handle — kept in refs so the polling effect depends only on
  // `status` and never thrashes the interval when the parent re-renders.
  const baselineRef = React.useRef<{ cycle: number | null; publishedAt: string | null }>({
    cycle: null,
    publishedAt: null,
  });
  const deadlineRef = React.useRef<number>(0);
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;

  // While compiling: re-fetch byCycle on an interval; settle to the calm note
  // once the poll window elapses.
  React.useEffect(() => {
    if (status !== 'compiling') return undefined;
    const id = setInterval(() => {
      if (Date.now() > deadlineRef.current) {
        setStatus('done');
        setResultMsg(STILL_COMPILING_NOTE);
        return;
      }
      refreshRef.current();
    }, COMPILE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  // While compiling: a newer edition (cycle number bumped, or a new publishedAt)
  // means the queued compile published — show it and stop.
  React.useEffect(() => {
    if (status !== 'compiling') return;
    const base = baselineRef.current;
    const newer =
      (typeof currentCycleNumber === 'number' && currentCycleNumber !== base.cycle) ||
      (!!currentPublishedAt && currentPublishedAt !== base.publishedAt);
    if (newer) {
      setStatus('done');
      setResultMsg(
        typeof currentCycleNumber === 'number'
          ? `Published Bulletin No. ${currentCycleNumber}`
          : 'Published a new bulletin',
      );
    }
  }, [status, currentCycleNumber, currentPublishedAt]);

  const onClick = React.useCallback(async () => {
    baselineRef.current = { cycle: currentCycleNumber, publishedAt: currentPublishedAt };
    deadlineRef.current = Date.now() + COMPILE_POLL_WINDOW_MS;
    setResultMsg(null);
    setStatus('compiling');
    try {
      const r = (await compileNow({ companyId, userId })) as CompileNowResult;
      if (r && 'error' in r) {
        // {error:'OPT_IN_REQUIRED'} or similar — stop and show the unavailable copy.
        setStatus('done');
        setResultMsg(COMPILE_UNAVAILABLE);
      } else if (r && 'kind' in r && r.kind === 'error') {
        setStatus('done');
        setResultMsg(r.reason || COMPILE_UNAVAILABLE);
      }
      // { kind:'queued' } → stay in 'compiling'; the effects resolve it.
    } catch {
      setStatus('done');
      setResultMsg(COMPILE_UNAVAILABLE);
    }
  }, [compileNow, companyId, userId, currentCycleNumber, currentPublishedAt]);

  return (
    <div className="clarity-bulletin-compile-now" data-clarity-region="bulletin-compile-now">
      <button
        type="button"
        className="clarity-bulletin-compile-now-btn"
        onClick={() => void onClick()}
        disabled={status === 'compiling'}
        title="Compile a bulletin from the current state without waiting for the 06:30 cycle"
      >
        {status === 'compiling' ? 'Compiling…' : 'Generate bulletin now'}
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

  // The latest published edition the page currently shows — the baseline the
  // "Generate bulletin now" poll compares against to detect a fresh publish.
  const published =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'published' ? data : null;
  const latestCycle = published ? published.cycleNumber : null;
  const latestPublishedAt = published ? published.publishedAt ?? null : null;

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
      <GenerateBulletinNow
        companyId={companyId}
        userId={userId}
        currentCycleNumber={latestCycle}
        currentPublishedAt={latestPublishedAt}
        refresh={refresh}
      />
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
