---
gsd_doc_type: hotfix
phase: 05-distribution-polish
plan: 05-11
hotfix_id: document-key
shipped: 2026-05-26
parent_plan: 05-11-PLAN.md
parent_summary: 05-11-SUMMARY.md
supersedes_tarball:
  size_bytes: 632895
  sha256: 77d50e88227c26b9345a64401d794a9d497f6abcd576c5944d3676968806f8a3
new_tarball:
  size_bytes: 637697
  sha256: 8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6
version_literal: 1.0.0
quality_gates_status: all-green
commits:
  - 3ab6151 fix(05-11-hotfix): UUID-only document key
  - 6fd9887 chore(05-11-hotfix): repack clarity-pack-1.0.0.tgz
  - this-commit docs(05-11-hotfix): HOTFIX note + STATE update
---

# Plan 05-11 HOTFIX — Document Key

## Symptom

Live operator drill on Countermoves VPS (Hostinger; clarity-pack-1.0.0.tgz
sha256 `77d50e88227c26b9345a64401d794a9d497f6abcd576c5944d3676968806f8a3`),
2026-05-26: chat composer file picker → click Send. The `chat.attachment.upload`
worker handler returned `{ error: 'UPLOAD_FAILED' }` for every attempted
upload (≥6 documented failures across at least 4 distinct filenames).
Worker logs showed the underlying host error verbatim:

    chat.attachment.upload: documents.upsert failed
      topicIssueId=...  documentKey=chat-attach-56ebc430-fcf7-434d-bc12-c2289df27a95-Document_Archive_Index.pdf
      err=Invalid document key

(The exact failing documentKey above is a representative example; every
failure shared the same shape: `chat-attach-<chat_message_uuid>-<filename>`
where the filename tail carried dots / underscores / uppercase letters.)

UI symptom: the staged attachment chip flipped to `state="failed"` and
the composer stayed disabled while the staged entry's Retry button just
re-triggered the same `Invalid document key` rejection — the user could
not upload ANY attachment via the composer.

## Root cause

Paperclip's host validator for `ctx.issues.documents.upsert` enforces a
strict key charset: **lowercase letters + digits + hyphens only**. The
host uses keys like `compile-result`, `plan`, `design-spec` — all single
tokens, no dots, no underscores, no uppercase.

Plan 05-11 (commit `b46a25c` and the surrounding 10-commit Plan 05-11
chain) composed the document key as:

```ts
const documentKey = `chat-attach-${chatMessageId}-${safeFilename(originalFilename)}`;
```

Where `safeFilename` stripped path separators + control chars but
**preserved** dots (so `.pdf` survived), **preserved** underscores (so
internal underscores in filenames survived), and **preserved**
uppercase (so `Document_Archive_Index` survived). The threat model
covered path traversal (T-05-11-07) but did NOT cover host validator
syntax — there was no spec doc or SDK type pinning the accepted charset,
and the unit tests stubbed the host with a fake that accepted any key.

The result: every real upload tried to push a key like
`chat-attach-56ebc430-fcf7-434d-bc12-c2289df27a95-Document_Archive_Index.pdf`,
which the host rejected on three separate counts (period before extension,
underscores in filename, uppercase letters). The handler caught the host
exception, logged the warn, and returned `UPLOAD_FAILED` — the broad
`UPLOAD_FAILED` error code masked the specific cause from the UI.

This was missed pre-drill because:

- The unit test harness (`makeCtx`) stubs `ctx.issues.documents.upsert`
  with a fake that accepts any key. The fake never simulated the host's
  syntactic validator.
- The integration round-trip uses the same fake-store pattern (an
  in-memory Map keyed on `${issueId}::${key}`) which equally accepts any
  string.
- The Plan 05-04 DIST-04 dispatcher reads documents via
  `ctx.issues.documents.get(key)` — it does not parse the key — so even
  post-upload code paths gave no signal that the key format mattered.
- The SDK type at `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts`
  (`upsert.input.key: string`) does not pin the charset.

## Fix

Generate `attachmentId` (UUID v4) BEFORE composing the document key and
compose the key from that UUID alone:

```ts
// Before
const documentKey = `chat-attach-${chatMessageId}-${safeFilename(originalFilename)}`;
// ...
const attachmentId = randomUUID();  // step 9 (after upsert)

// After
const attachmentId = randomUUID();  // step 7 (BEFORE upsert)
const documentKey = `chat-attach-${attachmentId}`;
```

