import { createHash } from "node:crypto";

/** Preserve persisted workspace/lock digests: recursively sorted object keys, ordered arrays. */
export function workspaceDigest(input: unknown): string {
  const body = JSON.stringify(input, (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  return createHash("sha256").update(body).digest("hex");
}
