// src/worker/handlers/deliverable-preview.ts
//
// Plan 05-04 Task 1 -- deliverable.preview DATA handler (DIST-04).
//
// Full-fidelity in-place previewers for the Reader-view "The deliverable"
// section. The handler dispatches on documentKey extension and returns a
// discriminated-union result the UI mounts directly:
//
//   { kind: 'xlsx-grid', sheets: [{ name, rows: string[][] }] }
//   { kind: 'pdf-embed', url: string }
//   { kind: 'md',        body: string }
//   { kind: 'img',       url: string }
//   { kind: 'placeholder', reason: string }
//   { error: string }
//
// Threat-model anchors (T-05-04-01..-03 + T-05-04-SC):
//
//   T-05-04-01 -- SheetJS formula-injection. We call
//     XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellDates: true })
//     to disable formula re-evaluation. Cells already carry cached values from
//     the file; we surface those, never re-evaluate formulas. Parse-only path.
//
//   T-05-04-02 -- macro-enabled .xlsm files. Rejected via extension BEFORE
//     SheetJS is called. SheetJS would happily parse them; the explicit reject
//     keeps the trust boundary visible at the handler edge.
//
//   T-05-04-03 -- DoS via oversize xlsx blobs. We enforce XLSX_MAX_BYTES =
//     5_000_000 at the buffer-decoded length BEFORE SheetJS sees it. The host
//     IssueDocument shape does NOT carry a `size` field at SDK 2026.512.0, so
//     we cannot pre-check via summary metadata -- the size check fires after
//     body decode but BEFORE XLSX.read. (Documented as a 1-line deviation in
//     SUMMARY because the plan said "before SheetJS parses it"; we measure
//     the same buffer SheetJS would parse, just one step before the .read()
//     call. The single chokepoint invariant holds.)
//
//   T-05-04-SC -- supply-chain. The xlsx import is at module top so the
//     dependency surface is visible in worker bundle analysis. The UI bundle
//     never sees this file (worker/UI bundle split).
//
// Data-handler convention (mirrors chat-active-tasks.ts):
//   - missing required string param -> RETURN { error: '<KEY>_REQUIRED' }
//     (never throw -- data handlers carry structured errors)
//   - opted-out caller              -> RETURN { error: 'OPT_IN_REQUIRED' }
//     (via wrapDataHandler -- T-04-15; fires BEFORE the body)
//   - parse / read / size failures  -> RETURN structured { error } envelope
//
// The body returned by ctx.issues.documents.get is a string. Binary
// deliverables (xlsx, pdf, png) are stored base64-encoded; markdown stores
// the raw markdown body verbatim. The handler tries base64-decode FIRST for
// the parse paths; on a partial-decode mismatch SheetJS will fail parse and
// the structured PARSE_FAILED branch fires.

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import type {
  PluginIssuesClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';
import * as XLSX from 'xlsx';

const XLSX_MAX_BYTES = 5_000_000; // 5 MB -- T-05-04-03 chokepoint.
const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
] as const;
const MAX_ROWS_PER_SHEET = 1_000; // Defense-in-depth (per Task 1 action).

export type DeliverablePreviewCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
  logger?: PluginLogger;
};

export type DeliverablePreviewResult =
  | { kind: 'xlsx-grid'; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: 'pdf-embed'; url: string }
  | { kind: 'md'; body: string }
  | { kind: 'img'; url: string }
  | { kind: 'placeholder'; reason: string }
  | { error: string; sizeBytes?: number };

function lowerExt(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  return name.slice(i).toLowerCase();
}

/**
 * Best-effort body -> Buffer. Most binary deliverables (xlsx / pdf / png)
 * are stored base64-encoded; markdown is stored raw. For the parse path we
 * try base64 first and fall back to utf-8 bytes -- SheetJS will reject the
 * latter and fire PARSE_FAILED, which is the right answer.
 */
function bodyToBuffer(body: string): Buffer {
  // Heuristic: if the body looks like base64 (only A-Z, a-z, 0-9, +/= chars,
  // and length is a multiple of 4), try base64-decode. Otherwise fall back to
  // utf-8.
  if (/^[A-Za-z0-9+/=\s]+$/.test(body) && body.replace(/\s/g, '').length % 4 === 0) {
    try {
      return Buffer.from(body, 'base64');
    } catch {
      // Fall through.
    }
  }
  return Buffer.from(body, 'utf-8');
}

function coerceCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return v.toISOString();
  // Anything else (objects, arrays) -> stringify defensively.
  try {
    return String(v);
  } catch {
    return '';
  }
}

