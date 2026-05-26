// src/ui/surfaces/chat/attachment-picker.tsx
//
// Plan 05-11 Task 5 (CHAT-07 gap closure) -- composer attachment picker.
//
// Owns the hidden `<input type="file" accept=".xlsx,.pdf,.md,.png">`,
// staging state (browser-memory only -- no upload yet), and the deferred
// upload chain that fires on Send.
//
// Upload-on-send semantics (Option B locked 2026-05-26):
//   - openPicker()  -- programmatically clicks the hidden input.
//   - onChange      -- stages each picked File in browser memory; NO host
//                       call. chip.state === 'staged'.
//   - removeStaged  -- drops a staged entry from local state (no host call;
//                       nothing was uploaded).
//   - uploadAll(chatMessageId) -- invoked by Composer.handleSend AFTER
//     chat.send returns; sequentially per file: flip chip to 'uploading',
//     base64-encode the body, dispatch chat.attachment.upload with the
//     supplied chatMessageId, flip chip to 'ready' or 'failed' (bound
//     onRetry re-runs the chain for that single chip).
//   - clear()       -- resets staged to [] after a successful Send. Failed
//                       chips survive on the message bubble for individual
//                       Retry; the consumer (Composer) decides what to keep.
//
// SECURITY: no raw fetch; the upload goes through usePluginAction. The
// File body is base64-encoded with btoa(String.fromCharCode(...bytes))
// (browser-built-in path; Node tests stub usePluginAction so this code
// path is exercised by mock). No dangerouslySetInnerHTML.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import type { AttachmentChipState } from './attachment-chip.tsx';

const ACCEPT = '.xlsx,.pdf,.md,.png';

/**
 * A staged or in-flight attachment. The composer renders an AttachmentChip
 * per entry; uploadAll(chatMessageId) flips state through the lifecycle.
 */
export type StagedAttachment = {
  tempId: string;
  file: File;
  filename: string;
  mimeType: string;
  byteSize: number;
  state: AttachmentChipState;
  /** Populated after a successful upload -- the FK target for retry. */
  documentKey?: string;
  attachmentId?: string;
  /** Populated when state === 'failed'; bound by uploadAll. */
  error?: string;
  /** Plan 05-11 (CHAT-07) -- the chatMessageId (chat_messages.message_uuid)
   *  this attachment was attempted against. Stored on the entry so the
   *  picker hook can re-bind Retry to the SAME chat_messages row (the FK
   *  target must not change across retries). Populated by uploadAll
   *  before runOne fires; surfaces a stable retry target for failed
   *  entries. */
  lastChatMessageId?: string;
};

export type UseAttachmentPickerArgs = {
  companyId: string;
  userId: string;
  topicIssueId: string;
};

export type UseAttachmentPickerReturn = {
  /** Programmatic click on the hidden input. */
  openPicker: () => void;
  /** Current staged attachments (in pick order). */
  staged: StagedAttachment[];
  /** Drop a staged entry by tempId. No host call (the file was never uploaded). */
  removeStaged: (tempId: string) => void;
  /**
   * Run the upload chain for every staged file. Invoked by the composer
   * AFTER chat.send returns with the persisted message_uuid. Sequential
   * (v1; parallel deferred to v1.1). Per-file failures flip the chip to
   * 'failed' with a bound onRetry that re-runs the chain for that single
   * chip against the SAME chatMessageId.
   */
  uploadAll: (chatMessageId: string) => Promise<void>;
  /** Reset staged to []. Called by the composer post-Send. */
  clear: () => void;
  /**
   * Mounts the hidden <input type="file"> in the DOM. Render once near
   * the composer; visibility-hidden by CSS / inline style.
   */
  PickerInput: React.FC<Record<string, never>>;
  /** Per-chip retry callback factory; bound on failed entries. */
  retryFor: (tempId: string, chatMessageId: string) => () => void;
};

/**
 * Read a File as ArrayBuffer, then base64-encode the bytes. Works in
 * Node (FileReader exists in jsdom-free harness via the browser-bridge
 * stub used by the chat tests). Falls back to btoa(binaryString) when
 * Buffer is unavailable.
 */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Node path: Buffer is available; do the encode directly.
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser path: build a binary string then btoa. Chunked to stay under
  // the call-stack limit (apply spread of >65K args throws on V8 + JSC).
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}

/** Generate a temp id for staged chips (client-only; never sent to host). */
function newTempId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * useAttachmentPicker -- the composer's attach-and-stage hook. Returns the
 * picker controls + a PickerInput component the consumer mounts once near
 * the composer. The hidden input has accept=".xlsx,.pdf,.md,.png" so the
 * native file dialog filters extensions client-side; the worker re-
 * validates every upload.
 */