UUIDs are lowercase hex + hyphens only — matching the host's accepted
pattern. The `chat-attach-` prefix keeps chat-uploaded documents
distinguishable from plan-authored documents in the same store (Plan
05-04 dispatcher routes them all correctly via the `format` /
extension stored alongside, not the key prefix).

The original filename is preserved in two places:

- **Host:** `documents.title` (set by the upsert `title: originalFilename`
  field that Plan 05-11 already passed; no change here).
- **Plugin namespace:** `chat_message_attachments.original_filename`
  (the existing side-table insert preserves the filename verbatim).

The UI renders filenames from those sources — it never parses the
document key for display.

The `safeFilename` helper is retained in the source. Its tests
(`safeFilename` shape contract) still pass. The JSDoc was updated to
flag that it no longer participates in document-key composition but is
kept for potential future non-key use.

## Files changed

| File | Change |
| --- | --- |
| `src/worker/handlers/chat-attachment-upload.ts` | Re-ordered steps 7-9; key = `chat-attach-${attachmentId}` (UUID only); JSDoc + header comment updates explaining the hotfix. |
| `test/worker/handlers/chat-attachment-upload.test.mjs` | Harness readback fake echoes `params[0]` (the inserted id) into `document_key`; happy-path assertion replaced with UUID-format regex + host-validator charset regex (`^[a-z0-9-]+$`) + `documents.title` preservation check. |
| `test/integration/chat-attachment-roundtrip.test.mjs` | documentKey assertion replaced with UUID-format regex + identity check (`documentKey === \`chat-attach-${attachmentId}\``); host-side title preservation asserted on the `documents.list()` readback. |

## Tarball before/after

```
before: clarity-pack-1.0.0.tgz
  size:   632,895 bytes
  sha256: 77d50e88227c26b9345a64401d794a9d497f6abcd576c5944d3676968806f8a3

after:  clarity-pack-1.0.0.tgz
  size:   637,697 bytes  (+4,802 bytes — expanded handler header comment +
                          hotfix-justified JSDoc; no functional bloat)
  sha256: 8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6
```

Version literal **unchanged** at `1.0.0` in BOTH `package.json` AND
`src/manifest.ts:337` AND the built `dist/manifest.js` — binary repack
only (matches the Plan 05-10 worker-bundler hotfix precedent + the
memory `plugin-version-bump-two-sources`).

## Quality gates (all GREEN post-hotfix)

| Gate | Result |
| --- | --- |
| `pnpm typecheck` (`tsc --noEmit`) | clean — no errors |
| ESM bundle load: `node -e "import('./dist/worker.js')"` | `LOADS OK` |
| `pnpm build` | worker 2.1 MB, ui 655.2 kB, manifest emit OK |
| `node scripts/check-css-scope.mjs` | 121 selectors all scoped under `[data-clarity-surface]` |
| `node scripts/check-a11y.mjs` | 72 files scanned / 0 violations |
| `node scripts/check-ui-bundle-size.mjs` | 670,942 / 691,200 byte ceiling; 0 SheetJS sentinels |
| `node scripts/coexistence-checks/run-all.mjs` | 10/10 PASS |
| `pnpm test` (full Node test suite) | 1800 / 1800 pass / 0 fail / 2 skipped (pre-existing) |
| `chat-attachment-upload.test.mjs` (focused) | 18/18 pass |
| `chat-attachment-roundtrip.test.mjs` (focused) | 2/2 pass |

## Evidence the fix works (unit-level)

The new happy-path assertion in the unit test pins the format:

```js
assert.match(
  result.documentKey,
  /^chat-attach-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  'documentKey is `chat-attach-<uuid>` (UUID-only, host-validator-safe)',
);
// Host validator regression guard.
assert.match(
  result.documentKey,
  /^[a-z0-9-]+$/,
  'host-validator-safe charset: lowercase + digits + hyphens only',
);
```

A representative key produced by the new code:
`chat-attach-9f3c2a1d-7b4e-4f0c-8d51-3a2e6f8c9b10`. It matches the
host's accepted `compile-result`-style pattern character-for-character
(prefix is a known-good token; suffix is RFC 4122 UUID v4 in lowercase
hex with hyphens).

## CTT-07 invariant

