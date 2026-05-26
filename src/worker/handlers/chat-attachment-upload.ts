// src/worker/handlers/chat-attachment-upload.ts
//
// Plan 05-11 Task 3 -- chat.attachment.upload ACTION handler (CHAT-07 gap closure).
//
// Upload one file from the chat composer to the plugin-owned issue documents
// store. Invoked by the composer AFTER chat.send has persisted the
// chat_messages row (upload-on-send semantics -- Option B locked 2026-05-26).
// The chatMessageId param therefore always references an already-committed
// row, and the chat_message_attachments insert is FK-safe under the standard
// (non-deferrable) FK declared in migration 0011.
//
// Pipeline (executed in this exact order):
//   1. Read + validate every required param.
//   2. Allowlist check on the filename extension (BEFORE any host call).
//   3. Base64-decode the body to a Buffer (catch decode failure).
//   4. Per-file size guard (10 MB) on the decoded length.
//   5. Per-message size guard (50 MB) summed across existing attachments on
//      the same chat_message_id.
//   6. Mime-sniff guard -- the declared extension must match the sniffed
//      kind.
//   7. ctx.issues.documents.upsert with a canonical document key.
//   8. insertChatMessageAttachment (FK-safe under upload-on-send semantics).
//   9. Return { ok, attachmentId, documentKey, mimeType, byteSize }.
//
// Threat-model anchors:
//   T-05-11-01 (Tampering): step 6 enforces declared-vs-actual mime via
//     magic-number sniff before any host write.
//   T-05-11-02 (DoS):       steps 4 + 5 enforce 10 MB / file + 50 MB / message
//     before any host write.
//   T-05-11-07 (Tampering): safeFilename strips path separators + control
//     chars + truncates to 64 chars before composing the document_key.
//
// CTT-07 invariant by construction: this handler reads + writes the plugin-
// namespace chat_message_attachments table and writes to
// ctx.issues.documents.upsert. It NEVER calls ctx.issues.update. The runtime
// spy (Test 10) and source-grep (test/ctt07/chat-attachment-handlers-no-issue-update.test.mjs)
// pin the invariant.
//
// Action-handler convention (mirrors chat-send.ts):
//   - missing required string param  -> THROW with "<key> required"
//   - body decode failure            -> RETURN { error: 'BODY_DECODE_FAILED' }
//   - allowlist / size / mime errors -> RETURN structured error envelope
//   - opted-out caller               -> RETURN { error: 'OPT_IN_REQUIRED' }
//                                       (via wrapActionHandler -- T-04-15)
//   - host upsert failure            -> RETURN { error: 'UPLOAD_FAILED' }
//   - repo insert failure            -> RETURN { error: 'UPLOAD_FAILED' }
//                                       + best-effort compensating delete

import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';
import type { PluginIssuesClient, PluginLogger } from '@paperclipai/plugin-sdk';
import {
  insertChatMessageAttachment,
  sumChatMessageAttachmentBytesByMessage,
  type ChatTopicsRepoCtx,
} from '../db/chat-topics-repo.ts';
import { sniffMime } from '../mime-sniff.ts';
import { randomUUID } from 'node:crypto';

const PER_FILE_LIMIT_BYTES = 10_485_760; // 10 MB
const PER_MESSAGE_LIMIT_BYTES = 52_428_800; // 50 MB
const SAFE_FILENAME_MAX = 64;

type AllowedExt = '.xlsx' | '.pdf' | '.md' | '.png';
const ALLOWED_EXTS: readonly AllowedExt[] = ['.xlsx', '.pdf', '.md', '.png'] as const;
const ALLOWED_DISPLAY = ['xlsx', 'pdf', 'md', 'png'];

const MIME_BY_EXT: Record<AllowedExt, string> = {
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.png': 'image/png',
};

