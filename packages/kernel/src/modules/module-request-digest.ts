import { createHash } from "node:crypto";

/** Object key order does not change a JSON request; array order does. */
export function moduleRequestDigest(value: unknown) {
  const json = JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item);
  return createHash("sha256").update(json).digest("hex");
}