export function useAttachmentPicker({
  companyId,
  userId,
  topicIssueId,
}: UseAttachmentPickerArgs): UseAttachmentPickerReturn {
  const uploadAction = usePluginAction('chat.attachment.upload');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [staged, setStaged] = React.useState<StagedAttachment[]>([]);
  // Mirror state in a ref so uploadAll closures always see the latest
  // staged list (otherwise uploadAll captures a stale snapshot taken at
  // call time).
  const stagedRef = React.useRef<StagedAttachment[]>([]);
  stagedRef.current = staged;

  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const entries: StagedAttachment[] = files.map((file) => ({
      tempId: newTempId(),
      file,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      byteSize: file.size,
      state: 'staged' as AttachmentChipState,
    }));
    setStaged((prev) => [...prev, ...entries]);
    // Reset the input so re-picking the same file fires onChange again.
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const removeStaged = React.useCallback((tempId: string) => {
    setStaged((prev) => prev.filter((s) => s.tempId !== tempId));
  }, []);

  const clear = React.useCallback(() => {
    setStaged([]);
  }, []);

  // Per-chip upload runner: flips state through uploading -> ready/failed.
  const runOne = React.useCallback(
    async (tempId: string, chatMessageId: string): Promise<void> => {
      const entry = stagedRef.current.find((s) => s.tempId === tempId);
      if (!entry) return;
      // Record the chatMessageId so a Retry button can use the SAME FK
      // target without the consumer threading it back through React state.
      setStaged((prev) =>
        prev.map((s) =>
          s.tempId === tempId
            ? {
                ...s,
                state: 'uploading' as const,
                lastChatMessageId: chatMessageId,
              }
            : s,
        ),
      );
      let body: string;
      try {
        body = await fileToBase64(entry.file);
      } catch (e) {
        setStaged((prev) =>
          prev.map((s) =>
            s.tempId === tempId
              ? {
                  ...s,
                  state: 'failed' as const,
                  error: (e as Error).message ?? 'encode failed',
                }
              : s,
          ),
        );
        return;
      }
      try {
        const result = await uploadAction({
          companyId,
          userId,
          topicIssueId,
          chatMessageId,
          originalFilename: entry.filename,
          mimeType: entry.mimeType,
          body,
        });
        if (
          result &&
          typeof result === 'object' &&
          'ok' in (result as Record<string, unknown>) &&
          (result as { ok?: unknown }).ok === true
        ) {
          const ok = result as {
            attachmentId?: string;
            documentKey?: string;
          };
          setStaged((prev) =>
            prev.map((s) =>
              s.tempId === tempId
                ? {
                    ...s,
                    state: 'ready' as const,
                    documentKey: ok.documentKey,
                    attachmentId: ok.attachmentId,
                  }
                : s,
            ),
          );
          return;
        }
        const err =
          result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)
            ? String((result as { error: unknown }).error)
            : 'UPLOAD_FAILED';
        setStaged((prev) =>
          prev.map((s) =>
            s.tempId === tempId
              ? { ...s, state: 'failed' as const, error: err }
              : s,
          ),
        );
      } catch (e) {
        setStaged((prev) =>
          prev.map((s) =>
            s.tempId === tempId
              ? {
                  ...s,
                  state: 'failed' as const,
                  error: (e as Error).message ?? 'UPLOAD_FAILED',
                }
              : s,
          ),
        );
      }
    },
    [uploadAction, companyId, userId, topicIssueId],
  );

  const uploadAll = React.useCallback(
    async (chatMessageId: string): Promise<void> => {
      // Snapshot the staged ids at call time. Failed ones stay in staged
      // (the composer keeps them addressable for Retry); successful ones
      // flip to 'ready' and the composer may clear them after Send.
      const tempIds = stagedRef.current.map((s) => s.tempId);
      for (const tempId of tempIds) {
        // Sequential v1; parallel deferred to v1.1.
        await runOne(tempId, chatMessageId);
      }
    },
    [runOne],
  );

  const retryFor = React.useCallback(
    (tempId: string, chatMessageId: string): (() => void) =>
      () => {
        void runOne(tempId, chatMessageId);
      },
    [runOne],
  );

  // The hidden input. Visibility hidden via inline style so the file dialog
  // still triggers on programmatic click.
  const PickerInput: React.FC<Record<string, never>> = React.useCallback(
    () => (
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={onChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        aria-label="Attach a file"
        tabIndex={-1}
        data-clarity-region="attachment-picker-input"
      />
    ),
    [onChange],
  );

  return {
    openPicker,
    staged,
    removeStaged,
    uploadAll,
    clear,
    PickerInput,
    retryFor,
  };
}

/**
 * A standalone <input type="file"> component for consumers who do not
 * use the hook. The hook owns the canonical wiring; this is kept exported
 * for completeness per Plan 05-11 artifact spec.
 */
export const AttachmentPickerInput: React.FC<{
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ inputRef, onChange }) => (
  <input
    ref={inputRef}
    type="file"
    accept={ACCEPT}
    multiple
    onChange={onChange}
    style={{ display: 'none' }}
    aria-hidden="true"
    aria-label="Attach a file"
    tabIndex={-1}
    data-clarity-region="attachment-picker-input"
  />
);