const FORMAT_BY_EXT: Record<AllowedExt, string> = {
  '.xlsx': 'binary',
  '.pdf': 'binary',
  '.md': 'text/markdown',
  '.png': 'binary',
};

export type ChatAttachmentUploadCtx = OptInGuardActionCtx &
  ChatTopicsRepoCtx & {
    issues: PluginIssuesClient;
    logger?: PluginLogger;
  };

function reqStr(
  params: Record<string, unknown> | undefined,
  key: string,
): string {
  const v = params?.[key];
  if (typeof v === 'string' && v) return v;
  throw new Error(`chat.attachment.upload: ${key} required`);
}

function lowerExt(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  return name.slice(i).toLowerCase();
}

/**
 * Strip path separators + control characters from `name` and truncate to
 * SAFE_FILENAME_MAX characters. Used to compose the canonical document_key
 * so a hostile filename cannot escape the plugin's namespace or include
 * shell-meaningful tokens (T-05-11-07 path-traversal mitigation).
 */
function safeFilename(name: string): string {
  // Replace anything outside [A-Za-z0-9._-] with '_'. This intentionally
  // also strips whitespace; the document_key is an opaque server key, not
  // a user-facing rendered string.
  const stripped = name.replace(/[^A-Za-z0-9._-]/g, '_');
  // Strip leading dots (no hidden-file convention; no ../ escape via dots).
  const noLeadDots = stripped.replace(/^\.+/, '');
  // Truncate.
  if (noLeadDots.length > SAFE_FILENAME_MAX) {
    return noLeadDots.slice(0, SAFE_FILENAME_MAX);
  }
  return noLeadDots || 'file';
}

