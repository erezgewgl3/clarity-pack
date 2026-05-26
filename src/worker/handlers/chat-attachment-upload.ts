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
//   7. Generate attachmentId (UUID v4) + compose UUID-only document key.
//   8. ctx.issues.documents.upsert with the UUID-only key + original filename
//      preserved in the `title` field (host stores it in documents.title).
//   9. insertChatMessageAttachment (FK-safe under upload-on-send semantics).
//  10. Return { ok, attachmentId, documentKey, mimeType, byteSize }.
//
// Threat-model anchors:
//   T-05-11-01 (Tampering): step 6 enforces declared-vs-actual mime via
//     magic-number sniff before any host write.
//   T-05-11-02 (DoS):       steps 4 + 5 enforce 10 MB / file + 50 MB / message
//     before any host write.
//   T-05-11-07 (Tampering): UUID-only document_key composition (Hotfix
//     2026-05-26) keeps user-supplied filename out of the host's document
//     key entirely; the original filename is preserved in documents.title
//     (host) + chat_message_attachments.original_filename (plugin namespace).
//     The safeFilename helper is retained for future use but no longer
//     participates in document-key composition. Hotfix root cause: Paperclip's
//     host validator rejects keys containing dots, underscores, or uppercase
//     (live drill 2026-05-26 surfaced 6+ "Invalid document key" failures).
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
 * SAFE_FILENAME_MAX characters.
 *
 * NOTE (Hotfix 2026-05-26): This helper used to compose the document_key
 * (`chat-attach-<msgId>-<safeFilename>`). The host validator rejects keys
 * with dots/underscores/uppercase, so document_key composition switched to
 * UUID-only. The helper is retained for future use (e.g. sanitizing
 * filenames for non-key contexts, or if the host loosens key validation).
 * It is NOT currently called by registerChatAttachmentUpload but its tests
 * still pin the contract for future re-use.
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

    // 7. Generate attachmentId (UUID v4) FIRST. The document key is composed
    //    from this UUID only -- NO filename component. Hotfix 2026-05-26:
    //    Paperclip's host validator rejects keys containing dots,
    //    underscores, or uppercase (live drill surfaced 6+ "Invalid document
    //    key" failures against the previous `chat-attach-<msgId>-<filename>`
    //    composition). UUIDs are lowercase hex + hyphens only, matching the
    //    host's accepted pattern (`compile-result` style).
    //
    //    The original filename is preserved in two places: (a) host:
    //    documents.title (set below via the upsert call); (b) plugin
    //    namespace: chat_message_attachments.original_filename. The UI
    //    renders filenames from those sources -- never by parsing the key.
    const attachmentId = randomUUID();
    const documentKey = `chat-attach-${attachmentId}`;

    // 8. Invoke ctx.issues.documents.upsert with the UUID-only key and the
    //    original filename in the `title` field. The Plan 05-04 DIST-04
    //    dispatcher reads file content via ctx.issues.documents.get(key)
    //    and routes by extension stored alongside; it does not parse the
    //    document key itself.
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

    // 8.5 Hotfix 2026-05-26 (comment_id backfill) -- look up the parent
    //     chat_messages row to retrieve its already-persisted comment_id.
    //     Under Option B (upload-on-send), chat.send fires BEFORE
    //     chat.attachment.upload and commits the chat_messages row with
    //     its host comment_id populated. By the time this handler runs
    //     the comment_id is available; the upload handler used to
    //     hardcode `comment_id: null` here, which left attachment rows
    //     floating (orphaned from the comment the bubble renders against),
    //     so the chat.messages handler could not project them onto the
    //     correct bubble. The fallback path (null on lookup failure or
    //     missing row) preserves orphan-safe behaviour: the attachment
    //     still appears in the right-rail Recent Attachments listing
    //     (which keys on topic_issue_id, not comment_id), so the file is
    //     not lost -- only the per-bubble chip rendering degrades.
    let resolvedCommentId: string | null = null;
    try {
      const chatMsgRows = await ctx.db.query<{ comment_id: string | null }>(
        `SELECT comment_id
         FROM plugin_clarity_pack_cdd6bda4bd.chat_messages
         WHERE message_uuid = $1 AND company_id = $2
         LIMIT 1`,
        [chatMessageId, companyId],
      );
      resolvedCommentId = chatMsgRows[0]?.comment_id ?? null;
    } catch (e) {
      ctx.logger?.warn?.('chat.attachment.upload: comment_id lookup failed', {
        chatMessageId,
        err: (e as Error).message,
      });
      // Proceed with null -- the attachment is still addressable in the
      // right-rail; the per-bubble chip rendering degrades gracefully.
    }

    // 9. Insert chat_message_attachments row. FK to chat_messages is
    //    structurally safe under Option B upload-on-send semantics
    //    (chat.send has already committed the row by the time this handler
    //    runs). attachmentId from step 7 is the PK + the connection to
    //    the document just upserted. comment_id is the value resolved in
    //    step 8.5 -- this is the load-bearing wire that the chat.messages
    //    handler's per-bubble projection joins on.
    try {
      await insertChatMessageAttachment(ctx, {
        id: attachmentId,
        company_id: companyId,
        topic_issue_id: topicIssueId,
        chat_message_id: chatMessageId,
        comment_id: resolvedCommentId,
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
