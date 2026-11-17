import { createHash } from "node:crypto";
import { pageInput } from "@chrona/contracts/steward";
import { CallError } from "./modules/module-call-error";

/** Stable identity ordering; cursors are scoped positions, never authorization. */
export function pagePosition(raw: unknown, scope: string) {
  const input = pageInput.parse(raw), tag = createHash("sha256").update(scope).digest("hex");
  let after: string | undefined;
  if (input.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (cursor.scope !== tag || typeof cursor.after !== "string") throw new Error("cursor scope");
      after = cursor.after;
    } catch { throw new CallError("invalid", "Invalid or mismatched cursor"); }
  }
  return { ...input, after, tag };
}
export function apiPage<T>(values: T[], raw: unknown, scope: string, identity: (value: T) => string) {
  const { after, tag, limit } = pagePosition(raw, scope);
  const sorted = values.sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);
  const remaining = after === undefined ? sorted : sorted.filter(value => identity(value) > after!);
  const items: T[] = [];
  let bytes = 0;
  for (const item of remaining.slice(0, limit)) {
    const size = new TextEncoder().encode(JSON.stringify(item)).byteLength;
    if (bytes + size > 128 * 1024) {
      if (!items.length) throw new CallError("failed", "A list item exceeds the output bound");
      break;
    }
    items.push(item); bytes += size;
  }
  return { items, nextCursor: remaining.length > items.length ? Buffer.from(JSON.stringify({ scope: tag, after: identity(items.at(-1)!) })).toString("base64url") : null };
}
