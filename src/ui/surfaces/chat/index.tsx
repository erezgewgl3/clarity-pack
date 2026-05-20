// src/ui/surfaces/chat/index.tsx
//
// Plan 04-05 — CHAT-01 — the Employee Chat page surface. Replaces the
// chat-stub.tsx placeholder.
//
// Three-gate composition mirrors bulletin/index.tsx EXACTLY (Plan 02-09
// pattern):
//   useOptIn          → opted-out renders <EnableClarityCta surfaceName="Chat">
//   useResolvedCompanyId → unresolved renders the error fallback
//   useResolvedUserId    → unresolved renders the error fallback
// userId MUST come from useResolvedUserId — never bare useHostContext().userId
// (the production null-userId gap, DEV-15-STRUCTURAL).
//
// Then the four-region shell — roster rail / topic strip + message thread /
// context rail — a 3-column grid 264px 1fr 340px per
// sketches/paperclip-fix-employee-chat.html l. 44.
//
// The manifest `clarity-chat` slot's exportName MUST stay `ChatPage`.
//
// All chat text renders as untrusted React text — never
// dangerouslySetInnerHTML. SPA navigation via useHostNavigation().linkProps,
// never raw <a href>.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

import { RosterRail, type RosterEmployee } from './roster-rail.tsx';
import { TopicStrip, type ChatTopic, chtLabel } from './topic-strip.tsx';
import { ContextRail } from './context-rail.tsx';
import { Composer } from './composer.tsx';
import { DiagnosticsToggle } from './diagnostics-toggle.tsx';

export function ChatPage(_props?: PluginPageProps): React.ReactElement {
  // OPTIN — gate BEFORE resolution.
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="chat">
        <EnableClarityCta surfaceName="Chat" />
      </ClaritySurfaceRoot>
    );
  }
  return <ChatPageOptedIn />;
}

function ChatPageOptedIn(): React.ReactElement {
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();
  const { userId, loading: userLoading, error: userError } = useResolvedUserId();

  if (companyLoading || userLoading) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-loading">Resolving context…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (companyError || !companyId) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-error" data-clarity-error="no-company-context">
          Chat unavailable — could not identify the active company.
        </p>
      </ClaritySurfaceRoot>
    );
  }
  if (userError || !userId) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-error" data-clarity-error="no-user-context">
          Chat unavailable — could not identify the current user.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ClaritySurfaceRoot name="chat">
      <ChatPageBody companyId={companyId} userId={userId} />
    </ClaritySurfaceRoot>
  );
}

