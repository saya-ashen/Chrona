import { z } from "zod";
import type { SourceAdapter, SourceItem } from "@chrona/contracts/steward";

/** Names only, not credential values. Unknown keys (including tokens) are rejected. */
export const redditInboxConfigSchema = z.object({
  credentialRef: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/),
  userAgent: z.string().trim().min(1).max(256).regex(/^[^\r\n]+$/),
}).strict();
export type RedditInboxConfig = z.infer<typeof redditInboxConfigSchema>;
export type RedditInboxErrorKind = "auth" | "rate_limit" | "transport" | "http" | "invalid_response";

/** Deliberately excludes upstream bodies/messages: they can contain credentials. */
export class RedditInboxError extends Error {
  constructor(public readonly kind: RedditInboxErrorKind, public readonly status: number | null = null) {
    super(kind === "auth" ? "Reddit inbox authorization required (read-only access)."
      : kind === "rate_limit" ? "Reddit inbox rate limited; retry later."
      : `Reddit inbox ${kind} failure.`);
    this.name = "RedditInboxError";
  }
}

export type RedditInboxDependencies = {
  /** Sole IO boundary. Must return a newest-first inbox listing; no writes are exposed. */
  fetchInbox?: (request: {
    token: string; userAgent: string; cursor: string | null;
  }) => Promise<{ status: number; json(): Promise<unknown> }>;
  tokenProvider?: (credentialRef: string) => Promise<string | null>;
};

const listingSchema = z.object({
  data: z.object({ children: z.array(z.object({ kind: z.string(), data: z.unknown() })) }),
});
const messageSchema = z.object({
  name: z.string().regex(/^t[14]_.+$/),
  subject: z.string().nullish(), body: z.string(), author: z.string().nullable(),
  context: z.string().nullish(), permalink: z.string().nullish(),
  created_utc: z.number().finite().min(0).max(253402300799),
});

function evidenceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.reddit.com");
    return url.protocol === "https:" && ["reddit.com", "www.reddit.com", "old.reddit.com"].includes(url.hostname)
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function statusError(status: number): RedditInboxError {
  return new RedditInboxError(status === 401 || status === 403 ? "auth"
    : status === 429 ? "rate_limit" : "http", status);
}

function transportError(error: unknown): RedditInboxError {
  // Accept structured HTTP failures from injected transports; never forward their text.
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : null;
  return typeof status === "number" ? statusError(status) : new RedditInboxError("transport");
}

function inboxItems(listing: z.infer<typeof listingSchema>): SourceItem[] {
  return listing.data.children
    .filter((child) => child.kind === "t1" || child.kind === "t4")
    .map((child) => {
      const data = messageSchema.parse(child.data);
      if (!data.name.startsWith(`${child.kind}_`)) throw new RedditInboxError("invalid_response");
      return {
        externalId: data.name, title: data.subject ?? "", body: data.body,
        author: data.author ?? "[deleted]",
        url: evidenceUrl(data.context) ?? evidenceUrl(data.permalink),
        occurredAt: new Date(data.created_utc * 1000).toISOString(),
      };
    });
}

/** Read-only mapping boundary. No default transport, token lookup, or network calls. */
export function createRedditInboxSource(deps: RedditInboxDependencies = {}): SourceAdapter {
  async function token(config: RedditInboxConfig): Promise<string> {
    if (!deps.tokenProvider) throw new RedditInboxError("auth");
    try {
      const value = await deps.tokenProvider(config.credentialRef);
      if (!value?.trim()) throw new RedditInboxError("auth");
      return value;
    } catch { throw new RedditInboxError("auth"); }
  }
  return {
    kind: "reddit_inbox",
    mode: "poll",
    supportedActions: ["read_source"],
    coverageNote: "Read-only inbox polling; not a subscription. Listing windows may omit older items; caller owns baseline and deduplication. No real account connected without injected authorization and transport.",
    async readiness(connection) {
      if (!deps.tokenProvider) return {
        state: "needs_authorization", reason: "No token provider injected; Reddit account read authorization is required.",
      };
      const config = redditInboxConfigSchema.safeParse(connection.config);
      if (!config.success) return { state: "unsupported", reason: "Invalid Reddit credential reference or user-agent configuration." };
      try { await token(config.data); }
      catch { return { state: "needs_authorization", reason: "Token provider could not supply authorized Reddit read access." }; }
      if (!deps.fetchInbox) return { state: "unsupported", reason: "No read-only inbox transport injected." };
      return { state: "ready" };
    },
    async poll(connection, cursor) {
      const config = redditInboxConfigSchema.parse(connection.config);
      const accessToken = await token(config);
      if (!deps.fetchInbox) throw new RedditInboxError("transport");
      let response;
      try {
        response = await deps.fetchInbox({ token: accessToken, userAgent: config.userAgent, cursor });
      } catch (error) {
        throw transportError(error);
      }
      if (response.status < 200 || response.status >= 300) throw statusError(response.status);
      try {
        const listing = listingSchema.parse(await response.json());
        const newestFirst = inboxItems(listing);
        const boundary = cursor === null ? -1 : newestFirst.findIndex((item) => item.externalId === cursor);
        const fresh = boundary < 0 ? newestFirst : newestFirst.slice(0, boundary);
        return {
          items: [...fresh].reverse(),
          nextCursor: newestFirst[0]?.externalId ?? cursor,
        };
      } catch { throw new RedditInboxError("invalid_response"); }
    },
  };
}
