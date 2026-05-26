// src/worker/mime-sniff.ts
//
// Plan 05-11 Task 3 -- pure-Node magic-number MIME sniff utility.
//
// Built on Node's Buffer.subarray + simple byte-prefix comparison. NO new
// runtime dependency. Used by chat.attachment.upload to reject files whose
// declared mime type does not match their actual content (T-05-11-01
// tampering threat).
//
// Coverage matches the Plan 05-11 mime allowlist {.xlsx, .pdf, .md, .png}:
//
//   - PDF:  %PDF-              (5 bytes: 0x25 0x50 0x44 0x46 0x2D)
//   - PNG:  PNG signature      (8 bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)
//   - ZIP:  PK\x03\x04         (4 bytes: 0x50 0x4B 0x03 0x04 -- the universal
//                                .xlsx / .docx / .pptx prefix; the upload
//                                handler disambiguates via the filename
//                                extension allowlist)
//   - TEXT: ASCII/UTF-8 heuristic on first 256 bytes -- every byte must be
//           printable ASCII (0x20-0x7E), an allowed whitespace
//           (0x09 tab / 0x0A LF / 0x0D CR), or a valid UTF-8 continuation
//           byte (0x80-0xFF); NO NUL byte (0x00) anywhere in the prefix.
//
// The text-detection threshold of 256 bytes is the practical upper bound:
// any binary preamble (zip / pdf / png magic) is in the first ~10 bytes,
// and a markdown file with 256 ASCII characters is overwhelmingly likely
// to BE markdown. Files smaller than 256 bytes are scanned in full.

export type SniffedKind = 'pdf' | 'png' | 'zip' | 'text' | 'unknown';

export type SniffResult = {
  /** Canonical mime string the sniff resolved to, or null for unknown. */
  mime: string | null;
  /** Discriminator the upload handler compares against the declared extension. */
  sniffedKind: SniffedKind;
};

const TEXT_PROBE_BYTES = 256;

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

function startsWith(buf: Buffer, magic: Buffer): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Heuristic ASCII / UTF-8 text detection on the first `probeLen` bytes.
 *
 * A byte is text-friendly when:
 *   - it is one of the allowed whitespace bytes (TAB / LF / CR)
 *   - or it is printable ASCII (0x20-0x7E)
 *   - or it is a UTF-8 continuation byte / high byte (0x80-0xFF) -- markdown
 *     legitimately carries multi-byte UTF-8 sequences. We do NOT validate the
 *     full UTF-8 grammar here; we only reject NULs and DEL-range control
 *     codes (0x7F).
 *
 * Any NUL byte (0x00) in the probe instantly disqualifies the buffer as
 * text. This catches PDF / xlsx / png blobs whose binary preamble contains
 * NULs (PDF has them in xref tables; xlsx zip headers carry them; PNG
 * tEXt chunks contain them).
 */
function looksLikeText(buf: Buffer): boolean {
  const probeLen = Math.min(buf.length, TEXT_PROBE_BYTES);
  for (let i = 0; i < probeLen; i++) {
    const b = buf[i];
    if (b === 0x00) return false; // NUL is the textbook binary marker.
    if (b === 0x7f) return false; // DEL control code -- not in markdown.
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue; // TAB, LF, CR
    if (b >= 0x20 && b <= 0x7e) continue; // printable ASCII
    if (b >= 0x80) continue; // UTF-8 continuation / high byte
    return false; // any other control byte (0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F)
  }
  return true;
}

/**
 * Inspect the first 16 bytes for magic-number matches and the first 256
 * bytes for the text heuristic. Returns a discriminator + canonical mime
 * string. The caller (chat.attachment.upload) compares the discriminator
 * against the declared filename extension.
 *
 * - .pdf  -> sniffedKind must be 'pdf'
 * - .png  -> sniffedKind must be 'png'
 * - .xlsx -> sniffedKind must be 'zip' (xlsx IS a zip; the extension is the
 *           disambiguator inside the allowlist)
 * - .md   -> sniffedKind must be 'text'
 */
export function sniffMime(buffer: Buffer): SniffResult {
  if (!buffer || buffer.length === 0) {
    return { mime: null, sniffedKind: 'unknown' };
  }

  // Magic-number sniff (the first 16 bytes are enough for every allowlisted
  // binary format; we use Buffer.subarray to avoid an alloc).
  const head = buffer.subarray(0, Math.min(buffer.length, 16));

  if (startsWith(head, PDF_MAGIC)) {
    return { mime: 'application/pdf', sniffedKind: 'pdf' };
  }
  if (startsWith(head, PNG_MAGIC)) {
    return { mime: 'image/png', sniffedKind: 'png' };
  }
  if (startsWith(head, ZIP_MAGIC)) {
    // The upload-handler-level allowlist disambiguates xlsx vs docx vs
    // generic zip via the filename extension. We canonicalize to the xlsx
    // mime here because xlsx is the only zip-format in the allowlist; if a
    // future allowlist adds docx / pptx, the discriminator stays 'zip' and
    // the handler picks the right mime per extension.
    return {
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sniffedKind: 'zip',
    };
  }

  // Text heuristic. Markdown is the only allowlisted text format.
  if (looksLikeText(buffer)) {
    return { mime: 'text/markdown', sniffedKind: 'text' };
  }

  return { mime: null, sniffedKind: 'unknown' };
}
