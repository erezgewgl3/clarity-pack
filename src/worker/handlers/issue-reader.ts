// src/worker/handlers/issue-reader.ts
//
// Plan 02-03 — registers the 'issue.reader' data handler that the Reader view
// (Task 2) calls via usePluginData. Task 1 ships a minimal stub so worker.ts
// can wire registration cleanly; Task 2 fills in the real implementation
// (TL;DR lookup + refs resolution + ancestry + AC items + activity timeline).

export type IssueReaderResult = {
  tldr: unknown | null;
  refCards: unknown[];
  ancestry: { project: unknown; milestone: unknown; parent: unknown } | null;
  acItems: unknown[];
  activity: unknown[];
  deliverable: unknown | null;
  issueBody: string | null;
};

export type IssueReaderCtx = {
  data: {
    register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  };
};

/**
 * Register the issue.reader data handler. Task-1-minimal — returns an empty
 * payload so the worker boot path and the manifest slot can be exercised
 * without the full Reader pipeline. Task 2 replaces the body with the real
 * compose-from-cache-+-refs flow.
 */
export function registerIssueReader(ctx: IssueReaderCtx): void {
  ctx.data.register('issue.reader', async () => {
    const empty: IssueReaderResult = {
      tldr: null,
      refCards: [],
      ancestry: null,
      acItems: [],
      activity: [],
      deliverable: null,
      issueBody: null,
    };
    return empty;
  });
}