export function registerChatAttachmentUpload(ctx: ChatAttachmentUploadCtx): void {
  wrapActionHandler(ctx, 'chat.attachment.upload', async (params) => {
    // 1. Param validation -- throw with the canonical message on missing
    //    required string params (matches chat-send.ts convention; the
    //    wrapActionHandler unwraps the throw into the JSON-RPC error
    //    channel).
    const companyId = reqStr(params, 'companyId');
    const userId = reqStr(params, 'userId');
    void userId; // enforced by the opt-in-guard wrapper, re-read for completeness.
    const topicIssueId = reqStr(params, 'topicIssueId');
    const chatMessageId = reqStr(params, 'chatMessageId');
    const originalFilename = reqStr(params, 'originalFilename');
    const mimeType = reqStr(params, 'mimeType');
    const body = reqStr(params, 'body');

    // 2. Allowlist check on the filename extension (T-05-11-01 boundary
    //    of the upload surface).
    const ext = lowerExt(originalFilename) as AllowedExt;
    if (!ALLOWED_EXTS.includes(ext)) {
      return {
        error: 'MIME_NOT_ALLOWED' as const,
        declared: mimeType,
        allowed: ALLOWED_DISPLAY,
      };
    }

    // 3. Base64-decode the body. The composer sends base64 for binary +
    //    text alike (uniform contract; Node's Buffer.from('text', 'base64')
    //    handles both correctly). A decode failure is surfaced
    //    deterministically.
    let buf: Buffer;
    try {
      buf = Buffer.from(body, 'base64');
    } catch (e) {
      ctx.logger?.warn?.('chat.attachment.upload: body decode threw', {
        err: (e as Error).message,
      });
      return { error: 'BODY_DECODE_FAILED' as const };
    }
    if (buf.byteLength === 0) {
      return { error: 'BODY_DECODE_FAILED' as const };
    }

    // 4. Per-file size guard (T-05-11-02).
    if (buf.byteLength > PER_FILE_LIMIT_BYTES) {
      return {
        error: 'FILE_TOO_LARGE' as const,
        limitBytes: PER_FILE_LIMIT_BYTES,
        actualBytes: buf.byteLength,
      };
    }

    // 5. Per-message size guard (T-05-11-02). Sum existing attachments on
    //    this chat_message_id; reject if (current + new) > 50 MB.
    let currentSumBytes = 0;
    try {
      currentSumBytes = await sumChatMessageAttachmentBytesByMessage(
        ctx,
        companyId,
        chatMessageId,
      );
    } catch (e) {
      ctx.logger?.warn?.('chat.attachment.upload: per-message sum failed', {
        chatMessageId,
        err: (e as Error).message,
      });
      return { error: 'UPLOAD_FAILED' as const };
    }
    if (currentSumBytes + buf.byteLength > PER_MESSAGE_LIMIT_BYTES) {
      return {
        error: 'MESSAGE_TOO_LARGE' as const,
        limitBytes: PER_MESSAGE_LIMIT_BYTES,
        currentSumBytes,
        attemptedAddBytes: buf.byteLength,
      };
    }

    // 6. Mime-sniff (T-05-11-01). The declared extension must match the
    //    sniffed magic-number / text discriminator.
    const sniff = sniffMime(buf);
    const expectedKind: Record<AllowedExt, 'pdf' | 'png' | 'zip' | 'text'> = {
      '.pdf': 'pdf',
      '.png': 'png',
      '.xlsx': 'zip',
      '.md': 'text',
    };
    const expected = expectedKind[ext];
    if (sniff.sniffedKind !== expected) {
      return {
        error: 'MIME_MISMATCH' as const,
        declared: mimeType,
        sniffed: sniff.mime ?? 'application/octet-stream',
      };
    }

    // 7. Compose canonical document key + invoke ctx.issues.documents.upsert.
    //    The key namespace `chat-attach-<message_uuid>-<safefilename>` keeps
    //    chat-uploaded docs distinguishable from plan-authored documents in
    //    the same store; the Plan 05-04 DIST-04 dispatcher routes them all
    //    correctly via extension.
    const documentKey = `chat-attach-${chatMessageId}-${safeFilename(originalFilename)}`;
    const docFormat = FORMAT_BY_EXT[ext];
    try {
      await ctx.issues.documents.upsert({
        issueId: topicIssueId,
        key: documentKey,
        body,
        companyId,
        title: originalFilename,
        format: docFormat,
        changeSummary: 'chat attachment upload',
      });
    } catch (e) {
      ctx.logger?.warn?.('chat.attachment.upload: documents.upsert failed', {
        topicIssueId,
        documentKey,
        err: (e as Error).message,
      });
      return { error: 'UPLOAD_FAILED' as const };
    }

    // 8. Insert chat_message_attachments row. FK to chat_messages is
    //    structurally safe under Option B upload-on-send semantics
    //    (chat.send has already committed the row by the time this handler
    //    runs).
    const attachmentId = randomUUID();
    try {
      await insertChatMessageAttachment(ctx, {
        id: attachmentId,
        company_id: companyId,
        topic_issue_id: topicIssueId,
        chat_message_id: chatMessageId,
        comment_id: null,
        document_key: documentKey,
        mime_type: MIME_BY_EXT[ext], // canonicalize -- never trust client mimeType after sniff
        original_filename: originalFilename,
        byte_size: buf.byteLength,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      ctx.logger?.warn?.('chat.attachment.upload: side-table insert failed', {
        topicIssueId,
        documentKey,
        err: (e as Error).message,
      });
      // Best-effort compensating delete of the document we just upserted --
      // matches chat-send.ts orphan-handling shape. Idempotent per SDK.
      try {
        await ctx.issues.documents.delete(topicIssueId, documentKey, companyId);
      } catch (de) {
        ctx.logger?.warn?.('chat.attachment.upload: compensating delete failed', {
          topicIssueId,
          documentKey,
          err: (de as Error).message,
        });
      }
      return { error: 'UPLOAD_FAILED' as const };
    }

    return {
      ok: true as const,
      attachmentId,
      documentKey,
      mimeType: MIME_BY_EXT[ext],
      byteSize: buf.byteLength,
    };
  });
}