export function registerDeliverablePreview(ctx: DeliverablePreviewCtx): void {
  wrapDataHandler(ctx, 'deliverable.preview', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId
        ? params.companyId
        : null;
    const userId =
      typeof params?.userId === 'string' && params.userId
        ? params.userId
        : null;
    const issueId =
      typeof params?.issueId === 'string' && params.issueId
        ? params.issueId
        : null;
    const documentKey =
      typeof params?.documentKey === 'string' && params.documentKey
        ? params.documentKey
        : null;

    if (!companyId) return { error: 'COMPANY_ID_REQUIRED' as const };
    if (!userId) return { error: 'USER_ID_REQUIRED' as const };
    if (!issueId) return { error: 'ISSUE_ID_REQUIRED' as const };
    if (!documentKey) return { error: 'DOCUMENT_KEY_REQUIRED' as const };

    const ext = lowerExt(documentKey);

    // ---- T-05-04-02: macro rejection BEFORE any host read. ----------------
    if (ext === '.xlsm') {
      return { error: 'XLSM_REJECTED' as const };
    }

    // ---- Branch routing on extension. -------------------------------------
    // For pdf + img we don't need the body bytes -- just a URL the UI can
    // hand to <embed> / <img>. We pull the doc summary to confirm existence,
    // then synthesise a host-resolvable URL. The exact URL shape mirrors the
    // pattern used by ctx.http.fetch elsewhere in the codebase (relative
    // /api/... routes resolve same-origin in the host shell).
    //
    // For xlsx + md we need the body -- documents.get returns it.

    // Confirm doc exists (and grab body for parse-path branches).
    let doc: { id?: string; key?: string; body?: string } | null;
    try {
      doc = (await ctx.issues.documents.get(issueId, documentKey, companyId)) as
        | { id?: string; key?: string; body?: string }
        | null;
    } catch (e) {
      ctx.logger?.warn?.('deliverable.preview: documents.get threw', {
        issueId,
        documentKey,
        err: (e as Error).message,
      });
      return { error: 'READ_FAILED' as const };
    }
    if (!doc) {
      ctx.logger?.warn?.('deliverable.preview: document not found', {
        issueId,
        documentKey,
      });
      return { error: 'READ_FAILED' as const };
    }

    const body = typeof doc.body === 'string' ? doc.body : '';

    // ---- markdown branch --------------------------------------------------
    if (ext === '.md' || ext === '.markdown') {
      return { kind: 'md' as const, body };
    }

    // ---- pdf branch -------------------------------------------------------
    if (ext === '.pdf') {
      const url = `/api/issues/${issueId}/documents/${encodeURIComponent(documentKey)}`;
      return { kind: 'pdf-embed' as const, url };
    }

    // ---- img branch -------------------------------------------------------
    if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      const url = `/api/issues/${issueId}/documents/${encodeURIComponent(documentKey)}`;
      return { kind: 'img' as const, url };
    }

    // ---- xlsx branch ------------------------------------------------------
    if (ext === '.xlsx') {
      // Decode body to a buffer. T-05-04-03 size check fires BEFORE
      // XLSX.read sees anything.
      let buf: Buffer;
      try {
        buf = bodyToBuffer(body);
      } catch (e) {
        ctx.logger?.warn?.('deliverable.preview: body decode threw', {
          issueId,
          documentKey,
          err: (e as Error).message,
        });
        return { error: 'READ_FAILED' as const };
      }

      if (buf.byteLength > XLSX_MAX_BYTES) {
        ctx.logger?.warn?.('deliverable.preview: xlsx too large -- rejected pre-parse', {
          issueId,
          documentKey,
          sizeBytes: buf.byteLength,
          ceiling: XLSX_MAX_BYTES,
        });
        return {
          error: 'DELIVERABLE_TOO_LARGE' as const,
          sizeBytes: buf.byteLength,
        };
      }

      // T-05-04-01: parse-only -- cellFormula:false disables formula eval.
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(buf, {
          type: 'buffer',
          cellFormula: false,
          cellDates: true,
        });
      } catch (e) {
        ctx.logger?.warn?.('deliverable.preview: XLSX.read failed', {
          issueId,
          documentKey,
          err: (e as Error).message,
        });
        return { error: 'PARSE_FAILED' as const };
      }

      const sheets: Array<{ name: string; rows: string[][] }> = [];
      try {
        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name];
          if (!sheet) continue;
          const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: '',
          }) as unknown[][];
          // Cap rows per sheet -- defense in depth (T-05-04-03 zip-bomb-ish).
          const rows: string[][] = [];
          const cap = Math.min(raw.length, MAX_ROWS_PER_SHEET);
          for (let i = 0; i < cap; i++) {
            const r = raw[i];
            if (!Array.isArray(r)) continue;
            rows.push(r.map(coerceCell));
          }
          if (raw.length > MAX_ROWS_PER_SHEET) {
            rows.push([
              `(truncated — showing first ${MAX_ROWS_PER_SHEET} of ${raw.length} rows)`,
            ]);
          }
          sheets.push({ name, rows });
        }
      } catch (e) {
        ctx.logger?.warn?.('deliverable.preview: sheet enumeration failed', {
          issueId,
          documentKey,
          err: (e as Error).message,
        });
        return { error: 'PARSE_FAILED' as const };
      }

      return { kind: 'xlsx-grid' as const, sheets };
    }

    // ---- fall-through: unknown extension ----------------------------------
    return {
      kind: 'placeholder' as const,
      reason: 'Preview not available for this file type',
    };
  });
}