Preserved by construction. The fix adds zero `ctx.issues.update` calls.
Test 10 (CTT-07 runtime spy across all code paths) still asserts
zero spy invocations across happy + MIME_NOT_ALLOWED + FILE_TOO_LARGE +
MIME_MISMATCH + OPT_IN_REQUIRED + UPLOAD_FAILED + MESSAGE_TOO_LARGE.

## Deferred (NOT in this hotfix)

- **Bug 2 from the 2026-05-26 drill log: topic-watchdog CTT-07
  violation.** `src/worker/handlers/topic-watchdog.ts` was flagged as
  potentially calling `ctx.issues.update` during the same drill session.
  This is a SEPARATE finding from the document-key bug and lives in a
  different handler — out of scope for this hotfix. A follow-up audit
  + fix will land as a separate plan or hotfix. The Plan 05-11
  source-grep CTT-07 invariant covered only the two NEW handlers
  (`chat-attachment-upload.ts` + `chat-attachment-list.ts`), not the
  pre-existing watchdog.

- **A11y / Plan 05-11 UI polish items.** Any UI polish discovered
  during the same drill (chip layout, popover positioning, etc.) is
  deferred — this hotfix is strictly the document-key fix.

## Reproduction (post-hotfix verification)

```bash
# 1. Build + pack.
pnpm build
node -e "import('./dist/worker.js').then(()=>console.log('LOADS OK'))"
rm -f clarity-pack-1.0.0.tgz
pnpm pack

# 2. Confirm new sha256 + size.
node -e "
const c = require('crypto'), f = require('fs');
const h = c.createHash('sha256');
h.update(f.readFileSync('clarity-pack-1.0.0.tgz'));
console.log('size=' + f.statSync('clarity-pack-1.0.0.tgz').size,
            'sha256=' + h.digest('hex'));
"
# Expected:
# size=637697 sha256=8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6

# 3. Smoke test the handler in isolation.
node --test test/worker/handlers/chat-attachment-upload.test.mjs
# Expected: 18/18 pass.

# 4. Run the integration round-trip.
node --test test/integration/chat-attachment-roundtrip.test.mjs
# Expected: 2/2 pass.

# 5. Full suite.
pnpm test
# Expected: 1800/1800 pass, 0 fail, 2 skipped.

# 6. (operator) re-run the Countermoves drill against the new tarball
#    (sha256 8b1eba1fc...) and verify a 4-format upload (.pdf, .png, .md, .xlsx)
#    succeeds with status=ok and the chip flips to state="ready".
```

## Invariants preserved

- **Version literal:** `1.0.0` everywhere (`package.json`,
  `src/manifest.ts:337`, `dist/manifest.js`). No bump.
- **No new runtime deps:** `crypto.randomUUID()` is Node built-in.
- **CTT-07:** zero `ctx.issues.update` in the modified handler;
  runtime spy + source-grep guarantees unchanged.
- **Plan 05-11 contract surface:** the `ChatAttachmentEntry` returned
  by `chat.attachment.list` still carries `documentKey, mimeType,
  originalFilename, byteSize`; UI components consuming those fields
  are unaffected (they never parsed the key).
- **safeFilename helper:** retained in source; tests still pin its
  contract; no longer called for document-key composition.
- **Phase 5 quality gates:** all 8 gates GREEN.

## Status

Hotfix code-complete; awaiting operator drill on Countermoves against
the new tarball (sha256 `8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6`).
This SUPERSEDES the prior Plan 05-11 tarball
(`77d50e88227c26b9345a64401d794a9d497f6abcd576c5944d3676968806f8a3`)
for the upload verification slice of the drill. The other Plan 05-11
verification steps (size guards, mime mismatch rejection, Reader auto-sync,
right-rail Recent Attachments) are unchanged — re-run them against
the new tarball as a single round.

## Self-Check: PASSED

- File exists: `.planning/phases/05-distribution-polish/05-11-HOTFIX-DOCUMENT-KEY.md` — FOUND
- File exists: `src/worker/handlers/chat-attachment-upload.ts` — FOUND
- File exists: `clarity-pack-1.0.0.tgz` — FOUND
- Tarball size: 637,697 bytes — matches expected.
- Tarball sha256: `8b1eba1fcbb5602ec4f7780e97db41b309edb7a77a8fee6a967749534cc70ac6` — matches expected.
- Commit `3ab6151` (fix): present in git log.
- Commit `6fd9887` (repack): present in git log.
- Commit `19bf4d3` (docs + STATE): present in git log.
