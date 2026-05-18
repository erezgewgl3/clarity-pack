// src/worker/handlers/chat-roster.ts
//
// Plan 04-04 Task A — CHAT-01 — the chat.roster data handler.
//
// chat.roster feeds the roster rail of the Employee Chat surface: every
// Paperclip employee-agent for the company, EXCEPT the Editor-Agent. The
// Editor-Agent is Clarity Pack's own infra hire (it compiles TL;DRs and
// bulletins) — it is not a chat correspondent, so D-03 excludes it from the
// roster. It is filtered by AGENT ID (not by role string) — assumption A3:
// id-exclusion is reliable regardless of how the role field is populated.
//
// The Editor-Agent id is resolved via ctx.agents.managed.get('editor-agent',
// companyId) — the same managed-resolution key the worker reconciles at boot.
// If that resolution fails we still return the full roster (degraded but not
// broken — a missing filter beats a 500).
//
// Wrapped via opt-in-guard's wrapDataHandler — an opted-out (or
// unidentifiable) caller gets { error: 'OPT_IN_REQUIRED' } before the inner
// handler runs (T-04-15, OPTIN-04). Data handlers RETURN structured errors;
// they never throw.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type { PluginAgentsClient, PluginLogger } from '@paperclipai/plugin-sdk';
import { EDITOR_AGENT_KEY } from '../agents/editor.ts';

export type ChatRosterCtx = OptInGuardDataCtx & {
  agents: PluginAgentsClient;
  logger?: PluginLogger;
};

/** An agent as the roster rail needs it. */
type RosterEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
};

/** The subset of the SDK Agent shape this handler reads. */
type AgentLike = {
  id?: string;
  name?: string;
  role?: string;
  status?: string;
};

export function registerChatRoster(ctx: ChatRosterCtx): void {
  wrapDataHandler(ctx, 'chat.roster', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;

    if (!companyId) {
      return { error: 'COMPANY_ID_REQUIRED' };
    }
    if (!userId) {
      // Defensive — the opt-in-guard already rejects a missing userId.
      return { error: 'USER_ID_REQUIRED' };
    }

    // Resolve the Editor-Agent id so it can be excluded (D-03). A failure here
    // degrades gracefully — we return the full roster rather than a 500.
    let editorAgentId: string | null = null;
    try {
      const resolution = await ctx.agents.managed.get(EDITOR_AGENT_KEY, companyId);
      editorAgentId = resolution?.agentId ?? null;
    } catch (e) {
      ctx.logger?.warn?.('chat.roster: editor-agent resolution failed', {
        companyId,
        err: (e as Error).message,
      });
    }

    let agents: AgentLike[];
    try {
      agents = (await ctx.agents.list({ companyId })) as unknown as AgentLike[];
    } catch (e) {
      ctx.logger?.warn?.('chat.roster: agents.list failed', {
        companyId,
        err: (e as Error).message,
      });
      return { error: 'ROSTER_FAILED' };
    }

    const employees: RosterEmployee[] = (agents ?? [])
      .filter((a) => typeof a?.id === 'string' && a.id)
      .filter((a) => a.id !== editorAgentId) // D-03 — exclude the infra agent
      .map((a) => ({
        id: a.id as string,
        name: a.name ?? a.id ?? 'Unknown',
        role: a.role ?? '',
        status: a.status ?? 'unknown',
      }));

    return { kind: 'roster' as const, employees };
  });
}