function ChatPageBody({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}): React.ReactElement {
  const [employee, setEmployee] = React.useState<RosterEmployee | null>(null);
  const [topic, setTopic] = React.useState<ChatTopic | null>(null);
  // Bumped after a successful chat.topic.create so the TopicStrip's key
  // changes and its usePluginData('chat.topics') re-fetches the new topic in
  // (GAP 2 — the strip otherwise never re-fetches after a create).
  const [refreshKey, setRefreshKey] = React.useState(0);
  // A non-blocking error surfaced when chat.topic.create returns { error }
  // (GAP 1 — the create handler RETURNS errors, it does not throw).
  const [createError, setCreateError] = React.useState<string | null>(null);
  // Plan 04.1-06 Pattern F — D-16 diagnostics toggle (header). Local React
  // state — does NOT persist across reloads (UI-SPEC §Persistence).
  const [diagnostics, setDiagnostics] = React.useState(false);

  // The roster rail hands back the full employee row — used for the active
  // highlight, the thread head, and the context rail. Switching employee
  // clears the active topic (the topic strip auto-selects the new employee's
  // most-recent topic).
  const handleSelectEmployee = React.useCallback((next: RosterEmployee) => {
    setEmployee(next);
    setTopic(null);
  }, []);

  const handleSelectTopic = React.useCallback((next: ChatTopic) => {
    setTopic(next);
  }, []);

  const createTopic = usePluginAction('chat.topic.create');
  const [creating, setCreating] = React.useState(false);

  const handleNewTopic = React.useCallback(async () => {
    if (!employee) return;
    const title = (typeof window !== 'undefined' ? window.prompt('New topic title') : null)?.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    try {
      // chat.topic.create RETURNS its outcome — { ok, topicId, issueId,
      // parentIssueId } on success or { error } on failure. It does NOT throw
      // on a worker-side failure, so the result must be inspected (GAP 1).
      const result = await createTopic({
        employeeAgentId: employee.id,
        title,
        companyId,
        userId,
      });

      if (
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: unknown }).ok === true
      ) {
        const created = result as {
          ok: true;
          topicId: string;
          issueId: string;
          parentIssueId: string;
        };
        // GAP 1 — drop the user straight into the just-created topic so the
        // composer opens for the first message immediately.
        setTopic({
          topicId: created.topicId,
          issueId: created.issueId,
          parentIssueId: created.parentIssueId,
          employeeAgentId: employee.id,
          title,
          lastActivityAt: new Date().toISOString(),
          archived: false,
        });
        // GAP 2 — force the TopicStrip to re-fetch so the new topic appears in
        // the strip without re-selecting the employee.
        setRefreshKey((k) => k + 1);
      } else {
        // GAP 1 — the create RETURNED an error. Surface it visibly; never
        // silently swallow it (the old empty catch could not even see this).
        const errCode =
          result && typeof result === 'object' && 'error' in result
            ? String((result as { error: unknown }).error)
            : 'CREATE_FAILED';
        setCreateError(errCode);
      }
    } catch {
      // A genuine transport-level throw (rare — the handler returns errors).
      setCreateError('CREATE_FAILED');
    } finally {
      setCreating(false);
    }
  }, [employee, createTopic, companyId, userId]);

  return (
    <div className="clarity-chat-shell" data-clarity-region="chat-shell">
      <RosterRail
        companyId={companyId}
        userId={userId}
        activeEmployeeId={employee?.id ?? null}
        onSelectEmployee={handleSelectEmployee}
      />

      <main className="thread" data-clarity-region="thread">
        <header className="thread-head">
          <div className="who-big">
            <div className="av">
              {(employee?.name ?? '?').trim()[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="role">
              {employee?.name || 'Select an employee'}
              {employee?.role ? <small>{employee.role}</small> : null}
            </div>
          </div>
          <div className="global-search">
            <span className="icon">⌕</span>
            <input
              placeholder="Search all chats and tasks across BEAAA…"
              aria-label="Search chats"
            />
          </div>
          <div className="head-actions">
            {/* Plan 04.1-06 Pattern F — D-16 diagnostics toggle. Sits to
                the LEFT of "+ New topic" per UI-SPEC §"Diagnostics toggle". */}
            <DiagnosticsToggle
              armed={diagnostics}
              onToggle={() => setDiagnostics((a) => !a)}
            />
            <button
              type="button"
              className="btn"
              onClick={handleNewTopic}
              disabled={!employee || creating}
            >
              + New topic
            </button>
          </div>
        </header>

        <TopicStrip
          companyId={companyId}
          userId={userId}
          employeeAgentId={employee?.id ?? ''}
          activeTopicIssueId={topic?.issueId ?? null}
          onSelectTopic={handleSelectTopic}
          key={`${employee?.id ?? 'none'}:${refreshKey}`}
        />

        {createError ? (
          <div className="topic-create-error" role="alert" data-clarity-error="topic-create">
            Could not start the topic ({createError}). Try + New topic again.
          </div>
        ) : null}

        {!employee ? (
          <div className="thread-empty">
            Pick an employee from the roster to open a conversation.
          </div>
        ) : !topic ? (
          <div className="thread-empty">
            No topic selected — choose a topic above or start a new one.
          </div>
        ) : (
          // Composer owns the optimistic-send state and renders the
          // MessageThread itself (the thread reads the optimistic overlay).
          // Plan 04.1-06 — Composer now needs topicId / assigneeAgentId /
          // employeeName / employeeRole / diagnostics so the TrueTaskDialog
          // and PromoteActions can call chat.createTrueTask / chat.promote
          // with the new D-06/D-07 required params, and so MessageThread
          // can pass includeDiagnostics: through to chat.messages.
          <Composer
            companyId={companyId}
            userId={userId}
            topicIssueId={topic.issueId}
            topicTitle={topic.title}
            topicId={chtLabel(topic)}
            assigneeAgentId={employee.id}
            employeeName={employee.name}
            employeeRole={employee.role}
            diagnostics={diagnostics}
            key={`composer-${topic.issueId}`}
          />
        )}
      </main>

      <ContextRail
        employee={employee}
        topic={topic}
        companyId={companyId}
        userId={userId}
        onArchived={() => {
          // Plan 04.1-06 Pattern E — after a successful archive, drop the
          // archived topic from the active view and force the strip to
          // re-fetch so the "+N archived" pill reflects the new count.
          setTopic(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
