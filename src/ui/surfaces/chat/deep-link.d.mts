// src/ui/surfaces/chat/deep-link.d.mts
//
// Plan 04.2-02 Task 2 — type declarations for the SHARED Reader->Chat
// deep-link contract module (deep-link.mjs).
// Plan 04.2-03 Task 2 — carrier swapped from `{ state }` to URL_HASH; the
// `state` field on the returned nav object is now `undefined` (no longer
// carries a payload) and `parseChatDeepLink` accepts an additional `hash`
// argument as the canonical channel.
//
// The contract is implemented in `.mjs` so Node's test runner can load it
// directly (the same pattern as reasoning-block-parser.mjs), but the `.tsx`
// consumers (continue-in-chat-button, reverse-topics-link, chat/index) need
// typed imports to keep `tsc --noEmit` clean (the GREEN gate). This file
// mirrors the module's JSDoc shape.

/** The six deep-link params the Reader->Chat bridge carries. */
export interface ChatDeepLink {
  /** existing-topic: the topic ISSUE id. */
  topic: string | null;
  /** existing-topic: a comment to scroll + flash. */
  comment: string | null;
  /** The roster employee agent id. */
  employee: string | null;
  /** new-topic-needed: open the seeded New Topic dialog. */
  newTopic: boolean;
  /** new-topic: pre-filled topic title. */
  seedTitle: string | null;
  /** new-topic: pre-filled first message. */
  seedBody: string | null;
  /** new-topic: the source issue (RCB-04 chat_topics.origin_issue_id). */
  originIssueId: string | null;
}

/**
 * What navigate() needs: the fragment-bearing path. Plan 04.2-03 URL_HASH
 * carrier — the encoded payload rides entirely in `to`'s `#h=...` fragment.
 * `state` is intentionally `undefined`; the 0.9.1 state carrier was proven
 * stripped by the host wrapper around useNavigate on the live Countermoves
 * Paperclip instance.
 */
export interface ChatDeepLinkNav {
  to: string;
  state: undefined;
}

export interface BuildChatDeepLinkInput {
  route: 'existing-topic' | 'new-topic-needed';
  companyPrefix: string;
  topicIssueId?: string;
  sourceCommentId?: string;
  assigneeAgentId?: string;
  seedTitle?: string;
  seedBody?: string;
  originIssueId?: string;
}

/**
 * Build the Reader->Chat deep link for a resolved route. Returns null when
 * the route is not navigable (topic-itself / missing topicIssueId).
 */
export function buildChatDeepLink(
  input: BuildChatDeepLinkInput | null | undefined,
): ChatDeepLinkNav | null;

/** Build a topic-only deep link — the shape ReverseTopicsLink (RCB-06) needs. */
export function buildTopicDeepLink(
  companyPrefix: string,
  topicIssueId: string,
): ChatDeepLinkNav | null;

/**
 * Read one deep link back from the host router. The CANONICAL channel is
 * the URL fragment (`hash` — Plan 04.2-03 URL_HASH carrier). `search` and
 * `state` are accepted for API compatibility / defensive input handling
 * but no longer carry the canonical payload (neither survives this host's
 * navigate() -> useHostLocation() handoff). Tolerates missing / malformed
 * input without throwing.
 */
export function parseChatDeepLink(location: {
  search?: string | null;
  state?: unknown;
  hash?: string | null;
} | null | undefined): ChatDeepLink | null;
