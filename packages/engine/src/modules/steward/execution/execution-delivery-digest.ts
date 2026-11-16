import { createHash } from "node:crypto";

export const executionDigest = (input: unknown): string => createHash("sha256").update(JSON.stringify(input, (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex");
