// src/ui/surfaces/bulletin/failed-compile-banner.tsx
//
// Plan 03-04 - BULL-08. Pure UI banner for a live failed compile retry
// window. It intentionally reads its own company/user context so it can stay
// mounted at the top of the Bulletin surface without coupling to page data.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import type { CompileFailureStatus } from '../../../shared/types.ts';

function hhmm(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function FailedCompileBanner(): React.ReactElement | null {
  const { companyId, loading: companyLoading } = useResolvedCompanyId();
  const { userId, loading: userLoading } = useResolvedUserId();

  const { data } = usePluginData<CompileFailureStatus>(
    'bulletin.latestCompileStatus',
    companyId && userId ? { companyId, userId } : { companyId: '', userId: '' },
  );

  if (companyLoading || userLoading || !companyId || !userId) return null;
  if (!data || data.kind !== 'failed') return null;
  if (new Date(data.nextRetryAt).getTime() <= Date.now()) return null;

  return (
    <section
      className="clarity-bulletin-failed-compile-banner"
      data-clarity-region="failed-compile-banner"
      role="status"
    >
      <div>
        Bulletin compile failed at {hhmm(data.attemptAt)} · retrying at {hhmm(data.nextRetryAt)}
      </div>
      <p className="clarity-bulletin-banner-reason">{data.reason}</p>
    </section>
  );
}
