// src/worker/handlers/companies-resolve.ts
//
// Plan 02-03c Task 2 — companies.resolve-prefix worker handler.
//
// Why it exists: useHostContext().companyId is null for detail-tab slots
// while IssueDetail.tsx's issue query is in flight (proven empirically by
// 02-03b drill, root-caused in 02-03c-HOST-CONTEXT.md Section 1). The UI
// hook useResolvedCompanyId() falls back to URL parsing (companyPrefix) and
// calls this handler to translate prefix → UUID.
//
// Why ctx.companies.list + filter (instead of ctx.companies.get): the SDK
// 2026.512.0 PluginCompaniesClient (types.d.ts:776-788) exposes only list()
// and get(id). There is no get-by-prefix. List + client-side filter is the
// only path. Performance is fine — Paperclip instances have <100 companies
// in v1, and the resolver is called at most once per Reader-tab mount.
//
// Capability: companies.read — already declared in src/manifest.ts:58.

import type { Company, PluginCompaniesClient, PluginLogger } from '@paperclipai/plugin-sdk';

export type CompaniesResolveCtx = {
  logger?: PluginLogger;
  data: {
    register(
      key: string,
      handler: (params: Record<string, unknown>) => Promise<{ companyId: string; displayName: string }>,
    ): void;
  };
  companies: PluginCompaniesClient;
};

export function registerCompaniesResolve(ctx: CompaniesResolveCtx): void {
  ctx.data.register('companies.resolve-prefix', async (params) => {
    const raw = params?.companyPrefix;
    const prefix = typeof raw === 'string' ? raw.trim() : '';
    if (!prefix) {
      throw new Error('companyPrefix required');
    }

    const companies: Company[] = await ctx.companies.list();
    const match = companies.find((c) => c.issuePrefix === prefix);
    if (!match) {
      throw new Error(`no company found with issuePrefix "${prefix}"`);
    }
    return { companyId: match.id, displayName: match.name };
  });
}
