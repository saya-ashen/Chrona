import { providerText } from "@chrona/domain/steward/provider";
import type { Prisma } from "@chrona/db";
import { CallError } from "../modules/module-call-error";

const credentialKey = /(?:secret|password|authorization|credential|api[-_]?key|access[-_]?token|^token$|cookie)/i;
/** Mask a bounded response without changing its structure or silently clipping its contents. */
export function maskProviderPayload(value: unknown, secrets: string[] = [], maxBytes = 65_536): Prisma.InputJsonValue {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) throw new CallError("invalid", "Provider response exceeds its retention bound");
  function walk(item: unknown, depth: number): Prisma.InputJsonValue | null {
    if (depth > 64) throw new CallError("invalid", "Provider response exceeds its nesting bound");
    if (typeof item === "string") return providerText(item, secrets, maxBytes, true);
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(value => walk(value, depth + 1));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, value]) => [providerText(key, secrets, maxBytes), credentialKey.test(key) ? "[redacted]" : walk(value, depth + 1)]));
    return null;
  }
  const result = walk(value, 0) ?? {};
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes) throw new CallError("invalid", "Masked provider response exceeds its retention bound");
  return result;
}

/** Raw telemetry is complete masked JSON or an explicit gap; never a clipped protocol envelope. */
export function safeProviderPayload(value: unknown, secrets: string[] = [], maxBytes = 16_384): Prisma.InputJsonValue {
  try { return maskProviderPayload(value, secrets, maxBytes); }
  catch (error) {
    if (!(error instanceof CallError) || error.code !== "invalid") throw error;
    return { type: "chrona_raw_gap", reason: "too_large", detail: "Provider event exceeds retention bounds" };
  }
}
